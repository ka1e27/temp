import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROSPERITY } from '../config/prosperity.js';
import { resetRegions, PLAYER_FACTION } from '../meta/state.js';
import {
  levelForTenure, prosperityLevel, updateProsperity, baselineProsperity, resetProsperity,
  prosperityIncomeMult, nextProsperityAt, prosperityInfo, nextProsperityChangeAt,
} from '../meta/prosperity.js';
import { makeWorld, makeGame } from './meta.fixtures.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const T0 = 1_700_000_000_000;

/** Fixture world; the player owns region 0 (since T0) and conquers region 1 at `t1`. */
function setup(t1 = T0 + 10 * MIN) {
  const world = makeWorld();
  const state = makeGame(world, {}, T0);
  state.owner[1] = PLAYER_FACTION;
  state.conqueredAt[1] = t1;
  return { world, state };
}

test('config: thresholds are 30 min / 2 h / 8 h and each level adds 5 %', () => {
  assert.deepEqual([...PROSPERITY.thresholdsMs], [30 * MIN, 2 * HOUR, 8 * HOUR]);
  assert.equal(PROSPERITY.incomeBonusPerLevel, 0.05);
  assert.equal(PROSPERITY.maxLevel, 3);
});

test('levelForTenure: thresholds are inclusive and bad input is level 0', () => {
  assert.equal(levelForTenure(0), 0);
  assert.equal(levelForTenure(30 * MIN - 1), 0);
  assert.equal(levelForTenure(30 * MIN), 1);
  assert.equal(levelForTenure(2 * HOUR - 1), 1);
  assert.equal(levelForTenure(2 * HOUR), 2);
  assert.equal(levelForTenure(8 * HOUR - 1), 2);
  assert.equal(levelForTenure(8 * HOUR), 3);
  assert.equal(levelForTenure(1000 * HOUR), 3);
  assert.equal(levelForTenure(-5 * HOUR), 0);
  assert.equal(levelForTenure(NaN), 0);
  assert.equal(levelForTenure(Infinity), 0);
});

test('prosperityLevel: tenure thresholds for an owned region', () => {
  const { state } = setup();
  assert.equal(prosperityLevel(state, 0, T0), 0);
  assert.equal(prosperityLevel(state, 0, T0 + 30 * MIN - 1), 0);
  assert.equal(prosperityLevel(state, 0, T0 + 30 * MIN), 1);
  assert.equal(prosperityLevel(state, 0, T0 + 2 * HOUR), 2);
  assert.equal(prosperityLevel(state, 0, T0 + 8 * HOUR), 3);
  assert.equal(prosperityLevel(state, 0, T0 + 999 * HOUR), 3);
});

test('prosperityLevel: not owned (or never conquered, or clock going backwards) is 0', () => {
  const { state } = setup();
  // Region 2 belongs to the Free Folk: even with a stale timestamp there is no prosperity.
  state.conqueredAt[2] = T0 - 20 * HOUR;
  assert.equal(prosperityLevel(state, 2, T0 + 20 * HOUR), 0);
  // Owned but no conquest timestamp.
  state.owner[3] = PLAYER_FACTION;
  assert.equal(state.conqueredAt[3], null);
  assert.equal(prosperityLevel(state, 3, T0 + 20 * HOUR), 0);
  // `now` before conqueredAt.
  assert.equal(prosperityLevel(state, 0, T0 - HOUR), 0);
  // Rival-owned, then lost by the player.
  state.owner[0] = 2;
  assert.equal(prosperityLevel(state, 0, T0 + 20 * HOUR), 0);
});

test('updateProsperity: creates state.prosperity and reports level-ups exactly once', () => {
  const { world, state } = setup();
  // createGame gives `prosperity: []`; a hand-built or very old state may have no field at all.
  assert.deepEqual(state.prosperity, []);
  delete state.prosperity;
  assert.deepEqual(updateProsperity(state, world, T0 + 5 * MIN), []);
  assert.ok(Array.isArray(state.prosperity));
  assert.equal(state.prosperity.length, world.regions.length);
  assert.ok(state.prosperity.every((v) => v === 0));

  // Region 0 crosses 30 min (region 1 was conquered at +10 min, so it is not there yet).
  assert.deepEqual(updateProsperity(state, world, T0 + 31 * MIN), [{ regionId: 0, level: 1, from: 0 }]);
  assert.equal(state.prosperity[0], 1);
  // Reported once: the very same call again is silent.
  assert.deepEqual(updateProsperity(state, world, T0 + 31 * MIN), []);
  assert.deepEqual(updateProsperity(state, world, T0 + 35 * MIN), []);

  // Region 1 reaches I at +40 min.
  assert.deepEqual(updateProsperity(state, world, T0 + 40 * MIN), [{ regionId: 1, level: 1, from: 0 }]);
  // Both reach II: region 0 at +2 h, region 1 at +2 h 10 min. Ordered by region id.
  assert.deepEqual(updateProsperity(state, world, T0 + 2 * HOUR + 10 * MIN), [
    { regionId: 0, level: 2, from: 1 },
    { regionId: 1, level: 2, from: 1 },
  ]);
  assert.deepEqual(state.prosperity.slice(0, 3), [2, 2, 0]);
});

