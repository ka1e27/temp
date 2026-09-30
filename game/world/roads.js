// Roads: an MST over each region's settlements (A* restricted to that
// region), plus keep-to-keep roads between neighbouring regions (A* over
// the whole main landmass). ARCHITECTURE §4's "road tiles get cost 0.55".

import { hexDistance } from '../core/hex.js';
import { findPath } from '../core/pathfind.js';
import { neighborIndices } from './terrain.js';
import { ROAD_COST } from '../config/world.js';

const OPPOSITE = [3, 4, 5, 0, 1, 2];

function directionTo(a, b, cols, rows) {
  for (const { dir, index } of neighborIndices(a, cols, rows)) if (index === b) return dir;
  return -1;
}

/** Marks road bits both ways and sets every tile on the path to ROAD_COST. */
function paveRoad(path, tiles, cols, rows) {
  for (const i of path) tiles[i].cost = ROAD_COST;
  for (let k = 0; k < path.length - 1; k++) {
    const a = path[k];
    const b = path[k + 1];
    const dir = directionTo(a, b, cols, rows);
    if (dir === -1) continue; // defensive: paths from findPath are always adjacent
    tiles[a].road |= 1 << dir;
    tiles[b].road |= 1 << OPPOSITE[dir];
  }
}

function makeAStar(tiles, cols, rows, neighborFilter) {
  const neighbors = (i) => neighborIndices(i, cols, rows).map((e) => e.index).filter(neighborFilter);
  const cost = (_from, to) => tiles[to].cost;
  return (start, goal) => findPath({
    start,
    goal,
    neighbors,
    cost,
    heuristic: (i) => hexDistance(tiles[i].q, tiles[i].r, tiles[goal].q, tiles[goal].r) * ROAD_COST,
    maxNodes: tiles.length,
  });
}

/** Prim's MST over `nodeIds` using `pathOf(a,b)` (memoized) for edge cost = path length. */
function mstEdges(nodeIds, pathOf) {
  if (nodeIds.length <= 1) return [];
  const inTree = [nodeIds[0]];
  const remaining = new Set(nodeIds.slice(1));
  const edges = [];
  while (remaining.size > 0) {
    let bestA = -1, bestB = -1, bestPath = null, bestCost = Infinity;
    for (const a of inTree) {
      for (const b of remaining) {
        const path = pathOf(a, b);
        if (!path) continue;
        if (path.length < bestCost) { bestCost = path.length; bestA = a; bestB = b; bestPath = path; }
      }
    }
    if (bestB === -1) break; // unreachable pair; leave the rest unconnected rather than loop forever
    edges.push(bestPath);
    inTree.push(bestB);
    remaining.delete(bestB);
  }
  return edges;
}

/**
 * Builds every road in the world: an MST per region over its settlements,
 * plus a keep-to-keep road between every pair of adjacent regions. Mutates
 * `tiles[*].road` and `tiles[*].cost` (roads replace the terrain+river cost).
 * @param {import('./terrain.js').Tile[]} tiles
 * @param {import('./regions.js').Region[]} regions
 * @param {import('./settlements.js').Settlement[]} settlements
 * @param {boolean[]} mainLandmass
 * @param {number} cols @param {number} rows
 */
export function buildRoads(tiles, regions, settlements, mainLandmass, cols, rows) {
  // Every region's MST first: a road within a region should never need to
  // detour through a neighbour, and doing these first means the cheap
  // ROAD_COST tiles they create are already in place as a (harmless) shortcut
  // option by the time keep-to-keep pathing runs.
  for (const region of regions) {
    if (region.settlements.length <= 1) continue;
    const tileSet = new Set(region.tiles);
    const astar = makeAStar(tiles, cols, rows, (nb) => tileSet.has(nb));
    const memo = new Map();
    const pathOf = (a, b) => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (!memo.has(key)) memo.set(key, astar(a, b));
      return memo.get(key);
    };

    const nodeTiles = region.settlements.map((id) => settlements[id].tile);
    for (const path of mstEdges(nodeTiles, pathOf)) paveRoad(path, tiles, cols, rows);
  }

  const overLandmass = makeAStar(tiles, cols, rows, (nb) => mainLandmass[nb]);
  const pavedPairs = new Set();
  for (const region of regions) {
    const keepTile = settlements[region.keep].tile;
    for (const neighborId of region.neighbors) {
      if (neighborId < region.id) continue; // each pair once
      const key = `${region.id}:${neighborId}`;
      if (pavedPairs.has(key)) continue;
      pavedPairs.add(key);
      const path = overLandmass(keepTile, settlements[regions[neighborId].keep].tile);
      if (path) paveRoad(path, tiles, cols, rows);
    }
  }
}
