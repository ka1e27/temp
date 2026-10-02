// buildArena guarantees (ARCHITECTURE §6, DESIGN §4.1): adjacency validation, War Camp
// placement, per-site troop rules, the Free Folk hamlet carve-out, and full reachability.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildArena, canBuildArena, arenaBlockedReason, approachTiles } from '../battle/arena.js';
import { estimateDifficulty } from '../battle/difficulty.js';
import { buildTileIndex, axialNeighbors, hexKey, hexDistance } from '../battle/geom.js';
import { BATTLE, SITE_TYPES } from '../config/battle.js';
import { DIFFICULTY } from '../config/meta.js';
import {
  buildTestWorld, HOME_REGION, TARGET_REGION, SETTLEMENT, DEFAULT_OWNERS,
} from './fixtures/battle-world.js';
import { generateWorld } from '../world/generate.js';
import { createGame } from '../meta/state.js';
import {
  frontier, conquer, playerBattleStats, enemyBattleStats, attackable, attackableFrontier, difficulty,
} from '../meta/progression.js';

const PLAYER = Object.freeze({
  atk: 1, def: 1, growth: 1, speed: 1, campTroops: 30, garrisonShare: 0.35, capBonus: 4,
  cooldownMult: 1, powers: { rally: 1, firestorm: 1, bulwark: 1, march: 1, levy: 1 },
});
const ENEMY = Object.freeze({
  atk: 1, def: 1, growth: 1, speed: 1, troopMult: 1.3, thinkSec: 2, personality: 'aggressive', factionId: 2,
});

function reachableTileKeys(arena, fromTileIndex) {
  const byKey = buildTileIndex(arena.tiles);
  const start = arena.tiles.find((t) => t.i === fromTileIndex);
  const seen = new Set([hexKey(start.q, start.r)]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    for (const n of axialNeighbors(cur.q, cur.r)) {
      const k = hexKey(n.q, n.r);
      if (seen.has(k)) continue;
      const nt = byKey.get(k);
      if (!nt) continue;
      seen.add(k);
      queue.push(nt);
    }
  }
  return seen;
}

test('throws a clear error when the region is not adjacent to player territory', () => {
  const world = buildTestWorld();
  // Flip the target region to a rival too, so it's no longer adjacent to any player region.
  const owners = [2, 2];
  assert.throws(() => buildArena(world, owners, TARGET_REGION, PLAYER, ENEMY), /adjacent/i);
});

test('throws a clear error when the region is already player-owned', () => {
  const world = buildTestWorld();
  const owners = [0, 0];
  assert.throws(() => buildArena(world, owners, TARGET_REGION, PLAYER, ENEMY), /player-owned/i);
});

test('War Camp sits on a player-owned tile adjacent to the target region', () => {
  const world = buildTestWorld();
  const arena = buildArena(world, [...DEFAULT_OWNERS], TARGET_REGION, PLAYER, ENEMY);
  const camp = arena.sites.find((s) => s.type === 'camp');
  assert.ok(camp);
  const campTile = arena.tiles.find((t) => t.i === camp.tile);
  assert.equal(campTile.region, HOME_REGION);
  const target = world.regions[TARGET_REGION];
  const adjacentToTarget = axialNeighbors(campTile.q, campTile.r)
    .some((n) => target.tiles.some((i) => world.tiles[i].q === n.q && world.tiles[i].r === n.r));
  assert.ok(adjacentToTarget, 'camp tile must border the target region');
});

