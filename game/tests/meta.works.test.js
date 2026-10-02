import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PLAYER_FACTION } from '../meta/state.js';
import { conquer, enemyDepth } from '../meta/progression.js';
import {
  workCost, canBuild, buildWork, buildRefusal, canUpgrade, upgradeWork, upgradeRefusal, workSlots, workLevel, worksOf,
  worksBattleEffects, worksIncomeMult, worksScoutedFree, resetWorks, clearRegionWorks, sanitizeWorks, ensureWorks,
  worksPanelData, worksMarksData, worksTutorialDue, worksTutorialRegion, totalWorks, workEffectText, workBlurb, workName,
  worksToast, NO_WORKS_EFFECTS, MAX_WORK_SLOTS, canDemolish, demolishWork, demolishRefundFor, workEffectKeys,
} from '../meta/works.js';
import { WORKS, WORK_TYPES } from '../config/works.js';
import { PROSPERITY } from '../config/prosperity.js';
import { makeWorld, makeGame } from './meta.fixtures.js';
import { generateWorld } from '../world/generate.js';
import { createGame } from '../meta/state.js';

// Fixture world: 0 home (mine) . 1, 2 Free Folk tier 1 . 3 Crimson capital, 4 Crimson tier 2 . 5 Violet capital tier 3
// neighbours: 0:[1,2] 1:[0,3] 2:[0,4] 3:[1,4] 4:[2,3,5] 5:[4]

/** A game where the player also owns `ids`, with `gold` and optional stored prosperity levels. */
function realm(ids = [], gold = 100000, prosperity = {}) {
  const world = makeWorld();
  const state = makeGame(world, { gold });
  for (const id of ids) state.owner[id] = PLAYER_FACTION;
  state.prosperity = world.regions.map((r) => prosperity[r.id] || 0);
  return { world, state };
}

const snapshot = (state) => JSON.stringify(state);

// --- slots ---------------------------------------------------------------------------------------

test('slots: 1 on conquest, +1 at Prosperity II, +1 at III, 0 for regions you do not own', () => {
  const { state } = realm([1], 0, { 0: 0, 1: 1 });
  assert.equal(workSlots(state, 1), 1, 'Prosperity I is still one slot');
  state.prosperity[1] = 2;
  assert.equal(workSlots(state, 1), 2);
  state.prosperity[1] = 3;
  assert.equal(workSlots(state, 1), 3);
  assert.equal(workSlots(state, 1), MAX_WORK_SLOTS);
  assert.equal(workSlots(state, 3), 0, 'rival region');
  state.prosperity[3] = 3;
  assert.equal(workSlots(state, 3), 0, 'a stale prosperity level on a region you do not own opens nothing');
});

test('slots: a state with no prosperity array (old save) still has one slot per owned region', () => {
  const { state } = realm([1]);
  delete state.prosperity;
  assert.equal(workSlots(state, 0), 1);
  assert.equal(workSlots(state, 1), 1);
});

test('slots: the unlock levels come from config, not the code', () => {
  assert.deepEqual([...WORKS.slots.extraAtProsperity], [2, 3]);
  assert.equal(WORKS.slots.onConquest, 1);
  assert.equal(WORKS.maxLevel, 3);
  assert.ok(PROSPERITY.maxLevel >= Math.max(...WORKS.slots.extraAtProsperity));
});

// --- costs ---------------------------------------------------------------------------------------

test('workCost: base price at depth 1, level I, scaled by type', () => {
  const { world, state } = realm([1]);
  const d = Math.max(1, enemyDepth(world, world.regions[1]));
  const grown = WORKS.cost.base * Math.pow(WORKS.cost.perDepth, d - 1);
  assert.equal(workCost(state, world, 1, 'barracks', 1), Math.round(grown * WORKS.cost.typeMult.barracks));
  assert.equal(workCost(state, world, 1, 'watchtower', 1), Math.round(grown * WORKS.cost.typeMult.watchtower));
  assert.equal(workCost(state, world, 1, 'stables', 1), Math.round(grown * WORKS.cost.typeMult.stables));
  assert.ok(Number.isInteger(workCost(state, world, 1, 'shrine', 1)));
});

test('workCost: the region\'s depth (the difficulty ladder rung) drives the price; the start region is priced as depth 1', () => {
  const world = generateWorld(7);
  const state = createGame(7, world, 0);
  const home = world.regions[world.startRegion];
  assert.equal(enemyDepth(world, home), 0);
  const base = workCost(state, world, home.id, 'barracks', 1);
  assert.equal(base, Math.round(WORKS.cost.base * WORKS.cost.typeMult.barracks));
  const ranked = world.regions.filter((r) => r.tier >= 1).sort((a, b) => enemyDepth(world, a) - enemyDepth(world, b));
  let prev = 0;
  for (const r of ranked) {
    const c = workCost(state, world, r.id, 'barracks', 1);
    assert.ok(c >= prev, `cost must not fall as depth rises (${r.name})`);
    prev = c;
  }
  assert.ok(workCost(state, world, ranked[ranked.length - 1].id, 'barracks', 1) > 10 * base, 'the deepest region is much dearer');
});

