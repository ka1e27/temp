// Bootstrap and wiring only. Everything interesting lives behind an interface
// this file merely connects; new scenes register through screens/index.js, so
// this stays short and stops changing.
import { createLoop } from './core/loop.js';
import { createBus } from './core/bus.js';
import { createSceneStack } from './core/scenes.js';
import { createStorageAdapter, bootstrapGame, createAutosaver } from './meta/save.js';
import { tick as tickIdle } from './meta/idle.js';
import { createScreens } from './screens/index.js';
import { qs } from './ui/dom.js';

const bus = createBus();
const storage = createStorageAdapter(window.localStorage);

// A save we cannot read is never overwritten — the player's progress stays on
// disk while they decide what to do about it.
const boot = bootstrapGame(storage, {
  now: Date.now(),
  seed: (Math.random() * 0xffffffff) >>> 0,
  bus,
});
const state = boot.state;

const autosaver = createAutosaver({ storage, bus });
if (boot.blocked) {
  autosaver.disable(boot.reason);
  console.warn(`Save could not be read (${boot.reason}); autosave is off to preserve it.`);
}

const scenes = createSceneStack({
  onError(err, phase, sceneId) {
    // A throwing scene must not wedge the whole stack.
    console.error(`scene "${sceneId}" failed during ${phase}:`, err);
  },
});

const ctx = {
  state, bus, scenes,
  root: qs('#screen-root'),
  hudRoot: qs('#hud'),
};
createScreens(ctx);

const loop = createLoop({
  update(dtMs) {
    // Idle income accrues in EVERY scene, including mid-battle. Playing the
    // game must never cost you the income you would have earned idling.
    tickIdle(state, dtMs, Date.now(), bus);
    scenes.update(dtMs);
    autosaver.update(state, Date.now());
  },
  render(alpha) {
    scenes.render(alpha);
  },
  now: () => performance.now(),
  raf: (cb) => requestAnimationFrame(cb),
  cancelRaf: (id) => cancelAnimationFrame(id),
});

scenes.replace(ctx.screens.worldmap, { offline: boot.offline });
loop.start();

// Long absences are handled by the closed-form offline calculation, never by
// ticking the simulation — so returning after eight hours costs one multiply.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) autosaver.flush(state, Date.now());
});
window.addEventListener('beforeunload', () => autosaver.flush(state, Date.now()));

// Dev overlay: ?dev=1 gives speed control, crown grants and a state inspector.
if (new URLSearchParams(location.search).has('dev')) {
  state.session.dev = true;
  import('./ui/devoverlay.js')
    .then((m) => m.mountDevOverlay({ state, bus, scenes, loop, ctx }))
    .catch(() => { /* overlay is optional; never block the game on it */ });
}

Object.assign(window, { __game: { state, bus, scenes, loop } });
