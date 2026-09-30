// Frame-loop timing helpers for game/main.js (ARCHITECTURE §9).
//
// Pure math, no DOM: `tick` and `advance` are handed the current time / dt
// from outside rather than reading `performance.now`/`requestAnimationFrame`
// themselves, so both are exercised directly from plain Node
// (see game/tests/input.test.js).
//
// NOTE ON PLACEMENT: this is the frame-loop helper the integrator asked for
// under `game/core/loop.js`. It lives here instead — `game/core` belongs to
// another engineer, and this file is otherwise pure input-adjacent timing
// plumbing, so `game/input/clock.js` is the non-colliding home for it.

const MAX_DT = 0.25; // seconds; matches ARCHITECTURE §9's clamp

/**
 * @returns {{ tick(nowMs: number): number }}
 *   `tick(nowMs)` returns the elapsed time since the previous call, in
 *   seconds, clamped to [0, MAX_DT]. The very first call has no previous
 *   frame to diff against, so it returns 0.
 */
export function createClock() {
  let last = null;
  return {
    tick(nowMs) {
      if (last === null) {
        last = nowMs;
        return 0;
      }
      const dt = (nowMs - last) / 1000;
      last = nowMs;
      if (!Number.isFinite(dt) || dt <= 0) return 0;
      return Math.min(dt, MAX_DT);
    },
  };
}

/**
 * A fixed-timestep accumulator for the battle sim (stepped at a constant
 * `stepSec` regardless of frame rate) that hands back an interpolation alpha
 * for rendering between the last two simulated states.
 *
 * Caps steps per call at `cap` (~12) and then DROPS the remaining debt
 * (rather than merely refusing to run more than `cap` steps while leaving a
 * huge accumulator that forces `cap` steps again next frame, and the frame
 * after that) — that difference is what actually avoids the spiral of death
 * after a long stall (a slow tab, a dev-tools breakpoint, a backgrounded
 * page) instead of just turning it into a slow-motion crawl back to realtime.
 *
 * @param {number} stepSec fixed simulation step, e.g. 0.05
 * @param {number} [cap] max steps to run in a single `advance` call
 * @returns {{ advance(dtSec: number, speed: number, stepFn: () => void): number }}
 */
export function createFixedStepper(stepSec, cap = 12) {
  let acc = 0;
  const maxAcc = stepSec * cap;
  return {
    advance(dtSec, speed, stepFn) {
      acc += Math.max(0, dtSec) * Math.max(0, speed);
      if (acc > maxAcc) acc = maxAcc;
      let steps = 0;
      while (acc >= stepSec && steps < cap) {
        stepFn();
        acc -= stepSec;
        steps++;
      }
      return stepSec > 0 ? acc / stepSec : 0;
    },
  };
}
