// The CAMPAIGN CURVE — the shape of all eighteen regions, not any one of them.
//
// Thirteen of the eighteen regions shipped unwinnable, and a green suite never
// noticed, because every existing test asks about one region or one fixture.
// So everything here is driven off REGIONS itself: a nineteenth region cannot be
// added without these assertions covering it, and a region cannot quietly fall
// off the curve.
//
// Nothing here re-implements a formula. The power assertions build a REAL
// BattleConfig through buildBattleConfig + generateBattleMap, which is the same
// path tools/simrunner.js and the prebattle screen use, so a number that only
// exists in a content table cannot pass.
import test from 'node:test';
import assert from 'node:assert/strict';

import { generateBattleMap } from '../src/battle/mapgen.js';
import { buildBattleConfig, expeditionSlots } from '../src/meta/modifiers.js';
import { startBattle } from '../src/battle/sim.js';
import { total } from '../src/battle/combat.js';
import { garrisonCap } from '../src/battle/training.js';
import { factionGoldPerSec } from '../src/battle/economy.js';
import { REGIONS, REGION_IDS, totalSites } from '../src/content/regions.data.js';
import { SITE_LEVELS, EXPEDITION } from '../src/content/balance.js';
import { metaFor } from '../tools/simplayer.js';
import { playerTurn } from '../tools/simplayer.js';
import { step } from '../src/battle/sim.js';

/** The empire a player has when they attack `i`: everything before it. */
const before = (i) => REGION_IDS.slice(0, i);

/** A real config for "the player who has taken every earlier region". */
function configFor(i, { seed = 4242, idleMin = 10 } = {}) {
  const meta = metaFor(before(i), idleMin, seed).meta;
  return { meta, config: buildBattleConfig(meta, REGIONS[i].id, [], generateBattleMap, { seed }) };
}

const enemyTroops = (config) => config.sites
  .filter((s) => s.owner === 'enemy').reduce((a, s) => a + total(s.garrison), 0);

/** Monotone helper that names the offender instead of just failing. */
function nonDecreasing(values, label, key = (r) => r.id) {
  for (let i = 1; i < values.length; i++) {
    assert.ok(values[i].v >= values[i - 1].v,
      `${label} must never go backwards: ${key(values[i - 1])}=${values[i - 1].v}`
      + ` then ${key(values[i])}=${values[i].v}`);
  }
}

// ===========================================================================
// 1. The dials rise. Every one of them, in campaign order.
// ===========================================================================

test('campaign: enemyMult never falls across the campaign', () => {
  nonDecreasing(REGIONS.map((r) => ({ id: r.id, v: r.enemyMult })), 'enemyMult');
  // ...and it actually goes somewhere. A flat dial would pass a monotone check.
  assert.ok(REGIONS.at(-1).enemyMult >= REGIONS[0].enemyMult * 2,
    'the last region should be at least twice the first on the dial');
});

test('campaign: the war gets bigger — grid, sites and development all rise', () => {
  nonDecreasing(REGIONS.map((r) => ({ id: r.id, v: r.grid.cols * r.grid.rows })), 'grid area');
  nonDecreasing(REGIONS.map((r) => ({ id: r.id, v: r.siteCounts.enemy })), 'enemy sites');
  nonDecreasing(REGIONS.map((r) => ({ id: r.id, v: r.siteCounts.player })), 'player sites');
  nonDecreasing(REGIONS.map((r) => ({ id: r.id, v: totalSites(r) })), 'total sites');
  nonDecreasing(REGIONS.map((r) => ({ id: r.id, v: r.develop })), 'develop');
  assert.ok(REGIONS.at(-1).siteCounts.enemy >= REGIONS[0].siteCounts.enemy * 3,
    'the endgame should be a genuinely bigger war, not the same map re-priced');
});

test('campaign: reward income rises smoothly, with no tier cliff', () => {
  nonDecreasing(REGIONS.map((r) => ({ id: r.id, v: r.rewardPerSec })), 'rewardPerSec');
  // A cliff at a tier boundary is what made the FIRST region of each tier the
  // hardest in the campaign: the player meets a new AI tier without having yet
  // banked the income that pays for the upgrades to answer it. Measured at
  // n=96, thanescar sat 20 points below both its neighbours until the 17 -> 38
  // crowns/sec step at the tier-4 boundary was smoothed away.
  //
  // Kaldan is the one exception and it is a frozen one: saltmere 1.8 -> kaldan
  // 4.0 is the tier-1/tier-2 step that regions 1-5 were balance-frozen around,
  // so it is bounded rather than smoothed.
  for (let i = 1; i < REGIONS.length; i++) {
    const ratio = REGIONS[i].rewardPerSec / REGIONS[i - 1].rewardPerSec;
    const cap = REGIONS[i].id === 'kaldan' ? 2.3 : 2.2;
    assert.ok(ratio <= cap,
      `${REGIONS[i].id} pays ${ratio.toFixed(2)}x the region before it —`
      + ' an income cliff spikes the difficulty of whatever follows it');
  }
  // The 2.2x bound above is only meaningful if the ramp is otherwise tight, so
  // pin the tail — every region past the frozen opening — to a real step.
  for (let i = 5; i < REGIONS.length; i++) {
    const ratio = REGIONS[i].rewardPerSec / REGIONS[i - 1].rewardPerSec;
    assert.ok(ratio >= 1.1 && ratio <= 1.4,
      `${REGIONS[i].id} pays ${ratio.toFixed(2)}x the region before it —`
      + ' the tail should compound evenly, not step');
  }
});

