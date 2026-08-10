// THE ENDLESS LADDER.
//
// The thing most worth asserting here is not that a rung is hard — it is that the
// ladder CANNOT REACH THE CAMPAIGN. Twenty-four regions are measured against a
// player with no access to any of this, and three separate mechanisms are what
// keep that true: the gate is shut until every region has fallen, `clears` is
// never touched by a rung, and a plan is a pure function of a depth. Each of those
// has a negative control below, because every one of them would fail silently.
//
// Everything is driven through REAL buildBattleConfig output and the real bot, per
// tests/seam.test.js: a mutator that only exists in a content table is the exact
// class of bug this project has shipped three times.
import test from 'node:test';
import assert from 'node:assert/strict';

import { generateBattleMap } from '../src/battle/mapgen.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { startBattle } from '../src/battle/sim.js';
import { total } from '../src/battle/combat.js';
import { toOutcome } from '../src/battle/outcome.js';
import { applyOutcome, incursionLump, previewReward } from '../src/meta/rewards.js';
import {
  planFor, mutatorsFor, nextDepth, incursionRecord, incursionView, campaignComplete,
  completeIncursion, arena, INCURSION, MUTATORS, MUTATOR_BY_ID,
} from '../src/meta/incursion.js';
import { REGIONS, REGION_IDS } from '../src/content/regions.data.js';
import { SITE_LEVELS } from '../src/content/balance.js';
import { metaFor } from '../tools/simplayer.js';

/** A player who has taken everything — the only one who can be on the ladder. */
const finished = (idleMin = 30) => metaFor(REGION_IDS, idleMin, 4242).meta;
/** ...and one who has not. */
const midCampaign = () => metaFor(REGION_IDS.slice(0, 12), 30, 4242).meta;

const configAt = (meta, depth, seed = 4242) => buildBattleConfig(
  meta, planFor(depth).regionId, [], generateBattleMap, { seed, incursion: depth },
);

// ===========================================================================
// 1. The gate. This is the half that protects every measured region.
// ===========================================================================

test('incursion: the ladder is shut until every region has fallen', () => {
  assert.equal(campaignComplete(midCampaign()), false);
  assert.equal(incursionView(midCampaign()).open, false);
  assert.equal(campaignComplete(finished()), true);
  assert.equal(incursionView(finished()).open, true);
});

test('incursion: no region the harness plays can see the ladder at all', () => {
  // THE NEGATIVE CONTROL FOR THE WHOLE FEATURE, and the reason it is expressed
  // over every region rather than over a sample: `metaFor(before(i))` is exactly
  // the player tools/simrunner.js measures region i with, so if the gate were open
  // for any of them, that region's win rate would silently stop describing what
  // ships. A twenty-fifth region cannot be added without this covering it.
  for (let i = 0; i < REGIONS.length; i++) {
    const meta = metaFor(REGION_IDS.slice(0, i), 30, 7).meta;
    assert.equal(campaignComplete(meta), false,
      `attacking ${REGIONS[i].id} counted as a finished campaign`);
  }
});

// ===========================================================================
// 2. A rung is a pure function of its depth
// ===========================================================================

test('incursion: the same depth is the same fight, always', () => {
  for (const d of [1, 4, 9, 17, 33]) {
    assert.deepEqual(planFor(d), planFor(d), `depth ${d} is not stable`);
    assert.deepEqual(mutatorsFor(d), mutatorsFor(d));
  }
  // ...and two different depths are not the same fight. Without this the draw
  // could be a constant and every assertion above would still pass.
  assert.notDeepEqual(mutatorsFor(9), mutatorsFor(10),
    'the mutator draw does not vary with depth');
});

test('incursion: complications arrive on schedule and never repeat inside a rung', () => {
  const [a, b, c] = INCURSION.mutatorsAt;
  assert.equal(mutatorsFor(1).length, 0, 'the first rung is the plain ladder');
  assert.equal(mutatorsFor(a).length, 1);
  assert.equal(mutatorsFor(b).length, 2);
  assert.equal(mutatorsFor(c).length, 3);
  for (let d = 1; d <= 60; d++) {
    const list = mutatorsFor(d);
    assert.equal(new Set(list).size, list.length, `depth ${d} drew a mutator twice`);
    assert.ok(list.length <= 3, `depth ${d} drew ${list.length} mutators`);
    for (const id of list) assert.ok(MUTATOR_BY_ID[id], `depth ${d} drew unknown "${id}"`);
    // Sorted into table order, so a plan renders the same way every time.
    const order = MUTATORS.filter((m) => list.includes(m.id)).map((m) => m.id);
    assert.deepEqual(list, order, `depth ${d} is not in table order`);
  }
});

