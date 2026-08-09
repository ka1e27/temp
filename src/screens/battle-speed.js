// Battle speed: a segmented 1x / 2x / 4x control, real pause, and held-Space
// slow motion.
//
// `loop.setSpeed()` has existed since day one with NO caller, and `ui:slowmo` /
// `ui:pause` have been emitted into a bus nobody subscribed to. Everything the
// player can do to time in a battle funnels through this one module, so there
// is exactly one place that knows what multiplier is currently in force.
//
// The sim is fixed-timestep, so this changes no game logic whatsoever: it
// changes how many fixed ticks a wall-clock second buys.
import { hasMod } from '../battle/contract.js';
import { h, bindText, bindClass, createDisposer } from '../ui/dom.js';
import {
  SPEEDS, SLOWMO, PAUSED, SPEED_FEATURE, SPEED_UPGRADE_NAME, stepSpeedIndex, speedAllowed,
} from './battle-keys.js';

/** What multiplier a given control state means. PURE. */
export function effectiveSpeed({ index, paused, slow }) {
  if (paused) return PAUSED;
  if (slow) return SLOWMO;
  return SPEEDS[index] ?? 1;
}

/** The group label doubles as the state readout, so pause and slow-mo are
 *  visible without a stylesheet having to exist yet. PURE. */
export function speedLabel({ paused, slow }) {
  if (paused) return 'Speed · PAUSED';
  if (slow) return 'Speed · SLOW-MO';
  return 'Speed';
}

/**
 * @param {{bus?:object, onSetSpeed?:(n:number)=>void}} o
 *   `onSetSpeed(multiplier)` is handed down from the scene, which owns the
 *   loop: 0 pauses, 0.35 is slow motion, 1/2/4 are the segmented speeds.
 *   Nothing in presentation may reach the loop directly.
 */
export function createSpeedControl(o) {
  const off = createDisposer();
  const apply = o.onSetSpeed || (() => {});
  const state = { index: 0, paused: false, slow: false };
  let sent = null;
  let unlocked = null;

  const label = h('span.hud-group-label', { text: 'Speed' });
  const pause = h('button.seg.hud-pause', {
    'data-interactive': true, type: 'button', title: 'Pause — key P', 'aria-pressed': 'false',
  }, 'II');
  const segs = SPEEDS.map((mult) => h('button.seg.hud-speed', {
    'data-interactive': true, type: 'button', 'aria-pressed': 'false',
    title: `${mult}x battle speed — keys [ and ]`,
  }, `${mult}×`));
  // Label as its own header row, controls in a row below — see battle-hud.js
  // for why the other three dock cards use the same `.hud-group-row` shape.
  const el = h('div.hud-group.hud-speeds.panel', { role: 'group', 'aria-label': 'Battle speed' },
    label, h('div.hud-group-row', {}, pause, ...segs));

  pause.addEventListener('click', () => setPaused(!state.paused));
  segs.forEach((btn, i) => btn.addEventListener('click', () => setIndex(i)));

  const set = {
    label: bindText(label, 'Speed'),
    paused: bindClass(pause, 'is-on'),
    slow: bindClass(el, 'is-slow'),
  };
  const segOn = segs.map((b) => bindClass(b, 'is-on'));
  const segLock = segs.map((b) => bindClass(b, 'is-locked'));

  function push() {
    const next = effectiveSpeed(state);
    if (next === sent) return;
    sent = next;
    apply(next);
  }

  function setIndex(i) {
    if (!speedAllowed(i, unlocked === true)) return;
    state.index = i;
    state.paused = false;
    push();
    paint();
  }
  function setPaused(on) {
    state.paused = !!on;
    push();
    paint();
  }
  function setSlow(on) {
    if (state.slow === !!on) return;
    state.slow = !!on;
    push();
    paint();
  }
  function step(dir) {
    setIndex(stepSpeedIndex(state.index, dir, unlocked === true));
  }

  function paint() {
    set.label(speedLabel(state));
    set.paused(state.paused);
    set.slow(state.slow);
    pause.setAttribute('aria-pressed', state.paused ? 'true' : 'false');
    for (let i = 0; i < segs.length; i++) {
      const on = !state.paused && !state.slow && state.index === i;
      if (segOn[i](on)) segs[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  if (o.bus) {
    off(o.bus.on('ui:pause', () => setPaused(!state.paused)));
    off(o.bus.on('ui:slowmo', () => setSlow(true)));
    off(o.bus.on('ui:slowmo-end', () => setSlow(false)));
    off(o.bus.on('ui:speed-step', (dir) => step(dir)));
  }
  paint();
  push();

  return {
    el,
    /** 10Hz. Only touches the DOM when the unlock state actually changes. */
    update(battle) {
      const now = hasMod(battle?.mods?.player, SPEED_FEATURE);
      if (now === unlocked) return;
      unlocked = now;
      for (let i = 0; i < SPEEDS.length; i++) {
        const locked = !speedAllowed(i, now);
        segLock[i](locked);
        segs[i].disabled = locked;
        segs[i].title = locked
          ? `${SPEEDS[i]}× battle speed — unlocked by the ${SPEED_UPGRADE_NAME} upgrade`
          : `${SPEEDS[i]}× battle speed — keys [ and ]`;
      }
      if (!speedAllowed(state.index, now)) setIndex(stepSpeedIndex(state.index, -1, now));
    },
    /** Time is global: leaving the battle at 4x or paused must not leave the
     *  world map running at 4x or frozen. */
    dispose() {
      off.dispose();
      sent = null;
      apply(1);
    },
    get state() { return state; },
    setIndex,
    setPaused,
    step,
  };
}
