// Fortifications (DESIGN §10.3): slots (2, +1 at Prosperity II), one of each type, costs by depth, build / upgrade / demolish
// with a half refund, panel data with copy derived from the config, map marks, sanitising.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/generate.js';
import { createGame } from '../meta/state.js';
import { enemyDepth } from '../meta/progression.js';
import {
  fortCost, buildFort, canBuildFort, fortBuildRefusal, upgradeFort, fortUpgradeRefusal, demolishFort, fortDemolishRefund,
  fortSlots, fortsOf, fortLevel, fortsPanelData, fortsMarksData, fortEffectText, fortName, fortsToast, sanitizeForts,
  MAX_FORT_SLOTS, regionFortEffects, totalForts, resetForts, fortTowerTiles,
} from '../meta/forts.js';
import { occupy } from '../meta/frontier.js';
import { FORTS, FORT_TYPES } from '../config/frontier.js';

const world = generateWorld(5);
function realm() {
  const state = createGame(5, world, 0);
  for (const r of world.regions) if (r.tier <= 2) { state.owner[r.id] = 0; state.conqueredAt[r.id] = 0; }
  state.gold = 1e9;
  return state;
}
const owned = (state) => world.regions.filter((r) => state.owner[r.id] === 0 && r.tier > 0);

test('slots: 2 per owned region, 3 at Prosperity II, 0 where the player does not rule', () => {
  const state = realm();
  const r = owned(state)[0];
  assert.equal(fortSlots(state, r.id), FORTS.slots.base);
  state.prosperity = world.regions.map(() => 0);
  state.prosperity[r.id] = 1;
  assert.equal(fortSlots(state, r.id), 2);
  state.prosperity[r.id] = 2;
  assert.equal(fortSlots(state, r.id), 3);
  assert.equal(MAX_FORT_SLOTS, 3);
  const foreign = world.regions.find((x) => state.owner[x.id] !== 0);
  assert.equal(fortSlots(state, foreign.id), 0);
});

test('costs: base x perDepth^(depth-1) x level x type; Infinity for nonsense', () => {
  const state = realm();
  const r = owned(state)[2];
  const depth = Math.max(1, enemyDepth(world, r));
  for (const type of FORT_TYPES) {
    for (let level = 1; level <= FORTS.maxLevel[type]; level++) {
      const c = FORTS.cost;
      assert.equal(fortCost(state, world, r.id, type, level), Math.round(c.base * c.perDepth ** (depth - 1) * c.levelMult[level - 1] * c.typeMult[type]));
    }
  }
  assert.equal(fortCost(state, world, r.id, 'beacon', 3), Infinity, 'the Beacon stops at II');
  assert.equal(fortCost(state, world, r.id, 'moat', 1), Infinity);
  assert.equal(fortCost(state, world, 9999, 'walls', 1), Infinity);
});

test('build: fills slots in order, one of each type, pays gold, refuses with a reason', () => {
  const state = realm();
  const r = owned(state)[1];
  const gold = state.gold;
  const a = buildFort(state, world, r.id, 'walls');
  assert.deepEqual(a.fort, { type: 'walls', level: 1 });
  assert.equal(a.slot, 0);
  assert.equal(state.gold, gold - a.cost);
  assert.equal(fortBuildRefusal(state, world, r.id, 'walls'), 'duplicate');
  assert.ok(buildFort(state, world, r.id, 'tower'));
  assert.equal(fortBuildRefusal(state, world, r.id, 'hall'), 'noSlot');
  assert.equal(buildFort(state, world, r.id, 'hall'), false);
  assert.deepEqual(fortsOf(state, r.id).map((f) => f.type), ['walls', 'tower']);
  const poor = realm();
  poor.gold = 0;
  assert.equal(fortBuildRefusal(poor, world, r.id, 'walls'), 'gold');
  const foreign = world.regions.find((x) => state.owner[x.id] !== 0);
  assert.equal(fortBuildRefusal(state, world, foreign.id, 'walls'), 'notOwned');
  assert.equal(canBuildFort(state, world, r.id, 'nonsense'), false);
  assert.equal(totalForts(state), 2);
});

