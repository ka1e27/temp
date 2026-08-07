// The shop: cost monotonicity, atomic purchase, and effect aggregation.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createState } from '../src/core/store.js';
import { UPGRADES, UPGRADE_BY_ID, UPGRADE_GROUPS, BOOSTER_SHOP, upgradeCost }
  from '../src/content/upgrades.data.js';
import {
  levelOf, nextCost, costAtLevel, costToMax, canBuy, buy,
  upgradeEffects, unlockedUnits, hasFeature, shopListing,
} from '../src/meta/upgrades.js';
import {
  isUnlocked, countOf, buyCharge, canBuyCharge, consume, toConfigBoosters, defaultSelection,
} from '../src/meta/boosters.js';

const meta = (crowns = 0, upgrades = {}) => {
  const s = createState({ seed: 1, now: 0 });
  s.meta.crowns = crowns;
  Object.assign(s.meta.upgrades, upgrades);
  return s.meta;
};

// --- the table itself ------------------------------------------------------

test('every upgrade sits in a declared group and has a sane cost curve', () => {
  const groups = new Set(UPGRADE_GROUPS.map((g) => g.id));
  const ids = new Set();
  for (const u of UPGRADES) {
    assert.ok(!ids.has(u.id), `duplicate upgrade id ${u.id}`);
    ids.add(u.id);
    assert.ok(groups.has(u.group), `${u.id} is in unknown group ${u.group}`);
    assert.ok(u.maxLevel >= 1, `${u.id} maxLevel`);
    assert.ok(u.cost.base > 0 && u.cost.rate >= 1, `${u.id} cost`);
    assert.ok(u.effects.length > 0, `${u.id} has no effect`);
    assert.ok(typeof u.desc === 'string' && u.desc.length > 10, `${u.id} desc`);
  }
});

test('the plan-specified upgrades exist with the plan-specified numbers', () => {
  const expect = {
    tithe: [5, 60, 2.2], warChest: [5, 100, 2.0], richSoil: [4, 140, 2.15],
    granary: [4, 120, 2.0], standingArmy: [6, 120, 2.1], sappers: [4, 260, 2.1],
    unlockRaiders: [1, 250, 1], unlockRams: [1, 600, 1], unlockMarshal: [1, 4000, 1],
    fieldManual: [1, 150, 1], scoutReport: [1, 200, 1],
    tactician: [1, 450, 1], standingOrders: [1, 1500, 1],
  };
  for (const [id, [maxLevel, base, rate]] of Object.entries(expect)) {
    const u = UPGRADE_BY_ID[id];
    assert.ok(u, `missing upgrade ${id}`);
    assert.equal(u.maxLevel, maxLevel, `${id} maxLevel`);
    assert.equal(u.cost.base, base, `${id} base cost`);
    assert.equal(u.cost.rate, rate, `${id} cost rate`);
  }
  assert.equal(UPGRADE_BY_ID.tithe.effects[0].value, 0.15);
  assert.equal(UPGRADE_BY_ID.standingArmy.effects[0].value, 4);
  assert.equal(UPGRADE_BY_ID.warChest.effects[0].value, 150);
  assert.equal(UPGRADE_BY_ID.sappers.effects[0].value, 0.15);
});

test('cost is strictly monotonic in level for every multi-level upgrade', () => {
  for (const u of UPGRADES) {
    let prev = -Infinity;
    for (let l = 0; l < u.maxLevel; l++) {
      const c = upgradeCost(u, l);
      assert.ok(Number.isInteger(c), `${u.id} L${l} cost ${c} must be an integer`);
      assert.ok(c > 0, `${u.id} L${l} cost must be positive`);
      if (u.maxLevel > 1) assert.ok(c > prev, `${u.id} L${l} cost ${c} <= previous ${prev}`);
      prev = c;
    }
    assert.equal(costAtLevel(u.id, u.maxLevel), Infinity, `${u.id} past max`);
  }
});

test('Tithe follows 60 x 2.2^n exactly', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((l) => costAtLevel('tithe', l)),
    [60, 132, 290, 639, 1406],
  );
});

