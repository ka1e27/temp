// Archipelago continents (docs/PLAN-PHASE12.md §12A). Pure and seeded from hashes only (no shared RNG stream is consumed), so it never
// touches a land continent: generate.js calls applyArchipelago only when opts.archipelago is set.
//
// The continent is generated exactly as usual; then its regions are dealt into 3-5 islands (contiguous groups on the region graph, the
// start region's island the largest), and the boundary tiles between two islands become FORDS: shallow sea that squads cross at
// FORD.marchMult x the cost of open ground. A ford keeps its region (so region adjacency, tiers, factions and arenas are unchanged in
// shape) but is sea for everything else: `land: false`, `passable: true`, `terrain: 'ford'`, `ford: true`, `elev: 0`. Each island gets
// 1-2 HARBOURS (coastal settlements, `settlement.harbour = true`) and the ports of different islands are joined by SEA LANES.
//
//   archipelagoFor(seed, dynasty)             -> boolean  the seeded 1-in-3 chance from dynasty 3
//   applyArchipelago(seed, tiles, regions, settlements, startRegion, cols, rows) -> { islands, harbours, seaLanes }  (MUTATES)
//   isOpenSea(tile) / touchesOpenSea(tiles, i, cols, rows) / seaPath(tiles, fromSet, toSet, cols, rows, maxTiles, allow?)
import { hash32 } from '../core/rng.js';
import { hexDistance } from '../core/hex.js';
import { neighborIndices } from './terrain.js';
import { ARCHIPELAGO, FORD, HARBOUR, LANE } from '../config/sea.js';

/** True when a founding at this dynasty level makes an archipelago (PLAN 12A: from dynasty 3, a seeded 1-in-3 chance). */
export function archipelagoFor(seed, dynasty) {
  const level = Math.max(1, Math.floor(Number(dynasty)) || 1);
  if (level < ARCHIPELAGO.fromDynasty) return false;
  return (hash32(seed >>> 0, 'archipelago', level) >>> 7) % ARCHIPELAGO.chanceOneIn === 0;
}

/** Open sea: water that is not a ford (the lanes sail on it, harbours face it). */
export function isOpenSea(tile) {
  return !!tile && !tile.land && !tile.ford;
}

/** True when tile `i` touches open sea. */
export function touchesOpenSea(tiles, i, cols, rows) {
  return neighborIndices(i, cols, rows).some(({ index }) => isOpenSea(tiles[index]));
}

/**
 * Shortest path over open-sea tiles (BFS, ties by tile index) from any tile of `fromSet` to any of `toSet` (both Sets of open-sea tile
 * indices), at most `maxTiles` tiles long; `allow(i)` may narrow the sea further. Returns the tile indices (first to last) or null.
 */
export function seaPath(tiles, fromSet, toSet, cols, rows, maxTiles, allow = null) {
  const prev = new Map();
  const dist = new Map();
  let queue = [...fromSet].sort((a, b) => a - b);
  for (const i of queue) { dist.set(i, 1); prev.set(i, -1); }
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    if (toSet.has(cur)) {
      const path = [];
      for (let k = cur; k !== -1; k = prev.get(k)) path.push(k);
      return path.reverse();
    }
    const d = dist.get(cur);
    if (d >= maxTiles) continue;
    for (const { index } of neighborIndices(cur, cols, rows)) {
      if (dist.has(index) || !isOpenSea(tiles[index]) || (allow && !allow(index))) continue;
      dist.set(index, d + 1);
      prev.set(index, cur);
      queue.push(index);
    }
  }
  queue = null;
  return null;
}

/** Region-graph BFS distances from `src`. */
function graphDist(regions, src) {
  const d = new Array(regions.length).fill(Infinity);
  d[src] = 0;
  const q = [src];
  for (let h = 0; h < q.length; h++) for (const n of regions[q[h]].neighbors) if (d[n] === Infinity) { d[n] = d[q[h]] + 1; q.push(n); }
  return d;
}

/** Deals the regions into `k` contiguous islands; island 0 holds the start region. null when a valid split is impossible. */
function dealIslands(seed, regions, startRegion, k, startWeight) {
  const n = regions.length;
  const seeds = [startRegion];
  const dists = [graphDist(regions, startRegion)];
  while (seeds.length < k) {
    let best = -1;
    let bestKey = null;
    for (let r = 0; r < n; r++) {
      if (seeds.includes(r)) continue;
      const m = Math.min(...dists.map((d) => d[r]));
      if (!Number.isFinite(m)) continue;
      const key = [m, hash32(seed >>> 0, 'archSeed', r)];
      if (!bestKey || key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) { best = r; bestKey = key; }
    }
    if (best < 0) return null;
    seeds.push(best);
    dists.push(graphDist(regions, best));
  }
  const island = new Array(n).fill(-1);
  const sizes = new Array(k).fill(1);
  seeds.forEach((r, j) => { island[r] = j; });
  const weight = (j) => (j === 0 ? startWeight : 1);
  for (let left = n - k; left > 0; left--) {
    let pick = null;
    for (let j = 0; j < k; j++) {
      let cand = null;
      for (let r = 0; r < n; r++) {
        if (island[r] !== j) continue;
        for (const nb of regions[r].neighbors) {
          if (island[nb] !== -1) continue;
          const key = [dists[j][nb], hash32(seed >>> 0, 'archGrow', nb)];
          if (!cand || key[0] < cand.key[0] || (key[0] === cand.key[0] && key[1] < cand.key[1])) cand = { r: nb, key };
        }
      }
      if (!cand) continue;
      const load = sizes[j] / weight(j);
      if (!pick || load < pick.load) pick = { j, r: cand.r, load };
    }
    if (!pick) return null; // disconnected leftovers: not on this map
    island[pick.r] = pick.j;
    sizes[pick.j] += 1;
  }
  return { island, sizes };
}

