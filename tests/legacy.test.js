// ABDICATION — the prestige loop, and the four ways it could quietly break the
// rest of the game.
//
// 1. It could pay for a half-run (it may only be taken from a finished campaign).
// 2. It could reach the campaign's measured numbers (the harness has zero points,
//    so `legacyEffects` must be a no-op there — the negative control below).
// 3. It could apply its bonus down a channel of its own, drifting from the shop's
//    (it rides the same four buckets, so `stack` sees one number).
// 4. It could take away something a player would refuse to press the button over
//    (the ladder, the records and the preferences survive).
//
// Every assertion is against real state and, where power is claimed, against a
// real BattleConfig — a legacy point that only exists in a meta object is the same
// bug as an upgrade that crosses no seam.
import test from 'node:test';
import assert from 'node:assert/strict';

import { generateBattleMap } from '../src/battle/mapgen.js';
import { buildBattleConfig, expeditionSlots } from '../src/meta/modifiers.js';
import {
  abdicationValue, canAbdicate, endgameOpen, legacyPoints, legacyResets,
  legacyEffects, legacyView, LEGACY,
} from '../src/meta/legacy.js';
import { abdicate, headStartFor } from '../src/meta/prestige.js';
import { upgradeEffects } from '../src/meta/upgrades.js';
import { incomePerSec, baseIncomePerSec } from '../src/meta/idle.js';
import { completeIncursion, incursionRecord } from '../src/meta/incursion.js';
import { regionsConquered } from '../src/meta/world.js';
import { REGIONS, REGION_IDS } from '../src/content/regions.data.js';
import { metaFor } from '../tools/simplayer.js';

const finished = (idleMin = 30) => metaFor(REGION_IDS, idleMin, 4242).meta;
const midCampaign = () => metaFor(REGION_IDS.slice(0, 20), 30, 4242).meta;

// ===========================================================================
// 1. Only from a finished campaign
// ===========================================================================

test('legacy: a half-run cannot be cashed out', () => {
  const meta = midCampaign();
  assert.equal(canAbdicate(meta), false);
  const before = { crowns: meta.crowns, regions: regionsConquered(meta) };
  const result = abdicate(meta);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'campaign-incomplete');
  assert.equal(result.points, 0);
  // Refused means UNCHANGED. A guard that returned false after wiping the empire
  // would be the worst possible bug in this file.
  assert.equal(meta.crowns, before.crowns);
  assert.equal(regionsConquered(meta), before.regions);
  assert.equal(legacyResets(meta), 0);
});

test('legacy: the payout is the campaign plus half the ladder', () => {
  const meta = finished();
  completeIncursion(meta, 11, { won: true });
  const value = abdicationValue(meta);
  assert.equal(value.regions, REGIONS.length);
  assert.equal(value.rungs, 11);
  assert.equal(value.fromRegions, LEGACY.perRegion * REGIONS.length);
  assert.equal(value.fromDepth, Math.floor(11 / LEGACY.rungsPerPoint));
  assert.equal(value.points, value.fromRegions + value.fromDepth);
  // ...and pushing deeper before abdicating is worth something, which is the whole
  // reason the ladder half is there.
  completeIncursion(meta, 21, { won: true });
  assert.ok(abdicationValue(meta).points > value.points);
});

// ===========================================================================
// 2. What goes, and what a player would refuse to press the button over
// ===========================================================================