test('workCost: each level costs more than the last, and all three levels cost 8x level I', () => {
  const { world, state } = realm([1]);
  const c = [1, 2, 3].map((l) => workCost(state, world, 1, 'shrine', l));
  assert.ok(c[0] < c[1] && c[1] < c[2]);
  const total = c[0] + c[1] + c[2];
  const levelSum = WORKS.cost.levelMult.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total / c[0] - levelSum) < 0.05);
});

test('workCost: unknown region, unknown type or a level outside I-III is Infinity (never affordable)', () => {
  const { world, state } = realm([1]);
  assert.equal(workCost(state, world, 99, 'barracks', 1), Infinity);
  assert.equal(workCost(state, world, 1, 'moat', 1), Infinity);
  assert.equal(workCost(state, world, 1, 'barracks', 0), Infinity);
  assert.equal(workCost(state, world, 1, 'barracks', 4), Infinity);
  assert.equal(workCost(state, world, 1, 'barracks', 1.5), Infinity);
});

// --- building ------------------------------------------------------------------------------------

test('buildWork: pays, fills the first free slot, returns what happened', () => {
  const { world, state } = realm([1], 1000);
  const price = workCost(state, world, 1, 'barracks', 1);
  const res = buildWork(state, world, 1, 'barracks');
  assert.deepEqual(res, { slot: 0, cost: price, work: { type: 'barracks', level: 1 } });
  assert.equal(state.gold, 1000 - price);
  assert.deepEqual(state.works[1], [{ type: 'barracks', level: 1 }]);
  assert.equal(workLevel(state, 1, 'barracks'), 1);
});

test('buildWork: refusals change nothing and return false (like buy())', () => {
  const { world, state } = realm([1], 1000);
  const before = snapshot(state);
  assert.equal(buildWork(state, world, 3, 'barracks'), false, 'not owned');
  assert.equal(buildWork(state, world, 99, 'barracks'), false, 'no such region');
  assert.equal(buildWork(state, world, 1, 'moat'), false, 'no such type');
  assert.equal(snapshot(state), before);

  assert.ok(buildWork(state, world, 1, 'barracks'));
  const afterOne = snapshot(state);
  assert.equal(buildWork(state, world, 1, 'stables'), false, 'the one slot is taken');
  assert.equal(snapshot(state), afterOne);

  const poor = realm([1], 5);
  const poorBefore = snapshot(poor.state);
  assert.equal(buildWork(poor.state, poor.world, 1, 'barracks'), false, 'not enough gold');
  assert.equal(snapshot(poor.state), poorBefore);
});

test('buildRefusal: names the reason, in a fixed order (owned, slot, duplicate, gold)', () => {
  const { world, state } = realm([1], 0, { 1: 2 });
  assert.equal(buildRefusal(state, world, 3, 'barracks'), 'notOwned');
  assert.equal(buildRefusal(state, world, 1, 'barracks'), 'gold');
  state.gold = 100000;
  assert.equal(buildRefusal(state, world, 1, 'barracks'), null);
  buildWork(state, world, 1, 'barracks');
  assert.equal(buildRefusal(state, world, 1, 'barracks'), 'duplicate', 'one Work per type per region');
  assert.equal(buildRefusal(state, world, 1, 'market'), null, 'the second slot opened at Prosperity II');
  buildWork(state, world, 1, 'market');
  assert.equal(buildRefusal(state, world, 1, 'stables'), 'noSlot');
  assert.equal(canBuild(state, world, 1, 'stables'), false);
});

test('slots gate building: a second Work needs Prosperity II, a third needs III', () => {
  const { world, state } = realm([1], 1e6);
  assert.ok(buildWork(state, world, 1, 'barracks'));
  assert.equal(buildWork(state, world, 1, 'stables'), false);
  state.prosperity[1] = 2;
  assert.ok(buildWork(state, world, 1, 'stables'));
  assert.equal(buildWork(state, world, 1, 'shrine'), false);
  state.prosperity[1] = 3;
  const res = buildWork(state, world, 1, 'shrine');
  assert.equal(res.slot, 2);
  assert.deepEqual(state.works[1].map((w) => w.type), ['barracks', 'stables', 'shrine']);
  assert.equal(buildWork(state, world, 1, 'market'), false, 'three is the most any region holds');
});

// --- upgrading -----------------------------------------------------------------------------------

test('upgradeWork: level I to II to III, each step paying that level\'s price, then refused', () => {
  const { world, state } = realm([1], 1e6);
  buildWork(state, world, 1, 'market');
  const gold0 = state.gold;
  const r2 = upgradeWork(state, world, 1, 0);
  assert.deepEqual(r2, { slot: 0, cost: workCost(state, world, 1, 'market', 2), level: 2, type: 'market' });
  const r3 = upgradeWork(state, world, 1, 0);
  assert.equal(r3.level, 3);
  assert.equal(r3.cost, workCost(state, world, 1, 'market', 3));
  assert.equal(state.gold, gold0 - r2.cost - r3.cost);
  assert.equal(state.works[1][0].level, 3);
  assert.equal(upgradeRefusal(state, world, 1, 0), 'maxed');
  const before = snapshot(state);
  assert.equal(upgradeWork(state, world, 1, 0), false);
  assert.equal(snapshot(state), before);
});