test('War Camp prefers a tile not on/adjacent to an existing settlement when one is available', () => {
  // The shared fixture can't test this preference directly: its home region is only 3
  // tiles wide with Home Keep near its centre, so EVERY border tile ends up adjacent to
  // some settlement — buildArena correctly falls back to cheapest-overall there, which is
  // a different code path (covered by the fixture-based tests elsewhere in this file).
  //
  // A target region that is JUST its own keep has the same problem the other way: every
  // border tile is, by definition, adjacent to the target region, which here means
  // adjacent to the keep (a settlement) — so "preferred" would always be empty regardless
  // of whether the preference logic works. This world gives the target region a second,
  // keep-less tile, so a border tile can reach it (and so count as a valid border/attack
  // tile) WITHOUT being adjacent to any settlement — and makes that clean tile the more
  // expensive one, so only a real preference (not a cost tie-break) picks it.
  const mk = (i, q, r, region) => ({
    i, col: q, row: r, q, r, x: q * 1.7 + r * 0.85, y: r * 1.5, terrain: 'grass', elev: 1,
    height: 0.3, moisture: 0.5, land: true, passable: true, cost: 1, road: 0, river: 0,
    coast: 0, region, settlement: -1, jitter: 0,
  });
  const outskirts = mk(0, 0, 0, 1);          // target region, no settlement
  const keep = mk(1, 1, 0, 1);                // target region, the keep
  const clear = mk(2, -1, 0, 0);               // home: adjacent to outskirts only — 2 hops to keep
  const nearKeep = mk(3, 1, -1, 0);            // home: adjacent to the keep itself — 1 hop, cheaper
  keep.settlement = 0;
  const tiles = [outskirts, keep, clear, nearKeep];
  const settlements = [{ id: 0, tile: keep.i, region: 1, type: 'keep', name: 'Target Keep' }];
  const world = {
    seed: 1, cols: 10, rows: 10, tiles, settlements,
    regions: [
      {
        id: 0, name: 'Home', tiles: [clear.i, nearKeep.i], neighbors: [1],
        centroid: { x: 0, y: 0 }, bbox: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
        keep: -1, settlements: [], tier: 0, faction: 0, isCapital: false, biome: 'grass',
        perk: 'fertile', coastal: false,
      },
      {
        id: 1, name: 'Target', tiles: [outskirts.i, keep.i], neighbors: [0],
        centroid: { x: 0, y: 0 },
        bbox: { minX: -1, maxX: 3, minY: -1.5, maxY: 0 },
        keep: 0, settlements: [0], tier: 1, faction: 2, isCapital: false, biome: 'grass',
        perk: 'iron', coastal: false,
      },
    ],
    factions: [], startRegion: 0, bounds: { minX: -2, maxX: 3, minY: -2, maxY: 2 },
  };

  const arena = buildArena(world, [0, 2], 1, PLAYER, ENEMY);
  const camp = arena.sites.find((s) => s.type === 'camp');
  assert.notEqual(camp.tile, nearKeep.i, 'the cheaper tile is adjacent to the keep and should be passed over');
  assert.equal(camp.tile, clear.i, 'the more expensive but settlement-free tile should win instead');
});

test('enemy settlements start at enemyStart[type] * troopMult; hamlets in a rival region are Free Folk', () => {
  const world = buildTestWorld();
  const arena = buildArena(world, [...DEFAULT_OWNERS], TARGET_REGION, PLAYER, ENEMY);
  const byWorldSettlement = new Map(arena.sites.filter((s) => s.settlement >= 0).map((s) => [s.settlement, s]));

  const hamlet = byWorldSettlement.get(SETTLEMENT.TARGET_HAMLET);
  assert.equal(hamlet.owner, 1, 'a hamlet in a rival region is Free Folk, not the rival');
  assert.equal(hamlet.troops, BATTLE.enemyStart.hamlet, 'neutral hamlets use troopMult 1, not the rival\'s');

  const fort = byWorldSettlement.get(SETTLEMENT.TARGET_FORT);
  assert.equal(fort.owner, 2);
  assert.equal(fort.troops, BATTLE.enemyStart.fort * ENEMY.troopMult);

  const keep = byWorldSettlement.get(SETTLEMENT.TARGET_KEEP);
  assert.equal(keep.troops, BATTLE.enemyStart.keep * ENEMY.troopMult);
});

