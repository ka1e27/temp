// Battle twists and feature sites in the sim (DESIGN §10.13): Night, Blizzard, Flooded, Holy Ground, Siege (the Gate), Raid (the
// Shrines), the Bandit Camp's veterans and the Ancient Tower; and that real arenas carry them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, step, issue, canRoute, routeFor } from '../battle/sim.js';
import { buildArena } from '../battle/arena.js';
import { generateWorld } from '../world/generate.js';
import { createGame } from '../meta/state.js';
import { playerBattleStats, enemyBattleStats } from '../meta/progression.js';
import { FEATURES } from '../config/features.js';
import { SITE_TYPES } from '../config/battle.js';

const SQ3 = Math.sqrt(3);
const POW = Object.freeze({ rally: 1, firestorm: 1, bulwark: 1, march: 1, levy: 1 });
const P = Object.freeze({ atk: 1, def: 1, growth: 0, speed: 1, campTroops: 40, garrisonShare: 0.35, capBonus: 0, cooldownMult: 1, powers: POW });
const E = Object.freeze({ atk: 1, def: 1, growth: 0, speed: 1, troopMult: 1, thinkSec: 1, graceSec: 999, personality: 'aggressive', factionId: 2 });

function line(sites, twist = null, length = 12, extra = {}) {
  const tiles = [];
  for (let q = 0; q < length; q++) {
    const t = { i: q, q, r: 0, x: q * SQ3, y: 0, cost: 1, terrain: 'grass', region: q < 2 ? 1 : 0 };
    if (q < 2) t.own = 0;
    tiles.push(t);
  }
  const arena = { regionId: 0, enemyFaction: 2, tiles, sites: sites.map(([tile, type, owner, troops, more], id) => ({ id, settlement: id - 1, tile, type, owner, troops, ...(more || {}) })),
    focus: { minX: 0, maxX: (length - 1) * SQ3, minY: 0, maxY: 0 }, marches: [], ...extra };
  if (twist) arena.twist = twist;
  return arena;
}
const run = (b, sec) => { const end = b.t + sec; while (!b.result && b.t < end - 1e-9) step(b, 0.05); };
const progress = (b) => b.squads[0].seg + b.squads[0].prog;

test('Night halves tower range (both sides)', () => {
  const sites = [[0, 'camp', 0, 40], [6, 'tower', 2, 20], [11, 'keep', 2, 40]];
  const shots = (twist) => {
    const b = createBattle(line(sites, twist), P, E);
    issue(b, { type: 'send', owner: 0, from: [0], to: 1, fraction: 0.5 });
    let first = null;
    for (let i = 0; i < 200 && first === null; i++) { step(b, 0.05); if (b.events.some((e) => e.type === 'arrow')) first = progress(b); }
    return first;
  };
  const day = shots(null);
  const night = shots('night');
  assert.ok(day !== null && night !== null);
  assert.ok(night > day + 0.8, `at night the tower fires later on the approach (${day.toFixed(2)} vs ${night.toFixed(2)})`);
});

test('Blizzard slows every march by 30% and makes Firestorm 50% stronger', () => {
  const sites = [[0, 'camp', 0, 40], [11, 'keep', 2, 40]];
  const a = createBattle(line(sites), P, E);
  const b = createBattle(line(sites, 'blizzard'), P, E);
  for (const x of [a, b]) { issue(x, { type: 'send', owner: 0, from: [0], to: 1, fraction: 0.5 }); for (let i = 0; i < 40; i++) step(x, 0.05); }
  assert.ok(Math.abs(progress(b) / progress(a) - FEATURES.blizzard.speed) < 0.03);
  const c = createBattle(line([[0, 'camp', 0, 40], [6, 'village', 2, 30]], 'blizzard'), P, E);
  issue(c, { type: 'power', owner: 0, power: 'firestorm', target: { q: 6, r: 0 } });
  run(c, 1);
  assert.equal(c.sites[1].troops, 30 - 10 * FEATURES.blizzard.firestorm);
});

test('Holy Ground refuses powers but not a General\'s ability', () => {
  const b = createBattle(line([[0, 'camp', 0, 40], [11, 'keep', 2, 40]], 'holy'), { ...P, ability: { id: 'bonus', share: 0.2 } }, E);
  issue(b, { type: 'power', owner: 0, power: 'levy', target: null });
  issue(b, { type: 'ability', owner: 0, ability: 'bonus' });
  step(b, 0.05);
  assert.ok(b.events.some((e) => e.type === 'refused' && e.reason === 'holy'));
  assert.ok(Math.abs(b.sites[0].troops - 48) < 1e-9, 'no Levy (+8), the Bonus (+20%) did fire');
});

test('Flooded: river edges in the region are closed except on road bridges', () => {
  // tiles 0-1 halo, river between tiles 5 and 6 (direction E = 0 / W = 3); a bridge when both carry road bits there
  const make = (bridge) => {
    const a = line([[0, 'camp', 0, 40], [10, 'keep', 2, 5]], 'flooded');
    for (const t of a.tiles) if (t.region === 0) { t.flood = true; t.river = 0; t.road = 0; }
    a.tiles[5].river = 1 << 0;
    a.tiles[6].river = 1 << 3;
    if (bridge) { a.tiles[5].road = 1 << 0; a.tiles[6].road = 1 << 3; }
    return a;
  };
  const closed = createBattle(make(false), P, E);
  assert.equal(routeFor(closed, 0, 0, 1), null, 'no way across');
  const open = createBattle(make(true), P, E);
  assert.ok(canRoute(open, 0, 0, 1), 'the bridge carries the road across');
});

