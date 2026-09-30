// Caravan routes (DESIGN §7.7): where the little carts of the living map may roll. PURE: builds
// polylines over the world's road bits (`tile.road`), no DOM, no randomness, no clock.
//
//  * LOCAL routes: every non-keep settlement of a player-owned region to that region's keep, by a
//    BFS over road edges that never leaves the region.
//  * TRUNK routes: every owned region's keep to the NEXT owned keep on its way to the home capital
//    (keep to keep, hop by hop, so no stretch of road is walked by two routes from different
//    regions), by a BFS from the home keep over road edges through player-owned tiles only. Where
//    no owned road path exists the region simply has no trunk (its carts end at its own keep).
//  * Each route carries a smooth world-space path: quadratic curves through every road tile that
//    follow the drawn ribbon (edge midpoint -> tile centre control -> edge midpoint, exactly the
//    geometry of `drawRoad`), with the elevation lift already subtracted from y so a renderer
//    only needs `camera.worldToScreen(x, y)`.
//
// Rebuild only when ownership changes: `buildCaravanRoutes(world, state.owner, world.startRegion)`.
import { DIRS } from '../core/hex.js';
import { AMBIENT } from '../config/ambient.js';

const PLAYER = 0;
const OPPOSITE = [3, 4, 5, 0, 1, 2];
const R3 = Math.sqrt(3);
/** Centre-to-centre world offset of each neighbour direction (half of it = the shared edge's midpoint). */
const STEP = DIRS.map((d) => ({ x: R3 * (d.q + d.r / 2), y: 1.5 * d.r }));

/** Neighbour tile index of `t` in direction `d`, or -1 off the grid. */
function neighborIndex(world, t, d) {
  const r = t.r + DIRS[d].r;
  const col = t.q + DIRS[d].q + (r - (r & 1)) / 2;
  if (col < 0 || col >= world.cols || r < 0 || r >= world.rows) return -1;
  return r * world.cols + col;
}

/**
 * The neighbour reached by the road leaving tile `i` in direction `d`, or -1. A road edge exists
 * only when BOTH tiles carry the bit (the generator always sets both).
 */
export function roadNeighbor(world, i, d) {
  const t = world.tiles[i];
  if (!(t.road & (1 << d))) return -1;
  const j = neighborIndex(world, t, d);
  if (j < 0) return -1;
  return world.tiles[j].road & (1 << OPPOSITE[d]) ? j : -1;
}

/** Direction from tile `a` to adjacent tile `b`, or -1. */
export function directionBetween(world, a, b) {
  const t = world.tiles[a];
  for (let d = 0; d < 6; d++) if (neighborIndex(world, t, d) === b) return d;
  return -1;
}

/**
 * BFS over road edges from `root` through tiles accepted by `allowed`. Returns `parent`
 * (Int32Array; toward the root, -1 for the root and for unreached tiles) and `dist` (-1 = unreached).
 */
function roadTree(world, root, allowed) {
  const n = world.tiles.length;
  const parent = new Int32Array(n).fill(-1);
  const dist = new Int32Array(n).fill(-1);
  if (!allowed(root)) return { parent, dist };
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  queue[tail++] = root;
  dist[root] = 0;
  while (head < tail) {
    const i = queue[head++];
    for (let d = 0; d < 6; d++) {
      const j = roadNeighbor(world, i, d);
      if (j < 0 || dist[j] >= 0 || !allowed(j)) continue;
      dist[j] = dist[i] + 1;
      parent[j] = i;
      queue[tail++] = j;
    }
  }
  return { parent, dist };
}

function liftOf(tile, table) {
  return table[tile.elev] ?? table[1];
}

/**
 * Smooth world-space polyline through `tiles` (a road-connected chain of tile indices).
 * y is lifted (`y - lift`) so it lies on the raised top faces where the road ribbon is drawn.
 * @returns {{ pts: Float32Array, cum: Float32Array, length: number }}
 */
