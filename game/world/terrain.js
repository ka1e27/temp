// Continent shape, biomes, water depth and rivers (ARCHITECTURE §4, DESIGN §3.1-3.2).
// Produces the tile array before regions/settlements/roads/names are known —
// those fields are filled in later by generate.js and friends.
//
// Silhouette variety (round 2): every seed gets its own falloff rotation,
// aspect and centre offset, PLUS a shared domain warp applied to every noise
// sample (elevation, coastal detail, ridges, temperature, moisture) so the
// same swirl bends coastlines, mountain ranges and biome boundaries
// together. A high-frequency "coastal detail" layer, weighted up only near
// the shoreline, is what actually carves peninsulas/bays/fjords — the base
// falloff alone only ever produces smooth ellipses. Biomes classify from
// continuous (temperature, moisture, relative elevation) fields rather than
// hard latitude bands, so they form patches, not stripes.

import { DIRS, offsetToAxial, axialToOffset, axialToPixel, inBounds, tileIndex } from '../core/hex.js';
import { createNoise2D, fbm } from '../core/noise.js';
import { hash32 } from '../core/rng.js';
import { TERRAIN_COST, RIVER_PENALTY, BEACH, ISLET } from '../config/world.js';
import { connectedComponents, fixPassableConnectivity } from './connectivity.js';
import { coastSides, trimBeach } from './beaches.js';
import { computeRivers } from './rivers.js';
import { carveLakes } from './lakes.js';

const MOUNTAIN_FRAC = 0.07;  // top 7% of combined ridge/height score
const HILLS_FRAC = 0.10;     // next 10%
const EDGE_MARGIN = 2;       // hard ocean ring at the grid edge, in tiles
const RADIAL_EDGE_START = 0.6;
const RADIAL_STRENGTH = 1.15;
const WARP_AMOUNT = 7;       // world units; shared by every noise layer below
const COAST_DETAIL_STRENGTH = 0.4;
const RIDGE_WEIGHT = 0.55;   // ridged-noise vs plain height-rank, for mountain/hill placement
const ELEV_COOLING = 0.28;   // temperature penalty per unit of raw height (highlands run cooler)
const TEMP_NOISE_AMP = 0.3;
// Calibrated against the temperature formula's output over LAND tiles
// specifically (not every grid cell) — the falloff concentrates land toward
// the middle latitudes, so land's temperature distribution runs warmer at
// both ends than the full grid's would suggest.
const COLD_T = 0.04; // ~12th percentile
const HOT_T = 0.70;  // ~91st percentile

/**
 * Tile indices (and the direction id used to reach them) of the valid
 * neighbours of tile `i` in a `cols` x `rows` offset ("odd-r") grid. Shared
 * by every world-gen module that needs grid adjacency (regions, roads,
 * settlements) — not part of core/hex.js because it's specific to how THIS
 * grid is laid out in memory, not hex math itself.
 * @returns {{ dir: number, index: number }[]}
 */
