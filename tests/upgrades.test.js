// The shop: cost monotonicity, atomic purchase, and effect aggregation.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createState } from '../src/core/store.js';
import {
  UPGRADES, UPGRADE_BY_ID, UPGRADE_GROUPS, BOOSTER_SHOP, RETIRED_UPGRADES,
  SAFE_MAX_LEVEL, upgradeCost,
} from '../src/content/upgrades.data.js';
import {
  levelOf, nextCost, costAtLevel, costToMax, canBuy, buy, isEndless, isMaxed,
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

test('the endless lines are the six Empire ones plus the four gated Crown ones', () => {
  const endless = UPGRADES.filter(isEndless).map((u) => u.id).sort();
  assert.deepEqual(endless, [
    'arms', 'citadels', 'drill', 'exchequer', 'grandArmy', 'siegeworks',
    'standingArmy', 'treasury', 'warChest', 'warCollege',
  ]);
  for (const id of endless) {
    const u = UPGRADE_BY_ID[id];
    assert.ok(u.group === 'empire' || u.group === 'crown',
      `${id} is endless but sits in the ${u.group} group`);
    assert.ok(u.cost.rate > 1,
      `${id} must actually get more expensive, or it is free money forever`);
    // THE HALF THAT MATTERS: an endless line outside the Empire group must be
    // GATED. An ungated one would be on sale during the campaign, and the harness
    // buys cheapest-affordable-first — so it would re-tune all twenty-four
    // measured regions the moment it shipped.
    assert.equal(u.group === 'crown', u.requires === 'endgame',
      `${id}: the Crown group and the endgame gate must be the same set`);
  }
  // Everything else is bought exactly once.
  for (const u of UPGRADES) {
    if (!isEndless(u)) assert.equal(u.maxLevel, 1, `${u.id} is neither endless nor one-off`);
  }
});

test('the shop is small enough to read at a glance', () => {
  // The complaint this whole change answers. Twenty-six entries across six
  // groups, each with a paragraph, is a reading exercise rather than a choice.
  // SPLIT BY WHAT STAYS ON SCREEN. A single cap on the total counted the
  // endless lines and the one-off unlocks as the same thing, and they are not:
  // an unlock has `max: 1`, so it leaves the shop the moment it is bought and
  // the list a returning player scans is only ever the repeatable half. Capping
  // the total is what made adding a unit look like making the shop worse.
  //
  // THIS TEST READ `u.max` AND THE FIELD IS `u.maxLevel`, so both filters were
  // measuring nothing: `endless` was always empty and `oneOff` was always every
  // upgrade in the game, which made the second assertion a cap on the TOTAL —
  // exactly the thing the comment above says is the wrong instrument. It passed
  // for as long as the total happened to be under twelve. Fixed rather than
  // relaxed, and the claim is now the one a player experiences: what is ON SCREEN
  // this visit.
  const repeatable = UPGRADES.filter(isEndless);
  const oneOff = UPGRADES.filter((u) => !isEndless(u));
  // Gated lines are not on screen until the campaign is finished, so the list a
  // player scans mid-campaign is the ungated half — and that half is the number
  // the original complaint was about.
  const onScreenNow = repeatable.filter((u) => !u.requires);
  assert.ok(onScreenNow.length <= 8,
    `${onScreenNow.length} permanent lines is too many to scan every visit`);
  assert.ok(repeatable.length <= 12,
    `${repeatable.length} permanent lines even at the endgame is too many`);
  assert.ok(oneOff.length <= 12,
    `${oneOff.length} one-off unlocks is too long a shopping list to start with`);
  const openGroups = UPGRADE_GROUPS.filter((g) => !g.requires);
  assert.ok(openGroups.length <= 3, 'three headings at most before the endgame');
  assert.ok(UPGRADE_GROUPS.length <= 4, 'four headings at most, ever');
  for (const u of UPGRADES) {
    assert.ok(u.desc.length <= 100, `${u.id} description is ${u.desc.length} chars — too long`);
  }
});

test('every retired upgrade is really gone, and its old price is remembered', () => {
  // The prices have to survive the deletion or the refund in core/store.js
  // cannot pay what was actually charged.
  for (const [id, spec] of Object.entries(RETIRED_UPGRADES)) {
    assert.equal(UPGRADE_BY_ID[id], undefined, `${id} is retired but still on sale`);
    assert.ok(spec.base > 0 && spec.rate >= 1, `${id} has no usable old price`);
  }
  // The four that were sold and did nothing at all.
  for (const id of ['fieldManual', 'scoutReport', 'standingOrders', 'wreckingCrew']) {
    assert.ok(RETIRED_UPGRADES[id], `${id} was inert and must be refunded`);
  }
});

test('cost is strictly monotonic in level, all the way to the safe ceiling', () => {
  for (const u of UPGRADES) {
    const top = Math.min(u.maxLevel, SAFE_MAX_LEVEL);
    let prev = -Infinity;
    for (let l = 0; l < top; l++) {
      const c = upgradeCost(u, l);
      assert.ok(Number.isInteger(c), `${u.id} L${l} cost ${c} must be an integer`);
      assert.ok(c > 0, `${u.id} L${l} cost must be positive`);
      if (top > 1) assert.ok(c > prev, `${u.id} L${l} cost ${c} <= previous ${prev}`);
      prev = c;
    }
    assert.equal(costAtLevel(u.id, top), Infinity, `${u.id} past its ceiling`);
  }
});

test('an endless line still ENDS before the arithmetic stops being exact', () => {
  // Not a design cap — a floating-point one. Past it a price is no longer an
  // exact integer and eventually becomes Infinity, and a button reading
  // "Infinity crowns" is a bug rather than a challenge.
  const m = meta(0, { treasury: SAFE_MAX_LEVEL });
  assert.equal(canBuy(m, 'treasury').reason, 'maxed');
  assert.equal(nextCost(m, 'treasury'), Infinity);
  assert.ok(isMaxed(UPGRADE_BY_ID.treasury, SAFE_MAX_LEVEL));
  assert.ok(!isMaxed(UPGRADE_BY_ID.treasury, SAFE_MAX_LEVEL - 1));
  // ...and the last legal price is still an exact, representable integer.
  const last = costAtLevel('treasury', SAFE_MAX_LEVEL - 1);
  assert.ok(Number.isSafeInteger(last), `${last} is past MAX_SAFE_INTEGER`);
});

test('Treasury follows 45 x 1.58^n exactly', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((l) => costAtLevel('treasury', l)),
    [45, 71, 112, 177, 280],
  );
});