/**
 * Picks the split: the seeded island count, fewer when an island would be too small or have no harbour site (every island needs a
 * settlement on the open sea: an island ringed only by straits could hold no port), the start island always the largest.
 */
function chooseSplit(seed, regions, startRegion, portable) {
  const [lo, hi] = ARCHIPELAGO.islands;
  const want = lo + (hash32(seed >>> 0, 'archIslands') % (hi - lo + 1));
  for (let k = Math.min(want, Math.floor(regions.length / ARCHIPELAGO.minIslandRegions)); k >= 2; k--) {
    for (let w = ARCHIPELAGO.startWeight, tries = 0; tries < 6; tries++, w *= 1.25) {
      const deal = dealIslands(seed, regions, startRegion, k, w);
      if (!deal) break;
      if (Math.min(...deal.sizes) < ARCHIPELAGO.minIslandRegions) break;
      const ported = new Set(regions.filter((r) => portable(r)).map((r) => deal.island[r.id]));
      if (ported.size < k) continue;
      if (deal.sizes.every((s, j) => j === 0 || s < deal.sizes[0])) return { k, ...deal };
    }
  }
  return null;
}

/** Cuts the straits: every land tile touching a tile of another island becomes a ford (settlement tiles stay dry). MUTATES tiles. */
function cutStraits(tiles, island, cols, rows) {
  const fords = [];
  for (const t of tiles) {
    if (t.region < 0 || !t.land || t.settlement >= 0) continue;
    const mine = island[t.region];
    if (neighborIndices(t.i, cols, rows).some(({ index }) => tiles[index].region >= 0 && island[tiles[index].region] !== mine)) fords.push(t.i);
  }
  const cost = FORD.baseCost * FORD.marchMult;
  for (const i of fords) {
    const t = tiles[i];
    Object.assign(t, { terrain: 'ford', land: false, passable: true, cost, elev: 0, ford: true, coast: 0 });
    // a river that reaches a strait ends there (on both banks of the edge), as it would at the sea
    if (t.river) {
      for (const { dir, index } of neighborIndices(i, cols, rows)) if ((t.river >> dir) & 1) tiles[index].river &= ~(1 << ((dir + 3) % 6));
      t.river = 0;
    }
  }
  // the shoreline moved: every land tile's coast mask (bit d = neighbour d is water) is rebuilt
  for (const t of tiles) {
    if (!t.land) continue;
    let mask = 0;
    for (const { dir, index } of neighborIndices(t.i, cols, rows)) if (!tiles[index].land) mask |= 1 << dir;
    t.coast = mask;
  }
  return fords;
}

const HARBOUR_TYPE_ORDER = Object.freeze({ town: 0, village: 1, hamlet: 2, fort: 3, tower: 4, keep: 5 });

/** 1-2 harbours per island: coastal settlements facing open sea, towns and villages first, the second far from the first. */
function placeHarbours(seed, tiles, regions, settlements, islands, cols, rows) {
  const out = [];
  islands.forEach((regionIds, j) => {
    const cands = regionIds.flatMap((r) => regions[r].settlements).map((id) => settlements[id])
      .filter((s) => touchesOpenSea(tiles, s.tile, cols, rows))
      .sort((a, b) => (HARBOUR_TYPE_ORDER[a.type] ?? 9) - (HARBOUR_TYPE_ORDER[b.type] ?? 9)
        || hash32(seed >>> 0, 'harbour', j, a.id) - hash32(seed >>> 0, 'harbour', j, b.id) || a.id - b.id);
    if (!cands.length) return;
    const picked = [cands[0]];
    if (regionIds.length >= HARBOUR.secondFromRegions && HARBOUR.perIsland[1] > 1) {
      const t0 = tiles[cands[0].tile];
      const far = cands.slice(1).map((s) => ({ s, d: hexDistance(t0.q, t0.r, tiles[s.tile].q, tiles[s.tile].r) }))
        .filter((x) => x.d >= HARBOUR.minGap).sort((a, b) => b.d - a.d || a.s.id - b.s.id)[0];
      if (far) picked.push(far.s);
    }
    for (const s of picked) { s.harbour = true; out.push(s.id); }
  });
  return out.sort((a, b) => a - b);
}

