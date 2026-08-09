// THE RAID ECONOMY, and the pacing target the idle shop is supposed to hold.
//
// Both halves of the raid mode were economically broken and both were broken in
// a way a fixture-based test could not see, so nothing here hard-codes a payout.
// Every assertion is a RELATIONSHIP driven off REGIONS:
//
//   - a raid pays at least `RAID.minPayoffRatio` x what its own advertised
//     battle length would have idled, at every campaign stage;
//   - reward-per-difficulty never decays across clears;
//   - the payoff is anchored to the EMPIRE, so it cannot rot as the empire grows.
//
// A nineteenth region, a retuned `enemyMult`, a longer `targetLengthMin` or a
// new income upgrade all get measured by these automatically. That matters
// specifically here: the shipped bug was two constants, 0.10 against 0.15,
// whose ratio nobody had ever written down.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createState } from '../src/core/store.js';
import { CONTRACT_VERSION, hashBattleConfig } from '../src/battle/contract.js';
import { REGIONS, REGION_IDS, REGION_BY_ID, RAID } from '../src/content/regions.data.js';
import { UPGRADES, upgradeCost } from '../src/content/upgrades.data.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { markConquered, refreshUnlocks, effectiveEnemyMult } from '../src/meta/world.js';
import { applyOutcome, previewReward, raidLump } from '../src/meta/rewards.js';
import { incomePerSec, recalcIncome, timeToAfford, offlineCapMs } from '../src/meta/idle.js';
import { shopListing, buy, levelOf } from '../src/meta/upgrades.js';

/** Spend an idle budget the way tools/simplayer.js does: cheapest useful first. */
function spend(meta, crowns) {
  meta.crowns += crowns;
  for (let guard = 0; guard < 2000; guard++) {
    const affordable = shopListing(meta).flatMap((g) => g.items)
      .filter((i) => i.affordable && i.level < i.maxLevel)
      .sort((a, b) => a.cost - b.cost);
    if (!affordable.length) break;
    buy(meta, affordable[0].id, null);
  }
  recalcIncome(meta, null);
}

/** A player who has taken the first `n` regions and idled `idleMinutes` into the shop. */
function stage(n, idleMinutes = 60) {
  const s = createState({ seed: 11, now: 0 });
  for (const id of REGION_IDS.slice(0, n)) markConquered(s.meta, id, { now: 0, durationMs: 0 });
  refreshUnlocks(s.meta, null);
  recalcIncome(s.meta, null);
  if (idleMinutes > 0) spend(s.meta, incomePerSec(s.meta) * idleMinutes * 60);
  return s;
}

/** Seconds of idle income the lump is worth, over the region's advertised length. */
const payoffRatio = (meta, id) =>
  raidLump(meta, id) / (incomePerSec(meta) * REGION_BY_ID[id].targetLengthMin * 60);

// ===========================================================================
// 1. A raid is worth the wall clock it costs
// ===========================================================================

test('every raid pays at least its advertised battle length of empire income', () => {
  // The fault this replaces: at full conquest a riverfen raid paid 600 crowns
  // against ~682/s of income — 0.9 seconds of idling for an eight-minute
  // battle — and obsidian, the hardest fight in the game, paid 43 seconds for
  // nine minutes. Ratios of 0.14 and 0.085. Doing nothing dominated everything.
  for (let n = 1; n <= REGIONS.length; n++) {
    const s = stage(n);
    for (const id of REGION_IDS.slice(0, n)) {
      const ratio = payoffRatio(s.meta, id);
      assert.ok(
        ratio >= RAID.minPayoffRatio,
        `raiding ${id} at ${n} regions pays ${ratio.toFixed(3)}x its own battle length `
        + `of idling; RAID.minPayoffRatio demands ${RAID.minPayoffRatio}x`,
      );
    }
  }
});

test('the payoff ratio is invariant to how big the empire has become', () => {
  // The actual disease, stated as a property: the OLD lump was denominated in
  // the REGION's income, so its worth in idle-seconds fell by a factor of ~470
  // between owning riverfen and owning the world. Anchored to empire income,
  // raiding riverfen is worth the same slice of your own time all campaign.
  for (const id of ['riverfen', 'kaldan', 'karrowmere']) {
    const at = REGION_IDS.indexOf(id) + 1;
    const first = payoffRatio(stage(at).meta, id);
    const last = payoffRatio(stage(REGIONS.length).meta, id);
    assert.ok(
      Math.abs(last / first - 1) < 1e-9,
      `${id} pays ${first.toFixed(3)}x when it falls and ${last.toFixed(3)}x at full conquest`,
    );
  }
});