test('updateProsperity: a long absence reports one entry that skips levels', () => {
  const { world, state } = setup();
  updateProsperity(state, world, T0 + MIN);
  const ups = updateProsperity(state, world, T0 + 9 * HOUR);
  assert.deepEqual(ups, [
    { regionId: 0, level: 3, from: 0 },
    { regionId: 1, level: 3, from: 0 },
  ]);
  assert.deepEqual(updateProsperity(state, world, T0 + 30 * HOUR), []);
});

test('updateProsperity: a region lost by the player drops to 0 silently and can prosper again', () => {
  const { world, state } = setup();
  updateProsperity(state, world, T0 + 3 * HOUR);
  assert.equal(state.prosperity[0], 2);
  state.owner[0] = 2; // lost
  assert.deepEqual(updateProsperity(state, world, T0 + 3 * HOUR + 1000), []);
  assert.equal(state.prosperity[0], 0);
  // Retaken at +4 h: tenure restarts, level I comes 30 min later.
  state.owner[0] = PLAYER_FACTION;
  state.conqueredAt[0] = T0 + 4 * HOUR;
  assert.deepEqual(updateProsperity(state, world, T0 + 4 * HOUR + 29 * MIN), []);
  assert.deepEqual(updateProsperity(state, world, T0 + 4 * HOUR + 30 * MIN), [{ regionId: 0, level: 1, from: 0 }]);
});

test('new dynasty: repopulated conqueredAt drops every level without reporting anything', () => {
  const { world, state } = setup();
  updateProsperity(state, world, T0 + 10 * HOUR);
  assert.deepEqual(state.prosperity.slice(0, 2), [3, 3]);
  assert.ok(prosperityIncomeMult(state, 0) > 1.14);

  // What foundDynasty + resetRegions do for the new continent (owner, conqueredAt repopulated).
  const newNow = T0 + 11 * HOUR;
  resetRegions(state, world, newNow);
  // Before any update the stale stored level would still pay 15 %: reset it next to resetRegions.
  resetProsperity(state, world);
  assert.equal(prosperityIncomeMult(state, 0), 1);
  assert.ok(state.prosperity.every((v) => v === 0));
  assert.equal(state.prosperity.length, world.regions.length);
  assert.deepEqual(updateProsperity(state, world, newNow), []);
  assert.deepEqual(updateProsperity(state, world, newNow + 30 * MIN), [{ regionId: 0, level: 1, from: 0 }]);
});

test('new dynasty without resetProsperity: updateProsperity alone also clears stale levels quietly', () => {
  const { world, state } = setup();
  updateProsperity(state, world, T0 + 10 * HOUR);
  resetRegions(state, world, T0 + 11 * HOUR);
  assert.deepEqual(updateProsperity(state, world, T0 + 11 * HOUR), []);
  assert.ok(state.prosperity.every((v) => v === 0));
});

test('baselineProsperity: adopts existing tenure without reporting', () => {
  const { world, state } = setup();
  baselineProsperity(state, world, T0 + 9 * HOUR);
  assert.deepEqual(state.prosperity.slice(0, 2), [3, 3]);
  assert.deepEqual(updateProsperity(state, world, T0 + 9 * HOUR + 1000), []);
});

test('updateProsperity is defensive about a damaged prosperity array', () => {
  const { world, state } = setup();
  state.prosperity = [7, -2, 'x', null, 1.5];
  const ups = updateProsperity(state, world, T0 + 3 * HOUR);
  assert.equal(state.prosperity.length, world.regions.length);
  assert.ok(state.prosperity.every((v) => Number.isInteger(v) && v >= 0 && v <= 3));
  // Region 0's stored 7 clamps to 3, so nothing is reported for it; region 1 (stored -2 = 0) is.
  assert.deepEqual(ups.map((u) => u.regionId), [1]);
  state.prosperity = 'nope';
  updateProsperity(state, world, T0 + 3 * HOUR);
  assert.ok(Array.isArray(state.prosperity));
});

