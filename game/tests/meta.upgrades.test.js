import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UPGRADES, UPGRADE_TABS, POWER_IDS, upgradesByTab,
  levelOf, upgradeCost, canBuy, buy, buyMax,
} from '../meta/upgrades.js';
import { makeWorld, makeGame } from './meta.fixtures.js';

test('every upgrade has the shape council.js needs', () => {
  for (const id of Object.keys(UPGRADES)) {
    const def = UPGRADES[id];
    assert.equal(def.id, id);
    assert.ok(UPGRADE_TABS.includes(def.tab), `${id} has a valid tab`);
    assert.equal(typeof def.name, 'string');
    assert.equal(typeof def.icon, 'string');
    assert.equal(typeof def.desc, 'string');
    assert.equal(typeof def.baseCost, 'number');
    assert.equal(typeof def.growth, 'number');
    assert.equal(typeof def.effectText(1), 'string');
  }
});

test('upgradesByTab groups the three War Council tabs per DESIGN §5.2', () => {
  assert.equal(upgradesByTab('army').length, 5);
  assert.equal(upgradesByTab('realm').length, 3);
  assert.equal(upgradesByTab('powers').length, 5);
  assert.deepEqual(POWER_IDS, ['rally', 'firestorm', 'bulwark', 'march', 'levy']);
});

test('upgradeCost: cost(0) is exactly baseCost, and costs rise monotonically', () => {
  for (const id of Object.keys(UPGRADES)) {
    assert.equal(upgradeCost(id, 0), UPGRADES[id].baseCost, `${id} level 0 cost`);
    let prev = upgradeCost(id, 0);
    for (let level = 1; level <= 10; level++) {
      const cost = upgradeCost(id, level);
      assert.ok(cost > prev, `${id} cost must grow (level ${level}: ${cost} vs ${prev})`);
      prev = cost;
    }
  }
});

test('buy: refuses when gold is short, never lets gold go negative', () => {
  const world = makeWorld();
  const state = makeGame(world, { gold: 0 });
  assert.equal(canBuy(state, 'steel'), false);
  assert.equal(buy(state, 'steel'), false);
  assert.equal(state.gold, 0);
});

test('buy: exact-cost purchase succeeds, deducts gold and raises the level by one', () => {
  const world = makeWorld();
  const cost0 = upgradeCost('steel', 0);
  const state = makeGame(world, { gold: cost0 });
  assert.equal(levelOf(state, 'steel'), 0);
  const newLevel = buy(state, 'steel');
  assert.equal(newLevel, 1);
  assert.equal(state.upgrades.steel, 1);
  assert.equal(state.gold, 0);
});

test('buy: treasury stops at its max level (16)', () => {
  const world = makeWorld();
  const state = makeGame(world, { gold: 1e9, upgrades: { treasury: 16 } });
  assert.equal(canBuy(state, 'treasury'), false);
  assert.equal(buy(state, 'treasury'), false);
  assert.equal(state.upgrades.treasury, 16);
});

test('buyMax: spends down to the last affordable level and never overspends', () => {
  const world = makeWorld();
  const state = makeGame(world, { gold: 200 });
  const { levels, spent, level } = buyMax(state, 'recruitment');
  assert.ok(levels >= 1, 'bought at least one level');
  assert.equal(level, levels);
  assert.equal(state.upgrades.recruitment, levels);
  assert.ok(spent <= 200, 'never overspent');
  assert.ok(state.gold >= 0, 'gold never negative');
  assert.ok(state.gold < upgradeCost('recruitment', levels), 'truly maxed out — cannot afford one more');
});

test('powers start locked (level 0) except Rally, and effectText says so', () => {
  const world = makeWorld();
  const state = makeGame(world);
  assert.equal(levelOf(state, 'firestorm'), 0);
  assert.equal(UPGRADES.firestorm.effectText(0), 'Locked');
  assert.equal(levelOf(state, 'rally'), 1);
  assert.notEqual(UPGRADES.rally.effectText(1), 'Locked');
});

test('buying a locked power unlocks it at level 1 with a real effect description', () => {
  const world = makeWorld();
  const state = makeGame(world, { gold: upgradeCost('firestorm', 0) });
  buy(state, 'firestorm');
  assert.equal(state.upgrades.firestorm, 1);
  const text = UPGRADES.firestorm.effectText(1);
  assert.notEqual(text, 'Locked');
  assert.match(text, /cooldown/);
});

test('power effectText cooldown shrinks with level (POWERS.cooldownPerLevel)', () => {
  const l1 = UPGRADES.bulwark.effectText(1);
  const l3 = UPGRADES.bulwark.effectText(3);
  const cooldownIn = (s) => Number(s.match(/([\d.]+)s cooldown/)[1]);
  assert.ok(cooldownIn(l3) < cooldownIn(l1), 'higher level means shorter cooldown');
});
