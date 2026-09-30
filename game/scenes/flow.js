// Minimal scene manager (ARCHITECTURE §9 "scene flow"): switches between
// title/world/battle scene objects, each `{ enter(payload), exit(payload),
// frame(dt, t, nowMs) }`. All the shared services (camera, input, renderer,
// UI) are constructed once in main.js and closed over by each scene factory —
// this file only sequences enter/exit and forwards the frame tick.
export function createSceneManager() {
  let current = null;
  let currentName = null;

  function goto(name, scene, payload) {
    const prev = current;
    if (prev && typeof prev.exit === 'function') prev.exit(payload);
    current = scene;
    currentName = name;
    if (current && typeof current.enter === 'function') current.enter(payload);
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
