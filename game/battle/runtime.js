// Runtime (non-JSON) cache for a BattleState: tile lookups and a memoised path cache.
// Kept OUTSIDE the battle state (a WeakMap keyed by the battle object) so the state itself
// stays plain JSON, per ARCHITECTURE §1/§6. Lazily rebuilt whenever a battle object isn't
// found in the cache — which is exactly what happens after a JSON round-trip (the
// deserialised battle is a new object reference), so callers never need to think about it.
import { buildTileIndex, findPath } from './geom.js';

const cache = new WeakMap();

function build(battle) {
  const tiles = battle.arena.tiles;
  const byIndex = new Map();
  for (const t of tiles) byIndex.set(t.i, t);
  const byKey = buildTileIndex(tiles);
  const siteByTile = new Map();
  for (const s of battle.sites) siteByTile.set(s.tile, s.id);
  return { byIndex, byKey, siteByTile, pathCache: new Map() };
}

/** @returns {{byIndex:Map, byKey:Map, siteByTile:Map, pathCache:Map}} */
export function getRuntime(battle) {
  let rt = cache.get(battle);
  if (!rt) {
    rt = build(battle);
    cache.set(battle, rt);
  }
  return rt;
}

/** Drops any cached runtime for a battle (tests only need this if they mutate arena/sites
 * shape in place rather than through the normal API). */
export function invalidateRuntime(battle) {
  cache.delete(battle);
}

/** World tile object (i, q, r, x, y, cost, terrain, region) for a world tile index. */
export function tileAt(battle, tileIndex) {
  return getRuntime(battle).byIndex.get(tileIndex);
}

/** Site id currently sitting on a tile, or null. */
export function siteIdAtTile(battle, tileIndex) {
  const id = getRuntime(battle).siteByTile.get(tileIndex);
  return id === undefined ? null : id;
}

/**
 * Cheapest path (by tile.cost to ENTER each tile) between two arena tiles, memoised per
 * battle object. Terrain never changes mid-battle, so this cache never needs invalidation.
 * @returns {number[]|null} world tile indices from (excluding start) to (including goal).
 */
export function pathBetweenTiles(battle, fromTileIndex, toTileIndex) {
  const rt = getRuntime(battle);
  const key = `${fromTileIndex}>${toTileIndex}`;
  if (rt.pathCache.has(key)) return rt.pathCache.get(key);
  const fromTile = rt.byIndex.get(fromTileIndex);
  const toTile = rt.byIndex.get(toTileIndex);
  let result = null;
  if (fromTile && toTile) {
    const tiles = findPath(rt.byKey, fromTile, toTile);
    result = tiles ? tiles.map((t) => t.i) : null;
  }
  rt.pathCache.set(key, result);
  return result;
}

/** Cheapest path between two sites (by their tile). Returns a fresh copy, safe to mutate. */
export function pathBetweenSites(battle, fromSiteId, toSiteId) {
  const from = battle.sites[fromSiteId];
  const to = battle.sites[toSiteId];
  if (!from || !to) return null;
  const path = pathBetweenTiles(battle, from.tile, to.tile);
  return path ? path.slice() : null;
}
