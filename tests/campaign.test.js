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
import { garrisonCap, siteTrainRate } from '../src/battle/training.js';
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

test('campaign: the expedition segments start where the war changes shape', () => {
  // This asserted that regions 1-5 spend exactly `base + perRegion * i`, because
  // `taperAfter` was 4 and regions 1-5 were "balance-frozen". Both halves of
  // that have since gone: nothing is frozen (the expedition re-base changed
  // regions 1-5 by construction), and `taperAfter` moved 4 -> 3 because KALDAN
  // WAS SITTING ON THE BOUNDARY AND GETTING NOTHING. It is a tier-2 region that
  // was still being paid at the tier-1 rate — 52 slots against highmarch's 76 —
  // which is why it measured 56% against its band's 66% floor while every other
  // region in its tier cleared. Moving the boundary one region earlier took it
  // to 81% and touched nothing else, because `early` is `min(conquered, 3)` and
  // regions 1-4 are attacked with 0-3 conquests.
  //
  // What is worth asserting is the SHAPE: each segment is a rate that applies
  // over a range, the ranges tile the campaign without gaps, and the opening
  // regions are on the first rate. Recomputed independently rather than by
  // calling the same helper back.
  const { base, perRegion, taperAfter, perRegionLate, surgeAfter, perRegionSurge, surgeBonus }
    = EXPEDITION;
  assert.ok(taperAfter < surgeAfter, 'the segment boundaries are out of order');
  for (let i = 0; i <= taperAfter; i++) {
    assert.equal(expeditionSlots(metaFor(before(i), 0).meta), base + perRegion * i,
      `region ${i + 1} (${REGIONS[i].id}) must land the opening rate exactly`);
  }
  // ...and one region past each boundary picks up that segment's rate, with the
  // one-time step landing exactly once.
  const at = (n) => expeditionSlots(metaFor(before(n), 0).meta);
  assert.equal(at(taperAfter + 1), base + perRegion * taperAfter + perRegionLate);
  assert.equal(at(surgeAfter + 1),
    base + perRegion * taperAfter + perRegionLate * (surgeAfter - taperAfter)
    + surgeBonus + perRegionSurge);
  assert.equal(at(surgeAfter + 2) - at(surgeAfter + 1), perRegionSurge,
    'the surge step is a one-off; past the boundary only the rate applies');
});

/**
 * A RAID STAYS A RAID: the share of a region the player already owns at tick 0.
 *
 * This is the invariant nothing was asserting, and it drifted the whole length
 * of the campaign without one test noticing. `siteCounts.player` is the biggest
 * difficulty lever in the table, so every pass that needed a region easier
 * reached for it — and the campaign's own premise is that you are RAIDING ground
 * the enemy holds outright. Measured before this was pinned:
 *
 *     tier 1   player 25-29%   enemy 45-50%     reads as a raid
 *     tier 3   player 38-39%   enemy 43-45%
 *     tier 4   player 39-43%   enemy 41-42%     parity
 *     tier 5   player 44-48%   enemy 38-41%     you own more than they do
 *
 * On the deepest region of the enemy's own homeland the player started holding
 * twenty-three sites to the enemy's eighteen. The raid stopped being a raid
 * exactly where it was supposed to be hardest, and every number still passed,
 * because difficulty was measured and ownership never was.
 *
 * The replacement for the sites is the EXPEDITION, not a lower dial: the empire
 * buys you an ARMY, not a province. `EXPEDITION.perRegionLate` went 5 -> 11,
 * which by construction leaves regions 1-5 untouched (they are attacked with
 * 0-4 conquests, below `taperAfter`) and pays for the ground taken away from
 * tiers 2-5. The land the player used to start owning is NEUTRAL now, so it is
 * still on the map and still takeable — it just has to be taken.
 */
const MAX_PLAYER_SHARE = 0.33;