test('an endless line has no total: costToMax is Infinity, honestly', () => {
  // The right answer rather than a missing feature — there is no "max" to save
  // up for, which is the whole point. A one-off still totals normally.
  assert.equal(costToMax(meta(0), 'treasury'), Infinity);
  assert.equal(costToMax(meta(0, { treasury: 9 }), 'treasury'), Infinity);
  assert.equal(costToMax(meta(0), 'tactician'), 450);
  assert.equal(costToMax(meta(0, { tactician: 1 }), 'tactician'), 0);
});

// --- purchase --------------------------------------------------------------

test('purchase is atomic: exact cost deducted, level raised, nothing else', () => {
  const m = meta(200);
  const r = buy(m, 'treasury');
  assert.deepEqual({ ok: r.ok, cost: r.cost, level: r.level }, { ok: true, cost: 45, level: 1 });
  assert.equal(m.crowns, 155);
  assert.equal(levelOf(m, 'treasury'), 1);
  assert.equal(m.stats.crownsSpent, 45);
});

test('cannot buy at cost - 0.001, and nothing is mutated by the refusal', () => {
  const m = meta(45 - 0.001);
  const r = buy(m, 'treasury');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'insufficient');
  assert.equal(m.crowns, 45 - 0.001, 'crowns untouched');
  assert.equal(levelOf(m, 'treasury'), 0, 'level untouched');
  assert.equal(m.stats.crownsSpent, 0);
});

test('crowns can never go negative, however many purchases are attempted', () => {
  const m = meta(1000);
  for (let i = 0; i < 200; i++) {
    for (const u of UPGRADES) buy(m, u.id);
    assert.ok(m.crowns >= 0, `crowns went negative at iteration ${i}: ${m.crowns}`);
  }
});

test('buying a one-off to max then once more is a no-op', () => {
  const m = meta(1e9);
  assert.equal(buy(m, 'tactician').ok, true);
  const before = m.crowns;
  const r = buy(m, 'tactician');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'maxed');
  assert.equal(m.crowns, before);
  assert.equal(levelOf(m, 'tactician'), 1);
  assert.equal(nextCost(m, 'tactician'), Infinity);
});