/** The open-sea tiles next to a settlement (where its boats put out). */
function quaySet(tiles, s, cols, rows) {
  return new Set(neighborIndices(s.tile, cols, rows).map((e) => e.index).filter((i) => isOpenSea(tiles[i])));
}

/** A lane for every pair of islands: between their two nearest ports by sea, if within LANE.worldMaxTiles sea tiles. */
function buildLanes(tiles, regions, settlements, harbours, island, cols, rows) {
  const lanes = [];
  const isl = (id) => island[settlements[id].region];
  const k = Math.max(-1, ...harbours.map(isl)) + 1;
  for (let a = 0; a < k; a++) {
    for (let b = a + 1; b < k; b++) {
      let best = null;
      for (const pa of harbours.filter((id) => isl(id) === a)) {
        for (const pb of harbours.filter((id) => isl(id) === b)) {
          const path = seaPath(tiles, quaySet(tiles, settlements[pa], cols, rows), quaySet(tiles, settlements[pb], cols, rows), cols, rows, LANE.worldMaxTiles);
          if (path && (!best || path.length < best.tiles.length)) best = { a: pa, b: pb, tiles: path };
        }
      }
      if (best) lanes.push({ id: lanes.length, a: best.a, b: best.b, tiles: best.tiles, cost: +(LANE.tileCost * (best.tiles.length + 1)).toFixed(3) });
    }
  }
  return lanes;
}

/**
 * Turns a generated continent into an archipelago (PLAN 12A). Called by generate.js after settlements and roads, before perks and
 * features. MUTATES tiles (fords, coast masks), regions (`island`, `coastal`) and settlements (`harbour`).
 * @returns {{ islands: number[][], harbours: number[], seaLanes: object[], fords: number }|null} null when the map cannot be split
 */
export function applyArchipelago(seed, tiles, regions, settlements, startRegion, cols, rows) {
  // a region can host a harbour when one of its settlements touches open sea (straits only ever turn land into fords, so this holds after)
  const portable = (r) => r.settlements.some((id) => touchesOpenSea(tiles, settlements[id].tile, cols, rows));
  const split = chooseSplit(seed, regions, startRegion, portable);
  if (!split) return null;
  const islands = Array.from({ length: split.k }, () => []);
  regions.forEach((r) => { r.island = split.island[r.id]; islands[r.island].push(r.id); });
  const fords = cutStraits(tiles, split.island, cols, rows);
  for (const r of regions) r.coastal = r.tiles.some((i) => tiles[i].land && tiles[i].coast !== 0);
  const harbours = placeHarbours(seed, tiles, regions, settlements, islands, cols, rows);
  const seaLanes = buildLanes(tiles, regions, settlements, harbours, split.island, cols, rows);
  return { islands, harbours, seaLanes, fords: fords.length };
}

const quayCache = new WeakMap();

/**
 * The tile of a region's QUAY (PLAN 12A: "a region that touches the sea gets a harbour site in its arena"): on an archipelago, a coastal
 * region without a harbour settlement of its own gets a small harbour site in its attack arena, here (and the map may draw a jetty
 * here). A free tile of the region touching open sea (2+ hexes from its settlements), about 2 hexes from the keep (nearest to 2, then nearest, then index).
 * null on a land continent, for a region with a harbour settlement (that settlement is its harbour site) or with no free coastal tile.
 */
export function quayTile(world, regionId) {
  if (!world || !world.archipelago) return null;
  let m = quayCache.get(world);
  if (!m) quayCache.set(world, (m = new Map()));
  if (m.has(regionId)) return m.get(regionId);
  const region = world.regions[regionId];
  let out = null;
  if (region && !region.settlements.some((id) => world.settlements[id].harbour)) {
    const keep = world.tiles[world.settlements[region.keep].tile];
    const homes = region.settlements.map((id) => world.tiles[world.settlements[id].tile]);
    const cands = region.tiles.map((i) => world.tiles[i])
      .filter((t) => t.passable && !t.ford && t.settlement === -1 && touchesOpenSea(world.tiles, t.i, world.cols, world.rows)
        && homes.every((h) => hexDistance(h.q, h.r, t.q, t.r) >= 2))
      .map((t) => ({ t, d: hexDistance(t.q, t.r, keep.q, keep.r) }))
      .sort((a, b) => Math.abs(a.d - 2) - Math.abs(b.d - 2) || a.d - b.d || a.t.i - b.t.i);
    if (cands.length) out = cands[0].t.i;
  }
  m.set(regionId, out);
  return out;
}

/** The harbour settlement ids of a region (its own ports), [] on a land continent. */
export function regionHarbours(world, regionId) {
  const region = world && world.archipelago ? world.regions[regionId] : null;
  return region ? region.settlements.filter((id) => world.settlements[id].harbour) : [];
}