test('prosperityIncomeMult: 1 + 5 % per STORED level, 1 when not owned or no array', () => {
  const { world, state } = setup();
  assert.equal(prosperityIncomeMult(state, 0), 1); // nothing credited yet: `[]`
  delete state.prosperity;
  assert.equal(prosperityIncomeMult(state, 0), 1); // no field at all (old fixtures)
  state.prosperity = [0, 0, 0, 0, 0, 0];
  assert.equal(prosperityIncomeMult(state, 0), 1);
  state.prosperity[0] = 1;
  assert.ok(Math.abs(prosperityIncomeMult(state, 0) - 1.05) < 1e-12);
  state.prosperity[0] = 2;
  assert.ok(Math.abs(prosperityIncomeMult(state, 0) - 1.1) < 1e-12);
  state.prosperity[0] = 3;
  assert.ok(Math.abs(prosperityIncomeMult(state, 0) - 1.15) < 1e-12);
  state.prosperity[2] = 3; // stale value on a region the player does not own
  assert.equal(prosperityIncomeMult(state, 2), 1);
  // The multiplier follows the credited level, not the clock: this is the "levels at departure"
  // rule for offline earnings that run before the first update after a load.
  state.prosperity[0] = 1;
  assert.ok(Math.abs(prosperityIncomeMult(state, 0) - 1.05) < 1e-12);
  updateProsperity(state, world, T0 + 20 * HOUR);
  assert.ok(Math.abs(prosperityIncomeMult(state, 0) - 1.15) < 1e-12);
});

test('nextProsperityAt: the next threshold as a timestamp, null when done or not owned', () => {
  const { world, state } = setup();
  // Without a stored array the "next" level is I.
  assert.equal(nextProsperityAt(state, 0), T0 + 30 * MIN);
  updateProsperity(state, world, T0 + 31 * MIN);
  assert.equal(nextProsperityAt(state, 0), T0 + 2 * HOUR);
  updateProsperity(state, world, T0 + 3 * HOUR);
  assert.equal(nextProsperityAt(state, 0), T0 + 8 * HOUR);
  updateProsperity(state, world, T0 + 9 * HOUR);
  assert.equal(nextProsperityAt(state, 0), null);
  assert.equal(nextProsperityAt(state, 2), null); // not owned
  state.owner[3] = PLAYER_FACTION;
  assert.equal(nextProsperityAt(state, 3), null); // no timestamp
});

test('nextProsperityAt with `now` skips levels the stored array has not caught up with yet', () => {
  const { state } = setup();
  state.prosperity = [0, 0, 0, 0, 0, 0];
  assert.equal(nextProsperityAt(state, 0, T0 + 3 * HOUR), T0 + 8 * HOUR);
  assert.equal(nextProsperityAt(state, 0, T0 + 9 * HOUR), null);
});

test('prosperityInfo: the region-card bundle', () => {
  const { state } = setup();
  const now = T0 + 45 * MIN;
  const info = prosperityInfo(state, 0, now);
  assert.equal(info.level, 1);
  assert.equal(info.label, 'I');
  assert.equal(info.nextAt, T0 + 2 * HOUR);
  assert.equal(info.nextInMs, 2 * HOUR - 45 * MIN);
  assert.ok(Math.abs(info.incomeBonus - 0.05) < 1e-12);
  const top = prosperityInfo(state, 0, T0 + 9 * HOUR);
  assert.equal(top.level, 3);
  assert.equal(top.nextAt, null);
  assert.equal(top.nextInMs, null);
  const none = prosperityInfo(state, 2, now);
  assert.deepEqual([none.level, none.label, none.nextAt], [0, '', null]);
});

test('determinism: the same state and clock give the same levels and level-ups', () => {
  const run = () => {
    const { world, state } = setup();
    const log = [];
    for (let k = 0; k <= 40; k++) log.push(updateProsperity(state, world, T0 + k * 15 * MIN));
    return JSON.stringify([log, state.prosperity]);
  };
  assert.equal(run(), run());
});

test('nextProsperityChangeAt: the earliest future level change across the realm', () => {
  const { world, state } = setup(T0 + 10 * MIN); // region 0 since T0, region 1 since +10 min
  assert.equal(nextProsperityChangeAt(state, world, T0), T0 + 30 * MIN);
  assert.equal(nextProsperityChangeAt(state, world, T0 + 30 * MIN - 1), T0 + 30 * MIN);
  // At exactly +30 min region 0 is level I; the next change is region 1 reaching I at +40 min.
  assert.equal(nextProsperityChangeAt(state, world, T0 + 30 * MIN), T0 + 40 * MIN);
  assert.equal(nextProsperityChangeAt(state, world, T0 + 41 * MIN), T0 + 2 * HOUR);
  assert.equal(nextProsperityChangeAt(state, world, T0 + 9 * HOUR), null);
  // Nothing owned: null.
  const empty = makeGame(makeWorld(), {}, T0);
  empty.owner.fill(2);
  assert.equal(nextProsperityChangeAt(empty, world, T0), null);
});