test('upgradeWork: refuses an empty slot, an unowned region, or too little gold, and changes nothing', () => {
  const { world, state } = realm([1], 1e6);
  buildWork(state, world, 1, 'barracks');
  const before = snapshot(state);
  assert.equal(upgradeWork(state, world, 1, 1), false, 'empty slot');
  assert.equal(upgradeWork(state, world, 1, -1), false);
  assert.equal(upgradeWork(state, world, 3, 0), false, 'not owned');
  assert.equal(upgradeWork(state, world, 2, 0), false, 'nothing built there');
  state.gold = 1;
  const poorBefore = snapshot(state);
  assert.equal(upgradeRefusal(state, world, 1, 0), 'gold');
  assert.equal(canUpgrade(state, world, 1, 0), false);
  assert.equal(upgradeWork(state, world, 1, 0), false);
  assert.equal(snapshot(state), poorBefore);
  assert.notEqual(poorBefore, before);
});

test('upgradeWork: upgrades the right slot when a region has several Works', () => {
  const { world, state } = realm([1], 1e6, { 1: 3 });
  buildWork(state, world, 1, 'barracks');
  buildWork(state, world, 1, 'stables');
  upgradeWork(state, world, 1, 1);
  assert.deepEqual(state.works[1], [{ type: 'barracks', level: 1 }, { type: 'stables', level: 2 }]);
});

// --- demolish ------------------------------------------------------------------------------------

test('demolish: refunds half of the gold spent on the Work across ALL its levels', () => {
  assert.equal(WORKS.demolishRefund, 0.5);
  const { world, state } = realm([1], 1e6);
  build(state, world, 1, 'barracks', 1);
  const c = [1, 2, 3].map((l) => workCost(state, world, 1, 'barracks', l));
  assert.equal(demolishRefundFor(state, world, 1, 0), Math.round(c[0] * 0.5));
  upgradeWork(state, world, 1, 0);
  assert.equal(demolishRefundFor(state, world, 1, 0), Math.round((c[0] + c[1]) * 0.5));
  upgradeWork(state, world, 1, 0);
  assert.equal(demolishRefundFor(state, world, 1, 0), Math.round((c[0] + c[1] + c[2]) * 0.5));
});

test('demolishWork: pays the refund, frees the slot, returns what happened; the list closes up', () => {
  const { world, state } = realm([1], 1e6, { 1: 3 });
  build(state, world, 1, 'barracks', 2);
  build(state, world, 1, 'stables', 1);
  build(state, world, 1, 'market', 3);
  const gold = state.gold;
  const refund = demolishRefundFor(state, world, 1, 0);
  const res = demolishWork(state, world, 1, 0);
  assert.deepEqual(res, { refund, type: 'barracks', level: 2 });
  assert.ok(refund > 0);
  assert.equal(state.gold, gold + refund);
  assert.deepEqual(state.works[1], [{ type: 'stables', level: 1 }, { type: 'market', level: 3 }], 'later Works move up a slot');
  assert.equal(buildRefusal(state, world, 1, 'barracks'), null, 'the freed slot can hold the same type again');
  const last = demolishWork(state, world, 1, 1);
  assert.equal(last.type, 'market');
  demolishWork(state, world, 1, 0);
  assert.equal('1' in state.works, false, 'an emptied region drops out of the table');
  assert.equal(totalWorks(state), 0);
});

test('demolishWork: refusals change nothing and return false', () => {
  const { world, state } = realm([1], 1e6);
  build(state, world, 1, 'shrine');
  const before = snapshot(state);
  assert.equal(canDemolish(state, world, 1, 0), true);
  for (const [region, slot] of [[1, 1], [1, -1], [1, 0.5], [1, 'x'], [2, 0], [3, 0], [99, 0]]) {
    assert.equal(canDemolish(state, world, region, slot), false, `${region}/${slot}`);
    assert.equal(demolishWork(state, world, region, slot), false);
  }
  assert.equal(demolishRefundFor(state, world, 1, 4), 0);
  assert.equal(snapshot(state), before);
  assert.equal(demolishWork({ owner: [0] }, world, 0, 0), false, 'a state with no Works field');
});

test('demolish: build + upgrade + demolish always loses gold, so it cannot be farmed', () => {
  const { world, state } = realm([1], 1e6);
  const gold = state.gold;
  const a = buildWork(state, world, 1, 'market');
  const b = upgradeWork(state, world, 1, 0);
  const c = upgradeWork(state, world, 1, 0);
  const spent = a.cost + b.cost + c.cost;
  const res = demolishWork(state, world, 1, 0);
  assert.equal(state.gold, gold - spent + res.refund);
  assert.ok(Math.abs(spent - res.refund - spent / 2) <= 1, 'half is lost');
  assert.ok(state.gold < gold);
});

test('demolish: battle effects, income and scouting stop counting it', () => {
  const { world, state } = realm([1, 2], 1e6, { 1: 3 });
  build(state, world, 1, 'barracks', 2);
  build(state, world, 1, 'market', 2);
  build(state, world, 1, 'watchtower', 1);
  assert.equal(worksBattleEffects(state, world, 3).campTroops, 2 * WORKS.effects.barracks.perLevel);
  assert.ok(worksIncomeMult(state, 1) > 1);
  assert.equal(worksScoutedFree(state, world, 3), true);
  demolishWork(state, world, 1, 0);
  assert.equal(worksBattleEffects(state, world, 3).campTroops, 0);
  demolishWork(state, world, 1, 0);
  assert.equal(worksIncomeMult(state, 1), 1);
  demolishWork(state, world, 1, 0);
  assert.equal(worksScoutedFree(state, world, 3), false);
});

