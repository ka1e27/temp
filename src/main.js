// Bootstrap and wiring only. Everything interesting lives behind an interface
// this file merely connects; new scenes register through screens/index.js, so
// this stays short and stops changing.
import { createLoop } from './core/loop.js';
import { createBus } from './core/bus.js';
import { createSceneStack } from './core/scenes.js';
import {
  createStorageAdapter, bootstrapGame, createAutosaver, loadBackup,
} from './meta/save.js';
import { tickOrCatchUp as tickIdle } from './meta/idle.js';
import { loadBattle } from './meta/resume.js';
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
    // would turn it into a money printer.
    //
    // A LONG STALL IS CREDITED, NOT DISCARDED. This used to clamp the gap to
    // one second and drop the rest, on the reasoning that a long stall was the
    // offline calculation's job — but that calculation only ever ran at boot,
    // so a lid closed mid-session paid one second of an eight-hour absence
    // while simply closing the tab paid the full cap. `tickOrCatchUp` routes a
    // real gap through that same closed-form path; see meta/idle.js.
    const gapMs = Math.max(0, now - lastIdleAt);
    lastIdleAt = now;
    tickIdle(state, gapMs, now, bus);
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

// An interrupted battle wins over every other boot route. A fight runs 8-14
// minutes and losing one to an accidental refresh is the papercut that stops
// people playing — so resume it rather than asking, since Withdraw is a real
// button if they would rather leave. Anything stale, corrupt or from an older
// contract was already discarded on the way out of storage.
//
// ...EXCEPT OVER A REFUSED SAVE, and that exception is the same bug this project
// has already fixed once. `bootstrapGame` hands back a blank state when it cannot
// read the file, and A BLANK STATE IS INDISTINGUISHABLE FROM A FRESH CAMPAIGN —
// which is how the menu once took its "nothing to continue, straight into region
// 1" early return twenty lines above the refusal message and silently started a
// new game over somebody's empire (see screens/mainmenu-recovery.js, and the
// `!params?.blocked` guard in screens/mainmenu.js that answers it there).
//
// The resume route is that same early return one layer out. `meta/resume.js`
// validates the CONTRACT, never the campaign, so a live blob passes on its own
// merits while the empire it belongs to is unreadable: the player is dropped
// straight into a battle for region 21 against a level-0 meta, with no message,
// no shop and no recovery affordance — and on finish `applyOutcome` pays a
// first-clear bonus into a blank meta that autosave is (correctly) refusing to
// write. A blocked boot must reach the one screen that can explain itself.
//
// NEITHER FILE IS DESTROYED HERE. The save is the player's progress and the whole
// point of blocking is to preserve it; the blob is merely ephemeral, and it is not
// this route's business to throw away a battle that may yet be resumable once the
// save is restored from backup. Whatever the player chooses next — restore, wipe,
// or import — goes through `adoptCampaign`, which drops the blob for the reason
// screens/mainmenu-legacy.js states: a mid-battle blob must not outlive the empire
// it belongs to.
const interrupted = boot.blocked
  ? { ok: false, reason: 'save-blocked' }
  : loadBattle(storage, Date.now());
if (interrupted.ok) {
  scenes.replace(ctx.screens.battle, { resume: interrupted });
} else {
  // The menu owns the boot decision and can explain a refused save; on a brand
  // new save it routes straight into region 1 rather than making anyone read a
  // menu before their first game.
  scenes.replace(ctx.screens.mainmenu, {
    offline: boot.offline,
    blocked: boot.blocked,
    reason: boot.reason,
    // Read HERE rather than in the screen, so the menu never touches storage
    // itself — the same reason `offline` and `blocked` are passed in. Only
    // attempted when the main file was refused, because that is the only time
    // anybody wants the older one.
    backup: boot.blocked ? loadBackup(storage, { now: Date.now() }) : null,
  });
}
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

// `screens` joins the handle so tools/smoke.mjs can put the game into a state a
// fresh save cannot reach in the seconds a smoke test has — a finished campaign,
// which is the gate on both endgame surfaces. It drives them with real pointer
// events from there; this only replaces the twenty-four battles in between.
Object.assign(window, { __game: { state, bus, scenes, loop, screens: ctx.screens } });
