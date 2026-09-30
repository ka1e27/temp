// buildArena guarantees (ARCHITECTURE §6, DESIGN §4.1): adjacency validation, War Camp
// placement, per-site troop rules, the Free Folk hamlet carve-out, and full reachability.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildArena } from '../battle/arena.js';
import { buildTileIndex, axialNeighbors, hexKey, hexDistance } from '../battle/geom.js';
import { BATTLE, SITE_TYPES } from '../config/battle.js';
import {
  buildTestWorld, HOME_REGION, TARGET_REGION, SETTLEMENT, DEFAULT_OWNERS,
} from './fixtures/battle-world.js';

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

test('a halo settlement disconnected by the depth cutoff gets connecting tiles added', () => {
  // A minimal hand-built world: the target region is a single tile; the player's camp
  // border tile sits right next to it; a second player settlement sits EXACTLY
  // arenaPlayerDepth hexes away, reachable from the border only through a corridor of
  // tiles that belong to neither the target region nor the player — so those corridor
  // tiles are excluded from the initial (target ∪ halo) tile set, and the isolated
  // settlement would be an unreachable island unless buildArena patches the corridor in.
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
  assert.ok(
    reachable.has(hexKey(isoTileInArena.q, isoTileInArena.r)),
    'the corridor tiles should have been added so the isolated settlement is reachable',
  );
  // The corridor tiles themselves (owned by neither side) must now be part of the arena.
  for (const c of corridor) {
    assert.ok(arena.tiles.some((t) => t.i === c.i), `corridor tile ${c.i} should have been added`);
  }
});
