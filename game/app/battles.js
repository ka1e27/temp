// The battle manager (ARCHITECTURE 10.1): owns EVERY running battle, so battles live outside the battle scene.
//
//   const manager = createBattleManager({ getState, getWorld, services });
//   manager.tick(dtSec)          // every frame, from main.js, whatever scene is up
//
// The runs themselves are plain JSON in `state.battles` (BattleRun[], ARCHITECTURE 10.2), so they are saved and resumed with the rest of the state. The
// manager adds what is not saved: a fixed stepper per run (for interpolation), a gate per run (the battle scene holds the run it shows during its fly-in,
// a hit-stop or the end sequence), the global speed and pause, and the event bus.
//
// Per tick, for each run: the enemy side `think()`s; the player side is the player's own input when the run is focused and not on Auto (the scene issues
// those commands), otherwise the steward (`battle/steward.js stewardDecide`, loaded when it exists; until then an unwatched run's player side issues
// nothing); then `step()` at TICK_SEC and the crown tracker. The events of each tick are handed out as `'events' (runId, events)`; the battle scene plays fx and
// sfx only for the run it shows. A run whose sim has decided (`battle.result`) emits `'ended' (runId, result)` once. The focused run's ending is finished
// by the battle scene (its victory sequence and results card call `recordResult` and `finish`); an unwatched run is finished here at once.
import { step, issue } from '../battle/sim.js';
import { think } from '../battle/ai.js';
import { PLAYER_OWNER } from '../battle/owner.js';
import { createFixedStepper } from '../input/clock.js';
import { TICK_SEC } from '../config/battle.js';
import { trackerOf, trackBattle, evaluateBattle, awardCrowns, battleSummaryFor } from '../meta/crowns.js';
import { conquer, revealed, frontier } from '../meta/progression.js';
import { clearRegionIntel } from '../meta/intel.js';
import { chronicleOnConquest } from '../meta/chronicle.js';
import { MAX_SAVED_BATTLES } from '../meta/save.js';
import { stewardDecide as defaultSteward } from '../battle/steward.js';
import { defenseReward, occupy, busyFromState } from '../meta/frontier.js';
import { generalById, commanderStyle, settleCommander } from '../meta/generals.js';
import { duelReward } from '../meta/events.js';
import { boonBattleEnd } from '../meta/boons.js';
import { pausedCooldownTick } from '../battle/boons.js';

/** At most this many battles at once (DESIGN 10.5; FRONTIER.maxBattles when config/frontier.js lands). */
export const MAX_BATTLES = MAX_SAVED_BATTLES;

// The steward (battle/steward.js `stewardDecide`, the sim engineer's): commands the player's side of every run nobody watches (or set to Auto). Its memo rides in
// `battle.steward`, so a saved battle resumes its steward exactly. A run with no General gets the weak Militia Captain (DESIGN 10.6, 10.8).
let stewardDecide = defaultSteward;
/** Installs the player-side policy for unwatched / Auto runs: `(battle, t, memo, style) => commands`. */
export function setStewardDecide(fn) { stewardDecide = typeof fn === 'function' ? fn : null; }

/**
 * @param {{ getState: () => object, getWorld: () => object, services?: object }} deps
 */