export function neighborIndices(i, cols, rows) {
  const row = Math.floor(i / cols);
  const col = i - row * cols;
  const { q, r } = offsetToAxial(col, row);
  const out = [];
  for (let d = 0; d < DIRS.length; d++) {
    const off = axialToOffset(q + DIRS[d].q, r + DIRS[d].r);
    if (inBounds(off.col, off.row, cols, rows)) {
      out.push({ dir: d, index: tileIndex(off.col, off.row, cols) });
    }
  }
  return out;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Percentile rank (0..1) of each entry in `values`, restricted to `idx`. */
function percentileRank(values, idx) {
  const rank = new Float64Array(values.length);
  const sorted = [...idx].sort((a, b) => values[a] - values[b]);
  sorted.forEach((i, k) => { rank[i] = sorted.length > 1 ? k / (sorted.length - 1) : 1; });
  return rank;
}

/** Plain multi-source BFS (uniform step cost) over the tile grid. */
function bfsDistance(seedIndices, cols, rows) {
  const dist = new Float64Array(cols * rows).fill(Infinity);
  const queue = [];
  let head = 0;
  for (const i of seedIndices) {
    if (dist[i] !== 0) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  while (head < queue.length) {
    const cur = queue[head++];
    const d = dist[cur] + 1;
    for (const { index: nb } of neighborIndices(cur, cols, rows)) {
      if (d < dist[nb]) {
        dist[nb] = d;
        queue.push(nb);
      }
    }
  }
  return dist;
}

/**
 * Water depth by distance-to-land: shallows touch land; ocean is the mid band; anything further out
 * is deep. Runs for every non-land tile (and again after stray islets are erased).
 */
function labelWater(terrain, elev, land, cols, rows) {
  const n = cols * rows;
  const distToLand = bfsDistance((function* () {
    for (let i = 0; i < n; i++) if (land[i]) yield i;
  })(), cols, rows);
  for (let i = 0; i < n; i++) {
    if (land[i]) continue;
    terrain[i] = distToLand[i] <= 1 ? 'shallows' : distToLand[i] <= 4 ? 'ocean' : 'deep';
    elev[i] = 0;
  }
}

/**
 * Elevation (domain-warped fbm + a per-seed rotated/offset elliptical falloff,
 * plus a coastal-only detail layer for real peninsulas/bays), ridged-noise
 * mountain ranges, and an organic (temperature, moisture, relative elevation)
 * biome classification. Returns the raw height/moisture the contract wants
 * kept for shading, decoupled from the shaped/adjusted values used here.
 */
function classify(seed, rng, cols, rows, geometry) {
  const n = cols * rows;
  const { x: xs, y: ys } = geometry;
  const freq = 2.1 / Math.max(cols, rows);

  const elevNoise = createNoise2D(hash32(seed, 'elevation', rng.int(0, 0x7fffffff)));
  const moistNoise = createNoise2D(hash32(seed, 'moisture', rng.int(0, 0x7fffffff)));
  const tempNoise = createNoise2D(hash32(seed, 'temperature', rng.int(0, 0x7fffffff)));
  const warpNoise = createNoise2D(hash32(seed, 'warp', rng.int(0, 0x7fffffff)));
  const coastNoise = createNoise2D(hash32(seed, 'coast', rng.int(0, 0x7fffffff)));
  const ridgeNoise = createNoise2D(hash32(seed, 'ridge', rng.int(0, 0x7fffffff)));

  // Per-seed silhouette: rotation/aspect/offset of the falloff ellipse, so
  // continents differ in overall outline, not just coastline texture.
  const rotation = rng.range(0, Math.PI);
  const aspect = rng.range(0.72, 1.4);
  const offsetX = rng.range(-0.12, 0.12);
  const offsetY = rng.range(-0.12, 0.12);

  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < n; i++) {
    if (xs[i] < xMin) xMin = xs[i];
    if (xs[i] > xMax) xMax = xs[i];
    if (ys[i] < yMin) yMin = ys[i];
    if (ys[i] > yMax) yMax = ys[i];
  }
  const cx = (xMin + xMax) / 2 + offsetX * (xMax - xMin);
  const cy = (yMin + yMax) / 2 + offsetY * (yMax - yMin);
  const rx = (xMax - xMin) / 2;
  const ry = (yMax - yMin) / 2;
  const cosR = Math.cos(rotation), sinR = Math.sin(rotation);

  const height = new Float64Array(n);    // raw 0..1, for shading only
  const moisture = new Float64Array(n);  // raw 0..1
  const shaped = new Float64Array(n);    // elevation + falloff + coastal detail, classification only
  const ridged = new Float64Array(n);    // ridged-noise value, for mountain/hill placement
  const temperature = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    // Shared domain warp: every layer below samples at (wx, wy) instead of
    // (x, y), so the same swirl bends the coastline, ridges and biome
    // boundaries together rather than each looking independently noisy.
    const wx = xs[i] + fbm(warpNoise, xs[i] * freq * 0.6, ys[i] * freq * 0.6, { octaves: 2 }) * WARP_AMOUNT;
    const wy = ys[i] + fbm(warpNoise, xs[i] * freq * 0.6 + 91.7, ys[i] * freq * 0.6 + 91.7, { octaves: 2 }) * WARP_AMOUNT;

    const h = fbm(elevNoise, wx * freq, wy * freq, { octaves: 5, lacunarity: 2, gain: 0.5 });
    height[i] = clamp01((h + 1) / 2);

    const dx = xs[i] - cx, dy = ys[i] - cy;
    const rdx = dx * cosR + dy * sinR;
    const rdy = -dx * sinR + dy * cosR;
    const nx = rx > 0 ? rdx / (rx * aspect) : 0;
    const ny = ry > 0 ? rdy / (ry / aspect) : 0;
    const radial = Math.sqrt(nx * nx + ny * ny);
    // Clamp to [0,1] BEFORE the cubic: smoothstep is only monotonic there,
    // and radial reaches ~1.4 at the grid's corners. Unclamped, edge > 1.5
    // turns the cubic negative — a huge elevation BOOST instead of a
    // penalty, which is how corner tiles once came out as spurious mountains.
    const edge = clamp01((radial - RADIAL_EDGE_START) / (1 - RADIAL_EDGE_START));
    const penalty = edge * edge * (3 - 2 * edge) * RADIAL_STRENGTH; // smoothstep

    // Coastal detail: a higher-frequency layer weighted up only near where
    // the shoreline will land (by RADIAL position, not by the land/water
    // result itself — using the result would be circular). This is what
    // actually produces peninsulas, bays and fjord-like inlets; the base
    // falloff alone only ever draws a smooth ellipse.
    const coastWeight = clamp01((radial - 0.3) / 0.55);
    const coastDetail = fbm(coastNoise, wx * freq * 2.4, wy * freq * 2.4, { octaves: 3 });
    shaped[i] = height[i] - penalty + coastDetail * coastWeight * COAST_DETAIL_STRENGTH;

    const rn = fbm(ridgeNoise, wx * freq * 0.5, wy * freq * 0.5, { octaves: 3, lacunarity: 2.1, gain: 0.5 });
    ridged[i] = 1 - Math.abs(rn); // peaks near rn's zero-crossings: long, curving ridge lines

    moisture[i] = clamp01((fbm(moistNoise, wx * freq * 0.55, wy * freq * 0.55, { octaves: 3 }) + 1) / 2);

    const latT = rows > 1 ? geometry.row(i) / (rows - 1) : 0;
    const tempN = fbm(tempNoise, wx * freq * 0.8, wy * freq * 0.8, { octaves: 4 });
    temperature[i] = latT + tempN * TEMP_NOISE_AMP - height[i] * ELEV_COOLING;
  }

  // Sea level chosen so land tiles are ~WORLD.landFraction of the WHOLE
  // grid, using only tiles outside the hard edge margin as candidates (that
  // margin is guaranteed ocean regardless of what the noise says).
  const marginOk = [];
  for (let i = 0; i < n; i++) {
    const row = geometry.row(i), col = geometry.col(i);
    if (col >= EDGE_MARGIN && col < cols - EDGE_MARGIN && row >= EDGE_MARGIN && row < rows - EDGE_MARGIN) marginOk.push(i);
  }
  const sortedShaped = [...marginOk].sort((a, b) => shaped[a] - shaped[b]);
  const targetLandCount = Math.round(geometry.landFraction * n);
  const seaLevelIdx = Math.max(0, Math.min(sortedShaped.length - 1, sortedShaped.length - targetLandCount));
  const seaLevel = shaped[sortedShaped[seaLevelIdx]];

  const land = new Uint8Array(n);
  for (const i of marginOk) land[i] = shaped[i] >= seaLevel ? 1 : 0;

  // Mountain/hill placement: a blend of ridged-noise (long curving ranges)
  // and plain height rank (so ranges still sit on genuinely higher ground),
  // thresholded by percentile so the fractions stay on target regardless of
  // the exact noise constants above.
  const landIdx = [];
  for (let i = 0; i < n; i++) if (land[i]) landIdx.push(i);
  const heightRank = percentileRank(shaped, landIdx);
  const combined = new Float64Array(n);
  for (const i of landIdx) combined[i] = ridged[i] * RIDGE_WEIGHT + heightRank[i] * (1 - RIDGE_WEIGHT);
  const combinedRank = percentileRank(combined, landIdx);

  const mountainCut = 1 - MOUNTAIN_FRAC;
  const hillsCut = 1 - MOUNTAIN_FRAC - HILLS_FRAC;

  const terrain = new Array(n).fill('deep');
  const elev = new Uint8Array(n);
  const lowlandIdx = [];
  for (const i of landIdx) {
    if (combinedRank[i] >= mountainCut) {
      terrain[i] = 'mountain';
      elev[i] = 3;
    } else if (combinedRank[i] >= hillsCut) {
      terrain[i] = 'hills';
      elev[i] = 2;
    } else {
      elev[i] = 1;
      lowlandIdx.push(i);
    }
  }

  // Relative elevation WITHIN the lowland band (0 = lowest lying, 1 = just
  // under the hills cut) — separately ranked, since combinedRank mixes in
  // ridge proximity that isn't meaningful for "how low-lying is this tile".
  const lowlandRank = percentileRank(shaped, lowlandIdx);

  const distToWater = bfsDistance((function* () {
    for (let i = 0; i < n; i++) if (!land[i]) yield i;
  })(), cols, rows);

  for (const i of lowlandIdx) {
    const relElev = lowlandRank[i];
    const temp = temperature[i];
    // Additive, not blended: a weighted average with water proximity would
    // scale the raw signal down by the water term's weight for every tile
    // that ISN'T near water (most of the map), crushing moisture inland and
    // making forest all but disappear regardless of its threshold below.
    const moist = clamp01(moisture[i] + Math.max(0, 1 - distToWater[i] / 6) * 0.22);

    // Thresholds below are calibrated against the ACTUAL (temp, moist,
    // relElev) distributions this formula produces (see the design doc's
    // target mix), not guessed round numbers — relElev is a percentile rank
    // so it is exactly uniform, which is what makes e.g. "snow needs
    // relElev > 0.80" a clean way to carve out a specific target share of
    // the cold zone.
    if (temp < COLD_T) {
      terrain[i] = relElev > 0.80 ? 'snow' : 'pine';
    } else if (temp > HOT_T) {
      terrain[i] = moist < 0.56 ? 'desert' : 'savanna';
    } else if (moist > 0.73 && relElev < 0.35) {
      terrain[i] = 'marsh';
    } else if (moist > 0.58) {
      terrain[i] = 'forest';
    } else if (moist > 0.49) {
      terrain[i] = 'meadow';
    } else {
      terrain[i] = 'grass';
    }
  }

  labelWater(terrain, elev, land, cols, rows);

  const relElevOut = new Float64Array(n);
  for (const i of lowlandIdx) relElevOut[i] = lowlandRank[i];

  return { terrain, elev, height, moisture, land, shaped, relElev: relElevOut };
}