test('demolish: deterministic and plain JSON', () => {
  const run = () => {
    const { world, state } = realm([1], 1e6, { 1: 3 });
    build(state, world, 1, 'stables', 3);
    build(state, world, 1, 'shrine', 1);
    demolishWork(state, world, 1, 0);
    return state;
  };
  assert.equal(snapshot(run()), snapshot(run()));
  assert.deepEqual(JSON.parse(snapshot(run())), run());
});

test('demolish: panel data carries the refund and the confirm text; the toast text comes from config', () => {
  const { world, state } = realm([1], 1e6, { 1: 2 });
  build(state, world, 1, 'barracks', 3);
  build(state, world, 1, 'market', 1);
  const d = worksPanelData(state, world, 1);
  const refund = demolishRefundFor(state, world, 1, 0);
  assert.equal(d.slots[0].refund, refund);
  assert.equal(d.slots[0].demolishPrompt, `Demolish Barracks? Refund ${refund} gold`);
  assert.equal(d.slots[1].refund, demolishRefundFor(state, world, 1, 1));
  assert.equal(d.slots[2].refund, undefined, 'locked slots have nothing to demolish');
  assert.equal(worksToast('demolished', { work: 'Barracks', region: 'Fenwall', refund: 190 }), 'Barracks demolished in Fenwall (+190 gold)');
});

test('tutorial M3 follows what is standing: demolishing the only Work makes it due again (the tutorial step stops the repeat)', () => {
  const { world, state } = realm([1, 2], 1e6);
  state.stats.regionsConquered = 3;
  build(state, world, 1, 'barracks');
  assert.equal(worksTutorialDue(state), false);
  demolishWork(state, world, 1, 0);
  assert.equal(worksTutorialDue(state), true);
});

// --- battle effects ------------------------------------------------------------------------------

function build(state, world, regionId, type, level = 1) {
  assert.ok(buildWork(state, world, regionId, type), `build ${type} in ${regionId}`);
  for (let l = 2; l <= level; l++) assert.ok(upgradeWork(state, world, regionId, worksOf(state, regionId).length - 1));
}

test('worksBattleEffects: nothing built is the frozen neutral value', () => {
  const { world, state } = realm([1, 2]);
  assert.equal(worksBattleEffects(state, world, 3), NO_WORKS_EFFECTS);
  assert.deepEqual(NO_WORKS_EFFECTS, { campTroops: 0, speedMult: 1, cooldownMult: 1, campVolleyLevel: 0, campGrowthMult: 1, supplyIntervalMult: 1, fieldStrengthMult: 1 });
  assert.ok(Object.isFrozen(NO_WORKS_EFFECTS));
  assert.equal(worksBattleEffects(state, world, 99), NO_WORKS_EFFECTS);
});

test('worksBattleEffects: each Work type feeds its own number, level n gives n x the per-level value', () => {
  const { world, state } = realm([2, 3], 1e6, { 2: 3, 3: 3 });
  build(state, world, 2, 'barracks', 2);
  build(state, world, 2, 'stables', 3);
  build(state, world, 2, 'shrine', 1);
  const fx = worksBattleEffects(state, world, 4); // region 4 borders 2, 3 and 5
  assert.equal(fx.campTroops, 2 * WORKS.effects.barracks.perLevel);
  assert.ok(Math.abs(fx.speedMult - (1 + 3 * WORKS.effects.stables.perLevel)) < 1e-9);
  assert.ok(Math.abs(fx.cooldownMult - (1 - WORKS.effects.shrine.perLevel)) < 1e-9);
  assert.equal(fx.campVolleyLevel, 0);
  build(state, world, 3, 'watchtower', 2);
  assert.equal(worksBattleEffects(state, world, 4).campVolleyLevel, 2);
});

test('worksBattleEffects: only regions that border the target count', () => {
  const { world, state } = realm([1, 2], 1e6);
  build(state, world, 1, 'barracks');
  // region 1 borders 0 and 3. Target 4 borders 2, 3, 5: not 1.
  assert.equal(worksBattleEffects(state, world, 4).campTroops, 0);
  assert.equal(worksBattleEffects(state, world, 3).campTroops, WORKS.effects.barracks.perLevel);
  assert.equal(worksBattleEffects(state, world, 5).campTroops, 0);
});

test('worksBattleEffects: Works in several bordering regions stack', () => {
  const { world, state } = realm([2, 3], 1e6);
  build(state, world, 2, 'barracks');
  build(state, world, 3, 'barracks', 3);
  // target 4 borders both: 1 level + 3 levels of Barracks
  assert.equal(worksBattleEffects(state, world, 4).campTroops, WORKS.effects.barracks.perLevel * (1 + 3));
  // and a third neighbour adds its own Stables to the same fight
  const more = realm([2, 3, 5], 1e6);
  build(more.state, more.world, 2, 'stables', 2);
  build(more.state, more.world, 5, 'stables', 1);
  assert.ok(Math.abs(worksBattleEffects(more.state, more.world, 4).speedMult - (1 + 3 * WORKS.effects.stables.perLevel)) < 1e-9);
});

