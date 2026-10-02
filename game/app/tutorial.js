// The tutorial controller (DESIGN §6, PLAYFEEL §4). State is a SET of seen steps (`state.tutorial.seen`, id -> true), not a counter: a step shows
// when it is unseen, its `after` steps are seen, its feature is on and its rule (game/app/tutorialRules.js) holds for the facts the scene passes
// to `pick`; it is marked seen when the player does the thing (`notify`), dismisses it, or its timeout runs out while it is on screen.
// One step is current at a time and it stays current until it is seen or its rule stops holding. This file touches only `state.tutorial` and
// `state.settings.hints`, never the DOM: scenes turn the step's `anchor` into a target and feed the coach (game/ui/coach.js).
import { TUTORIAL_STEPS } from '../scenes/timing.js';
import { RULES } from './tutorialRules.js';

/**
 * @param {{ getState: () => import('../meta/state.js').GameState }} deps
 */
export function createTutorialController({ getState }) {
  let current = null;
  let sinceShownSec = 0;

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

  function markSeen(id) {
    seenMap()[id] = true;
    if (current && current.id === id) { current = null; sinceShownSec = 0; }
  }

  function eligible(def, facts) {
    if (def.scene !== facts.scene) return false;
    if (isSeen(def.id)) return false;
    if (def.needs && !facts.features[def.needs]) return false;
    if (def.after && !def.after.every(isSeen)) return false;
    const rule = RULES[def.id];
    return !!rule && !!rule(facts);
  }

  /**
   * The step to show now, or null. Call it every frame with the scene's facts (`scene` plus the fields the rules read).
   * @param {Record<string, any>} facts
   */
  function pick(facts) {
    if (!enabled()) { current = null; return null; }
    const f = { features: {}, ...facts, seen: isSeen };
    if (current && eligible(current, f)) return current;
    const next = TUTORIAL_STEPS.find((def) => eligible(def, f)) || null;
    if (next !== current) sinceShownSec = 0;
    current = next;
    return current;
  }

  /** @param {number} dtSec  (counted while the hint is on screen; the shell only calls it then) */
  function update(dtSec) {
    if (!current || current.timeoutSec == null || !enabled()) return;
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
    current = null;
    sinceShownSec = 0;
  }

  return {
    pick, update, notify, dismiss, replay, isSeen, markSeen,
    get current() { return current; },
    currentStepDef: () => current,
  };
}
