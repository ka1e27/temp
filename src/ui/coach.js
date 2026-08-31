// Coach marks — the tutorial that never uses the word "tutorial".
//
// THE SHAPE OF THIS PAIR IS THE POINT: a pure, DOM-free decision machine here,
// a thin DOM strip in `coachstrip.js`. `nextBeat()` takes a snapshot of signals
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
    castleGated: false,
    // The three signals the four newly-wired beats need. Latched like the rest:
    // a thing that happened once still counts, because the line teaching it is
    // worth showing even a little after the moment.
    tookStronghold: false,
    siegeStalled: false,
    lostSite: false,
    // IS THERE ANYTHING TO ATTACK YET? Measured on the campaign opener: at tick
    // 0 the player knows ZERO of eleven non-player sites, because fog hides
    // site EXISTENCE and a beachhead of three lights ~28 hexes of 192. The beat
    // after the first march told them to "drag onto a building" regardless, so
    // the one instruction on screen named an action the fog made impossible,
    // and it held for the rest of the battle. Latched like the rest, and
    // honestly so: `state.seen` only ever grows, so knowing a target is
    // monotonic — this cannot flap back to false and re-teach a solved lesson.
    knowsTarget: false,
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
  if (!latch.knowsTarget) {
    latch.knowsTarget = !!battle.sites?.some((s) => s.owner !== 'player'
      && siteKnown(battle, 'player', s));
  }
  // Does this region's throne HAVE a gate? Read rather than assumed, because
  // `castleGateFrac` is 0 on the campaign opener and the beat that describes
  // the gate used to fire there anyway. Not latched: a rule of the region, so
  // it is true or false for the whole battle and reading it fresh cannot flap.
  latch.castleGated = (battle.rules?.castleGateFrac ?? 0) > 0;
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
    castleGated: !!latch.castleGated,
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
    // ...AND THE WARNING ABOVE CAUGHT ITS NEXT VICTIM IMMEDIATELY. `knowsTarget`
    // was latched correctly and not published here, so every reader saw
    // `undefined`, `!s.knowsTarget` was true forever, and the scout line fired
    // on a board where the throne was plainly known. Latching and publishing
    // are two steps and only one of them is where the bug shows up.
    knowsTarget: !!latch.knowsTarget,
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
