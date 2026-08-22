// ABDICATION'S SECOND HALF — a REPLAYED campaign region carries a hand of its
// own, generalised from meta/incursion.js's ladder machinery: the same
// weighted draw, the same "rides a field that already crosses the seam"
// discipline, the same determinism. See content/incursion.data.js
// CAMPAIGN_REPLAY for the full reasoning.
//
// The thing most worth asserting here is not that a replay is harder — it is
// that a FIRST run (resets 0, what every measured battle in
// content/regions.data.js is) cannot tell this feature exists at all. Every
// other assertion here is driven through REAL buildBattleConfig/regionBrief
// output, per tests/seam.test.js: a mutator that only exists in a content
// table is the exact class of bug this project has shipped three times.
import test from 'node:test';
import assert from 'node:assert/strict';

import { generateBattleMap } from '../src/battle/mapgen.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { startBattle } from '../src/battle/sim.js';
import { toOutcome } from '../src/battle/outcome.js';
import { applyOutcome } from '../src/meta/rewards.js';
import {
  campaignReplayPlan, planFor, MUTATORS, MUTATOR_BY_ID, CAMPAIGN_REPLAY,
} from '../src/meta/incursion.js';
import { regionBrief } from '../src/screens/prebattle-brief.js';
import { REGIONS, REGION_IDS, RAID } from '../src/content/regions.data.js';
import { record } from '../src/meta/world.js';
import { headStartFor } from '../src/meta/prestige.js';
import { metaFor } from '../tools/simplayer.js';

const finished = (idleMin = 30) => metaFor(REGION_IDS, idleMin, 4242).meta;

// ===========================================================================
// 1. RUN 1 CANNOT SEE THIS FEATURE. Every win rate in content/regions.data.js
//    is measured by metaFor, which never abdicates, so this has to be an
//    identity rather than merely small — the same bar tests/legacy.test.js
//    holds `legacyEffects` to at zero points.
// ===========================================================================

test('campaign replay: resets 0 (or less) draws no hand, for any region at all', () => {
  for (const region of REGIONS) {
    assert.equal(campaignReplayPlan(region, 0), null, `${region.id} drew a hand at resets 0`);
    assert.equal(campaignReplayPlan(region, -3), null, `${region.id} drew a hand at negative resets`);
  }
});

test('campaign replay: a run-1 BattleConfig is byte-identical with and without an explicit resets:0', () => {
  for (let i = 0; i < REGIONS.length; i += 3) {
    const a = metaFor(REGION_IDS.slice(0, i), 20, 99).meta;
    const b = metaFor(REGION_IDS.slice(0, i), 20, 99).meta;
    b.legacy = { points: 0, resets: 0 };
    const cfgA = buildBattleConfig(a, REGIONS[i].id, [], generateBattleMap, { seed: 3 });
    const cfgB = buildBattleConfig(b, REGIONS[i].id, [], generateBattleMap, { seed: 3 });
    assert.deepEqual(cfgA, cfgB, `${REGIONS[i].id} differs between implicit and explicit resets:0`);
  }
});

test('campaign replay: never reaches an incursion battle, at any reset count', () => {
  // The ladder already escalates forever on its own curve (INCURSION.perDepth);
  // doubling two endless-escalation systems onto the SAME fight would be the
  // opposite of legible, so a finished-campaign player who has abdicated many
  // times over must fight a rung exactly as though they never had.
  const meta = finished();
  const regionId = planFor(9).regionId;
  const plain = buildBattleConfig(meta, regionId, [], generateBattleMap, { seed: 1, incursion: 9 });
  // Resets alone (zero legacy points): the whole config must be untouched.
  meta.legacy = { points: 0, resets: 12 };
  const zeroPoints = buildBattleConfig(meta, regionId, [], generateBattleMap, { seed: 1, incursion: 9 });
  assert.deepEqual(zeroPoints, plain, 'resets alone reached an incursion battle');
  // Legacy points DO reach every battle by design (the shop-bucket grant), so
  // this is not byte-for-byte with points held — what must not move is the
  // ladder's OWN hand, which is a pure function of depth alone.
  meta.legacy = { points: 500, resets: 12 };
  const withPoints = buildBattleConfig(meta, regionId, [], generateBattleMap, { seed: 1, incursion: 9 });
  assert.deepEqual(withPoints.rules.incursion.mutators, plain.rules.incursion.mutators,
    'a replay hand leaked onto the ladder\'s own');
});

// ===========================================================================
// 2. WHICH REGIONS, AND HOW MANY. The tail fought forever gets seasoned; the
//    regions a head start swallows by the third run stay a clean lap.
// ===========================================================================

