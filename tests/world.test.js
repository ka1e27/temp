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

test('tier counts are 4 / 5 / 5 / 4 / 3 / 3 and difficulty only ever goes up', () => {
  const tiers = [...new Set(REGIONS.map((r) => r.tier))].sort((a, b) => a - b);
  assert.deepEqual(tiers, [1, 2, 3, 4, 5, 6], 'the tiers must be contiguous from 1');
  const counts = tiers.map((t) => REGIONS.filter((r) => r.tier === t).length);
  assert.deepEqual(counts, [4, 5, 5, 4, 3, 3]);
  for (let i = 1; i < REGIONS.length; i++) {
    // NON-DECREASING, NOT STRICTLY INCREASING — the canonical check (and the
    // one that actually matters) is `tests/campaign.test.js` "enemyMult never
    // falls across the campaign", which uses >=. This one used to be stricter
    // for no documented reason, and the full retune's own opening constraint
    // makes a tie deliberate: `enemyMult` is capped at <=3.10 across tiers 1-2
    // (kaldan, highmarch, greywater, thornmoor and emberholt all land on the
    // cap), with the rest of a tier's difficulty carried by `AI_TIERS[].
    // economyMult` and `siteCounts.enemy` instead — columns this test does not
    // look at. A strict `>` here would fail on a table that is exactly as
    // designed, which is what it did.
    assert.ok(REGIONS[i].enemyMult >= REGIONS[i - 1].enemyMult, `${REGIONS[i].id} is not harder`);
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
    // ADVERTISED LENGTH IS NOT REQUIRED TO RAMP WITHIN A TIER OR ACROSS THE
    // CAMPAIGN, AND THAT IS A FINDING FROM THE FULL RETUNE, NOT A RELAXATION.
    //
    // Both a within-tier "never gets shorter" check and a stronger cross-tier
    // one across regions 1-9 used to live here, on the theory that a harder
    // region is a longer one. Re-measured end to end at n=96 after the whole
    // table was re-tuned onto win-rate bands (CLAUDE.md "Tuning"), neither
    // survives: `targetLengthMin` is authored from each region's own measured
    // WIN MEDIAN now (tools/simrunner.js `win-med`), and win-median tracks how
    // decisively THAT region's fight resolves — map shape, castle position,
    // gate fraction — which is a different axis from win RATE. It is common
    // for the first region of a tier to measure the longest win of the tier,
    // because the dial and the site count that make later regions harder to
    // WIN do not make a won fight slower; several times they make it faster
    // (a bigger landing force with the same castle to reach converges sooner).
    // Forcing the column to ramp anyway would mean lying about specific
    // regions to preserve a shape nothing plays against — exactly the failure
    // mode this project's own campaignplay.test.js exists to catch. That test
    // (`no region advertises a length it cannot deliver`) is what actually
    // matters, and it is asserted per region against real measurement rather
    // than against its neighbours.
    assert.ok(b.hardCapMs > b.targetLengthMin * 60_000 * 1.2,
      `${b.id} hard cap is a timer you play against, not a backstop`);
  }
  // The final region is the biggest board and the biggest war in the campaign.
  // Pinned as a FLOOR rather than an exact grid: it was `deepEqual([17, 13])`,
  // which is a restatement of one table row and had to be edited by hand the
  // moment a fifth tier shipped. What it is actually protecting is that the last
  // region never quietly becomes a small one.
  const last = REGIONS[REGIONS.length - 1];
  const biggest = Math.max(...REGIONS.map((r) => r.grid.cols * r.grid.rows));
  assert.equal(last.grid.cols * last.grid.rows, biggest,
    `${last.id} is the last region but not the biggest board`);
  assert.ok(last.grid.cols >= 17 && last.grid.rows >= 13,
    `${last.id} is ${last.grid.cols}x${last.grid.rows} — smaller than the endgame ever was`);
  assert.ok(last.siteCounts.enemy + last.siteCounts.neutral + last.siteCounts.player >= 22);
});

