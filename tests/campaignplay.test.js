// THE CAMPAIGN, ACTUALLY PLAYED — every region driven end to end through the
// same scripted bot the balance table is measured with.
//
// Split out of ./campaign.test.js for the line budget when tier 5 shipped. That
// file asserts the SHAPE of the table (dials rise, the seam carries them, the
// player's power keeps up); this one asserts that the shape produces battles
// somebody can win. Small n on purpose: these are floors, not the tuning
// instrument. Tuning happens on tools/simrunner.js at n >= 96.
import test from 'node:test';
import assert from 'node:assert/strict';

import { generateBattleMap } from '../src/battle/mapgen.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { startBattle, step } from '../src/battle/sim.js';
import { total } from '../src/battle/combat.js';
import { REGIONS, REGION_IDS } from '../src/content/regions.data.js';
import { metaFor, playerTurn } from '../tools/simplayer.js';

const before = (i) => REGION_IDS.slice(0, i);

function configFor(i, { seed = 4242, idleMin = 10 } = {}) {
  const meta = metaFor(before(i), idleMin, seed).meta;
  return buildBattleConfig(meta, REGIONS[i].id, [], generateBattleMap, { seed });
}

const enemyTroops = (config) => config.sites
  .filter((s) => s.owner === 'enemy').reduce((a, s) => a + total(s.garrison), 0);

function playOnce(i, seed) {
  const battle = startBattle(configFor(i, { seed }));
  let nextThink = 0;
  while (battle.status === 'running' && battle.tick < battle.rules.hardCapTicks) {
    if (battle.tick >= nextThink) { playerTurn(battle); nextThink = battle.tick + 20; }
    step(battle);
  }
  return battle;
}

const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];

/** Monotone helper that names the offender instead of just failing. */
function nonDecreasing(values, label, key = (r) => r.id) {
  for (let i = 1; i < values.length; i++) {
    assert.ok(values[i].v >= values[i - 1].v,
      `${label} must never go backwards: ${key(values[i - 1])}=${values[i - 1].v}`
      + ` then ${key(values[i])}=${values[i].v}`);
  }
}

test('campaign: every region is winnable by an ordinary player, at every tier', { timeout: 900000 }, () => {
  // Deliberately a FLOOR rather than a win-rate assertion: tuning happens on
  // tools/simrunner.js at n >= 96, and a band re-measured at n=8 fails on noise
  // constantly. What this catches is the thing that actually shipped — a region
  // no seed can beat.
  //
  // THE SAMPLE IS SIZED AGAINST THE HARDEST TIER'S BAND, and it had to grow when
  // tier 5 landed. `WIN_BAND[4]` floors at 22%, so a six-seed sample comes up
  // empty on a perfectly healthy region 21% of the time and an eight-seed one
  // 13% — that is a coin toss wearing the costume of a floor, and it fired
  // immediately: ravensmarch measured 26% at n=240 and lost all eight. Sixteen
  // brings it to 1.7%. The seeds are fixed, so this is not flakiness in the
  // usual sense; it is a sample too small to distinguish "hard" from "broken",
  // which is precisely the distinction the assertion message claims to make.
  // ...AND IT GREW AGAIN AT TIER 6, for exactly the same arithmetic. `WIN_BAND[5]`
  // floors at 18%, where a sixteen-seed sample is empty 5% of the time and a
  // twenty-four-seed one 1%. The floor is a claim about the region; a sample that
  // fails one time in twenty is a claim about the dice.
  const SEEDS = 24;
  for (let i = 0; i < REGIONS.length; i++) {
    const wins = Array.from({ length: SEEDS }, (_, k) => playOnce(i, 1000 + (k + 1) * 7919))
      .filter((b) => b.status === 'win').length;
    assert.ok(wins > 0,
      `${REGIONS[i].id} was not won once in ${SEEDS} attempts — it is not a hard region,`
      + ' it is a broken one');
  }
});

test('campaign: no region advertises a length it cannot deliver', { timeout: 900000 }, () => {
  // The replacement for the cross-tier length ramp that tests/world.test.js used
  // to assert. That one compared two numbers in a table to each other; this one
  // compares each number to what the region actually plays like, which is the
  // property that was broken — tier-3 and tier-4 regions advertised 17 to 23
  // minutes and resolved in six to nine.
  //
  // MEASURED OVER WINS, for the reason documented at length in
  // tools/simrunner.js: `targetLengthMin` is what the world map tells the player
  // the region costs, and what a player means by that is how long it takes to
  // TAKE it. A loss is not a short battle, it is one that ended early because
  // they were being rolled up. The two quantities only agree while wins
  // dominate, and they stop agreeing exactly where the campaign gets hard —
  // measured at n=64, nightharrow's all-runs median is 3.6m and its win median
  // is 11.1m against nine advertised.
  //
  // The band is the harness's own [0.5x, 1.6x], widened to [0.35x, 2.5x] because
  // this is a smoke sample. Still tight enough to catch the thing it exists for:
  // a 23-minute claim on a seven-minute region, wrong by a factor of three.
  //
  // MIN_WINS matters as much as the band. At tier 5 a sixteen-seed sample yields
  // four or five wins, and the median of four noisy grinds is itself noisy —
  // gravenreach's win median is 8.8m at n=240 and read 19.8m off a three-win
  // sample, which would have condemned a correctly tuned region. Below the
  // threshold this steps aside; the region is not unmeasured, it is measured by
  // tools/simrunner.js at n=240, which is the instrument for this.
  const SEEDS = 20;
  const MIN_WINS = 6;
  for (let i = 0; i < REGIONS.length; i++) {
    const r = REGIONS[i];
    const wins = Array.from({ length: SEEDS }, (_, k) => playOnce(i, 1000 + (k + 1) * 7919))
      .filter((b) => b.status === 'win')
      .map((b) => b.tick / 600);
    if (wins.length < MIN_WINS) continue;
    const med = median(wins);
    assert.ok(med >= r.targetLengthMin * 0.35 && med <= r.targetLengthMin * 2.5,
      `${r.id} advertises ${r.targetLengthMin}m and is won in ${med.toFixed(1)}m`
      + ` (median of ${wins.length} wins)`);
  }
});

