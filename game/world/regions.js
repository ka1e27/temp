// Region seeding, partitioning, contiguity/size fix-up and metadata
// (ARCHITECTURE §4, DESIGN §3.2). Tiers (BFS distance from the start region)
// live here too, since they're computed straight off the region adjacency
// graph this module builds. Faction/capital assignment is factions.js.

import { hexDistance, offsetToAxial } from '../core/hex.js';
import { dijkstraMulti } from '../core/pathfind.js';
import { neighborIndices } from './terrain.js';
import { START } from '../config/world.js';

const MIN_REGION_TILES = 10;

function axialOf(i, cols) {
  const row = Math.floor(i / cols);
  return offsetToAxial(i - row * cols, row);
}

/** Connected components of `labels`, restricted to entries matching `label`. */
function componentsOfLabel(labels, label, cols, rows) {
  const n = labels.length;
  const seen = new Uint8Array(n);
  const components = [];
  for (let start = 0; start < n; start++) {
    if (labels[start] !== label || seen[start]) continue;
    const tiles = [];
    const queue = [start];
    seen[start] = 1;
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      tiles.push(cur);
      for (const { index: nb } of neighborIndices(cur, cols, rows)) {
        if (labels[nb] === label && !seen[nb]) {
          seen[nb] = 1;
          queue.push(nb);
        }
      }
    }
    components.push(tiles);
  }
  return components;
}

/** The bordering label that shares the most edges with `pocketTiles`. */
function bestBorderingLabel(pocketTiles, labels, cols, rows) {
  const votes = new Map();
  for (const i of pocketTiles) {
    for (const { index: nb } of neighborIndices(i, cols, rows)) {
      const l = labels[nb];
      if (l === labels[i] || l === -1) continue;
      votes.set(l, (votes.get(l) ?? 0) + 1);
    }
  }
  let best = -1, bestVotes = -1;
  for (const [label, count] of votes) {
    if (count > bestVotes || (count === bestVotes && label < best)) {
      best = label;
      bestVotes = count;
    }
  }
  return best;
}

const GREEN = new Set(['grass', 'meadow', 'forest', 'pine']);

/** True for the terrains that make a start region look lush (beach, savanna, desert, marsh, rock do not). */
export function isGreen(terrain) {
  return GREEN.has(terrain);
}

/**
 * Every viable start tile, best first: a coastal, passable, main-landmass tile in the west/south-west
 * of the grid with plenty of land around it (DESIGN's "gentle, legible start") AND a lush
 * neighbourhood (round 3: the start region is the first screen a player sees, so a beach or savanna
 * start is penalised). Deterministic; ties go to the lower tile index.
 */
export function rankStartTiles(tiles, mainLandmass, cols, rows) {
  const pool = [];
  for (const t of tiles) {
    if (!mainLandmass[t.i] || !t.passable || t.coast === 0) continue;
    pool.push(t);
  }
  // Rule out the north/east outright (the start is meant to sit toward the west/south-west); fall back to
  // everything on grids too small or odd for the band to contain a coast.
  const band = pool.filter((t) => t.col < cols * 0.6 && t.row > rows * 0.2);
  const candidates = band.length >= 3 ? band : pool;

  const scored = candidates.map((t) => {
    const normX = cols > 1 ? t.col / (cols - 1) : 0; // 0 west .. 1 east
    const normY = rows > 1 ? t.row / (rows - 1) : 0; // 0 north .. 1 south
    const swBias = (1 - normX) * 0.5 + normY * 0.5;  // 1 = ideal SW corner

    let land = 0;
    let near = 0;
    let green = 0;
    for (const [nb, d] of ringDistances(t.i, cols, rows, 6)) {
      if (!mainLandmass[nb] || !tiles[nb].passable) continue;
      land++;
      if (d <= START.lushRadius) {
        near++;
        if (GREEN.has(tiles[nb].terrain)) green++;
      }
    }
    const density = land / 91; // 91 = tiles in a hex-radius-6 disc, incl. centre
    const lush = near > 0 ? green / near : 0;

    // SW bias dominates: round 2 lets the continent's own falloff rotate freely for silhouette variety, so
    // a shape's "natural" corner can land anywhere in grid-space. Density breaks ties among similarly SW
    // candidates, and lushness (capped, so a rainforest does not drag the start across the map) keeps the
    // first screen green.
    const score = swBias * 0.82 + density * 0.18 + START.lushWeight * Math.min(lush, START.lushCap);
    return { i: t.i, score };
  });
  scored.sort((x, y) => y.score - x.score || x.i - y.i);
  return scored.map((c) => c.i);
}

