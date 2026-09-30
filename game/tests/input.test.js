import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createClock, createFixedStepper } from '../input/clock.js';
import {
  tapThreshold, normalizeWheelDelta, wheelZoomFactor,
  pinchMidpoint, pinchSpread, velocityFromSamples, LONG_PRESS_MS,
} from '../input/pointer.js';

// ---------------------------------------------------------------------------
// game/input/clock.js — pure, so exercised directly with synthetic timestamps.
// ---------------------------------------------------------------------------

describe('createClock', () => {
  test('first tick has no previous frame, returns 0', () => {
    const clock = createClock();
    assert.equal(clock.tick(1000), 0);
  });

  test('returns elapsed seconds between calls', () => {
    const clock = createClock();
    clock.tick(1000);
    assert.ok(Math.abs(clock.tick(1016) - 0.016) < 1e-9);
    assert.ok(Math.abs(clock.tick(1032) - 0.016) < 1e-9);
  });

  test('clamps dt to 0.25s (a stall or a backgrounded tab)', () => {
    const clock = createClock();
    clock.tick(0);
    assert.equal(clock.tick(5000), 0.25);
  });

  test('never returns a negative dt if time appears to go backwards', () => {
    const clock = createClock();
    clock.tick(1000);
    assert.equal(clock.tick(900), 0);
  });
});

describe('createFixedStepper', () => {
  test('steps the right number of times for a clean multiple of stepSec', () => {
    const stepper = createFixedStepper(0.05);
    let steps = 0;
    const alpha = stepper.advance(0.2, 1, () => steps++);
    assert.equal(steps, 4);
    assert.ok(alpha < 1e-9);
  });

  test('returns a fractional alpha for the leftover time', () => {
    const stepper = createFixedStepper(0.05);
    let steps = 0;
    const alpha = stepper.advance(0.12, 1, () => steps++);
    assert.equal(steps, 2);
    assert.ok(Math.abs(alpha - 0.4) < 1e-9); // 0.02 leftover / 0.05
  });

  test('speed multiplies simulated time (0 = paused, 2 = double speed)', () => {
    const paused = createFixedStepper(0.05);
    let pausedSteps = 0;
    paused.advance(1, 0, () => pausedSteps++);
    assert.equal(pausedSteps, 0);

    const doubled = createFixedStepper(0.05);
    let doubledSteps = 0;
    doubled.advance(0.1, 2, () => doubledSteps++); // 0.2s of sim time / 0.05 = 4
    assert.equal(doubledSteps, 4);
  });

  test('caps steps per call at ~12 and DROPS the debt (no spiral of death)', () => {
    const stepper = createFixedStepper(0.05, 12);
    let steps = 0;
    // A monstrous stall: 10 real seconds in one call would naively demand 200 steps.
    const alpha = stepper.advance(10, 1, () => steps++);
    assert.equal(steps, 12);
    // If the debt were kept instead of dropped, the NEXT ordinary frame would
    // also be forced to run a full 12 steps just to pay it down — assert the
    // very next normal frame behaves like a normal frame instead.
    let nextSteps = 0;
    stepper.advance(1 / 60, 1, () => nextSteps++);
    assert.ok(nextSteps <= 1, `expected the accumulator debt to be dropped, not carried; got ${nextSteps} steps`);
    assert.ok(alpha >= 0 && alpha < 1);
  });

  test('accumulates leftover across calls', () => {
    const stepper = createFixedStepper(0.1);
    let steps = 0;
    stepper.advance(0.06, 1, () => steps++); // 0.06 acc, no step yet
    assert.equal(steps, 0);
    stepper.advance(0.05, 1, () => steps++); // 0.11 acc -> one step, 0.01 left
    assert.equal(steps, 1);
  });
});

// ---------------------------------------------------------------------------
// game/input/pointer.js — the DOM plumbing needs a browser (see
// tools/gallery/input-check.mjs for that), but the fiddly math is pulled out
// into small pure functions and is fully exercised here.
// ---------------------------------------------------------------------------

describe('pointer.js pure helpers', () => {
  test('tapThreshold: 6px mouse, 10px everything else', () => {
    assert.equal(tapThreshold('mouse'), 6);
    assert.equal(tapThreshold('touch'), 10);
    assert.equal(tapThreshold('pen'), 10);
  });

  test('LONG_PRESS_MS matches the 450ms spec', () => {
    assert.equal(LONG_PRESS_MS, 450);
  });

  describe('normalizeWheelDelta', () => {
    test('deltaMode 0 (pixel) passes through unchanged', () => {
      assert.deepEqual(normalizeWheelDelta(3, -100, 0), { dx: 3, dy: -100 });
    });
    test('deltaMode 1 (line) scales up to pixel-ish units', () => {
      const { dy } = normalizeWheelDelta(0, -3, 1);
      assert.equal(dy, -48);
    });
    test('deltaMode 2 (page) scales up further', () => {
      const { dy } = normalizeWheelDelta(0, 1, 2);
      assert.equal(dy, 800);
    });
  });

  describe('wheelZoomFactor', () => {
    test('scrolling up (negative dy) zooms in (factor > 1)', () => {
      assert.ok(wheelZoomFactor(-100) > 1);
    });
    test('scrolling down (positive dy) zooms out (factor < 1)', () => {
      assert.ok(wheelZoomFactor(100) < 1);
    });
    test('no delta means no zoom change', () => {
      assert.equal(wheelZoomFactor(0), 1);
    });
    test('is symmetric in log-space for +/- the same delta', () => {
      assert.ok(Math.abs(Math.log(wheelZoomFactor(50)) + Math.log(wheelZoomFactor(-50))) < 1e-12);
    });
  });

  describe('pinch geometry', () => {
    test('pinchMidpoint is the arithmetic mean of the two points', () => {
      assert.deepEqual(pinchMidpoint(0, 0, 10, 20), { x: 5, y: 10 });
    });
    test('pinchSpread is the Euclidean distance between the two points', () => {
      assert.equal(pinchSpread(0, 0, 3, 4), 5);
    });
  });

  describe('velocityFromSamples', () => {
    test('fewer than 2 samples yields zero velocity', () => {
      assert.deepEqual(velocityFromSamples([]), { vx: 0, vy: 0 });
      assert.deepEqual(velocityFromSamples([{ t: 0, sx: 0, sy: 0 }]), { vx: 0, vy: 0 });
    });
    test('computes px/s from the oldest and newest sample', () => {
      const samples = [
        { t: 0, sx: 0, sy: 0 },
        { t: 50, sx: 5, sy: -5 },
        { t: 100, sx: 12, sy: -12 },
      ];
      const v = velocityFromSamples(samples);
      assert.ok(Math.abs(v.vx - 120) < 1e-9); // 12px / 0.1s
      assert.ok(Math.abs(v.vy - -120) < 1e-9);
    });
    test('zero elapsed time yields zero velocity rather than Infinity', () => {
      const samples = [{ t: 10, sx: 0, sy: 0 }, { t: 10, sx: 50, sy: 50 }];
      assert.deepEqual(velocityFromSamples(samples), { vx: 0, vy: 0 });
    });
  });
});
