// Coach marks — the tutorial that never uses the word "tutorial".
//
// THE SHAPE OF THIS FILE IS THE POINT: a pure, DOM-free decision machine at the
// top, a thin DOM strip at the bottom. `nextBeat()` takes a snapshot of signals
// plus the set of beats already shown and returns the one beat to show now, or
// null. It reads no clock, touches no DOM and subscribes to nothing, which is
// why tests/coach.test.js can prove the whole onboarding flow headlessly.
//
// Rules the design fixes and this file enforces:
//   * beats fire off REAL GAME STATE — there is not one setTimeout in here that
//     decides whether a beat happens, only how long its text stays up;
//   * each beat fires EXACTLY ONCE, in order, and only in the seed region;
//   * nothing is ever modal and nothing ever takes a click. The strip lives in
//     `#hud`, which is pointer-events:none, and it deliberately does not opt
//     back in — a hint that eats a drag order is worse than no hint;
//   * completion is recorded on `meta.tutorialSeen`, so it never replays.
//
// Copy lives in content/strings.js (COACH). One beat's line is not there yet;
// see COACH_EXTRA.
import { COACH } from '../content/strings.js';
// FOG. `siteKnown` is the one predicate every player-facing surface asks (see
// battle/vision.js), and the coach is a player-facing surface: a hint is speech
// about the board, so it is bound by the same rule the board is. Pure, so the
// headless machine at the top of this file stays headless.
import { siteKnown } from '../battle/vision.js';
import { h, mount, unmount } from './dom.js';

/** Region 1. Coach marks exist for a first-timer's first battle and nowhere
 *  else — a hint on your fifth region is noise. */
export const COACH_REGION = 'riverfen';

export { BEATS, HOLD } from './coach.data.js';
import { BEATS, HOLD } from './coach.data.js';

export const BEAT_IDS = Object.freeze(BEATS.map((b) => b.id));

// ---------------------------------------------------------------------------
// The pure machine. No DOM, no clock, no bus.
// ---------------------------------------------------------------------------

/** Everything the machine remembers about what has happened so far. Latched,
 *  never un-latched: a condition that was briefly true still counts. */
export function emptyLatch() {
  return {
    started: false,
    sentSquad: false,
    siegeBegun: false,
    captured: false,
    gold: 0,
    castleAdjacent: false,
    // The three signals the four newly-wired beats need. Latched like the rest:
    // a thing that happened once still counts, because the line teaching it is
    // worth showing even a little after the moment.
    tookStronghold: false,
    siegeStalled: false,
    lostSite: false,
  };
}

/**
 * Is the enemy castle within REACH of something the player holds — and has the
 * player ever actually laid eyes on it?
 *
 * THIS COMMENT USED TO SAY "BORDERS" AND THAT STOPPED BEING TRUE UNDER IT.
 * `site.adj` kept its name through free movement and changed meaning: it is
 * every site within `MOVEMENT.reachHexes` (4) now, not the authored edge list
 * that used to be the legal set. So this has been answering "the throne is a few
 * hexes off my line", and the comment described a graph that no longer exists.
 * Left AS reach rather than tightened to true adjacency, deliberately: the line
 * it fires (COACH.takeCastle) warns that the gate holds until the countryside is
 * yours, which is worth hearing on the APPROACH and merely late once the player
 * is already at the wall. The graph is symmetric (recomputeReach fills both
 * directions), so reading it from the castle's side suffices.
 *
 * THE VISION GATE IS THE REAL FIX. Nothing here asked, so the beat could fire —
 * naming the castle, telling the player to take the countryside first — about a
 * building fog has never shown them. That is the same class of leak as a rally
 * line drawn into the dark: a surface going on narrating what the board learned
 * to hide, and this one is the worst-sounding of them, because it is the game
 * talking. Checked AFTER the owner test, so a castle the player already holds is
 * still refused without a vision lookup at all.
 */