test('when the target region itself is Free Folk, hamlets use the enemy stat block directly', () => {
  const world = buildTestWorld();
  const freeFolkEnemy = { ...ENEMY, factionId: 1 };
  const arena = buildArena(world, [0, 1], TARGET_REGION, PLAYER, freeFolkEnemy);
  const hamlet = arena.sites.find((s) => s.settlement === SETTLEMENT.TARGET_HAMLET);
  assert.equal(hamlet.owner, 1);
  assert.equal(hamlet.troops, BATTLE.enemyStart.hamlet * freeFolkEnemy.troopMult);
});

test('player settlements inside the arena join with garrisonShare * effective cap', () => {
  const world = buildTestWorld();
  const arena = buildArena(world, [...DEFAULT_OWNERS], TARGET_REGION, PLAYER, ENEMY);
  const bordervale = arena.sites.find((s) => s.settlement === SETTLEMENT.HOME_VILLAGE);
  assert.ok(bordervale, 'Bordervale is within arenaPlayerDepth of the target region');
  assert.equal(bordervale.owner, 0);
  const expectedCap = SITE_TYPES.village.cap + PLAYER.capBonus;
  assert.equal(bordervale.troops, PLAYER.garrisonShare * expectedCap);

  const camp = arena.sites.find((s) => s.type === 'camp');
  assert.equal(camp.troops, PLAYER.campTroops);
});

test('every site is reachable from the camp inside the arena (real fixture)', () => {
  const world = buildTestWorld();
  const arena = buildArena(world, [...DEFAULT_OWNERS], TARGET_REGION, PLAYER, ENEMY);
  const camp = arena.sites.find((s) => s.type === 'camp');
  const reachable = reachableTileKeys(arena, camp.tile);
  for (const site of arena.sites) {
    const tile = arena.tiles.find((t) => t.i === site.tile);
    assert.ok(reachable.has(hexKey(tile.q, tile.r)), `site ${site.id} (${site.type}) should be reachable`);
  }
});

test('a halo settlement cut off from the camp is NOT joined to it: it stays a site, no connector is carved', () => {
  // A minimal hand-built world: the target region is a single tile; the player's camp
  // border tile sits right next to it; a second player settlement sits EXACTLY
  // arenaPlayerDepth hexes away, reachable from the border only through a corridor of
  // tiles that belong to neither the target region nor the player — so those corridor
  // tiles are excluded from the initial (target ∪ halo) tile set. Front lines (DESIGN §4.4): nothing is carved to join the
  // player's own settlements (that read as a highway through enemy land), so the settlement fights from where it stands.
  const depth = BATTLE.arenaPlayerDepth;
  const mk = (i, q, r, region) => ({
    i, col: q, row: r, q, r, x: q * 1.7 + r * 0.85, y: r * 1.5, terrain: 'grass', elev: 1,
    height: 0.3, moisture: 0.5, land: true, passable: true, cost: 1, road: 0, river: 0,
    coast: 0, region, settlement: -1, jitter: 0,
  });
  const targetTile = mk(0, 0, 0, 1);
  const borderTile = mk(1, -1, 0, 0);
  const corridor = [];
  for (let r = 1; r < depth; r++) corridor.push(mk(1 + r, -1, r, -1));
  const isolatedTile = mk(1 + depth, -1, depth, 0);
  assert.equal(hexDistance(targetTile, isolatedTile), depth, 'test construction sanity check');

  const tiles = [targetTile, borderTile, ...corridor, isolatedTile];
  targetTile.settlement = 0;
  isolatedTile.settlement = 1;
  const settlements = [
    { id: 0, tile: targetTile.i, region: 1, type: 'keep', name: 'Target Keep' },
    { id: 1, tile: isolatedTile.i, region: 0, type: 'village', name: 'Farflung' },
  ];
  const world = {
    seed: 1, cols: 20, rows: 20, tiles, settlements,
    regions: [
      {
        id: 0, name: 'Home', tiles: [borderTile.i, isolatedTile.i], neighbors: [1],
        centroid: { x: 0, y: 0 }, bbox: { minX: -5, maxX: 5, minY: -5, maxY: 15 },
        keep: 1, settlements: [1], tier: 0, faction: 0, isCapital: false, biome: 'grass',
        perk: 'fertile', coastal: false,
      },
      {
        id: 1, name: 'Target', tiles: [targetTile.i], neighbors: [0],
        centroid: { x: targetTile.x, y: targetTile.y },
        bbox: { minX: targetTile.x, maxX: targetTile.x, minY: targetTile.y, maxY: targetTile.y },
        keep: 0, settlements: [0], tier: 1, faction: 2, isCapital: false, biome: 'grass',
        perk: 'iron', coastal: false,
      },
    ],
    factions: [], startRegion: 0, bounds: { minX: -5, maxX: 5, minY: -5, maxY: 15 },
  };

  const arena = buildArena(world, [0, 2], 1, PLAYER, ENEMY);
  const isolatedSite = arena.sites.find((s) => s.settlement === 1);
  assert.ok(isolatedSite, 'the far-flung settlement should still be included in the arena');
  const camp = arena.sites.find((s) => s.type === 'camp');
  const reachable = reachableTileKeys(arena, camp.tile);
  const isoTileInArena = arena.tiles.find((t) => t.i === isolatedSite.tile);
  assert.ok(!reachable.has(hexKey(isoTileInArena.q, isoTileInArena.r)), 'no connector joins the cut-off settlement to the camp');
  for (const c of corridor) {
    assert.ok(!arena.tiles.some((t) => t.i === c.i), `corridor tile ${c.i} is not carved into the arena`);
  }
  assert.ok(!arena.tiles.some((t) => t.link), 'no link tiles at all: the target keep touches the camp');
  assert.deepEqual(arena.marches, []);
  assert.ok(canBuildArena(world, [0, 2], 1));
});

