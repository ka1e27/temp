// Phase 9 (docs/PLAN-PHASE9.md, docs/briefs/phase9-hookup.md): the Daily Challenge and the Scenarios, app side. Small and in the boot graph; the rest
// (the meta API, the hub, the result screen, the tracker) is app/challengeKit.js, loaded with import() on first use or a few seconds after boot.
//
// Playing a challenge = the state container POINTS at the challenge's own {state, world} (container.enterSandbox); the realm's pair waits parked and is
// never read or written (no autosave of it, no idle, no raids: every loop reads the container). Back = container.leaveSandbox: the very same objects.
// The challenge is saved under CHALLENGE_MODE.saveKey and the lasting record under CHALLENGE_MODE.recordKey; the realm's save key is never written
// while a challenge runs, except once when today's Daily pays its +1 Renown to the realm (claimDailyReward), which is saved at once.
import { CHALLENGE_MODE, BANNERS } from '../config/challenges.js';
import { setBannerStyle } from '../render/sprites.js';
import { isDialogOpen } from '../ui/dialogs.js';
import { createModal } from '../ui/modal.js';
import { serialize } from '../meta/save.js';
import { addHelpButton } from '../ui/codexHelp.js';

/** The player's LOCAL date as yyyymmdd (the app layer's job: the pure code never reads a clock). */
export function localToday(d = new Date()) {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** The chosen banner of a stored record, read before the kit has loaded (so the first frame already flies it). Plain on anything doubtful. */
export function bannerOfRaw(raw) {
  try {
    const b = JSON.parse(raw).banners;
    const ok = BANNERS.some((x) => x.id === b.selected) && Array.isArray(b.unlocked) && b.unlocked.includes(b.selected);
    return ok ? b.selected : 'plain';
  } catch { return 'plain'; }
}

/**
 * @param {{ storage, container, services, ui, goto, applyWorld, autosave, sceneName: () => string, isActive: () => boolean,
 *   getSession: () => boolean, setSession: (on: boolean) => void, today?: () => number, onEntryChange?: () => void }} deps
 */
export function createChallengeMode(deps) {
  const { storage, container, services, ui, goto, applyWorld, autosave } = deps;
  const today = deps.today || (() => localToday());
  let kit = null;
  let kitLoading = null;
  let record = null;
  let views = null; // { hub, result, tracker }
  let run = null; // the challenge being played: { kind, key, practice, returnTo, sessionBefore, welcome, prosperity, recorded, outcome }
  let pendingResult = false;
  let saveAcc = 0;
  let trackerAt = 0;
  const endedRuns = new Map(); // battle id -> run, between the manager's 'ended' and 'finished'
  const dev = { parkSig: null, unparkSig: null, lastOutcome: null };

  try { setBannerStyle(bannerOfRaw(storage.getItem(CHALLENGE_MODE.recordKey))); } catch { /* storage off: plain */ }

  const active = () => container.inSandbox && !!run;
  const mainState = () => container.main().state;
  const read = (k) => { try { return storage.getItem(k); } catch { return null; } };
  const write = (k, v) => { try { storage.setItem(k, v); return true; } catch { return false; } };
  const remove = (k) => { try { storage.removeItem(k); } catch { /* ignore */ } };

  function loadKit() {
    if (kit) return Promise.resolve(kit);
    if (!kitLoading) {
      kitLoading = import('./challengeKit.js').then((k) => {
        kit = k;
        record = kit.deserializeRecord(read(CHALLENGE_MODE.recordKey));
        setBannerStyle(record.banners.selected);
        const fresh = kit.syncBanners(record, mainState());
        if (fresh.length) { saveRecord(); toastBanners(fresh); }
        views = {
          hub: kit.createChallengeHub({
            onPlayDaily: () => play('daily', today()), onResume: () => resume(), onPlayScenario: (id) => play('scenario', id),
            onPractice: (date) => play('daily', date), onBanner: (id) => chooseBanner(id), onClose: () => {},
          }),
          result: kit.createChallengeResult({ onRetry: () => retry(), onBack: () => leave() }),
          tracker: kit.createGoalTracker({ onLeave: () => confirmLeave() }),
        };
        const head = views.hub.el.querySelector('.ch-header');
        addHelpButton(head, head.querySelector('.ch-close'), 'Challenges', () => services.openCodex?.('daily'));
        document.body.appendChild(views.hub.el);
        document.body.appendChild(views.result.el);
        ui.hud.tabsEl.appendChild(views.tracker.el);
        deps.onEntryChange?.();
        return kit;
      }).catch((err) => { kitLoading = null; throw err; });
    }
    return kitLoading;
  }

  function saveRecord() { if (record) write(CHALLENGE_MODE.recordKey, kit.serializeRecord(record)); }
  function toastBanners(ids) {
    for (const id of ids) {
      const b = BANNERS.find((x) => x.id === id);
      if (b) ui.toasts.update({ id: `banner-${id}`, type: 'success', icon: 'banner', message: `New banner style: ${b.name}. Choose it in Settings.`, duration: 6000 });
    }
  }

  /** Are the Challenges open (the main realm's first conquest, or Dynasty 2+)? False until the kit has loaded. */
  function unlocked() { return !!kit && kit.challengesUnlocked(mainState()); }

  /** Is the Codex topic `id` discovered in the MAIN save (scenario unlocks)? */
  function seenTopic(id) {
    const topic = kit && kit.CODEX_TOPICS.find((t) => t.id === id);
    try { return !!(topic && topic.seen(mainState())); } catch { return false; }
  }

  /** A saved, unfinished challenge (after a reload): { kind, key, label, pair } or null. */
  function savedRun() {
    const raw = read(CHALLENGE_MODE.saveKey);
    if (!raw || !kit) return null;
    const pair = kit.deserializeChallenge(raw);
    if (!pair || !pair.state.challenge || pair.state.challenge.done) return null;
    const c = pair.state.challenge;
    const spec = kit.challengeSpecOf(pair.state);
    return { kind: c.kind, key: c.kind === 'daily' ? c.date : c.id, pair, label: `Resume ${spec ? spec.name : 'the challenge'} (${Math.floor(c.activeSec / 60)}:${String(Math.floor(c.activeSec % 60)).padStart(2, '0')})` };
  }

  async function openHub(tab) {
    try {
      await loadKit();
    } catch (err) {
      console.warn('[challenges] could not load:', err);
      ui.toasts.update({ type: 'warning', icon: 'trophy', message: 'The Challenges could not be opened (offline?).', duration: 4000 });
      return;
    }
    if (!unlocked()) return;
    ui.settings.el.hidden = true;
    views.hub.open(hubData(), tab);
    services.tutorial?.notify('challengesOpened');
  }
  function hubData() { const s = active() ? null : savedRun(); return kit.hubData(record, today(), seenTopic, s); }

  // --- playing ------------------------------------------------------------------------------------------------------------------------------
  let fadeEl = null;
  function fade(swap) {
    if (!fadeEl) { fadeEl = document.createElement('div'); fadeEl.className = 'hd-fade'; document.body.appendChild(fadeEl); }
    fadeEl.classList.add('on');
    setTimeout(() => {
      try { swap(); } catch (err) { console.error('[challenges] switch failed:', err); }
      requestAnimationFrame(() => fadeEl.classList.remove('on'));
    }, 260);
  }

  function specOf(kind, key) { return kind === 'daily' ? kit.dailySpec(key) : kit.scenarioSpec(key); }

  async function play(kind, key) {
    await loadKit();
    if (!active() && !unlocked()) return false;
    const spec = specOf(kind, key);
    if (!spec) return false;
    const practice = kind === 'daily' && key !== today();
    // a run left unfinished (a reload) and now replaced: it counted as an attempt when it began, so it is recorded as it stood
    const saved = !active() ? savedRun() : null;
    if (saved) settleAbandon(saved.pair.state, saved.pair.world);
    begin(kit.createChallengeGame(kind, spec, { nowMs: Date.now(), practice }), kind, key, practice);
    return true;
  }

  async function resume() {
    await loadKit();
    const s = savedRun();
    if (!s) return false;
    begin(s.pair, s.kind, s.key, !!s.pair.state.challenge.practice);
    return true;
  }

  function begin(pair, kind, key, practice) {
    views.hub.close();
    views.result.close();
    pendingResult = false;
    if (!active()) {
      run = { returnTo: deps.sceneName() === 'title' ? 'title' : 'world', sessionBefore: deps.getSession(),
        welcome: services.pendingWelcome, prosperity: (services.pendingProsperity || []).slice() };
    }
    Object.assign(run, { kind, key, practice, recorded: false, outcome: null });
    pair.state.settings = mainState().settings; // the player's settings are not part of a challenge (a change made here is the realm's too)
    fade(() => {
      if (!container.inSandbox) {
        if (run.sessionBefore) autosave.save(); // the realm's last word before it is parked: its save is exactly the parked state
        dev.parkSig = serialize(mainState());
      }
      container.enterSandbox(pair);
      endedRuns.clear();
      applyWorld();
      services.startSession();
      saveChallenge();
      goto.world({ freshRealm: true, newWorld: true });
      trackerAt = 0;
    });
  }

  function saveChallenge() { if (active() && kit) write(CHALLENGE_MODE.saveKey, kit.serializeChallenge(container.get().state)); }

  /** Records an unfinished run as it stands (an abandon or a Retry counts as an attempt; a run with no play at all does not). */
  function settleAbandon(state, world) {
    const c = state && state.challenge;
    if (!c || c.done || !(c.activeSec >= 1 || c.log.length)) return null;
    const result = kit.challengeResult(state, world, kit.challengeSpecOf(state));
    if (result.kind === 'daily') kit.recordDailyResult(record, result, today()); else kit.recordScenarioResult(record, result);
    saveRecord();
    return result;
  }

  function onDone() {
    if (!active() || run.recorded) return;
    const { state, world } = container.get();
    const spec = kit.challengeSpecOf(state);
    const result = kit.challengeResult(state, world, spec);
    const o = { result, spec, rec: null, reward: null, share: null, shareText: null, banners: [] };
    const t = today();
    if (result.kind === 'daily') {
      o.rec = kit.recordDailyResult(record, result, t);
      o.attempts = o.rec.attempts;
      o.reward = kit.claimDailyReward(mainState(), record, result.date, t);
      if (o.reward) autosave.save({ force: true }); // the realm's +1 Renown is kept at once (the only write to the realm's save during a challenge)
      if (result.met) { o.share = kit.shareData(result, record); o.shareText = kit.shareText(o.share); }
    } else {
      o.rec = kit.recordScenarioResult(record, result);
      o.attempts = record.scenarios[result.id] ? record.scenarios[result.id].attempts : 1;
    }
    o.banners = kit.syncBanners(record, mainState());
    saveRecord();
    remove(CHALLENGE_MODE.saveKey); // finished: nothing to resume
    run.recorded = true;
    run.outcome = o;
    dev.lastOutcome = o;
    pendingResult = true;
  }

  function canShowResult() {
    const scene = deps.sceneName();
    if (scene === 'battle' && !ui.results.el.hidden) return false; // the watched battle's own card first
    return !isDialogOpen();
  }
  function showResult() {
    pendingResult = false;
    views.result.open(kit.resultData(run.outcome));
    services.sfx?.play(run.outcome.result.met ? 'victory' : 'defeat', { volume: 0.5 });
  }

  function retry() {
    if (!active()) return;
    if (!run.recorded) settleAbandon(container.get().state, container.get().world);
    const spec = specOf(run.kind, run.key);
    begin(kit.createChallengeGame(run.kind, spec, { nowMs: Date.now(), practice: run.practice }), run.kind, run.key, run.practice);
  }

  /** Back to the realm, exactly as it was parked (and to the title when the challenge was opened from there). */
  function leave({ silent = false } = {}) {
    if (!active()) return;
    if (!run.recorded) settleAbandon(container.get().state, container.get().world);
    remove(CHALLENGE_MODE.saveKey);
    views.result.close();
    pendingResult = false;
    const r = run;
    const swap = () => {
      container.leaveSandbox();
      dev.unparkSig = serialize(mainState());
      run = null;
      endedRuns.clear();
      applyWorld();
      services.pendingWelcome = r.welcome ? { ...r.welcome, epoch: container.epoch } : null;
      services.pendingProsperity = r.prosperity.map((u) => ({ ...u, epoch: container.epoch }));
      deps.setSession(r.sessionBefore);
      views.tracker.update({ visible: false });
      if (silent) return;
      if (r.returnTo === 'title') goto.title({}); else goto.world({ freshRealm: true, newWorld: true });
    };
    if (silent) swap(); else fade(swap);
  }

  function confirmLeave() {
    if (!active()) return;
    const modal = createModal({
      title: 'Leave the challenge?',
      body: run.recorded ? 'Back to your realm.' : 'It counts as an attempt. Your realm waits exactly as you left it.',
      actions: [
        { label: 'Keep playing', variant: 'secondary', onClick: () => modal.destroy() },
        { label: 'Retry', variant: 'secondary', onClick: () => { modal.destroy(); retry(); } },
        { label: 'Leave', variant: 'primary', onClick: () => { modal.destroy(); leave(); } },
      ],
    }, { onDismiss: () => modal.destroy() });
    document.body.appendChild(modal.el);
  }

  function chooseBanner(id) {
    if (!kit || !kit.selectBanner(record, id)) return;
    saveRecord();
    setBannerStyle(record.banners.selected);
    if (views.hub.isOpen()) views.hub.update(hubData());
    deps.onEntryChange?.();
  }

  // --- the loop and the battle log ------------------------------------------------------------------------------------------------------------
  const battles = services.battles;
  battles.on('ended', (id) => { if (active()) endedRuns.set(id, battles.get(id)); });
  battles.on('events', (id, events) => { if (active() && kit) kit.noteChallengeEvents(container.get().state, events); });
  battles.on('finished', (id, out, snapshot) => {
    const r = endedRuns.get(id);
    endedRuns.delete(id);
    if (!active() || !kit || !r || !snapshot || !snapshot.result) return;
    const { state, world } = container.get();
    const res = kit.recordChallengeBattle(state, world, r, snapshot.result);
    if (res.justDone) onDone();
    saveChallenge();
  });

  /** Every frame (main.js): the active-play clock, the scripted raids, the goal, the tracker, the autosave of the challenge. */
  function tick(dt) {
    if (!active() || !kit) return;
    const { state, world } = container.get();
    if (deps.isActive() && !state.challenge.done) {
      const r = kit.tickChallenge(state, world, dt);
      if (r.justDone) onDone();
    }
    saveAcc += dt;
    if (saveAcc >= 5) { saveAcc = 0; if (!run.recorded) saveChallenge(); }
    if (pendingResult && canShowResult()) showResult();
    const now = performance.now();
    if (now - trackerAt > 250) {
      trackerAt = now;
      views.tracker.update(deps.sceneName() === 'world' ? kit.trackerData(state, world) : { visible: false });
    }
  }

  /** The Challenges entry (title, Settings) and the hint's fact. Preloads the kit once the boot is over. */
  function preload() {
    const go = () => { loadKit().catch(() => { /* offline: tried again on first use */ }); };
    // after the boot's own work (Phase 8 budgets: the title and the first map frames come first), in an idle moment
    setTimeout(() => { if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 3000 }); else go(); }, 2500);
  }

  return {
    loadKit, preload, openHub, play, resume, retry, leave, confirmLeave, tick, unlocked, chooseBanner,
    get active() { return active(); },
    get kit() { return kit; },
    get record() { return record; },
    get run() { return run; },
    bannerList: () => (kit ? kit.bannerList(record) : null),
    /** dev/checks: the realm serialized when it was parked and when it came back; the last outcome; the hub and result views */
    dev: {
      get parkSig() { return dev.parkSig; }, get unparkSig() { return dev.unparkSig; }, get lastOutcome() { return dev.lastOutcome; },
      get views() { return views; }, onDone: () => onDone(), hubData: () => (kit ? hubData() : null),
    },
  };
}