export function buildPath(world, tiles, lift = AMBIENT.elevLift) {
  const xs = [];
  const ys = [];
  const push = (x, y) => { xs.push(x); ys.push(y); };
  const n = tiles.length;
  const T = tiles.map((i) => world.tiles[i]);
  const L = T.map((t) => liftOf(t, lift));

  push(T[0].x, T[0].y - L[0]);
  for (let k = 0; k < n; k++) {
    const t = T[k];
    const dirIn = k > 0 ? directionBetween(world, tiles[k], tiles[k - 1]) : -1;
    const dirOut = k < n - 1 ? directionBetween(world, tiles[k], tiles[k + 1]) : -1;
    const Lprev = k > 0 ? L[k - 1] : L[k];
    const Lnext = k < n - 1 ? L[k + 1] : L[k];
    const liftAt = (u) => L[k]
      + 0.5 * (Lprev - L[k]) * Math.max(0, 1 - 2 * u)
      + 0.5 * (Lnext - L[k]) * Math.max(0, 2 * u - 1);
    if (dirIn < 0 && dirOut >= 0) {
      // Start tile: centre -> exit edge midpoint (a one-direction ribbon is a straight stub).
      for (let s = 1; s <= 2; s++) {
        const u = (s / 2) * 0.5 + 0.5;
        const f = s / 2;
        push(t.x + STEP[dirOut].x * 0.5 * f, t.y + STEP[dirOut].y * 0.5 * f - liftAt(u));
      }
    } else if (dirOut < 0 && dirIn >= 0) {
      // End tile: entry edge midpoint -> centre.
      for (let s = 1; s <= 2; s++) {
        const f = 1 - s / 2;
        const u = (1 - f) * 0.5;
        push(t.x + STEP[dirIn].x * 0.5 * f, t.y + STEP[dirIn].y * 0.5 * f - liftAt(u));
      }
    } else if (dirIn >= 0 && dirOut >= 0) {
      const ax = t.x + STEP[dirIn].x * 0.5;
      const ay = t.y + STEP[dirIn].y * 0.5;
      const bx = t.x + STEP[dirOut].x * 0.5;
      const by = t.y + STEP[dirOut].y * 0.5;
      const straight = dirOut === OPPOSITE[dirIn];
      const steps = straight ? 2 : 6;
      for (let s = 1; s <= steps; s++) {
        const u = s / steps;
        const a = (1 - u) * (1 - u);
        const b = 2 * u * (1 - u);
        const c = u * u;
        push(a * ax + b * t.x + c * bx, a * ay + b * t.y + c * by - liftAt(u));
      }
    }
  }
  const m = xs.length;
  const pts = new Float32Array(m * 2);
  const cum = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    pts[i * 2] = xs[i];
    pts[i * 2 + 1] = ys[i];
    if (i > 0) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
  }
  return { pts, cum, length: cum[m - 1] };
}

function bboxOf(pts) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    if (pts[i] < minX) minX = pts[i];
    if (pts[i] > maxX) maxX = pts[i];
    if (pts[i + 1] < minY) minY = pts[i + 1];
    if (pts[i + 1] > maxY) maxY = pts[i + 1];
  }
  return { minX, minY, maxX, maxY };
}

/**
 * @typedef {Object} CaravanRoute
 * @property {number} id            index in the returned array
 * @property {string} key           stable identity (kind + endpoints + length) for carrying state across rebuilds
 * @property {'local'|'trunk'} kind
 * @property {number} regionId      region whose goods/income the route carries (the START region)
 * @property {number} toRegionId    region of the destination keep
 * @property {string} sourceType    settlement type at the start ('keep' for trunks)
 * @property {number} from          start tile index
 * @property {number} to            end tile index
 * @property {number[]} tiles       road-connected tile chain, start to end
 * @property {number} length        world units along the smooth path
 * @property {Float32Array} pts     x0,y0,x1,y1,... world units, y already lifted by elevation
 * @property {Float32Array} cum     cumulative length per point
 * @property {{minX:number,minY:number,maxX:number,maxY:number}} bbox
 */

function makeRoute(world, kind, regionId, toRegionId, sourceType, chain, lift) {
  const { pts, cum, length } = buildPath(world, chain, lift);
  return {
    id: -1,
    key: `${kind}:${chain[0]}>${chain[chain.length - 1]}:${chain.length}`,
    kind, regionId, toRegionId, sourceType,
    from: chain[0], to: chain[chain.length - 1],
    tiles: chain, length, pts, cum, bbox: bboxOf(pts),
  };
}

