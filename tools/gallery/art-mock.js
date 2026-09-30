// A small, self-contained, noise-based mock world generator for the art
// gallery ONLY. It produces Tile-contract-shaped objects (ARCHITECTURE §4)
// so tiles.js/sprites.js/clouds.js can be exercised exactly as the real
// renderer will exercise them — but it does not write into game/world (that
// module belongs to another engineer) and is not meant to be a real world
// generator: no region graph, no roads-MST, no balance.
//
// Hex conventions match ARCHITECTURE §3 exactly (pointy-top, axial q/r,
// offset odd-r storage, neighbour order E, NE, NW, W, SW, SE) so geometry
// here lines up with whatever `game/core/hex.js` ends up being.

import { TERRAIN_COST, ROAD_COST, RIVER_PENALTY } from '../../game/config/world.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- hex helpers (ARCHITECTURE §3) ----
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]; // E NE NW W SW SE

function offsetToAxial(col, row) { return { q: col - (row - (row & 1)) / 2, r: row }; }
function axialToOffset(q, r) { return { col: q + (r - (r & 1)) / 2, row: r }; }
function axialToPixel(q, r) { return { x: Math.sqrt(3) * (q + r / 2), y: 1.5 * r }; }
function opposite(d) { return (d + 3) % 6; }

export { DIRS, offsetToAxial, axialToOffset, axialToPixel };

/** Axial hex distance (ARCHITECTURE §3 neighbour geometry). */
export function hexDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** The neighbour of `tile` in direction `d` (0..5, E/NE/NW/W/SW/SE), or null off-grid. */
export function neighborTile(world, tile, d) {
  const nq = tile.q + DIRS[d][0];
  const nr = tile.r + DIRS[d][1];
  const { col, row } = axialToOffset(nq, nr);
  if (row < 0 || row >= world.rows || col < 0 || col >= world.cols) return null;
  return world.tiles[row * world.cols + col];
}

function cubeRound(x, y, z) {
  let rx = Math.round(x); let ry = Math.round(y); let rz = Math.round(z);
  const dx = Math.abs(rx - x); const dy = Math.abs(ry - y); const dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { x: rx, y: ry, z: rz };
}

/** Axial hex line between (aq,ar) and (bq,br), inclusive both ends. */
function lineBetween(aq, ar, bq, br) {
  const ac = { x: aq, y: -aq - ar, z: ar };
  const bc = { x: bq, y: -bq - br, z: br };
  const n = Math.max(Math.abs(ac.x - bc.x), Math.abs(ac.y - bc.y), Math.abs(ac.z - bc.z)) || 1;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const lx = ac.x + (bc.x - ac.x) * t;
    const ly = ac.y + (bc.y - ac.y) * t;
    const lz = ac.z + (bc.z - ac.z) * t;
    const r = cubeRound(lx, ly, lz);
    pts.push({ q: r.x, r: r.z });
  }
  return pts;
}

// ---- smooth value noise (2 octaves), just for a plausible island shape ----
function makeLattice(rng, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = rng();
  return { w, h, g };
}
function smoothstep(t) { return t * t * (3 - 2 * t); }
function sampleLattice(lat, u, v) {
  const x = u * (lat.w - 1); const y = v * (lat.h - 1);
  const x0 = Math.floor(x); const y0 = Math.floor(y);
  const x1 = Math.min(lat.w - 1, x0 + 1); const y1 = Math.min(lat.h - 1, y0 + 1);
  const sx = smoothstep(x - x0); const sy = smoothstep(y - y0);
  const g00 = lat.g[y0 * lat.w + x0]; const g10 = lat.g[y0 * lat.w + x1];
  const g01 = lat.g[y1 * lat.w + x0]; const g11 = lat.g[y1 * lat.w + x1];
  const top = g00 + (g10 - g00) * sx;
  const bot = g01 + (g11 - g01) * sx;
  return top + (bot - top) * sy;
}
function hash01(n) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * @param {number} seed
 * @param {{cols?:number, rows?:number, settlements?: Array}} [opts]
 */
