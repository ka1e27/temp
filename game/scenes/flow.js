// Minimal scene manager (ARCHITECTURE §9 "scene flow"): switches between
// title/world/battle scene objects, each `{ enter(payload), exit(payload),
// frame(dt, t, nowMs) }`. All the shared services (camera, input, renderer,
// UI) are constructed once in main.js and closed over by each scene factory —
// this file only sequences enter/exit and forwards the frame tick.
//
// A scene that THROWS while it is being entered never stays half-entered: it is exited quietly, the previous scene is entered again (as "coming back"), and
// `onError(error, name, previousName)` hears about it (main.js turns that into a toast). A battle whose arena cannot be built used to leave a stale battle HUD,
// a Retreat that did nothing and an error on every frame.
export function createSceneManager({ onError } = {}) {
  let current = null;
  let currentName = null;

  /** @returns {boolean} false when the scene could not be entered (the previous one is back) */
  function goto(name, scene, payload) {
    const prev = current;
    const prevName = currentName;
    if (prev && typeof prev.exit === 'function') prev.exit(payload);
    current = scene;
    currentName = name;
    try {
      if (current && typeof current.enter === 'function') current.enter(payload);
      return true;
    } catch (err) {
      // never leave a half-entered scene up: close it, and put the player back where they were
      try { if (scene && typeof scene.exit === 'function') scene.exit(payload); } catch { /* it was never fully in */ }
      current = prev;
      currentName = prevName;
      if (prev && prev !== scene && typeof prev.enter === 'function') {
        try { prev.enter(prevName === 'world' ? { cameFromBattle: true, reverted: true } : { reverted: true }); } catch { /* nothing more to fall back on */ }
      }
      if (typeof onError === 'function') onError(err, name, prevName);
      else throw err;
      return false;
    }
  }

  function frame(dt, t, nowMs) {
    if (current && typeof current.frame === 'function') current.frame(dt, t, nowMs);
  }

  return {
    goto,
    frame,
    get name() { return currentName; },
    get current() { return current; },
  };
}