function chainUp(parent, start, isStop) {
  const chain = [start];
  let cur = start;
  for (;;) {
    const p = parent[cur];
    if (p < 0) return null; // root reached without a stop (only for the root itself)
    chain.push(p);
    if (isStop(p)) return chain;
    cur = p;
  }
}

/**
 * Builds every caravan route for the player's current realm.
 * @param {import('./generate.js').World} world
 * @param {number[]} owner region id -> owner faction id (`state.owner`)
 * @param {number} homeRegionId region whose keep the trunk roads lead to (usually `world.startRegion`)
 * @param {{ lift?: number[] }} [opts] elevation lift table override (defaults to config)
 * @returns {CaravanRoute[]} deterministic order: all local routes by region then settlement, then trunks by region
 */
export function buildCaravanRoutes(world, owner, homeRegionId = world.startRegion, opts = {}) {
  const lift = opts.lift || AMBIENT.elevLift;
  const routes = [];
  const isOwned = (r) => r >= 0 && owner[r] === PLAYER;
  const ownedRegions = world.regions.filter((r) => isOwned(r.id));
  const keepTile = (r) => world.settlements[r.keep].tile;

  // Local: settlement -> its keep, roads inside the region only.
  for (const region of ownedRegions) {
    const keep = keepTile(region);
    const { parent, dist } = roadTree(world, keep, (i) => world.tiles[i].region === region.id);
    const seen = new Set();
    for (const sid of region.settlements) {
      const s = world.settlements[sid];
      if (s.tile === keep || dist[s.tile] < 0) continue;
      const chain = chainUp(parent, s.tile, (i) => i === keep);
      if (!chain || chain.length < 2) continue;
      const route = makeRoute(world, 'local', region.id, region.id, s.type, chain, lift);
      if (seen.has(route.key)) continue;
      seen.add(route.key);
      routes.push(route);
    }
  }

  // Trunk: keep -> next owned keep toward the home capital, through owned tiles only.
  const home = world.regions[homeRegionId];
  if (home && isOwned(homeRegionId)) {
    const root = keepTile(home);
    const { parent, dist } = roadTree(world, root, (i) => isOwned(world.tiles[i].region));
    const keepRegion = new Map(); // tile -> region id, owned keeps only
    for (const r of ownedRegions) keepRegion.set(keepTile(r), r.id);
    for (const region of ownedRegions) {
      if (region.id === homeRegionId) continue;
      const keep = keepTile(region);
      if (dist[keep] < 0) continue; // no owned road path: this region's carts stop at its own keep
      const chain = chainUp(parent, keep, (i) => keepRegion.has(i));
      if (!chain || chain.length < 2) continue;
      routes.push(makeRoute(world, 'trunk', region.id, keepRegion.get(chain[chain.length - 1]), 'keep', chain, lift));
    }
  }

  routes.forEach((r, i) => { r.id = i; });
  return routes;
}

/**
 * Position and direction `dist` world units along a route, written into `out` (no allocation):
 * `{x, y, dx, dy}` with (dx, dy) a unit tangent. `dist` is clamped to [0, length].
 * @param {CaravanRoute} route
 * @param {number} dist
 * @param {{x:number,y:number,dx:number,dy:number}} out
 * @returns {typeof out}
 */
export function sampleRoute(route, dist, out) {
  const { cum, pts } = route;
  const n = cum.length;
  const d = dist < 0 ? 0 : dist > route.length ? route.length : dist;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid; else hi = mid;
  }
  const segLen = cum[hi] - cum[lo] || 1e-6;
  const f = (d - cum[lo]) / segLen;
  const x0 = pts[lo * 2];
  const y0 = pts[lo * 2 + 1];
  const x1 = pts[hi * 2];
  const y1 = pts[hi * 2 + 1];
  out.x = x0 + (x1 - x0) * f;
  out.y = y0 + (y1 - y0) * f;
  out.dx = (x1 - x0) / segLen;
  out.dy = (y1 - y0) / segLen;
  return out;
}
