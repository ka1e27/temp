// THE CAMPAIGN'S OWN HAND — see content/incursion.data.js `CAMPAIGN_TWIST`.
//
// The defect this closes was measured, not felt: the last new thing in the game
// arrives at region 8, and regions 9-24 are 261 further minutes with no new
// unit, booster or ability — while eight mutators sat fully built and reached a
// first-run player never, because one needs an incursion and the other needs an
// abdication.
//
// The negative controls are the half that matters here. A hand that applied to
// every region, or one that leaked `rules.incursion`, or one the ladder
// inherited, would all look perfectly healthy from outside — the last of those
// would quietly pay a first conquest as a ladder rung.
import test from 'node:test';
import assert from 'node:assert/strict';
import { campaignTwistPlan } from '../src/meta/incursion.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { REGIONS, REGION_IDS } from '../src/content/regions.data.js';
import { CAMPAIGN_TWIST, MUTATORS, MUTATOR_BY_ID } from '../src/content/incursion.data.js';
import { metaFor } from '../tools/simplayer.js';
import { regionBrief } from '../src/screens/prebattle-brief.js';

const row = (id) => REGIONS.find((r) => r.id === id);
const metaAt = (id) => metaFor(REGION_IDS.slice(0, REGION_IDS.indexOf(id)), 0, 4242).meta;
const cfg = (id, opts = {}) => buildBattleConfig(metaAt(id), id, [], generateBattleMap,
  { seed: 7, ...opts });

// ---------------------------------------------------------------------------
// Where it applies, and — the control — where it must not
// ---------------------------------------------------------------------------

test('twist: regions 1-9 carry no hand at all', () => {
  // THE NEGATIVE CONTROL. Every win rate for tiers 1-2 was measured without
  // this, and the opening of the campaign is the part that reads as fine.
  for (const r of REGIONS.slice(0, CAMPAIGN_TWIST.fromIndex)) {
    assert.equal(campaignTwistPlan(r, 0), null, `${r.id} must carry nothing`);
  }
});

test('twist: every region from 10 on carries one, and the size follows the tier', () => {
  for (const r of REGIONS.slice(CAMPAIGN_TWIST.fromIndex)) {
    const plan = campaignTwistPlan(r, 0);
    assert.ok(plan, `${r.id} should carry a hand`);
    assert.equal(plan.mutators.length, CAMPAIGN_TWIST.byTier[r.tier],
      `${r.id} (tier ${r.tier}) drew ${plan.mutators.length}`);
  }
});

// ---------------------------------------------------------------------------
// The draw: identity on the way up, variety on the way back
// ---------------------------------------------------------------------------

test('twist: no two consecutive regions open with the same mutator', () => {
  // THE WHOLE REASON THIS ROTATES INSTEAD OF DRAWING. The first cut used the
  // ladder's weighted `drawMutators` and produced `warhost` for regions 12, 13
  // AND 14 — three consecutive maps whose entire twist was "+12% enemy attack",
  // which is the repetition the feature exists to end.
  const hands = REGIONS.slice(CAMPAIGN_TWIST.fromIndex)
    .map((r) => campaignTwistPlan(r, 0).mutators);
  for (let i = 1; i < hands.length; i++) {
    assert.notEqual(hands[i][0], hands[i - 1][0],
      `two regions in a row lead with ${hands[i][0]}`);
  }
});

test('twist: the whole pool is used, not just the heavy weights', () => {
  const seen = new Set();
  for (const r of REGIONS.slice(CAMPAIGN_TWIST.fromIndex)) {
    for (const id of campaignTwistPlan(r, 0).mutators) seen.add(id);
  }
  const pool = MUTATORS.filter((m) => !CAMPAIGN_TWIST.excludedMutators.includes(m.id));
  assert.equal(seen.size, pool.length,
    `only ${seen.size} of ${pool.length} mutators ever appear`);
});

test('twist: a region keeps its identity, and a raid changes the fight', () => {
  const g = row('gallowmoor');
  // Deterministic: the same region and the same clear count is the same hand,
  // which is what lets a player learn a region and plan a loadout for it.
  assert.deepEqual(campaignTwistPlan(g, 0), campaignTwistPlan(g, 0));
  // ...and going back is not the same fight.
  const first = campaignTwistPlan(g, 0).mutators.join();
  const raids = [1, 2, 3].map((c) => campaignTwistPlan(g, c).mutators.join());
  assert.ok(!raids.includes(first), 'a raid drew the region default again');
  assert.equal(new Set(raids).size, raids.length, 'two raids drew the same hand');
});

