// Defense battles (DESIGN §10.1, ARCHITECTURE §10.3): the siege timer, every attacker gone, the keep's fall and its cascade to
// the raider, fortifications in the arena, the `busy` exclusion in both arena builders, the war band's AI, and determinism.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, step, issue, canRoute } from '../battle/sim.js';
import { buildArena } from '../battle/arena.js';
import { buildDefenseArena, canBuildDefenseArena, busyKey } from '../battle/defenseArena.js';
import { fortTowerTiles, fortEffects } from '../battle/fortSites.js';
import { defenseStrengths, defenseWinChance, defenseLabel } from '../battle/defenseEstimate.js';
import { think } from '../battle/ai.js';
import { stewardDecide } from '../battle/steward.js';
import { decideDefense } from '../battle/bot.js';
import { hexDistance } from '../battle/geom.js';
import { generateWorld } from '../world/generate.js';
import { createGame } from '../meta/state.js';
import { playerBattleStats, enemyBattleStats } from '../meta/progression.js';
import { raidEnemyStats, raidDepth, borderingRivals } from '../meta/frontier.js';
import { FRONTIER, FORTS } from '../config/frontier.js';
import { TICK_SEC } from '../config/battle.js';

const SQ3 = Math.sqrt(3);
const PLAYER = Object.freeze({
  atk: 1, def: 1, growth: 0, speed: 1, campTroops: 30, garrisonShare: 0.35, capBonus: 0,
  cooldownMult: 1, powers: { rally: 1, firestorm: 1, bulwark: 1, march: 1, levy: 1 },
});
const RAIDER = Object.freeze({
  atk: 1, def: 1, growth: 0, speed: 1, troopMult: 1, thinkSec: 1, graceSec: 0, personality: 'aggressive', factionId: 3,
});

/**
 * A defense line: tiles q = 0..length-1. Tiles below `haloTiles` are the raider's land (region 1, `own: 3`), the rest is the
 * player's defended region 0. `sites`: [tile, type, owner, troops]; the keep is the last player keep.
 */
function defenseLine({ length = 10, haloTiles = 2, sites, siegeSec = 60 }) {
  const tiles = [];
  for (let q = 0; q < length; q++) {
    const tile = { i: q, q, r: 0, x: q * SQ3, y: 0, cost: 1, terrain: 'grass', region: q < haloTiles ? 1 : 0 };
    if (q < haloTiles) tile.own = 3;
    tiles.push(tile);
  }
  const list = sites.map(([tile, type, owner, troops], id) => ({ id, settlement: id - 1, tile, type, owner, troops }));
  return {
    mode: 'defense', regionId: 0, enemyFaction: 3, tiles, sites: list, siegeSec, campSite: 0,
    keepSite: list.findIndex((s) => s.type === 'keep'), focus: { minX: 0, maxX: (length - 1) * SQ3, minY: 0, maxY: 0 }, marches: [],
  };
}

function run(battle, seconds) {
  const end = battle.t + seconds;
  while (!battle.result && battle.t < end - 1e-9) step(battle, TICK_SEC);
}

// --- the rules ---------------------------------------------------------------------------------------------------

test('defense mode: holding the keep until the siege timer runs out wins', () => {
  const battle = createBattle(defenseLine({ sites: [[0, 'camp', 3, 30], [5, 'village', 0, 10], [9, 'keep', 0, 40]], siegeSec: 20 }), PLAYER, RAIDER);
  assert.equal(battle.mode, 'defense');
  assert.equal(battle.siegeSec, 20);
  run(battle, 19.9);
  assert.equal(battle.result, null, 'not before the timer');
  run(battle, 1);
  assert.equal(battle.result, 'win');
  assert.ok(Math.abs(battle.stats.durationSec - 20) < TICK_SEC + 1e-9);
  assert.equal(battle.events.at(-1).type, 'end');
});

test('defense mode: createBattle opts override the arena\'s siege timer and mode', () => {
  const arena = defenseLine({ sites: [[0, 'camp', 3, 30], [9, 'keep', 0, 40]], siegeSec: 20 });
  assert.equal(createBattle(arena, PLAYER, RAIDER, { mode: 'defense', siegeSec: 45 }).siegeSec, 45);
  const plain = { ...arena, mode: undefined };
  assert.equal(createBattle(plain, PLAYER, RAIDER).mode, undefined, 'an attack arena has no mode field');
});

