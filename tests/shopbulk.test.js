// Bulk purchase ("Spend all", "x10") and the suggested-buy ring — split out
// of upgrades.test.js purely for the line cap, since these two shop-screen
// features pushed that file past 400 lines.
//
// One rule shared by the shop screen's controls and tools/simshop.js's own
// shopping routine — see meta/upgrades.js `spendAll` for why there is exactly
// one implementation rather than two that can quietly disagree.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createState } from '../src/core/store.js';
import { UPGRADES, SAFE_MAX_LEVEL } from '../src/content/upgrades.data.js';
import {
  levelOf, canBuy, shopListing, spendAll, buyN, suggestedBuy, costAtLevel,
} from '../src/meta/upgrades.js';

const meta = (crowns = 0, upgrades = {}, relics = 0) => {
  const s = createState({ seed: 1, now: 0 });
  s.meta.crowns = crowns;
  s.meta.relics = relics;
  Object.assign(s.meta.upgrades, upgrades);
  return s.meta;
};

// --- bulk purchase: "Spend all" and "x10" -----------------------------------

test('spendAll empties a crown purse sensibly and never overspends', () => {
  const m = meta(2000);
  const bought = spendAll(m, 'crowns');
  assert.ok(bought > 1, 'a 2000-crown purse should buy more than one level');
  assert.ok(m.crowns >= 0, `crowns went negative: ${m.crowns}`);
  // Nothing crown-priced is left affordable — that IS "empties the purse
  // sensibly": it stops because there is nothing left to buy, not because it
  // gave up early.
  const remaining = shopListing(m)
    .flatMap((g) => g.items)
    .filter((i) => i.currency === 'crowns' && i.affordable);
  assert.deepEqual(remaining, [], 'crowns remained that could have bought something');
});

test('spendAll cannot overspend even with a budget the campaign never produces', () => {
  const m = meta(1e12);
  const bought = spendAll(m, 'crowns');
  assert.ok(m.crowns >= 0, `crowns went negative: ${m.crowns}`);
  assert.ok(bought > 50, `a trillion crowns bought only ${bought} levels`);
  assert.ok(bought < 400, 'hit the guard rather than a real stopping condition');
});

test('spendAll: an empty purse buys nothing and mutates nothing', () => {
  const m = meta(0);
  const before = JSON.stringify(m);
  assert.equal(spendAll(m, 'crowns'), 0);
  assert.equal(JSON.stringify(m), before);
});

test('spendAll: skip withholds a specific line even when it is cheapest', () => {
  // Exactly enough for Treasury (the cheapest Empire line) and nothing else.
  const m = meta(45, {}, 0);
  const bought = spendAll(m, 'crowns', null, new Set(['treasury']));
  assert.equal(bought, 0, 'nothing else was affordable once treasury was withheld');
  assert.equal(levelOf(m, 'treasury'), 0);
  assert.equal(m.crowns, 45, 'the skipped purchase must not have been made by another route');
});

test('spendAll: the two purses are independent, exactly like two separate buttons', () => {
  const m = meta(1000, {}, 1000);
  spendAll(m, 'crowns');
  assert.equal(m.relics, 1000, 'spending crowns must not touch relics');
  const afterCrowns = m.crowns;
  spendAll(m, 'relics');
  assert.equal(m.crowns, afterCrowns, 'spending relics must not touch crowns');
  assert.ok(levelOf(m, 'vetMilitia') > 0 || levelOf(m, 'vetSpearmen') > 0,
    'militia and spearmen are unlocked from the start, so relics had somewhere to go');
});

test('buyN buys the same line up to n times, one level at a time', () => {
  const m = meta(1e6);
  assert.equal(buyN(m, 'treasury', 5), 5);
  assert.equal(levelOf(m, 'treasury'), 5);
  // Priced level-by-level, not a single deduction at 5x today's rate.
  let expected = 0;
  for (let l = 0; l < 5; l++) expected += costAtLevel('treasury', l);
  assert.equal(m.crowns, 1e6 - expected);
});

test('buyN stops the moment it is unaffordable, and reports how many it got', () => {
  const cost0 = costAtLevel('treasury', 0);
  const cost1 = costAtLevel('treasury', 1);
  const m = meta(cost0 + cost1); // exactly two levels, not a third
  assert.equal(buyN(m, 'treasury', 10), 2);
  assert.equal(levelOf(m, 'treasury'), 2);
  assert.ok(m.crowns >= 0);
});

test('buyN stops at the safe ceiling instead of buying past it', () => {
  const m = meta(1e15, { treasury: SAFE_MAX_LEVEL - 1 });
  assert.equal(buyN(m, 'treasury', 5), 1, 'one level to the ceiling, then maxed refuses the rest');
  assert.equal(levelOf(m, 'treasury'), SAFE_MAX_LEVEL);
});

// --- the suggested buy -------------------------------------------------------

const EMPIRE_IDS = UPGRADES.filter((u) => u.group === 'empire').map((u) => u.id);

test('suggestedBuy: nothing affordable is the negative control, and it is null', () => {
  assert.equal(suggestedBuy(meta(0)), null);
  assert.equal(suggestedBuy(meta(44)), null, 'one crown short of the cheapest Empire line');
});

test('suggestedBuy: names the cheapest AFFORDABLE Empire line, exactly at its price', () => {
  assert.equal(suggestedBuy(meta(45)), 'treasury', 'the cheapest of the six at level 0');
});

test('suggestedBuy: moves off a line the moment levelling it makes it the pricier one', () => {
  // Treasury levelled past War Chest's flat 60 — War Chest is now the
  // cheapest AFFORDABLE line, and the function has to notice without being
  // told which line changed.
  const m = meta(70, { treasury: 10 });
  const suggestion = suggestedBuy(m);
  assert.equal(suggestion, 'warChest');
  assert.ok(EMPIRE_IDS.includes(suggestion));
});

test('suggestedBuy: never crosses into another group, however cheap it is there', () => {
  // Every Empire line inflated far past a budget that would otherwise land a
  // 250-crown Unlocks row (unlockRaiders) — proving the scope is the GROUP,
  // not "cheapest thing in the whole shop".
  const inflated = Object.fromEntries(EMPIRE_IDS.map((id) => [id, 20]));
  const m = meta(300, inflated);
  assert.equal(suggestedBuy(m), null);
  assert.equal(canBuy(m, 'unlockRaiders').ok, true, 'the control: it WAS affordable, just in another group');
});

test('suggestedBuy: the group is a parameter, not a hardcoded string', () => {
  assert.equal(suggestedBuy(meta(250), 'unlocks'), 'unlockRaiders');
});