export function createBattleManager({ getState, getWorld, services = {} }) {
  const listeners = new Map(); // event -> Set<fn>
  const rt = new Map(); // runId -> { stepper, alpha, gate, memo, endedEmitted, recorded }
  let focusedId = null;
  let speed = 1;
  let paused = false;
  let dialogHold = false;

  const runs = () => {
    const s = getState();
    if (!Array.isArray(s.battles)) s.battles = [];
    return s.battles;
  };
  const emit = (ev, ...args) => {
    const set = listeners.get(ev);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(...args); } catch (err) { console.error(`[battles] ${ev} listener failed:`, err); }
    }
  };
  const runtime = (run) => {
    let r = rt.get(run.id);
    if (!r) {
      r = { stepper: createFixedStepper(TICK_SEC), alpha: 1, gate: null, memo: {}, endedEmitted: !!run.battle.result, recorded: !!run.battle.result };
      rt.set(run.id, r);
    }
    return r;
  };
  const nextId = () => {
    const s = getState();
    if (s.frontier && Number.isInteger(s.frontier.seq)) {
      const id = Math.max(s.frontier.seq, ...runs().map((r) => r.id + 1), 1);
      s.frontier.seq = id + 1;
      return id;
    }
    return runs().reduce((m, r) => Math.max(m, r.id), 0) + 1;
  };

  function list() { return runs().slice(); }
  function get(id) { return runs().find((r) => r.id === id) || null; }
  function focused() { return focusedId == null ? null : get(focusedId); }

  /** Sets the watched battle (null: the map). */
  function focus(id) {
    const next = id == null ? null : (get(id) ? id : null);
    if (next === focusedId) return;
    focusedId = next;
    emit('focus', focusedId);
  }

  /**
   * Adds a running battle. Refuses (returns null) beyond MAX_BATTLES, or when another run already fights over the same region.
   * @param {{ kind: 'attack'|'defense', regionId: number, battle: object, commander?: string|null, auto?: boolean, fromRegionId?: number, attackerFaction?: number }} spec
   * @returns {object|null} the BattleRun
   */
  function start(spec) {
    const list0 = runs();
    if (list0.length >= MAX_BATTLES) return null;
    if (list0.some((r) => r.regionId === spec.regionId)) return null;
    const tracker = trackerOf(spec.battle); // crowns tracker: plain JSON, saved with the run
    if (spec.labelAtAttack && tracker && !tracker.labelAtAttack) tracker.labelAtAttack = spec.labelAtAttack; // rides in the saved tracker (crowns.js battleSummaryFor reads it)
    const taken = (id) => list0.some((r) => r.id === id);
    const run = {
      id: Number.isInteger(spec.id) && spec.id > 0 && !taken(spec.id) ? spec.id : nextId(), // defenseRunFor already drew one from state.frontier.seq
      kind: spec.kind || 'attack',
      regionId: spec.regionId,
      battle: spec.battle,
      commander: spec.commander ?? null,
      auto: !!spec.auto,
      startedAt: Date.now(),
    };
    if (spec.labelAtAttack) run.labelAtAttack = spec.labelAtAttack;
    if (run.kind === 'defense') {
      run.fromRegionId = spec.fromRegionId ?? null;
      run.attackerFaction = spec.attackerFaction ?? null;
      if (spec.raidId != null) run.raidId = spec.raidId;
      run.first = !!spec.first; // the realm's first defense: weak and forgiving (DESIGN 10.1, the tutorial)
      if (spec.vendetta) run.vendetta = { faction: spec.vendetta.faction, leader: spec.vendetta.leader || '' }; // a rival leader's Vendetta (PLAN-PHASE4 §4D)
    }
    if (run.kind === 'duel') { // a world event's Duel (DESIGN 10.13; meta/events.js duelRunFor): fought like a defense, never occupies
      run.fromRegionId = spec.fromRegionId ?? null;
      run.attackerFaction = spec.attackerFaction ?? null;
      if (spec.eventId != null) run.eventId = spec.eventId;
    }
    list0.push(run);
    runtime(run);
    emit('started', run.id);
    return run;
  }

  /** Removes a run without applying anything (a Retry replaces it; a retreat or a lost attack changes nothing). */
  function remove(id) {
    const list0 = runs();
    const at = list0.findIndex((r) => r.id === id);
    if (at < 0) return;
    list0.splice(at, 1);
    rt.delete(id);
    if (focusedId === id) { focusedId = null; emit('focus', null); }
  }

  /** The battle scene holds the run it shows while its fly-in, a hit-stop or its end sequence plays: `gate()` returning true holds the sim still. */
  function setGate(id, gate) {
    const run = get(id);
    if (run) runtime(run).gate = typeof gate === 'function' ? gate : null;
  }

  /** The interpolation factor of a run's last tick (for the renderer). */
  function alphaOf(id) {
    const r = rt.get(id);
    return r ? r.alpha : 1;
  }

  function stepRun(run, r, events) {
    const b = run.battle;
    emit('beforeStep', run.id);
    for (const cmd of think(b, b.t)) issue(b, cmd);
    const watched = run.id === focusedId && !run.auto;
    if (!watched && stewardDecide) {
      try {
        // a General commands in their own style, level and skills (and uses their ability); with none, the Militia Captain (DESIGN 10.11)
        const g = run.commander ? generalById(getState(), run.commander) : null;
        for (const cmd of stewardDecide(b, b.t, undefined, g ? commanderStyle(g) : 'captain') || []) issue(b, { ...cmd, owner: PLAYER_OWNER });
      } catch (err) { console.warn('[battles] steward failed:', err); }
    }
    step(b, TICK_SEC);
    trackBattle(trackerOf(b), b); // once per STEP (3x speed runs several a frame)
    for (const ev of b.events) events.push(ev);
  }

  /** Fixed-steps every running battle at the global speed (held runs, a pause or an open dialog stand still). */
  function tick(dtSec) {
    for (const run of runs().slice()) {
      const r = runtime(run);
      const b = run.battle;
      const gated = !!(r.gate && r.gate());
      const held = !!b.result || paused || dialogHold || gated;
      // the Sundial Relic (PLAN-PHASE7 §7B): power cooldowns tick through the player's pause and the battle-entry flight (a no-op without it)
      if (!b.result && !dialogHold && (paused || gated)) { try { pausedCooldownTick(b, dtSec * speed); } catch (err) { /* never stop the loop */ } }
      const events = [];
      r.alpha = r.stepper.advance(dtSec, held ? 0 : speed, () => { if (!b.result) stepRun(run, r, events); });
      if (events.length) emit('events', run.id, events);
      if (b.result && !r.endedEmitted) {
        r.endedEmitted = true;
        emit('ended', run.id, b.result);
        // a battle nobody is watching is finished at once (the watched one is finished by the scene's victory sequence and results card)
        if (run.id !== focusedId && get(run.id)) {
          const snapshot = { kind: run.kind, regionId: run.regionId, result: b.result };
          recordResult(run.id);
          const out = finish(run.id);
          emit('remoteEnded', run.id, snapshot, out);
        }
      }
    }
  }

  /** Retreats that battle (the sim ends it with result 'retreat'). */
  function retreat(id) {
    const run = get(id);
    if (!run || run.battle.result) return;
    issue(run.battle, { type: 'retreat' });
  }

  function setAuto(id, on) {
    const run = get(id);
    if (run) run.auto = !!on;
  }
  function setSpeed(s) { speed = Number.isFinite(s) && s > 0 ? s : 1; }
  function setPaused(b) { paused = !!b; }
  /** Any open dialog holds every battle (DESIGN 7.5a), on top of the player's own pause. */
  function setDialogHold(b) { dialogHold = !!b; }

  /** Everything engaged (ARCHITECTURE 10.1): the regions fought over, and every settlement in an undecided arena, keyed "regionId:index" (battle/defenseArena.js busyKey). */
  function busy() {
    return busyFromState(getState(), getWorld());
  }

  /**
   * The bookkeeping of a decided battle, once per run: lifetime stats (troops sent, battles won or lost, settlements taken, the best time). The battle scene
   * calls it when its end sequence begins; an unwatched run gets it from `tick`.
   * @returns {boolean} false when it was already recorded
   */
  function recordResult(id) {
    const run = get(id);
    if (!run) return false;
    const r = runtime(run);
    if (r.recorded) return false;
    r.recorded = true;
    const state = getState();
    const b = run.battle;
    state.stats.troopsSent += b.stats.sent;
    if (b.result === 'win') {
      state.stats.battlesWon += 1;
      state.stats.settlementsTaken += b.stats.captured;
      if (state.stats.bestBattleSec == null || b.stats.durationSec < state.stats.bestBattleSec) state.stats.bestBattleSec = b.stats.durationSec;
    } else if (b.result === 'lose') {
      state.stats.battlesLost += 1;
    }
    return true;
  }

  /**
   * Applies a decided battle and removes the run (ARCHITECTURE 10.1 "On 'ended'"): an attack won -> `conquer` + crowns + chronicle, exactly as the battle scene
   * did; an attack lost or retreated -> nothing. (Defenses arrive with the sim engineer's `defenseReward` / `occupy`.)
   * @param {number} id
   * @param {{ crownResult?: object|null }} [opts] the crowns the scene already evaluated (else they are evaluated here)
   * @returns {null | { regionId: number, result: object, crownAward: { bonusGold: number, count: number }, beforeRevealed: boolean[], frontierBefore: number[], oldOwner: number }}
   */
  function finish(id, opts = {}) {
    const run = get(id);
    if (!run) return null;
    const state = getState();
    const world = getWorld();
    const b = run.battle;
    let out = null;
    if (run.kind === 'attack' && b.result === 'win') {
      const regionId = run.regionId;
      const beforeRevealed = revealed(state, world);
      const frontierBefore = frontier(state, world);
      const oldOwner = b.arena.enemyFaction;
      const crownResult = opts.crownResult !== undefined ? opts.crownResult : evaluateBattle(trackerOf(b), b, world, regionId, state);
      const result = conquer(state, world, regionId, Date.now(), { viaBattle: true, labelAtAttack: run.labelAtAttack }); // won in battle: drafts Boons once unlocked, for a win that counts (PLAN-PHASE7)
      clearRegionIntel(state, regionId); // scouted / sabotaged only until the region is ours
      // Crowns pay their bonus on top of the base bounty (never repaying it); retries only count the winning battle.
      const crownAward = crownResult ? awardCrowns(state, world, regionId, crownResult.crowns, result.bounty) : { bonusGold: 0, count: 0 };
      // the realm's story (Keepsakes): a line for a notable conquest. The story must never be able to stop a conquest from landing, so it is guarded.
      try {
        chronicleOnConquest(state, world, regionId, {
          crowns: crownResult ? crownResult.crowns : null, // { victory, swift, unbroken }
          battleSec: b.stats.durationSec, // the winning battle's length (a retry only counts the battle that won)
          decapitated: !!result.decapitated,
        });
      } catch (err) { console.warn('[chronicle] conquest line skipped:', err); }
      out = { kind: 'attack', regionId, result, crownAward, beforeRevealed, frontierBefore, oldOwner };
    } else if (run.kind === 'defense' && b.result) {
      // a defense won pays its reward (and drains the militia); anything else (lost, or retreated: a retreat from a defense is a loss) occupies the region
      const nowMs = Date.now();
      if (b.result === 'win') {
        const reward = defenseReward(state, world, run, 'win', nowMs);
        out = { kind: 'defense', regionId: run.regionId, won: true, reward };
      } else {
        const faction = run.attackerFaction != null ? run.attackerFaction : b.arena.enemyFaction;
        // every finished defense goes through defenseReward (phase4-hookup §5.1): it pays nothing on a loss, but a lost Vendetta settles its Grudge there;
        // then the region is occupied as for any raid
        let lost = null;
        try { lost = defenseReward(state, world, run, b.result, nowMs); } catch (err) { console.warn('[battles] defenseReward (lost) failed:', err); }
        occupy(state, world, run.regionId, faction, nowMs);
        out = { kind: 'defense', regionId: run.regionId, won: false, occupiedBy: faction, reward: lost };
      }
    } else if (run.kind === 'duel' && b.result) {
      // a Duel (DESIGN 10.13): a win pays its Renown; a loss or a retreat costs nothing (the region is NOT occupied)
      const reward = duelReward(state, world, run, b.result);
      out = { kind: 'duel', regionId: run.regionId, won: b.result === 'win', renown: reward ? reward.renown : 0, attackerFaction: run.attackerFaction };
    }
    // the commander's share (DESIGN 10.11): XP, a wound on a loss, where it fought; null for the Militia Captain
    // (a Duel lost costs nothing: no wound, no XP; a Duel won counts as a battle won)
    if (b.result && !(run.kind === 'duel' && b.result !== 'win')) {
      let cmd = null;
      try { cmd = settleCommander(state, run, b.result, Date.now()); } catch (err) { console.warn('[battles] settleCommander failed:', err); }
      if (out) out.commander = cmd; else if (cmd) out = { kind: run.kind, regionId: run.regionId, commander: cmd };
      if (cmd) emit('commanderSettled', id, cmd);
    }
    // Phase 7: the Boons' end-of-battle bookkeeping for every attack or defense that ends (Plunderers' gold, Fortune Favours' loss); a Duel is not a battle of the realm
    let boons = null;
    if (b.result && run.kind !== 'duel') {
      try { boons = boonBattleEnd(state, world, b, b.result); } catch (err) { console.warn('[battles] boonBattleEnd failed:', err); }
      if (out && boons) out.boons = boons;
    }
    const snapshot = { kind: run.kind, regionId: run.regionId, result: b.result, attackerFaction: run.attackerFaction ?? null, commander: run.commander ?? null, boons };
    // what the Bounty Board's onBattleEnd needs (crowns.js battleSummaryFor reads the saved tracker); a Duel counts for nothing there
    if (b.result && run.kind !== 'duel') { try { snapshot.summary = battleSummaryFor(trackerOf(b), b, run, world, state); } catch (err) { console.warn('[battles] battleSummaryFor failed:', err); } }
    remove(id);
    emit('finished', id, out, snapshot);
    if (services.autosave) services.autosave.save();
    return out;
  }

  /** Forgets every runtime (a new realm, an import, a new dynasty: `state.battles` was replaced). */
  function reset() {
    rt.clear();
    focusedId = null;
  }

  function on(ev, fn) {
    if (!listeners.has(ev)) listeners.set(ev, new Set());
    listeners.get(ev).add(fn);
    return () => listeners.get(ev).delete(fn);
  }

  return {
    list, get, focused, focus, start, remove, tick, retreat, setAuto, setSpeed, setPaused, setDialogHold, busy, on,
    setGate, alphaOf, recordResult, finish, reset,
    get speed() { return speed; },
    get paused() { return paused; },
    get focusedId() { return focusedId; },
  };
}