export function makeMockWorld(seed, opts = {}) {
  const cols = opts.cols || 30;
  const rows = opts.rows || 22;
  const rng = mulberry32(seed);
  const heightCoarse = makeLattice(rng, 6, 5);
  const heightFine = makeLattice(rng, 13, 10);
  const moistLat = makeLattice(rng, 7, 6);

  const cx0 = (cols - 1) / 2;
  const cy0 = (rows - 1) / 2;

  const tiles = new Array(cols * rows);
  const byColRow = (col, row) => (row >= 0 && row < rows && col >= 0 && col < cols ? tiles[row * cols + col] : null);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      const { q, r } = offsetToAxial(col, row);
      const { x, y } = axialToPixel(q, r);
      const u = col / (cols - 1);
      const v = row / (rows - 1);

      let height = sampleLattice(heightCoarse, u, v) * 0.68 + sampleLattice(heightFine, u, v) * 0.32;
      const dx = (col - cx0) / (cols * 0.5);
      const dy = (row - cy0) / (rows * 0.5);
      const radial = Math.sqrt(dx * dx + dy * dy);
      height -= Math.pow(smoothstep(Math.min(1, Math.max(0, (radial - 0.15) / 0.85))), 1.4) * 0.9;
      height = Math.min(1, Math.max(0, height * 0.8 + 0.42));

      const moisture = Math.min(1, Math.max(0, sampleLattice(moistLat, u, v)));
      const jitter = hash01(i * 1.618 + seed * 7.919);

      const WATER = 0.44;
      let terrain; let elev; let land;
      if (height < WATER) {
        land = false;
        elev = 0;
        terrain = height < WATER - 0.12 ? 'deep' : height < WATER - 0.05 ? 'ocean' : 'shallows';
      } else {
        land = true;
        const northness = 1 - v; // v=0 is row 0 = north
        const southness = v;
        if (height < WATER + 0.045) {
          terrain = 'beach';
          elev = 1;
        } else if (height < WATER + 0.2) {
          elev = 1;
          if (northness > 0.86) terrain = 'snow';
          else if (southness > 0.82) terrain = moisture < 0.42 ? 'desert' : 'savanna';
          else if (moisture > 0.78 && height < WATER + 0.12) terrain = 'marsh';
          else if (moisture > 0.62) terrain = northness > 0.55 ? 'pine' : 'forest';
          else if (moisture > 0.34) terrain = 'meadow';
          else terrain = 'grass';
        } else if (height < WATER + 0.38) {
          elev = 2;
          terrain = 'hills';
        } else {
          elev = 3;
          terrain = 'mountain';
        }
      }

      tiles[i] = {
        i, col, row, q, r, x, y,
        terrain, elev, height, moisture, land,
        passable: land && terrain !== 'mountain',
        cost: 1,
        road: 0, river: 0, coast: 0,
        region: -1, settlement: -1,
        jitter,
      };
    }
  }

  // ---- coast bitmask: land tile, neighbour is water or off-map ----
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const t = byColRow(col, row);
      if (!t.land) continue;
      for (let d = 0; d < 6; d++) {
        const nq = t.q + DIRS[d][0]; const nr = t.r + DIRS[d][1];
        const { col: ncol, row: nrow } = axialToOffset(nq, nr);
        const nb = byColRow(ncol, nrow);
        if (!nb || !nb.land) t.coast |= (1 << d);
      }
    }
  }

  // ---- rivers: steepest descent from a couple of highland sources ----
  const sources = tiles.filter((t) => t.elev >= 2)
    .sort((a, b) => b.height - a.height)
    .filter((t, idx, arr) => idx === 0 || Math.hypot(t.col - arr[0].col, t.row - arr[0].row) > cols * 0.25)
    .slice(0, 2);
  for (const src of sources) {
    let cur = src;
    const visited = new Set([cur.i]);
    for (let step = 0; step < 40; step++) {
      if (!cur.land || cur.terrain === 'deep' || cur.terrain === 'ocean' || cur.terrain === 'shallows') break;
      let best = null; let bestD = -1; let bestHeight = cur.height;
      for (let d = 0; d < 6; d++) {
        const nq = cur.q + DIRS[d][0]; const nr = cur.r + DIRS[d][1];
        const { col: ncol, row: nrow } = axialToOffset(nq, nr);
        const nb = byColRow(ncol, nrow);
        if (!nb || visited.has(nb.i)) continue;
        if (nb.height < bestHeight) { bestHeight = nb.height; best = nb; bestD = d; }
      }
      if (!best) break;
      cur.river |= (1 << bestD);
      best.river |= (1 << opposite(bestD));
      visited.add(best.i);
      cur = best;
    }
  }

  // ---- settlements: hand-placed fractional positions, snapped to land ----
  const findNearestLand = (ufrac, vfrac, maxElev) => {
    const targetCol = ufrac * (cols - 1);
    const targetRow = vfrac * (rows - 1);
    let best = null; let bestD = Infinity;
    for (const t of tiles) {
      if (!t.land || t.elev > maxElev || t.settlement !== -1) continue;
      const d = (t.col - targetCol) ** 2 + (t.row - targetRow) ** 2;
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  };

  const plan = opts.settlements || [
    { u: 0.16, v: 0.62, type: 'keep', faction: 0, name: 'Wavecrest' },
    { u: 0.24, v: 0.56, type: 'camp', faction: 0, name: 'War Camp' },
    { u: 0.3, v: 0.42, type: 'village', faction: 1, name: 'Millbrook' },
    { u: 0.36, v: 0.68, type: 'hamlet', faction: 1, name: 'Oxford' },
    { u: 0.78, v: 0.24, type: 'keep', faction: 2, name: 'Redgate' },
    { u: 0.63, v: 0.3, type: 'tower', faction: 2, name: 'Ashwatch' },
    { u: 0.7, v: 0.74, type: 'town', faction: 3, name: 'Duskmere' },
    { u: 0.54, v: 0.82, type: 'fort', faction: 3, name: 'Stonevale' },
    { u: 0.5, v: 0.15, type: 'hamlet', faction: 4, name: 'Sunfen' },
  ];
  const settlements = [];
  plan.forEach((p, id) => {
    const t = findNearestLand(p.u, p.v, p.type === 'tower' || p.type === 'fort' ? 2 : 1);
    if (!t) return;
    t.settlement = id;
    settlements.push({
      id, tile: t.i, region: -1, type: p.type, faction: p.faction, name: p.name, col: t.col, row: t.row,
    });
  });

  // ---- roads: connect a hand-picked spanning set of settlement pairs ----
  const byId = (id) => settlements.find((s) => s.id === id);
  const roadPairs = [];
  for (let k = 1; k < settlements.length; k++) {
    // Nearest already-connected settlement -> cheap spanning tree, no crossings to speak of.
    let best = null; let bestD = Infinity;
    for (let j = 0; j < k; j++) {
      const a = settlements[k]; const b = settlements[j];
      const d = (a.col - b.col) ** 2 + (a.row - b.row) ** 2;
      if (d < bestD) { bestD = d; best = j; }
    }
    if (best != null) roadPairs.push([settlements[k].id, settlements[best].id]);
  }
  for (const [aId, bId] of roadPairs) {
    const a = byId(aId); const b = byId(bId);
    const ta = tiles[a.tile]; const tb = tiles[b.tile];
    const path = lineBetween(ta.q, ta.r, tb.q, tb.r);
    for (let k = 0; k < path.length - 1; k++) {
      const { col: c0, row: r0 } = axialToOffset(path[k].q, path[k].r);
      const { col: c1, row: r1 } = axialToOffset(path[k + 1].q, path[k + 1].r);
      const t0 = byColRow(c0, r0); const t1 = byColRow(c1, r1);
      if (!t0 || !t1 || !t0.land || !t1.land || t0.terrain === 'mountain' || t1.terrain === 'mountain') break;
      const dq = t1.q - t0.q; const dr = t1.r - t0.r;
      const d = DIRS.findIndex(([ddq, ddr]) => ddq === dq && ddr === dr);
      if (d < 0) continue;
      t0.road |= (1 << d);
      t1.road |= (1 << opposite(d));
    }
  }

  // ---- movement cost, now that road/river bits are final ----
  for (const t of tiles) {
    if (!t.passable) { t.cost = Infinity; continue; }
    let c = TERRAIN_COST[t.terrain] ?? 1;
    if (t.road) c = ROAD_COST;
    if (t.river) c += RIVER_PENALTY;
    t.cost = c;
  }

  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const t of tiles) {
    if (!t.land) continue;
    minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x);
    minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y);
  }

  return {
    seed, cols, rows, tiles, settlements,
    bounds: { minX, minY, maxX, maxY },
  };
}