test('the lump follows the income upgrades, so the shop cannot re-open the hole', () => {
  // Tithe and Royal Mint multiply idle income by up to 3.19x between them. A
  // lump anchored to un-upgraded income would decay against them exactly the
  // way the region-anchored one decayed against conquest.
  const plain = stage(REGIONS.length, 0);
  const rich = stage(REGIONS.length, 0);
  rich.meta.crowns = 100_000;
  for (let i = 0; i < 5; i++) assert.ok(buy(rich.meta, 'tithe', null).ok, 'could not buy Tithe');
  assert.equal(levelOf(rich.meta, 'tithe'), 5, 'Tithe did not reach max');
  const grew = incomePerSec(rich.meta) / incomePerSec(plain.meta);
  assert.ok(grew > 1.7, `Tithe should move income a lot, moved it ${grew.toFixed(2)}x`);
  assert.ok(
    Math.abs(raidLump(rich.meta, 'obsidian') / raidLump(plain.meta, 'obsidian') - grew) < 1e-9,
    'the raid lump must grow with income, not stand still while it grows',
  );
});

test('harder regions pay strictly more per raid than easier ones at equal depth', () => {
  // Off REGIONS, so a nineteenth region that is harder but cheaper is caught.
  const s = stage(REGIONS.length);
  const byMult = [...REGIONS].sort((a, b) => a.enemyMult - b.enemyMult);
  for (let i = 1; i < byMult.length; i++) {
    const lo = byMult[i - 1];
    const hi = byMult[i];
    if (hi.enemyMult === lo.enemyMult) continue;
    assert.ok(
      raidLump(s.meta, hi.id) > raidLump(s.meta, lo.id),
      `${hi.id} (mult ${hi.enemyMult}) must out-pay ${lo.id} (mult ${lo.enemyMult})`,
    );
  }
});

// ===========================================================================
// 2. Repeat raids do not decay
// ===========================================================================

test('reward-to-difficulty never decays across clears, for any region', () => {
  // The shipped bug, as a property. Difficulty compounded at 1.15 and reward at
  // 1.10, so every clear was worth 0.957x the one before it, forever: ten
  // clears in, a raid was 35% worse value than the first and never recovered.
  const s = stage(REGIONS.length);
  for (const r of REGIONS) {
    let previous = null;
    for (let clears = 1; clears <= 12; clears++) {
      s.meta.regions[r.id].clears = clears;
      const perDifficulty = raidLump(s.meta, r.id) / effectiveEnemyMult(s.meta, r.id);
      if (previous !== null) {
        assert.ok(
          perDifficulty >= previous * (1 - 1e-12),
          `${r.id} clear ${clears} pays ${perDifficulty.toFixed(2)} per unit of difficulty, `
          + `down from ${previous.toFixed(2)} — raids decay with use`,
        );
      }
      previous = perDifficulty;
    }
  }
});

test('a deeper clear is worth strictly more crowns, in absolute terms too', () => {
  const s = stage(REGIONS.length);
  for (const r of REGIONS) {
    let previous = 0;
    for (let clears = 1; clears <= 12; clears++) {
      s.meta.regions[r.id].clears = clears;
      const lump = raidLump(s.meta, r.id);
      assert.ok(lump > previous, `${r.id} pays no more at clear ${clears} than at ${clears - 1}`);
      previous = lump;
    }
  }
});

test('a farmed region still pays its advertised length back at every depth', () => {
  // Non-decaying is not enough on its own: the ratio has to stay ABOVE the
  // floor as the region hardens, or deep farming quietly becomes a loss again.
  const s = stage(REGIONS.length);
  for (const r of REGIONS) {
    for (const clears of [1, 4, 8, 12]) {
      s.meta.regions[r.id].clears = clears;
      assert.ok(
        payoffRatio(s.meta, r.id) >= RAID.minPayoffRatio,
        `${r.id} at ${clears} clears pays ${payoffRatio(s.meta, r.id).toFixed(3)}x`,
      );
    }
  }
});

// ===========================================================================
// 3. ...through the real path, and without becoming a money printer
// ===========================================================================

test('a real won raid pays the previewed lump and adds no permanent income', () => {
  // Against buildBattleConfig + applyOutcome rather than a hand-built object:
  // the recurring failure mode in this repo is a fixture that encodes the bug.
  const s = stage(REGIONS.length);
  s.meta.regions.obsidian.raidReadyAt = 0;
  const before = { crowns: s.meta.crowns, income: incomePerSec(s.meta) };

  const preview = previewReward(s, 'obsidian');
  assert.equal(preview.kind, 'raid');
  assert.equal(preview.incomeAdded, 0);

  const cfg = buildBattleConfig(s.meta, 'obsidian', [], generateBattleMap, { seed: 3 });
  assert.equal(cfg.rules.isRaid, true);
  const summary = applyOutcome(s, cfg, {
    contractVersion: CONTRACT_VERSION,
    battleId: cfg.battleId,
    configHash: hashBattleConfig(cfg),
    regionId: 'obsidian',
    result: 'win',
    durationMs: 8 * 60 * 1000,
    ticks: 4800,
    stats: {
      sitesHeld: 36, sitesTotal: 36, unitsLost: 40, unitsKilled: 120,
      goldEarned: 9000, peakArmy: 180,
    },
    boostersConsumed: [],
  }, { now: RAID.cooldownMs });

  assert.equal(summary.raided, true);
  assert.equal(summary.crowns, preview.crowns, 'the preview must be the payout, not an estimate');
  assert.equal(summary.incomeAdded, 0);
  assert.equal(incomePerSec(s.meta), before.income, 'a raid must never add permanent income');
  assert.equal(s.meta.crowns, before.crowns + summary.crowns);
  // ...and it was worth playing: more than the battle's own length of idling.
  assert.ok(summary.crowns > before.income * 8 * 60);
});

