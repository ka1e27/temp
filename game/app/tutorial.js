// Tutorial-step controller (PLAYFEEL §4). Event-driven: scenes call `notify`
// at the moments the spec cares about and `update(dt)` every frame for the
// two timeout-eligible steps; this file only touches `state.tutorial` and
// `state.settings.hints`, never the DOM — scenes resolve each step's `anchor`
// key to an actual screen point/element and feed `createCoach`.
import { TUTORIAL_STEPS } from '../scenes/timing.js';

const EVENT_FOR_ADVANCE = {
  timeoutOrTap: 'tap',
  regionSelected: 'regionSelected',
  battleStart: 'battleStart',
  send: 'send',
  captureOrTimeout: 'capture',
  powerUsed: 'powerUsed',
  councilOpened: 'councilOpened',
};

/**
 * @param {{ getState: () => import('../meta/state.js').GameState }} deps
 */
export function createTutorialController({ getState }) {
  let sinceActivatedSec = 0;
  let lastStepId = -1;

  function currentStepDef() {
    const state = getState();
    if (!state || state.tutorial.done || !state.settings.hints) return null;
    const def = TUTORIAL_STEPS.find((s) => s.id === state.tutorial.step);
    if (def && def.id !== lastStepId) {
      lastStepId = def.id;
      sinceActivatedSec = 0;
    }
    return def || null;
  }

  function advanceTo(nextId) {
    const state = getState();
    if (!state || state.tutorial.done) return;
    if (nextId >= TUTORIAL_STEPS.length) {
      state.tutorial.done = true;
    } else {
      state.tutorial.step = nextId;
    }
    sinceActivatedSec = 0;
  }

  /** @param {number} dtSec */
  function update(dtSec) {
    const def = currentStepDef();
    if (!def || def.timeoutSec == null) return;
    sinceActivatedSec += dtSec;
    if (sinceActivatedSec >= def.timeoutSec) advanceTo(def.id + 1);
  }

  /**
   * @param {'tap'|'regionSelected'|'battleStart'|'send'|'capture'|'powerUsed'|'councilOpened'} event
   * @param {{power?: string}} [payload]
   */
  function notify(event, payload) {
    const def = currentStepDef();
    if (!def) return;
    if (EVENT_FOR_ADVANCE[def.advance] !== event) return;
    if (def.advance === 'powerUsed' && payload?.power !== 'rally') return;
    advanceTo(def.id + 1);
  }

  /** The coach's own dismiss (×) button: skip straight past this step. */
  function dismiss() {
    const def = currentStepDef();
    if (def) advanceTo(def.id + 1);
  }

  return { currentStepDef, update, notify, dismiss };
}