test('legacy: abdication takes the empire and keeps the record of it', () => {
  const meta = finished();
  completeIncursion(meta, 9, { won: true });
  meta.stats.battles = 40;
  meta.settings.rallyKeepDefault = 0;
  meta.tutorialSeen = true;
  const spent = { ...meta.upgrades };
  assert.ok(Object.keys(spent).length > 0, 'this player must have bought something');

  const result = abdicate(meta);
  assert.equal(result.ok, true);
  assert.equal(result.points, LEGACY.perRegion * REGIONS.length + Math.floor(9 / 2));
  assert.equal(result.total, result.points);
  assert.equal(result.resets, 1);

  // Gone.
  assert.equal(meta.crowns, 0);
  assert.deepEqual(meta.upgrades, {});
  assert.deepEqual(meta.boosters, {});
  assert.equal(meta.loadout, null);

  // Handed back: the head start, and NOTHING past it. The cap is the load-bearing
  // half — tiers 5 and 6 must be earned on every run the player ever plays, or the
  // reward for finishing the game is never having to play the end of it again.
  const skip = headStartFor(1);
  assert.equal(regionsConquered(meta), skip, `a second run should open on ${skip} regions`);
  for (const r of REGIONS.slice(0, skip)) {
    assert.equal(meta.regions[r.id].status, 'conquered', `${r.id} is not part of the head start`);
  }
  assert.ok(REGIONS.slice(skip).every((r) => r.tier < 5) === false,
    'the head start must stop short of the last tiers');
  for (const r of REGIONS.filter((x) => x.tier >= 5)) {
    assert.notEqual(meta.regions[r.id].status, 'conquered',
      `${r.id} is tier ${r.tier} and was handed over rather than earned`);
  }
  // The cached income is the head start's, recomputed rather than left stale —
  // which is the whole reason the reset lives in meta/prestige.js.
  assert.ok(meta.incomePerSec > 0, 'the head start pays and the cache does not know');
  assert.equal(meta.incomePerSec, incomePerSec(meta), 'the cache disagrees with the truth');

  // Kept.
  assert.equal(legacyPoints(meta), result.points);
  assert.equal(incursionRecord(meta).cleared, 9, 'the ladder is not an empire');
  assert.equal(meta.stats.battles, 40, 'lifetime stats are the player\'s, not the run\'s');
  assert.equal(meta.settings.rallyKeepDefault, 0, 'preferences survive');
  assert.equal(meta.tutorialSeen, true, 'a second empire does not need the tutorial');
});

test('legacy: abdicating twice accumulates rather than replacing', () => {
  const first = finished();
  const one = abdicate(first);
  // A second run: the same points carried in, plus a second campaign's worth.
  const second = finished();
  second.legacy = { points: one.total, resets: one.resets };
  const two = abdicate(second);
  assert.equal(two.total, one.total + two.points);
  assert.equal(two.resets, 2);
});

// ===========================================================================
// 3. The bonus is real, rides the shop's own channels, and is zero by default
// ===========================================================================

test('legacy: zero points changes nothing at all — the harness measures no legacy', () => {
  // THE NEGATIVE CONTROL. Every win rate in content/regions.data.js is measured
  // with `metaFor`, which never abdicates, so this has to be an identity rather
  // than merely small. If it ever stops being one, twenty-four regions change.
  const meta = finished();
  assert.equal(legacyPoints(meta), 0);
  const fx = { add: {}, mult: {}, flat: {} };
  assert.deepEqual(legacyEffects(meta, fx), fx);
  assert.deepEqual(fx, { add: {}, mult: {}, flat: {} });

  const plain = buildBattleConfig(meta, 'riverfen', [], generateBattleMap, { seed: 7 });
  meta.legacy = { points: 0, resets: 3 };   // resets alone must buy nothing
  const afterResets = buildBattleConfig(meta, 'riverfen', [], generateBattleMap, { seed: 7 });
  assert.equal(afterResets.player.unitAtkMult, plain.player.unitAtkMult);
  assert.equal(expeditionSlots(meta), expeditionSlots({ ...meta, legacy: { points: 0, resets: 0 } }));
});