test('campaign: you are always raiding — the enemy holds more of every region than you do', () => {
  for (const r of REGIONS) {
    const c = r.siteCounts;
    const t = c.enemy + c.neutral + c.player;
    assert.ok(c.player / t <= MAX_PLAYER_SHARE,
      `${r.id}: the player starts holding ${(c.player / t * 100).toFixed(0)}% of the region`
      + ' — that is a defence, not a raid');
    assert.ok(c.enemy > c.player,
      `${r.id}: the player opens with ${c.player} sites against the enemy's ${c.enemy}`
      + ' — you are supposed to be the one invading');
  }
  // ...and it must not CREEP, which is how it got to 48% without anyone seeing.
  // The endgame may not hand the player a bigger head start than the opening did.
  const share = (r) => r.siteCounts.player
    / (r.siteCounts.enemy + r.siteCounts.neutral + r.siteCounts.player);
  const opening = Math.max(...REGIONS.filter((r) => r.tier === 1).map(share));
  for (const r of REGIONS) {
    assert.ok(share(r) <= opening + 0.02,
      `${r.id} opens with ${(share(r) * 100).toFixed(0)}% of the board against tier 1's`
      + ` ${(opening * 100).toFixed(0)}% — the raid is getting easier to start, not harder`);
  }
});

/**
 * The most the enemy may outnumber the CONTESTABLE force by.
 *
 * This was `enemyTroops / playerTroops`, capped per tier at 2.6-2.7, and the
 * denominator was wrong in a way that only showed once the neutral pool got
 * large. Neutral sites belong to nobody and are the opening move — counting
 * them as neither side's makes a map with a lot of open country read as a rout.
 * With the player's footprint cut to a raider's share, raw `foe/mine` runs to
 * 3.5 on nightharrow while the fight is not remotely 3.5:1.
 *
 * So there are two claims here, and they were tangled into one number:
 *
 *   1. YOU ARE OUTNUMBERED. `foe/mine` must stay well above 1 — a raid you
 *      outnumber is not a raid. That is the floor.
 *   2. IT IS CONVERTIBLE. `foe / (mine + neutral)` — the enemy against
 *      everything that is not already theirs — is the number that says whether
 *      the ground is winnable, and it is a smooth 1.1 -> 1.8 across all
 *      twenty-one regions, TIGHTER at tiers 3-5 than at tier 2.
 *
 * Splitting them also retires the per-tier ladder this file grew when tier 5
 * shipped. That ladder was a symptom of the wrong denominator: once the right
 * one is used, a single global ceiling fits the whole campaign again.
 */
const MAX_CONTESTED_RATIO = 1.9;
/** The enemy must out-produce the player's opening ground by at least this. */
const MIN_OUTPRODUCED = 1.05;

/** One started battle per region, memoised — several assertions need one. */
const battleCache = new Map();
function battleFor(i) {
  if (!battleCache.has(i)) battleCache.set(i, startBattle(configFor(i).config));
  return battleCache.get(i);
}

test('campaign: a player who has taken everything before region N can field enough to take N', () => {
  // "Enough" is measured against what is actually standing on the map, not
  // against a constant: the opening enemy garrison, which is the force the
  // expedition has to be able to trade with.
  for (let i = 0; i < REGIONS.length; i++) {
    const { config } = configFor(i);
    const mine = config.sites.filter((s) => s.owner === 'player')
      .reduce((a, s) => a + total(s.garrison), 0) + total(config.player.expedition);
    const neutral = config.sites.filter((s) => s.owner === 'neutral')
      .reduce((a, s) => a + total(s.garrison), 0);
    const foe = enemyTroops(config);
    // You are RAIDING a region the enemy holds outright, and the landing force
    // was re-based down (content/balance.js EXPEDITION) precisely so that being
    // outnumbered is the starting position rather than a late surprise. It also
    // pairs with the enemy's warm-up (content/ai.data.js AI.warmup) — landing
    // outnumbered against an opponent that presses from tick 0 would be a coin
    // flip, not a fight. See MAX_CONTESTED_RATIO for why the ceiling counts the
    // neutral pool and the floor does not.
    // THE "YOU ARE OUTNUMBERED" CLAIM IS MEASURED ON PRODUCTION, NOT ON THE
    // TICK-0 HEADCOUNT, and that is the second time the denominator here has
    // been wrong for the same structural reason.
    //
    // The player's footprint is a BEACHHEAD now — three or four sites against
    // eleven to seventeen — so their whole opening force is a landing stack
    // that arrives once, while the enemy's is standing country that keeps
    // producing. Counting bodies at tick 0 therefore flatters the player badly:
    // measured, gallowmoor opens at 0.98x on garrison and 7.3x on TRAINING
    // THROUGHPUT, thanescar at 1.16x and 9.0x. A landing force that matches the
    // enemy's opening garrison and is out-produced nine to one is the most
    // uphill this campaign has ever been, and the old floor called it a
    // walkover.
    const rate = (owner) => battleFor(i).sites.filter((s) => s.owner === owner)
      .reduce((a, s) => a + siteTrainRate(battleFor(i), s), 0);
    assert.ok(rate('enemy') / Math.max(1e-6, rate('player')) >= MIN_OUTPRODUCED,
      `${REGIONS[i].id}: the enemy only out-produces the player`
      + ` ${(rate('enemy') / Math.max(1e-6, rate('player'))).toFixed(2)}x — a raid on country`
      + ' you can out-build is not a raid');
    assert.ok(foe / (mine + neutral) <= MAX_CONTESTED_RATIO,
      `${REGIONS[i].id}: the enemy opens with ${(foe / (mine + neutral)).toFixed(2)}x everything`
      + ' that is not already theirs — no competent player can convert that');
  }
});