test('upgrade to the type\'s max level; demolish refunds half of everything spent and frees the slot', () => {
  const state = realm();
  const r = owned(state)[0];
  buildFort(state, world, r.id, 'beacon');
  const up = upgradeFort(state, world, r.id, 0);
  assert.equal(up.level, 2);
  assert.equal(fortUpgradeRefusal(state, world, r.id, 0), 'maxed');
  assert.equal(fortLevel(state, r.id, 'beacon'), 2);
  const spent = fortCost(state, world, r.id, 'beacon', 1) + fortCost(state, world, r.id, 'beacon', 2);
  assert.equal(fortDemolishRefund(state, world, r.id, 0), Math.round(spent * FORTS.demolishRefund));
  const gold = state.gold;
  const d = demolishFort(state, world, r.id, 0);
  assert.equal(state.gold, gold + d.refund);
  assert.equal(state.forts[r.id], undefined, 'an emptied region drops its entry');
  assert.ok(canBuildFort(state, world, r.id, 'beacon'), 'free to build again');
  assert.equal(demolishFort(state, world, r.id, 0), false);
});

test('effects follow the built levels; copy is derived from the config numbers', () => {
  const state = realm();
  const r = owned(state)[0];
  buildFort(state, world, r.id, 'walls');
  upgradeFort(state, world, r.id, 0);
  buildFort(state, world, r.id, 'hall');
  const fx = regionFortEffects(state, r.id);
  assert.equal(fx.wallsMult, FORTS.effects.walls.defMult[1]);
  assert.equal(fx.hallMult, FORTS.effects.hall.garrisonMult[0]);
  assert.equal(fx.towerLevel, 0);
  assert.equal(fortName('tower'), 'Arrow Tower');
  assert.ok(fortEffectText('walls', 2).includes(String(FORTS.effects.walls.defMult[1])));
  assert.ok(fortEffectText('beacon', 1).includes(String(FORTS.effects.beacon.warnSec[0])));
  assert.equal(fortsToast('upgraded', { fort: 'Walls', region: 'Fenwall', level: 2 }), 'Walls in Fenwall is now level II');
});

test('panel data: three slots (built / empty / locked), choices with reasons, a locked slot says when it opens', () => {
  const state = realm();
  const r = owned(state)[0];
  buildFort(state, world, r.id, 'tower');
  const data = fortsPanelData(state, world, r.id, 60 * 1000);
  assert.equal(data.slots.length, MAX_FORT_SLOTS);
  assert.deepEqual(data.slots.map((s) => s.state), ['built', 'empty', 'locked']);
  assert.equal(data.freeSlot, 1);
  assert.equal(data.choices.length, FORT_TYPES.length);
  assert.equal(data.choices.find((c) => c.type === 'tower').reason, FORTS.copy.reasons.duplicate);
  assert.ok(data.slots[0].demolishPrompt.startsWith('Demolish Arrow Tower?'));
  assert.ok(data.slots[2].unlockLabel.includes('II'));
  assert.ok(data.slots[2].unlockInMs > 0);
  assert.equal(data.owned, true);
});

test('map marks show owned and occupied fortifications with the tower\'s tile', () => {
  const state = realm();
  const [a, b] = owned(state);
  buildFort(state, world, a.id, 'tower');
  buildFort(state, world, b.id, 'walls');
  occupy(state, world, b.id, 3, 0);
  const marks = fortsMarksData(state, world);
  const ma = marks.find((m) => m.regionId === a.id);
  assert.equal(ma.occupiedBy, null);
  assert.equal(ma.towerTile, fortTowerTiles(world, a.id, 1)[0]);
  const mb = marks.find((m) => m.regionId === b.id);
  assert.equal(mb.occupiedBy, 3);
  assert.deepEqual(mb.forts, [{ type: 'walls', level: 1 }]);
});

test('sanitizeForts: junk-proof; resetForts empties', () => {
  assert.deepEqual(sanitizeForts(null), {});
  assert.deepEqual(sanitizeForts({ 1: [{ type: 'walls', level: 2 }, { type: 'walls', level: 1 }, { type: 'beacon', level: 3 }, { type: 'x', level: 1 }],
    2: 'no', a: [], 3: [] }), { 1: [{ type: 'walls', level: 2 }] });
  assert.deepEqual(sanitizeForts([[{ type: 'hall', level: 1 }]]), { 0: [{ type: 'hall', level: 1 }] });
  const many = sanitizeForts({ 4: FORT_TYPES.map((type) => ({ type, level: 1 })) });
  assert.equal(many[4].length, MAX_FORT_SLOTS);
  const state = realm();
  buildFort(state, world, owned(state)[0].id, 'walls');
  resetForts(state);
  assert.deepEqual(state.forts, {});
});