test('campaign: the enemy never disarms itself over a long battle', () => {
  // The regression this exists for. `ramTrainShare` and `counterTrainShare` are
  // SHARES of production; rolled per think against every eligible site — which
  // is how the ram appetite was originally written — they ratchet to 100%,
  // because a stronghold that flips never flips back. Rams defend at 2 and a
  // counter-picked raider at 4, against the 8-with-a-1.75-bulwark of the
  // spearmen they replace, so after a few minutes every wall in the region was
  // paper. Only tiers 3+ adapt, so the effect landed precisely on the regions
  // meant to be hardest: at n=48 with the tail dial already re-curved, obsidian
  // won 83% in 5.0 minutes against tier-2 highmarch's 8%.
  //
  // Driven off the LAST region, which is tier 5 — the highest `counterShare` in
  // AI_TIERS (0.50) and therefore the sharpest test of the spear backbone that
  // battle/ai.js `adapt` reserves before either share spends anything.
  // MEASURED AS A SUSTAINED STATE, not an instantaneous worst, and the reason is
  // that the bug this exists for was PERMANENT. A ratchet cannot repair itself —
  // "a stronghold that flips never flips back" — so it shows up as thousands of
  // consecutive ticks. What an instantaneous worst ALSO catches, now that the
  // player lands with a real army, is the half-second after they capture the
  // enemy's spear forts and before its next think re-orders one back. Measured
  // on nightharrow: the enemy is spear-less for 6 ticks out of 3600 (0.2%), in
  // one unbroken run of 0.6 seconds. Failing on that would be asserting that the
  // AI reacts within one tick of losing a site, which is not a thing this game
  // claims and not what the regression was.
  const i = REGIONS.length - 1;
  const battle = startBattle(configFor(i));
  let nextThink = 0;
  const worst = { rams: 0, spearlessRun: 0 };
  let run = 0;
  for (let t = 0; t < 3600 && battle.status === 'running'; t++) {
    if (battle.tick >= nextThink) { playerTurn(battle); nextThink = battle.tick + 20; }
    step(battle);
    const forts = battle.sites.filter((s) => s.owner === 'enemy' && s.kind === 'stronghold');
    if (forts.length < 4) continue;                   // too few left to say anything
    const share = (u) => forts.filter((s) => s.trainType === u).length / forts.length;
    worst.rams = Math.max(worst.rams, share('rams'));
    run = share('spearmen') > 0 ? 0 : run + 1;
    worst.spearlessRun = Math.max(worst.spearlessRun, run);
  }
  assert.ok(worst.rams <= 0.75,
    `${(worst.rams * 100).toFixed(0)}% of the enemy's strongholds were building siege engines`
    + ' — the ram appetite has ratcheted again');
  assert.ok(worst.spearlessRun <= 30,
    `the enemy held no spear fort at all for ${(worst.spearlessRun / 10).toFixed(1)}s straight —`
    + ' a wall of def-2 rams and def-4 raiders is not a wall, and the backbone'
    + ' reserve in battle/ai.js `adapt` is no longer repairing it');
});

test('campaign: the throne is the last fight, not the last speed bump', () => {
  // victory is capture-castle, so whatever else a region is worth, the castle
  // decides how long it takes. A castle held like a farm ends a twelve-minute
  // war in four seconds — which is exactly what every tier-3 and tier-4 region
  // used to do, at every setting of enemyMult.
  const held = REGIONS.map((r, i) => {
    const battle = startBattle(configFor(i));
    const castle = battle.sites.find((s) => s.kind === 'castle');
    const farms = battle.sites.filter((s) => s.owner === 'enemy' && s.kind === 'farm');
    const perFarm = farms.reduce((a, s) => a + total(s.garrison), 0) / Math.max(1, farms.length);
    return { id: r.id, v: total(castle.garrison) / Math.max(1, perFarm) };
  });
  // The throne's own garrison is the thing that must never go backwards; the
  // ratio to a farm is the thing that must GROW, and it is compared end to end
  // because its denominator is a five-man garrison that wobbles on rounding.
  const bodies = REGIONS.map((r, i) => {
    const battle = startBattle(configFor(i));
    return { id: r.id, v: total(battle.sites.find((s) => s.kind === 'castle').garrison) };
  });
  nonDecreasing(bodies, 'enemy castle garrison');
  assert.ok(held.at(-1).v >= held[0].v * 2.5,
    'the final throne must be defended like a capital, not like an outpost');
  for (let i = 0; i < 5; i++) {
    assert.ok(held[i].v < 2, `${held[i].id} is balance-frozen: its castle must stay an outpost`);
  }
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
  const earned = configFor(late);
  assert.ok(total(earned.player.expedition) > total(bare.player.expedition) * 2.5,
    'an empire should be worth multiples of a standing start by the last region');
  assert.ok(enemyTroops(bare) / total(bare.player.expedition) > 3,
    'the last region must be out of reach of a player who conquered nothing');
});