test('Standing Army follows 120 x 2.1^n exactly', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map((l) => costAtLevel('standingArmy', l)),
    [120, 252, 529, 1111, 2334, 4901],
  );
});

test('costToMax equals the sum of the remaining levels', () => {
  const m = meta(0, { tithe: 2 });
  assert.equal(costToMax(m, 'tithe'), 290 + 639 + 1406);
  assert.equal(costToMax(meta(0, { tithe: 5 }), 'tithe'), 0);
});

// --- purchase --------------------------------------------------------------

test('purchase is atomic: exact cost deducted, level raised, nothing else', () => {
  const m = meta(200);
  const r = buy(m, 'tithe');
  assert.deepEqual({ ok: r.ok, cost: r.cost, level: r.level }, { ok: true, cost: 60, level: 1 });
  assert.equal(m.crowns, 140);
  assert.equal(levelOf(m, 'tithe'), 1);
  assert.equal(m.stats.crownsSpent, 60);
});

test('cannot buy at cost - 0.001, and nothing is mutated by the refusal', () => {
  const m = meta(60 - 0.001);
  const r = buy(m, 'tithe');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'insufficient');
  assert.equal(m.crowns, 60 - 0.001, 'crowns untouched');
  assert.equal(levelOf(m, 'tithe'), 0, 'level untouched');
  assert.equal(m.stats.crownsSpent, 0);
});

test('crowns can never go negative, however many purchases are attempted', () => {
  const m = meta(1000);
  for (let i = 0; i < 200; i++) {
    for (const u of UPGRADES) buy(m, u.id);
    assert.ok(m.crowns >= 0, `crowns went negative at iteration ${i}: ${m.crowns}`);
  }
});

test('buying to max then once more is a no-op', () => {
  const m = meta(1e9);
  for (let i = 0; i < 5; i++) assert.equal(buy(m, 'tithe').ok, true);
  const before = m.crowns;
  const r = buy(m, 'tithe');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'maxed');
  assert.equal(m.crowns, before);
  assert.equal(levelOf(m, 'tithe'), 5);
  assert.equal(nextCost(m, 'tithe'), Infinity);
});

test('an unknown upgrade id is refused, not thrown', () => {
  const m = meta(1e6);
  assert.equal(canBuy(m, 'nope').reason, 'unknown');
  assert.equal(buy(m, 'nope').ok, false);
  assert.equal(m.crowns, 1e6);
});

test('float crowns from idle accrual never round a purchase into existence', () => {
  const m = meta(0);
  for (let i = 0; i < 600; i++) m.crowns += 0.1; // 59.999999999999→ish
  assert.ok(m.crowns < 60 || m.crowns >= 60);
  const affordable = m.crowns >= 60;
  assert.equal(buy(m, 'tithe').ok, affordable);
  assert.ok(m.crowns >= 0);
});

// --- effect aggregation ----------------------------------------------------

test('effects land in the right buckets and scale linearly with level', () => {
  const fx = upgradeEffects(meta(0, {
    tithe: 3, veterancy: 2, warChest: 2, standingArmy: 4, biggerCamp: 3,
  }));
  assert.ok(Math.abs(fx.add.income - 0.45) < 1e-12);
  assert.ok(Math.abs(fx.add.atk - 0.16) < 1e-12);
  assert.equal(fx.flat.startGold, 300);
  assert.equal(fx.flat.expedition, 16);
  assert.equal(fx.flat.garrisonCap, 75);
});

test('militia and spearmen are free; everything else needs an unlock', () => {
  assert.deepEqual(unlockedUnits(meta(0)), ['militia', 'spearmen']);
  assert.deepEqual(
    unlockedUnits(meta(0, { unlockRaiders: 1, unlockRams: 1, unlockMarshal: 1 })),
    ['militia', 'spearmen', 'raiders', 'rams', 'marshal'],
  );
});

