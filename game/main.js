// Boot + frame loop + scene flow (ARCHITECTURE §9). This is the integration
// layer: it constructs every shared service exactly once, wires every
// game/ui component's callbacks to the active scene, and drives the
// requestAnimationFrame loop. See docs/ARCHITECTURE.md and PLAYFEEL.md.
import { createCamera } from './render/camera.js';
import { createRenderer } from './render/renderer.js';
import { createInput } from './input/pointer.js';
import { createClock } from './input/clock.js';
import { createSfx } from './audio/sfx.js';
import { createMusic } from './audio/music.js';

import { h } from './ui/dom.js';
import { createHud } from './ui/hud.js';
import { createRegionCard } from './ui/regionCard.js';
import { createCouncil } from './ui/council.js';
import { createBattleHud } from './ui/battleHud.js';
import { createResults } from './ui/results.js';
import { createTitle } from './ui/title.js';
import { createToasts } from './ui/toasts.js';
import { createBattleTray } from './ui/battleTray.js';
import { createGeneralsPanel, generalEmblem } from './ui/generalsPanel.js';
import { createModal } from './ui/modal.js';
import { recordChronicle } from './meta/chronicle.js';
import { assign, generalById, freeGenerals } from './meta/generals.js';
import { playerBattleStats } from './meta/progression.js';
import { GENERALS } from './config/generals.js';
import { onDialogChange } from './ui/dialogs.js';
import { announce } from './ui/live.js';
import { createSettings } from './ui/settings.js';
import { createCoach } from './ui/coach.js';
import { createRealm } from './ui/realm.js';
import { createRegionsPanel } from './ui/regionsPanel.js';
import { createWelcome } from './ui/welcome.js';
import { createDevPanel } from './ui/devpanel.js';
import { createTooltip } from './ui/tooltip.js';
import { createLeaderBanner } from './ui/leaderBanner.js';
import { addHelpButton } from './ui/codexHelp.js';

import { createStateContainer } from './app/stateContainer.js';
import { createAutosave } from './app/autosave.js';
import { createIdleTicker } from './app/idle.js';
import { createTutorialController } from './app/tutorial.js';
import { installDevHooks } from './app/devhooks.js';

import { createSceneManager } from './scenes/flow.js';
import { createTitleScene } from './scenes/title.js';
import { createWorldScene } from './scenes/world.js';
import { createBattleScene } from './scenes/battle.js';
import { createBattleManager } from './app/battles.js';
import { createFrontierLoop } from './app/frontierLoop.js';
import { createEventsLoop } from './app/eventsLoop.js';
import { createGoals } from './app/goals.js';
import { createDynasty } from './app/dynasty.js';
import { commanderFor as edictCommander, edictMods } from './meta/edicts.js';
import { createQuickConquest } from './app/quickConquest.js';
import { createCeremony } from './ui/ceremony.js';
import { createQuickOverlay } from './ui/quickOverlay.js';
import { createBoonDraft } from './ui/boonDraft.js';
import { createDuoReveal } from './ui/duoReveal.js';
import { createRelicClaim } from './ui/relicClaim.js';
import { createBoons } from './app/boons.js';
import { shortNumber } from './ui/format.js';
import { dynastyStarText } from './app/perkInfo.js';
import { FEATURES as MAP_FEATURES } from './config/features.js';
import { FEATURES } from './app/features.js';
import { PLAYER_OWNER } from './battle/owner.js';
import { BOOT, WORLD_SCENE } from './scenes/timing.js';

import { loadFrom, exportCode, importCode, SAVE_KEY } from './meta/save.js';
import { offlineEarnings } from './meta/economy.js';
import { resolveAway, awayReportText } from './meta/frontier.js';
import { offlineCapHours } from './app/income.js';
import { CROWN_TEXTS } from './app/crownCopy.js';
import { createLeaderVoice } from './meta/leaders.js';
import { baselineProsperity, updateProsperity } from './meta/prosperity.js';
import { chronicleOnProsperity } from './meta/chronicle.js';
import { PLAYER_FACTION } from './meta/state.js';

const VERSION = '2.0.0';
const MAX_DPR = 2;

function getStorage() {
  // DESIGN §8: localStorage access can throw (private-browsing lockouts,
  // disabled storage). A storage-less environment still gets an object of the
  // right shape, so play works — it just isn't persisted.
  try {
    const probe = '__hd_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    const mem = new Map();
    return {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k),
    };
  }
}

/** Welcome-card form of level-ups: [{ name, level }]. */
/** The one door every prosperity tick goes through: the level-ups, and the realm's story hears about a first Prosperity III (Keepsakes). The story can never break the tick. */
let prosperityHook = null; // Phase 4: the Bounty Board hears every level-up (app/goals.js onProsperity), once the services exist
function runProsperity(state, world, now) {
  const ups = updateProsperity(state, world, now);
  if (ups.length) {
    try { chronicleOnProsperity(state, world, ups, { t: now }); } catch (err) { console.warn('[chronicle] prosperity line skipped:', err); }
    if (prosperityHook) prosperityHook(ups);
  }
  return ups;
}

function prosperedList(world, ups) {
  return ups.map((u) => ({ name: world.regions[u.regionId].name, level: u.level }));
}

/** Region id -> prosperity level to SHOW: only regions the player owns carry decor. */
function levelsOf(state) {
  const prosperity = state.prosperity || [];
  return state.owner.map((o, i) => (o === PLAYER_FACTION ? prosperity[i] | 0 : 0));
}