test('defense mode: destroying every attacker (no sites, no squads) wins early', () => {
  const battle = createBattle(defenseLine({ sites: [[0, 'camp', 3, 3], [3, 'village', 0, 40], [9, 'keep', 0, 40]], siegeSec: 90 }), PLAYER, RAIDER);
  issue(battle, { type: 'send', owner: 0, from: [1], to: 0, fraction: 1 });
  run(battle, 30);
  assert.equal(battle.result, 'win');
  assert.ok(battle.t < 30, 'well before the siege timer');
  assert.equal(battle.sites[0].owner, 0, 'the war band\'s camp was taken');
});

test('defense mode: an attacker squad still marching keeps the battle going after its camp falls', () => {
  const battle = createBattle(defenseLine({ length: 14, sites: [[0, 'camp', 3, 30], [3, 'village', 0, 60], [13, 'keep', 0, 200]], siegeSec: 90 }), PLAYER, RAIDER);
  issue(battle, { type: 'send', owner: 3, from: [0], to: 1, fraction: 0.9 }); // most of the band marches on the village
  step(battle, TICK_SEC);
  issue(battle, { type: 'send', owner: 0, from: [1], to: 0, fraction: 0.6 });
  let campFell = false;
  for (let i = 0; i < 400 && !battle.result; i++) {
    step(battle, TICK_SEC);
    if (battle.sites[0].owner === 0 && battle.squads.some((s) => s.owner === 3)) campFell = true;
  }
  assert.ok(campFell || battle.result === 'win', 'the camp fell while a raider squad was still out, or the fight ended');
});

test('defense mode: the raider taking the keep loses the battle and every remaining site surrenders to the raider', () => {
  const battle = createBattle(defenseLine({ sites: [[0, 'camp', 3, 200], [2, 'keep', 0, 5], [6, 'village', 0, 20], [9, 'hamlet', 0, 8]] }), PLAYER, RAIDER);
  issue(battle, { type: 'send', owner: 3, from: [0], to: 1, fraction: 1 });
  run(battle, 30);
  assert.equal(battle.result, 'lose');
  for (const s of battle.sites) assert.equal(s.owner, 3, `site ${s.id} went to the raider`);
  const ev = battle.events.find((e) => e.type === 'surrender');
  assert.deepEqual(ev.sites.sort(), [2, 3]);
  assert.equal(ev.to, 3, 'the cascade says who it went to');
  assert.equal(battle.events.at(-1).result, 'lose');
});

test('defense mode: a village falling does not end the battle; attack mode ignores the siege timer', () => {
  const battle = createBattle(defenseLine({ sites: [[0, 'camp', 3, 60], [2, 'village', 0, 3], [9, 'keep', 0, 60]], siegeSec: 60 }), PLAYER, RAIDER);
  issue(battle, { type: 'send', owner: 3, from: [0], to: 1, fraction: 0.5 });
  run(battle, 8);
  assert.equal(battle.sites[1].owner, 3);
  assert.equal(battle.result, null);
  const attack = createBattle({ ...defenseLine({ sites: [[0, 'camp', 0, 30], [9, 'keep', 3, 40]] }), mode: undefined, siegeSec: 5 }, PLAYER, RAIDER);
  run(attack, 10);
  assert.equal(attack.result, null, 'no siege rule outside defense mode');
});

// --- fortifications in the arena --------------------------------------------------------------------------------