test('utility upgrades set feature flags', () => {
  assert.equal(hasFeature(meta(0), 'exactPreview'), false);
  assert.equal(hasFeature(meta(0, { fieldManual: 1 }), 'exactPreview'), true);
  assert.equal(hasFeature(meta(0, { tactician: 1 }), 'doubleSpeed'), true);
});

test('shopListing reports affordability without mutating anything', () => {
  const m = meta(150);
  const before = JSON.stringify(m);
  const listing = shopListing(m);
  const economy = listing.find((g) => g.id === 'economy');
  const tithe = economy.items.find((i) => i.id === 'tithe');
  assert.equal(tithe.cost, 60);
  assert.equal(tithe.affordable, true);
  const tac = listing.find((g) => g.id === 'utility').items.find((i) => i.id === 'tactician');
  assert.equal(tac.cost, 450);
  assert.equal(tac.affordable, false);
  assert.equal(JSON.stringify(m), before);
});

// --- boosters --------------------------------------------------------------

test('March and Fortify need no unlock; Rally, Tithe and Bombard do', () => {
  const m = meta(0);
  assert.equal(isUnlocked(m, 'march'), true);
  assert.equal(isUnlocked(m, 'fortify'), true);
  for (const id of ['rally', 'tithe', 'bombard']) {
    assert.equal(isUnlocked(m, id), false, `${id} should start locked`);
    assert.equal(canBuyCharge(m, id).reason, 'locked');
  }
  assert.equal(isUnlocked(meta(0, { boosterRally: 1 }), 'rally'), true);
});

test('booster unlock prices match the plan', () => {
  assert.equal(UPGRADE_BY_ID.boosterRally.cost.base, 300);
  assert.equal(UPGRADE_BY_ID.boosterTithe.cost.base, 700);
  assert.equal(UPGRADE_BY_ID.boosterBombard.cost.base, 900);
});

test('charge purchase is atomic and respects max stock', () => {
  const m = meta(1000, { boosterRally: 1 });
  const cost = BOOSTER_SHOP.rally.chargeCost;
  assert.equal(buyCharge(m, 'rally', 3).ok, true);
  assert.equal(countOf(m, 'rally'), 3);
  assert.equal(m.crowns, 1000 - cost * 3);

  const broke = meta(cost - 0.001, { boosterRally: 1 });
  assert.equal(buyCharge(broke, 'rally').ok, false);
  assert.equal(countOf(broke, 'rally'), 0);
  assert.equal(broke.crowns, cost - 0.001);

  const full = meta(1e6, { boosterRally: 1 });
  buyCharge(full, 'rally', BOOSTER_SHOP.rally.maxStock);
  assert.equal(buyCharge(full, 'rally').reason, 'full');
});

test('consuming clamps at zero and ignores unknown ids', () => {
  const m = meta(1e6, { boosterRally: 1 });
  buyCharge(m, 'rally', 2);
  consume(m, [{ id: 'rally', count: 5 }, { id: 'ghost', count: 1 }]);
  assert.equal(countOf(m, 'rally'), 0);
  assert.equal(m.boosters.ghost, undefined);
});

test('toConfigBoosters clamps to inventory and sorts for a stable hash', () => {
  const m = meta(1e6, { boosterRally: 1, boosterTithe: 1 });
  buyCharge(m, 'rally', 2);
  buyCharge(m, 'tithe', 1);
  buyCharge(m, 'march', 4);
  assert.deepEqual(toConfigBoosters(m, ['tithe', 'rally', 'march']), [
    { id: 'march', charges: 4 }, { id: 'rally', charges: 2 }, { id: 'tithe', charges: 1 },
  ]);
  // A request for more than you own is clamped, not honoured.
  assert.deepEqual(toConfigBoosters(m, [{ id: 'rally', charges: 99 }]), [{ id: 'rally', charges: 2 }]);
  // Locked boosters never make it into a config.
  assert.deepEqual(toConfigBoosters(meta(0), ['rally']), []);
  assert.deepEqual(defaultSelection(m).sort(), ['march', 'rally', 'tithe']);
});