export function castleTouchesPlayer(battle) {
  const sites = battle?.sites;
  if (!sites?.length) return false;
  const castle = sites.find((s) => s.kind === 'castle');
  if (!castle || castle.owner === 'player') return false;
  if (!siteKnown(battle, 'player', castle)) return false;
  const mine = new Set();
  for (const s of sites) if (s.owner === 'player') mine.add(s.id);
  return (castle.adj ?? []).some((id) => mine.has(id));
}

/** Fold a battle state into the latch. The two POLLED signals — gold and castle
 *  adjacency — live here rather than in an event, because neither has one. */
export function observeState(latch, battle) {
  if (!battle) return latch;
  latch.started = true;
  const gold = (battle.factions?.player?.goldCg ?? 0) / 100;
  if (gold > latch.gold) latch.gold = gold;
  if (!latch.sentSquad && battle.squads?.some((sq) => sq.owner === 'player')) {
    latch.sentSquad = true;
  }
  if (!latch.castleAdjacent && castleTouchesPlayer(battle)) latch.castleAdjacent = true;
  // A siege the player is running that cannot finish. The sim already knows —
  // it is the same `Infinity` the preview shows as INSUFFICIENT — so this reads
  // the state rather than adding an event for it.
  if (!latch.siegeStalled) {
    latch.siegeStalled = !!battle.sites?.some((s) => s.siege?.owner === 'player'
      && s.siege.ticks > 60 && s.hp >= s.hpMax * 0.99);
  }
  return latch;
}

/** Fold ONE drained battle event into the latch. `type` is the bare sim event
 *  name — `screens/battle.js` re-emits it on the bus as `battle:<type>`. */
export function noteEvent(latch, type, ev) {
  if (type === 'siege-begun' && ev?.owner === 'player') latch.siegeBegun = true;
  else if (type === 'site-captured' && ev?.to === 'player') {
    latch.captured = true;
    // A stronghold trains nothing now — content/balance.js split it into a
    // pure wall plus trainingGround, the pure barracks — so "pick what this
    // trains" (COACH.strongholdTaken) is only ever a true statement about the
    // barracks half. Field/beat names are unchanged; only the trigger moved.
    if (ev.kind === 'trainingGround') latch.tookStronghold = true;
  } else if (type === 'site-captured' && ev?.from === 'player') latch.lostSite = true;
  else if (type === 'squad-sent' && ev?.owner === 'player') latch.sentSquad = true;
  return latch;
}

/** The snapshot every predicate reads. Pure projection of (battle, meta, latch). */
export function readSignals({ battle = null, meta = null, latch = emptyLatch() } = {}) {
  return {
    regionId: battle?.regionId ?? null,
    started: !!battle || !!latch.started,
    sentSquad: !!latch.sentSquad,
    siegeBegun: !!latch.siegeBegun,
    captured: !!latch.captured,
    gold: latch.gold ?? 0,
    castleAdjacent: !!latch.castleAdjacent,
    // THESE THREE WERE LATCHED AND NEVER PUBLISHED, so the three beats whose
    // `when` reads them could not fire at any point in any battle: the training
    // tip, the stalled-siege tip and the retreat tip — which are, again, the
    // three that teach what people actually lose to.
    //
    // It is the same bug the tutorial already had once and the same reason it
    // survived: `tests/coach.test.js` was strengthened to fail if a COACH line
    // reaches no BEAT, and every one of these has a beat. Nothing asked whether
    // the beat's own predicate could ever see a true value. It can now, and the
    // test asserts the join rather than either half.
    tookStronghold: !!latch.tookStronghold,
    siegeStalled: !!latch.siegeStalled,
    lostSite: !!latch.lostSite,
    tutorialSeen: !!meta?.tutorialSeen,
  };
}

/**
 * THE DECISION. Given signals and the beats already fired, return the beat to
 * show now or null. Deterministic, allocation-free, and the only place the
 * "once, in order, region 1 only" rules exist.
 *
 * @param {object} signals   from readSignals()
 * @param {Record<string,boolean>} fired
 * @param {Array<object>} [beats]
 * @param {string} [region]
 * @returns {object|null}
 */
