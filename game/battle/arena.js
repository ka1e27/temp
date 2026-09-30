// buildArena: assembles the Arena for a battle (ARCHITECTURE §6, DESIGN §4.1). Pure: no DOM,
// no Math.random, no Date.now — only reads `world`/`owners` and the two stat blocks.
import { BATTLE, SITE_TYPES, ENEMY_SCALING } from '../config/battle.js';
import {
  hexDistance, hexRadiusToWorld, buildTileIndex, findPath, axialNeighbors, hexKey,
} from './geom.js';
import { PLAYER_OWNER, FREE_FOLK_OWNER } from './owner.js';

function isAdjacentToPlayer(world, owners, regionId) {
  return world.regions[regionId].neighbors.some((n) => owners[n] === PLAYER_OWNER);
}

/** Player-owned passable tiles within `BATTLE.arenaPlayerDepth` hexes of the region. */
function playerHaloTiles(world, owners, region) {
  const regionAxial = region.tiles.map((i) => world.tiles[i]);
  const depth = BATTLE.arenaPlayerDepth;
  // Cheap bbox pre-filter (world units) before the exact per-tile hex-distance check —
  // keeps this fast on a full-size generated world, not just this module's small fixture.
  const pad = hexRadiusToWorld(depth) * 1.2;
  const bbox = {
    minX: region.bbox.minX - pad, maxX: region.bbox.maxX + pad,
    minY: region.bbox.minY - pad, maxY: region.bbox.maxY + pad,
  };
  const halo = [];
  for (const t of world.tiles) {
    if (!t.passable || t.region === -1 || owners[t.region] !== PLAYER_OWNER) continue;
    if (t.x < bbox.minX || t.x > bbox.maxX || t.y < bbox.minY || t.y > bbox.maxY) continue;
    let minDist = Infinity;
    for (const rt of regionAxial) {
      const d = hexDistance(t, rt);
      if (d < minDist) minDist = d;
      if (minDist === 0) break;
    }
    if (minDist <= depth) halo.push(t);
  }
  return halo;
}

/** Player-owned passable tiles directly adjacent (hex-distance 1) to the target region. */
function borderTilesOf(world, haloTiles, region) {
  const regionTileSet = new Set(region.tiles);
  const byKey = new Map();
  for (const i of region.tiles) {
    const t = world.tiles[i];
    byKey.set(hexKey(t.q, t.r), true);
  }
  return haloTiles.filter((t) => axialNeighbors(t.q, t.r).some((n) => byKey.has(hexKey(n.q, n.r))));
}

/** Picks the War Camp tile: nearest by in-arena path cost to the enemy keep, among border
 * tiles, preferring (not requiring) one that isn't on/adjacent to an existing settlement. */
function chooseCampTile(world, borderCandidates, arenaByKey, keepTile, settlementTileSet) {
  const nearSettlement = (t) => settlementTileSet.has(t.i)
    || axialNeighbors(t.q, t.r).some((n) => {
      for (const st of settlementTileSet) {
        const st2 = world.tiles[st];
        if (st2.q === n.q && st2.r === n.r) return true;
      }
      return false;
    });

  const rank = (t) => {
    const path = findPath(arenaByKey, t, keepTile);
    const cost = path ? path.reduce((sum, p) => sum + p.cost, 0) : Infinity;
    return cost;
  };

  const preferred = borderCandidates.filter((t) => !nearSettlement(t));
  const pool = preferred.length ? preferred : borderCandidates;
  let best = null;
  let bestCost = Infinity;
  for (const t of pool) {
    const cost = rank(t);
    if (cost < bestCost || (cost === bestCost && (!best || t.i < best.i))) {
      bestCost = cost;
      best = t;
    }
  }
  return best;
}