// --- a border of mountains: the camp's approach strip, and regions that cannot be attacked -----------------------------------

/**
 * A tiny world for approach tests. Target region 1 = the passable tile T (0,0) plus a ridge of `ridge` mountain tiles (-1,0),
 * (-2,0), ...; the player's tile P sits just past the last of them. `bridge` = passable tiles of region -1 (no-man's-land) on a
 * way round the ridge; the default is none.
 */
function mountainWorld({ ridge = 1, bridge = [] } = {}) {
  const mk = (i, q, r, region, extra = {}) => ({
    i, col: q, row: r, q, r, x: q * 1.7 + r * 0.85, y: r * 1.5, terrain: 'grass', elev: 1, height: 0.3, moisture: 0.5,
    land: true, passable: true, cost: 1, road: 0, river: 0, coast: 0, region, settlement: -1, jitter: 0, ...extra,
  });
  const T = mk(0, 0, 0, 1);
  const M = [];
  for (let k = 1; k <= ridge; k++) M.push(mk(k, -k, 0, 1, { terrain: 'mountain', passable: false, cost: Infinity }));
  const P = mk(1 + ridge, -(ridge + 1), 1, 0); // touches the last mountain tile
  const B = bridge.map((t, k) => mk(2 + ridge + k, t.q, t.r, -1));
  const tiles = [T, ...M, P, ...B];
  T.settlement = 0;
  const world = {
    seed: 1, cols: 20, rows: 20, tiles,
    settlements: [{ id: 0, tile: T.i, region: 1, type: 'keep', name: 'Far Keep' }],
    regions: [
      {
        id: 0, name: 'Home', tiles: [P.i], neighbors: [1], centroid: { x: P.x, y: P.y },
        bbox: { minX: P.x - 1, maxX: P.x + 1, minY: P.y - 1, maxY: P.y + 1 },
        keep: 0, settlements: [], tier: 0, faction: 0, isCapital: false, biome: 'grass', perk: 'fertile', coastal: false,
      },
      {
        id: 1, name: 'Ridge', tiles: [T.i, ...M.map((t) => t.i)], neighbors: [0], centroid: { x: T.x, y: T.y },
        bbox: { minX: P.x - 1, maxX: T.x + 1, minY: T.y - 1, maxY: P.y + 1 },
        keep: 0, settlements: [0], tier: 1, faction: 2, isCapital: false, biome: 'grass', perk: 'iron', coastal: false,
      },
    ],
    factions: [], startRegion: 0, bounds: { minX: -9, maxX: 5, minY: -5, maxY: 15 },
  };
  return { world, T, M, P, B };
}

