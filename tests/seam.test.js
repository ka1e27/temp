// The meta -> battle seam, exercised through the REAL production path.
//
// Every other battle test hand-builds a config. That is how the booster bug
// shipped: `toConfigBoosters` produced an array, `makeBoosters` read it as a
// map, and every test fixture happened to use the map shape — so the suite
// codified the bug and passed green while no battle ever had a single charge.
//
// These tests never hand-build anything. They call buildBattleConfig and
// startBattle exactly as screens/battle.js does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/core/store.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { startBattle } from '../src/battle/sim.js';
import {
  assertBattleConfig, CONTRACT_VERSION, BOOSTER_IDS, FEATURE_IDS, makeMods, hasMod,
} from '../src/battle/contract.js';
import { buyCharge, countOf } from '../src/meta/boosters.js';
import { UPGRADES } from '../src/content/upgrades.data.js';
import { buy } from '../src/meta/upgrades.js';
import { sampleBattleConfig } from './fixtures/battleConfig.sample.js';

/** A meta state with everything affordable, so unlocks can be exercised. */
function richMeta(crowns = 500000) {
  const state = createState({ seed: 11, now: 0 });
  state.meta.crowns = crowns;
  return state.meta;
}

/** Buy an upgrade to its max level, whatever its cost curve. */
function maxOut(meta, id) {
  for (let i = 0; i < 12; i++) if (!buy(meta, id, null).ok) break;
}

test('boosters bought in the shop actually arrive in the battle', () => {
  const meta = richMeta();
  // Unlock everything that gates a booster, then buy charges.
  for (const u of UPGRADES) if (u.group === 'boosters') maxOut(meta, u.id);
  const wanted = [];
  for (const id of BOOSTER_IDS) {
    const res = buyCharge(meta, id, 2, null);
    if (res.ok || countOf(meta, id) > 0) wanted.push(id);
  }
  assert.ok(wanted.length >= 3, `expected several boosters unlockable, got ${wanted}`);

  const config = buildBattleConfig(meta, 'riverfen', wanted, generateBattleMap, { seed: 3 });
  assertBattleConfig(config);
  assert.ok(Array.isArray(config.boosters), 'the contract shape is an array');

  const battle = startBattle(config);
  for (const { id, charges } of config.boosters) {
    assert.ok(battle.boosters[id], `booster "${id}" was dropped between config and battle`);
    assert.equal(battle.boosters[id].charges, charges, `"${id}" lost charges crossing the seam`);
  }
  assert.equal(
    Object.keys(battle.boosters).length, config.boosters.length,
    'every booster in the config must exist in the battle',
  );
});

test('carrying no boosters is legal and yields an empty set', () => {
  const config = buildBattleConfig(richMeta(0), 'riverfen', [], generateBattleMap, { seed: 4 });
  assertBattleConfig(config);
  assert.deepEqual(config.boosters, []);
  assert.deepEqual(startBattle(config).boosters, {});
});

// --- the validator now covers the field that drifted ----------------------

test('assertBattleConfig rejects a map-shaped boosters field', () => {
  // This is the exact malformed shape that shipped.
  assert.throws(
    () => assertBattleConfig(sampleBattleConfig({ boosters: { rally: 2, march: 3 } })),
    /boosters: must be an array/,
  );
});

test('assertBattleConfig rejects unknown ids and bad charge counts', () => {
  assert.throws(
    () => assertBattleConfig(sampleBattleConfig({ boosters: [{ id: 'nope', charges: 1 }] })),
    /unknown id "nope"/,
  );
  assert.throws(
    () => assertBattleConfig(sampleBattleConfig({ boosters: [{ id: 'rally', charges: -1 }] })),
    /non-negative integer/,
  );
  assert.throws(
    () => assertBattleConfig(sampleBattleConfig({ boosters: [{ id: 'rally', charges: 1.5 }] })),
    /non-negative integer/,
  );
});

// --- features: the seam that five purchased upgrades needed ---------------

test('the contract carries shop features, and validates them', () => {
  assert.equal(CONTRACT_VERSION, 3,
    'features + booster validation landed in v2, the terrain layer in v3');
  const mods = makeMods({ features: ['doubleSpeed'] });
  assert.ok(hasMod(mods, 'doubleSpeed'));
  assert.ok(!hasMod(mods, 'standingOrders'));
  assert.deepEqual(makeMods().features, [], 'defaults to no unlocks');

  assert.throws(
    () => assertBattleConfig(sampleBattleConfig({
      player: makeMods({ features: ['teleportation'] }),
    })),
    /unknown feature "teleportation"/,
  );
});

test('every declared feature id is actually produced by an upgrade', () => {
  // Guards the other direction: a feature the shop sells but the contract does
  // not know about can never reach a battle, which is how these shipped inert.
  // Effects are {bucket, key, value}: unlock('feature', 'exactPreview')
  // becomes {bucket:'unlock', key:'feature', value:'exactPreview'}.
  const sold = new Set();
  for (const u of UPGRADES) {
    for (const e of u.effects ?? []) {
      if (e.bucket === 'unlock' && e.key === 'feature') sold.add(e.value);
    }
  }
  for (const id of FEATURE_IDS) {
    assert.ok(sold.has(id), `contract declares "${id}" but no upgrade grants it`);
  }
});

test('a purchased feature reaches the battle config', () => {
  const meta = richMeta();
  const tactician = UPGRADES.find((u) => (u.effects ?? [])
    .some((e) => e.bucket === 'unlock' && e.value === 'doubleSpeed'));
  assert.ok(tactician, 'Tactician must exist in the shop');
  maxOut(meta, tactician.id);

  const config = buildBattleConfig(meta, 'riverfen', [], generateBattleMap, { seed: 5 });
  assertBattleConfig(config);
  assert.ok(
    hasMod(config.player, 'doubleSpeed'),
    'buying Tactician must be observable inside the battle config',
  );
});

test('the enemy never receives player shop unlocks', () => {
  const meta = richMeta();
  for (const u of UPGRADES) maxOut(meta, u.id);
  const config = buildBattleConfig(meta, 'riverfen', [], generateBattleMap, { seed: 6 });
  assert.deepEqual(config.enemy.features, [], 'features are the player\'s purchases only');
});
