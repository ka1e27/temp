// C3 — the one decision the player makes before they see the map.
//
// Three properties carry this feature and each one is a way it could have
// shipped broken while looking healthy: the hand must be STABLE on a retry
// (or the choice is free — back out, re-enter, roll again), every term must
// reach a live reader on the PLAYER's side (or it is the fifth upgrade this
// project has refunded for doing nothing), and a battle with no doctrine must
// be byte-identical to a battle from before doctrines existed (or every number
// in regions.data.js quietly describes a different player).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCTRINES, DOCTRINE_BY_ID, DOCTRINE_HAND, DOCTRINE_FROM_CONQUESTS,
} from '../src/content/doctrine.data.js';
import {
  doctrineChoices, doctrineMods, doctrineOpen, doctrineOffered,
  defaultDoctrine, resolveDoctrine,
} from '../src/meta/doctrine.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { makeMods } from '../src/battle/contract.js';
import { REGION_IDS } from '../src/content/regions.data.js';
import { createMeta } from '../src/core/store.js';
import { markConquered } from '../src/meta/world.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { termLabel } from '../src/screens/prebattle-doctrine.js';

const metaAfter = (n) => {
  const meta = createMeta();
  for (let i = 0; i < n; i++) markConquered(meta, REGION_IDS[i]);
  return meta;
};

test('every doctrine is a TRADE: one term up, one term down', () => {
  for (const d of DOCTRINES) {
    assert.ok(d.gain.value > 1, `${d.id}: gain ${d.gain.value} is not a rise`);
    assert.ok(d.cost.value !== 1, `${d.id}: cost ${d.cost.value} is inert`);
    // The cost may go UP (trainCostMult) or DOWN (unitDefMult) — what it may
    // never be is a second gain on the same axis as the first.
    assert.notEqual(d.gain.field, d.cost.field,
      `${d.id}: gain and cost land on the same field, so they partly cancel`);
  }
});

test('no doctrine uses garrisonCapBonus — the seam would refuse a negative one', () => {
  // checks.js checkMods requires every numeric mod >= 0 and assertBattleConfig
  // runs it for both factions, so a negative bonus is not a hard battle, it is
  // a battle that will not start. It is also the one FactionMods field that is
  // a SUM, which the picker's own percentage label cannot render.
  for (const d of DOCTRINES) {
    assert.notEqual(d.gain.field, 'garrisonCapBonus');
    assert.notEqual(d.cost.field, 'garrisonCapBonus');
  }
});

test('the hand is STABLE for a region and attempt — a retry cannot re-roll it', () => {
  for (const id of ['gallowmoor', 'thanescar', 'widowsgate']) {
    const a = doctrineChoices(id, 0).map((d) => d.id);
    const b = doctrineChoices(id, 0).map((d) => d.id);
    assert.deepEqual(a, b, `${id}: two draws of the same attempt disagreed`);
    assert.equal(a.length, DOCTRINE_HAND);
    assert.equal(new Set(a).size, DOCTRINE_HAND, `${id}: dealt a duplicate`);
  }
});

test('...and a raid deals a DIFFERENT hand, walking the whole pool', () => {
  const seen = new Set();
  for (let clears = 0; clears < DOCTRINES.length; clears++) {
    for (const d of doctrineChoices('gallowmoor', clears)) seen.add(d.id);
  }
  // Stride 5 against a pool of 6 is coprime, so repeated clears must reach every
  // doctrine. A stride sharing a factor with the pool would silently offer the
  // same subset forever, which is the defect the campaign twist shipped once.
  assert.equal(seen.size, DOCTRINES.length,
    `raiding one region only ever offered ${seen.size} of ${DOCTRINES.length}`);
});

test('neighbouring regions do not all get the same hand', () => {
  const hands = REGION_IDS.map((id) => doctrineChoices(id, 0).map((d) => d.id).join(','));
  assert.ok(new Set(hands).size >= 3,
    `only ${new Set(hands).size} distinct hands across 24 regions`);
  // The real failure the twist pass hit: three CONSECUTIVE rows drawing alike.
  for (let i = 2; i < hands.length; i++) {
    assert.ok(!(hands[i] === hands[i - 1] && hands[i] === hands[i - 2]),
      `${REGION_IDS[i - 2]}..${REGION_IDS[i]} all deal ${hands[i]}`);
  }
});

test('the gate is the first CONQUEST, so the campaign opener is untouched', () => {
  assert.equal(doctrineOpen(0), false);
  assert.equal(doctrineOpen(DOCTRINE_FROM_CONQUESTS), true);
  assert.equal(resolveDoctrine('vanguard', { regionId: 'riverfen', conquered: 0 }), null);
});

test('an id this battle was never dealt is refused, not honoured', () => {
  const hand = doctrineChoices('gallowmoor', 0).map((d) => d.id);
  const absent = DOCTRINES.find((d) => !hand.includes(d.id));
  assert.ok(absent, 'fixture: expected at least one doctrine off the hand');
  assert.equal(doctrineOffered('gallowmoor', 0, absent.id), false);
  assert.equal(
    resolveDoctrine(absent.id, { regionId: 'gallowmoor', attempt: 0, conquered: 9 }),
    null, 'a hand-edited param bought a doctrine it was never dealt',
  );
  assert.equal(
    resolveDoctrine(hand[0], { regionId: 'gallowmoor', attempt: 0, conquered: 9 }),
    hand[0], 'a legitimately dealt doctrine was refused',
  );
  assert.equal(defaultDoctrine('gallowmoor', 0), hand[0]);
});