test('raiding cannot bootstrap itself — the lump is not fed by lumps', () => {
  // `lump ∝ income` would be a runaway if raids added income. They do not: only
  // conquest does, and the multipliers on it are level-capped. Ten raids in a
  // row must leave the rate exactly where it started.
  const s = stage(REGIONS.length);
  const rate = incomePerSec(s.meta);
  for (let i = 0; i < 10; i++) {
    s.meta.crowns += raidLump(s.meta, 'obsidian');
    s.meta.regions.obsidian.clears += 1;
  }
  assert.equal(incomePerSec(s.meta), rate, 'crowns must not turn into income');
  // Compared to a relative epsilon rather than bit-for-bit: the left side is a
  // multiply followed by two divides, so whether it lands on the same double as
  // effectiveEnemyMult depends on the region's dial to the last ULP — a balance
  // pass that moves obsidian's enemyMult by 0.01 used to fail this on the
  // seventeenth decimal. The property (reward per difficulty is CONSTANT) is
  // unchanged, and 1e-12 is still tight enough to fail the 1.10-vs-1.15 decay
  // variant this test was written against by eight orders of magnitude.
  const perDifficulty = raidLump(s.meta, 'obsidian') / rate / RAID.lumpSeconds;
  const mult = effectiveEnemyMult(s.meta, 'obsidian');
  assert.ok(Math.abs(perDifficulty - mult) <= mult * 1e-12,
    `the only thing that grew was difficulty (${perDifficulty} vs ${mult})`);
});

// ===========================================================================
// 4. The pacing target idle.js states in prose, asserted
// ===========================================================================

test('the next thing to buy is always under the ~180s pacing target', () => {
  // meta/idle.js timeToAfford says: "The pacing target for the whole game is
  // that this stays under ~180 for the next NEEDED upgrade". Nothing checked
  // it. Worst case is a player who has just spent everything, which is exactly
  // what `spend()` leaves behind.
  const TARGET_SEC = 180;
  for (let n = 1; n <= REGIONS.length; n++) {
    const s = stage(n);
    const next = shopListing(s.meta).flatMap((g) => g.items)
      .filter((i) => i.level < i.maxLevel)
      .sort((a, b) => a.cost - b.cost)[0];
    assert.ok(next, `nothing left to buy at ${n} regions — the shop ran dry`);
    const wait = timeToAfford(s.meta, next.cost);
    assert.ok(
      wait <= TARGET_SEC,
      `at ${n} regions the cheapest unbought line (${next.id}, ${next.cost}) is `
      + `${Math.round(wait)}s away; the pacing target is ${TARGET_SEC}s`,
    );
  }
});

test('the offline cap still buys something, and the Granary line pays for itself', () => {
  // "Meaningful" has to mean measurable: a capped-out absence must be worth
  // more than the cheapest unbought line and less than the whole remaining
  // shop, or the cap has stopped being a decision in either direction.
  const totalShop = UPGRADES.reduce((sum, u) => {
    let c = 0;
    for (let l = 0; l < u.maxLevel; l++) c += upgradeCost(u, l);
    return sum + c;
  }, 0);
  for (let n = 1; n <= REGIONS.length; n++) {
    const s = stage(n);
    const rate = incomePerSec(s.meta);
    const capped = (rate * offlineCapMs(s.meta)) / 1000;
    const cheapest = shopListing(s.meta).flatMap((g) => g.items)
      .filter((i) => i.level < i.maxLevel).sort((a, b) => a.cost - b.cost)[0];
    assert.ok(capped > cheapest.cost,
      `a full offline claim at ${n} regions cannot buy even ${cheapest.id}`);
    // Granary: every level must return its own cost within a single capped
    // absence at the stage it becomes affordable, or it is a trap purchase.
    const level = levelOf(s.meta, 'granary');
    if (level > 0) {
      const perLevel = (rate * 4 * 3600);
      assert.ok(perLevel > upgradeCost({ cost: { base: 120, rate: 2.0 } }, level - 1),
        `Granary level ${level} costs more than the 4h it grants is worth at ${n} regions`);
    }
  }
  assert.ok(totalShop > 0);
});