const BEACHABLE = new Set(['grass', 'meadow', 'savanna', 'desert']);
const GREEN = new Set(['grass', 'meadow', 'forest', 'pine']);

/**
 * Beach is a thin coastal fringe (config BEACH): only LOW-lying (lowland rank <= maxRelElev), EXPOSED
 * (two or more water-facing sides) coastal tiles of open ground become beach, and of those only a
 * hash-chosen share (`keep`); tiles with a single water side (sheltered bays, river mouths) keep at a
 * much lower rate. No randomness is consumed: the choice is a pure function of (seed, tile).
 * @returns {Map<number, {base: string, rel: number}>} every beach tile with the terrain it replaced
 */
function applyBeach(seed, terrain, land, coast, relElev, cols, rows) {
  const n = cols * rows;
  const info = new Map();
  for (let i = 0; i < n; i++) {
    if (!land[i] || coast[i] === 0 || relElev[i] > BEACH.maxRelElev || !BEACHABLE.has(terrain[i])) continue;
    const keep = coastSides(coast[i]) >= 2 ? BEACH.keep : BEACH.singleSideKeep;
    if (hash32(seed, 'beach', i) / 4294967296 >= keep) continue;
    info.set(i, { base: terrain[i], rel: relElev[i] });
    terrain[i] = 'beach';
  }
  return info;
}

