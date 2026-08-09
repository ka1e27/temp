// BATTLE SPEED: the ladder, the gate, and what pause and slow motion mean.
//
// Split out of ./battleui.test.js for the line budget when the three-button
// control (1x / 2x / 4x) became a sixteen-stop slider running 0.25x to 4x.
//
// Everything here is PURE: battle-keys.js and battle-speed.js keep the whole
// gate and the whole multiplier decision in functions that need no DOM, which
// is what makes "is 4x locked?" answerable in a test rather than by clicking.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SPEEDS, stepSpeedIndex, speedAllowed,
  NORMAL_SPEED_INDEX, FREE_SPEED_MAX, maxSpeedIndex, speedIndexOf,
} from '../src/screens/battle-keys.js';
import { effectiveSpeed, speedLabel } from '../src/screens/battle-speed.js';

test('speed: the ladder runs 0.25x to 4x in quarters, and slowing is never gated', () => {
  assert.equal(SPEEDS.length, 16);
  assert.equal(SPEEDS[0], 0.25, 'the slow end');
  assert.equal(SPEEDS.at(-1), 4, 'the fast end');
  assert.equal(SPEEDS[NORMAL_SPEED_INDEX], 1);
  for (let i = 1; i < SPEEDS.length; i++) {
    assert.ok(Math.abs((SPEEDS[i] - SPEEDS[i - 1]) - 0.25) < 1e-9, 'even quarter steps');
  }

  // Slow motion cannot win a battle you would otherwise lose, so charging for
  // it would be charging for legibility. Every speed at or below 1x is free.
  for (let i = 0; i <= NORMAL_SPEED_INDEX; i++) {
    assert.equal(speedAllowed(i, false), true, `${SPEEDS[i]}x must never be gated`);
  }
});

test('speed: past 2x still needs the Tactician upgrade, exactly as before', () => {
  const free = speedIndexOf(FREE_SPEED_MAX);
  assert.equal(speedAllowed(free, false), true, '2x was free before and stays free');
  assert.equal(speedAllowed(free + 1, false), false, 'anything past it is gated');
  assert.equal(speedAllowed(SPEEDS.length - 1, false), false, '4x above all');
  assert.equal(speedAllowed(SPEEDS.length - 1, true), true);

  assert.equal(maxSpeedIndex(false), free);
  assert.equal(maxSpeedIndex(true), SPEEDS.length - 1);

  // Stepping up hits the wall at 2x without the unlock, and 4x with it.
  assert.equal(stepSpeedIndex(free, 1, false), free);
  assert.equal(stepSpeedIndex(free, 1, true), free + 1);
  assert.equal(stepSpeedIndex(SPEEDS.length - 1, 1, true), SPEEDS.length - 1);
  assert.equal(stepSpeedIndex(0, -1, true), 0, 'and the slow end is a wall too');
});

test('speed: a saved preference snaps to the nearest real stop', () => {
  assert.equal(speedIndexOf(1), NORMAL_SPEED_INDEX);
  assert.equal(SPEEDS[speedIndexOf(0.25)], 0.25);
  assert.equal(SPEEDS[speedIndexOf(4)], 4);
  assert.equal(SPEEDS[speedIndexOf(0.6)], 0.5, 'a value between stops rounds to one');
  assert.equal(speedIndexOf(undefined), NORMAL_SPEED_INDEX, 'and nonsense is 1x');
  assert.equal(speedIndexOf(NaN), NORMAL_SPEED_INDEX);
});

test('speed: pause and slow-mo are multipliers, not a second code path', () => {
  const fast = SPEEDS.length - 1;
  assert.equal(effectiveSpeed({ index: NORMAL_SPEED_INDEX, paused: false, slow: false }), 1);
  assert.equal(effectiveSpeed({ index: fast, paused: false, slow: false }), 4);
  assert.equal(effectiveSpeed({ index: fast, paused: false, slow: true }), 0.35);
  assert.equal(effectiveSpeed({ index: fast, paused: true, slow: true }), 0, 'pause wins');
  assert.equal(speedLabel({ paused: true }), 'Speed · PAUSED');
  assert.equal(speedLabel({ slow: true }), 'Speed · SLOW-MO');
  assert.equal(speedLabel({ index: NORMAL_SPEED_INDEX }), 'Speed · 1×');
  assert.equal(speedLabel({ index: 0 }), 'Speed · 0.25×');
});