test('doctrineMods multiplies both terms and touches nothing else', () => {
  const base = makeMods({ unitAtkMult: 2, unitDefMult: 2, startGold: 300 });
  const out = doctrineMods(base, 'vanguard');
  const d = DOCTRINE_BY_ID.vanguard;
  assert.equal(out.unitAtkMult, 2 * d.gain.value);
  assert.equal(out.unitDefMult, 2 * d.cost.value);
  assert.equal(out.startGold, 300, 'an unrelated field moved');
  // NEGATIVE CONTROL: without it, a doctrineMods that ignored its argument and
  // returned a constant would pass every assertion above.
  assert.notEqual(out.unitAtkMult, base.unitAtkMult);
});

test('...and a null or unknown id returns the SAME object, not a copy', () => {
  const base = makeMods({});
  assert.equal(doctrineMods(base, null), base);
  assert.equal(doctrineMods(base, 'nosuchdoctrine'), base);
});

test('EVERY doctrine measurably changes the config it names', () => {
  const meta = metaAfter(12);
  const region = REGION_IDS[13];
  const plain = buildBattleConfig(meta, region, [], generateBattleMap, { seed: 5 });
  for (const d of DOCTRINES) {
    const cfg = buildBattleConfig(meta, region, [], generateBattleMap, {
      seed: 5, doctrine: d.id,
    });
    // Forced past the offered-hand gate by asking the pure applier directly for
    // the ones this region does not deal — the point here is that the FIELD
    // moves, not that this region offers it.
    const want = doctrineMods(plain.player, d.id);
    if (!doctrineOffered(region, 0, d.id)) {
      assert.deepEqual(cfg.player, plain.player,
        `${d.id}: an undealt doctrine reached the config`);
      assert.notEqual(want[d.gain.field], plain.player[d.gain.field],
        `${d.id}: gain field ${d.gain.field} is inert even applied directly`);
      continue;
    }
    assert.notEqual(cfg.player[d.gain.field], plain.player[d.gain.field],
      `${d.id}: gain field ${d.gain.field} did not move`);
    assert.notEqual(cfg.player[d.cost.field], plain.player[d.cost.field],
      `${d.id}: cost field ${d.cost.field} did not move`);
  }
});

test('a battle with no doctrine is byte-identical to one built before them', () => {
  // THE PROPERTY EVERY NUMBER IN regions.data.js RESTS ON. If passing nothing
  // were not an exact identity, the table would silently describe a different
  // player from the one it was measured against.
  const meta = metaAfter(16);
  for (const id of [REGION_IDS[0], REGION_IDS[9], REGION_IDS[23]]) {
    const a = JSON.stringify(buildBattleConfig(meta, id, [], generateBattleMap, { seed: 3 }));
    const b = JSON.stringify(buildBattleConfig(meta, id, [], generateBattleMap, {
      seed: 3, doctrine: null,
    }));
    assert.equal(a, b, `${id}: passing doctrine:null was not an identity`);
  }
});

test('a doctrine COMPOSES with the region hand rather than replacing it', () => {
  const meta = metaAfter(16);
  const region = REGION_IDS[17];
  const hand = doctrineChoices(region, 0)[0].id;
  const withBoth = buildBattleConfig(meta, region, [], generateBattleMap, {
    seed: 11, doctrine: hand,
  });
  const twistOnly = buildBattleConfig(meta, region, [], generateBattleMap, { seed: 11 });
  const doctrineOnly = buildBattleConfig(meta, region, [], generateBattleMap, {
    seed: 11, doctrine: hand, noTwist: true,
  });
  const d = DOCTRINE_BY_ID[hand];
  // The doctrine's own term must be present in BOTH, which is what says it is
  // folded in after the region's hand rather than overwriting the same object.
  assert.equal(withBoth.player[d.gain.field],
    twistOnly.player[d.gain.field] * d.gain.value);
  assert.ok(doctrineOnly.player[d.gain.field] > 0);
});

test('termLabel takes its SIGN from the value, never from the slot', () => {
  // The bug this pins: keying the sign off gain/cost printed the Drillmaster's
  // trainCostMult 1.30 as "-30% training cost", which reads as CHEAPER — the
  // exact opposite of the term, on a card whose whole job is comparison.
  assert.equal(termLabel({ field: 'trainCostMult', value: 1.30 }), '+30% training cost');
  assert.equal(termLabel({ field: 'unitDefMult', value: 0.92 }), '-8% defence');
  assert.equal(termLabel({ field: 'startGold', value: 2.2 }), 'x2.2 treasury');
  // Every field a shipped doctrine names must have a human label — a fallback
  // to the raw FactionMods key on a player-facing card is a visible bug.
  for (const d of DOCTRINES) {
    for (const t of [d.gain, d.cost]) {
      assert.ok(!termLabel(t).includes(t.field),
        `${d.id}: ${t.field} has no player-facing label`);
    }
  }
});
