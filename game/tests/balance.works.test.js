// Region Works hooked into the battle numbers and the economy (DESIGN §5.8, docs/briefs/works-hookup.md §8):
// playerBattleStats folds in the Works next to the target, difficulty() sees them, a Market raises income, and the
// War Camp shoots like a tower when Watchtowers stand next door.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYER_FACTION } from '../meta/state.js';
import { playerBattleStats, difficulty } from '../meta/progression.js';
import { incomePerSec, regionIncome } from '../meta/economy.js';
import { worksBattleEffects } from '../meta/works.js';
import { WORKS } from '../config/works.js';
import { CAMP_VOLLEY } from '../config/battle.js';
import { createBattle, step, issue } from '../battle/sim.js';
import { makeWorld, makeGame } from './meta.fixtures.js';

// Fixture world: 0 home (mine) . 1, 2 Free Folk tier 1 . 3 Crimson capital, 4 Crimson tier 2 . 5 Violet capital tier 3
// neighbours: 0:[1,2] 1:[0,3] 2:[0,4] 3:[1,4] 4:[2,3,5] 5:[4]
function realm(own = []) {
  const world = makeWorld();
  const state = makeGame(world, { gold: 0 });
  for (const id of own) state.owner[id] = PLAYER_FACTION;
  state.prosperity = world.regions.map(() => 0);
  return { world, state };
}

test('playerBattleStats(state, world) without a target is the plain army, whatever Works stand', () => {
  const { world, state } = realm([1]);
  const plain = playerBattleStats(state, world);
  state.works = { 0: [{ type: 'barracks', level: 3 }], 1: [{ type: 'stables', level: 2 }] };
  assert.deepEqual(playerBattleStats(state, world), plain);
  assert.equal(plain.campVolleyLevel, 0);
});

test('playerBattleStats(state, world, target) folds in the Works of the owned regions bordering the target', () => {
  const { world, state } = realm([1]); // the player holds 0 and 1; region 3 borders 1, region 2 borders 0
  const plain = playerBattleStats(state, world, 3);
  state.works = {
    1: [{ type: 'barracks', level: 2 }, { type: 'stables', level: 1 }, { type: 'shrine', level: 3 }],
    0: [{ type: 'watchtower', level: 2 }, { type: 'market', level: 3 }], // 0 does not border 3: nothing counts
  };
  const w = playerBattleStats(state, world, 3);
  assert.equal(w.campTroops, plain.campTroops + 2 * WORKS.effects.barracks.perLevel);
  assert.ok(Math.abs(w.speed - plain.speed * (1 + WORKS.effects.stables.perLevel)) < 1e-12);
  assert.ok(Math.abs(w.cooldownMult - plain.cooldownMult * (1 - 3 * WORKS.effects.shrine.perLevel)) < 1e-12);
  assert.equal(w.campVolleyLevel, 0, 'the Watchtower is in a region that does not border the target');
  // the same Works next to a different target
  const toward2 = playerBattleStats(state, world, 2);
  assert.equal(toward2.campTroops, plain.campTroops, 'Barracks in 1 do not help against 2');
  assert.equal(toward2.campVolleyLevel, 2);
  assert.deepEqual(
    { campTroops: w.campTroops, speedMult: w.speed / plain.speed },
    { campTroops: worksBattleEffects(state, world, 3).campTroops + plain.campTroops, speedMult: worksBattleEffects(state, world, 3).speedMult },
  );
});

test('Works stack across bordering regions, and the volley level is capped', () => {
  const { world, state } = realm([1, 2]); // 4 borders 2 and 3, 3 borders 1: use target 4 (neighbours 2, 3, 5) with 2 and 3 owned
  state.owner[3] = PLAYER_FACTION;
  const base = playerBattleStats(state, world, 4);
  state.works = { 2: [{ type: 'barracks', level: 3 }], 3: [{ type: 'barracks', level: 3 }] };
  assert.equal(playerBattleStats(state, world, 4).campTroops, base.campTroops + 2 * 3 * WORKS.effects.barracks.perLevel, 'two level-III Barracks add up');
  state.works = { 2: [{ type: 'watchtower', level: 3 }], 3: [{ type: 'watchtower', level: 3 }] };
  assert.equal(playerBattleStats(state, world, 4).campVolleyLevel, WORKS.caps.campVolleyLevel);
});