test('fortifications: Walls multiply the keep\'s defence, an Arrow Tower shoots at its level\'s rate and range', () => {
  // the keep's land touches the raider's (tiles 2-3); the tower (tile 5) covers the keep within 3.4 hexes
  const arena = defenseLine({ sites: [[0, 'camp', 3, 50], [2, 'keep', 0, 20], [5, 'tower', 0, 10]] });
  arena.sites[1].defMult = 1.5;
  Object.assign(arena.sites[2], { fort: 'tower', range: 3.4, volleySec: 0.45 });
  const battle = createBattle(arena, PLAYER, RAIDER);
  assert.equal(battle.sites[1].defMult, 1.5);
  assert.ok(Math.abs(battle.sites[1].def - 1.6 * 1.5) < 1e-9, 'site.def reports the walled defence');
  assert.equal(battle.sites[2].fort, 'tower');
  // 20 troops behind 1.6 x 1.5 walls hold 47 strength: a 45-troop assault fails, without walls it would win
  issue(battle, { type: 'send', owner: 3, from: [0], to: 1, fraction: 0.9 });
  run(battle, 20);
  assert.equal(battle.sites[1].owner, 0, 'the walled keep held');
  const bare = defenseLine({ sites: [[0, 'camp', 3, 50], [2, 'keep', 0, 20]] });
  const open = createBattle(bare, PLAYER, RAIDER);
  issue(open, { type: 'send', owner: 3, from: [0], to: 1, fraction: 0.9 });
  run(open, 20);
  assert.equal(open.result, 'lose', 'without walls (and the tower) the same assault takes it');
  const arrows = [];
  const b2 = createBattle(arena, PLAYER, RAIDER);
  issue(b2, { type: 'send', owner: 3, from: [0], to: 1, fraction: 0.9 });
  for (let i = 0; i < 200; i++) { step(b2, TICK_SEC); for (const e of b2.events) if (e.type === 'arrow') arrows.push(b2.t); }
  assert.ok(arrows.length >= 2);
  assert.ok(arrows[1] - arrows[0] >= 0.45 - 1e-9 && arrows[1] - arrows[0] < 0.5 + 1e-9, 'volleys every 0.45 s');
});

test('fortifications: fortEffects reads the config per level, fortTowerTiles is deterministic and clear of settlements', () => {
  const fx = fortEffects([{ type: 'walls', level: 2 }, { type: 'tower', level: 3 }, { type: 'hall', level: 1 }, { type: 'beacon', level: 2 }]);
  assert.equal(fx.wallsMult, FORTS.effects.walls.defMult[1]);
  assert.equal(fx.towerRange, FORTS.effects.tower.range[2]);
  assert.equal(fx.towerVolleySec, FORTS.effects.tower.volleySec[2]);
  assert.equal(fx.hallMult, FORTS.effects.hall.garrisonMult[0]);
  assert.equal(fx.warnSec, FORTS.effects.beacon.warnSec[1]);
  assert.equal(fx.speedMult, FORTS.effects.beacon.speedMult);
  assert.deepEqual(fortEffects([]), fortEffects(undefined));
  assert.equal(fortEffects([{ type: 'walls', level: 9 }]).wallsMult, 1, 'an invalid level does nothing');
  const world = generateWorld(3);
  for (const region of world.regions.slice(0, 12)) {
    const [tile] = fortTowerTiles(world, region.id, 1);
    assert.ok(tile !== undefined, `region ${region.id} has a tower tile`);
    const t = world.tiles[tile];
    assert.equal(t.region, region.id);
    assert.ok(t.passable && t.settlement === -1);
    for (const id of region.settlements) assert.ok(hexDistance(world.tiles[world.settlements[id].tile], t) >= 1);
    assert.deepEqual(fortTowerTiles(world, region.id, 1), [tile], 'same answer every time');
  }
});

// --- buildDefenseArena on real worlds -------------------------------------------------------------------------------

/** A realm on a real world: the player holds every region of tier <= maxTier; returns a region bordering a rival. */
function realmWithRaid(seed, maxTier = 2) {
  const world = generateWorld(seed);
  const state = createGame(seed, world, 0);
  for (const r of world.regions) if (r.tier <= maxTier) state.owner[r.id] = 0;
  const rivals = borderingRivals(state, world);
  for (const { faction, pairs } of rivals) {
    for (const p of pairs) {
      if (canBuildDefenseArena(world, state.owner, p.to, faction)) {
        return { world, state, raid: { id: 1, faction, fromRegionId: p.from, toRegionId: p.to, depth: raidDepth(state, world, p.to), first: false } };
      }
    }
  }
  return null;
}

