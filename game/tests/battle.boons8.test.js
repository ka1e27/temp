// Phase 8 (PLAN-PHASE8 §8C): the new behaviour Boons, Duos and the Seal of the Margrave in the sim (game/battle/boons.js and its hooks
// in squads, powers, movement, combat, resolve and fallen). With none of their keys the sim is unchanged (the existing suites prove it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, step, issue } from '../battle/sim.js';
import { towerRangeBoonMult, garrisonBoonMult, marchBoonMult } from '../battle/boons.js';
import { risingEverySec } from '../battle/fallen.js';
import { ASHEN } from '../config/ashen.js';

const SQ3 = Math.sqrt(3);
const POW = Object.freeze({ rally: 1, firestorm: 1, bulwark: 0, march: 1, levy: 0 });
const BASE = Object.freeze({ atk: 1, def: 1, growth: 0, speed: 1, campTroops: 100, garrisonShare: 0.35, capBonus: 0, cooldownMult: 1, powers: POW });
const ENEMY = Object.freeze({ atk: 1, def: 1, growth: 0, speed: 1, troopMult: 1, thinkSec: 1, graceSec: 999, personality: 'aggressive', factionId: 2 });

function line(sites, length = 14) {
  const tiles = [];
  for (let q = 0; q < length; q++) tiles.push({ i: q, q, r: 0, x: q * SQ3, y: 0, cost: 1, terrain: 'grass', region: 0 });
  return { regionId: 0, enemyFaction: 2, tiles, sites: sites.map(([tile, type, owner, troops], id) => ({ id, settlement: id - 1, tile, type, owner, troops })),
    focus: { minX: 0, maxX: (length - 1) * SQ3, minY: 0, maxY: 0 }, marches: [] };
}
const mk = (sites, boons, extra = {}) => createBattle(line(sites), boons ? { ...BASE, boons } : BASE, ENEMY, extra);
const boonEvents = (b) => b.events.filter((e) => e.type === 'boonTriggered');
const send = (b, from, to, fraction) => issue(b, { type: 'send', owner: 0, from, to, fraction });

test('Vanguard: only the first squad of the battle is +50%, with a pop', () => {
  const sites = [[0, 'camp', 0, 200], [13, 'keep', 2, 999]];
  const b = mk(sites, { vanguardMult: 1.5 });
  const plain = mk(sites, null);
  const evs = [];
  for (const x of [b, plain]) for (let k = 0; k < 2; k++) { send(x, 0, 1, 0.1); step(x, 0.05); if (x === b) evs.push(...boonEvents(b)); }
  assert.equal(b.squads[0].count, plain.squads[0].count * 1.5);
  assert.ok(Math.abs(b.squads[1].count - plain.squads[1].count) <= 1, 'the second squad is plain (the camp only paid for the first one)');
  assert.equal(evs.length, 1);
  assert.equal(evs[0].boon, 'vanguard');
  assert.equal(evs[0].count, Math.round(plain.squads[0].count * 0.5));
});

test('Supply Wagons: a supply-line squad carries +25%; Siege Train makes it ride through arrows; hand-sent squads are plain', () => {
  const sites = [[0, 'camp', 0, 100], [3, 'village', 0, 10], [13, 'keep', 2, 999]];
  const b = mk(sites, { supplyBonus: 0.25 });
  issue(b, { type: 'supply', owner: 0, from: 0, to: 1 }); step(b, 0.05);
  const q = b.squads[0];
  assert.equal(q.count, 62.5, '50 sent x 1.25');
  assert.ok(!q.noArrows);
  assert.ok(boonEvents(b).some((e) => e.boon === 'supplyWagons' && e.count === 13));
  const t = mk(sites, { supplyBonus: 0.25, supplyNoArrows: true });
  issue(t, { type: 'supply', owner: 0, from: 0, to: 1 }); step(t, 0.05);
  assert.equal(t.squads[0].noArrows, true, 'Siege Train');
  const h = mk(sites, { supplyBonus: 0.25, supplyNoArrows: true });
  send(h, 0, 1, 0.5); step(h, 0.05);
  assert.equal(h.squads[0].count, 50);
  assert.ok(!h.squads[0].noArrows);
});

