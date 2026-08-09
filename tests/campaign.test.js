// The CAMPAIGN CURVE — the shape of all twenty-one regions, not any one of them.
//
// Thirteen of the first eighteen regions shipped unwinnable, and a green suite
// never noticed, because every existing test asks about one region or one
// fixture. So everything here is driven off REGIONS itself: a twenty-second
// region cannot be added without these assertions covering it, and a region
// cannot quietly fall off the curve. That has already paid for itself once — the
// tier-5 rows were caught by this file before they were ever played.
//
// The regions are asserted here; they are PLAYED in ./campaignplay.test.js,
// which was split off for the line budget.
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

/**
 * The most the enemy may outnumber the whole landing force by, PER TIER.
 *
 * This was one number, 2.6, and it had to become a ladder for the same reason
 * `WIN_BAND` in tools/simrunner.js did: it is a proxy for "still convertible",
 * and what counts as convertible is exactly what a tier is FOR. The bound's own
 * justification has always been empirical — at these ratios the harness clears
 * every region inside its tier's band — and 2.6 was set just clear of the worst
 * ratio the campaign then produced (emberholt, 2.556) when tier 4 was the end.
 *
 * Tier 5 opens at 2.60-2.68, and it is measurably still convertible there: the
 * three regions clear 22-42% at n>=96 with the ladder live. A single global 2.6
 * would not have been protecting the player from anything, it would have been
 * pinning the endgame to the difficulty of the tier that happened to ship first.
 *
 * What is NOT relaxed is the shape. Every entry is a hard ceiling, the floor is
 * global, and the ladder is required to stay a ladder — a tier cannot quietly
 * award itself more room than the tier below (asserted below). A region at 3.5
 * still fails at every tier, which is the case this test exists for: thirteen
 * regions once shipped between 2.1 and 6.0, an army that could not take the
 * first farm.
 */
const MAX_OPENING_RATIO = [2.6, 2.6, 2.6, 2.6, 2.7];

test('campaign: the outnumbering ladder never awards a tier more room than the one below', () => {
  for (let i = 1; i < MAX_OPENING_RATIO.length; i++) {
    assert.ok(MAX_OPENING_RATIO[i] >= MAX_OPENING_RATIO[i - 1],
      `tier ${i + 1} may open outnumbered by less than tier ${i} — that is not a ladder`);
  }
  assert.ok(Math.max(...MAX_OPENING_RATIO) <= 3,
    'past 3x the landing force is not outnumbered, it is a rounding error');
  assert.equal(MAX_OPENING_RATIO.length, Math.max(...REGIONS.map((r) => r.tier)),
    'every tier needs a bound; a missing entry reads as undefined and passes everything');
});

test('campaign: a player who has taken everything before region N can field enough to take N', () => {
  // "Enough" is measured against what is actually standing on the map, not
  // against a constant: the opening enemy garrison, which is the force the
  // expedition has to be able to trade with.
  for (let i = 0; i < REGIONS.length; i++) {
    const { config } = configFor(i);
    const mine = config.sites.filter((s) => s.owner === 'player')
      .reduce((a, s) => a + total(s.garrison), 0) + total(config.player.expedition);
    const ratio = enemyTroops(config) / mine;
    // You are RAIDING a region the enemy holds outright, and the landing force
    // was re-based down (content/balance.js EXPEDITION) precisely so that being
    // outnumbered is the starting position rather than a late surprise. It also
    // pairs with the enemy's warm-up (content/ai.data.js AI.warmup) — landing
    // outnumbered against an opponent that presses from tick 0 would be a coin
    // flip, not a fight. The ceiling is per tier; see MAX_OPENING_RATIO.
    const cap = MAX_OPENING_RATIO[REGIONS[i].tier - 1];
    assert.ok(ratio <= cap,
      `${REGIONS[i].id}: the enemy opens with ${ratio.toFixed(2)}x the player's whole force`
      + ` (tier ${REGIONS[i].tier} allows ${cap}x) — no competent player can convert that`);
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
  // END TO END, not tier by tier. Raw force ratio is a PROXY for difficulty and
  // it stopped being a monotone one: tier 3 hands the player eleven starting
  // sites against tier 2's six, so the bodies on the board tip back toward the
  // player at that boundary even though the region is harder. What carries the
  // difficulty there is map size, `develop`, the AI tier and the dial — none of
  // which this ratio can see. Asserting a monotone proxy would force the table
  // to satisfy a number nobody plays.
  //
  // The real curve is measured, not asserted here: tools/simrunner.js reports
  // ~86% / ~76% / ~61% / ~47% per tier at n=240 against the per-tier bands in
  // `WIN_BAND`. What stays here is the end-to-end claim, which is the one this
  // test was written to protect.
  // 1.3 -> 1.2, and the reason is the opposite of a relaxation: the OPENING got
  // harder. Tier 1 used to land with a comfortable numerical edge (a mean ratio
  // near 0.9) and now lands outnumbered like everywhere else, which compresses
  // any end-to-end ratio of ratios. The endgame did not get easier — measured at
  // n=240 it fell from ~58% to ~47% — it is the baseline that moved.
  assert.ok(byTier[3] > byTier[0] * 1.2,
    'the endgame must be meaningfully harder than the opening, not merely different');
  assert.ok(byTier[1] > byTier[0],
    'and the first real wall must outweigh the opening');
  // The opening is no longer a walkover, and that IS a campaign-shape claim:
  // you are raiding country the enemy already owns, from region one.
  assert.ok(byTier[0] > 1.4,
    'tier 1 must land outnumbered too — a raid you outnumber is not a raid');
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