// These are the TUNED values, not the ones the design doc first proposed.
// The original table (7v2 at region 1, rising to 12v2) measured at a 0% win
// rate in tools/simrunner.js: the player could not out-produce the enemy and
// every run stalled. The numbers below are what the harness actually clears at
// 60-80% with zero losses. Change them only with fresh simrunner output.
test('the vertical slice matches the tuned balance table', () => {
  const table = [
    // Re-measured end to end for the battle-redesign re-tune — the pass that
    // followed free movement, the yard/wall split, construction, towers, the
    // slower march and fog. Every column below moved, and the dial moved MOST
    // at this end of the table, because that redesign inverted the campaign's
    // difficulty curve: a slower board hurts whoever is trying to EXPAND and
    // helps whoever is trying to SURVIVE, so tier 1 got harder while tiers 4-5
    // got easier, and the two ends had to move in opposite directions.
    //
    // `targetLengthMin` is re-authored from the WIN MEDIAN measured alongside
    // each win rate, never from the all-runs median (tools/simrunner.js says
    // why at length). grid/siteCounts/reward are untouched.
    //
    // NOTHING HERE IS KNOWINGLY OUT OF BAND ANY MORE. This block used to carry
    // a standing note that kaldan read 40% against tier 2's 66% floor and that
    // the suspect was an `AI_TIERS[1].economyMult` edit surviving a rebuild.
    // That is closed: kaldan is tuned on its own dial (3.34 -> 3.19) and reads
    // inside its band on the same sweep as every other row.
    //
    // SALTMERE IS THE ONE TIER-1 ROW THE SIEGE FRONTAGE MOVED (dial 3.08 ->
    // 3.05, neutral 4 -> 3), and it took both because they very nearly cancel:
    // at n=240 the dial step is worth -5 and the neutral cut +5, so 3.08/3 read
    // 76% and 3.05/4 read 77% — both under the floor — while 3.05/3 reads 80%.
    // A frontage that only bites a crowd still shaves the opening, because an
    // early landing force IS a crowd: it has almost no engines in it.
    //
    // AND n=96 READ THIS ROW ~5 POINTS HIGH THREE TIMES RUNNING. `--n` takes a
    // seed PREFIX, so a smaller sample is not an unbiased draw from a bigger
    // one — saltmere's first 96 seeds are simply kind. Confirm a tier-1 band
    // edge at 240 or do not confirm it.
    ['riverfen', 1, 1.82, 11, 9, 5, 3, 3, 1.0, 9.5],
    ['ashford', 1, 2.66, 12, 9, 6, 3, 3, 1.2, 10],
    ['ironwood', 1, 3.04, 13, 10, 7, 4, 3, 1.5, 9.5],
    ['saltmere', 1, 3.05, 13, 10, 8, 3, 4, 1.8, 7.5],
    ['kaldan', 2, 3.19, 15, 11, 9, 5, 4, 4.0, 8.5],
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
  // The lump is EMPIRE income x lumpSeconds x the difficulty actually faced.
  // Riverfen alone pays 1.0/s, and one clear is on the board, so the dial is
  // its own enemyMult x 1.15. Read from content rather than written down: this
  // test is about the RELATIONSHIP, and hardcoding the dial made it fail every
  // balance pass for no reason.
  const dial = REGION_BY_ID.riverfen.enemyMult * (1 + RAID.harderPerClear);
  assert.ok(Math.abs(summary.crowns - 1.0 * RAID.lumpSeconds * dial) < 1e-9);
  assert.equal(s.meta.regions.riverfen.clears, 2);
  assert.equal(canRaid(s.meta, 'riverfen', RAID.cooldownMs), false, 'cooldown restarts');
  assert.equal(canRaid(s.meta, 'riverfen', RAID.cooldownMs * 2), true);
});

test('each clear makes a region 15% harder, and pays exactly 15% more for it', () => {
  const s = world([]);
  const base = REGION_BY_ID.riverfen.enemyMult;
  assert.equal(effectiveEnemyMult(s.meta, 'riverfen'), base);
  markConquered(s.meta, 'riverfen', { now: 0 });
  assert.ok(Math.abs(effectiveEnemyMult(s.meta, 'riverfen') - base * 1.15) < 1e-12);
  assert.equal(previewReward(s, 'riverfen').kind, 'raid');
  // Riverfen alone pays 1.0/s, so the lump is lumpSeconds x the difficulty dial.
  const one = previewReward(s, 'riverfen').crowns;
  assert.ok(Math.abs(one - 1.0 * RAID.lumpSeconds * base * 1.15) < 1e-9);
  s.meta.regions.riverfen.clears = 2;
  assert.ok(Math.abs(effectiveEnemyMult(s.meta, 'riverfen') - base * 1.15 ** 2) < 1e-12);
  const two = previewReward(s, 'riverfen').crowns;
  assert.ok(Math.abs(two - 1.0 * RAID.lumpSeconds * base * 1.15 ** 2) < 1e-9);
  // The point of the pass: difficulty and reward move by the SAME factor, so
  // the second clear is not worse value than the first. The old table paid
  // 1.10 against 1.15 and lost 4.3% of its value on every single clear.
  assert.ok(Math.abs(two / one - 1.15) < 1e-9, 'reward must track difficulty exactly');
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