test('campaign replay: a second run stays a clean victory lap through the frozen tiers, by construction', () => {
  for (const region of REGIONS.filter((r) => r.tier <= CAMPAIGN_REPLAY.frozenTier)) {
    assert.equal(campaignReplayPlan(region, 1), null,
      `${region.id} (tier ${region.tier}) drew a hand on the second run`);
  }
});

test('campaign replay: the regions fought every run past the second get seasoned as resets pile up', () => {
  // headStartFor caps at 15 (meta/prestige.js), so resets >= 2 always fights
  // the same tail forever. Confirmed against the region table itself, then
  // confirmed that tail never gets LESS seasoned as resets grows, and reaches
  // the full hand eventually.
  const cap = headStartFor(50);
  const tail = REGIONS.slice(cap);
  assert.ok(tail.length > 0 && tail.every((r) => r.tier >= 4), 'the tail should be tier 4+');
  for (const region of tail) {
    const early = campaignReplayPlan(region, 2)?.mutators.length ?? 0;
    const late = campaignReplayPlan(region, 5)?.mutators.length ?? 0;
    assert.ok(late >= early, `${region.id} got LESS seasoned from resets 2 to 5`);
    const wellDone = campaignReplayPlan(region, 20);
    assert.equal(wellDone.mutators.length, CAMPAIGN_REPLAY.scoreThresholds.length,
      `${region.id} never reached the full hand by resets 20`);
  }
});

test('campaign replay: the score is monotonic in resets and in tier, and caps at three', () => {
  // A synthetic region-shaped object is enough — campaignReplayPlan only
  // reads `.tier` and `.id`.
  const countFor = (resets, tier) => (
    campaignReplayPlan({ tier, id: `synthetic-t${tier}` }, resets)?.mutators.length ?? 0
  );
  for (let tier = 1; tier <= 6; tier++) {
    let prev = 0;
    for (let r = 1; r <= 40; r++) {
      const c = countFor(r, tier);
      assert.ok(c >= prev, `tier ${tier} lost a mutator from resets ${r - 1} to ${r}`);
      assert.ok(c <= CAMPAIGN_REPLAY.scoreThresholds.length, `tier ${tier}@${r} exceeded the cap`);
      prev = c;
    }
  }
  for (let r = 1; r <= 20; r++) {
    let prev = 0;
    for (let tier = 1; tier <= 6; tier++) {
      const c = countFor(r, tier);
      assert.ok(c >= prev, `resets ${r}: tier ${tier} carries fewer mutators than tier ${tier - 1}`);
      prev = c;
    }
  }
});

// ===========================================================================
// 3. THE DRAW ITSELF: deterministic, no duplicates, table order, the excluded
//    mutator never appears, and the castle gate — the one field that could
//    move if it did — never moves.
// ===========================================================================

test('campaign replay: the same (region, resets) is the same hand, always, and never repeats a mutator', () => {
  for (const region of REGIONS) {
    for (let r = 1; r <= 30; r++) {
      const p1 = campaignReplayPlan(region, r);
      const p2 = campaignReplayPlan(region, r);
      assert.deepEqual(p1, p2, `${region.id}@${r} is not stable`);
      const list = p1?.mutators ?? [];
      assert.equal(new Set(list).size, list.length, `${region.id}@${r} drew a mutator twice`);
      assert.ok(!list.includes('sealed'), `${region.id}@${r} drew the excluded gate mutator`);
      for (const id of list) assert.ok(MUTATOR_BY_ID[id], `${region.id}@${r} drew unknown "${id}"`);
      const order = MUTATORS.filter((m) => list.includes(m.id)).map((m) => m.id);
      assert.deepEqual(list, order, `${region.id}@${r} is not in table order`);
    }
  }
  // ...and two DIFFERENT regions at the same resets are not the same fight —
  // without this the draw could ignore the region id and every check above
  // would still pass.
  assert.notDeepEqual(
    campaignReplayPlan(REGIONS.find((r) => r.id === 'stormhalt'), 6),
    campaignReplayPlan(REGIONS.find((r) => r.id === 'widowsgate'), 6),
  );
});

test('campaign replay: the castle gate never moves — the one mutator that could is excluded', () => {
  const meta = metaFor(REGION_IDS.slice(0, 14), 20, 4242).meta;
  for (const regionId of ['thanescar', 'ravensmarch', 'stormhalt', 'widowsgate']) {
    const region = REGIONS.find((r) => r.id === regionId);
    for (const resets of [1, 5, 10, 20]) {
      meta.legacy = { points: 0, resets };
      const cfg = buildBattleConfig(meta, regionId, [], generateBattleMap, { seed: 2 });
      assert.equal(cfg.rules.castleGateFrac, region.castleGateFrac,
        `${regionId}@${resets}: the gate moved from ${region.castleGateFrac} to ${cfg.rules.castleGateFrac}`);
      assert.equal(cfg.rules.incursion, undefined, `${regionId}@${resets} was stamped as a rung`);
    }
  }
});

