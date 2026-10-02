// Autosave every N seconds and on visibilitychange/pagehide (ARCHITECTURE §9,
// DESIGN §8). Storage/time/state access are all injected so this is testable
// without a real DOM or localStorage.
//
// TWO TABS (the same origin shares one save): every write carries a rising `saveSeq`. A tab remembers the sequence it last LOADED or WROTE; before it writes it
// reads the stored one, and if another tab has written since (stored > remembered) it does NOT write: autosaving stops in this tab for good and `onConflict`
// raises the "open in another tab" banner. The `storage` event tells an idle tab at once. A tab that has not entered a session (it is only showing the title) never
// writes at all, so an idle tab can no longer erase the progress of the one being played.
import { saveTo, SAVE_KEY } from '../meta/save.js';
import { WORLD_SCENE } from '../scenes/timing.js';

/** The sequence number of a raw stored save (0 when absent or unreadable: a save from before sequences). */
export function storedSeq(raw) {
  if (raw == null) return 0;
  try {
    const v = JSON.parse(raw).saveSeq;
    return Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0;
  } catch {
    return 0;
  }
}

/**
 * @param {{ storage: { getItem?, setItem }, getState: () => object, now: () => number,
 *   canSave?: () => boolean, onConflict?: () => void, onFailure?: (err: unknown) => void }} deps
 *   canSave gates writes: the shell says yes only once the player has entered a session (Continue or New Realm).
 */
export function createAutosave({ storage, getState, now, canSave, onConflict, onFailure }) {
  let acc = 0;
  let known = null; // the sequence this tab last loaded or wrote
  let conflicted = false;
  let failedOnce = false;

  const readStored = () => {
    try { return storedSeq(storage.getItem ? storage.getItem(SAVE_KEY) : null); } catch { return 0; }
  };

  function conflict() {
    if (conflicted) return;
    conflicted = true;
    if (onConflict) onConflict();
  }

  function save() {
    const state = getState();
    if (!state) return;
    if (conflicted) return; // another tab owns the save now
    if (canSave && !canSave()) return;
    if (known === null) known = Math.max(0, Math.trunc(Number(state.saveSeq) || 0));
    const stored = readStored();
    if (stored > known) { conflict(); return; } // someone else wrote since we loaded: do NOT overwrite their progress
    state.lastSeen = now();
    const previous = state.saveSeq;
    state.saveSeq = known + 1;
    try {
      saveTo(storage, state);
      known = state.saveSeq;
      failedOnce = false;
    } catch (err) {
      // Storage can throw (quota exceeded, private-browsing lockout): losing an autosave tick must never crash the frame loop, but the player is told once.
      state.saveSeq = previous;
      if (!failedOnce) { failedOnce = true; if (onFailure) onFailure(err); }
    }
  }

  /** Another tab wrote the save (the `storage` event): if it is newer than what this tab knows, stop writing. */
  function onStorage(e) {
    if (e.key !== SAVE_KEY || e.newValue == null) return;
    if (known === null) { const st = getState(); known = st ? Math.max(0, Math.trunc(Number(st.saveSeq) || 0)) : 0; }
    if (storedSeq(e.newValue) > known) conflict();
  }

  /** @param {number} dtSec real (not battle-speed-scaled) elapsed seconds */
  function tick(dtSec) {
    acc += dtSec;
    if (acc >= WORLD_SCENE.autosaveIntervalSec) {
      acc = 0;
      save();
    }
  }

  /** Attaches the hide/pagehide/storage hooks; returns a cleanup function. */
  function attachLifecycleHooks() {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') save();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', save);
    window.addEventListener('storage', onStorage);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', save);
      window.removeEventListener('storage', onStorage);
    };
  }

  return {
    tick, save, attachLifecycleHooks, onStorage,
    get conflicted() { return conflicted; },
    get knownSeq() { return known; },
  };
}
