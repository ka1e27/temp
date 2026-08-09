// The world graph and the economy that hangs off it: the adjacency gate, the
// region table's balance invariants, and what a BattleOutcome is worth.
import test from 'node:test';
import assert from 'node:assert/strict';

import { CONTRACT_VERSION, hashBattleConfig } from '../src/battle/contract.js';
import { REGIONS, REGION_BY_ID, RAID } from '../src/content/regions.data.js';
import { createState } from '../src/core/store.js';
import { distance } from '../src/core/hex.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { refreshUnlocks, isAttackable, effectiveEnemyMult, markConquered, canRaid }
  from '../src/meta/world.js';
import { applyOutcome, previewReward } from '../src/meta/rewards.js';
import { recalcIncome } from '../src/meta/idle.js';

const world = (conquered = [], upgrades = {}, crowns = 0) => {
  const s = createState({ seed: 4242, now: 0 });
  for (const id of conquered) s.meta.regions[id].status = 'conquered';
  Object.assign(s.meta.upgrades, upgrades);
  s.meta.crowns = crowns;
  refreshUnlocks(s.meta);
  recalcIncome(s.meta);
  return s;
};

// ===========================================================================
// The world graph
// ===========================================================================

test('adjacentTo is real, symmetric hex adjacency between shipped regions', () => {
  const ids = new Set(REGIONS.map((r) => r.id));
  const seenHex = new Set();
  for (const r of REGIONS) {
    const k = r.hex.join(',');
    assert.ok(!seenHex.has(k), `two regions share hex ${k}`);
    seenHex.add(k);
  }
  for (const r of REGIONS) {
    for (const n of r.adjacentTo) {
      assert.ok(ids.has(n), `${r.id} points at unknown region ${n}`);
      const other = REGION_BY_ID[n];
      assert.ok(other.adjacentTo.includes(r.id), `${r.id}<->${n} is not symmetric`);
      const d = distance({ q: r.hex[0], r: r.hex[1] }, { q: other.hex[0], r: other.hex[1] });
      assert.equal(d, 1, `${r.id}<->${n} are ${d} hexes apart, not neighbours`);
    }
  }
});

test('tier counts are 4 / 5 / 5 / 4 and difficulty only ever goes up', () => {
  const counts = [1, 2, 3, 4].map((t) => REGIONS.filter((r) => r.tier === t).length);
  assert.deepEqual(counts, [4, 5, 5, 4]);
  for (let i = 1; i < REGIONS.length; i++) {
    assert.ok(REGIONS[i].enemyMult > REGIONS[i - 1].enemyMult, `${REGIONS[i].id} is not harder`);
    assert.ok(REGIONS[i].rewardPerSec >= REGIONS[i - 1].rewardPerSec);
    assert.ok(REGIONS[i].tier >= REGIONS[i - 1].tier);
  }
});

test('map size, site count and battle length scale together across tiers', () => {
  for (let i = 1; i < REGIONS.length; i++) {
    const a = REGIONS[i - 1]; const b = REGIONS[i];
    const area = (r) => r.grid.cols * r.grid.rows;
    const sites = (r) => r.siteCounts.enemy + r.siteCounts.neutral + r.siteCounts.player;
    assert.ok(area(b) >= area(a), `${b.id} map shrank`);
    assert.ok(sites(b) >= sites(a), `${b.id} lost sites`);
    // ADVERTISED LENGTH IS NON-DECREASING WITHIN A TIER, NOT ACROSS THE WHOLE
    // CAMPAIGN, and the difference is measurement rather than taste.
    //
    // `targetLengthMin` for tiers 3 and 4 was never tested — the harness's
    // `--all` mode simulated a player with zero conquests, so regions 6-18 only
    // ever reported 0% TOO HARD and their advertised lengths were authored, not
    // measured. Measured now at n=96 and n=240, and with victory set to
    // capture-castle, a tier-4 region resolves in roughly six-and-a-half to
    // eight-and-a-half minutes whatever else is done to it: raising enemyMult,
    // developing the enemy's country, garrisoning the throne, growing the map
    // to 26 enemy sites on a 21x15 grid and tapering the expedition were all
    // tried, and none of them moved a clean win past about ten minutes, because
    // sites off the path to the throne were simply never fought over.
    //
    // `castleGateFrac` (content/regions.data.js) fixed the CAUSE — the castle
    // cannot fall below a territory threshold, so beelining the throne no
    // longer skips the countryside — and it measurably lengthened the regions
    // that were shortest (blackspire, ironcrown and obsidian each gained
    // 1.2-2.0 minutes at matched n). It did not, on its own, push the campaign
    // median past ten minutes: a scripted player that already sweeps broadly
    // when it wins was rarely the thing being gated, and pushing the threshold
    // far enough to bind that player consistently cost more win rate than it
    // was worth (n=48: ironcrown fell to 46% before the gate values here were
    // dialled back). The numbers now say what the regions do — which is also
    // roughly what this file's own tier comments always said ("~9 min" for
    // tier 3, "~10-11 min" for tier 4) before the column drifted away from
    // them. tests/campaign.test.js asserts the stronger property that replaces
    // this one: no region may advertise a length it cannot deliver.
    if (a.tier === b.tier) {
      assert.ok(b.targetLengthMin >= a.targetLengthMin, `${b.id} got shorter than ${a.id}`);
    }
    assert.ok(b.hardCapMs > b.targetLengthMin * 60_000 * 1.2,
      `${b.id} hard cap is a timer you play against, not a backstop`);
  }
  // The first two tiers still ramp, region by region: that is the stretch the
  // campaign teaches on, and it is measured at 6.5m -> 16.4m.
  for (let i = 1; i < 9; i++) {
    assert.ok(REGIONS[i].targetLengthMin >= REGIONS[i - 1].targetLengthMin,
      `${REGIONS[i].id} got shorter than ${REGIONS[i - 1].id}`);
  }
  const last = REGIONS[REGIONS.length - 1];
  assert.deepEqual([last.grid.cols, last.grid.rows], [17, 13]);
  assert.ok(last.siteCounts.enemy + last.siteCounts.neutral + last.siteCounts.player >= 22);
});