export function nextBeat(signals, fired = {}, beats = BEATS, region = COACH_REGION) {
  if (!signals || signals.tutorialSeen) return null;
  if (signals.regionId !== region) return null;
  if (!signals.started) return null;
  for (const b of beats) {
    if (fired[b.id]) continue;
    if (b.after && !fired[b.after]) continue;
    if (!b.when(signals)) continue;
    return b;
  }
  return null;
}

/**
 * When has the player been taught enough to never see this again?
 *
 * Not simply "all five fired": a player who loses region 1 never reaches the
 * castle, so the last beat never fires and the whole tutorial would replay on
 * every retry — the precise thing `tutorialSeen` exists to prevent. One region-1
 * battle that got as far as `fieldWon` counts, whatever the result, because
 * that is the beat that teaches the two-stage capture.
 *
 * @param {Record<string,boolean>} fired
 * @param {{ended?:boolean}} [ctx]  `ended` = this battle has finished
 */
export function shouldMarkSeen(fired = {}, { ended = false } = {}, beats = BEATS) {
  if (beats.every((b) => fired[b.id])) return true;
  return !!(ended && fired.fieldWon);
}

/**
 * Stateful wrapper around the decision function. Still pure: no clock, no DOM,
 * no subscriptions — it is fed events and states from outside.
 * @param {{beats?:Array, region?:string, fired?:object}} [o]
 */
export function createCoachMachine(o = {}) {
  const beats = o.beats ?? BEATS;
  const region = o.region ?? COACH_REGION;
  const fired = { ...(o.fired ?? {}) };
  let latch = emptyLatch();

  const api = {
    get fired() { return { ...fired }; },
    get latch() { return { ...latch }; },
    get complete() { return beats.every((b) => fired[b.id]); },
    get pending() { return beats.filter((b) => !fired[b.id]).map((b) => b.id); },

    note(type, ev) { noteEvent(latch, type, ev); return api; },
    observe(battle) { observeState(latch, battle); return api; },
    signals(battle, meta) { return readSignals({ battle, meta, latch }); },
    /** True when the currently-shown beat has been overtaken by events. */
    retired(beat, battle, meta) {
      return !!beat?.until && beat.until(readSignals({ battle, meta, latch }));
    },

    /** Observe, decide, and mark the result fired. The whole machine in a call. */
    step(battle, meta) {
      observeState(latch, battle);
      const beat = nextBeat(readSignals({ battle, meta, latch }), fired, beats, region);
      if (beat) fired[beat.id] = true;
      return beat;
    },

    skipAll() { for (const b of beats) fired[b.id] = true; return api; },
    reset() {
      latch = emptyLatch();
      for (const k of Object.keys(fired)) delete fired[k];
      return api;
    },
  };
  return api;
}

// ---------------------------------------------------------------------------
// The DOM strip. Everything below is presentation.
// ---------------------------------------------------------------------------

/** Poll rate for the two state-derived beats. 5Hz is far below the 10Hz sim and
 *  costs one array scan; per-frame polling would cost 12x that for nothing. */
const POLL_MS = 200;
/** Beats never stack or cross-fade — one clear line at a time, then a beat of
 *  silence so two hints never read as one sentence. */
const GAP_MS = 500;

const defaultNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Mount the coach strip.
 *
 * @param {object} o
 * @param {HTMLElement} o.root      where the strip lives — `#hud` (see notes)
 * @param {object} o.bus            the game bus; battle events arrive as `battle:<type>`
 * @param {()=>object|null} o.getState  the LIVE BATTLE state (ctx.state.battle)
 * @param {()=>object|null} o.getMeta   the meta slice (ctx.state.meta)
 * @param {()=>void} [o.onComplete] called once, when the last beat has shown
 * @param {()=>number} [o.now]      injectable clock, for tests
 * @returns {{el:HTMLElement, update:()=>void, dispose:()=>void,
 *            dismiss:()=>void, skip:()=>void, machine:object}}
 */
