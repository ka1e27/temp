// The tutorial controller (DESIGN §6, PLAYFEEL §4). State is a SET of seen steps (`state.tutorial.seen`, id -> true), not a counter: a step shows
// when it is unseen, its `after` steps are seen, its feature is on and its rule (game/app/tutorialRules.js) holds for the facts the scene passes
// to `pick`; it is marked seen when the player does the thing (`notify`), dismisses it, or its timeout runs out while it is on screen.
// One step is current at a time and it stays current until it is seen or its rule stops holding. This file touches only `state.tutorial` and
// `state.settings.hints`, never the DOM: scenes turn the step's `anchor` into a target and feed the coach (game/ui/coach.js).
import { TUTORIAL_STEPS, HINT_PACE } from '../scenes/timing.js';
import { RULES } from './tutorialRules.js';

/**
 * @param {{ getState: () => import('../meta/state.js').GameState, pacer?: ReturnType<import('./pacer.js').createPacer> }} deps
 *   pacer (Phase 10A): a step with an `intro` waits until its system may be introduced, and introduces it when it becomes current
 *   newHintGapSec (Phase 10A; a number or a function read live): play seconds between two NEW steps (0: no wait)
 */
export function createTutorialController({ getState, pacer = null, newHintGapSec = 0 }) {
  let current = null;
  let sinceShownSec = 0;
  // Phase 10A: a NEW step (never current before) waits newHintGapSec of play after the previous new one; urgent steps never wait
  const started = new Set();
  let lastNewAt = -Infinity;
  const playSec = () => { const s = getState(); return (s && s.stats && Number(s.stats.playSec)) || 0; };
  const hintGap = () => (typeof newHintGapSec === 'function' ? newHintGapSec() : newHintGapSec);

  const seenMap = () => {
    const state = getState();
    if (!state.tutorial.seen || typeof state.tutorial.seen !== 'object') state.tutorial.seen = {};
    return state.tutorial.seen;
  };
  const isSeen = (id) => !!seenMap()[id];
  const enabled = () => {
    const state = getState();
    return !!state && !state.tutorial.done && state.settings.hints !== false;
  };
  // a step marked `afterDone` (Phase 5: Quick Conquest, a dynasty-II feature) may still show once the first tutorial is done (founding a dynasty sets `done`)
  const hintsOn = () => { const state = getState(); return !!state && state.settings.hints !== false; };
  const allowed = (def) => (def && def.afterDone ? hintsOn() : enabled());

  function markSeen(id) {
    seenMap()[id] = true;
    if (current && current.id === id) { current = null; sinceShownSec = 0; }
  }

  function eligible(def, facts) {
    if (!allowed(def)) return false;
    if (def.scene !== facts.scene) return false;
    if (isSeen(def.id)) return false;
    if (def.needs && !facts.features[def.needs]) return false;
    if (def.after && !def.after.every(isSeen)) return false;
    const rule = RULES[def.id];
    if (!rule || !rule(facts)) return false;
    // Phase 10A: a `calm` step waits for a quiet moment on the map (facts.calmSec; a scene that does not report it is always calm)
    if (def.calm && facts.calmSec != null && facts.calmSec < HINT_PACE.calmSec) return false;
    return !(def.intro && pacer && !pacer.ready(def.intro)); // one new system at a time (the current step keeps its turn: ready() holds once introduced)
  }

  /**
   * The step to show now, or null. Call it every frame with the scene's facts (`scene` plus the fields the rules read).
   * @param {Record<string, any>} facts
   */
  function pick(facts) {
    if (!hintsOn()) { current = null; return null; }
    const f = { features: {}, ...facts, seen: isSeen };
    if (current && eligible(current, f)) return current;
    let next = TUTORIAL_STEPS.find((def) => eligible(def, f)) || null;
    if (next && !started.has(next.id) && !next.urgent && playSec() - lastNewAt < hintGap()) next = null; // its turn comes a little later
    if (next && !started.has(next.id)) { started.add(next.id); lastNewAt = playSec(); }
    if (next !== current) sinceShownSec = 0;
    current = next;
    if (current && current.intro && pacer) pacer.introduce(current.intro);
    return current;
  }

  /**
   * Could any step of `scene` still show (hints on, unseen, its `after` steps seen)? Rules are not asked: this is the cheap gate a scene checks before it
   * gathers its facts every frame (Phase 8 perf: a veteran's map has nothing left to teach).
   * @param {string} scene
   */
  function anyPending(scene) {
    if (!hintsOn()) return false;
    for (const def of TUTORIAL_STEPS) {
      if (def.scene !== scene || isSeen(def.id) || !allowed(def)) continue;
      if (def.after && !def.after.every(isSeen)) continue;
      return true;
    }
    if (current) current = null;
    return false;
  }

  /** @param {number} dtSec  (counted while the hint is on screen; the shell only calls it then) */
  function update(dtSec) {
    if (!current || current.timeoutSec == null || !allowed(current)) return;
    sinceShownSec += dtSec;
    if (sinceShownSec >= current.timeoutSec) markSeen(current.id);
  }

  /**
   * Something the player did. Every step that lists the event marks seen (they already know it), except `activeOnly` steps.
   * @param {string} event
   */
  function notify(event) {
    for (const def of TUTORIAL_STEPS) {
      if (!def.seenOn.includes(event)) continue;
      if (def.activeOnly && !(current && current.id === def.id)) continue;
      if (!isSeen(def.id)) markSeen(def.id);
    }
  }

  /** The coach's own × : skip this step. */
  function dismiss() {
    if (current) markSeen(current.id);
  }

  /** "Replay tutorial" in Settings: every step is unseen again and hints are on. */
  function replay() {
    const state = getState();
    state.tutorial = { seen: {}, done: false };
    state.settings.hints = true;
    started.clear();
    current = null;
    sinceShownSec = 0;
  }

  return {
    pick, update, notify, dismiss, replay, isSeen, markSeen, anyPending,
    get current() { return current; },
    currentStepDef: () => current,
  };
}