// These are the TUNED values, not the ones the design doc first proposed.
// The original table (7v2 at region 1, rising to 12v2) measured at a 0% win
// rate in tools/simrunner.js: the player could not out-produce the enemy and
// every run stalled. The numbers below are what the harness actually clears at
// 60-80% with zero losses. Change them only with fresh simrunner output.
test('the vertical slice matches the tuned balance table', () => {
  const table = [
    ['riverfen', 1, 1.00, 11, 9, 5, 3, 3, 1.0, 8.0],
    ['ashford', 1, 1.15, 12, 9, 6, 3, 3, 1.2, 10.0],
    ['ironwood', 1, 1.30, 13, 10, 7, 3, 4, 1.5, 12.0],
    ['saltmere', 1, 1.45, 13, 10, 8, 4, 4, 1.8, 13.0],
    ['kaldan', 2, 1.85, 15, 11, 9, 4, 5, 4.0, 14.0],
  ];
  table.forEach((row, i) => {
    const [id, tier, mult, cols, rows, e, n, p, reward, len] = row;
    const r = REGIONS[i];
    assert.equal(r.id, id, `region ${i + 1} order`);
    assert.deepEqual(
      [r.tier, r.enemyMult, r.grid.cols, r.grid.rows,
        r.siteCounts.enemy, r.siteCounts.neutral, r.siteCounts.player,
        r.rewardPerSec, r.targetLengthMin],
      [tier, mult, cols, rows, e, n, p, reward, len],
    );
    assert.ok(r.flavour.length > 20, `${id} needs a one-line identity`);
  });
});

test('the adjacency gate: only regions touching the empire are attackable', () => {
  const s = createState({ seed: 1, now: 0 });
  refreshUnlocks(s.meta);
  assert.equal(isAttackable(s.meta, 'riverfen'), true, 'the seed region is always open');
  for (const r of REGIONS.slice(1)) {
    assert.equal(isAttackable(s.meta, r.id), false, `${r.id} must start locked`);
  }
  markConquered(s.meta, 'riverfen', { now: 0 });
  const opened = refreshUnlocks(s.meta);
  assert.deepEqual(opened.sort(), ['ashford', 'ironwood']);
  assert.equal(isAttackable(s.meta, 'kaldan'), false, 'kaldan touches ashford, not riverfen');
  markConquered(s.meta, 'ashford', { now: 0 });
  refreshUnlocks(s.meta);
  assert.equal(isAttackable(s.meta, 'kaldan'), true);
});

// ===========================================================================
// Outcomes and raids
// ===========================================================================

const outcomeFor = (cfg, result = 'win', extra = {}) => ({
  contractVersion: CONTRACT_VERSION,
  battleId: cfg.battleId,
  configHash: hashBattleConfig(cfg),
  regionId: cfg.region.id,
  result,
  durationMs: 300_000,
  ticks: 3000,
  stats: { sitesHeld: 11, sitesTotal: 11, unitsLost: 12, unitsKilled: 30, goldEarned: 900, peakArmy: 40 },
  boostersConsumed: [],
  ...extra,
});

