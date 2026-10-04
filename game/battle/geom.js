// Hex geometry and pathfinding helpers, scoped to game/battle only.
//
// game/core (owned by another engineer, hex math + shared A*) does not exist yet at the
// time this module was written. Per instructions we must not write into game/core, so this
// file carries the small subset of hex math the battle simulation needs, following the exact
// conventions in docs/ARCHITECTURE.md §3 (pointy-top, axial q/r, odd-r offset, direction
// order E/NE/NW/W/SW/SE). If game/core/hex.js and a shared A* appear later, this file's
// exports can be swapped for re-exports with no change to callers — see the note at the
// bottom of this file.
//
// Pure: no DOM, no Math.random, no Date.now.
import { RIVER_PENALTY } from '../config/world.js';

/** Axial neighbour directions, in the exact order required by ARCHITECTURE §3. */
export const DIRECTIONS = Object.freeze([
  Object.freeze({ q: 1, r: 0 }),   // E
  Object.freeze({ q: 1, r: -1 }),  // NE
  Object.freeze({ q: 0, r: -1 }),  // NW
  Object.freeze({ q: -1, r: 0 }),  // W
  Object.freeze({ q: -1, r: 1 }),  // SW
  Object.freeze({ q: 0, r: 1 }),   // SE
]);

/** World-unit distance between adjacent hex centres, for hex size = 1 (ARCHITECTURE §3). */
export const HEX_WORLD_UNIT = Math.sqrt(3);

/** @returns {string} stable map key for an axial coordinate. */
export function hexKey(q, r) {
  return `${q},${r}`;
}

/** @returns {{q:number,r:number}[]} the 6 axial neighbours of (q, r), in direction order. */
export function axialNeighbors(q, r) {
  return DIRECTIONS.map((d) => ({ q: q + d.q, r: r + d.r }));
}

/** Cube/axial hex distance between two axial points. */
export function hexDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Axial → pixel centre in world units (hex size = 1), per ARCHITECTURE §3. */
export function axialToPixel(q, r) {
  return { x: Math.sqrt(3) * (q + r / 2), y: 1.5 * r };
}

/** Euclidean distance between two {x,y} world-unit points. */
export function worldDist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Converts a hex-distance radius (e.g. tower range, firestorm radius) to world units. */
export function hexRadiusToWorld(hexes) {
  return hexes * HEX_WORLD_UNIT;
}

// ---------------------------------------------------------------------------------------
// Binary min-heap, used only by findPath below. Kept tiny and dependency-free.
// ---------------------------------------------------------------------------------------
class MinHeap {
  constructor(cmp) {
    this._cmp = cmp;
    this._a = [];
  }

  get size() {
    return this._a.length;
  }

  push(item) {
    const a = this._a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this._cmp(a[i], a[p]) < 0) {
        [a[i], a[p]] = [a[p], a[i]];
        i = p;
      } else break;
    }
  }

  pop() {
    const a = this._a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let s = i;
        if (l < a.length && this._cmp(a[l], a[s]) < 0) s = l;
        if (r < a.length && this._cmp(a[r], a[s]) < 0) s = r;
        if (s === i) break;
        [a[i], a[s]] = [a[s], a[i]];
        i = s;
      }
    }
    return top;
  }
}

// Admissible heuristic multiplier: must be <= the cheapest possible tile-entry cost anywhere
// in the game (road cost is 0.55 in game/config/world.js). Kept as a local constant rather
// than importing config/world.js so this module never depends on another engineer's tuning
// file for correctness, only for optimality-of-shortest-path (a smaller constant is still
// admissible, just a weaker heuristic).
const MIN_TERRAIN_COST = 0.5;

/**
 * Builds a q,r -> tile lookup for a set of arena tiles (passable tiles only). O(n).
 * @param {{q:number,r:number}[]} tiles
 * @returns {Map<string,object>}
 */
export function buildTileIndex(tiles) {
  const byKey = new Map();
  for (const t of tiles) byKey.set(hexKey(t.q, t.r), t);
  return byKey;
}