// ===========================================================================
// 4. THE MUTATORS REACH THE BATTLE. A verb nothing reads is the recurring bug
//    (see the incursion ladder's own version of this test).
// ===========================================================================

test('campaign replay: every non-excluded mutator actually changes the config it names', () => {
  const meta = metaFor(REGION_IDS.slice(0, 21), 20, 4242).meta;
  const regionId = 'widowsgate'; // tier 6: the fastest-climbing score
  const region = REGIONS.find((r) => r.id === regionId);
  meta.legacy = { points: 0, resets: 0 };
  // `noTwist`, and the flag earned its keep the moment it existed. Widowsgate is
  // region 24, so since `campaignTwistPlan` it carries a hand of its OWN at
  // resets 0 — and that hand contains `bulwark`, so an untouched baseline
  // already had the mutator applied and this test read "bulwark did not move".
  // The baseline has to be the un-handed config or it is not a baseline.
  const plain = buildBattleConfig(meta, regionId, [], generateBattleMap,
    { seed: 1, noTwist: true });
  const allowed = MUTATORS.filter((m) => !CAMPAIGN_REPLAY.excludedMutators.includes(m.id));
  assert.ok(allowed.length > 0);

  for (const m of allowed) {
    let resets = null;
    for (let r = 1; r <= 60; r++) {
      if (campaignReplayPlan(region, r)?.mutators.includes(m.id)) { resets = r; break; }
    }
    assert.ok(resets, `no resets up to 60 draws "${m.id}" for ${regionId}`);
    meta.legacy = { points: 0, resets };
    const withIt = buildBattleConfig(meta, regionId, [], generateBattleMap, { seed: 1 });

    if (m.kind === 'enemyMult') {
      assert.ok(withIt.enemy[m.field] > plain.enemy[m.field], `${m.id}: enemy.${m.field} did not move`);
    } else if (m.kind === 'playerMult') {
      assert.ok(withIt.player[m.field] < plain.player[m.field], `${m.id}: player.${m.field} did not move`);
    } else if (m.kind === 'expedition') {
      const total = (comp) => Object.values(comp).reduce((a, n) => a + (n || 0), 0);
      assert.ok(total(withIt.player.expedition) < total(plain.player.expedition),
        `${m.id}: the landing force is the same size`);
    } else if (m.kind === 'develop') {
      // MEAN fort level, not the max — see tests/incursion.test.js's identical
      // reasoning: `developLevels` promotes best-first, so a fractional bump
      // moves the SHARE promoted rather than any one site's ceiling.
      const mean = (cfg) => {
        const forts = startBattle(cfg).sites.filter((s) => s.owner === 'enemy' && s.kind !== 'farm');
        return forts.reduce((a, s) => a + s.level, 0) / forts.length;
      };
      assert.ok(mean(withIt) > mean(plain), `${m.id}: the enemy's country is no more built than it was`);
    } else {
      assert.fail(`${m.id}: kind "${m.kind}" is not handled by this test (or should be excluded)`);
    }
  }
});

// ===========================================================================
// 5. THE REWARD PATH. A replayed region is a first conquest or a raid like any
//    other, paid exactly as one — never as a rung, because `rules.incursion`
//    never crosses for it.
// ===========================================================================

test('campaign replay: a mutated replay battle is paid as an ordinary conquest, never as a rung', () => {
  const meta = metaFor(REGION_IDS.slice(0, 14), 20, 4242).meta; // through karrowmere
  meta.legacy = { points: 0, resets: 1 };
  const regionId = 'thanescar'; // tier 4, first fought on a real second run
  const region = REGIONS.find((r) => r.id === regionId);
  const plan = campaignReplayPlan(region, 1);
  assert.ok(plan && plan.mutators.length > 0, 'test needs a region that draws a hand at resets 1');

  const config = buildBattleConfig(meta, regionId, [], generateBattleMap, { seed: 1 });
  assert.equal(config.rules.incursion, undefined);
  const battle = startBattle(config);
  assert.equal(battle.rules.incursion, null);
  battle.status = 'win';
  const summary = applyOutcome(meta, config, toOutcome(battle, config), { now: 1000 });
  assert.equal(summary.incursion, null, 'a replayed region was paid as a rung');
  assert.equal(summary.conquered, true);
  assert.equal(summary.raided, false);
});