test('legacy: a point reaches the battle, down the same channels the shop uses', () => {
  const meta = finished();
  const before = buildBattleConfig(meta, 'riverfen', [], generateBattleMap, { seed: 7 });
  const slotsBefore = expeditionSlots(meta);
  const incomeBefore = incomePerSec(meta);

  const points = 20;
  meta.legacy = { points, resets: 1 };
  const after = buildBattleConfig(meta, 'riverfen', [], generateBattleMap, { seed: 7 });

  // Additive, in the same bucket the shop's percentages use — so the effect is
  // exactly `x (1 + sum)` and not a second multiplier applied somewhere else.
  const g = LEGACY.grant;
  const expectAtk = before.player.unitAtkMult + g.atk * points;
  assert.ok(Math.abs(after.player.unitAtkMult - expectAtk) < 1e-9,
    `attack landed at ${after.player.unitAtkMult}, expected ${expectAtk}`);
  assert.ok(Math.abs(after.player.unitDefMult - (before.player.unitDefMult + g.def * points)) < 1e-9);
  // A SHARE, not slots — and asserted as the exact product, because the flat
  // version of this grant passed a "bigger than before" assertion while being worth
  // +675% on region 1. See content/legacy.data.js.
  assert.equal(expeditionSlots(meta), Math.round(slotsBefore * (1 + g.expeditionMult * points)));
  assert.ok(total(after.player.expedition) > total(before.player.expedition),
    'more slots must land more bodies');

  // INCOME, EXACTLY. `stack` is base x (1 + sum of the additive bucket), and the
  // aggregation is read off the game's own `upgradeEffects` rather than
  // re-derived — which is what proves legacy joined that bucket instead of
  // arriving down a channel of its own. A ratio assertion would have passed just
  // as happily against a second multiplier applied after the shop's.
  const expectIncome = baseIncomePerSec(meta) * (1 + (upgradeEffects(meta).add.income ?? 0));
  assert.ok(Math.abs(incomePerSec(meta) - expectIncome) < 1e-9,
    `income is ${incomePerSec(meta)}, not the single stacked ${expectIncome}`);
  assert.ok(incomePerSec(meta) > incomeBefore, 'income did not move');
});

const total = (comp) => Object.values(comp).reduce((a, n) => a + (n || 0), 0);

// ===========================================================================
// 4. The endgame gate both systems share
// ===========================================================================

test('legacy: the endgame stays open across a reset, or nobody would ever reset', () => {
  const meta = finished();
  assert.equal(endgameOpen(meta), true, 'a finished campaign opens the endgame');
  abdicate(meta);
  assert.ok(regionsConquered(meta) < REGIONS.length, 'the campaign really was wound back');
  assert.equal(endgameOpen(meta), true,
    'abdicating closed the endgame — the ladder and the Crown shop would vanish');
  // ...and a player who has never finished it is still outside.
  assert.equal(endgameOpen(midCampaign()), false);
});

test('legacy: the head start grows but never hands over the end of the game', () => {
  // The cap is the load-bearing half. Without it a fourth abdication would open on
  // the last region, which means the reward for finishing the game is never having
  // to play it — and the incursion ladder, which is what the endgame is FOR, would
  // be reachable from a standing start.
  assert.equal(headStartFor(0), 0, 'a first run starts at the beginning');
  assert.ok(headStartFor(1) > 0, 'a second run must skip something');
  assert.ok(headStartFor(2) > headStartFor(1), 'the head start grows with resets');
  assert.equal(headStartFor(50), headStartFor(500), 'it must be capped');
  const capped = headStartFor(50);
  assert.ok(capped <= REGIONS.length - 6,
    `the cap hands over ${capped} of ${REGIONS.length} regions — the last two tiers`
    + ' must always be earned');
  // ...and what it leaves is specifically the hard end of the campaign.
  assert.ok(REGIONS.slice(capped).every((r) => r.tier >= 4),
    'everything past the cap should be tier 4 or later — the part still worth playing');
});

test('legacy: the view a screen renders matches what the button will actually pay', () => {
  const meta = finished();
  completeIncursion(meta, 7, { won: true });
  const view = legacyView(meta);
  assert.equal(view.canAbdicate, true);
  assert.equal(view.payout.points, abdicationValue(meta).points);
  assert.deepEqual(view.perPoint, { ...LEGACY.grant });
  const result = abdicate(meta);
  assert.equal(result.points, view.payout.points,
    'the drawer promised a payout the reset did not honour');
});