test('the difficulty label sees Barracks next door, and only there', () => {
  const { world, state } = realm([]);
  const before = difficulty(state, world, 1);
  state.works = { 0: [{ type: 'barracks', level: 3 }] };
  const after = difficulty(state, world, 1);
  assert.ok(after.power > before.power, 'Army Power rises with the extra War Camp troops');
  assert.ok(after.ratio > before.ratio);
  assert.equal(difficulty(state, world, 5).power, difficulty({ ...state, works: {} }, world, 5).power, 'region 5 does not border the Works');
});

test('a Market raises its own region income by its per-level share and nothing else', () => {
  const { world, state } = realm([1]);
  const base = incomePerSec(state, world);
  state.works = { 1: [{ type: 'market', level: 2 }] };
  const withMarket = incomePerSec(state, world);
  assert.ok(withMarket > base);
  // level 2 in region 1 adds exactly 2 x 8% of that region's share of the realm's income
  const share = regionIncome(world.regions[1]) / (regionIncome(world.regions[0]) + regionIncome(world.regions[1]));
  assert.ok(Math.abs(withMarket / base - (1 + 2 * WORKS.effects.market.perLevel * share)) < 1e-9, `${withMarket / base}`);
  state.works = { 3: [{ type: 'market', level: 3 }] }; // a region the player does not own
  assert.equal(incomePerSec(state, world), base);
});

// --- the camp volley ----------------------------------------------------------------------------------------

const PLAYER = (level) => ({
  atk: 1, def: 1, growth: 0, speed: 1, campTroops: 40, garrisonShare: 0.35, capBonus: 0, cooldownMult: 1,
  campVolleyLevel: level, powers: { rally: 0, firestorm: 0, bulwark: 0, march: 0, levy: 0 },
});
// a slow enemy: its squad spends a long time inside the camp's arrow range, so the volley cadence can be counted
const ENEMY = { atk: 1, def: 1, growth: 0, speed: 0.15, troopMult: 1, thinkSec: 2, personality: 'aggressive', factionId: 2 };

function volleyBattle(level) {
  const tiles = [];
  for (let q = 0; q < 9; q++) tiles.push({ i: q, q, r: 0, x: q * Math.sqrt(3), y: 0, cost: 1, terrain: 'grass', region: 0 });
  const arena = {
    regionId: 0, enemyFaction: 2, tiles,
    sites: [
      { id: 0, settlement: -1, tile: 0, type: 'camp', owner: 0, troops: 40 },
      { id: 1, settlement: 0, tile: 8, type: 'keep', owner: 2, troops: 300 },
    ],
    focus: { minX: 0, maxX: 8 * Math.sqrt(3), minY: 0, maxY: 0 },
  };
  return createBattle(arena, PLAYER(level), ENEMY);
}

/** An enemy squad marches from the keep to the camp; returns the arrows the camp loosed and their times. */
function campArrows(level, seconds = 55) {
  const battle = volleyBattle(level);
  issue(battle, { type: 'send', owner: 2, from: [1], to: 0, fraction: 0.2 }); // 60 troops: they will not arrive in time to matter
  const arrows = [];
  for (let i = 0; i < seconds / 0.05; i++) {
    step(battle, 0.05);
    for (const e of battle.events) if (e.type === 'arrow') arrows.push({ t: battle.t, site: e.site });
  }
  return { arrows, battle };
}

test('camp volley: level 0 shoots nothing', () => {
  assert.equal(campArrows(0).arrows.length, 0);
});

test('camp volley: the War Camp looses arrows at the nearest enemy squad in range, faster at higher levels', () => {
  const counts = [1, 2, 3].map((level) => campArrows(level).arrows.filter((a) => a.site === 0).length);
  assert.ok(counts[0] > 0, 'level I shoots');
  assert.ok(counts[0] < counts[1] && counts[1] < counts[2], `arrows per fight by level ${counts}`);
  // the gap between two volleys is the configured one
  const a = campArrows(2).arrows;
  assert.ok(Math.abs(a[1].t - a[0].t - CAMP_VOLLEY.volleySec[1]) < 0.06, `gap ${a[1].t - a[0].t}`);
});

test('camp volley: each arrow costs the squad `kills x attack`, and a camp with no troops does not shoot', () => {
  const { arrows, battle } = campArrows(3, 50);
  assert.ok(arrows.length >= 5);
  assert.equal(battle.squads[0].count, 60 - arrows.length, 'one troop lost per arrow at attack 1');
  const empty = volleyBattle(3);
  empty.sites[0].troops = 0;
  issue(empty, { type: 'send', owner: 2, from: [1], to: 0, fraction: 0.2 });
  let shots = 0;
  for (let i = 0; i < 200; i++) { step(empty, 0.05); shots += empty.events.filter((e) => e.type === 'arrow').length; }
  assert.equal(shots, 0);
});