test('incursion: the dial rises with depth, and only with depth', () => {
  // One arena, one curve. This is the property the rotating version could not
  // have: see content/incursion.data.js rule 3 for the 57-point measurement.
  let prev = 0;
  for (let d = 1; d <= 80; d++) {
    const plan = planFor(d);
    assert.equal(plan.regionId, arena().id, `depth ${d} moved the arena`);
    assert.ok(plan.enemyMult > prev, `depth ${d} is not harder than depth ${d - 1}`);
    prev = plan.enemyMult;
  }
  assert.ok(planFor(60).enemyMult > planFor(1).enemyMult * 2,
    'sixty rungs should be worth more than doubling the dial');
});

// ===========================================================================
// 3. The mutators reach the battle. A verb nothing reads is the recurring bug.
// ===========================================================================

/** The first depth whose plan carries `id`, so each mutator can be tested on a
 *  REAL config rather than a hand-built one. */
function depthWith(id, limit = 400) {
  for (let d = 1; d <= limit; d++) if (planFor(d).mutators.includes(id)) return d;
  throw new RangeError(`no depth up to ${limit} draws "${id}"`);
}

test('incursion: every mutator in the table actually changes the config it names', () => {
  const meta = finished();
  for (const m of MUTATORS) {
    const d = depthWith(m.id);
    const withIt = configAt(meta, d);
    // The comparison is against the SAME rung with no mutators, built by asking
    // for a depth below the first `mutatorsAt` threshold — same arena, same
    // player, same seed, so the only difference is the mutator table.
    const plain = configAt(meta, 1);
    if (m.kind === 'enemyMult') {
      assert.ok(withIt.enemy[m.field] > plain.enemy[m.field],
        `${m.id}: enemy.${m.field} did not move`);
    } else if (m.kind === 'playerMult') {
      assert.ok(withIt.player[m.field] < plain.player[m.field],
        `${m.id}: player.${m.field} did not move`);
    } else if (m.kind === 'expedition') {
      assert.ok(total(withIt.player.expedition) < total(plain.player.expedition),
        `${m.id}: the landing force is the same size`);
    } else if (m.kind === 'gate') {
      assert.ok(withIt.rules.castleGateFrac >= m.value - 1e-9,
        `${m.id}: the castle gate is ${withIt.rules.castleGateFrac}`);
    } else if (m.kind === 'develop') {
      // MEAN fort level, not the maximum, and the difference is the mechanic:
      // `developLevels` promotes `round(share x pool)` forts BEST FIRST, so a
      // fractional bump moves the SHARE that is promoted. The arena already has
      // level-4 walls, so a max would not move and this assertion would pass
      // against a mutator that did nothing.
      const mean = (cfg) => {
        const forts = startBattle(cfg).sites
          .filter((s) => s.owner === 'enemy' && s.kind !== 'farm');
        return forts.reduce((a, s) => a + s.level, 0) / forts.length;
      };
      assert.ok(mean(withIt) > mean(plain) || mean(plain) >= SITE_LEVELS.length,
        `${m.id}: the enemy's country is no more built than it was`
        + ` (${mean(plain).toFixed(2)} -> ${mean(withIt).toFixed(2)})`);
    } else assert.fail(`${m.id}: unknown kind "${m.kind}" — it can reach nothing`);
  }
});

test('incursion: the rung crosses the seam, and the engine steps it', () => {
  const meta = finished();
  const depth = 12;
  const config = configAt(meta, depth);
  assert.deepEqual(config.rules.incursion,
    { depth, mutators: planFor(depth).mutators });
  // battle/state.js keeps a hand-picked SUBSET of config.rules, and a field left
  // off that list silently falls back — the bug CLAUDE.md warns about. Pinned.
  const battle = startBattle(config);
  assert.equal(battle.rules.incursion.depth, depth,
    'the rung did not survive into state.rules');
  assert.deepEqual(battle.rules.incursion.mutators, planFor(depth).mutators);
  // ...and an ordinary battle carries null rather than a stale rung.
  const plain = buildBattleConfig(meta, 'riverfen', [], generateBattleMap, { seed: 1 });
  assert.equal(plain.rules.incursion, undefined);
  assert.equal(startBattle(plain).rules.incursion, null);
});