export function createCoach(o = {}) {
  const { root, bus, getState, getMeta, onComplete } = o;
  const now = o.now ?? defaultNow;
  const machine = o.machine ?? createCoachMachine(o);

  // role/aria-live so a screen reader announces each beat as it lands. No
  // `data-interactive`, deliberately: base.css only opts interactive children
  // of #hud back into hit testing, so this strip is invisible to the pointer
  // and can never swallow a drag order aimed at the board behind it.
  const el = h('div.hint', {
    role: 'status', 'aria-live': 'polite', 'data-coach': 'strip',
  });
  if (root) mount(root, el);

  let showing = null;
  let hideAt = 0;
  let readyAt = 0;
  let lastPoll = -Infinity;
  let completed = false;
  const offs = [];

  if (bus) {
    for (const type of ['siege-begun', 'site-captured', 'squad-sent']) {
      offs.push(bus.on(`battle:${type}`, (ev) => machine.note(type, ev)));
    }
    // ONE region-1 battle's worth of coaching, then never again. See
    // shouldMarkSeen() for why this is not simply "all five beats fired".
    offs.push(bus.on('battle:battle-ended', () => {
      if (shouldMarkSeen(machine.fired, { ended: true })) finish(getMeta?.() ?? null);
    }));
  }

  // Skippable without being a target: Esc already means "never mind" in this
  // game (battle-input.js deselects on it), so it retires the current line too.
  if (typeof window !== 'undefined') {
    const onKey = (ev) => { if (ev.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    offs.push(() => window.removeEventListener('keydown', onKey));
  }

  function show(beat, t) {
    showing = beat;
    el.textContent = beat.text;
    el.dataset.beat = beat.id;
    el.classList.add('is-on');
    hideAt = t + (beat.hold ?? HOLD.normal);
  }

  function hide(t) {
    showing = null;
    el.classList.remove('is-on');
    readyAt = t + GAP_MS;
  }

  /** Retire whatever is on screen right now. Never cancels a future beat. */
  function dismiss() {
    if (showing) hide(now());
  }

  /** Opt out of onboarding entirely, for good. */
  function skip() {
    machine.skipAll();
    dismiss();
    finish(getMeta?.() ?? null);
  }

  function finish(meta) {
    if (completed) return;
    completed = true;
    // `meta.tutorialSeen` is declared in core/store.js and rebuilt by
    // fromPersisted, so this survives a reload with no migration. The autosaver
    // only writes while `session.dirty`; pass `onComplete` if you want the flag
    // on disk before the next meta mutation rather than at the unload flush.
    if (meta) meta.tutorialSeen = true;
    bus?.emit('coach:complete', { fired: machine.fired });
    onComplete?.();
  }

  /** Call once per rendered frame; internally throttled to POLL_MS. */
  function update() {
    const t = now();
    const battle = getState?.() ?? null;

    // AN INSTRUCTION STAYS UNTIL IT IS OBEYED. Every beat retired on a timer,
    // so the one line a new player gets — "drag from your camp" — vanished after
    // six seconds and could never come back: no help button, no replay, nothing
    // else on screen. A player who did not work out the gesture in six seconds
    // was then left in silence for the remaining nineteen minutes of the battle,
    // and that is the single biggest quit point in the product.
    //
    // A timer is the right retirement for a STATEMENT ("Farms fund your army")
    // and exactly the wrong one for an instruction. A beat carrying `until`
    // knows what doing-the-thing looks like, so it waits for it.
    const overtaken = machine.retired(showing, battle, getMeta?.() ?? null);
    if (showing && (overtaken || (!showing.until && t >= hideAt))) hide(t);
    if (t - lastPoll < POLL_MS) return;
    lastPoll = t;

    // Keep the latches warm even while a line is up, so a beat whose moment
    // passed behind another beat's text is still remembered and still shown.
    if (showing || t < readyAt) { machine.observe(battle); return; }

    const meta = getMeta?.() ?? null;
    const beat = machine.step(battle, meta);
    if (beat) show(beat, t);
    if (!completed && shouldMarkSeen(machine.fired)) finish(meta);
  }

  return {
    el,
    machine,
    update,
    dismiss,
    skip,
    get showing() { return showing?.id ?? null; },
    get fired() { return machine.fired; },
    dispose() {
      for (let i = offs.length - 1; i >= 0; i--) offs[i]();
      offs.length = 0;
      unmount(el);
    },
  };
}