test('camp volley: an enemy-held camp never shoots, and a save without campVolleyLevel is fine', () => {
  const battle = volleyBattle(3);
  battle.sites[0].owner = 2; // the camp was taken
  issue(battle, { type: 'send', owner: 2, from: [1], to: 1, fraction: 0.2 });
  for (let i = 0; i < 100; i++) step(battle, 0.05);
  assert.equal(battle.events.filter((e) => e.type === 'arrow').length, 0);
  const old = volleyBattle(0);
  delete old.player.campVolleyLevel;
  for (let i = 0; i < 40; i++) step(old, 0.05);
  assert.equal(old.result, null);
});

// --- Barracks grow the camp faster, Stables make supply lines fire sooner --------------------------------------------

import { SUPPLY } from '../config/battle.js';

test('Barracks add camp growth and Stables shorten the supply interval, stacking and capped', () => {
  const { world, state } = realm([1, 2]);
  state.owner[3] = PLAYER_FACTION;
  const none = worksBattleEffects(state, world, 4);
  assert.equal(none.campGrowthMult, 1);
  assert.equal(none.supplyIntervalMult, 1);
  state.works = { 2: [{ type: 'barracks', level: 2 }, { type: 'stables', level: 1 }], 3: [{ type: 'barracks', level: 1 }] };
  const fx = worksBattleEffects(state, world, 4); // region 4 borders 2, 3 and 5
  assert.ok(Math.abs(fx.campGrowthMult - (1 + 3 * WORKS.effects.barracks.growthPerLevel)) < 1e-12);
  assert.ok(Math.abs(fx.supplyIntervalMult - (1 - WORKS.effects.stables.supplyPerLevel)) < 1e-12);
  state.works = { 2: [{ type: 'barracks', level: 3 }, { type: 'stables', level: 3 }], 3: [{ type: 'barracks', level: 3 }, { type: 'stables', level: 3 }], 5: [{ type: 'barracks', level: 3 }] };
  state.owner[5] = PLAYER_FACTION;
  const capped = worksBattleEffects(state, world, 4);
  assert.equal(capped.campGrowthMult, WORKS.caps.campGrowthMult);
  assert.equal(capped.supplyIntervalMult, WORKS.caps.supplyIntervalFloor);
  const stats = playerBattleStats(state, world, 4);
  assert.equal(stats.campGrowthMult, capped.campGrowthMult);
  assert.equal(stats.supplyIntervalMult, capped.supplyIntervalMult);
  assert.equal(playerBattleStats(state, world).campGrowthMult, 1, 'no target, no Works');
});

test('sim: the player\'s War Camp grows by campGrowthMult, nobody else\'s does', () => {
  const build = (mult) => {
    const b = volleyBattle(0);
    b.player.campGrowthMult = mult;
    return createBattle({ ...b.arena, tiles: b.arena.tiles, sites: b.arena.sites, focus: b.arena.focus }, { ...b.player, campGrowthMult: mult, growth: 1 }, { ...b.enemy, growth: 1 });
  };
  const plain = build(1);
  const boosted = build(1.5);
  assert.ok(Math.abs(boosted.sites[0].growth - 1.5 * plain.sites[0].growth) < 1e-12);
  assert.equal(boosted.sites[1].growth, plain.sites[1].growth, 'the enemy keep is untouched');
  boosted.sites[0].troops = 10;
  plain.sites[0].troops = 10;
  for (let i = 0; i < 100; i++) { step(boosted, 0.05); step(plain, 0.05); }
  assert.ok(boosted.sites[0].troops - 10 > 1.4 * (plain.sites[0].troops - 10), 'and it really produces more');
});

