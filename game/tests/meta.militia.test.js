// Militia garrisons (DESIGN §10.4): sizes per settlement type scaled by Muster and depth, a Militia Hall's boost and faster
// refill, draining after a defense and refilling over about 8 minutes, the loss share of a finished battle, sanitising.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/generate.js';
import { createGame } from '../meta/state.js';
import {
  militiaGarrisons, militiaScale, militiaFill, drainMilitia, refillMilitia, militiaTowerGarrison, militiaCapMult,
  defenseLossFraction, sanitizeMilitia, resetMilitia, depthTroopMult,
} from '../meta/militia.js';
import { FRONTIER, FORTS } from '../config/frontier.js';
import { ENEMY_SCALING } from '../config/battle.js';

const world = generateWorld(3);
function realm() {
  const state = createGame(3, world, 0);
  for (const r of world.regions) if (r.tier <= 2) state.owner[r.id] = 0;
  return state;
}
const region = world.regions.find((r) => r.tier === 2 && r.settlements.length >= 3);

test('garrisons: perType x scale, in region.settlements order, full when nothing is stored', () => {
  const state = realm();
  const g = militiaGarrisons(state, world, region.id, 0);
  const k = militiaScale(state, world, region.id);
  assert.equal(g.length, region.settlements.length);
  region.settlements.forEach((id, i) => assert.ok(Math.abs(g[i] - FRONTIER.militia.perType[world.settlements[id].type] * k) < 1e-9));
  assert.equal(militiaFill(state, region.id, 123), 1);
  assert.deepEqual(militiaGarrisons(state, world, 9999, 0), []);
});

test('scale: Muster makes the militia bigger; a deeper region holds more', () => {
  const state = realm();
  const before = militiaScale(state, world, region.id);
  state.upgrades.muster = 10;
  assert.ok(militiaScale(state, world, region.id) > before);
  const shallow = world.regions.find((r) => r.tier === 1);
  const deep = world.regions.reduce((a, b) => (b.tier > a.tier ? b : a));
  assert.ok(militiaScale(state, world, deep.id) > militiaScale(state, world, shallow.id));
  assert.ok(Math.abs(depthTroopMult(state, 1) - ENEMY_SCALING.troopAtDepth1) < 1e-12);
  assert.ok(depthTroopMult({ dynasty: { level: 2 } }, 1) > depthTroopMult(state, 1), 'a later dynasty fields bigger garrisons');
});

test('a Militia Hall raises the garrisons and the caps, and refills faster', () => {
  const state = realm();
  const plain = militiaGarrisons(state, world, region.id, 0);
  const tower = militiaTowerGarrison(state, world, region.id, 0);
  const cap = militiaCapMult(state, world, region.id);
  state.forts = { [region.id]: [{ type: 'hall', level: 3 }] };
  const hall = militiaGarrisons(state, world, region.id, 0);
  hall.forEach((v, i) => assert.ok(Math.abs(v - plain[i] * FORTS.effects.hall.garrisonMult[2]) < 1e-9));
  assert.ok(Math.abs(militiaTowerGarrison(state, world, region.id, 0) - tower * FORTS.effects.hall.garrisonMult[2]) < 1e-9);
  assert.ok(militiaCapMult(state, world, region.id) >= cap);
  drainMilitia(state, region.id, 1, 0);
  const half = FRONTIER.militia.refillMs / 2;
  assert.ok(Math.abs(militiaFill(state, region.id, half) - Math.min(1, 0.5 * FORTS.effects.hall.refillMult[2])) < 1e-9);
});

test('drain and refill: a defense drains the share lost (at least the floor); empty to full in refillMs', () => {
  const state = realm();
  assert.ok(Math.abs(drainMilitia(state, region.id, 0, 1000) - (1 - FRONTIER.militia.lossFloor)) < 1e-9, 'a clean hold still costs the floor');
  drainMilitia(state, region.id, 1, 2000);
  assert.equal(militiaFill(state, region.id, 2000), 0);
  assert.ok(Math.abs(militiaFill(state, region.id, 2000 + FRONTIER.militia.refillMs / 4) - 0.25) < 1e-9);
  assert.equal(militiaFill(state, region.id, 2000 + FRONTIER.militia.refillMs), 1, 'full in about 8 minutes');
  assert.equal(FRONTIER.militia.refillMs, 8 * 60 * 1000);
  const g = militiaGarrisons(state, world, region.id, 2000 + FRONTIER.militia.refillMs / 2);
  const full = militiaGarrisons(realm(), world, region.id, 0);
  g.forEach((v, i) => assert.ok(Math.abs(v - full[i] / 2) < 1e-9));
  assert.equal(militiaFill(state, region.id, 0), 0, 'a clock before the drain refills nothing');
  refillMilitia(state, region.id, 5);
  assert.equal(militiaFill(state, region.id, 5), 1);
});

test('defenseLossFraction: the share of the region\'s garrison gone by the end, growth included', () => {
  const tiles = [{ i: 0, region: 1 }, { i: 1, region: 0 }, { i: 2, region: 0 }];
  const arena = { regionId: 0, tiles, sites: [{ id: 0, tile: 0, owner: 3, troops: 50 }, { id: 1, tile: 1, owner: 0, troops: 40 }, { id: 2, tile: 2, owner: 0, troops: 60 }] };
  const battle = (t1, o2, t2) => ({ arena, sites: [{ id: 0, tile: 0, owner: 3, troops: 1 }, { id: 1, tile: 1, owner: 0, troops: t1 }, { id: 2, tile: 2, owner: o2, troops: t2 }] });
  assert.equal(defenseLossFraction(battle(40, 0, 60)), 0);
  assert.equal(defenseLossFraction(battle(20, 0, 30)), 0.5);
  assert.equal(defenseLossFraction(battle(20, 3, 30)), 0.8, 'a site lost counts all its troops');
  assert.equal(defenseLossFraction(battle(80, 0, 120)), 0, 'growth does not make it negative');
});

test('sanitizeMilitia: junk-proof; resetMilitia empties', () => {
  assert.deepEqual(sanitizeMilitia(null), {});
  assert.deepEqual(sanitizeMilitia({ 1: { fill: 2, at: 5 }, 2: { fill: 0.5 }, x: { fill: 1, at: 1 }, 3: 'no', 4: { fill: -1, at: 9 } }),
    { 1: { fill: 1, at: 5 }, 4: { fill: 0, at: 9 } });
  const state = realm();
  drainMilitia(state, region.id, 0.5, 0);
  resetMilitia(state);
  assert.deepEqual(state.militia, {});
});