test('worksBattleEffects: stacking is clamped by the caps', () => {
  // a synthetic continent: one target ringed by 8 regions you own, each with every Work at level III
  const ring = Array.from({ length: 8 }, (_, i) => i + 1);
  const world = { regions: [{ id: 0, neighbors: ring }, ...ring.map((id) => ({ id, neighbors: [0] }))] };
  const maxed = [{ type: 'barracks', level: 3 }, { type: 'stables', level: 3 }, { type: 'shrine', level: 3 }];
  const state = { owner: [2, ...ring.map(() => PLAYER_FACTION)], works: {} };
  for (const id of ring) state.works[id] = maxed.map((w) => ({ ...w }));
  state.works[1].push({ type: 'watchtower', level: 3 });
  state.works[2].push({ type: 'watchtower', level: 3 });
  const fx = worksBattleEffects(state, world, 0);
  assert.equal(fx.campTroops, WORKS.caps.campTroops, 'barracks capped');
  assert.equal(fx.speedMult, WORKS.caps.speedMult);
  assert.equal(fx.cooldownMult, WORKS.caps.cooldownFloor);
  assert.equal(fx.campVolleyLevel, WORKS.caps.campVolleyLevel);
  // an uncapped small case stays below the caps
  const small = { owner: [2, 0], works: { 1: [{ type: 'barracks', level: 1 }] } };
  assert.ok(worksBattleEffects(small, { regions: [{ id: 0, neighbors: [1] }, { id: 1, neighbors: [0] }] }, 0).campTroops < WORKS.caps.campTroops);
});

test('worksBattleEffects: a neighbour the player does not own contributes nothing, even with stale Works', () => {
  const { world, state } = realm([1], 1e6);
  build(state, world, 1, 'barracks');
  assert.equal(worksBattleEffects(state, world, 3).campTroops, WORKS.effects.barracks.perLevel);
  state.owner[1] = 2; // lost (cannot happen today)
  assert.equal(worksBattleEffects(state, world, 3), NO_WORKS_EFFECTS);
  assert.equal(worksIncomeMult(state, 1), 1);
});

test('worksBattleEffects: does not mutate the state and is deterministic', () => {
  const { world, state } = realm([1, 2], 1e6);
  build(state, world, 1, 'barracks', 2);
  build(state, world, 2, 'stables');
  const before = snapshot(state);
  const a = worksBattleEffects(state, world, 4);
  const b = worksBattleEffects(state, world, 4);
  assert.deepEqual(a, b);
  assert.equal(snapshot(state), before);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
});

// --- income and scouting -------------------------------------------------------------------------

test('worksIncomeMult: only the Market, only its own region, 1 + perLevel x level', () => {
  const { world, state } = realm([1, 2], 1e6);
  assert.equal(worksIncomeMult(state, 1), 1);
  build(state, world, 1, 'market', 2);
  build(state, world, 2, 'barracks');
  assert.ok(Math.abs(worksIncomeMult(state, 1) - (1 + 2 * WORKS.effects.market.perLevel)) < 1e-9);
  assert.equal(worksIncomeMult(state, 2), 1, 'a Barracks pays no income');
  assert.equal(worksIncomeMult(state, 0), 1, 'a neighbouring Market does not help');
  assert.equal(worksIncomeMult(state, 3), 1, 'not owned');
  assert.equal(worksIncomeMult({ owner: [0], works: undefined }, 0), 1, 'a state with no Works field');
});

test('worksScoutedFree: a Watchtower next door scouts the region; owned, distant and Watchtower-less regions do not', () => {
  const { world, state } = realm([1, 2], 1e6);
  assert.equal(worksScoutedFree(state, world, 3), false);
  build(state, world, 1, 'watchtower');
  assert.equal(worksScoutedFree(state, world, 3), true, 'region 3 borders region 1');
  assert.equal(worksScoutedFree(state, world, 4), false, 'region 4 does not border region 1');
  assert.equal(worksScoutedFree(state, world, 1), false, 'the Watchtower region itself is yours');
  build(state, world, 2, 'barracks');
  assert.equal(worksScoutedFree(state, world, 4), false, 'other Works do not scout');
  assert.equal(worksScoutedFree(state, world, 99), false);
});

// --- reset, loss, save ---------------------------------------------------------------------------

test('resetWorks empties everything; clearRegionWorks drops one region (what a lost region does)', () => {
  const { world, state } = realm([1, 2], 1e6);
  build(state, world, 1, 'barracks');
  build(state, world, 2, 'market');
  clearRegionWorks(state, 1);
  assert.deepEqual(Object.keys(state.works), ['2']);
  clearRegionWorks(state, 77); // harmless
  resetWorks(state);
  assert.deepEqual(state.works, {});
  assert.equal(totalWorks(state), 0);
  assert.doesNotThrow(() => clearRegionWorks({}, 1));
});

test('ensureWorks creates the table on an old state; worksOf never does', () => {
  const state = { owner: [0] };
  assert.deepEqual(worksOf(state, 0), []);
  assert.equal('works' in state, false);
  assert.deepEqual(ensureWorks(state), {});
  assert.deepEqual(state.works, {});
});