test('sim: supply lines fire sooner by supplyIntervalMult (the player\'s only)', () => {
  const thirdSend = (mult) => {
    const tiles = [];
    for (let q = 0; q < 10; q++) tiles.push({ i: q, q, r: 0, x: q * Math.sqrt(3), y: 0, cost: 1, terrain: 'grass', region: q < 2 ? 1 : 0, ...(q < 2 ? { own: 0 } : {}) });
    const arena = {
      regionId: 0, enemyFaction: 2, tiles,
      sites: [{ id: 0, settlement: -1, tile: 0, type: 'camp', owner: 0, troops: 400 }, { id: 1, settlement: 0, tile: 5, type: 'village', owner: 0, troops: 0 }, { id: 2, settlement: 1, tile: 9, type: 'keep', owner: 2, troops: 50 }],
      focus: { minX: 0, maxX: 14, minY: 0, maxY: 0 },
    };
    const battle = createBattle(arena, { ...PLAYER(0), supplyIntervalMult: mult }, ENEMY);
    issue(battle, { type: 'supply', owner: 0, from: 0, to: 1 });
    let n = 0;
    for (let i = 0; i < 40 / 0.05; i++) {
      step(battle, 0.05);
      n += battle.events.filter((e) => e.type === 'send' && e.auto).length;
      if (n >= 3) return battle.t;
    }
    return Infinity;
  };
  const plain = thirdSend(1);
  const fast = thirdSend(0.5);
  assert.ok(Math.abs(plain - 2 * SUPPLY.intervalSec) < 0.2, `the third send of a line comes after two intervals: ${plain} s`);
  assert.ok(Math.abs(fast - SUPPLY.intervalSec) < 0.2, `with half the interval it comes twice as soon: ${fast} s`);
});

// --- the Stables' charge ------------------------------------------------------------------------------------------

import { squadPerTroopStrength } from '../battle/combat.js';

test('Stables add field strength per level, stacking and capped, and only for the player\'s squads in clashes', () => {
  const { world, state } = realm([1, 2]);
  state.owner[3] = PLAYER_FACTION;
  assert.equal(worksBattleEffects(state, world, 4).fieldStrengthMult, 1);
  state.works = { 2: [{ type: 'stables', level: 2 }], 3: [{ type: 'stables', level: 1 }] };
  const fx = worksBattleEffects(state, world, 4);
  assert.ok(Math.abs(fx.fieldStrengthMult - (1 + 3 * WORKS.effects.stables.fieldPerLevel)) < 1e-12);
  state.works = { 2: [{ type: 'stables', level: 3 }], 3: [{ type: 'stables', level: 3 }] };
  assert.equal(worksBattleEffects(state, world, 4).fieldStrengthMult, Math.min(WORKS.caps.fieldStrengthMult, 1 + 6 * WORKS.effects.stables.fieldPerLevel));
  assert.equal(playerBattleStats(state, world, 4).fieldStrengthMult, worksBattleEffects(state, world, 4).fieldStrengthMult);
  const p = { atk: 1.2, def: 1.1, fieldStrengthMult: 1.3 };
  const e = { atk: 2, def: 2 };
  assert.equal(squadPerTroopStrength(0, p, 2, e, true), 1.2 * 1.1 * 1.3, 'the charge in a clash');
  assert.equal(squadPerTroopStrength(0, p, 2, e), 1.2 * 1.1, 'not in an assault on a settlement');
  assert.equal(squadPerTroopStrength(2, p, 2, e, true), 4, 'never for the enemy');
  assert.equal(squadPerTroopStrength(0, { atk: 1, def: 1 }, 2, e, true), 1, 'a save without the field is fine');
});

test('sim: a squad clash is won by the charge, an assault is not', () => {
  const clash = (mult) => {
    const tiles = [];
    for (let q = 0; q < 9; q++) tiles.push({ i: q, q, r: 0, x: q * Math.sqrt(3), y: 0, cost: 1, terrain: 'grass', region: 0 });
    const arena = {
      regionId: 0, enemyFaction: 2, tiles,
      sites: [{ id: 0, settlement: -1, tile: 0, type: 'camp', owner: 0, troops: 100 }, { id: 1, settlement: 0, tile: 8, type: 'keep', owner: 2, troops: 100 }],
      focus: { minX: 0, maxX: 14, minY: 0, maxY: 0 },
    };
    const battle = createBattle(arena, { ...PLAYER(0), fieldStrengthMult: mult }, { ...ENEMY, speed: 1 });
    // two squads of 40 meet head on between the camp and the keep
    battle.squads.push({ id: battle.nextId++, owner: 0, count: 40, from: 0, to: 1, path: [1, 2, 3, 4, 5, 6, 7, 8], seg: 3, prog: 0, state: 'march', foe: null });
    battle.squads.push({ id: battle.nextId++, owner: 2, count: 40, from: 1, to: 0, path: [7, 6, 5, 4, 3, 2, 1, 0], seg: 3, prog: 0, state: 'march', foe: null });
    for (let i = 0; i < 400 && battle.squads.length > 1; i++) step(battle, 0.05); // until one of them is gone
    return battle.squads.filter((sq) => sq.owner === 0).reduce((n, sq) => n + sq.count, 0);
  };
  assert.ok(clash(1.4) > clash(1) + 5, `the charge leaves more of the squad alive (${clash(1.4).toFixed(1)} against ${clash(1).toFixed(1)})`);
});
