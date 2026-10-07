// The whole juice layer for battle events (DESIGN §7.4): particles, screen
// shake, ground decals. Renders on `#board-fx`'s 2D context; touches nothing
// but the canvas it is handed. See docs/ARCHITECTURE.md §6 (battle events)
// and §7 (rendering) for how this slots into the frame loop, and this
// module's own final-report table (from the engineer who wrote it) for the
// exact event → fx/sfx mapping.
//
// Composition: fx-pool.js is the zero-allocation particle allocator,
// fx-kinds.js is what each kind IS (spawn + per-frame update), fx-draw.js is
// how each kind is painted. This file just wires them together and is the
// only one of the four an integrator should ever need to import.
//
// A NOTE ON SCREEN SHAKE: `game/render/camera.js` (a different engineer's
// file) has ALSO grown its own `shake()`/`shakeX`/`shakeY`. That was written
// in parallel and independently of this module; it is not a mistake on
// either side, but the integrator should pick ONE canonical shake source
// (this module's `shake(strength, duration)` gives per-event duration
// control and works with fx.js's own gallery/demo camera, which has no
// shake of its own — the camera's version is already wired into its own
// `update(dt)` and needs no separate offset call). See the final report for
// a fuller note; nothing here calls into camera.js either way.
import { createPool, release, releaseAll } from './fx-pool.js';
import { SPAWNERS, updateParticle, isAdditiveKind, explodeFireball } from './fx-kinds.js';
import { drawParticle } from './fx-draw.js';
import { clamp01 } from './fx-easing.js';
import { effects } from './accessibility.js';

const DEFAULT_MAX_PARTICLES = 600;
const SHAKE_MAX_PX = 16; // CSS px at full intensity — matches camera.js's ballpark

/**
 * @typedef {{worldToScreen(x:number,y:number): {x:number,y:number}, zoom:number}} Camera
 */

/**
 * @param {{maxParticles?: number, reduceMotion?: boolean}} [opts]
 */
export function createFx({ maxParticles = DEFAULT_MAX_PARTICLES, reduceMotion = false } = {}) {
  const pool = createPool(maxParticles);
  let rm = !!reduceMotion;

  let shakeStrength = 0;
  let shakeElapsed = 0;
  let shakeDur = 0.001;

  function shakeIntensity() {
    const k = clamp01(1 - shakeElapsed / shakeDur);
    return shakeStrength * k * k; // eased falloff, not a linear ramp down
  }

  /**
   * @param {string} kind see DESIGN §7.4 / this file's header for the list
   * @param {number} x world units
   * @param {number} y world units
   * @param {object} [opts] kind-specific — see fx-kinds.js for each kind's fields
   */
  function spawn(kind, x, y, opts = {}) {
    const fn = SPAWNERS[kind];
    if (!fn) return; // unknown kind: silently ignored, never throws
    fn(pool, x, y, opts, rm);
  }

  /** Advance every particle and the shake decay by `dt` seconds. */
  function update(dt) {
    const safeDt = Math.min(Math.max(dt, 0), 0.25); // defensive; main.js already clamps
    for (let i = 0; i < pool.items.length; i++) {
      const p = pool.items[i];
      if (!p.alive) continue;
      const died = updateParticle(p, safeDt);
      if (died) {
        if (p.kind === 'fireball') explodeFireball(spawn, p.x, p.y, p.p3);
        release(pool, i);
      }
    }
    if (shakeElapsed < shakeDur) shakeElapsed = Math.min(shakeDur, shakeElapsed + safeDt);
  }

  /**
   * Paint every live particle. Two passes (normal blend, then additive
   * 'lighter' for fire/sparks/glow) rather than toggling composite mode per
   * particle. Saves/restores canvas state as a whole, so nothing here leaks
   * into whatever the renderer draws next (clouds, labels — ARCHITECTURE §7).
   * @param {CanvasRenderingContext2D} ctx2d
   * @param {Camera} cam
   */
  function draw(ctx2d, cam) {
    ctx2d.save();
    ctx2d.globalCompositeOperation = 'source-over';
    for (let i = 0; i < pool.items.length; i++) {
      const p = pool.items[i];
      if (p.alive && !isAdditiveKind(p.kind)) drawParticle(ctx2d, p, cam);
    }
    ctx2d.globalCompositeOperation = 'lighter';
    for (let i = 0; i < pool.items.length; i++) {
      const p = pool.items[i];
      if (p.alive && isAdditiveKind(p.kind)) drawParticle(ctx2d, p, cam);
    }
    ctx2d.restore();
  }

  /**
   * Trigger screen shake. A weaker/shorter shake never cuts a stronger one
   * short — it is simply dropped — so a Firestorm's shake still rings out
   * even if a small clash lands a moment later. No-op under reduceMotion.
   * @param {number} strength roughly 0..1
   * @param {number} duration seconds
   */
  function shake(strength, duration = 0.3) {
    if (rm) return;
    const incoming = Math.max(0, strength) * effects().shake; // Settings > Effects: Reduced halves it, Minimal has none
    if (incoming <= 0) return;
    if (incoming >= shakeIntensity()) {
      shakeStrength = incoming;
      shakeElapsed = 0;
      shakeDur = Math.max(0.05, duration);
    }
  }

  /**
   * The current shake displacement in CSS px, screen-space — add it to a
   * canvas translate (or to each worldToScreen result) at draw time. It is
   * deliberately not baked into any camera, so hit-testing never jitters.
   * @returns {{x: number, y: number}}
   */
  function shakeOffset() {
    const k = shakeIntensity();
    if (k <= 0) return { x: 0, y: 0 };
    return {
      x: Math.sin(shakeElapsed * 37.1) * SHAKE_MAX_PX * k,
      y: Math.sin(shakeElapsed * 29.7 + 1.7) * SHAKE_MAX_PX * k,
    };
  }

  /** Toggle reduced motion: shorter/fewer/no-shake from here on (DESIGN §7.4). */
  function setReduceMotion(v) {
    rm = !!v;
    if (rm) {
      shakeStrength = 0;
      shakeElapsed = shakeDur;
    }
  }

  /** Kill everything and reset shake (e.g. leaving a battle). */
  function clear() {
    releaseAll(pool);
    shakeStrength = 0;
    shakeElapsed = shakeDur;
  }

  /** Number of currently-alive particles, for a debug HUD. */
  function count() {
    return pool.activeCount;
  }

  return { spawn, update, draw, shake, shakeOffset, setReduceMotion, clear, count };
}