test('sanitizeWorks: keeps valid Works, drops junk, dedupes types, caps the slots, accepts arrays', () => {
  const clean = sanitizeWorks({
    1: [{ type: 'barracks', level: 2 }, { type: 'barracks', level: 3 }, { type: 'moat', level: 1 }, { type: 'market', level: 9 },
      { type: 'shrine', level: 1.5 }, null, { type: 'stables', level: 1 }, { type: 'watchtower', level: 1 }, { type: 'shrine', level: 1 }],
    x: [{ type: 'market', level: 1 }],
    '-2': [{ type: 'market', level: 1 }],
    3: [],
    4: 'nope',
  });
  assert.deepEqual(clean, {
    1: [{ type: 'barracks', level: 2 }, { type: 'stables', level: 1 }, { type: 'watchtower', level: 1 }],
  });
  assert.deepEqual(sanitizeWorks([null, [{ type: 'market', level: 2 }]]), { 1: [{ type: 'market', level: 2 }] });
  for (const junk of [null, undefined, 5, 'x', [], {}, [[]]]) assert.deepEqual(sanitizeWorks(junk), {});
});

test('sanitizeWorks round-trips a real table unchanged', () => {
  const { world, state } = realm([1, 2], 1e6, { 1: 3, 2: 2 });
  build(state, world, 1, 'barracks', 2);
  build(state, world, 1, 'market', 3);
  build(state, world, 2, 'watchtower');
  assert.deepEqual(sanitizeWorks(JSON.parse(JSON.stringify(state.works))), state.works);
});

// --- determinism and JSON ------------------------------------------------------------------------

test('a scripted sequence of builds and upgrades is deterministic and plain JSON', () => {
  const run = () => {
    const { world, state } = realm([1, 2], 50000, { 1: 3, 2: 2 });
    buildWork(state, world, 1, 'barracks');
    buildWork(state, world, 1, 'stables');
    upgradeWork(state, world, 1, 0);
    buildWork(state, world, 2, 'market');
    upgradeWork(state, world, 2, 0);
    upgradeWork(state, world, 2, 0);
    upgradeWork(state, world, 2, 0); // refused: maxed
    return state;
  };
  const a = run();
  const b = run();
  assert.equal(snapshot(a), snapshot(b));
  assert.deepEqual(JSON.parse(snapshot(a)), a);
  assert.equal(a.works[2][0].level, 3);
});

// --- panel data ----------------------------------------------------------------------------------

test('worksPanelData: always three slot views; built, empty and locked in that order', () => {
  const { world, state } = realm([1], 1e6, { 1: 2 });
  build(state, world, 1, 'barracks');
  const d = worksPanelData(state, world, 1);
  assert.equal(d.slots.length, MAX_WORK_SLOTS);
  assert.deepEqual(d.slots.map((s) => s.state), ['built', 'empty', 'locked']);
  assert.equal(d.freeSlot, 1);
  const built = d.slots[0];
  assert.equal(built.type, 'barracks');
  assert.equal(built.name, 'Barracks');
  assert.equal(built.level, 1);
  assert.equal(built.effect, workEffectText('barracks', 1));
  assert.equal(built.nextEffect, workEffectText('barracks', 2));
  assert.equal(built.upgradeCost, workCost(state, world, 1, 'barracks', 2));
  assert.equal(built.affordable, true);
  assert.equal(built.reason, null);
  assert.equal(d.slots[1].canBuild, true);
  assert.equal(d.slots[2].unlockLabel, 'Unlocks at Prosperity III');
  assert.equal(d.choices.length, WORK_TYPES.length);
  assert.deepEqual(JSON.parse(JSON.stringify(d)), d);
});

test('worksPanelData: disabled reasons say how much gold is missing, or why', () => {
  const { world, state } = realm([1], 0, { 1: 2 });
  state.gold = 10;
  const need = workCost(state, world, 1, 'barracks', 1) - 10;
  let d = worksPanelData(state, world, 1);
  const barracks = d.choices.find((c) => c.type === 'barracks');
  assert.equal(barracks.affordable, false);
  assert.equal(barracks.reason, `Need ${need} more gold`);
  assert.equal(d.slots[0].canBuild, false);
  assert.equal(d.slots[0].cheapest, Math.min(...d.choices.map((c) => c.cost)));

  state.gold = 1e6;
  build(state, world, 1, 'barracks');
  state.gold = 5;
  d = worksPanelData(state, world, 1);
  assert.equal(d.slots[0].affordable, false);
  assert.match(d.slots[0].reason, /^Need \d+ more gold$/);
  assert.equal(d.choices.find((c) => c.type === 'barracks').reason, 'Already built here');
  assert.equal(d.choices.find((c) => c.type === 'barracks').affordable, false);

  state.gold = 1e6;
  upgradeWork(state, world, 1, 0);
  upgradeWork(state, world, 1, 0);
  d = worksPanelData(state, world, 1);
  assert.equal(d.slots[0].upgradeCost, null);
  assert.equal(d.slots[0].nextEffect, null);
  assert.equal(d.slots[0].reason, 'Fully upgraded');
});