/** BFS reachability check within a tile set (unweighted — connectivity only). */
function reachableSet(byKey, startTile) {
  const seen = new Set([hexKey(startTile.q, startTile.r)]);
  const queue = [startTile];
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

/**
 * @param {object} world World contract (ARCHITECTURE §4).
 * @param {number[]} owners current owner faction id per region id.
 * @param {number} regionId the target region to attack.
 * @param {object} player PlayerStats.
 * @param {object} enemy EnemyStats.
 * @returns {object} Arena (ARCHITECTURE §6).
 */
export function buildArena(world, owners, regionId, player, enemy) {
  const region = world.regions[regionId];
  if (!region) throw new Error(`buildArena: no such region ${regionId}`);
  if (owners[regionId] === PLAYER_OWNER) {
    throw new Error(`buildArena: region ${regionId} is already player-owned`);
  }
  if (!isAdjacentToPlayer(world, owners, regionId)) {
    throw new Error(`buildArena: region ${regionId} is not adjacent to any player-owned region`);
  }

  const targetTiles = region.tiles.map((i) => world.tiles[i]).filter((t) => t.passable);
  const halo = playerHaloTiles(world, owners, region);

  const tileSet = new Map(); // world tile index -> tile
  for (const t of targetTiles) tileSet.set(t.i, t);
  for (const t of halo) tileSet.set(t.i, t);

  const keepSettlement = world.settlements[region.keep];
  const keepTile = world.tiles[keepSettlement.tile];

  const border = borderTilesOf(world, halo, region);
  if (border.length === 0) {
    throw new Error(`buildArena: no player-owned border tile adjacent to region ${regionId}`);
  }

  const arenaByKeyForCamp = buildTileIndex([...tileSet.values()]);
  const allSettlementTileIds = new Set(world.settlements.map((s) => s.tile));
  const campTile = chooseCampTile(world, border, arenaByKeyForCamp, keepTile, allSettlementTileIds);
  if (!campTile) throw new Error(`buildArena: could not place a War Camp for region ${regionId}`);

  // --- Sites -----------------------------------------------------------------------------
  const sites = [];
  sites.push({
    id: 0, settlement: -1, tile: campTile.i, type: 'camp', owner: PLAYER_OWNER, troops: player.campTroops,
  });

  const targetSettlements = region.settlements
    .map((id) => world.settlements[id])
    .filter((s) => tileSet.has(s.tile))
    .sort((a, b) => a.id - b.id);
  const isRivalRegion = owners[regionId] !== FREE_FOLK_OWNER;
  for (const s of targetSettlements) {
    const isNeutralHamlet = isRivalRegion && s.type === 'hamlet';
    const owner = isNeutralHamlet ? FREE_FOLK_OWNER : owners[regionId];
    const troopMult = isNeutralHamlet ? 1 : enemy.troopMult;
    // Enemy caps scale with depth, capitals get a bonus, Free Folk sites cap lower (DESIGN §4.6): one number per
    // site, fixed here. `enemy.capMult` already holds depth x capital x Free Folk for the region's own owner.
    const capMult = isNeutralHamlet ? ENEMY_SCALING.freeFolkCapMult : (enemy.capMult ?? 1);
    sites.push({
      id: sites.length, settlement: s.id, tile: s.tile, type: s.type, owner,
      troops: BATTLE.enemyStart[s.type] * troopMult, capMult,
    });
  }

  const haloTileIds = new Set(halo.map((t) => t.i));
  const playerSettlements = world.settlements
    .filter((s) => haloTileIds.has(s.tile) && owners[s.region] === PLAYER_OWNER)
    .sort((a, b) => a.id - b.id);
  for (const s of playerSettlements) {
    const cap = SITE_TYPES[s.type].cap + player.capBonus;
    sites.push({
      id: sites.length, settlement: s.id, tile: s.tile, type: s.type, owner: PLAYER_OWNER,
      troops: Math.max(player.garrisonShare * cap, BATTLE.playerGarrisonFloor), // never paper-thin: a raid must not take it for free
    });
  }

  // --- Connectivity: every site must be reachable from the camp inside the arena ---------
  ensureConnected(world, tileSet, campTile, sites);

  const allTiles = [...tileSet.values()].sort((a, b) => a.i - b.i);
  const arenaTiles = allTiles.map((t) => ({
    i: t.i, q: t.q, r: t.r, x: t.x, y: t.y, cost: t.cost, terrain: t.terrain, region: t.region,
  }));

  const focus = {
    minX: Math.min(...allTiles.map((t) => t.x)), maxX: Math.max(...allTiles.map((t) => t.x)),
    minY: Math.min(...allTiles.map((t) => t.y)), maxY: Math.max(...allTiles.map((t) => t.y)),
  };

  return { regionId, enemyFaction: owners[regionId], tiles: arenaTiles, sites, focus };
}

/** Adds connecting tiles (from a full-world passable-tile pathfind) for any site that isn't
 * reachable from the camp within the current arena tile set, mutating `tileSet` in place. */
function ensureConnected(world, tileSet, campTile, sites) {
  let arenaByKey = buildTileIndex([...tileSet.values()]);
  let reachable = reachableSet(arenaByKey, campTile);

  const worldByKey = buildTileIndex(world.tiles.filter((t) => t.passable));
  const orderedSites = [...sites].sort((a, b) => a.id - b.id);
  for (const site of orderedSites) {
    const tile = tileSet.get(site.tile) || world.tiles[site.tile];
    if (reachable.has(hexKey(tile.q, tile.r))) continue;
    const path = findPath(worldByKey, campTile, tile);
    if (!path) continue; // no route exists anywhere on the world map — leave as-is
    let added = false;
    for (const p of path) {
      if (!tileSet.has(p.i)) {
        tileSet.set(p.i, p);
        added = true;
      }
    }
    if (added) {
      arenaByKey = buildTileIndex([...tileSet.values()]);
      reachable = reachableSet(arenaByKey, campTile);
    }
  }
}
