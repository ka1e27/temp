// Idle economy: accrual, the offline cap, and the two clocks that break it —
// a 30-day gap and a clock that steps backwards.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createState } from '../src/core/store.js';
import { OFFLINE } from '../src/content/upgrades.data.js';
import { REGION_BY_ID } from '../src/content/regions.data.js';
import {
  incomePerSec, baseIncomePerSec, recalcIncome, accrue, tick,
  applyOfflineProgress, offlineCapMs, timeToAfford, projectCrowns,
} from '../src/meta/idle.js';
import { markConquered } from '../src/meta/world.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** A state with a fixed clock and a chosen set of conquered regions. */
function world(regionIds = [], upgrades = {}, now = 0) {
  const s = createState({ seed: 7, now });
  for (const id of regionIds) s.meta.regions[id].status = 'conquered';
  Object.assign(s.meta.upgrades, upgrades);
  recalcIncome(s.meta);
  return s;
}

test('income is the sum of conquered region rewards', () => {
  assert.equal(incomePerSec(world([])), 0);
  assert.equal(incomePerSec(world(['riverfen'])), 1.0);
  const s = world(['riverfen', 'ashford', 'ironwood', 'saltmere']);
  assert.equal(baseIncomePerSec(s), 5.5);
  assert.equal(incomePerSec(s), 5.5);
});

test('unconquered regions pay nothing no matter their status', () => {
  const s = createState({ seed: 1, now: 0 });
  s.meta.regions.ashford.status = 'available';
  assert.equal(incomePerSec(s), 0);
});

test('Tithe levels are additive, not compounding', () => {
  const one = incomePerSec(world(['riverfen'], { tithe: 1 }));
  const two = incomePerSec(world(['riverfen'], { tithe: 2 }));
  const five = incomePerSec(world(['riverfen'], { tithe: 5 }));
  assert.equal(one, 1.15);
  assert.ok(Math.abs(two - 1.30) < 1e-12, `+15% twice is +30%, got ${two}`);
  assert.ok(Math.abs(five - 1.75) < 1e-12);
  assert.notEqual(two, 1.15 * 1.15); // NOT compounding
});

test('recalcIncome caches onto meta.incomePerSec', () => {
  const s = world(['riverfen', 'ashford']);
  assert.equal(s.meta.incomePerSec, 2.2);
  s.meta.regions.ironwood.status = 'conquered';
  assert.equal(recalcIncome(s.meta), 3.7);
  assert.equal(s.meta.incomePerSec, 3.7);
});

test('accrue grants rate x seconds and never subtracts on a negative dt', () => {
  const s = world(['riverfen']);
  accrue(s.meta, 10_000);
  assert.equal(s.meta.crowns, 10);
  accrue(s.meta, -60_000);
  assert.equal(s.meta.crowns, 10, 'negative dt must be ignored, not subtracted');
  accrue(s.meta, 0);
  assert.equal(s.meta.crowns, 10);
});

test('tick accrues and resynchronises lastSeenAt to wall clock', () => {
  const s = world(['riverfen'], {}, 1_000);
  tick(s, 500, 1_500);
  assert.equal(s.meta.crowns, 0.5);
  assert.equal(s.lastSeenAt, 1_500);
  assert.equal(s.meta.stats.playMs, 500);
});

// --- offline ---------------------------------------------------------------

test('offline cap is 8h base and 24h with Granary maxed', () => {
  assert.equal(offlineCapMs(world([]).meta), OFFLINE.baseCapMs);
  assert.equal(offlineCapMs(world([], { granary: 1 }).meta), 12 * HOUR);
  assert.equal(offlineCapMs(world([], { granary: 4 }).meta), 24 * HOUR);
  // Never exceeds the design maximum even if content adds levels later.
  assert.equal(offlineCapMs(world([], { granary: 99 }).meta), OFFLINE.hardMaxCapMs);
});

test('offline accrual under the cap is exactly rate x elapsed', () => {
  const s = world(['riverfen', 'ashford'], {}, 0); // 2.2/s
  const r = applyOfflineProgress(s, 2 * HOUR);
  assert.equal(r.creditedMs, 2 * HOUR);
  assert.equal(r.cappedOut, false);
  assert.ok(Math.abs(r.crowns - 2.2 * 2 * 3600) < 1e-9);
  assert.equal(s.meta.crowns, r.crowns);
  assert.equal(s.lastSeenAt, 2 * HOUR);
});

test('a 30-day gap credits exactly the cap, not 30 days', () => {
  const s = world(['riverfen'], {}, 0); // 1.0/s
  const r = applyOfflineProgress(s, 30 * DAY);
  assert.equal(r.elapsedMs, 30 * DAY);
  assert.equal(r.creditedMs, OFFLINE.baseCapMs);
  assert.equal(r.cappedOut, true);
  assert.equal(r.crowns, 8 * 3600); // 8h at 1.0/s
  assert.equal(s.lastSeenAt, 30 * DAY, 'anchor advances to now, the excess is forfeit');
  assert.ok(Number.isFinite(s.meta.crowns) && s.meta.crowns === 8 * 3600);
});

test('a 30-day gap with Granary maxed credits 24h', () => {
  const s = world(['riverfen'], { granary: 4 }, 0);
  const r = applyOfflineProgress(s, 30 * DAY);
  assert.equal(r.creditedMs, 24 * HOUR);
  assert.equal(r.crowns, 24 * 3600);
});

