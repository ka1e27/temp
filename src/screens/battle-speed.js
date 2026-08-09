// Battle speed: a 0.25x-4x slider, real pause, and held-Space slow motion.
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
  SPEEDS, SLOWMO, PAUSED, SPEED_FEATURE, SPEED_UPGRADE_NAME, NORMAL_SPEED_INDEX,
  FREE_SPEED_MAX, stepSpeedIndex, speedAllowed, maxSpeedIndex, speedIndexOf,
} from './battle-keys.js';

/** What multiplier a given control state means. PURE. */
export function effectiveSpeed({ index, paused, slow }) {
  if (paused) return PAUSED;
  if (slow) return SLOWMO;
  return SPEEDS[index] ?? 1;
}

/** The group label doubles as the state readout, so pause, slow-mo and the
 *  chosen multiplier are visible without a stylesheet having to exist yet.
 *  PURE. */
export function speedLabel({ paused, slow, index }) {
  if (paused) return 'Speed · PAUSED';
  if (slow) return 'Speed · SLOW-MO';
  return `Speed · ${SPEEDS[index] ?? 1}×`;
}

/**
 * @param {{bus?:object, onSetSpeed?:(n:number)=>void, initialSpeed?:number}} o
 *   `onSetSpeed(multiplier)` is handed down from the scene, which owns the
 *   loop: 0 pauses, 0.35 is slow motion, anything on the SPEEDS ladder is a
 *   chosen speed. Nothing in presentation may reach the loop directly.
 *   `initialSpeed` is the player's saved preference (meta.settings.defaultSpeed).
 */
export function createSpeedControl(o) {
  const off = createDisposer();
  const apply = o.onSetSpeed || (() => {});
  const state = {
    index: o.initialSpeed ? speedIndexOf(o.initialSpeed) : NORMAL_SPEED_INDEX,
    paused: false,
    slow: false,
  };
  let sent = null;
  let unlocked = null;

  const label = h('span.hud-group-label', { text: 'Speed' });
  const pause = h('button.seg.hud-pause', {
    'data-interactive': true, type: 'button', title: 'Pause — key P', 'aria-pressed': 'false',
  }, 'II');
  // One slider over the ladder INDEX rather than over the multiplier itself, so
  // the stops are exactly the legal speeds and no interpolation is possible.
  const slider = h('input.hud-speed-slider', {
    type: 'range', min: '0', max: `${SPEEDS.length - 1}`, step: '1',
    value: `${state.index}`,
    'data-interactive': true,
    'aria-label': 'Battle speed',
    on: { input: () => setIndex(readIndex()) },
  });
  const el = h('div.hud-group.hud-speeds.panel', { role: 'group', 'aria-label': 'Battle speed' },
    label, h('div.hud-group-row', {}, pause, slider));

  pause.addEventListener('click', () => setPaused(!state.paused));

  const readIndex = () => (Number.isFinite(slider.valueAsNumber)
    ? slider.valueAsNumber : Number(slider.value)) | 0;

  const set = {
    label: bindText(label, 'Speed'),
    paused: bindClass(pause, 'is-on'),
    slow: bindClass(el, 'is-slow'),
    locked: bindClass(el, 'is-capped'),
  };

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
    if (readIndex() !== state.index) slider.value = `${state.index}`;
    slider.setAttribute('aria-valuetext', `${SPEEDS[state.index]} times`);
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
      // The slider's own `max` carries the gate, so a locked speed is not
      // reachable by dragging rather than reachable-then-refused. Slowing down
      // is never gated, so the low end never moves.
      const top = maxSpeedIndex(now);
      slider.setAttribute('max', `${top}`);
      set.locked(top < SPEEDS.length - 1);
      slider.title = top < SPEEDS.length - 1
        ? `Battle speed — keys [ and ]. Past ${FREE_SPEED_MAX}× needs the ${SPEED_UPGRADE_NAME} upgrade`
        : 'Battle speed — keys [ and ]';
      if (!speedAllowed(state.index, now)) setIndex(top);
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