test('twist: `sealed` is never drawn, and the castle gate never moves', () => {
  // 0.72 exceeds GATE_CLAMP's 0.60 ceiling outright, and that ceiling cost a
  // whole pass to establish after thirty-seven of thirty-seven timeouts were
  // found sitting below the gate.
  for (const r of REGIONS.slice(CAMPAIGN_TWIST.fromIndex)) {
    assert.ok(!campaignTwistPlan(r, 0).mutators.includes('sealed'), `${r.id} drew sealed`);
    assert.equal(cfg(r.id).rules.castleGateFrac, cfg(r.id, { noTwist: true }).rules.castleGateFrac,
      `${r.id}: the gate moved`);
  }
});

// ---------------------------------------------------------------------------
// The seam: it must reach the battle, and must not reach the payout
// ---------------------------------------------------------------------------

test('twist: it is never mistaken for a ladder rung', () => {
  // `meta/rewards.js` branches a whole payout path on `rules.incursion`, so a
  // campaign region that carried it would pay a first conquest as a rung — a
  // one-off lump with no permanent income and no unlocks.
  for (const id of ['gallowmoor', 'thanescar', 'widowsgate']) {
    assert.equal(cfg(id).rules.incursion, undefined, `${id} was stamped as a rung`);
  }
});

test('twist: the hand actually reaches the battle, and --notwist reverts it', () => {
  // gallowmoor draws `bulwark` (enemy unitDefMult x1.12) and vaelstrand draws
  // `thinned` (only 82% of the landing arrives) — two different KINDS, so this
  // covers both the FactionMods path and the expedition one.
  const bodies = (c) => Object.values(c.player.expedition).reduce((a, n) => a + n, 0);
  assert.ok(campaignTwistPlan(row('gallowmoor'), 0).mutators.includes('bulwark'));
  assert.ok(cfg('gallowmoor').enemy.unitDefMult
    > cfg('gallowmoor', { noTwist: true }).enemy.unitDefMult);

  assert.ok(campaignTwistPlan(row('vaelstrand'), 0).mutators.includes('thinned'));
  assert.ok(bodies(cfg('vaelstrand')) < bodies(cfg('vaelstrand', { noTwist: true })));

  // ...and the control: a region with no hand is byte-identical either way.
  assert.deepEqual(cfg('riverfen'), cfg('riverfen', { noTwist: true }));
});

test('twist: the player is told before they commit', () => {
  // A hand nobody can see before choosing a loadout is a hand that arrives as a
  // surprise mid-battle, which is the one thing the incursion brief exists to
  // prevent — and this is the version an ordinary player actually meets.
  const hand = campaignTwistPlan(row('nightharrow'), 0).mutators;
  const shown = regionBrief(metaAt('nightharrow'), 'nightharrow').regionMutators;
  assert.deepEqual(shown.map((m) => m.id), hand);
  for (const m of shown) {
    assert.equal(m.name, MUTATOR_BY_ID[m.id].name);
    assert.equal(m.note, MUTATOR_BY_ID[m.id].note);
  }
  assert.deepEqual(regionBrief(metaAt('riverfen'), 'riverfen').regionMutators, [],
    'an early region must advertise nothing');
});

test('twist: the incursion ladder does not inherit its arena campaign hand', () => {
  // `meta/incursion.js` resolves the arena with REGION_BY_ID[INCURSION.regionId]
  // — widowsgate's own campaign row. A mutator PARKED on that row would be
  // inherited by every rung and silently double-mutate the ladder; computing the
  // hand at config-build time is what keeps the two apart.
  const meta = metaAt('widowsgate');
  const rung = buildBattleConfig(meta, 'widowsgate', [], generateBattleMap,
    { seed: 7, incursion: 4 });
  assert.ok(rung.rules.incursion, 'premise: this one IS a rung');
  const ladderIds = rung.rules.incursion.mutators.join();
  const campaignIds = campaignTwistPlan(row('widowsgate'), 0).mutators.join();
  assert.notEqual(ladderIds, campaignIds,
    'the rung is carrying the campaign hand — the row was mutated, not the config');
});