test('a backwards clock grants nothing and goes nowhere near negative', () => {
  const s = world(['riverfen'], {}, 10 * HOUR);
  s.meta.crowns = 500;
  const r = applyOfflineProgress(s, 1 * HOUR); // now < lastSeenAt
  assert.equal(r.backwards, true);
  assert.equal(r.elapsedMs, 0);
  assert.equal(r.creditedMs, 0);
  assert.equal(r.crowns, 0);
  assert.equal(s.meta.crowns, 500, 'crowns must not be taken away');
  assert.equal(s.lastSeenAt, 1 * HOUR, 'anchor resyncs so the player owes no time');
  // ...and the very next second still pays out normally.
  const r2 = applyOfflineProgress(s, 1 * HOUR + 1000);
  assert.equal(r2.crowns, 1);
});

test('repeated offline claims cannot double-pay the same window', () => {
  const s = world(['riverfen'], {}, 0);
  applyOfflineProgress(s, HOUR);
  const again = applyOfflineProgress(s, HOUR);
  assert.equal(again.crowns, 0);
  assert.equal(s.meta.crowns, 3600);
});

test('offline income is closed form: one call equals many chunked calls', () => {
  const a = world(['riverfen', 'ashford', 'ironwood'], {}, 0);
  applyOfflineProgress(a, 5 * HOUR);

  const b = world(['riverfen', 'ashford', 'ironwood'], {}, 0);
  for (let h = 1; h <= 5; h++) applyOfflineProgress(b, h * HOUR);

  assert.ok(Math.abs(a.meta.crowns - b.meta.crowns) < 1e-6);
});

test('zero income still resyncs the anchor', () => {
  const s = world([], {}, 0);
  const r = applyOfflineProgress(s, 3 * DAY);
  assert.equal(r.crowns, 0);
  assert.equal(s.meta.crowns, 0);
  assert.equal(s.lastSeenAt, 3 * DAY);
});

test('an explicit capMs override wins over the Granary cap', () => {
  const s = world(['riverfen'], { granary: 4 }, 0);
  const r = applyOfflineProgress(s, 10 * DAY, 60_000);
  assert.equal(r.creditedMs, 60_000);
  assert.equal(r.crowns, 60);
});

test('pacing helpers: timeToAfford and projectCrowns agree', () => {
  const s = world(['riverfen', 'ashford', 'ironwood', 'saltmere']); // 5.5/s
  assert.equal(timeToAfford(s, 0), 0);
  assert.equal(timeToAfford(s, 550), 100);
  assert.ok(Math.abs(projectCrowns(s, 100) - 550) < 1e-9);
  assert.equal(timeToAfford(world([]), 100), Infinity, 'no income -> never');
});

test('the region table hits its ~274/s full-conquest target', () => {
  const all = Object.keys(REGION_BY_ID);
  const s = world(all);
  const total = incomePerSec(s);
  assert.ok(total > 250 && total < 300, `full conquest income ${total} should be ~274/s`);
});

// ---------------------------------------------------------------------------
// Battle speed must never touch income
// ---------------------------------------------------------------------------

test('income is the same at 0.25x, 1x and 4x — speed is not a money printer', () => {
  // CLAUDE.md calls this out as load-bearing and NOTHING pinned it. The rule
  // lives in main.js: idle accrues on `realMs` (a wall-clock delta) and the sim
  // gets `dtMs`, so a faster loop takes proportionally smaller bites. Passing
  // `dtMs` into tickIdle instead — an easy and plausible mistake — multiplies a
  // player's income by their speed setting, and slow motion is a NEW way to get
  // this wrong in the other direction.
  //
  // Modelled here as the loop really behaves: at speed S over the same ten
  // seconds of wall clock, `update` runs S times as often with a wall-clock
  // delta S times smaller.
  const earnedAt = (speed) => {
    const s = createState({ seed: 1, now: 0 });
    markConquered(s.meta, 'riverfen', { now: 0, durationMs: 0 });
    recalcIncome(s.meta);

    const WALL_MS = 10_000;
    const framesPerSecond = 10 * speed;          // the loop ticks faster...
    const frames = Math.round((WALL_MS / 1000) * framesPerSecond);
    const realMs = WALL_MS / frames;             // ...so each frame is shorter
    for (let i = 0; i < frames; i++) tick(s, realMs, (i + 1) * realMs);
    return s.meta.crowns;
  };

  const base = earnedAt(1);
  assert.ok(base > 0, 'the fixture must actually earn something');
  for (const speed of [0.25, 0.5, 2, 4]) {
    assert.ok(Math.abs(earnedAt(speed) - base) < 1e-6,
      `${speed}x earned ${earnedAt(speed)} against 1x's ${base}`);
  }
});

test('income ignores the simulation clock even when the two disagree', () => {
  // The direct statement of the bug: crediting the SIM delta instead of the
  // wall delta. At 4x the sim advances four times as far, so a build that
  // credited it would pay four times as much.
  const s = createState({ seed: 1, now: 0 });
  markConquered(s.meta, 'riverfen', { now: 0, durationMs: 0 });
  recalcIncome(s.meta);

  const SIM_MS = 100;                            // one fixed tick, always 100ms
  const WALL_MS = 25;                            // what 4x actually consumed
  tick(s, WALL_MS, WALL_MS);
  const paid = s.meta.crowns;
  assert.ok(Math.abs(paid - (s.meta.incomePerSec * WALL_MS) / 1000) < 1e-9,
    'accrual must be a function of the wall delta it was handed');
  assert.ok(paid < (s.meta.incomePerSec * SIM_MS) / 1000,
    'and must be strictly less than the sim delta would have paid');
});