test('campaign: develop stays on the ladder content/balance.js actually defines', () => {
  for (const r of REGIONS) {
    assert.ok(r.develop >= 1 && r.develop <= SITE_LEVELS.length,
      `${r.id} develop ${r.develop} is off the SITE_LEVELS ladder`);
  }
  // Regions 1-5 are balance-frozen, and `develop` is the knob most able to move
  // them, so it is pinned rather than merely low.
  for (const id of ['riverfen', 'ashford', 'ironwood', 'saltmere', 'kaldan']) {
    assert.equal(REGIONS.find((r) => r.id === id).develop, 1,
      `${id} is balance-frozen: its enemy must start on raw level-1 ground`);
  }
});

// ===========================================================================
// 2. The player's power keeps up. This is the half that was never checked.
// ===========================================================================

test('campaign: the expedition grows with the empire, in every region', () => {
  const slots = REGIONS.map((r, i) => ({ id: r.id, v: expeditionSlots(metaFor(before(i), 0).meta) }));
  nonDecreasing(slots, 'expedition slots');
  for (let i = 1; i < slots.length; i++) {
    assert.ok(slots[i].v > slots[i - 1].v,
      `conquering ${REGIONS[i - 1].id} must buy a strictly bigger expedition`);
  }
});

test('campaign: the taper leaves the frozen opening untouched', () => {
  // regionsConquered is 0..4 for regions 1-5, so the old flat rate must still
  // be exactly what those five spend. This is the guard on the taper, not a
  // restatement of it: it recomputes the pre-taper number independently.
  for (let i = 0; i < 5; i++) {
    const slots = expeditionSlots(metaFor(before(i), 0).meta);
    assert.equal(slots, EXPEDITION.base + EXPEDITION.perRegion * i,
      `region ${i + 1} (${REGIONS[i].id}) is balance-frozen and must land`
      + ' the pre-taper expedition exactly');
  }
});

test('campaign: a player who has taken everything before region N can field enough to take N', () => {
  // "Enough" is measured against what is actually standing on the map, not
  // against a constant: the opening enemy garrison, which is the force the
  // expedition has to be able to trade with. Thirteen regions shipped with this
  // ratio between 2.1 and 6.0 — an army that could not take the first farm.
  for (let i = 0; i < REGIONS.length; i++) {
    const { config } = configFor(i);
    const mine = config.sites.filter((s) => s.owner === 'player')
      .reduce((a, s) => a + total(s.garrison), 0) + total(config.player.expedition);
    const ratio = enemyTroops(config) / mine;
    assert.ok(ratio <= 1.9,
      `${REGIONS[i].id}: the enemy opens with ${ratio.toFixed(2)}x the player's whole force`
      + ' — no competent player can convert that');
    assert.ok(ratio >= 0.6,
      `${REGIONS[i].id}: the player opens with more than they can lose (${ratio.toFixed(2)}x)`);
  }
});

test('campaign: difficulty rises — the enemy gains on the player, region by region', () => {
  const ratios = REGIONS.map((r, i) => {
    const { config } = configFor(i);
    const mine = config.sites.filter((s) => s.owner === 'player')
      .reduce((a, s) => a + total(s.garrison), 0) + total(config.player.expedition);
    return { id: r.id, v: enemyTroops(config) / mine };
  });
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const byTier = [1, 2, 3, 4].map((t) => mean(
    ratios.filter((_, i) => REGIONS[i].tier === t).map((x) => x.v),
  ));
  nonDecreasing(byTier.map((v, i) => ({ id: `tier ${i + 1}`, v })), 'per-tier enemy:player force',
    (r) => r.id);
  assert.ok(byTier[3] > byTier[0] * 1.3,
    'the endgame must be meaningfully harder than the opening, not merely different');
});

// ===========================================================================
// 3. The seam actually carries it. Numbers that never reach a battle are lies.
// ===========================================================================