test('a border of mountains: the camp stands on the nearest player land and a passable way round is preferred to climbing', () => {
  // a one-tile ridge with one passable tile X (-1,1) that touches both P (-2,1) and T: X is the strip, the mountain is left alone
  const { world, T, P, B } = mountainWorld({ ridge: 1, bridge: [{ q: -1, r: 1 }] });
  assert.equal(canBuildArena(world, [0, 2], 1), true);
  assert.equal(arenaBlockedReason(world, [0, 2], 1), null);
  const arena = buildArena(world, [0, 2], 1, PLAYER, ENEMY);
  const camp = arena.sites.find((x) => x.type === 'camp');
  assert.equal(camp.tile, P.i, 'the camp stands on the player tile');
  assert.deepEqual(arena.tiles.filter((t) => t.link).map((t) => t.i), [B[0].i], 'the one tile that bridges the ridge is the strip');
  assert.equal(arena.marches.length, 1);
  assert.deepEqual(arena.marches[0].tiles, [B[0].i]);
  assert.equal(arena.marches[0].approach, true);
  assert.ok(!arena.tiles.some((t) => t.pass), 'nothing is climbed when the way round is as short');
  const reachable = reachableTileKeys(arena, camp.tile);
  assert.ok(reachable.has(hexKey(T.q, T.r)));
});

test('a border of mountains: with no way round the strip climbs the ridge, its mountain tiles become walkable hill passes', () => {
  for (const ridge of [1, 2, BATTLE.corridorMaxTiles]) {
    const { world, T, M, P } = mountainWorld({ ridge });
    assert.equal(canBuildArena(world, [0, 2], 1), true, `a ridge ${ridge} tiles thick`);
    const arena = buildArena(world, [0, 2], 1, PLAYER, ENEMY);
    const camp = arena.sites.find((x) => x.type === 'camp');
    assert.equal(camp.tile, P.i);
    const passes = arena.tiles.filter((t) => t.pass);
    assert.deepEqual(passes.map((t) => t.i).sort((x, y) => x - y), M.map((t) => t.i), 'every ridge tile is a pass tile');
    for (const t of passes) {
      assert.equal(t.link, true, 'neutral land');
      assert.equal(t.terrain, 'hills');
      assert.ok(Number.isFinite(t.cost) && t.cost > 0, 'a finite walking cost, never the mountain\'s Infinity');
    }
    assert.ok(arena.tiles.every((t) => Number.isFinite(t.cost)));
    assert.equal(arena.marches.length, 1);
    assert.equal(arena.marches[0].tiles.length, ridge);
    assert.ok(arena.marches[0].tiles.length <= BATTLE.corridorMaxTiles);
    assert.ok(reachableTileKeys(arena, camp.tile).has(hexKey(T.q, T.r)), 'the keep is reachable from the camp');
    assert.equal(world.tiles.find((t) => t.i === M[0].i).passable, false, 'the world itself is untouched');
  }
});

test('a border of mountains: a ridge thicker than the cap cannot be crossed, and the region reads as not attackable', () => {
  const { world } = mountainWorld({ ridge: BATTLE.corridorMaxTiles + 1 });
  assert.equal(canBuildArena(world, [0, 2], 1), false);
  assert.equal(arenaBlockedReason(world, [0, 2], 1), 'no-passable-border');
  assert.throws(() => buildArena(world, [0, 2], 1, PLAYER, ENEMY), /passable/i);
});

