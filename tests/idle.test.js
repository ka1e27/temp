// Idle economy: accrual, the offline cap, and the two clocks that break it —
// a 30-day gap and a clock that steps backwards.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createState } from '../src/core/store.js';
import { OFFLINE } from '../src/content/upgrades.data.js';
import { REGION_BY_ID, REGIONS, fullConquestIncome } from '../src/content/regions.data.js';
import {
  incomePerSec, baseIncomePerSec, recalcIncome, accrue, tick,
  applyOfflineProgress, offlineCapMs, timeToAfford, projectCrowns,
  tickOrCatchUp, IDLE_CATCHUP_MS,
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

test('Treasury levels are additive, not compounding', () => {
  // The line has no cap, so this is also what stops it running away: additive
  // levels against an exponential price means power grows with the LOGARITHM of
  // crowns spent. Compounding here would make a patient player unbounded.
  const one = incomePerSec(world(['riverfen'], { treasury: 1 }));
  const two = incomePerSec(world(['riverfen'], { treasury: 2 }));
  const ten = incomePerSec(world(['riverfen'], { treasury: 10 }));
  assert.ok(Math.abs(one - 1.12) < 1e-12);
  assert.ok(Math.abs(two - 1.24) < 1e-12, `+12% twice is +24%, got ${two}`);
  assert.ok(Math.abs(ten - 2.20) < 1e-12);
  assert.notEqual(two, 1.12 * 1.12); // NOT compounding
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

test('offline cap is 8h base, +2h a Treasury level, and never past 24h', () => {
  assert.equal(offlineCapMs(world([]).meta), OFFLINE.baseCapMs);
  assert.equal(offlineCapMs(world([], { treasury: 1 }).meta), 10 * HOUR);
  assert.equal(offlineCapMs(world([], { treasury: 8 }).meta), 24 * HOUR);
  // Treasury is ENDLESS, so this ceiling is the only thing bounding it — a
  // player who idles for a month must not be able to bank a month.
  assert.equal(offlineCapMs(world([], { treasury: 99 }).meta), OFFLINE.hardMaxCapMs);
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

test('a 30-day gap with the cap fully extended credits 24h', () => {
  // Treasury extends the cap AND raises the rate, so the payout is checked
  // against the rate this player actually has rather than a bare 1.0/s.
  const s = world(['riverfen'], { treasury: 8 }, 0);
  const rate = incomePerSec(s);
  const r = applyOfflineProgress(s, 30 * DAY);
  assert.equal(r.creditedMs, 24 * HOUR);
  assert.ok(Math.abs(r.crowns - rate * 24 * 3600) < 1e-6);
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

test('an explicit capMs override wins over the Treasury cap', () => {
  const s = world(['riverfen'], { treasury: 8 }, 0);
  const rate = incomePerSec(s);
  const r = applyOfflineProgress(s, 10 * DAY, 60_000);
  assert.equal(r.creditedMs, 60_000);
  assert.ok(Math.abs(r.crowns - rate * 60) < 1e-9);
});

test('pacing helpers: timeToAfford and projectCrowns agree', () => {
  const s = world(['riverfen', 'ashford', 'ironwood', 'saltmere']); // 5.5/s
  assert.equal(timeToAfford(s, 0), 0);
  assert.equal(timeToAfford(s, 550), 100);
  assert.ok(Math.abs(projectCrowns(s, 100) - 550) < 1e-9);
  assert.equal(timeToAfford(world([]), 100), Infinity, 'no income -> never');
});

test('the region table hits its full-conquest income target', () => {
  // Driven off `fullConquestIncome()` rather than a literal, because the literal
  // was the bug: it read "~274/s" and had to be hand-edited the moment a fifth
  // tier shipped, which is a test that asserts the table has not changed instead
  // of asserting the seam still carries it. What is actually worth checking is
  // that meta/idle.js `incomePerSec` agrees with the content table — a region
  // whose reward never reaches the economy is the failure this catches.
  const all = Object.keys(REGION_BY_ID);
  const s = world(all);
  assert.ok(Math.abs(incomePerSec(s) - fullConquestIncome()) < 1e-9,
    `idle pays ${incomePerSec(s)}/s at full conquest; the table says ${fullConquestIncome()}/s`);
  // ...and the shape claim that number encodes: 21 regions of a compounding
  // ramp, no cliffs, ending several hundred times the opening region.
  assert.ok(fullConquestIncome() > REGIONS[0].rewardPerSec * 300,
    'the empire should be worth hundreds of times its first province');
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

// ---------------------------------------------------------------------------
// A stall mid-session is an ABSENCE, not a slow frame
// ---------------------------------------------------------------------------

test('idle: a long gap between frames is credited, not thrown away', () => {
  // THE BUG THIS PINS. Offline income was reconciled only at boot; within a
  // running session the gap between two frames was clamped to one second and
  // the rest discarded, because "a long stall is the offline calculation's
  // job" — and that calculation had exactly one caller, in the save-load path.
  // So a laptop lid closed mid-session paid ONE SECOND of an eight-hour
  // absence, while simply closing the tab paid the full cap. Measured live at
  // 1 crown/s with the clock stepped forward ten minutes: 1 crown against 600.
  const s = world(['riverfen'], {}, 0);      // exactly 1.0 crown/sec
  assert.equal(incomePerSec(s), 1.0);
  s.lastSeenAt = 0;
  s.meta.crowns = 0;

  const TEN_MIN = 10 * 60 * 1000;
  tickOrCatchUp(s, TEN_MIN, TEN_MIN, null);
  assert.ok(Math.abs(s.meta.crowns - 600) < 1e-6,
    `ten minutes at 1/s must pay 600 crowns, paid ${s.meta.crowns}`);
});

test('idle: an ordinary frame still accrues exactly its own gap', () => {
  // THE CONTROL FOR THE ABOVE. Without it, a `tickOrCatchUp` that sent every
  // gap through the offline path would pass the first test and quietly change
  // what a normal frame does — including `stats.playMs`, which the offline
  // path does not touch.
  const s = world(['riverfen'], {}, 0);
  s.lastSeenAt = 0;
  s.meta.crowns = 0;
  const before = s.meta.stats.playMs;

  tickOrCatchUp(s, 250, 250, null);
  assert.ok(Math.abs(s.meta.crowns - 0.25) < 1e-9,
    `a 250ms frame pays 0.25 crowns, paid ${s.meta.crowns}`);
  assert.equal(s.meta.stats.playMs, before + 250,
    'a normal frame must still count as PLAY time — the offline path does not');
  assert.equal(s.lastSeenAt, 250, 'and it must resync the anchor');
});

test('idle: a stall is still capped, and still survives a backwards clock', () => {
  // The whole point of routing through `applyOfflineProgress` rather than
  // crediting the raw gap is that the cap and the clock-safety come with it.
  // A stall must not be a way around the offline ceiling.
  const cap = offlineCapMs(world([]).meta);
  const s = world(['riverfen'], {}, 0);
  s.lastSeenAt = 0;
  s.meta.crowns = 0;
  const monthMs = 30 * DAY;
  tickOrCatchUp(s, monthMs, monthMs, null);
  assert.ok(Math.abs(s.meta.crowns - cap / 1000) < 1e-6,
    `a 30-day stall must pay exactly the cap (${cap / 1000}), paid ${s.meta.crowns}`);

  // Clock stepped BACKWARD across a stall: no crowns, nothing negative, and the
  // anchor resyncs so the player is not left owing time.
  const b = world(['riverfen'], {}, 0);
  b.lastSeenAt = 10 * HOUR;
  b.meta.crowns = 0;
  tickOrCatchUp(b, IDLE_CATCHUP_MS + 1, 1 * HOUR, null);
  assert.equal(b.meta.crowns, 0, 'a backwards clock must never pay');
  assert.equal(b.lastSeenAt, 1 * HOUR, 'and must resync rather than strand the anchor');
});

test('idle: the threshold sits clear of a throttled background tab', () => {
  // A backgrounded tab is throttled to roughly one frame a second. If the
  // threshold sat at or below that, ordinary background play would route every
  // frame through the offline cap — which is a different bug wearing this
  // fix's clothes.
  assert.ok(IDLE_CATCHUP_MS >= 2000,
    `${IDLE_CATCHUP_MS}ms is inside the background-tab throttle band`);
});