test('campaign: develop reaches the battle as real levels, HP and training', () => {
  const meanFort = [];
  for (let i = 0; i < REGIONS.length; i++) {
    const r = REGIONS[i];
    const battle = startBattle(configFor(i).config);
    const forts = battle.sites.filter((s) => s.owner === 'enemy' && s.kind !== 'farm');
    // develop is fractional: a share of the forts sits one level above the
    // floor, so every fort must land on floor(develop) or the step above it and
    // nowhere else. That is the whole promise of the fractional ladder.
    for (const s of forts) {
      assert.ok(s.level >= Math.floor(r.develop) && s.level <= Math.ceil(r.develop),
        `${r.id}: a ${s.kind} at level ${s.level} is off a develop-${r.develop} ladder`);
    }
    const mean = forts.reduce((a, s) => a + s.level, 0) / forts.length;
    assert.ok(Math.abs(mean - r.develop) <= 0.5,
      `${r.id}: mean fort level ${mean.toFixed(2)} does not track develop ${r.develop}`);
    meanFort.push({ id: r.id, v: mean });

    // The level is worth something once it is there.
    const castle = battle.sites.find((s) => s.kind === 'castle');
    assert.ok(castle.hpMax >= 480 * SITE_LEVELS[castle.level - 1].hp - 0.001,
      `${r.id}: the castle is at level ${castle.level} but has level-1 walls`);
    assert.ok(garrisonCap(battle, castle) >= 80,
      `${r.id}: a developed castle must be able to hold more than a raw one`);
    // The player and the neutrals never get the head start.
    for (const s of battle.sites) {
      if (s.owner !== 'enemy') {
        assert.equal(s.level, 1, `${r.id}: ${s.owner} site ${s.id} started built`);
      }
    }
  }
  nonDecreasing(meanFort, 'mean enemy fort level');
});

test('campaign: the throne is the last fight, not the last speed bump', () => {
  // victory is capture-castle, so whatever else a region is worth, the castle
  // decides how long it takes. A castle held like a farm ends a twelve-minute
  // war in four seconds — which is exactly what every tier-3 and tier-4 region
  // used to do, at every setting of enemyMult.
  const held = REGIONS.map((r, i) => {
    const battle = startBattle(configFor(i).config);
    const castle = battle.sites.find((s) => s.kind === 'castle');
    const farms = battle.sites.filter((s) => s.owner === 'enemy' && s.kind === 'farm');
    const perFarm = farms.reduce((a, s) => a + total(s.garrison), 0) / Math.max(1, farms.length);
    return { id: r.id, v: total(castle.garrison) / Math.max(1, perFarm) };
  });
  // The throne's own garrison is the thing that must never go backwards; the
  // ratio to a farm is the thing that must GROW, and it is compared end to end
  // because its denominator is a five-man garrison that wobbles on rounding.
  const bodies = REGIONS.map((r, i) => {
    const battle = startBattle(configFor(i).config);
    return { id: r.id, v: total(battle.sites.find((s) => s.kind === 'castle').garrison) };
  });
  nonDecreasing(bodies, 'enemy castle garrison');
  assert.ok(held.at(-1).v >= held[0].v * 2.5,
    'the final throne must be defended like a capital, not like an outpost');
  for (let i = 0; i < 5; i++) {
    assert.ok(held[i].v < 2, `${held[i].id} is balance-frozen: its castle must stay an outpost`);
  }
});

test('campaign: the enemy economy stays inside a multiple of the player it faces', () => {
  // The AI tier handicap is applied in battle/economy.js and NOWHERE ELSE. It
  // once rode meta/modifiers.js `enemyMods` as well, on both goldRateMult and
  // farmYieldMult, so a farm felt it three times: obsidian's enemy earned 537
  // gold/sec against the player's 30. This is the guard on that.
  for (let i = 0; i < REGIONS.length; i++) {
    const battle = startBattle(configFor(i).config);
    const ratio = factionGoldPerSec(battle, 'enemy') / factionGoldPerSec(battle, 'player');
    assert.ok(ratio <= 4,
      `${REGIONS[i].id}: the enemy opens on ${ratio.toFixed(1)}x the player's income`);
  }
});

// ===========================================================================
// 4. Winnable, end to end, through the same bot the balance table is measured
//    with. Small n on purpose — this is a floor, not the tuning instrument.
// ===========================================================================

function playOnce(i, seed) {
  const battle = startBattle(configFor(i, { seed }).config);
  let nextThink = 0;
  while (battle.status === 'running' && battle.tick < battle.rules.hardCapTicks) {
    if (battle.tick >= nextThink) { playerTurn(battle); nextThink = battle.tick + 20; }
    step(battle);
  }
  return battle;
}