/**
 * Pick the region-1 seed tile (the best of `rankStartTiles`; generate.js walks further down the
 * ranking when the region that forms around it is not lush enough).
 */
export function pickStartTile(tiles, mainLandmass, cols, rows) {
  const ranked = rankStartTiles(tiles, mainLandmass, cols, rows);
  return ranked.length ? ranked[0] : -1;
}

/**
 * Share of a region's tiles that are green (grass, meadow, forest, pine) and that are beach.
 * @param {object[]} tiles
 * @param {ArrayLike<number>} labels region label per tile
 * @param {number} label
 */
export function regionComposition(tiles, labels, label) {
  let n = 0;
  let green = 0;
  let beach = 0;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== label) continue;
    n++;
    if (GREEN.has(tiles[i].terrain)) green++;
    else if (tiles[i].terrain === 'beach') beach++;
  }
  return { tiles: n, green: n ? green / n : 0, beach: n ? beach / n : 0 };
}

/** Tile index -> hex distance for every tile within `radius` of tile `i` (BFS, grid-aware). */
function ringDistances(i, cols, rows, radius) {
  const seen = new Map([[i, 0]]);
  const queue = [i];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const d = seen.get(cur);
    if (d >= radius) continue;
    for (const { index: nb } of neighborIndices(cur, cols, rows)) {
      if (!seen.has(nb)) {
        seen.set(nb, d + 1);
        queue.push(nb);
      }
    }
  }
  return seen;
}

/** All tile indices within hex-radius `radius` of tile `i` (BFS, grid-aware). */
function ringWithin(i, cols, rows, radius) {
  return [...ringDistances(i, cols, rows, radius).keys()];
}

/** Circle-packing radius (in hexes) that would enclose `tileCount` hexes. */
function radiusForArea(tileCount) {
  return Math.sqrt(tileCount / Math.PI);
}

/**
 * Farthest-point-sampling seed placement: near-start spacing is tight (small
 * regions), far spacing is loose (big regions), per WORLD.near/farRegionTiles.
 * @returns {number[]} tile indices, seeds[0] is always `startTile`
 */
export function placeRegionSeeds(rng, tiles, mainLandmass, cols, rows, startTile, worldCfg) {
  const candidates = [];
  for (const t of tiles) if (mainLandmass[t.i] && t.passable) candidates.push(t.i);

  const startAxial = axialOf(startTile, cols);
  const maxDist = Math.max(cols, rows);
  const nearR = radiusForArea((worldCfg.nearRegionTiles[0] + worldCfg.nearRegionTiles[1]) / 2) * 1.7;
  const farR = radiusForArea((worldCfg.farRegionTiles[0] + worldCfg.farRegionTiles[1]) / 2) * 1.7;

  // Axial coordinates of every candidate once, and the distance to the nearest seed so far kept up to
  // date as seeds are added (same result as re-measuring against every seed each round, at a fraction
  // of the cost: the start-tile search in generate.js runs this for several candidate starts).
  const cq = new Int32Array(candidates.length);
  const cr = new Int32Array(candidates.length);
  const required = new Float64Array(candidates.length);
  candidates.forEach((c, k) => {
    const ca = axialOf(c, cols);
    cq[k] = ca.q;
    cr[k] = ca.r;
    const d = hexDistance(startAxial.q, startAxial.r, ca.q, ca.r) / maxDist;
    required[k] = nearR + (farR - nearR) * Math.min(1, d);
  });
  const nearest = new Float64Array(candidates.length).fill(Infinity);
  const addSeed = (tileIndex) => {
    const sa = axialOf(tileIndex, cols);
    for (let k = 0; k < candidates.length; k++) {
      const d = hexDistance(cq[k], cr[k], sa.q, sa.r);
      if (d < nearest[k]) nearest[k] = d;
    }
  };

  const seeds = [startTile];
  addSeed(startTile);
  const target = worldCfg.regionCount;
  const maxSeeds = target + 3;
  const absoluteFloor = 2; // never allow seeds closer than this, regardless of spacing formula

  for (let placed = 1; placed < maxSeeds; placed++) {
    let best = -1;
    let bestDist = -1;
    let bestOk = -1;
    let bestOkDist = -1;
    for (let k = 0; k < candidates.length; k++) {
      const d = nearest[k];
      if (d > bestDist) { bestDist = d; best = candidates[k]; }
      if (d >= required[k] && d > bestOkDist) { bestOkDist = d; bestOk = candidates[k]; }
    }
    if (bestOk !== -1) {
      seeds.push(bestOk);
      addSeed(bestOk);
    } else if (best !== -1 && bestDist >= absoluteFloor && seeds.length < target) {
      // Relax: geometry doesn't allow the ideal spacing here, but we're still
      // short of the target count, so take the best available.
      seeds.push(best);
      addSeed(best);
    } else {
      break;
    }
  }
  return seeds;
}