test('worksPanelData: locked slots report the time until their prosperity level when given `now`', () => {
  const { world, state } = realm([1], 0, { 1: 0 });
  const minute = 60 * 1000;
  state.conqueredAt[1] = 1000;
  const now = 1000 + 50 * minute;
  const d = worksPanelData(state, world, 1, now);
  assert.equal(d.slots[1].state, 'locked');
  assert.equal(d.slots[1].unlockLabel, 'Unlocks at Prosperity II');
  assert.equal(d.slots[1].unlockInMs, PROSPERITY.thresholdsMs[1] - 50 * minute);
  assert.equal(d.slots[2].unlockInMs, PROSPERITY.thresholdsMs[2] - 50 * minute);
  assert.equal(worksPanelData(state, world, 1).slots[1].unlockInMs, null, 'no clock, no countdown');
});

test('worksPanelData: a full region offers no chooser; a region you do not own shows nothing buildable', () => {
  const { world, state } = realm([1], 1e6);
  build(state, world, 1, 'market');
  const full = worksPanelData(state, world, 1);
  assert.equal(full.freeSlot, -1);
  assert.deepEqual(full.choices, []);
  const foreign = worksPanelData(state, world, 3);
  assert.equal(foreign.owned, false);
  assert.ok(foreign.slots.every((s) => s.state === 'locked'));
});

test('worksPanelData does not mutate the state', () => {
  const { world, state } = realm([1], 1e6, { 1: 3 });
  build(state, world, 1, 'shrine', 2);
  const before = snapshot(state);
  worksPanelData(state, world, 1, 99999999);
  worksMarksData(state, world);
  assert.equal(snapshot(state), before);
});

// --- copy ----------------------------------------------------------------------------------------

// The words are in meta/works.js EFFECT_LINES, the NUMBERS are only ever read from WORKS.effects: tune the config and the copy follows.
const numericEffects = (type) => Object.entries(WORKS.effects[type]).filter(([, v]) => typeof v === 'number');
const hasNumber = (text, per, level) => [String(Math.round(per * level * 100)), String(Math.round(per * level * 10) / 10)].some((n) => new RegExp(`(^|[^0-9.])${n.replace('.', '\\.')}([^0-9.]|$)`).test(text));

test('effect text and blurbs state EVERY effect of a Work, each number read from the config', () => {
  for (const type of WORK_TYPES) {
    const covered = workEffectKeys(type);
    for (const [key] of numericEffects(type)) assert.ok(covered.includes(key), `${type}.${key} is an effect in config/works.js with no line in the copy (add one to EFFECT_LINES in meta/works.js)`);
    for (let level = 1; level <= WORKS.maxLevel; level++) {
      const text = workEffectText(type, level);
      for (const [key, per] of numericEffects(type)) {
        if (type === 'watchtower') continue; // its number is the level itself
        assert.ok(hasNumber(text, per, level), `${type} L${level}: "${text}" shows ${key} = ${per} x ${level}`);
      }
      assert.ok(text.length > 0 && text.length <= 56, `${type} L${level} fits a built row (two lines at most): ${text}`);
    }
    const blurb = workBlurb(type);
    assert.ok(blurb.length > 6 && blurb.length <= 52, `${type} blurb fits a chooser row (two lines at most): ${blurb}`);
    if (type !== 'watchtower') for (const [key, per] of numericEffects(type)) assert.ok(hasNumber(blurb, per, 1), `${type}: "${blurb}" shows ${key} = ${per}`);
    assert.ok(workName(type).length > 3);
  }
  assert.match(workEffectText('watchtower', 2), /camp arrows L2/);
  // the Stables and Barracks say their SECOND effect too (supply lines, camp growth)
  assert.match(workEffectText('stables', 1), /supply/i);
  assert.match(workEffectText('stables', 1), /clash/i, 'Stables also say their field-clash bonus');
  assert.match(workEffectText('barracks', 1), /growth/i);
  assert.equal(worksToast('built', { work: 'Barracks', region: 'Fenwall' }), 'Barracks built in Fenwall');
  assert.equal(worksToast('upgraded', { work: 'Market', region: 'Fenwall', level: 3 }), 'Market in Fenwall is now level III');
});

test('no number is ever typed into Works copy: meta/works.js has no digit in any string, and no scene, app or UI file types a Works effect', () => {
  const code = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
  const strings = (src) => { const out = []; const re = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g; let m; while ((m = re.exec(src))) out.push(m[2]); return out; };
  const withDigit = strings(code('../meta/works.js')).filter((t) => /\d/.test(t));
  assert.deepEqual(withDigit, [], 'a number typed into a string in meta/works.js (derive it from WORKS.effects)');
  const words = /\d\s?%|\d\s?(?:camp troops|troops|march speed|speed|cooldowns?|income|growth|supply)/i;
  const bad = [];
  for (const dir of ['ui', 'scenes', 'app']) {
    for (const f of readdirSync(new URL(`../${dir}/`, import.meta.url))) {
      if (!f.endsWith('.js')) continue;
      if (dir !== 'ui' || /^works/.test(f)) for (const t of strings(code(`../${dir}/${f}`))) if (words.test(t) && /barracks|stables|shrine|watchtower|market|camp|march|supply/i.test(t)) bad.push(`${dir}/${f}: ${t}`);
    }
  }
  assert.deepEqual(bad, [], 'Works numbers typed into UI, scene or app code');
});

// --- map marks and tutorial ----------------------------------------------------------------------