test('an endless line keeps taking money, and the price keeps climbing', () => {
  // The property the six lines exist for: what stops you is the curve, not a
  // ceiling. Ten times the idling buys a few more levels, not ten times as many.
  const m = meta(1e9);
  let last = 0;
  let bought = 0;
  while (buy(m, 'treasury').ok) {
    const c = costAtLevel('treasury', levelOf(m, 'treasury') - 1);
    assert.ok(c > last, 'each level cost more than the one before it');
    last = c;
    bought++;
  }
  assert.ok(bought > 25, `a billion crowns should buy well past a cap (${bought} levels)`);
  assert.ok(m.crowns >= 0);
  // Logarithmic, not linear: a hundred times the money is nowhere near a
  // hundred times the levels.
  const rich = meta(1e11);
  let more = 0;
  while (buy(rich, 'treasury').ok) more++;
  assert.ok(more < bought * 2, `${more} levels for 100x the crowns is not a curve`);
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
  const affordable = m.crowns >= 45;
  assert.equal(buy(m, 'treasury').ok, affordable);
  assert.ok(m.crowns >= 0);
});

// --- effect aggregation ----------------------------------------------------

test('effects land in the right buckets and scale linearly with level', () => {
  const fx = upgradeEffects(meta(0, {
    treasury: 3, arms: 2, warChest: 2, standingArmy: 4, drill: 3,
  }));
  assert.ok(Math.abs(fx.add.income - 0.36) < 1e-12, 'treasury 3 x 0.12');
  assert.ok(Math.abs(fx.add.atk - 0.12) < 1e-12, 'arms 2 x 0.06');
  assert.ok(Math.abs(fx.add.def - 0.12) < 1e-12, 'the same line moves both');
  assert.equal(fx.flat.startGold, 240, 'warChest 2 x 120');
  assert.equal(fx.flat.expedition, 20, 'standingArmy 4 x 5');
  assert.equal(fx.flat.garrisonCap, 36, 'drill 3 x 12');
  // The one multiplicative bucket: compounding, not summed.
  assert.ok(Math.abs(fx.mult.trainCost - 0.96 ** 3) < 1e-12);
});

test('one line can move several channels at once, which is what made it one line', () => {
  const fx = upgradeEffects(meta(0, { warChest: 1 }));
  assert.equal(fx.flat.startGold, 120);
  assert.ok(Math.abs(fx.add.goldRate - 0.08) < 1e-12);
  assert.ok(Math.abs(fx.add.farmYield - 0.10) < 1e-12);
});

test('militia and spearmen are free; everything else needs an unlock', () => {
  assert.deepEqual(unlockedUnits(meta(0)), ['militia', 'spearmen']);
  assert.deepEqual(
    unlockedUnits(meta(0, { unlockRaiders: 1, unlockRams: 1, unlockMarshal: 1 })),
    ['militia', 'spearmen', 'raiders', 'rams', 'marshal'],
  );
});

test('the one surviving feature flag is set by the one upgrade that sells it', () => {
  assert.equal(hasFeature(meta(0), 'doubleSpeed'), false);
  assert.equal(hasFeature(meta(0, { tactician: 1 }), 'doubleSpeed'), true);
  // The three that were sold and read by nobody are gone entirely.
  assert.equal(hasFeature(meta(0, { fieldManual: 1 }), 'exactPreview'), false);
  assert.equal(hasFeature(meta(0, { scoutReport: 1 }), 'scoutReport'), false);
});

test('shopListing reports affordability without mutating anything', () => {
  const m = meta(150);
  const before = JSON.stringify(m);
  const listing = shopListing(m);
  const empire = listing.find((g) => g.id === 'empire');
  const treasury = empire.items.find((i) => i.id === 'treasury');
  assert.equal(treasury.cost, 45);
  assert.equal(treasury.affordable, true);
  assert.equal(treasury.endless, true, 'the shop needs to know not to draw a denominator');
  const tac = listing.find((g) => g.id === 'unlocks').items.find((i) => i.id === 'tactician');
  assert.equal(tac.cost, 450);
  assert.equal(tac.affordable, false);
  assert.equal(tac.endless, false);
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