/**
 * Multi-source Dijkstra region assignment (mountains cost ~4, so borders
 * prefer ridgelines), then contiguity and minimum-size fix-ups. Returns a
 * label per tile (-1 for non-main-landmass tiles) using the ORIGINAL seed
 * index as the label — NOT yet a compact 0..N-1 id (see compactLabels).
 */
export function assignRegionLabels(tiles, mainLandmass, seeds, cols, rows) {
  const n = tiles.length;
  const neighborsFn = (i) => neighborIndices(i, cols, rows)
    .map((e) => e.index).filter((nb) => mainLandmass[nb]);
  const costFn = (_from, to) => (tiles[to].terrain === 'mountain' ? 4 : 1);

  const { source } = dijkstraMulti({ sources: seeds, neighbors: neighborsFn, cost: costFn });
  const labels = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) if (mainLandmass[i]) labels[i] = source.get(i) ?? -1;

  fixContiguity(labels, cols, rows);
  mergeSmallLabels(labels, tiles, cols, rows);
  fixContiguity(labels, cols, rows); // a merge can rarely re-open a seam; cheap to re-check
  return labels;
}

/** Reassigns every non-largest connected piece of each label to whatever label borders it most. */
function fixContiguity(labels, cols, rows) {
  for (let guard = 0; guard < 8; guard++) {
    let changed = false;
    const present = new Set();
    for (const l of labels) if (l !== -1) present.add(l);

    for (const label of [...present].sort((a, b) => a - b)) {
      const comps = componentsOfLabel(labels, label, cols, rows);
      if (comps.length <= 1) continue;
      let largest = 0;
      for (let c = 1; c < comps.length; c++) if (comps[c].length > comps[largest].length) largest = c;
      for (let c = 0; c < comps.length; c++) {
        if (c === largest) continue;
        const dest = bestBorderingLabel(comps[c], labels, cols, rows);
        if (dest === -1) continue; // isolated speck with no main-landmass neighbour at all
        for (const i of comps[c]) labels[i] = dest;
        changed = true;
      }
    }
    if (!changed) return;
  }
}

/**
 * Merges every region under MIN_REGION_TILES of PASSABLE tiles into its
 * best-bordering neighbour. Passable, not total, tile count: a region can
 * claim plenty of tiles yet be mostly mountain (Dijkstra assignment only
 * discourages that with a cost of ~4, it doesn't forbid it), leaving too
 * little livable space for even one non-keep settlement at the required
 * spacing — merging it away is simpler and more robust than trying to make
 * settlement placement cope with an arbitrarily small pocket.
 *
 * Label 0 (the START region's seed) is eligible like any other — an early
 * version protected it from ever being merged away, but that just traded
 * one failure for another: it kept `World.startRegion` from pointing at
 * nothing, but also kept a start region that happened to Dijkstra-assign
 * only a handful of tiles stuck that small forever. compactLabels traces
 * the start TILE's final label after merging (whatever it ends up being),
 * so letting label 0 merge like anything else is actually safe.
 */
function mergeSmallLabels(labels, tiles, cols, rows) {
  for (let guard = 0; guard < 64; guard++) {
    const counts = new Map();
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] === -1 || !tiles[i].passable) continue;
      counts.set(labels[i], (counts.get(labels[i]) ?? 0) + 1);
    }
    const allLabels = new Set(labels.filter((l) => l !== -1));
    if (allLabels.size <= 1) return;

    let smallest = -1, smallestCount = Infinity;
    for (const label of allLabels) {
      const count = counts.get(label) ?? 0;
      if (count < MIN_REGION_TILES && count < smallestCount) { smallest = label; smallestCount = count; }
    }
    if (smallest === -1) return; // nothing left under the floor

    const memberTiles = [];
    for (let i = 0; i < labels.length; i++) if (labels[i] === smallest) memberTiles.push(i);
    const dest = bestBorderingLabel(memberTiles, labels, cols, rows);
    if (dest === -1) return; // should not happen on a connected landmass
    for (const i of memberTiles) labels[i] = dest;
  }
}