/** Erases every non-main land component smaller than ISLET.minTiles (stray tiles next to the coast). */
function removeSmallIslets(components, largest, land, terrain, elev) {
  let removed = 0;
  components.forEach((tiles, c) => {
    if (c === largest || tiles.length >= ISLET.minTiles) return;
    for (const i of tiles) {
      land[i] = 0;
      terrain[i] = 'shallows';
      elev[i] = 0;
    }
    removed++;
  });
  return removed;
}

/** Bitmask (land tiles only) of neighbour directions that are water. */
function computeCoast(land, cols, rows) {
  const n = cols * rows;
  const coast = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    if (!land[i]) continue;
    let mask = 0;
    for (const { dir, index: nb } of neighborIndices(i, cols, rows)) {
      if (!land[nb]) mask |= 1 << dir;
    }
    coast[i] = mask;
  }
  return coast;
}

/**
 * Decorative islets (4+ tiles, not the main landmass) must not be pure beach: their beach share is
 * trimmed to ISLET/BEACH.isletCap and at least one tile is grass, meadow, forest or pine.
 */
function greenIslets(components, largest, terrain, cost, beachInfo, coast, moisture, river) {
  const setTerrain = (i, name) => {
    terrain[i] = name;
    cost[i] = TERRAIN_COST[name] + (river[i] !== 0 ? RIVER_PENALTY : 0);
  };
  components.forEach((tiles, c) => {
    if (c === largest || tiles.length < ISLET.minTiles) return;
    trimBeach(tiles, Math.floor(BEACH.isletCap * tiles.length), beachInfo, (i) => coast[i], (i) => terrain[i] === 'beach', (i, base) => setTerrain(i, base));
    if (tiles.some((i) => GREEN.has(terrain[i]))) return;
    // Nothing green left (the islet sat in the hot band, or was all beach over desert): plant one tile,
    // the wettest one, with trees if it is moist enough and grass otherwise.
    const pick = tiles.filter((i) => terrain[i] !== 'mountain')
      .sort((a, b) => moisture[b] - moisture[a] || a - b)[0];
    if (pick !== undefined) setTerrain(pick, moisture[pick] > 0.45 ? 'forest' : 'grass');
  });
}