test('campaign: the endgame is a bigger war, and the empire is what answers it', () => {
  // THIS TEST USED TO ASSERT A HEADCOUNT PROXY AND THE PROXY IS NOW WRONG, which
  // is worth stating plainly because it had already been half-retired once. It
  // compared mean `enemyTroops / playerForce` per tier and required the endgame's
  // to exceed the opening's. Measured now, that number FALLS after tier 2:
  //
  //     tier 1  1.94    tier 3  1.79    tier 5  1.73
  //     tier 2  2.20    tier 4  1.70
  //
  // and the campaign is nonetheless correctly ordered — tools/simrunner.js at
  // n=240 reports ~85 / ~78 / ~63 / ~50 / ~34 per tier against `WIN_BAND`. The
  // ratio fell because the player's footprint was cut to a raider's share and
  // the EXPEDITION was surged to pay for it, so more of the same force arrives in
  // the landing stack instead of standing on the map. Opening headcount stopped
  // tracking difficulty; what carries it now is map size, `develop`, the AI tier,
  // the enemy's economy and the dial, none of which a headcount can see.
  //
  // Asserting it anyway would force the table to satisfy a number nobody plays —
  // the exact failure this file's older comment warned about. So the two claims
  // that are still TRUE, still load-bearing, and cheap to check are asserted
  // instead, and the win-rate curve stays where it can actually be measured.
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const perTier = (fn) => [1, 2, 3, 4, 5].map((t) => mean(
    REGIONS.map((r, i) => ({ t: r.tier, v: fn(i) })).filter((x) => x.t === t).map((x) => x.v),
  ));

  // 1. THE WAR ITSELF GETS BIGGER. The enemy's opening army, in absolute bodies.
  const army = perTier((i) => enemyTroops(configFor(i).config));
  for (let t = 1; t < army.length; t++) {
    assert.ok(army[t] > army[t - 1],
      `tier ${t + 1} fields ${army[t].toFixed(0)} against tier ${t}'s ${army[t - 1].toFixed(0)}`
      + ' — the endgame must be a bigger war, not the same one re-priced');
  }
  assert.ok(army[4] > army[0] * 4,
    'the last tier should face multiples of the first, not a fraction more');

  // 2. AND THE EMPIRE, NOT THE MAP, IS WHAT ANSWERS IT. The share of the
  //    player's opening force that arrives in the landing stack rather than
  //    standing on ground they were handed. This is the whole design statement
  //    of the footprint cut, and it is the thing that would silently reverse if
  //    a future pass reached for `siteCounts.player` again to make a region
  //    easier: 66% at tier 1 rising to 81% at tier 5.
  const fromEmpire = perTier((i) => {
    const { config } = configFor(i);
    const exp = total(config.player.expedition);
    const ground = config.sites.filter((s) => s.owner === 'player')
      .reduce((a, s) => a + total(s.garrison), 0);
    return exp / (exp + ground);
  });
  assert.ok(fromEmpire[0] > 0.5,
    'even region one should be mostly the force you brought');
  assert.ok(fromEmpire[4] > fromEmpire[0],
    'the endgame must lean MORE on what you earned and less on what the map gave you');
  assert.ok(fromEmpire[4] > 0.75,
    `the endgame landing is only ${(fromEmpire[4] * 100).toFixed(0)}% expedition —`
    + ' the map is handing the player a province again');
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