test('War Drums: a cast speeds the march for drumsSec; Thunder Charge makes the next squad +25%', () => {
  const b = mk([[0, 'camp', 0, 200], [13, 'keep', 2, 999]], { drumsSec: 5, drumsMult: 1.1, drumVanguardMult: 1.25 });
  issue(b, { type: 'power', owner: 0, power: 'march' }); step(b, 0.05);
  const drum = boonEvents(b).find((e) => e.boon === 'warDrums');
  assert.ok(drum && Math.abs(drum.until - 5) < 1e-9, 'until = cast time + 5');
  const probe = { owner: 0 };
  assert.ok(Math.abs(marchBoonMult(b, probe, 1) - 1.1) < 1e-9);
  assert.equal(marchBoonMult(b, probe, 6), 1, 'over after 5 s');
  assert.equal(marchBoonMult(b, { owner: 2 }, 1), 1, 'never the enemy');
  send(b, 0, 1, 0.1); step(b, 0.05);
  send(b, 0, 1, 0.1); step(b, 0.05);
  const plain = mk([[0, 'camp', 0, 200], [13, 'keep', 2, 999]], { drumsSec: 5, drumsMult: 1.1 });
  issue(plain, { type: 'power', owner: 0, power: 'march' }); step(plain, 0.05);
  send(plain, 0, 1, 0.1); step(plain, 0.05);
  send(plain, 0, 1, 0.1); step(plain, 0.05);
  assert.equal(b.squads[0].count, plain.squads[0].count * 1.25, 'the first squad after the cast');
  assert.ok(Math.abs(b.squads[1].count - plain.squads[1].count) <= 1, 'only one per cast; War Drums alone adds no troops');
});

test('Tower Sappers: an enemy tower near a site you hold shoots 30% shorter; a pop once per tower', () => {
  const b = mk([[0, 'camp', 0, 50], [5, 'village', 0, 10], [7, 'tower', 2, 20], [13, 'tower', 2, 20]], { sapperHexes: 3, sapperRangeMult: 0.7 });
  b.events = [];
  assert.equal(towerRangeBoonMult(b, b.sites[2], 0), 0.7, 'two hexes from the village');
  assert.equal(towerRangeBoonMult(b, b.sites[3], 0), 1, 'eight hexes away');
  assert.equal(towerRangeBoonMult(b, b.sites[2], 1), 0.7);
  assert.equal(b.events.filter((e) => e.boon === 'towerSappers').length, 1, 'once per tower');
  b.sites[2].owner = 0;
  assert.equal(towerRangeBoonMult(b, b.sites[2], 2), 1, 'your own towers are never sapped');
  const plain = mk([[0, 'camp', 0, 50], [5, 'village', 0, 10], [7, 'tower', 2, 20]], null);
  assert.equal(towerRangeBoonMult(plain, plain.sites[2], 0), 1);
});

test('Last Stand: only your keep, only in a defense, only below a quarter of its cap', () => {
  const sites = [[13, 'camp', 2, 200], [3, 'keep', 0, 100]];
  const arena = { ...line(sites), mode: 'defense', keepSite: 1, siegeSec: 120 };
  const b = createBattle(arena, { ...BASE, boons: { lastStandShare: 0.25, lastStandDefMult: 1.4 } }, ENEMY, { mode: 'defense' });
  const keep = b.sites[1];
  keep.troops = keep.cap * 0.5;
  assert.equal(garrisonBoonMult(b, keep, 1), 1);
  keep.troops = keep.cap * 0.2;
  b.events = [];
  assert.equal(garrisonBoonMult(b, keep, 1), 1.4);
  assert.equal(garrisonBoonMult(b, keep, 2), 1.4);
  assert.equal(b.events.filter((e) => e.boon === 'lastStand').length, 1);
  const atk = mk([[0, 'camp', 0, 5], [3, 'keep', 0, 1]], { lastStandShare: 0.25, lastStandDefMult: 1.4 });
  assert.equal(garrisonBoonMult(atk, atk.sites[1], 1), 1, 'not in an attack');
});

test('the Seal of the Margrave: the Rising every 30 s instead of 20 s', () => {
  assert.equal(risingEverySec({ player: {} }), ASHEN.rising.everySec);
  assert.equal(risingEverySec({ player: { boons: { risingIntervalMult: 1.5 } } }), ASHEN.rising.everySec * 1.5);
});