test('a win grants permanent income and opens the neighbouring front', () => {
  const s = world([]);
  const cfg = buildBattleConfig(s, 'riverfen', [], null);
  const summary = applyOutcome(s, cfg, outcomeFor(cfg), { now: 1000 });
  assert.equal(summary.conquered, true);
  assert.equal(summary.incomeAdded, 1.0);
  assert.equal(s.meta.incomePerSec, 1.0);
  assert.equal(summary.crowns, 1.0 * 120);
  assert.equal(s.meta.crowns, 120);
  assert.deepEqual(summary.opened.sort(), ['ashford', 'ironwood']);
  assert.equal(s.session.dirty, true);
});

test('a loss costs nothing at all', () => {
  const s = world([], {}, 500);
  const cfg = buildBattleConfig(s, 'riverfen', [], null);
  const summary = applyOutcome(s, cfg, outcomeFor(cfg, 'loss'), { now: 1000 });
  assert.equal(summary.crowns, 0);
  assert.equal(s.meta.crowns, 500, 'a defeat must never cost progress');
  assert.equal(s.meta.regions.riverfen.status, 'available');
  assert.equal(s.meta.stats.losses, 1);
});

test('re-winning a conquered region pays a lump and never permanent income twice', () => {
  const s = world([]);
  const first = buildBattleConfig(s, 'riverfen', [], null);
  applyOutcome(s, first, outcomeFor(first), { now: 0 });
  const incomeAfterConquest = s.meta.incomePerSec;
  s.meta.regions.riverfen.raidReadyAt = 0; // cooldown elapsed

  const raid = buildBattleConfig(s, 'riverfen', [], null);
  assert.equal(raid.rules.isRaid, true);
  const summary = applyOutcome(s, raid, outcomeFor(raid), { now: RAID.cooldownMs });
  assert.equal(summary.raided, true);
  assert.equal(summary.incomeAdded, 0);
  assert.equal(s.meta.incomePerSec, incomeAfterConquest, 'raids never add permanent income');
  assert.equal(summary.crowns, 1.0 * RAID.lumpSeconds);
  assert.equal(s.meta.regions.riverfen.clears, 2);
  assert.equal(canRaid(s.meta, 'riverfen', RAID.cooldownMs), false, 'cooldown restarts');
  assert.equal(canRaid(s.meta, 'riverfen', RAID.cooldownMs * 2), true);
});

test('each clear makes a region 15% harder and 10% richer', () => {
  const s = world([]);
  const base = REGION_BY_ID.riverfen.enemyMult;
  assert.equal(effectiveEnemyMult(s.meta, 'riverfen'), base);
  markConquered(s.meta, 'riverfen', { now: 0 });
  assert.ok(Math.abs(effectiveEnemyMult(s.meta, 'riverfen') - base * 1.15) < 1e-12);
  assert.equal(previewReward(s, 'riverfen').kind, 'raid');
  assert.equal(previewReward(s, 'riverfen').crowns, 1.0 * RAID.lumpSeconds);
  s.meta.regions.riverfen.clears = 2;
  assert.ok(Math.abs(effectiveEnemyMult(s.meta, 'riverfen') - base * 1.15 ** 2) < 1e-12);
  assert.ok(Math.abs(previewReward(s, 'riverfen').crowns - 1.0 * RAID.lumpSeconds * 1.1) < 1e-9);
});

test('an outcome from a different config is rejected at the seam', () => {
  const s = world([]);
  const cfg = buildBattleConfig(s, 'riverfen', [], null);
  const other = buildBattleConfig(world(['riverfen']), 'ashford', [], null);
  assert.throws(() => applyOutcome(s, cfg, outcomeFor(other)), /battleId/);
  assert.throws(
    () => applyOutcome(s, cfg, outcomeFor(cfg, 'win', { configHash: 'deadbeef' })),
    /configHash/,
  );
  assert.throws(
    () => applyOutcome(s, cfg, outcomeFor(cfg, 'win', { rewards: { crowns: 99999 } })),
    /rewards/,
  );
  assert.equal(s.meta.crowns, 0, 'a rejected outcome grants nothing');
});

test('boosters are consumed by what was FIRED, not by what was carried in', () => {
  const s = world([], { boosterRally: 1 }, 1000);
  s.meta.boosters.rally = 3;
  const cfg = buildBattleConfig(s, 'riverfen', ['rally'], null);
  assert.deepEqual(cfg.boosters, [{ id: 'rally', charges: 3 }]);
  assert.equal(s.meta.boosters.rally, 3, 'building a config must not mutate the inventory');

  applyOutcome(s, cfg, outcomeFor(cfg, 'retreat', { boostersConsumed: [{ id: 'rally', count: 1 }] }));
  assert.equal(s.meta.boosters.rally, 2, 'only the charge actually fired is spent');
});