test('campaign replay: a mutated RAID still pays as a raid', () => {
  const meta = finished(); // every region conquered once already
  meta.legacy = { points: 0, resets: 1 };
  const regionId = 'thanescar';
  const config = buildBattleConfig(meta, regionId, [], generateBattleMap, { seed: 1 });
  assert.equal(config.rules.isRaid, true);
  assert.equal(config.rules.incursion, undefined);
  const battle = startBattle(config);
  battle.status = 'win';
  const summary = applyOutcome(meta, config, toOutcome(battle, config), { now: 1000 });
  assert.equal(summary.incursion, null);
  assert.equal(summary.raided, true);
  assert.equal(summary.conquered, false);
});

// ===========================================================================
// 6. VISIBLE BEFORE IT IS FOUGHT. The pre-battle brief already renders the
//    incursion mutator list; a replayed region's hand belongs in the same
//    place, resolved from meta ALONE, before buildBattleConfig ever runs.
// ===========================================================================

test('campaign replay: the pre-battle brief shows the exact hand the battle will carry', () => {
  const meta = metaFor(REGION_IDS.slice(0, 14), 20, 4242).meta;
  meta.legacy = { points: 0, resets: 1 };
  const regionId = 'thanescar';
  const plan = campaignReplayPlan(REGIONS.find((r) => r.id === regionId), 1);
  assert.ok(plan);

  const brief = regionBrief(meta, regionId);
  assert.deepEqual(brief.regionMutators.map((m) => m.id), plan.mutators);
  for (const m of brief.regionMutators) {
    assert.equal(m.name, MUTATOR_BY_ID[m.id].name);
    assert.equal(m.note, MUTATOR_BY_ID[m.id].note);
  }
  // THE SAME REGION ON A FIRST RUN NOW SHOWS ITS OWN HAND, not nothing — this
  // assertion used to read `[]` and is rewritten rather than relaxed, because
  // the behaviour deliberately changed: thanescar is region 15, so since
  // `campaignTwistPlan` it carries a twist of its own. What still has to hold is
  // that the REPLAY hand is the one being shown above, so the two must differ.
  const fresh = metaFor(REGION_IDS.slice(0, 14), 20, 4242).meta;
  const first = regionBrief(fresh, regionId).regionMutators.map((m) => m.id);
  assert.ok(first.length > 0, 'a late region shows a hand even on a first run');
  assert.notDeepEqual(first, plan.mutators,
    'a replayed run must show the REPLAY hand, not the region default');
  // ...and an incursion brief carries its own hand under `incursion`, never a
  // region one, even for a player who has abdicated many times.
  const laddered = finished();
  laddered.legacy = { points: 0, resets: 12 };
  assert.deepEqual(regionBrief(laddered, planFor(9).regionId, 9).regionMutators, []);
});

// ===========================================================================
// 7. `RAID.harderPerClear`, SURFACED — half the complaint this pass answers.
// ===========================================================================

test('campaign replay: raid escalation is broken out of the folded difficulty figure', () => {
  const meta = finished(); // one conquest each, so clears === 1 everywhere
  const regionId = 'gallowmoor';
  const clears = record(meta, regionId).clears;
  assert.equal(clears, 1, 'test assumes a single conquest, no raids yet');

  const brief = regionBrief(meta, regionId);
  const row = brief.rows.find(([k]) => k === 'Raid escalation');
  assert.ok(row, 'no raid-escalation row on an already-conquered region');
  const expected = (1 + RAID.harderPerClear) ** clears;
  assert.equal(row[1], `x${expected.toFixed(2)} from 1 clear`);

  // Raid it again (by hand, matching what meta/world.js completeRaid does to
  // `clears`): the figure grows and the label pluralises.
  meta.regions[regionId].clears = 3;
  const row2 = regionBrief(meta, regionId).rows.find(([k]) => k === 'Raid escalation');
  const expected2 = (1 + RAID.harderPerClear) ** 3;
  assert.equal(row2[1], `x${expected2.toFixed(2)} from 3 clears`);
  assert.ok(expected2 > expected, 'raiding again should read as MORE escalated, not less');

  // No row at all on a region never yet conquered.
  const opening = metaFor([], 0).meta;
  assert.equal(regionBrief(opening, regionId).rows.find(([k]) => k === 'Raid escalation'), undefined);
  // ...nor on an incursion, which has no relationship to this region's `clears`.
  const laddered = finished();
  const incBrief = regionBrief(laddered, planFor(4).regionId, 4);
  assert.equal(incBrief.rows.find(([k]) => k === 'Raid escalation'), undefined);
});