/**
 * Compacts original-seed-index labels into 0..N-1, in the original seed
 * placement order (so the start region keeps id 0 in the common case where
 * label 0 survives merging untouched — but see below, that's no longer
 * guaranteed, and this handles it either way).
 *
 * startRegion is found by tracing the START TILE ITSELF (seeds[0]) to
 * whatever label it currently carries — not by assuming label 0 is still
 * that tile's label. mergeSmallLabels can fold label 0 into a neighbour
 * (and that neighbour into another, etc.) when the start's own Dijkstra
 * assignment came out too small to stand on its own; following the tile
 * rather than the original label number is what makes that safe.
 * @returns {{ labels: Int32Array, startRegion: number }}
 */
export function compactLabels(labels, seeds) {
  const survivors = [];
  const present = new Set(labels);
  seeds.forEach((_seedTile, originalIndex) => {
    if (present.has(originalIndex)) survivors.push(originalIndex);
  });
  const remap = new Map(survivors.map((orig, newId) => [orig, newId]));
  const out = new Int32Array(labels.length).fill(-1);
  for (let i = 0; i < labels.length; i++) if (labels[i] !== -1) out[i] = remap.get(labels[i]);
  return { labels: out, startRegion: remap.get(labels[seeds[0]]) };
}

const TERRAIN_ORDER = [
  'grass', 'meadow', 'forest', 'pine', 'hills', 'mountain', 'snow',
  'savanna', 'desert', 'marsh', 'beach',
];

/** Builds Region objects with tiles/neighbors/centroid/bbox/biome/coastal filled in. */
export function buildRegions(tiles, labels, regionCount) {
  const regions = Array.from({ length: regionCount }, (_, id) => ({
    id, name: '', tiles: [], neighbors: [], centroid: { x: 0, y: 0 },
    bbox: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    keep: -1, settlements: [], tier: -1, faction: -1, isCapital: false,
    biome: 'grass', perk: '', coastal: false,
  }));

  const terrainCounts = Array.from({ length: regionCount }, () => new Map());

  for (const t of tiles) {
    const id = labels[t.i];
    if (id === -1) continue;
    const region = regions[id];
    region.tiles.push(t.i);
    region.centroid.x += t.x;
    region.centroid.y += t.y;
    region.bbox.minX = Math.min(region.bbox.minX, t.x);
    region.bbox.minY = Math.min(region.bbox.minY, t.y);
    region.bbox.maxX = Math.max(region.bbox.maxX, t.x);
    region.bbox.maxY = Math.max(region.bbox.maxY, t.y);
    if (t.coast !== 0) region.coastal = true;
    terrainCounts[id].set(t.terrain, (terrainCounts[id].get(t.terrain) ?? 0) + 1);
  }

  for (const region of regions) {
    if (region.tiles.length > 0) {
      region.centroid.x /= region.tiles.length;
      region.centroid.y /= region.tiles.length;
    }
    let bestTerrain = 'grass', bestCount = -1;
    for (const [terrain, count] of terrainCounts[region.id]) {
      if (count > bestCount || (count === bestCount && TERRAIN_ORDER.indexOf(terrain) < TERRAIN_ORDER.indexOf(bestTerrain))) {
        bestTerrain = terrain;
        bestCount = count;
      }
    }
    region.biome = bestTerrain;
  }

  return regions;
}

/** Fills region.neighbors from grid adjacency (needs cols/rows, unlike buildRegions' other fields). */
export function computeRegionNeighbors(regions, labels, cols, rows) {
  const sets = regions.map(() => new Set());
  for (let i = 0; i < labels.length; i++) {
    const id = labels[i];
    if (id === -1) continue;
    for (const { index: nb } of neighborIndices(i, cols, rows)) {
      const nid = labels[nb];
      if (nid !== -1 && nid !== id) sets[id].add(nid);
    }
  }
  regions.forEach((region, id) => { region.neighbors = [...sets[id]].sort((a, b) => a - b); });
}

/** BFS tiers over the region adjacency graph, start region = tier 0. */
export function computeTiers(regions, startRegion) {
  for (const region of regions) region.tier = -1;
  regions[startRegion].tier = 0;
  const queue = [startRegion];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    for (const nb of regions[cur].neighbors) {
      if (regions[nb].tier === -1) {
        regions[nb].tier = regions[cur].tier + 1;
        queue.push(nb);
      }
    }
  }
}