/**
 * @param {number} seed
 * @param {import('../core/rng.js').Rng} rng forked for the 'terrain' phase
 * @param {number} cols @param {number} rows @param {number} landFraction
 */
export function generateTerrain(seed, rng, cols, rows, landFraction) {
  const n = cols * rows;
  const col = new Int32Array(n);
  const row = new Int32Array(n);
  const q = new Int32Array(n);
  const r = new Int32Array(n);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    row[i] = Math.floor(i / cols);
    col[i] = i - row[i] * cols;
    const axial = offsetToAxial(col[i], row[i]);
    q[i] = axial.q;
    r[i] = axial.r;
    const p = axialToPixel(axial.q, axial.r);
    x[i] = p.x;
    y[i] = p.y;
  }

  const { terrain, elev, height, moisture, land, shaped: shapedElev, relElev } = classify(seed, rng, cols, rows, {
    x, y, landFraction, row: (i) => row[i], col: (i) => col[i],
  });

  const { components } = connectedComponents(land, cols, rows);
  let largest = 0;
  for (let c = 1; c < components.length; c++) {
    if (components[c].length > components[largest].length) largest = c;
  }
  // Stray 1-3 tile islets read as loose tiles beside the playable coast: erase them and re-depth the water.
  if (removeSmallIslets(components, largest, land, terrain, elev) > 0) labelWater(terrain, elev, land, cols, rows);
  const mainLandmass = new Uint8Array(n);
  for (const i of components[largest] ?? []) mainLandmass[i] = 1;

  // 0-2 small inland lakes: carved out of the main landmass's interior,
  // never allowed to fracture it (see lakes.js for the connectivity check).
  carveLakes(rng.fork('lakes'), terrain, elev, land, mainLandmass, shapedElev, cols, rows, neighborIndices);

  const cost = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const passable = !!land[i] && terrain[i] !== 'mountain';
    cost[i] = passable ? TERRAIN_COST[terrain[i]] : Infinity;
  }

  fixPassableConnectivity(terrain, elev, cost, mainLandmass, cols, rows);

  const river = computeRivers(rng, terrain, elev, shapedElev, mainLandmass, cols, rows);
  // A river tile costs a bit more to enter unless it's bridged by a road;
  // roads.js overwrites `cost` to ROAD_COST for any tile it routes through,
  // which is what "unless the tile has a road = bridge" means in practice.
  for (let i = 0; i < n; i++) {
    if (river[i] !== 0 && land[i] && terrain[i] !== 'mountain') cost[i] += RIVER_PENALTY;
  }

  const coast = computeCoast(land, cols, rows);
  const beachInfo = applyBeach(seed, terrain, land, coast, relElev, cols, rows);
  // Beach replaces terrain but keeps the same elev(1)/cost(TERRAIN_COST.beach).
  for (let i = 0; i < n; i++) {
    if (land[i] && terrain[i] === 'beach') cost[i] = TERRAIN_COST.beach + (river[i] !== 0 ? RIVER_PENALTY : 0);
  }
  greenIslets(components, largest, terrain, cost, beachInfo, coast, moisture, river);

  const tiles = [];
  for (let i = 0; i < n; i++) {
    tiles.push({
      i, col: col[i], row: row[i], q: q[i], r: r[i], x: x[i], y: y[i],
      terrain: terrain[i],
      elev: elev[i],
      height: height[i],
      moisture: moisture[i],
      land: !!land[i],
      passable: !!land[i] && terrain[i] !== 'mountain',
      cost: cost[i],
      road: 0,
      river: river[i],
      coast: coast[i],
      region: -1,
      settlement: -1,
      jitter: hash32(seed, 'jitter', i) / 4294967296,
    });
  }

  return { tiles, mainLandmass: Array.from(mainLandmass, (v) => !!v), beachInfo };
}
