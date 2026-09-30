// Autosave every N seconds and on visibilitychange/pagehide (ARCHITECTURE §9,
// DESIGN §8). Storage/time/state access are all injected so this is testable
// without a real DOM or localStorage.
import { saveTo } from '../meta/save.js';
import { WORLD_SCENE } from '../scenes/timing.js';

/**
 * @param {{ storage: { setItem }, getState: () => object, now: () => number,
 *   canSave?: () => boolean }} deps  canSave gates writes (e.g. never persist an untouched
 *   realm that is only being shown behind the title screen).
 */
export function createAutosave({ storage, getState, now, canSave }) {
  let acc = 0;

  function save() {
    const state = getState();
    if (!state) return;
    if (canSave && !canSave()) return;
    state.lastSeen = now();
    try {
      saveTo(storage, state);
    } catch {
      // Storage can throw (quota exceeded, private-browsing lockout) — losing an
      // autosave tick must never crash the frame loop.
    }
  }

  /** @param {number} dtSec real (not battle-speed-scaled) elapsed seconds */
  function tick(dtSec) {
    acc += dtSec;
    if (acc >= WORLD_SCENE.autosaveIntervalSec) {
      acc = 0;
      save();
    }
  }

  /** Attaches the hide/pagehide hooks; returns a cleanup function. */
  function attachLifecycleHooks() {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') save();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', save);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', save);
    };
  }

  return { tick, save, attachLifecycleHooks };
}
