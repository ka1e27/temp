// WHAT THE CAMPAIGN TABLE BECOMES WHEN A BATTLE IS BUILT FROM IT.
//
// Split out of ./campaign.test.js at the 400-line cap, along the seam rather
// than at a line number: everything left in that file is a claim about the
// TABLE — that a column never goes backwards, that the ladder is the one
// content/balance.js defines — and everything here builds a real config,
// starts a real battle, and asserts on what actually came out.
//
// That distinction is the reason the two need different fixtures: a claim about
// the table reads `REGIONS`, and a claim about the battle has to reckon with
// every mutator, marshal and clamp that sits between a row and a board.
import test from 'node:test';
import assert from 'node:assert/strict';

import { generateBattleMap } from '../src/battle/mapgen.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { startBattle } from '../src/battle/sim.js';
import { garrisonCap } from '../src/battle/training.js';
import { factionGoldPerSec } from '../src/battle/economy.js';
import { REGIONS, REGION_IDS } from '../src/content/regions.data.js';
import { SITE_LEVELS } from '../src/content/balance.js';
import { metaFor } from '../tools/simplayer.js';

/** Copied rather than shared: four lines, and a fixtures module for it would be
 *  a third place to look for the same assertion. */
function nonDecreasing(values, label, key = (r) => r.id) {
  for (let i = 1; i < values.length; i++) {
    assert.ok(values[i].v >= values[i - 1].v,
      `${label} must never go backwards: ${key(values[i - 1])}=${values[i - 1].v}`
      + ` then ${key(values[i])}=${values[i].v}`);
  }
}

/** The empire a player has when they attack `i`: everything before it. */
const before = (i) => REGION_IDS.slice(0, i);

/** A real config for "the player who has taken every earlier region". */
function configFor(i, { seed = 4242, idleMin = 10, noTwist = false } = {}) {
  const meta = metaFor(before(i), idleMin, seed).meta;
  return {
    meta,
    config: buildBattleConfig(meta, REGIONS[i].id, [], generateBattleMap, { seed, noTwist }),
  };
}

// ===========================================================================
// 3. The seam actually carries it. Numbers that never reach a battle are lies.
// ===========================================================================

test('campaign: develop reaches the battle as real levels, HP and training', () => {
  const meanFort = [];
  for (let i = 0; i < REGIONS.length; i++) {
    const r = REGIONS[i];
    // `noTwist`, because this is a claim about the develop LADDER — that a row's
    // `develop` reaches the battle as real levels — and from region 10 a region
    // may carry `entrenched`, which is a deliberate +0.5 on top. Measured when
    // it first went red: gravenreach's mean fort level read 2.75 against a row
    // develop of 2.2, which is `entrenched` working exactly as designed. The
    // pipeline is what is under test here, so the input has to be the row's.
    const battle = startBattle(configFor(i, { noTwist: true }).config);
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