test('campaign: every region is winnable by an ordinary player, at every tier', { timeout: 600000 }, () => {
  // Deliberately a FLOOR of one win in six rather than a win-rate assertion:
  // tuning happens on tools/simrunner.js at n >= 48, and a 55% gate re-measured
  // at n=6 fails on noise about one run in eight. What this catches is the thing
  // that actually shipped — a region no seed can beat.
  for (let i = 0; i < REGIONS.length; i++) {
    const wins = [1, 2, 3, 4, 5, 6]
      .map((k) => playOnce(i, 1000 + k * 7919))
      .filter((b) => b.status === 'win').length;
    assert.ok(wins > 0,
      `${REGIONS[i].id} was not won once in six attempts — it is not a hard region,`
      + ' it is a broken one');
  }
});

test('campaign: no region advertises a length it cannot deliver', { timeout: 900000 }, () => {
  // The replacement for the cross-tier length ramp that tests/world.test.js
  // used to assert. That one compared two numbers in a table to each other;
  // this one compares each number to what the region actually plays like, which
  // is the property that was broken — tier-3 and tier-4 regions advertised 17 to
  // 23 minutes and resolved in six to nine.
  //
  // The band is tools/simrunner.js's own: [0.5x, 1.6x] the advertised length,
  // widened here to [0.35x, 2.2x] because n=8 is a smoke sample and the tuning
  // instrument is the harness at n >= 48. Tight enough to catch a 23-minute
  // claim on a seven-minute region by a factor of three.
  for (let i = 0; i < REGIONS.length; i++) {
    const r = REGIONS[i];
    const mins = [1, 2, 3, 4, 5, 6, 7, 8]
      .map((k) => playOnce(i, 1000 + k * 7919).tick / 600)
      .sort((a, b) => a - b);
    const median = mins[Math.floor(mins.length / 2)];
    assert.ok(median >= r.targetLengthMin * 0.35 && median <= r.targetLengthMin * 2.2,
      `${r.id} advertises ${r.targetLengthMin}m and plays ${median.toFixed(1)}m`);
  }
});

test('campaign: the enemy never disarms itself over a long battle', () => {
  // The regression this exists for. `ramTrainShare` and `counterTrainShare` are
  // SHARES of production; rolled per think against every eligible site — which
  // is how the ram appetite was originally written — they ratchet to 100%,
  // because a stronghold that flips never flips back. Rams defend at 2 and a
  // counter-picked raider at 4, against the 8-with-a-1.75-bulwark of the
  // spearmen they replace, so after a few minutes every wall in the region was
  // paper. Only tiers 3 and 4 adapt, so the effect landed precisely on the
  // regions meant to be hardest: at n=48 with the tail dial already re-curved,
  // obsidian won 83% in 5.0 minutes against tier-2 highmarch's 8%.
  const i = REGIONS.length - 1;                       // obsidian: tier 4, rams + adapt
  const battle = startBattle(configFor(i).config);
  let nextThink = 0;
  const worst = { rams: 0, nonSpear: 0 };
  for (let t = 0; t < 3600 && battle.status === 'running'; t++) {
    if (battle.tick >= nextThink) { playerTurn(battle); nextThink = battle.tick + 20; }
    step(battle);
    const forts = battle.sites.filter((s) => s.owner === 'enemy' && s.kind === 'stronghold');
    if (forts.length < 4) continue;                   // too few left to say anything
    const share = (u) => forts.filter((s) => s.trainType === u).length / forts.length;
    worst.rams = Math.max(worst.rams, share('rams'));
    worst.nonSpear = Math.max(worst.nonSpear, 1 - share('spearmen'));
  }
  assert.ok(worst.rams <= 0.75,
    `${(worst.rams * 100).toFixed(0)}% of the enemy's strongholds were building siege engines`
    + ' — the ram appetite has ratcheted again');
  assert.ok(worst.nonSpear <= 0.9,
    'the enemy abandoned its spear backbone entirely; a wall held by def-2 rams'
    + ' and def-4 raiders is not a wall');
});

test('campaign: conquest is what makes the next region possible', () => {
  // The campaign has to be GATED, not merely ordered. A player who skipped
  // straight to a late region with an empire of zero should not be able to
  // field a force that can trade with it — otherwise the whole idle loop is
  // decoration. (This is also the exact bug that hid the broken regions: the
  // harness simulated precisely this player and reported 0% for all thirteen.)
  const late = REGIONS.length - 1;
  const bare = buildBattleConfig(metaFor([], 0).meta, REGIONS[late].id,
    [], generateBattleMap, { seed: 4242 });
  const earned = configFor(late).config;
  assert.ok(total(earned.player.expedition) > total(bare.player.expedition) * 2.5,
    'an empire should be worth multiples of a standing start by the last region');
  assert.ok(enemyTroops(bare) / total(bare.player.expedition) > 3,
    'the last region must be out of reach of a player who conquered nothing');
});