test('canBuildArena / arenaBlockedReason: never throw, and say why', () => {
  const world = buildTestWorld();
  assert.equal(canBuildArena(world, [...DEFAULT_OWNERS], TARGET_REGION), true);
  assert.equal(arenaBlockedReason(world, [...DEFAULT_OWNERS], TARGET_REGION), null);
  assert.equal(canBuildArena(world, [0, 0], TARGET_REGION), false);
  assert.equal(arenaBlockedReason(world, [0, 0], TARGET_REGION), 'owned');
  assert.equal(canBuildArena(world, [2, 2], TARGET_REGION), false);
  assert.equal(arenaBlockedReason(world, [2, 2], TARGET_REGION), 'not-adjacent');
  assert.equal(canBuildArena(world, [0, 2], 99), false);
  assert.equal(arenaBlockedReason(world, [0, 2], 99), 'no-region');
});

test('canBuildArena agrees with buildArena: allowed means it builds, refused means it throws (real worlds, several conquest states)', () => {
  for (const seed of [1, 2, 3]) {
    const world = generateWorld(seed);
    const state = createGame(seed, world, 0);
    for (let step = 0; step < 14; step++) {
      const fr = frontier(state, world);
      if (!fr.length) break;
      for (const id of fr) {
        const stats = [playerBattleStats(state, world, id), enemyBattleStats(world, state, id)];
        let built = true;
        try { buildArena(world, state.owner, id, ...stats); } catch { built = false; }
        assert.equal(canBuildArena(world, state.owner, id), built, `seed ${seed} step ${step} region ${id}`);
        assert.equal(attackable(state, world, id), built);
      }
      const open = attackableFrontier(state, world);
      assert.ok(open.length >= 1, 'a realm is never left with nothing to attack');
      assert.ok(open.every((id) => fr.includes(id)));
      conquer(state, world, open[step % open.length], 0);
    }
  }
});

test('every first-ring region can be attacked at the start (seeds 1-30), and every region once its other neighbours are taken', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const world = generateWorld(seed);
    const state = createGame(seed, world, 0);
    for (const id of frontier(state, world)) assert.equal(canBuildArena(world, state.owner, id), true, `seed ${seed} first-ring region ${id}`);
  }
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const world = generateWorld(seed);
    for (const r of world.regions) {
      if (r.tier === 0) continue;
      const owners = world.regions.map((x) => (x.id === r.id ? x.faction : 0));
      assert.equal(canBuildArena(world, owners, r.id), true, `seed ${seed} region ${r.id} with everything else owned`);
    }
  }
});

test('approach strips are short, neutral, recorded, and leave every enemy site reachable from the camp (seeds 1-8, conquest states)', () => {
  let strips = 0;
  let arenas = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const world = generateWorld(seed);
    const state = createGame(seed, world, 0);
    for (let step = 0; step < 30; step++) {
      const open = attackableFrontier(state, world);
      if (!open.length) break;
      for (const id of open) {
        const arena = buildArena(world, state.owner, id, playerBattleStats(state, world, id), enemyBattleStats(world, state, id));
        arenas += 1;
        const camp = arena.sites.find((x) => x.type === 'camp');
        const reachable = reachableTileKeys(arena, camp.tile);
        for (const site of arena.sites) {
          if (site.owner === 0) continue; // a cut-off village of the player's own is allowed to be cut off
          const tile = arena.tiles.find((t) => t.i === site.tile);
          assert.ok(reachable.has(hexKey(tile.q, tile.r)), `seed ${seed} region ${id}: site ${site.id} unreachable from the camp`);
        }
        for (const t of arena.tiles) {
          assert.ok(Number.isFinite(t.cost), `seed ${seed} region ${id}: tile ${t.i} has cost ${t.cost}`);
          if (t.pass) assert.equal(t.link, true);
        }
        for (const m of arena.marches.filter((x) => x.approach)) {
          strips += 1;
          assert.ok(m.tiles.length >= 1 && m.tiles.length <= BATTLE.corridorMaxTiles, `approach strip of ${m.tiles.length} tiles`);
          for (const i of m.tiles) assert.equal(arena.tiles.find((t) => t.i === i).link, true);
        }
      }
      conquer(state, world, open[(step * 7) % open.length], 0);
    }
  }
  assert.ok(arenas >= 100, `only ${arenas} arenas checked`);
});


