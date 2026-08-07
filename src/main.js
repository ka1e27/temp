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

let lastIdleAt = Date.now();

const loop = createLoop({
  update(dtMs) {
    const now = Date.now();
    // Idle income accrues in EVERY scene, including mid-battle: playing must
    // never cost you the income you would have earned idling.
    //
    // It accrues on the WALL clock, never the simulation clock. The battle
    // speed control makes the loop tick up to 4x as often, and paying per tick
    // would turn it into a money printer. Clamped because a long stall is the
    // offline calculation's job, not this one's.
    const realMs = Math.min(Math.max(0, now - lastIdleAt), 1000);
    lastIdleAt = now;
    tickIdle(state, realMs, now, bus);
    scenes.update(dtMs);
    autosaver.update(state, now);
  },
  render(alpha, frameMs) {
    scenes.render(alpha, frameMs);
  },
  now: () => performance.now(),
  raf: (cb) => requestAnimationFrame(cb),
  cancelRaf: (id) => cancelAnimationFrame(id),
});

// Scenes are built before the loop exists, so the battle HUD reads the speed
// control off ctx lazily rather than capturing it. The autosaver is exposed so
// a destructive action (New Campaign, Import) can flush immediately instead of
// waiting out the 5s tick.
ctx.loop = loop;
ctx.autosaver = autosaver;
ctx.storage = storage;

// The menu owns the boot decision and can explain a refused save; on a brand
// new save it routes straight into region 1 rather than making anyone read a
// menu before their first game.
scenes.replace(ctx.screens.mainmenu, {
  offline: boot.offline,
  blocked: boot.blocked,
  reason: boot.reason,
});
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