test('incursion: a rung cannot be fought on ground it does not belong to', () => {
  // The exploit this closes: pick a deep rung's payout and an easy map to earn it
  // on. The region is checked against the plan at the seam.
  const meta = finished();
  const other = REGIONS.find((r) => r.id !== arena().id);
  assert.throws(
    () => buildBattleConfig(meta, other.id, [], generateBattleMap, { seed: 1, incursion: 9 }),
    /is fought on/,
  );
});

// ===========================================================================
// 4. The two ladders are separate economies
// ===========================================================================

test('incursion: clearing a rung advances the ladder and touches no region record', () => {
  const meta = finished();
  const depth = nextDepth(meta);
  const before = { ...meta.regions[arena().id] };
  const config = configAt(meta, depth);
  const battle = startBattle(config);
  battle.status = 'win';                      // the reward path, not the battle
  const summary = applyOutcome(meta, config, toOutcome(battle, config), { now: 1000 });

  assert.equal(summary.incursion.depth, depth);
  assert.equal(summary.raided, false, 'a rung was paid as a raid');
  assert.equal(summary.conquered, false);
  assert.ok(summary.crowns > 0);
  assert.equal(incursionRecord(meta).cleared, depth, 'the ladder did not advance');
  assert.equal(nextDepth(meta), depth + 1);
  // THE HALF THAT MATTERS. `clears` is the raid ladder's difficulty AND its price
  // (world.js effectiveEnemyMult), so a rung that bumped it would make every
  // future raid on the arena harder because of a fight that was never a raid.
  assert.deepEqual(meta.regions[arena().id], before,
    'clearing a rung changed the region it was fought on');
});

test('incursion: a lost rung costs nothing and leaves the same rung waiting', () => {
  const meta = finished();
  const depth = nextDepth(meta);
  const crowns = meta.crowns;
  const config = configAt(meta, depth);
  const battle = startBattle(config);
  battle.status = 'loss';
  const summary = applyOutcome(meta, config, toOutcome(battle, config), { now: 1000 });
  assert.equal(summary.crowns, 0);
  assert.equal(meta.crowns, crowns, 'a defeat took crowns');
  assert.equal(nextDepth(meta), depth, 'a defeat moved the ladder');
  assert.equal(incursionRecord(meta).attempts, 1, 'the attempt was not recorded');
});

test('incursion: the ladder never walks backwards', () => {
  const meta = finished();
  completeIncursion(meta, 9, { won: true });
  completeIncursion(meta, 3, { won: true });   // a stale screen launching an old rung
  assert.equal(incursionRecord(meta).cleared, 9);
});

test('incursion: reward is proportional to difficulty, so depth never decays', () => {
  // Same relationship the raid economy runs on, and the same reason: a second
  // per-depth dial is what made repeat raids worth 0.957x each other forever.
  const meta = finished();
  for (const d of [1, 5, 20, 44]) {
    const plan = planFor(d);
    const perDifficulty = incursionLump(meta, d) / plan.difficulty;
    const base = incursionLump(meta, 1) / planFor(1).difficulty;
    assert.ok(Math.abs(perDifficulty / base - 1) < 1e-9,
      `depth ${d} pays ${(perDifficulty / base).toFixed(3)}x per unit of difficulty`);
  }
  assert.ok(incursionLump(meta, 30) > incursionLump(meta, 1) * 1.3,
    'thirty rungs deeper must pay meaningfully more');
  // And the preview a screen shows is the same number the outcome pays.
  assert.equal(previewReward(meta, arena().id, 7).crowns, incursionLump(meta, 7));
  assert.equal(previewReward(meta, arena().id, 7).kind, 'incursion');
});

test('incursion: a fresh save reads as rung 1 with nothing cleared', () => {
  const meta = midCampaign();
  delete meta.incursion;                       // a save written before the ladder
  assert.equal(nextDepth(meta), 1);
  assert.deepEqual(incursionRecord(meta), { cleared: 0, attempts: 0 });
});