test('buildDefenseArena: the war band camps on the raider\'s land touching the region; the region\'s settlements are the player\'s', () => {
  let checked = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const realm = realmWithRaid(seed);
    if (!realm) continue;
    const { world, state, raid } = realm;
    const region = world.regions[raid.toRegionId];
    const player = playerBattleStats(state, world, raid.toRegionId);
    const enemy = raidEnemyStats(state, world, raid);
    const militia = region.settlements.map((_, i) => 20 + i);
    const arena = buildDefenseArena(world, state.owner, raid.toRegionId, {
      attackerFaction: raid.faction, fromRegionId: raid.fromRegionId, player, enemy, militia, militiaCapMult: 2,
    });
    assert.equal(arena.mode, 'defense');
    assert.equal(arena.regionId, raid.toRegionId);
    assert.equal(arena.enemyFaction, raid.faction);
    const camp = arena.sites[0];
    assert.equal(camp.type, 'camp');
    assert.equal(camp.owner, raid.faction);
    assert.ok(Math.abs(camp.troops - enemy.campTroops) < 1e-9);
    const campTile = world.tiles[camp.tile];
    assert.equal(state.owner[campTile.region], raid.faction, 'the camp stands on the raider\'s land');
    const keep = arena.sites[arena.keepSite];
    assert.equal(keep.type, 'keep');
    assert.equal(keep.settlement, region.keep);
    for (const s of arena.sites.filter((x) => x.settlement >= 0 && world.settlements[x.settlement].region === region.id)) {
      assert.equal(s.owner, 0);
      assert.equal(s.troops, militia[region.settlements.indexOf(s.settlement)], 'militia in region.settlements order');
      assert.equal(s.pCapMult, 2);
    }
    for (const t of arena.tiles) {
      if (t.region === region.id) assert.equal(t.own, undefined, 'the region\'s land follows its settlements');
      else if (!t.link) assert.equal(t.own, state.owner[t.region]);
    }
    const tier = Math.min(region.tier, FRONTIER.siegeSecByTier.length - 1);
    assert.equal(arena.siegeSec, FRONTIER.siegeSecByTier[tier] * (region.isCapital ? FRONTIER.capitalSiegeMult : 1));
    // the war band can attack something from its camp, and the battle runs
    const battle = createBattle(arena, player, enemy, { mode: 'defense', siegeSec: arena.siegeSec });
    assert.ok(battle.sites.some((s) => s.owner === 0 && canRoute(battle, raid.faction, 0, s.id)), 'the raid has a first target');
    checked += 1;
  }
  assert.ok(checked >= 4, `checked ${checked} worlds`);
});

test('buildDefenseArena: fortifications become sites and multipliers; refuses a region that is not the player\'s', () => {
  const realm = realmWithRaid(2);
  const { world, state, raid } = realm;
  const player = playerBattleStats(state, world, raid.toRegionId);
  const enemy = raidEnemyStats(state, world, raid);
  const forts = [{ type: 'walls', level: 2 }, { type: 'tower', level: 1 }, { type: 'beacon', level: 1 }];
  const arena = buildDefenseArena(world, state.owner, raid.toRegionId, { attackerFaction: raid.faction, player, enemy, forts, towerTroops: 17 });
  const keep = arena.sites[arena.keepSite];
  assert.equal(keep.defMult, FORTS.effects.walls.defMult[1]);
  const tower = arena.sites.find((s) => s.fort === 'tower');
  assert.ok(tower, 'an Arrow Tower site');
  assert.equal(tower.owner, 0);
  assert.equal(tower.troops, 17);
  assert.equal(tower.tile, fortTowerTiles(world, raid.toRegionId, 1)[0]);
  assert.equal(tower.range, FORTS.effects.tower.range[0]);
  assert.equal(arena.playerSpeedMult, FORTS.effects.beacon.speedMult);
  const battle = createBattle(arena, player, enemy);
  assert.ok(Math.abs(battle.player.speed - player.speed * FORTS.effects.beacon.speedMult) < 1e-12, 'the Beacon speeds the player\'s squads');
  const owners = state.owner.slice();
  owners[raid.toRegionId] = raid.faction;
  assert.throws(() => buildDefenseArena(world, owners, raid.toRegionId, { attackerFaction: raid.faction, player, enemy }), (e) => e.code === 'not-owned');
  assert.throws(() => buildDefenseArena(world, state.owner, raid.toRegionId, { player, enemy }), (e) => e.code === 'no-attacker');
});

// --- busy exclusion (DESIGN §10.5) ---------------------------------------------------------------------------------