// Boot timeline marks (tools/perf.mjs prints them): every module evaluated, the world generated, the render caches baked, the first frame.
const mark = (name) => { try { performance.mark(name); } catch { /* old browsers */ } };
function boot() {
  mark('hd-modules');
  const params = new URLSearchParams(location.search);
  const isDev = params.get('dev') === '1';
  // Touch or mouse? The last pointer the player used decides the wording of the hints (tap, pinch and long-press against click, scroll and shift-drag);
  // before any input, the device's primary pointer does.
  let lastPointerType = null;
  const notePointer = (e) => { if (e.pointerType) lastPointerType = e.pointerType; };
  window.addEventListener('pointerdown', notePointer, { capture: true, passive: true });
  window.addEventListener('pointermove', notePointer, { capture: true, passive: true });
  const isTouch = () => (lastPointerType ? lastPointerType === 'touch' : !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches));
  // Keyboard or pointer? The map's focus ring and its keyboard cursor are drawn only for someone using the keyboard: a mouse player whose click moved focus to the
  // map (or to which the game moved it) must not be left with a dashed ring round a region. The last real input decides (html[data-input]).
  let usingKeyboard = false;
  const setModality = (kb) => { usingKeyboard = kb; document.documentElement.dataset.input = kb ? 'keyboard' : 'pointer'; };
  setModality(false);
  window.addEventListener('keydown', (e) => { if (!['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) setModality(true); }, { capture: true, passive: true });
  window.addEventListener('pointerdown', () => setModality(false), { capture: true, passive: true });
  const isKeyboardUser = () => usingKeyboard;
  const afterFrame = []; // dev hooks called at the end of every frame

  const canvas = document.getElementById('world');
  // The map is a keyboard stop while the world scene is up (tabIndex 0 there): arrow keys move a ring between regions, Enter opens one (scenes/world.js)
  canvas.tabIndex = -1;
  canvas.setAttribute('role', 'group');
  canvas.setAttribute('aria-roledescription', 'map');
  canvas.setAttribute('aria-label', 'World map. Arrow keys move between regions, Enter opens a region, brackets cycle the regions you can attack, plus and minus zoom, Shift with the arrows moves the map.');
  const uiRoot = document.getElementById('ui');
  const storage = getStorage();

  const container = createStateContainer({ storage, now: () => Date.now() });
  // ?dev=1&seed=N: a reproducible continent for screenshots and bug reports (never overrides a save). Handed to boot, so only one world is generated.
  const seedParam = isDev ? params.get('seed') : null;
  let { state: bootState, world: bootWorld, resumed } = container.boot(seedParam != null ? Number(seedParam) : undefined);
  mark('hd-world');

  // Welcome-back is a celebration of gold already granted (DESIGN §5.1) —
  // credit it once, right at boot, regardless of which scene shows first.
  let pendingWelcome = null;
  /** The away trickle (DESIGN 10.10, meta/frontier.js resolveAway), after offlineEarnings: its welcome-card line, or null when nothing happened. */
  function awayReport(state, world, awaySec) {
    if (!FEATURES.frontier || !(awaySec > 0)) return null;
    try {
      const report = resolveAway(state, world, awaySec * 1000, Date.now());
      const text = awayReportText(report, world);
      return text ? { text, lost: report.lost.length } : null;
    } catch (err) { console.warn('[frontier] the away report failed:', err); return null; }
  }
  let bootProsperity = []; // level-ups the welcome card did not take (an absence too short for it)
  if (resumed) {
    // a save with no usable clock (sanitised to 0) was not away "since 1970": treat it as seen just now (no welcome-back for a clock that never ran)
    if (!(bootState.lastSeen > 0)) bootState.lastSeen = Date.now();
    // 1. Silent sync to the levels at DEPARTURE (a save from before prosperity existed gets its levels here, without
    //    a celebration per region). 2. Offline gold, paid with those levels (the conservative rule). 3. The levels
    //    gained while away, reported once: on the welcome card, or celebrated on the map if there is no card.
    baselineProsperity(bootState, bootWorld, bootState.lastSeen);
    const awaySec = Math.max(0, (Date.now() - bootState.lastSeen) / 1000); // the REAL absence: offlineEarnings pays (and reports) only the capped part
    const off = offlineEarnings(bootState, bootWorld, Date.now());
    const ups = runProsperity(bootState, bootWorld, Date.now());
    const away = awayReport(bootState, bootWorld, awaySec); // the gentle trickle of attacks while away (DESIGN 10.10), after the gold
    if ((off.seconds >= WORLD_SCENE.welcomeBackMinSec && off.gold > 0.05) || away) {
      pendingWelcome = {
        timeAwaySec: awaySec, goldEarned: off.gold, prospered: prosperedList(bootWorld, ups),
        capHours: offlineCapHours(bootState), capped: awaySec > off.seconds + 1, away: away ? away.text : '', awayLoss: !!(away && away.lost),
        epoch: container.epoch, // made for THIS realm: New Realm, a reset, an import or a new dynasty drops it (it used to survive them and show as a ghost welcome with negative gold)
      };
    } else {
      bootProsperity = ups.map((u) => ({ ...u, epoch: container.epoch }));
    }
  }

  const camera = createCamera({ minZoom: 0.05, maxZoom: 200 });
  const renderer = createRenderer(canvas);

  const inputHandlers = {};
  const input = createInput(canvas, camera, inputHandlers);
  input.handlers = inputHandlers;

  const sfx = createSfx();
  // The generative score shares the sfx AudioContext and master gain (docs/MUSIC.md). It is inert until
  // the first pointerdown / keydown unlocks audio; ?dev=1&music=noreverb skips the convolver for CPU checks.
  const music = createMusic(sfx, { seed: bootState.seed, reverb: !(isDev && params.get('music') === 'noreverb') });
  // Audio needs a real user activation to leave 'suspended'. A mouse click or key press counts on
  // pointerdown / keydown, but a TOUCH only counts when it ends (touchend / pointerup / click), so a
  // one-shot pointerdown listener would leave phones silent forever. Keep offering every gesture until
  // the shared context is actually running (unlock() is idempotent).
  const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];
  const removeUnlockListeners = () => { for (const e of UNLOCK_EVENTS) window.removeEventListener(e, tryUnlock, true); };
  function tryUnlock() {
    sfx.unlock();
    const c = sfx.getContext();
    if (!c) return;
    if (c.state === 'running') { removeUnlockListeners(); return; }
    c.resume().then(() => { if (c.state === 'running') removeUnlockListeners(); }).catch(() => {});
  }
  for (const e of UNLOCK_EVENTS) window.addEventListener(e, tryUnlock, { capture: true, passive: true });

  function doResize() {
    const w = window.innerWidth;
    const hh = window.innerHeight;
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    renderer.resize(w, hh, dpr);
    camera.resize(renderer.cssWidth, renderer.cssHeight);
  }
  doResize();

  // --- shared state helpers ----------------------------------------------------
  const cur = () => container.get();
  let sessionStarted = false; // becomes true once the player enters the world scene
  let battlesRef = null; // the battle manager (created with the services, below)
  let frontierRef = null; // the frontier loop (likewise)

  function hasSaveOnDisk() {
    try { return loadFrom(storage) != null; } catch { return false; }
  }

  // Reduce Motion starts from the OS (`prefers-reduced-motion`) and keeps following it until the player flips the switch in Settings (`reduceMotionSet`).
  const osMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  if (osMotion && osMotion.addEventListener) {
    osMotion.addEventListener('change', () => {
      const st = container.get().state;
      if (st.settings.reduceMotionSet) return;
      applySettings(st);
      ui.settings.update({ reduceMotion: st.settings.reduceMotion });
    });
  }

  function applySettings(s) {
    if (osMotion && !s.settings.reduceMotionSet) s.settings.reduceMotion = osMotion.matches;
    camera.instant = !!s.settings.reduceMotion; // every camera flight is a cut
    sfx.setMuted(!s.settings.sound);
    sfx.setEffectsLevel(s.settings.sfxVolume ?? 1);
    renderer.fx.setReduceMotion(!!s.settings.reduceMotion);
    renderer.setReduceMotion(!!s.settings.reduceMotion); // ambient life: no birds, still sails, half the smoke
    document.documentElement.classList.toggle('reduce-motion', !!s.settings.reduceMotion);
    applyMusicSettings(s);
  }

  /** Music on/off and its own volume; the master `sound` mute already silences it through the sfx bus. */
  function applyMusicSettings(s) {
    music.setVolume(s.settings.music === false ? 0 : (s.settings.musicVolume ?? 0.4));
  }

  /** (Re)build the world-shaped render caches for the container's current world. */
  let bootBaked = false; // the first applyWorld (the boot) defers most chunk bakes until the title is up (Phase 8 perf)
  function applyWorld() {
    const { state, world } = cur();
    renderer.setWorld(world);
    if (!bootBaked) mark('hd-setworld');
    music.setSeed(state.seed); // boot, import, reset and a new dynasty all re-key the score
    const fit = camera.fitZoom(world.bounds, 40);
    if (bootBaked || globalThis.__HD_BOOT_BAKE_ALL) renderer.terrain.prebakeAll(fit * 1.25 * renderer.dpr, state.owner, levelsOf(state));
    else renderer.terrain.schedulePrebake(fit * 1.25 * renderer.dpr, state.owner, levelsOf(state)); // the chunks on screen bake in the first frame
    if (!bootBaked) mark('hd-chunks');
    applySettings(state);
    // The living layers: pre-populate the roads so the very first frame is already alive, and bake the sprites of the
    // framing zoom now, behind the boot splash (a few tens of ms), instead of as a hitch on the first pan.
    renderer.ambient.rebuild({ owner: state.owner, prosperity: state.prosperity });
    // (not at boot: there the sprites bake lazily within the ambient layer's per-frame budget, so the title shows sooner; Phase 8 perf)
    if (bootBaked) renderer.ambient.prewarm(fit * 1.25);
    purgeStalePending(); // the realm was replaced (import, reset, new dynasty, reseed): nothing queued for the old one may show in the new one
    if (battlesRef) battlesRef.reset(); // so were its running battles (state.battles): forget the old runtimes
    if (frontierRef) frontierRef.reset();
    if (services && services.goals) services.goals.reset();
    if (services && services.boons) services.boons.reset();
    bootBaked = true;
  }

  const autosave = createAutosave({
    storage,
    getState: () => cur().state,
    now: () => Date.now(),
    // Only a tab that has ENTERED a session (Continue or New Realm) ever writes: a tab idling on the title, booted from a save, must not overwrite the progress of
    // the tab being played.
    canSave: () => sessionStarted,
    // another tab wrote a newer save: this tab stops saving for good and says so, persistently
    onConflict: () => showTabBanner(),
    // saving failed (storage full, private mode...): said once, in words
    onFailure: () => ui.toasts.update({ type: 'warning', icon: 'flame', message: 'Couldn’t save your progress (browser storage is full or off). Use Settings > Export to keep a copy.', duration: 9000 }),
  });

  let tabBanner = null;
  function showTabBanner() {
    if (tabBanner) return;
    tabBanner = h('div.tab-banner', { role: 'alert' },
      h('span', {}, 'Hex Dominion is open in another tab, so this tab has stopped saving. Reload here to continue from the newest save.'),
      h('button.btn.btn-primary', { onClick: () => window.location.reload() }, 'Reload'));
    uiRoot.appendChild(tabBanner);
  }

  // --- UI: every panel built once, mounted hidden, toggled by scenes -------------
  let titleScene;
  let worldScene;
  let battleScene;
  // A scene that throws while it is entered is closed and the previous one comes back, with a word about it (scenes/flow.js).
  const sceneManager = createSceneManager({
    onError: (err, name) => {
      console.error(`[scene] could not enter ${name}:`, err);
      const message = (err && err.userMessage) || (name === 'battle' ? 'Couldn’t start that battle.' : 'Something went wrong; back to where you were.');
      try { ui.toasts.update({ type: 'warning', icon: 'flame', message, duration: 5200 }); } catch { /* the UI is not up yet */ }
    },
  });
  // Every scene change goes through here, so the score follows: it crossfades on the next bar line.
  // A leader banner is placed under the chrome of the scene it spoke in, so it never outlives a scene change.
  const goto = {
    title: (payload) => { ui.leaderBanner.hide(); music.setScene('title'); sceneManager.goto('title', titleScene, payload); },
    world: (payload) => { ui.leaderBanner.hide(); music.setScene('world'); sceneManager.goto('world', worldScene, payload); },
    battle: (payload) => {
      ui.leaderBanner.hide();
      // the map's celebrations (a Deed, a fulfilled contract, a Trophy) leave as a battle opens: their close buttons would sit over the field (PLAN-PHASE4)
      for (const n of ui.toasts.el.querySelectorAll('.toast.is-deed, .toast.is-sealed')) ui.toasts.dismissId(n.dataset.id);
      music.setScene('battle');
      sceneManager.goto('battle', battleScene, payload);
    },
  };
  const tutorial = createTutorialController({ getState: () => cur().state });

  function closeSettings() {
    ui.settings.el.hidden = true;
  }
  function openSettings() {
    const s = cur().state.settings;
    ui.settings.update({
      sound: s.sound, reduceMotion: s.reduceMotion, hints: s.hints, slowBattles: !!s.slowBattles, leaderVoices: s.leaderVoices !== false,
      music: s.music !== false, musicVolume: s.musicVolume ?? 0.4, sfxVolume: s.sfxVolume ?? 1,
    });
    ui.settings.el.hidden = false;
  }

  const ui = {
    title: createTitle({
      onContinue: () => titleScene.onContinue(),
      onNewRealm: () => titleScene.onNewRealm(),
      onSettings: () => openSettings(),
    }),
    hud: createHud({
      onCouncil: () => worldScene.onCouncilOpen(),
      onRealm: () => worldScene.onRealmOpen(),
      onRegions: () => worldScene.onRegionsOpen(),
      onGenerals: () => worldScene.onGeneralsOpen(),
      onSettings: () => openSettings(),
      onEventReopen: () => { services.events.reopen(); worldScene.updateHudNow?.(); },
      onBoonReopen: () => { services.boons.openPending(); worldScene.updateHudNow?.(); },
    }),
    regionCard: createRegionCard({
      crownTexts: CROWN_TEXTS,
      onAttack: (id) => worldScene.onAttack(id),
      onSurrender: (id) => worldScene.onSurrender(id),
      onScout: (id) => worldScene.onScout(id),
      onSabotage: (id) => worldScene.onSabotage(id),
      onBuildWork: (id, slot, type) => worldScene.onBuildWork(id, slot, type),
      onUpgradeWork: (id, slot) => worldScene.onUpgradeWork(id, slot),
      onDemolishWork: (id, slot) => worldScene.onDemolishWork(id, slot),
      onBuildFort: (id, slot, type) => worldScene.onBuildFort(id, slot, type),
      onCommander: (id, g) => worldScene.onCommander(id, g),
      onFestival: (id) => worldScene.onFestival(id),
      onMuster: (id) => worldScene.onMuster(id),
      onQuick: (id) => worldScene.onQuickConquest(id),
      onThreat: (id) => {
        const run = services.battles.list().find((r) => r.regionId === id);
        if (run) { switchToBattle(run.id); return; }
        const raid = ((cur().state.frontier && cur().state.frontier.incoming) || []).find((r) => r.toRegionId === id);
        if (raid) services.frontier.go(raid.id);
      },
      onUpgradeFort: (id, slot) => worldScene.onUpgradeFort(id, slot),
      onDemolishFort: (id, slot) => worldScene.onDemolishFort(id, slot),
    }),
    council: createCouncil({
      onBuy: (id) => worldScene.onBuy(id),
      onBuyMax: (id) => worldScene.onBuyMax(id),
      onClose: () => worldScene.onCouncilClose(),
    }),
    realm: createRealm({
      onFoundDynasty: () => worldScene.onFoundDynasty(),
      onSaveMap: () => worldScene.onSaveMap(),
      onClose: () => worldScene.onRealmClose(),
      onBuyLegacy: (id) => worldScene.onBuyLegacy(id, 'realm'),
      onOpenDraft: () => services.boons.openPending(),
    }),
    // Phase 7 (PLAN-PHASE7): the Boon draft, the Duo reveal and the Relic claim moment (app/boons.js drives all three)
    boonDraft: createBoonDraft({
      onPick: (id) => services.boons.onPick(id),
      onReroll: () => services.boons.onReroll(),
      onLater: () => services.boons.onLater(),
    }),
    duoReveal: createDuoReveal({ onDone: () => services.boons.onDuoDone() }),
    relicClaim: createRelicClaim({ onDone: () => services.boons.onClaimDone() }),
    // Phase 5 (PLAN-PHASE5): the founding ceremony that replaced the old confirm, and Quick Conquest's short overlay
    ceremony: createCeremony({
      onBuyLegacy: (id) => worldScene.onBuyLegacy(id, 'ceremony'),
      onFound: (choice) => worldScene.onCeremonyFound(choice),
      onClose: () => worldScene.onCeremonyClose(),
      onSaveMap: () => worldScene.onSaveMap(),
      onPage: (pageId) => worldScene.onCeremonyPage(pageId),
      onPick: () => worldScene.onEdictPicked(),
    }),
    quick: createQuickOverlay(),
    regions: createRegionsPanel({
      onSelect: (id) => worldScene.onRegionsSelect(id),
      onReroll: (slot) => worldScene.onReroll(slot),
      onClose: () => worldScene.onRegionsClose(),
    }),
    welcome: createWelcome({ onCollect: () => worldScene.onWelcomeCollect() }),
    battleHud: createBattleHud({
      onSendFraction: (f) => battleScene.onSendFraction(f),
      onAuto: () => battleScene.onAuto(),
      onPower: (id) => battleScene.onPower(id),
      onPauseToggle: () => battleScene.onPauseToggle(),
      onSpeed: (s) => battleScene.onSpeed(s),
      onRetreat: () => battleScene.onRetreat(),
      onMap: () => battleScene.onMap(),
      onAbility: () => battleScene.onAbility(),
    }),
    results: createResults({
      crownTexts: CROWN_TEXTS,
      onContinue: () => battleScene.onResultsContinue(),
      onRetry: () => battleScene.onRetry(),
      onBackToMap: () => battleScene.onBackToMap(),
      // One rising sparkle per crown as the victory card awards them.
      onCrown: (i) => sfx.play('upgrade', { pitch: 1 + i * 0.16, volume: 0.6 }),
    }),
    settings: createSettings({
      onToggleSound: (v) => { cur().state.settings.sound = v; sfx.setMuted(!v); autosave.save(); },
      onToggleReduceMotion: (v) => {
        cur().state.settings.reduceMotion = v;
        cur().state.settings.reduceMotionSet = true; // the player's own choice from now on
        applySettings(cur().state);
        autosave.save();
      },
      onToggleHints: (v) => { cur().state.settings.hints = v; autosave.save(); },
      // Slow battles: the speed button also offers 0.5x. Turned off while the battle is at 0.5x, the next press goes to 1x (ui/battleHud.js cycle).
      onToggleSlowBattles: (v) => {
        const st = cur().state.settings;
        st.slowBattles = v;
        if (!v && st.speed === 0.5) st.speed = 1;
        autosave.save();
      },
      // "Replay tutorial": every step unseen again, hints on, back to the map with a word about it
      onReplayTutorial: () => {
        tutorial.replay();
        ui.settings.update({ hints: true });
        autosave.save();
        closeSettings();
        ui.toasts.update({ id: 'tutorial-replay', type: 'info', icon: 'star', message: 'Tutorial restarted. Hints will guide you again.' });
      },
      onToggleMusic: (v) => { cur().state.settings.music = v; applyMusicSettings(cur().state); autosave.save(); },
      onMusicVolume: (v, final) => {
        cur().state.settings.musicVolume = v;
        applyMusicSettings(cur().state);
        if (final) autosave.save();
      },
      onSfxVolume: (v, final) => {
        cur().state.settings.sfxVolume = v;
        sfx.setEffectsLevel(v);
        if (final) { sfx.play('click'); autosave.save(); } // let go of the slider: a sample, so the level can be heard
      },
      onToggleLeaderVoices: (v) => {
        cur().state.settings.leaderVoices = v;
        if (!v) ui.leaderBanner.hide();
        autosave.save();
      },
      onExport: () => exportCode(cur().state),
      onImport: (code) => {
        const parsed = importCode(code);
        if (!parsed) return false;
        if (!container.replaceState(parsed)) return false;
        sessionStarted = true;
        applyWorld();
        autosave.save();
        closeSettings();
        goto.world({ freshRealm: true, imported: true });
        return true;
      },
      onCodex: () => openCodex(),
      onReset: () => {
        try { storage.removeItem(SAVE_KEY); } catch { /* ignore */ }
        sessionStarted = false;
        container.newRealm(undefined, { keepGenerals: false }); // Reset wipes everything, the Generals too
        applyWorld();
        closeSettings();
        goto.title({});
      },
      onClose: () => closeSettings(),
    }),
    // The coach is placed at the END of every frame (selfTick: false), against the frame's final camera, and keeps off these panels.
    coach: createCoach({
      onDismiss: () => tutorial.dismiss(),
      selfTick: false,
      obstacles: () => [
        ui.hud.el, ui.hud.el.hidden ? null : ui.hud.tabsEl, ui.regionCard.dock, ui.council.el, ui.realm.el, ui.regions.el, ui.generals.el, ui.settings.el, ui.welcome.el, ui.results.el,
        ui.tray.el.hidden ? null : ui.tray.el,
        // toasts slide in: their box is padded so a hint placed beside an arriving toast is still clear of it when it settles
        ui.toasts.el.children.length ? () => { const r = ui.toasts.el.getBoundingClientRect(); return { x: r.left - 8, y: r.top - 8, w: r.width + 16, h: r.height + 28, weight: 0.03 }; } : null,
        ui.leaderBanner.isShowing() ? ui.leaderBanner.el : null,
        ui.battleHud.el.hidden ? null : ui.battleHud.el.querySelector('.battle-top'),
        ui.battleHud.el.hidden ? null : ui.battleHud.el.querySelector('.battle-topright'),
        ui.battleHud.el.hidden ? null : ui.battleHud.el.querySelector('.battle-bottom'),
      ],
    }),
    // every running battle as a chip (DESIGN 10.5): switch with a click or Tab; Auto per battle
    tray: createBattleTray({
      onSelect: (id) => switchToBattle(id),
      onAuto: (id, on) => { services.battles.setAuto(id, on); updateTray(true); },
      // a new commander mid-battle (DESIGN 10.11): the passive and ability are re-folded into the running battle; an ability already used stays used
      onCommander: (id, gid) => {
        const run = services.battles.get(id);
        if (!run) return;
        assign(run, edictCommander(cur().state, gid || null), cur().state, cur().world, playerBattleStats); // Lone Banner keeps the Militia Captain
        const g = gid ? generalById(cur().state, gid) : null;
        announce(`${g ? g.name : GENERALS.copy.captainName} commands at ${cur().world.regions[run.regionId]?.name || 'the battle'}`);
        services.autosave.save();
        updateTray(true);
      },
    }),
    // the roster (DESIGN 10.11)
    generals: createGeneralsPanel({
      onTrain: (id) => worldScene.onTrain(id), onHeal: (id) => worldScene.onHeal(id), onRespec: (id) => worldScene.onRespec(id),
      onPick: (id, c) => worldScene.onPickSkill(id, c), onHire: () => worldScene.onHire(), onWatch: (id) => worldScene.onWatchGeneral(id),
      onClose: () => worldScene.onGeneralsClose(),
    }),
    toasts: createToasts(),
    tooltip: createTooltip(),
    // Rival leaders (DESIGN 3.6): a click-through banner under whatever top chrome is on screen.
    leaderBanner: createLeaderBanner({
      below: () => [
        ui.hud.el,
        ui.hud.el.hidden || !ui.hud.tabsEl.getClientRects().length ? null : ui.hud.tabsEl,
        ui.tray.el.hidden ? null : ui.tray.el,
        ui.battleHud.el.hidden ? null : ui.battleHud.el.querySelector('.battle-top'),
        ui.battleHud.el.hidden ? null : ui.battleHud.el.querySelector('.battle-topright'),
      ],
    }),
  };

  // The region card has no positioning of its own in the UI kit: it lives in a
  // dock (right column on desktop, bottom sheet on phones — see app.css).
  const cardDock = h('div.hd-dock.passthrough', {}, ui.regionCard.el);
  ui.regionCard.dock = cardDock;

  for (const key of Object.keys(ui)) {
    ui[key].el.hidden = true;
    uiRoot.appendChild(key === 'regionCard' ? cardDock : ui[key].el);
  }
  cardDock.hidden = true;
  ui.regionCard.el.hidden = false; // visibility is controlled on the dock
  ui.toasts.el.hidden = false; // toasts manage their own children
  ui.tray.el.hidden = true; // the tray shows itself (updateTray)
  ui.leaderBanner.el.hidden = false; // the banner hides itself between lines

  /** Anything queued for a realm that has since been replaced is dropped (see the container's epoch). */
  function purgeStalePending() {
    const e = container.epoch;
    if (services.pendingWelcome && services.pendingWelcome.epoch !== e) services.pendingWelcome = null;
    if (services.pendingIdlePop && services.pendingIdlePop.epoch !== e) services.pendingIdlePop = null;
    if (Array.isArray(services.pendingProsperity)) services.pendingProsperity = services.pendingProsperity.filter((u) => u.epoch === e);
  }

  /** Hides everything scene-specific (settings + toasts are global overlays). */
  function hideAllPanels() {
    ui.hud.el.hidden = true;
    cardDock.hidden = true;
    ui.council.el.hidden = true;
    ui.realm.el.hidden = true;
    ui.ceremony.el.hidden = true;
    ui.quick.el.hidden = true;
    ui.regions.el.hidden = true;
    ui.generals.el.hidden = true;
    ui.welcome.el.hidden = true;
    ui.battleHud.el.hidden = true;
    ui.results.el.hidden = true;
    ui.title.el.hidden = true;
    ui.coach.el.hidden = true;
    ui.tooltip.el.hidden = true;
  }

  // Leader voices: one gate for every scene. `speak` returns the line it showed, or null when the gate
  // (setting off, hint on screen, once per battle, 15 s gap) blocked it, so callers never need to check.
  const voice = createLeaderVoice({ getState: () => cur().state });
  function speak(trigger, factionId, regionId, scope) {
    const { world } = cur();
    const line = voice.say(trigger, {
      faction: factionId,
      region: regionId != null ? world.regions[regionId].name : undefined,
      nowSec: performance.now() / 1000, // REAL time: works on the map and ignores 2x/3x/pause
      tutorialVisible: !ui.coach.el.hidden, // never speak over a hint
      scope,
    });
    if (!line) return null;
    ui.leaderBanner.update({ ...line, faction: world.factions[line.faction] });
    return line;
  }
  // The coach wins any clash: when a hint appears, a banner that is still up leaves at once.
  //
  // Reading time: a NEW hint never appears sooner than COACH_MIN_SHOW_MS after the previous hint first appeared. A
  // player who acts at once (presses Attack 0.4 s after hint 2 showed) would otherwise see hint 3 flash up and go.
  // Nothing is blocked: only what is drawn waits; the same hint re-showing (camera moved, panel closed) is exempt.
  const COACH_MIN_SHOW_MS = 1500;
  const coachUpdate = ui.coach.update;
  let coachText = null; // the text last shown
  let coachShownAt = -1e9; // when that text FIRST became visible
  let coachPending = null;
  let coachTimer = 0;
  function coachApply(data) {
    ui.leaderBanner.hide();
    coachUpdate(data);
    if (data.text != null && data.text !== coachText) { coachText = data.text; coachShownAt = performance.now(); }
  }
  ui.coach.update = (data) => {
    if (!data || !data.visible) {
      clearTimeout(coachTimer);
      coachTimer = 0;
      coachPending = null;
      coachUpdate(data);
      return;
    }
    const wait = COACH_MIN_SHOW_MS - (performance.now() - coachShownAt);
    if (data.text == null || data.text === coachText || wait <= 0) {
      clearTimeout(coachTimer);
      coachTimer = 0;
      coachPending = null;
      coachApply(data);
      return;
    }
    coachPending = data; // the scene keeps asking for its current hint; the latest one wins
    if (!coachTimer) {
      coachTimer = setTimeout(() => {
        coachTimer = 0;
        const d = coachPending;
        coachPending = null;
        if (d) coachApply(d);
      }, wait + 20);
    }
  };

  // Phones have room for ONE thing at the top: a leader line and a toast that fire together show the leader first, and the
  // toast waits until the banner has gone (callers speak BEFORE they toast, so the banner is already up).
  // No toast over an open dialog: while one is open, toasts queue and come out after it closes (ui/toasts.js setHeld)
  onDialogChange((count) => ui.toasts.setHeld(count > 0));
  const toastUpdate = ui.toasts.update;
  const toastQueue = []; // { toast, at }
  let toastTimer = 0;
  function flushToasts() {
    if (ui.leaderBanner.isShowing()) return;
    clearInterval(toastTimer);
    toastTimer = 0;
    const now = performance.now();
    for (const q of toastQueue.splice(0)) if (now - q.at < 9000) toastUpdate(q.toast); // a stale one is no news
  }
  ui.toasts.update = (toast) => {
    // an update to a toast already on screen (a raid's countdown) changes it in place: it adds nothing, so it never waits for the banner
    const live = toast && toast.id != null && [...ui.toasts.el.children].some((n) => n.dataset.id === String(toast.id) && !n.classList.contains('is-out'));
    if (!live && renderer.cssWidth < 768 && ui.leaderBanner.isShowing()) {
      toastQueue.push({ toast, at: performance.now() });
      if (!toastTimer) toastTimer = setInterval(flushToasts, 200);
      return;
    }
    toastUpdate(toast);
    // a toast that lands while a banner is already up (a scout: the leader speaks first) slides the banner below it instead of covering it
    ui.leaderBanner.reflow();
  };

  const idleTicker = createIdleTicker({ getState: () => cur().state, getWorld: () => cur().world });

  const services = {
    camera, renderer, ui, input, container, sfx, music, tutorial, goto, speak, voice,
    hideAllPanels, openSettings, closeSettings, isPhone: () => renderer.cssWidth < 768, isTouch, isKeyboardUser,
    hasSaveOnDisk, applyWorld, autosave,
    startSession: () => { sessionStarted = true; purgeStalePending(); applySettings(cur().state); }, // a new realm may have replaced the state: its settings (Reduce Motion, mute) apply now
    version: VERSION,
    pendingWelcome,
    pendingIdlePop: null,
    pendingProsperity: bootProsperity, // level-ups waiting for the world scene to celebrate them
    devRevealAll: false,
    time: { t: 0, nowMs: 0 },
  };

  // every running battle (ARCHITECTURE 10.1): stepped each frame below, whatever scene is up; the battle scene is a view of the focused one
  services.battles = createBattleManager({ getState: () => cur().state, getWorld: () => cur().world, services });
  battlesRef = services.battles;
  onDialogChange((count) => services.battles.setDialogHold(count > 0)); // any open dialog holds every battle (DESIGN 7.5a)
  /**
   * What a finished battle (or a surrender) earned beyond gold (DESIGN 10.11, 10.12): Renown from crowns, a defense, a retake or a capital; the commander's
   * level-ups and wounds; a champion who joins when a capital falls (the recruitment card and a Chronicle line).
   */
  function onDeeds(out) {
    if (!out) return;
    const { state, world } = cur();
    if (out.kind === 'attack' && out.result && services.goals && !out.quick) services.goals.onConquest(out.regionId, out.result); // the Bounty Board (PLAN-PHASE4 §4A); a Quick Conquest's meta already told it
    const renown = (out.crownAward && out.crownAward.renown || 0) + (out.result && out.result.renown || 0) + (out.reward && out.reward.renown || 0);
    if (renown > 0) ui.toasts.update({ id: 'renown', type: 'success', icon: 'laurel', message: `+${renown} Renown`, duration: 3600 });
    const c = out.commander;
    if (c) {
      const g = generalById(state, c.id);
      if (g && c.levels > 0) ui.toasts.update({ id: `level-${c.id}`, type: 'success', icon: 'star', message: `${g.name} reaches level ${c.level}${c.picks > 0 ? ': a new skill to choose in Generals' : ''}`, duration: 5200 });
      if (g && c.wounded) ui.toasts.update({ id: `wound-${c.id}`, type: 'warning', icon: 'shield', message: `${g.name} is wounded and rests for a while (Renown heals at once)`, duration: 5200 });
      if (c.levels > 0) tutorial.notify('generalLevelUp');
    }
    // Phase 7: after a watched win the post-battle moments go one at a time (app/boons.js: Relic claim -> recruit -> Boon draft); otherwise at once
    if (out.result && out.result.recruited) { const rid = out.result.recruited; if (!services.boons || !services.boons.holdMoment((done) => showRecruit(rid, out.regionId, done))) showRecruit(rid, out.regionId); }
    // a varied map (DESIGN 10.13): the Dragon slain gives the realm Dragonscale; a Duel's end goes in the Chronicle
    if (out.result && out.result.dragonscale) {
      ui.toasts.update({ id: 'dragonscale', type: 'success', icon: 'shield', message: `The Dragon is slain! ${MAP_FEATURES.copy.dragonscale}`, duration: 7000 });
      try { recordChronicle(state, { kind: 'event', t: Date.now(), hl: true, data: { text: `The Dragon of ${world.regions[out.regionId]?.name || 'the Lair'} fell. Its scales now armour the realm's fortifications.`, regionId: out.regionId } }); } catch (err) { console.warn('[chronicle] dragon line skipped:', err); }
    }
    if (out.kind === 'duel') {
      const f = world.factions[out.attackerFaction];
      try { recordChronicle(state, { kind: 'event', t: Date.now(), data: { text: out.won ? `Your champion won the duel at ${world.regions[out.regionId]?.name || 'the border'} against the ${f ? f.name : 'rivals'}.` : `The duel at ${world.regions[out.regionId]?.name || 'the border'} went to the ${f ? f.name : 'rivals'}.`, regionId: out.regionId } }); } catch (err) { console.warn('[chronicle] duel line skipped:', err); }
    }
    if (sceneManager.name === 'world') worldScene.updateGenerals?.();
  }
  services.onDeeds = onDeeds;
  services.battles.on('finished', (id, out) => onDeeds(out)); // every finished battle, watched or not (surrenders call onDeeds themselves)
  // Phase 7: Plunderers' gold and Fortune Favours' price, said once per battle (meta/boons.js boonBattleEnd, applied by the battle manager)
  services.battles.on('finished', (id, out, snapshot) => {
    const bb = snapshot && snapshot.boons;
    if (!bb) return;
    if (bb.plunder > 0) ui.toasts.update({ id: 'boon-plunder', type: 'success', icon: 'boonSack', message: `Plunderers: +${shortNumber(bb.plunder)} gold`, duration: 3600 });
    if (bb.goldLost > 0) ui.toasts.update({ id: 'boon-fortune', type: 'warning', icon: 'boonDice', message: `Fortune Favours: the loss cost ${shortNumber(bb.goldLost)} gold`, duration: 5200 });
  });

  /** "Gorran Redhand, the Crimson Champion, joins your cause": a short card with the champion's line, and a Chronicle entry. */
  function showRecruit(id, regionId, onClosed) {
    const { state, world } = cur();
    const g = generalById(state, id);
    if (!g) { onClosed?.(); return; }
    let closed = false;
    const close = () => { modal.destroy(); if (!closed) { closed = true; onClosed?.(); } };
    const kind = GENERALS.kinds[g.kind] || {};
    const factionId = Number(String(id).split(':')[1]);
    const faction = world.factions[factionId];
    const word = faction ? faction.name.split(' ')[0] : '';
    const title = `the ${word} ${kind.title || 'Champion'}`.replace(/\s+/g, ' ');
    const lines = GENERALS.copy.recruitLines || {};
    const line = lines[g.kind] || lines.other || '';
    try {
      recordChronicle(state, { kind: 'recruit', t: Date.now(), data: { text: `${g.name}, ${title}, joins your cause after the fall of ${world.regions[regionId]?.name || 'their capital'}.`, regionId } });
    } catch (err) { console.warn('[chronicle] recruit line skipped:', err); }
    const modal = createModal({
      title: `${g.name} joins your cause`,
      body: h('div.recruit-card', {},
        generalEmblem(g.kind, 64),
        h('p.recruit-title', {}, `${g.name}, ${title}`),
        h('p.recruit-line', {}, `"${line}"`),
        h('p.recruit-what', {}, `${kind.title || 'Champion'} · ${GENERALS.copy.styleNames[g.style] || ''} · Ability: ${GENERALS.copy.abilityNames[(kind.ability) || ''] || ''}`)),
      actions: [{ label: 'Welcome', variant: 'primary', onClick: () => close() }],
    }, { onDismiss: () => close() });
    modal.el.classList.add('is-recruit');
    document.body.appendChild(modal.el);
    sfx.play('victory', { volume: 0.5 });
  }

  // a battle nobody was watching has ended (its commander fought it): say so, and the map shows a conquest where it happened
  services.battles.on('remoteEnded', (id, run, out) => {
    const name = cur().world.regions[run.regionId] ? cur().world.regions[run.regionId].name : 'a region';
    const won = run.result === 'win';
    const msg = run.kind === 'duel'
      ? (won ? `Your champion won the duel at ${name}: +${out && out.renown ? out.renown : 0} Renown.` : `The duel at ${name} is lost. Nothing is lost with it.`)
      : run.kind === 'defense'
      ? (won ? `${name} held: the attackers are beaten.` : `${name} has fallen.`)
      : (won ? `${name} is yours: your commander won the battle.` : `The attack on ${name} failed.`);
    ui.toasts.update({ type: won ? 'success' : 'warning', icon: won ? 'crown' : 'flag', message: msg, duration: 5200 });
    if (won && out && out.kind !== 'duel') worldScene.onRemoteConquest(out);
    updateTray(true);
  });

  /** Watch a running battle: in a battle the view switches (a camera flight); from the map the battle scene opens on it. */
  function switchToBattle(id) {
    if (!services.battles.get(id)) return;
    if (sceneManager.name === 'battle') battleScene.switchTo(id);
    else if (sceneManager.name === 'world') goto.battle({ runId: id });
  }
  services.switchToBattle = switchToBattle;
  /** Shows a region on the map (an incoming raid's Go): flies there and opens its card, when the map is up. */
  services.focusRegion = (id) => {
    if (sceneManager.name !== 'world') return;
    worldScene.devFlyToRegion(id, undefined, 650);
    worldScene.selectRegion(id);
  };
  // the Living Frontier (DESIGN 10.1): raids on active play time, the incoming toast with Go, the defense on arrival
  services.frontier = createFrontierLoop({
    getState: () => cur().state, getWorld: () => cur().world, manager: services.battles, ui, services,
    isActive: () => sessionStarted && (sceneManager.name === 'world' || sceneManager.name === 'battle') && !document.hidden
      && !services.battles.paused && !document.documentElement.hasAttribute('data-dialog'),
  });
  frontierRef = services.frontier;
  // world events (DESIGN 10.13): the Merchant, the Plague, the Duel, offered on the same active clock (never in the very first battle)
  services.events = createEventsLoop({
    getState: () => cur().state, getWorld: () => cur().world, manager: services.battles, ui, services,
    isActive: () => sessionStarted && (sceneManager.name === 'world' || sceneManager.name === 'battle') && !document.hidden
      && !services.battles.paused && !document.documentElement.hasAttribute('data-dialog'),
    inTutorial: () => (cur().state.stats.battlesWon || 0) < 1,
  });

  // Phase 4, Goals and Rivals (docs/PLAN-PHASE4.md): the streak's window, deeds, the Bounty Board, grudges and Vendettas
  services.goals = createGoals({ getState: () => cur().state, getWorld: () => cur().world, ui, services });
  // Phase 5 (docs/PLAN-PHASE5.md): Edicts, Legacy, Challenges, Quick Conquest
  services.starText = dynastyStarText;
  services.dynasty = createDynasty({ getState: () => cur().state, getWorld: () => cur().world, container, ui, services });
  services.boons = createBoons({ getState: () => cur().state, getWorld: () => cur().world, ui, services, sfx, tutorial });
  services.onBoonsChanged = () => { if (sceneManager.name === 'world') { worldScene.updateHudNow?.(); worldScene.refreshRealmIfOpen?.(); } };
  services.quick = createQuickConquest({ getState: () => cur().state, getWorld: () => cur().world, ui, services });
  services.onQuickReady = () => { if (sceneManager.name === 'world') worldScene.devRefreshCard(); };
  services.sceneName = () => sceneManager.name;
  services.onGoalsChanged = (opts) => { if (sceneManager.name === 'world') worldScene.onGoalsChanged?.(opts); };
  services.battles.on('finished', (id, out, snapshot) => services.goals.onFinished(snapshot, out));
  prosperityHook = (ups) => services.goals.onProsperity(ups);

  /** A run's commander for its chip: the name, and the choices (free Generals + this one + the Militia Captain). */
  function trayCommander(r) {
    const { state } = cur();
    const g = r.commander ? generalById(state, r.commander) : null;
    const free = edictMods(state).forceCaptain ? [] : freeGenerals(state, Date.now()); // Lone Banner: only the Captain
    const options = [...(g ? [g] : []), ...free.filter((x) => !g || x.id !== g.id)].map((x) => ({ id: x.id, label: x.name.split(' ').slice(-1)[0] }));
    options.push({ id: '', label: 'Captain' });
    return { commanderId: g ? g.id : '', commanderName: g ? g.name : GENERALS.copy.captainName, commanderOptions: options };
  }

  /** The tray's view data, a few times a second: every run, its share of the troops, its clock, a threatened settlement of ours. */
  let trayAtMs = -1e9;
  function updateTray(force = false) {
    const nowMs = performance.now();
    if (!force && nowMs - trayAtMs < 250) return;
    trayAtMs = nowMs;
    const runs = services.battles.list();
    const scene = sceneManager.name;
    const visible = (scene === 'world' && runs.length >= 1) || (scene === 'battle' && runs.length >= 2);
    const { world } = cur();
    const focusedId = services.battles.focusedId;
    ui.tray.update({
      visible,
      runs: runs.map((r) => {
        const b = r.battle;
        let mine = 0;
        let total = 0;
        for (const site of b.sites) { total += site.troops; if (site.owner === PLAYER_OWNER) mine += site.troops; }
        for (const q of b.squads) { total += q.count; if (q.owner === PLAYER_OWNER) mine += q.count; }
        // a settlement of ours that the marching enemy outnumbers
        const incoming = new Map();
        for (const q of b.squads) if (q.owner !== PLAYER_OWNER && q.state === 'march') incoming.set(q.to, (incoming.get(q.to) || 0) + q.count);
        const threatened = b.sites.some((site) => site.owner === PLAYER_OWNER && (incoming.get(site.id) || 0) > site.troops);
        const sec = Math.max(0, Math.floor(b.t));
        return {
          id: r.id, kind: r.kind, regionName: world.regions[r.regionId] ? world.regions[r.regionId].name : 'a region',
          share: total > 0 ? mine / total : 0, clock: `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`,
          threatened, focused: scene === 'battle' && r.id === focusedId, auto: !!r.auto, autoLabel: 'Delegate',
          ...trayCommander(r),
        };
      }),
    });
  }

  // --- the Codex (PLAN-PHASE8 §8B) ---------------------------------------------------------------------------------------------------------
  // Loaded on first use (import(): nothing of it is in the boot graph). Settings > Codex opens it at its first page, a panel's "?" at that panel's topic.
  // "Revisit the tutorial hints" clears the seen hints (and remembers them, so turning it off again restores them).
  let codex = null;
  let codexLoading = null;
  let revisitSnapshot = null; // { seen, done } before the hints were reset this session
  async function loadCodex() {
    if (codex) return codex;
    if (!codexLoading) {
      codexLoading = Promise.all([import('./ui/codex.js'), import('./app/codexTopics.js')]).then(([ui0, topics]) => {
        codex = { ui: ui0.createCodex({ onClose: () => {}, onRevisitHints: (on) => revisitHints(on) }), topics };
        document.body.appendChild(codex.ui.el);
        return codex;
      });
    }
    return codexLoading;
  }
  async function openCodex(topicId) {
    try {
      const c = await loadCodex();
      c.ui.open(c.topics.codexData(cur().state), topicId, { revisit: !!revisitSnapshot });
      tutorial.notify('codexOpened');
    } catch (err) {
      console.warn('[codex] could not open:', err);
      ui.toasts.update({ type: 'warning', icon: 'scroll', message: 'The Codex could not be opened (offline?).', duration: 4000 });
    }
  }
  function revisitHints(on) {
    const st = cur().state;
    if (on) {
      if (!revisitSnapshot) revisitSnapshot = { seen: { ...(st.tutorial.seen || {}) }, done: !!st.tutorial.done };
      tutorial.replay();
      ui.settings.update({ hints: true });
    } else {
      const snap = revisitSnapshot;
      revisitSnapshot = null;
      const seen = { ...(snap ? snap.seen : {}), ...(st.tutorial.seen || {}) };
      st.tutorial = { seen, done: snap ? snap.done : st.tutorial.done };
    }
    autosave.save();
  }
  services.openCodex = openCodex;
  // the "?" in every panel's header
  const PANEL_HELP = [
    [ui.council.el, '.council-header', '.council-close', 'council', 'the War Council'],
    [ui.realm.el, '.realm-header', '.realm-close', 'income', 'your realm'],
    [ui.regions.el, '.regions-header', '.regions-close', 'bounties', 'the Bounty Board'],
    [ui.generals.el, '.generals-header', '.generals-close', 'generals', 'Generals'],
    [ui.boonDraft.el, '.boon-draft-head', null, 'boons', 'Boons'],
    [ui.ceremony.el, '.ceremony-header', null, 'founding', 'founding a dynasty'],
  ];
  for (const [root, hs, cs, topic, label] of PANEL_HELP) {
    const header = root && root.querySelector(hs);
    if (!header) continue;
    const close = cs ? header.querySelector(cs) : header.querySelector(':scope > button:last-child');
    addHelpButton(header, close, label, () => openCodex(topic));
  }

  titleScene = createTitleScene(services);
  worldScene = createWorldScene(services);
  battleScene = createBattleScene(services);

  // --- dev hooks (?dev=1 only: DESIGN §8) ---------------------------------------
  let devSpeedX8 = false;
  let qualityLock = null; // dev: pin the ambient quality (the adaptive rule would thin it on a software rasteriser)
  // metaMs: the realm's own per-frame work (autosave, idle income, prosperity, the frontier, events, goals, Boons), timed apart from the battles and the scene
  // (tools/perf.mjs reads it; PLAN-PHASE8 8A budget: under 2 ms on average at 4x CPU slowdown in a late Dynasty II)
  const perf = { cpuMs: 0, frameMs: 16.7, worstMs: 0, metaMs: 0, battleMs: 0 };
  const acc = { n: 0, cpu: 0, cpuMax: 0, dt: 0, dtMax: 0, meta: 0, metaMax: 0 };
  if (isDev) {
    const devCtx = {
      get state() { return cur().state; },
      get world() { return cur().world; },
      get camera() { return camera; },
      get renderer() { return renderer; },
      get music() { return music; },
      get scene() { return sceneManager.name; },
      get frameMs() { return perf.frameMs; },
      get cpuMs() { return perf.cpuMs; },
      perf,
      services,
      goto,
      selectRegion: (id) => worldScene.selectRegion(id),
      startBattle: (id) => worldScene.onAttack(id),
      winBattle: () => battleScene.forceWin(),
      loseBattle: () => battleScene.forceLose(),
      screenPosOfSite: (id) => battleScene.screenPosOfSite(id),
      siteInfo: () => battleScene.siteInfo(),
      featureInfo: () => battleScene.featureInfo(),
      ashenInfo: () => battleScene.ashenInfo(), // Phase 6: rises, burns, Risings, wisps
      boonFxInfo: () => battleScene.boonInfo(), // Phase 7: boonTriggered counts, pops, Scorched Earth ground
      afterFrame,
      tutorialArrow: () => battleScene.tutorialArrow(),
      dragInfo: () => battleScene.dragInfo(),
      siteCursor: () => battleScene.siteCursorId(),
      mapCursor: () => worldScene.devMapCursor(),
      supplyInfo: () => battleScene.supplyInfo(),
      stuckHint: () => battleScene.stuckHint(),
      selection: () => battleScene.selection(),
      threatInfo: () => battleScene.threatInfo(),
      get battle() { return battleScene.battle; },
      get battles() { return services.battles; }, // the battle manager (app/battles.js): list(), get(id), focusedId, busy()
      /** Dev/checks: a war band against one of your regions now (app/frontierLoop.js devRaid). */
      raid: (toRegionId, opts) => services.frontier.devRaid(toRegionId, opts),
      get frontier() { return services.frontier; },
      /** Dev/checks: offer a world event of this kind now (app/eventsLoop.js devOffer); answer it with events.answer(id, 'accept'|'decline'). */
      offerEvent: (kind) => services.events.devOffer(kind),
      get events() { return services.events; },
      /** Dev/checks (Phase 4): `faction` (default: the first rival bordering you) swears a Vendetta now, arriving in `opts.sec` active seconds. */
      vendetta: (faction, opts) => services.frontier.devVendetta(faction, opts),
      /** Dev/checks (Phase 4): a contract of this kind on the Bounty Board now (app/goals.js devBounty): { slot, contract } or null. */
      bounty: (kind) => services.goals.devBounty(kind),
      get goals() { return services.goals; },
      /** Dev/checks (Phase 5): own every region at once (the founding button shows), then the world refreshes. */
      completeRealm: () => worldScene.devCompleteRealm(),
      get dynasty() { return services.dynasty; },
      /** Dev/checks (Phase 7): app/boons.js; an offer now (`offerBoons(['engineers', ...])` or `offerBoons('champion')`), Boons owned at once, a Relic placed. */
      get boons() { return services.boons; },
      offerBoons: (choices, source) => services.boons.devOffer(choices, source),
      grantBoons: (ids) => services.boons.devGrant(ids),
      placeRelic: (regionId, relicId) => { const p = services.boons.devPlaceRelic(regionId, relicId); worldScene.markDirtyNow?.(); return p; },
      /** Dev/checks (Phase 5): grant Legacy points (for the Realm panel's tree). */
      grantLegacy: (n) => { const l = services.dynasty.devGrant(n); worldScene.onGoalsChanged?.(); return l; },
      get battlePhase() { return battleScene.phase; },
      regionScreenPos: (id) => worldScene.regionScreenPos(id),
      regionHintBox: (id) => worldScene.regionHintBoxOf(id),
      hintOutline: () => worldScene.devHintOutline(),
      hintFacts: () => worldScene.devHintFacts(), // the facts the world's tutorial rules read (debugging)
      conquerRegions: (n) => worldScene.devConquer(n),
      conquerRegion: (id, opts) => worldScene.devConquerRegion(id, opts),
      surrender: (id) => worldScene.devSurrender(id),
      refreshCard: () => worldScene.devRefreshCard(),
      flyToRegion: (id, zoom, ms) => worldScene.devFlyToRegion(id, zoom, ms),
      openCouncil: () => worldScene.onCouncilOpen(),
      openSettings,
      grantGold: (amount) => { cur().state.gold += amount; },
      revealMap: () => { services.devRevealAll = true; },
      setSpeedX8: (on) => { devSpeedX8 = on; },
      /** Pins the ambient quality (0..1); null hands it back to the adaptive rule. */
      lockAmbientQuality: (q) => { qualityLock = q; if (q != null) renderer.ambient.setQuality(q); },
      /** Moves every player-held region's conquest time back `hours`, then runs the prosperity clock once. */
      advanceTenure: (hours) => {
        const { state, world } = cur();
        for (let i = 0; i < state.conqueredAt.length; i++) {
          if (state.owner[i] === PLAYER_FACTION && state.conqueredAt[i] != null) state.conqueredAt[i] -= hours * 3600 * 1000;
        }
        const ups = runProsperity(state, world, Date.now());
        services.pendingProsperity.push(...ups.map((u) => ({ ...u, epoch: container.epoch })));
        return ups.length;
      },
      reseed: (seed) => {
        container.reseed(seed);
        sessionStarted = true;
        applyWorld();
        goto.world({ freshRealm: true });
      },
      startNewRealm: () => titleScene.onNewRealm(),
      /** Dev/perf (Phase 8): founds the next dynasty at once on `seed` (no ceremony), then enters its continent. */
      foundDynasty: (choice = {}) => {
        const res = container.tryFoundDynasty({ seed: choice.seed ?? container.nextSeed(), edict: choice.edict ?? null, challenges: choice.challenges || [] });
        if (!res) return false;
        sessionStarted = true;
        applyWorld();
        goto.world({ freshRealm: true, newWorld: true });
        return true;
      },
      hideUI: (on = true) => { uiRoot.style.visibility = on ? 'hidden' : ''; },
      hideDev: (on = true) => {
        for (const el of uiRoot.querySelectorAll('.devpanel, .hd-perf')) el.style.display = on ? 'none' : '';
      },
      /** Averages CPU ms per frame and the real rAF interval over `ms`. */
      perfSample: (ms = 2000) => new Promise((resolve) => {
        acc.n = 0; acc.cpu = 0; acc.cpuMax = 0; acc.dt = 0; acc.dtMax = 0; acc.meta = 0; acc.metaMax = 0;
        setTimeout(() => resolve({
          frames: acc.n,
          cpuAvgMs: +(acc.cpu / Math.max(1, acc.n)).toFixed(2),
          cpuMaxMs: +acc.cpuMax.toFixed(2),
          frameAvgMs: +(acc.dt / Math.max(1, acc.n)).toFixed(2),
          frameMaxMs: +acc.dtMax.toFixed(2),
          metaAvgMs: +(acc.meta / Math.max(1, acc.n)).toFixed(3),
          metaMaxMs: +acc.metaMax.toFixed(2),
        }), ms);
      }),
    };
    installDevHooks(devCtx);
    const devPanel = createDevPanel({
      onGrantGold: devCtx.grantGold,
      onRevealMap: devCtx.revealMap,
      onWinBattle: devCtx.winBattle,
      onLoseBattle: devCtx.loseBattle,
      onSpeedX8: devCtx.setSpeedX8,
      onReseed: devCtx.reseed,
    });
    uiRoot.appendChild(devPanel.el);
    services.devOverlayEl = h('div.hd-perf', {}, '');
    uiRoot.appendChild(services.devOverlayEl);
  }

  // --- resize / lifecycle --------------------------------------------------------
  window.addEventListener('resize', () => {
    doResize();
    worldScene.onResize?.();
    titleScene.onResize?.();
    battleScene.onResize?.();
  });

  let bootRemoved = false;
  function removeBootSplash() {
    if (bootRemoved) return;
    bootRemoved = true;
    try { performance.mark('hd-first-frame'); } catch { /* ignore */ }
    const boot0 = document.getElementById('boot');
    if (!boot0) return;
    boot0.classList.add('gone');
    setTimeout(() => boot0.remove(), BOOT.fadeMs + 80);
  }

  autosave.attachLifecycleHooks();
  // A hidden tab stops the score's scheduler and mutes its bus (it resumes on the same bar grid).
  // Touch has no hover: what lives only in a title tooltip (a scouted chip's garrison, a crown medal's rule, the prosperity bonus...) appears in a toast when it is tapped.
  // Buttons keep doing what they do; only plain titled things (chips, labels, medals) explain themselves.
  uiRoot.addEventListener('click', (e) => {
    if (!isTouch() || !e.target || !e.target.closest) return;
    const t = e.target.closest('[title]');
    if (!t || t.closest('button, a, input, select, textarea, [role="button"], [role="switch"]')) return;
    const text = t.getAttribute('title');
    if (text) ui.toasts.update({ id: 'title-info', type: 'info', icon: 'bell', message: text, duration: 4500 });
  }, true);

  // A mouse or touch press must not leave focus on the button it pressed: Space is the pause key, and with focus still on "Speed" it pressed Speed again (the speed
  // cycled instead of pausing). Keyboard activation (click.detail is 0) keeps focus: a keyboard player's focus ring stays where they put it (:focus-visible).
  document.addEventListener('click', (e) => {
    if (e.detail === 0 || !e.target || !e.target.closest) return;
    const b = e.target.closest('button, [role="button"], summary');
    if (b && document.activeElement === b) b.blur();
  });
  // M mutes and unmutes the sound from anywhere (not while typing, and not inside a dialog): it says so, in a toast a screen reader announces too
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyM' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (document.documentElement.dataset.dialog) return;
    const st = cur().state.settings;
    st.sound = !st.sound;
    sfx.setMuted(!st.sound);
    ui.settings.update({ sound: st.sound });
    ui.toasts.update({ id: 'sound-toggle', type: 'info', icon: st.sound ? 'sound-on' : 'sound-off', message: st.sound ? 'Sound on' : 'Sound off: press M to turn it back on', duration: 2200 });
    autosave.save();
  });
  document.addEventListener('visibilitychange', () => music.setPaused(document.hidden));
  window.addEventListener('pagehide', () => music.setPaused(true));
  window.addEventListener('pageshow', () => music.setPaused(document.hidden));
  // pagehide already covers bfcache navigations; this covers a hard close.
  window.addEventListener('beforeunload', () => autosave.save());

  // Coming back to a tab that rAF had paused: credit the wall-clock gap once.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    // an untouched realm shown behind the title is not being played: nothing was earned there while the tab was away
    if (!sessionStarted) return;
    const { state, world } = cur();
    if (!(state.lastSeen > 0)) state.lastSeen = Date.now();
    const awaySec = Math.max(0, (Date.now() - state.lastSeen) / 1000);
    const off = offlineEarnings(state, world, Date.now()); // paid with the levels at departure
    const ups = runProsperity(state, world, Date.now()); // levels gained while away, reported once
    const away = awayReport(state, world, awaySec);
    if ((off.seconds >= WORLD_SCENE.welcomeBackMinSec && off.gold > 0.05) || away) {
      const w = {
        timeAwaySec: awaySec, goldEarned: off.gold, prospered: prosperedList(world, ups),
        capHours: offlineCapHours(state), capped: awaySec > off.seconds + 1, epoch: container.epoch,
        away: away ? away.text : '', awayLoss: !!(away && away.lost),
      };
      if (sceneManager.name === 'world') worldScene.showWelcome(w);
      else services.pendingWelcome = w;
    } else if (ups.length) {
      services.pendingProsperity.push(...ups.map((u) => ({ ...u, epoch: container.epoch })));
    }
  });

  applyWorld();
  mark('hd-baked');
  goto.title({});

  // --- frame loop (ARCHITECTURE §9) ---------------------------------------------
  const clock = createClock();
  let tAccum = 0;
  let lastNowMs = 0;
  let errorLogAt = 0;
  let lastProsperityMs = 0;
  let qualityAtMs = 0;

  // Layout flags on #ui for the CSS (Phase 8 perf): the panels used to be placed by `#ui:has(...)` rules, and ANY change inside #ui (the gold counter, a
  // badge) made the browser re-match them and restyle the toasts, the tray and the leader banner every frame. These attributes carry the same facts and are
  // written only when one changes; the rules keep their old specificity (one attribute per selector part they replaced).
  const uiFlags = {};
  const setFlag = (name, on) => { if (uiFlags[name] === on) return; uiFlags[name] = on; uiRoot.toggleAttribute(`data-${name}`, on); };
  function syncUiFlags() {
    const hudOn = !ui.hud.el.hidden;
    setFlag('hud', hudOn);
    setFlag('battle', !ui.battleHud.el.hidden);
    setFlag('tray', !ui.tray.el.hidden);
    const tabs = ui.hud.tabsEl;
    let tabOn = false;
    if (hudOn && tabs) for (const c of tabs.children) if (!c.hidden) { tabOn = true; break; }
    setFlag('tabs', tabOn);
    const toasts = ui.toasts.el;
    const anyToast = !!toasts.querySelector(':scope > .toast');
    setFlag('toast', anyToast);
    setFlag('event-toast', anyToast && !!toasts.querySelector('.toast.is-event'));
    setFlag('banner-in', ui.leaderBanner.el.dataset.state === 'in');
    layoutTopLane();
  }
  // The top lane (2026-10-04, lead): every top-centre notice in ONE column, each in its own slot, never overlapping. Order: the leader banner (placed
  // under the HUD / tabs / tray / battle top by its own `below` rule), then the toasts (event offers first: `.toast.is-event { order: -1 }`, then Deeds,
  // contracts, Trophies, streak and Vendetta toasts in arrival order). The toast column is pushed below the banner while the banner is on screen (fading
  // out included). A phone shows at most two notices: the banner counts as one, further toasts wait in the toasts' queue (ui/toasts.js setMaxVisible).
  let lanePush = 0;
  // THE CLICK RULE for the lane: a button must not move under a pointer. When the banner leaves, the column does NOT close up while a pointer is down or
  // while a toast with a button (an offer, a raid's or a Vendetta's Go) is on screen: the gap stays until it is safe (the press went to the hint bubble that
  // slid into the Go's place: goals check, Vendetta). Moving DOWN for a new banner happens at once (or the two would overlap).
  let lanePointerDown = false;
  window.addEventListener('pointerdown', () => { lanePointerDown = true; }, { capture: true, passive: true });
  for (const ev of ['pointerup', 'pointercancel']) window.addEventListener(ev, () => { lanePointerDown = false; }, { capture: true, passive: true });
  function layoutTopLane() {
    const banner = ui.leaderBanner.el;
    const bannerUp = banner.dataset.state === 'in' || banner.dataset.state === 'out';
    const phone = renderer.cssWidth < 768;
    ui.toasts.setMaxVisible(phone ? (banner.dataset.state === 'in' ? 1 : 2) : Infinity);
    let push = 0;
    if (bannerUp) {
      ui.leaderBanner.reflow();
      // layout boxes, not the card's slide-in transform (both are absolutely placed in #ui)
      const card = banner.firstElementChild || banner;
      if (card.offsetHeight > 0) {
        const bannerBottom = banner.offsetTop + card.offsetTop + card.offsetHeight;
        const toastsTop = ui.toasts.el.offsetTop - lanePush; // where the column sits on its own
        push = Math.max(0, Math.ceil(bannerBottom + 8 - toastsTop));
      }
    }
    if (push < lanePush && (lanePointerDown || ui.toasts.el.querySelector('.toast:not(.is-out) .toast-action'))) push = lanePush;
    if (Math.abs(push - lanePush) > 0.5) {
      lanePush = push;
      ui.toasts.el.style.marginTop = push ? `${push}px` : '';
    }
  }
  let overlayAt = 0;

  function frame(nowMs) {
    const dt = clock.tick(nowMs);
    const rawDt = lastNowMs ? Math.min(2, Math.max(0, (nowMs - lastNowMs) / 1000)) : 0;
    lastNowMs = nowMs;
    tAccum += dt;
    services.time.t = tAccum;
    services.time.nowMs = nowMs;

    try {
      const m0 = performance.now();
      autosave.tick(dt);
      // Idle income is wall-clock: use the unclamped gap (capped at 2 s; longer
      // gaps are settled by the visibility handler / offline earnings).
      const pop = idleTicker.tick(devSpeedX8 ? rawDt * 8 : rawDt);
      if (pop) services.pendingIdlePop = { ...pop, epoch: container.epoch };
      if (sceneManager.name !== 'title') cur().state.stats.playSec += dt;
      // A timed hint (step 0 lasts 5 s, step 4 lasts 10 s) counts down only while it is ON SCREEN: it used to
      // start on the title screen, so a player who lingered there never saw the first hint at all.
      if (!ui.coach.el.hidden) tutorial.update(dt);
      // Prosperity is wall-clock, like income: it keeps ticking through battles, but only the world scene
      // celebrates. (Not on the title screen: nothing is being played there.)
      if (sceneManager.name !== 'title' && nowMs - lastProsperityMs > 5000) {
        lastProsperityMs = nowMs;
        const ups = runProsperity(cur().state, cur().world, Date.now());
        if (ups.length) services.pendingProsperity.push(...ups.map((u) => ({ ...u, epoch: container.epoch })));
      }

      const t0 = performance.now();
      // battles run whatever scene is up, but never behind the title (a saved battle waits for Continue, as it always did)
      if (sceneManager.name !== 'title' && sessionStarted) services.battles.tick(dt);
      const m1 = performance.now();
      services.frontier.tick(dt);
      services.events.tick(dt);
      if (sceneManager.name !== 'title' && sessionStarted) services.goals.tick(dt);
      if (sceneManager.name !== 'title' && sessionStarted) services.boons.tick(sceneManager.name);
      const m2 = performance.now();
      perf.battleMs = m1 - t0;
      perf.metaMs = (t0 - m0) + (m2 - m1);
      sceneManager.frame(dt, tAccum, nowMs);
      updateTray();
      syncUiFlags(); // BEFORE the coach measures: a toast or the tray moving with a flag must be where the hint looks for it this frame
      ui.coach.tick(); // the hint follows its target: placed against this frame's final camera
      for (const fn of afterFrame) fn(); // dev: per-frame monitors (tools/hintMonitor.js) measure the finished frame
      perf.cpuMs = performance.now() - t0;
    } catch (err) {
      if (nowMs - errorLogAt > 1500) {
        errorLogAt = nowMs;
        // eslint-disable-next-line no-console
        console.error('frame error', err);
      }
    }

    if (rawDt > 0) {
      acc.n++; acc.cpu += perf.cpuMs; acc.cpuMax = Math.max(acc.cpuMax, perf.cpuMs);
      acc.meta += perf.metaMs; acc.metaMax = Math.max(acc.metaMax, perf.metaMs);
      acc.dt += rawDt * 1000; acc.dtMax = Math.max(acc.dtMax, rawDt * 1000);
      perf.frameMs += (rawDt * 1000 - perf.frameMs) * 0.06;
      perf.worstMs = Math.max(perf.worstMs * 0.995, rawDt * 1000);
      // Adaptive quality for the ambient layer (2 s hold so it never flaps): thin it out when frames run long.
      if (renderer.ambient && qualityLock == null && nowMs - qualityAtMs > 2000) {
        if (perf.frameMs > 24) { renderer.ambient.setQuality(0); qualityAtMs = nowMs; }
        else if (perf.frameMs < 17.5) { renderer.ambient.setQuality(1); qualityAtMs = nowMs; }
      }
    }
    // the dev overlay is text in the DOM: four times a second is plenty, and never while it is hidden (perf runs hide it)
    if (services.devOverlayEl && nowMs - overlayAt > 250 && services.devOverlayEl.style.display !== 'none') {
      overlayAt = nowMs;
      const st = renderer.terrain ? renderer.terrain.stats() : { chunks: 0, megapixels: 0, bucket: 0 };
      const fps = 1000 / Math.max(1, perf.frameMs);
      services.devOverlayEl.dataset.warn = perf.frameMs > 24 ? '2' : perf.frameMs > 18 ? '1' : '0';
      services.devOverlayEl.textContent =
        `cpu ${perf.cpuMs.toFixed(1)} ms  |  frame ${perf.frameMs.toFixed(1)} ms (${fps.toFixed(0)} fps)\n`
        + `chunks ${st.chunks} (${st.megapixels.toFixed(1)} MP, bucket ${st.bucket})  |  fx ${renderer.fx.count()}`;
    }

    removeBootSplash();
    // the boot's deferred chunk bakes, a few ms a frame once the first frames are out (Phase 8 perf)
    if (bootRemoved && renderer.terrain && renderer.terrain.prebakeStep) renderer.terrain.prebakeStep(4);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

try {
  boot();
} catch (err) {
  // A boot crash must never leave the player on a black page: fall back to
  // plain text so it is at least diagnosable, matching index.html's own
  // file:// guard philosophy.
  // eslint-disable-next-line no-console
  console.error('Hex Dominion failed to start', err);
  const boot0 = document.getElementById('boot');
  if (boot0) {
    // textContent, never innerHTML: an error message is text, not markup
    const box = document.createElement('div');
    box.style.cssText = 'max-width:34rem;padding:2rem;font:16px/1.6 system-ui,sans-serif;color:#f3ead7';
    const title = document.createElement('h1');
    title.style.cssText = 'font-size:28px;color:#eb5757';
    title.textContent = 'Something went wrong';
    const msg = document.createElement('p');
    msg.textContent = String((err && err.message) || err);
    box.append(title, msg);
    boot0.replaceChildren(box);
  }
}