test('Siege: the keep cannot be attacked while its Gate stands; take the Gate, then the keep', () => {
  const b = createBattle(line([[0, 'camp', 0, 200], [9, 'gate', 2, 10], [11, 'keep', 2, 10]], 'siege'), P, E);
  assert.equal(canRoute(b, 0, 0, 2), false, 'the keep is shut');
  assert.equal(canRoute(b, 0, 0, 1), true, 'the Gate can be attacked');
  issue(b, { type: 'send', owner: 0, from: [0], to: 2, fraction: 0.5 });
  step(b, 0.05);
  assert.ok(b.events.some((e) => e.type === 'refused'));
  issue(b, { type: 'send', owner: 0, from: [0], to: 1, fraction: 0.5 });
  run(b, 20);
  assert.equal(b.sites[1].owner, 0, 'the Gate falls');
  assert.equal(canRoute(b, 0, 1, 2), true, 'the keep is open');
  issue(b, { type: 'send', owner: 0, from: [1], to: 2, fraction: 1 });
  run(b, 20);
  assert.equal(b.result, 'win');
  assert.equal(SITE_TYPES.gate.def, 2);
});

test('Raid: hold every Shrine for the hold time to win; losing one resets the clock', () => {
  const sh = (tile, owner) => [tile, 'shrine', owner, owner === 0 ? 30 : 0];
  const b = createBattle(line([[0, 'camp', 0, 40], sh(3, 0), sh(5, 0), sh(7, 2), [11, 'keep', 2, 500]], 'raid'), P, E);
  run(b, 3);
  assert.equal(b.result, null);
  b.sites[3].owner = 0;
  b.sites[3].troops = 10;
  run(b, FEATURES.shrine.holdSec - 1);
  assert.equal(b.result, null);
  b.sites[3].owner = 2; // lost one
  run(b, 2);
  b.sites[3].owner = 0;
  run(b, FEATURES.shrine.holdSec - 0.5);
  assert.equal(b.result, null, 'the clock restarted');
  run(b, 1);
  assert.equal(b.result, 'win');
  assert.ok(b.sites.every((s) => s.owner === 0), 'the region surrendered');
  assert.ok(b.events.some((e) => e.type === 'surrender'));
});

test('a Bandit Camp\'s veterans: its garrison defends and its squads hit at +30% attack and defence', () => {
  const vet = FEATURES.bandit.vet ** 2;
  const b = createBattle(line([[0, 'camp', 0, 60], [6, 'bandit', 2, 20, { defMult: vet, squadPower: vet }], [11, 'keep', 2, 40]]), P, { ...E, graceSec: 0 });
  issue(b, { type: 'send', owner: 2, from: [1], to: 0, fraction: 0.5 });
  step(b, 0.05);
  const sq = b.squads.find((q) => q.owner === 2);
  assert.equal(sq.power, vet);
  // 30 player troops against 20 veterans (20 x 1.2 x 1.69 = 40.6): the camp holds 60, sending 30 fails
  const c = createBattle(line([[0, 'camp', 0, 60], [4, 'bandit', 2, 20, { defMult: vet, squadPower: vet }], [11, 'keep', 2, 40]]), P, E);
  issue(c, { type: 'send', owner: 0, from: [0], to: 1, fraction: 0.5 });
  run(c, 10);
  assert.equal(c.sites[1].owner, 2);
});

test('real arenas carry their region\'s features: Gate, Shrines, Bandit Camp, Ancient Tower, the Dragon', () => {
  const seen = new Set();
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const world = generateWorld(seed);
    for (const region of world.regions.filter((r) => r.type || r.twist)) {
      const state = createGame(seed, world, 0);
      for (const r of world.regions) if (r.tier < region.tier) state.owner[r.id] = 0;
      let arena;
      try { arena = buildArena(world, state.owner, region.id, playerBattleStats(state, world, region.id), enemyBattleStats(world, state, region.id)); } catch { continue; }
      const kinds = arena.sites.map((s) => s.feature).filter(Boolean);
      if (region.twist === 'siege') { assert.ok(kinds.includes('gate')); seen.add('gate'); }
      if (region.twist === 'raid') { assert.equal(kinds.filter((k) => k === 'shrine').length, 3); seen.add('raid'); }
      if (region.type === 'bandit') { assert.ok(kinds.includes('bandit')); seen.add('bandit'); }
      if (region.type === 'ruins') { assert.ok(kinds.includes('ancientTower')); seen.add('ruins'); }
      if (region.type === 'dragon') { assert.ok(arena.dragon && arena.dragon.hp > 0); seen.add('dragon'); }
      if (region.twist && region.twist !== 'flooded') assert.equal(arena.twist, region.twist);
      for (const s of arena.sites.filter((x) => x.feature)) assert.ok(arena.tiles.some((t) => t.i === s.tile), 'on an arena tile');
      const plain = buildArena(world, state.owner, region.id, playerBattleStats(state, world, region.id), enemyBattleStats(world, state, region.id), { noFeatures: true });
      assert.equal(plain.twist, undefined);
    }
  }
  for (const k of ['gate', 'raid', 'bandit', 'ruins', 'dragon']) assert.ok(seen.has(k), `saw a ${k} arena`);
});