test('stepping a clock from change to change integrates income across levels (campaign-style)', () => {
  const { world, state } = setup(T0);
  // Income 1/s per region, boosted by the credited level: two regions held for 3 hours.
  const perSec = () => [0, 1].reduce((sum, id) => sum + prosperityIncomeMult(state, id), 0);
  let now = T0;
  let gold = 0;
  const end = T0 + 3 * HOUR;
  updateProsperity(state, world, now);
  while (now < end) {
    const change = nextProsperityChangeAt(state, world, now);
    const stop = change != null && change < end ? change : end;
    gold += perSec() * ((stop - now) / 1000);
    now = stop;
    updateProsperity(state, world, now);
  }
  // Each region: 30 min at 1.00, 90 min at 1.05, 60 min at 1.10.
  const expected = 2 * (0.5 * 3600 * 1 + 1.5 * 3600 * 1.05 + 1 * 3600 * 1.1);
  assert.ok(Math.abs(gold - expected) < 1e-6, `${gold} vs ${expected}`);
});

test('a clock set back never lowers a held level, never reports it twice, and the income bonus stays', () => {
  const { world, state } = setup();
  updateProsperity(state, world, T0 + 9 * HOUR);
  assert.deepEqual(state.prosperity.slice(0, 2), [3, 3]);
  const bonus = prosperityIncomeMult(state, 0);
  assert.ok(bonus > 1.14);
  // 2 h back: tenure drops to level II, the stored III stays
  assert.deepEqual(updateProsperity(state, world, T0 + 7 * HOUR), []);
  assert.deepEqual(state.prosperity.slice(0, 2), [3, 3]);
  // all the way back before the conquests: tenure is negative, nothing changes, nothing is reported
  assert.deepEqual(updateProsperity(state, world, T0 - 5 * HOUR), []);
  assert.deepEqual(state.prosperity.slice(0, 2), [3, 3]);
  assert.equal(prosperityIncomeMult(state, 0), bonus);
  const info = prosperityInfo(state, 0, T0 - 5 * HOUR);
  assert.equal(info.level, 3, 'the card shows what the economy pays');
  assert.ok(Math.abs(info.incomeBonus - PROSPERITY.incomeBonusPerLevel * 3) < 1e-12);
  assert.equal(info.nextAt, null);
  assert.equal(nextProsperityAt(state, 0, T0 - 5 * HOUR), null);
  // the clock comes back: no "prospers!" fires again
  assert.deepEqual(updateProsperity(state, world, T0 + 9 * HOUR), []);
  assert.deepEqual(updateProsperity(state, world, T0 + 40 * HOUR), []);
  // a conquest stamp in the far future (a wrongly set clock at conquest time) does not zero it either
  state.conqueredAt[1] = T0 + 365 * 24 * HOUR;
  assert.deepEqual(updateProsperity(state, world, T0 + 41 * HOUR), []);
  assert.equal(state.prosperity[1], 3);
});

test('a held level climbs from where it is after a clock jump back, and levels still come one at a time', () => {
  const { world, state } = setup();
  updateProsperity(state, world, T0 + 3 * HOUR); // level II
  assert.equal(state.prosperity[0], 2);
  updateProsperity(state, world, T0 + 1 * HOUR); // clock back: still II
  assert.equal(state.prosperity[0], 2);
  assert.deepEqual(updateProsperity(state, world, T0 + 8 * HOUR), [{ regionId: 0, level: 3, from: 2 }]); // region 1 (taken 10 min later) is still at II
});

test('losing a region and a new dynasty are still the only things that reset a level', () => {
  const { world, state } = setup();
  updateProsperity(state, world, T0 + 9 * HOUR);
  updateProsperity(state, world, T0 - HOUR); // clock back: held
  assert.equal(state.prosperity[0], 3);
  state.owner[0] = 2; // lost
  updateProsperity(state, world, T0 - HOUR);
  assert.equal(state.prosperity[0], 0);
  assert.equal(prosperityIncomeMult(state, 0), 1);
  resetRegions(state, world, T0 + 20 * HOUR); // new dynasty
  updateProsperity(state, world, T0 + 20 * HOUR);
  assert.ok(state.prosperity.every((v) => v === 0));
});