test('worksMarksData: one entry per owned region with Works, anchored at the keep tile', () => {
  const world = generateWorld(7);
  const state = createGame(7, world, 0);
  state.gold = 1e9;
  const home = world.regions[world.startRegion];
  buildWork(state, world, home.id, 'market');
  const marks = worksMarksData(state, world);
  assert.equal(marks.length, 1);
  const keepTile = world.tiles[world.settlements[home.keep].tile];
  assert.deepEqual(marks[0], { regionId: home.id, x: keepTile.x, y: keepTile.y, elev: keepTile.elev, works: [{ type: 'market', level: 1 }] });
  assert.deepEqual(worksMarksData(createGame(7, world, 0), world), []);
});

test('tutorial M3: due after the 3rd conquest until the first Work; points at an owned region that borders enemy land', () => {
  const { world, state } = realm([1, 2], 1e6);
  state.stats.regionsConquered = 2;
  assert.equal(worksTutorialDue(state), false);
  state.stats.regionsConquered = 3;
  assert.equal(worksTutorialDue(state), true);
  const target = worksTutorialRegion(state, world);
  assert.ok(state.owner[target] === PLAYER_FACTION);
  assert.ok(world.regions[target].neighbors.some((n) => state.owner[n] !== PLAYER_FACTION));
  buildWork(state, world, target, 'barracks');
  assert.equal(worksTutorialDue(state), false, 'one Work built ends it');
  assert.notEqual(worksTutorialRegion(state, world), target, 'a full region is not pointed at again');
  assert.equal(worksTutorialRegion(realm([]).state, makeWorld()) >= 0, true);
});

test('tutorial M3: -1 when nothing owned has a free slot and a hostile border', () => {
  const { world, state } = realm([1, 2, 3, 4, 5], 1e6); // the whole fixture continent
  assert.equal(worksTutorialRegion(state, world), -1);
});

// --- a real continent ---------------------------------------------------------------------------

test('real world: Works next to a frontier region change its battle effects, and only its', () => {
  const world = generateWorld(7);
  const state = createGame(7, world, 0);
  state.gold = 1e9;
  const home = world.regions[world.startRegion];
  const target = world.regions[home.neighbors[0]];
  assert.equal(worksBattleEffects(state, world, target.id), NO_WORKS_EFFECTS);
  buildWork(state, world, home.id, 'barracks');
  upgradeWork(state, world, home.id, 0);
  const fx = worksBattleEffects(state, world, target.id);
  assert.equal(fx.campTroops, 2 * WORKS.effects.barracks.perLevel);
  const farAway = world.regions.find((r) => r.id !== home.id && !home.neighbors.includes(r.id) && r.tier >= 3);
  assert.equal(worksBattleEffects(state, world, farAway.id), NO_WORKS_EFFECTS);
  // conquering the neighbour leaves the Works alone and the neighbour gains its own slot
  conquer(state, world, target.id, 1000);
  assert.equal(workSlots(state, target.id), 1);
  assert.equal(worksOf(state, home.id).length, 1);
});

// --- structure -----------------------------------------------------------------------------------

function sourceOf(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}
const importsOf = (src) => [...src.matchAll(/^\s*import[\s\S]*?from\s+'([^']+)'/gm)].map((m) => m[1]);

test('works files are pure: no DOM, time, randomness or storage', () => {
  for (const rel of ['../meta/works.js', '../meta/worksEffects.js', '../config/works.js']) {
    const src = sourceOf(rel).replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
    for (const banned of ['document', 'window', 'Math.random', 'Date.now', 'performance', 'localStorage', 'requestAnimationFrame']) {
      assert.ok(!src.includes(banned), `${rel} mentions ${banned}`);
    }
  }
});

test('import graph: the effects leaf imports no meta module but state.js; progression and economy never import works.js', () => {
  assert.deepEqual(importsOf(sourceOf('../meta/worksEffects.js')).sort(), ['../config/works.js', './state.js']);
  for (const rel of ['../meta/progression.js', '../meta/economy.js', '../meta/upgrades.js', '../meta/perks.js', '../meta/prosperity.js']) {
    assert.ok(!importsOf(sourceOf(rel)).includes('./works.js'), `${rel} must import ./worksEffects.js, not ./works.js (cycle)`);
  }
});

test('config: every cost and effect number is finite and sane', () => {
  assert.ok(WORKS.cost.base > 0 && WORKS.cost.perDepth >= 1);
  assert.equal(WORKS.cost.levelMult.length, WORKS.maxLevel);
  assert.ok(WORKS.cost.levelMult.every((m, i, a) => m > 0 && (i === 0 || m > a[i - 1])));
  for (const t of WORK_TYPES) {
    assert.ok(WORKS.cost.typeMult[t] > 0, t);
    assert.ok(WORKS.effects[t].perLevel > 0, t);
    assert.ok(WORKS.copy.names[t], t);
  }
  assert.ok(WORKS.caps.cooldownFloor > 0 && WORKS.caps.cooldownFloor < 1);
  assert.ok(WORKS.caps.speedMult >= 1 && WORKS.caps.campTroops >= 0);
  assert.ok(WORKS.marks.fadeInStartZoom < WORKS.marks.fadeInFullZoom);
  assert.ok(WORKS.marks.fadeOutStartZoom < WORKS.marks.fadeOutEndZoom);
});