/**
 * A* shortest path over an arena's tile graph, cost-to-ENTER semantics: entering `t` costs
 * `t.cost`. Deterministic regardless of push/pop order: ties in f-score are broken by tile
 * index `i` ascending, so the result never depends on iteration/insertion order.
 *
 * @param {Map<string,object>} byKey  q,r -> tile (from buildTileIndex)
 * @param {{q:number,r:number}} start
 * @param {{q:number,r:number}} goal
 * @param {(tile: object) => boolean} [allow]  optional filter on tiles that may be entered (never applied to the goal)
 * @param {(tile: object) => number} [extra]  optional extra cost (>= 0) added to entering a tile, e.g. to steer a path off
 *   tiles it should avoid without forbidding them
 * @returns {object[]|null} path of tile objects from (excluding start) to (including goal),
 *   `[]` if start === goal, or `null` if unreachable.
 */
export function findPath(byKey, start, goal, allow, extra) {
  if (start.q === goal.q && start.r === goal.r) return [];
  const startKey = hexKey(start.q, start.r);
  const goalKey = hexKey(goal.q, goal.r);
  const startTile = byKey.get(startKey);
  const goalTile = byKey.get(goalKey);
  if (!startTile || !goalTile) return null;

  const gScore = new Map([[startKey, 0]]);
  const cameFrom = new Map();
  const heap = new MinHeap((a, b) => (a.f - b.f) || (a.tile.i - b.tile.i));
  heap.push({ key: startKey, tile: startTile, f: hexDistance(start, goal) * MIN_TERRAIN_COST });
  const closed = new Set();

  while (heap.size) {
    const cur = heap.pop();
    if (closed.has(cur.key)) continue;
    if (cur.key === goalKey) {
      // Reconstruct.
      const path = [];
      let k = goalKey;
      while (k !== startKey) {
        path.push(byKey.get(k));
        k = cameFrom.get(k);
      }
      path.reverse();
      return path;
    }
    closed.add(cur.key);
    const [q, r] = [cur.tile.q, cur.tile.r];
    const neighbors = axialNeighbors(q, r);
    for (let dir = 0; dir < neighbors.length; dir++) {
      const n = neighbors[dir];
      const nKey = hexKey(n.q, n.r);
      const nTile = byKey.get(nKey);
      if (!nTile || closed.has(nKey)) continue;
      if (allow && nKey !== goalKey && !allow(nTile)) continue; // front lines: only tiles this side may cross (the goal always counts)
      const baseCost = Number.isFinite(nTile.cost) ? nTile.cost + (extra ? extra(nTile) : 0) : Infinity;
      if (!Number.isFinite(baseCost)) continue;
      const cost = baseCost + riverCrossingPenalty(cur.tile, nTile, dir);
      const tentativeG = gScore.get(cur.key) + cost;
      if (tentativeG < (gScore.get(nKey) ?? Infinity)) {
        gScore.set(nKey, tentativeG);
        cameFrom.set(nKey, cur.key);
        const f = tentativeG + hexDistance(n, goal) * MIN_TERRAIN_COST;
        heap.push({ key: nKey, tile: nTile, f });
      }
    }
  }
  return null;
}

// ARCHITECTURE §4 bakes roads into `tile.cost` ("road already applied") but a river is a
// per-EDGE feature (DESIGN §4.4: "crossing a river +0.8"), recorded as a per-tile bitmask of
// which of the 6 neighbour directions carry a river. Checked from either side of the edge
// (bit `dir` on the tile being left, or the reciprocal opposite-direction bit on the tile
// being entered) so a world that only sets one side of the pair is still handled.
function riverCrossingPenalty(fromTile, toTile, dir) {
  const back = (dir + 3) % 6;
  const leaving = fromTile.river ? (fromTile.river >> dir) & 1 : 0;
  const entering = toTile.river ? (toTile.river >> back) & 1 : 0;
  if (!(leaving || entering)) return 0;
  // Flooded (DESIGN §10.13): a river edge touching a flooded tile is closed unless both banks carry a road there (a bridge)
  if (fromTile.flood || toTile.flood) {
    const bridge = ((fromTile.road >> dir) & 1) && ((toTile.road >> back) & 1);
    if (!bridge) return Infinity;
  }
  return RIVER_PENALTY;
}

// If game/core/hex.js and a shared pathfinder exist by the time this is read: this file's
// public surface (hexKey, axialNeighbors, hexDistance, axialToPixel, buildTileIndex,
// findPath) can be re-exported from there instead, unchanged for callers in this directory.