test('approachTiles: 0 for an ordinary border, the strip length for a border of mountains, null when it cannot be attacked', () => {
  assert.equal(approachTiles(buildTestWorld(), [...DEFAULT_OWNERS], TARGET_REGION), 0);
  assert.equal(approachTiles(mountainWorld({ ridge: 1, bridge: [{ q: -1, r: 1 }] }).world, [0, 2], 1), 1);
  assert.equal(approachTiles(mountainWorld({ ridge: 2 }).world, [0, 2], 1), 2);
  assert.equal(approachTiles(mountainWorld({ ridge: BATTLE.corridorMaxTiles }).world, [0, 2], 1), BATTLE.corridorMaxTiles);
  assert.equal(approachTiles(mountainWorld({ ridge: BATTLE.corridorMaxTiles + 1 }).world, [0, 2], 1), null);
  assert.equal(approachTiles(buildTestWorld(), [0, 0], TARGET_REGION), null, 'a region the player owns has no approach');
  // it matches the arena that is actually built
  for (const ridge of [1, 2, 3]) {
    const { world } = mountainWorld({ ridge });
    const built = buildArena(world, [0, 2], 1, PLAYER, ENEMY).marches.filter((m) => m.approach).reduce((n, m) => n + m.tiles.length, 0);
    assert.equal(built, approachTiles(world, [0, 2], 1));
  }
});

test('a world with no tile data (a fixture) has no arenas, quietly: canBuildArena is false, never a throw', () => {
  const bare = { regions: [{ id: 0, neighbors: [1], tiles: [0], keep: 0 }, { id: 1, neighbors: [0], tiles: [1], keep: 1 }], tiles: [], settlements: [] };
  assert.equal(canBuildArena(bare, [0, 2], 1), false);
  assert.equal(arenaBlockedReason(bare, [0, 2], 1), 'unbuildable');
  assert.equal(approachTiles(bare, [0, 2], 1), null);
});

test('the arena-level difficulty twin charges the approach strip exactly like the card (DIFFICULTY.approachPerTile per tile)', () => {
  const { world } = mountainWorld({ ridge: 2 });
  const arena = buildArena(world, [0, 2], 1, PLAYER, ENEMY);
  const strip = arena.marches.filter((m) => m.approach).reduce((n, m) => n + m.tiles.length, 0);
  assert.equal(strip, 2);
  const withStrip = estimateDifficulty(arena, PLAYER, ENEMY);
  const without = estimateDifficulty({ ...arena, marches: [] }, PLAYER, ENEMY);
  assert.equal(withStrip.power, without.power);
  assert.ok(Math.abs(withStrip.strength / without.strength - (1 + DIFFICULTY.approachPerTile * strip)) < 1e-9);
  assert.ok(withStrip.ratio < without.ratio);
});

test('difficulty() reports the approach strip length and charges for it (real worlds, seeds 1-8)', () => {
  let withStrip = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const world = generateWorld(seed);
    const state = createGame(seed, world, 0);
    for (let step = 0; step < 25; step++) {
      const fr = frontier(state, world);
      if (!fr.length) break;
      for (const id of fr) {
        const d = difficulty(state, world, id);
        assert.equal(d.approach, approachTiles(world, state.owner, id) || 0);
        assert.ok(d.approach >= 0 && d.approach <= BATTLE.corridorMaxTiles);
        if (d.approach > 0) withStrip += 1;
      }
      const open = attackableFrontier(state, world);
      if (!open.length) break;
      conquer(state, world, open[step % open.length], 0);
    }
  }
  assert.ok(withStrip > 0, 'some region in these worlds has a border of mountains, or this checks nothing');
});