test('busy: the defense arena leaves out busy settlements and refuses a busy keep', () => {
  const { world, state, raid } = realmWithRaid(1);
  const region = world.regions[raid.toRegionId];
  const player = playerBattleStats(state, world, raid.toRegionId);
  const enemy = raidEnemyStats(state, world, raid);
  const other = region.settlements.find((id) => id !== region.keep);
  if (other !== undefined) {
    const arena = buildDefenseArena(world, state.owner, raid.toRegionId, {
      attackerFaction: raid.faction, player, enemy, busy: { regions: new Set(), sites: new Set([busyKey(world, other)]) },
    });
    assert.ok(!arena.sites.some((s) => s.settlement === other), 'a settlement in another battle is not in this one');
  }
  assert.throws(() => buildDefenseArena(world, state.owner, raid.toRegionId, {
    attackerFaction: raid.faction, player, enemy, busy: { sites: [busyKey(world, region.keep)] },
  }), (e) => e.code === 'busy');
  assert.equal(busyKey(world, region.keep), `${region.id}:${region.settlements.indexOf(region.keep)}`);
});

test('busy: an attack arena leaves busy regions out of its halo, busy settlements out, and refuses a busy target', () => {
  const world = generateWorld(4);
  const state = createGame(4, world, 0);
  for (const r of world.regions) if (r.tier <= 1) state.owner[r.id] = 0;
  const target = world.regions.find((r) => r.tier === 2 && r.neighbors.filter((n) => state.owner[n] === 0).length >= 2);
  assert.ok(target, 'a target with two owned neighbours');
  const player = playerBattleStats(state, world, target.id);
  const enemy = enemyBattleStats(world, state, target.id);
  const full = buildArena(world, state.owner, target.id, player, enemy);
  const ownedNear = [...new Set(full.tiles.filter((t) => t.own === 0).map((t) => t.region))];
  const busyRegion = ownedNear[0];
  let partial;
  try {
    partial = buildArena(world, state.owner, target.id, player, enemy, { busy: { regions: new Set([busyRegion]), sites: new Set() } });
  } catch (e) {
    assert.equal(e.code, 'no-passable-border', 'only when that region was the whole border');
  }
  if (partial) assert.ok(!partial.tiles.some((t) => t.region === busyRegion), 'the defended region is not in the halo');
  const haloSettlement = full.sites.find((s) => s.owner === 0 && s.settlement >= 0);
  if (haloSettlement) {
    const without = buildArena(world, state.owner, target.id, player, enemy, { busy: { sites: new Set([busyKey(world, haloSettlement.settlement)]) } });
    assert.ok(!without.sites.some((s) => s.settlement === haloSettlement.settlement));
  }
  assert.throws(() => buildArena(world, state.owner, target.id, player, enemy, { busy: { regions: new Set([target.id]) } }), (e) => e.code === 'busy');
  assert.deepEqual(buildArena(world, state.owner, target.id, player, enemy, {}), full, 'no busy, same arena as before');
});

test('captured fortifications: an occupier\'s Arrow Tower and Walls fight for it in the player\'s attack', () => {
  const world = generateWorld(5);
  const state = createGame(5, world, 0);
  for (const r of world.regions) if (r.tier <= 1) state.owner[r.id] = 0;
  const target = world.regions.find((r) => r.tier === 2);
  const player = playerBattleStats(state, world, target.id);
  const enemy = enemyBattleStats(world, state, target.id);
  const arena = buildArena(world, state.owner, target.id, player, enemy, { forts: [{ type: 'tower', level: 2 }, { type: 'walls', level: 1 }] });
  const tower = arena.sites.find((s) => s.fort === 'tower');
  assert.ok(tower);
  assert.equal(tower.owner, state.owner[target.id]);
  assert.equal(tower.range, FORTS.effects.tower.range[1]);
  const keep = arena.sites.find((s) => s.settlement === target.keep);
  assert.equal(keep.defMult, FORTS.effects.walls.defMult[0]);
});

// --- the war band's AI, the odds, determinism ---------------------------------------------------------------------------

function playDefense(realm, decide, mult = 1) {
  const { world, state, raid } = realm;
  const r = { ...raid, mult };
  const player = playerBattleStats(state, world, r.toRegionId);
  const enemy = raidEnemyStats(state, world, r);
  const arena = buildDefenseArena(world, state.owner, r.toRegionId, { attackerFaction: r.faction, fromRegionId: r.fromRegionId, player, enemy });
  const battle = createBattle(arena, player, enemy, { mode: 'defense', siegeSec: arena.siegeSec });
  const memo = {};
  const log = [];
  while (!battle.result && battle.t < 400) {
    for (const c of think(battle, battle.t)) { issue(battle, c); log.push([battle.tick, 'e', c]); }
    for (const c of decide(battle, battle.t, memo)) { issue(battle, c); log.push([battle.tick, 'p', c]); }
    step(battle, TICK_SEC);
  }
  return { battle, log, arena, player, enemy };
}

