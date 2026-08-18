// HAS THIS BATTLE STOPPED BEING A BATTLE?
//
// `Withdraw` is always on screen and withdrawing is genuinely free — a retreat
// does not increment `stats.losses` and leaves the region untouched — so the
// tool to cut a dead battle short already existed. Nothing ever told the player
// they were in one, and a timeout is not an early exit the sim takes when
// nothing is happening: `endPhase` only assigns one at `hardCapTicks`, so every
// minute of a frozen board is paid in full.
//
// Measured on real battles: widowsgate locks at 7 sites v 48 by minute 9 and
// does not move a single site for the remaining 25 minutes — 74% of a
// 34-minute cap. Gallowmoor locks at minute 26 and sits for 12 more.
//
// The counter-example is what keeps this a NUDGE rather than an auto-resign:
// duskfell was genuinely contested to the wire and decided in the last 5% of
// its clock. A still tally is not proof of a lost battle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stalemateCheck } from '../src/screens/battle-alert.js';

const HZ = 10;
const fresh = () => ({ tally: null, since: 0, warnedAt: 0 });
/** Run the check across a span of ticks, collecting the ticks it warned at. */
function play(steps) {
  const memo = fresh();
  const now = { tally: '', tick: 0, hz: HZ };
  const warned = [];
  for (const [tick, tally] of steps) {
    now.tick = tick; now.tally = tally;
    if (stalemateCheck(now, memo)) warned.push(tick);
  }
  return { warned, memo };
}

const still = (tally, from, to, stepSec = 10) => {
  const out = [];
  for (let t = from; t <= to; t += stepSec * HZ) out.push([t, tally]);
  return out;
};

test('a board that keeps moving never warns', () => {
  const steps = [];
  for (let m = 0; m < 30; m++) steps.push([m * 60 * HZ, `${3 + m} v ${20 - m}`]);
  assert.deepEqual(play(steps).warned, [], 'a live battle must never be called stalled');
});

test('a board frozen for three minutes warns once', () => {
  const { warned } = play(still('7 v 48', 5 * 60 * HZ, 9 * 60 * HZ));
  assert.equal(warned.length, 1, `warned ${warned.length} times`);
});

test('...and keeps quiet for two minutes before saying it again', () => {
  // A nag every frame would be worse than silence. The repeat window is long
  // enough that the second warning means "still stalled", not "still here".
  const { warned } = play(still('7 v 48', 5 * 60 * HZ, 20 * 60 * HZ));
  assert.ok(warned.length >= 2, 'a 15-minute freeze should say so more than once');
  for (let i = 1; i < warned.length; i++) {
    const gapSec = (warned[i] - warned[i - 1]) / HZ;
    assert.ok(gapSec >= 120, `warned again after only ${gapSec}s`);
  }
});

test('an opening where nothing has happened yet is not a stalemate', () => {
  // The first two minutes of every battle have a still tally by construction —
  // nothing has changed hands. Calling that a stalemate would fire the warning
  // on every battle in the game, which is the same as never firing it.
  const { warned } = play(still('3 v 5', 0, 119 * HZ, 5));
  assert.deepEqual(warned, []);
});

test('the board moving RESETS the clock, so a slow grind never warns', () => {
  // One capture every two and a half minutes is slow, not stalled.
  const steps = [];
  let n = 3;
  for (let t = 0; t < 30 * 60 * HZ; t += 10 * HZ) {
    if (t % (150 * HZ) === 0) n++;
    steps.push([t, `${n} v 20`]);
  }
  assert.deepEqual(play(steps).warned, [], 'a grind is not a freeze');
});

test('losing ground counts as movement — a collapse is not a stalemate', () => {
  const steps = [];
  for (let m = 0; m < 20; m++) steps.push([m * 60 * HZ, `${20 - m} v ${5 + m}`]);
  assert.deepEqual(play(steps).warned, []);
});

test('the memo is scratch: reused across frames, never reallocated', () => {
  // The check runs every frame of every battle, so it must not allocate. It
  // mutates the caller's object in place and returns a boolean.
  const memo = fresh();
  const before = memo;
  const now = { tally: '4 v 9', tick: 0, hz: HZ };
  for (let t = 0; t < 6000; t += 100) { now.tick = t; stalemateCheck(now, memo); }
  assert.equal(memo, before, 'the memo must be mutated, not replaced');
  assert.equal(memo.tally, '4 v 9');
});

test('the thresholds are injectable, so a test never waits three real minutes', () => {
  const memo = fresh();
  const now = { tally: '1 v 1', tick: 0, hz: HZ };
  const opts = { quietSec: 5, repeatSec: 5, minTick: 0 };
  const warned = [];
  for (let t = 0; t <= 300; t += 10) { now.tick = t; if (stalemateCheck(now, memo, opts)) warned.push(t); }
  assert.ok(warned.length >= 2);
  assert.equal(warned[0], 50, 'first warning exactly at the quiet threshold');
});