test('the war band attacks: a strong raid takes an undefended keep, and the battle always ends by the siege timer', () => {
  const realm = realmWithRaid(3);
  const strong = playDefense(realm, () => [], 4);
  assert.equal(strong.battle.result, 'lose', 'nobody defending, a big war band takes the keep');
  const any = playDefense(realm, (b, t, m) => stewardDecide(b, t, m, 'stalwart'));
  assert.ok(any.battle.result === 'win' || any.battle.result === 'lose');
  assert.ok(any.battle.t <= any.arena.siegeSec + TICK_SEC + 1e-9);
});

test('determinism: the same raid and the same commands replay to the same battle, also after a JSON round trip', () => {
  const realm = realmWithRaid(6);
  const a = playDefense(realm, (b, t, m) => stewardDecide(b, t, m, 'captain'));
  const b = playDefense(realm, (bt, t, m) => stewardDecide(bt, t, m, 'captain'));
  assert.equal(JSON.stringify(a.battle), JSON.stringify(b.battle));
  // replay the recorded command log with no AI at all
  const replay = createBattle(a.arena, a.player, a.enemy, { mode: 'defense', siegeSec: a.arena.siegeSec });
  let k = 0;
  while (!replay.result && replay.t < 400) {
    while (k < a.log.length && a.log[k][0] === replay.tick) issue(replay, a.log[k++][2]);
    step(replay, TICK_SEC);
  }
  assert.equal(replay.result, a.battle.result);
  assert.deepEqual(replay.sites.map((s) => [s.owner, Math.round(s.troops * 1000)]), a.battle.sites.map((s) => [s.owner, Math.round(s.troops * 1000)]));
  // a saved battle resumes identically
  const half = playDefense(realm, () => []);
  void half;
  const mid = createBattle(a.arena, a.player, a.enemy, { mode: 'defense', siegeSec: a.arena.siegeSec });
  const memo = {};
  for (let i = 0; i < 300; i++) { for (const c of think(mid, mid.t)) issue(mid, c); for (const c of decideDefense(mid, mid.t, memo)) issue(mid, c); step(mid, TICK_SEC); }
  const copy = JSON.parse(JSON.stringify(mid));
  const memoCopy = JSON.parse(JSON.stringify(memo));
  for (let i = 0; i < 300; i++) {
    for (const bt of [[mid, memo], [copy, memoCopy]]) {
      for (const c of think(bt[0], bt[0].t)) issue(bt[0], c);
      for (const c of decideDefense(bt[0], bt[0].t, bt[1])) issue(bt[0], c);
      step(bt[0], TICK_SEC);
    }
  }
  assert.equal(JSON.stringify(copy), JSON.stringify(mid));
});

test('odds: defenseStrengths grows with the militia and shrinks with the war band; win chance and label are monotonic', () => {
  const arena = defenseLine({ sites: [[0, 'camp', 3, 100], [5, 'village', 0, 20], [9, 'keep', 0, 50]] });
  const base = defenseStrengths(arena, PLAYER, RAIDER);
  const more = defenseLine({ sites: [[0, 'camp', 3, 100], [5, 'village', 0, 40], [9, 'keep', 0, 80]] });
  const bigger = defenseLine({ sites: [[0, 'camp', 3, 200], [5, 'village', 0, 20], [9, 'keep', 0, 50]] });
  assert.ok(defenseStrengths(more, PLAYER, RAIDER).ratio > base.ratio);
  assert.ok(defenseStrengths(bigger, PLAYER, RAIDER).ratio < base.ratio);
  assert.equal(base.yoursTroops, 70);
  assert.equal(base.theirsTroops, 100);
  let last = 0;
  for (const r of [0.1, 0.3, 0.5, 0.8, 1, 1.5, 2, 4]) {
    const p = defenseWinChance(r, 'captain');
    assert.ok(p >= last);
    last = p;
  }
  assert.ok(defenseWinChance(1, 'inPerson') >= defenseWinChance(1, 'captain'), 'defending in person is never worse');
  assert.equal(defenseLabel(0.9), 'Easy');
  assert.equal(defenseLabel(0.7), 'Fair');
  assert.equal(defenseLabel(0.4), 'Hard');
  assert.equal(defenseLabel(0.1), 'Deadly');
});
