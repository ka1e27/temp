// Pure hex-tile drawing (DESIGN §7.1). Every function is `(ctx, ..., cx, cy, s, ...)`
// in screen-space pixels — no camera, no caching, no state. `s` is the hex size
// (centre-to-corner). Callers draw whole rows back-to-front (row 0 first) so a
// tile's top face naturally overlaps the skirts of the tiles behind it.
//
// Elevation: land tiles are drawn with their top face raised by `elevOffset(tile, s)`
// and a darker "skirt" fills the gap down to the tile's actual (unraised) `cy`.
// `cx, cy` passed to every function below is always the UNRAISED tile centre;
// each function shifts internally where it needs to. The hex primitives at the
// bottom (`hexPath`, `drawHexTint`, `drawHexEdge`) take no `tile`, so a caller
// drawing on top of the raised face (e.g. territory tint) must pre-subtract
// `elevOffset(tile, s)` from `cy` itself before calling them.
//
// Split into helper files to stay under ARCHITECTURE's ~500-line guideline;
// every export below is still the complete, stable public API of `tiles.js`
// (`tiles-decor.js` is an internal implementation detail, never imported
// directly by anything outside this directory).

import {
  TERRAIN_COLORS, RIVER_COLOR, ROAD_COLOR, ROAD_EDGE_COLOR,
  FOAM_COLOR, ROCK_GREY, shade, mix, rgba,
} from './palette.js';
import { drawTileDecor } from './tiles-decor.js';
import {
  OCEAN_BASE, drawOceanBase, WATER_SPLAT_MARGIN, drawWaterSplat, drawWaterGlints,
} from './tiles-water.js';

export { drawTileDecor };
// Water (art-direction round 3): the sea is a continuous splatted field, not
// filled hexes — see tiles-water.js for the full recipe. Re-exported here so
// `tiles.js` stays the one import path for everything in this directory.
export {
  OCEAN_BASE, drawOceanBase, WATER_SPLAT_MARGIN, drawWaterSplat, drawWaterGlints,
};

/** @typedef {import('./palette.js').Terrain} Terrain */
/**
 * @typedef {Object} Tile
 * @property {number} i
 * @property {Terrain} terrain
 * @property {0|1|2|3} elev
 * @property {number} height 0..1
 * @property {boolean} [land]
 * @property {number} jitter 0..1, stable per-tile random
 * @property {number} river bitmask, bit d = river toward neighbour dir d
 * @property {number} road bitmask, bit d = road toward neighbour dir d
 * @property {number} coast bitmask, bit d = neighbour dir d is water
 */

// ------------------------------------------------------------- hex geometry
// Pointy-top hex, corners starting at the top vertex going clockwise (matches
// ARCHITECTURE §3 `hexCorners`). Neighbour direction order is
// [E, NE, NW, W, SW, SE] (ARCHITECTURE §3); DIR_EDGE_K maps a direction to the
// index of the first of its two corners.
const DIR_EDGE_K = [1, 0, 5, 4, 3, 2];

/**
 * The 6 corners of a pointy-top hex, starting at the top vertex, clockwise.
 * @param {number} cx
 * @param {number} cy
 * @param {number} s
 * @returns {[number, number][]}
 */
export function hexCorners(cx, cy, s) {
  const pts = new Array(6);
  for (let k = 0; k < 6; k++) {
    const ang = ((-90 + 60 * k) * Math.PI) / 180;
    pts[k] = [cx + s * Math.cos(ang), cy + s * Math.sin(ang)];
  }
  return pts;
}

/** Trace the hex path on `ctx` (caller fills/strokes/clips). */
export function hexPath(ctx, cx, cy, s) {
  const p = hexCorners(cx, cy, s);
  ctx.beginPath();
  ctx.moveTo(p[0][0], p[0][1]);
  for (let k = 1; k < 6; k++) ctx.lineTo(p[k][0], p[k][1]);
  ctx.closePath();
}

/**
 * Flat colour tint over an entire hex (territory fill). Uses an 'overlay'
 * blend so the terrain's own light/dark texture still shows through instead
 * of flattening into a muddy, desaturated wash — a straight alpha blend of a
 * cool tint over green terrain reads as olive/khaki (DESIGN feedback).
 */
export function drawHexTint(ctx, cx, cy, s, color, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'overlay';
  hexPath(ctx, cx, cy, s);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/**
 * Stroke just the shared edge with one neighbour direction (territory border).
 * `dir` follows the ARCHITECTURE §3 neighbour order: 0=E 1=NE 2=NW 3=W 4=SW 5=SE.
 */
export function drawHexEdge(ctx, cx, cy, s, dir, color, width, dash) {
  const p = hexCorners(cx, cy, s);
  const k = DIR_EDGE_K[((dir % 6) + 6) % 6];
  const a = p[k];
  const b = p[(k + 1) % 6];
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.setLineDash(dash && dash.length ? dash : []);
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
  ctx.restore();
}

function edgePoints(cx, cy, s, dir) {
  const p = hexCorners(cx, cy, s);
  const k = DIR_EDGE_K[((dir % 6) + 6) % 6];
  return [p[k], p[(k + 1) % 6]];
}

function edgeMid(cx, cy, s, dir) {
  const [a, b] = edgePoints(cx, cy, s, dir);
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

// ------------------------------------------------------------------ elevation

const ELEV_SKIRT_FRAC = [0, 0.22, 0.34, 0.5]; // water, lowland, hills, mountain
// Below this hex size the full 2.5D skirt is dropped for land tiles (DESIGN
// feedback: at world-overview zoom the skirt band under every tile reads as
// a dark grid rather than elevation) in favour of a much subtler bevel.
const SKIRT_MIN_S = 16;

/**
 * How far (screen pixels) a tile's top face is raised above its true `cy`,
 * i.e. the height of its skirt. Exported so callers of the elevation-agnostic
 * hex helpers (territory tint/edges) can align to the raised top face.
 * @param {Tile} tile
 * @param {number} s
 * @returns {number}
 */
export function elevOffset(tile, s) {
  const lvl = tile && Number.isFinite(tile.elev) ? tile.elev : 0;
  return (ELEV_SKIRT_FRAC[lvl] ?? ELEV_SKIRT_FRAC[1]) * s;
}

function fillQuad(ctx, p1, p2, p3, p4, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(p1[0], p1[1]);
  ctx.lineTo(p2[0], p2[1]);
  ctx.lineTo(p3[0], p3[1]);
  ctx.lineTo(p4[0], p4[1]);
  ctx.closePath();
  ctx.fill();
}

/**
 * Is this tile water (land === false, or — for hand-built tiles that omit
 * `land`, which the contract always sets but a quick test fixture might
 * not — a water-family terrain name)? Exported as a convenience: since
 * water is no longer drawn by `drawTileBase` at all (round 3), a caller
 * baking a chunk needs this same test to decide whether to call
 * `drawWaterSplat` instead.
 * @param {Tile} tile
 * @returns {boolean}
 */
export function isWaterTile(tile) {
  if (tile.land === true) return false;
  if (tile.land === false) return true;
  return tile.terrain === 'deep' || tile.terrain === 'ocean' || tile.terrain === 'shallows';
}

function terrainTopColor(tile) {
  let c = TERRAIN_COLORS[tile.terrain] || '#7a7a7a';
  const rocky = tile.elev >= 2;
  // Hills/mountains cluster at the high end of the 0..1 height range by
  // construction, so the same shading amplitude as lowland would bias them
  // systematically lighter ("pale puddle" / "flat grey slab" feedback);
  // halve it for raised terrain.
  const jitterScale = tile.terrain === 'mountain' ? 0.05 : 0.08;
  const j = (typeof tile.jitter === 'number' ? tile.jitter : 0.5) - 0.5; // -0.5..0.5
  c = shade(c, j * jitterScale);
  const h = typeof tile.height === 'number' ? tile.height : 0.5;
  c = shade(c, (h - 0.5) * (rocky ? 0.03 : 0.06));
  if (tile.terrain === 'mountain') {
    // A warm rocky undertone instead of a flat grey slab.
    c = mix(c, '#8a7458', 0.22);
  }
  return c;
}

// Very subtle low-zoom substitute for the full skirt: a ~1px edge a little
// darker/lighter than the tile, only on the two "downhill" edges plus a
// highlight on the "uphill" one, so tiles still read as gently raised
// without a dark band tiling into a grid across the whole landmass.
function bevelEdges(ctx, cx, topCy, s, base) {
  const light = rgba(shade(base, 0.12), 0.55);
  const shadowStrong = rgba(shade(base, -0.16), 0.6);
  const shadowWeak = rgba(shade(base, -0.09), 0.45);
  drawHexEdge(ctx, cx, topCy, s, 2, light, 1); // NW: catches the light
  drawHexEdge(ctx, cx, topCy, s, 5, shadowStrong, 1); // SE: falls into shadow
  drawHexEdge(ctx, cx, topCy, s, 4, shadowWeak, 1); // SW: mild shadow
}

/**
 * The 2.5D top face + skirt of one LAND tile. `cx, cy` is the tile's true
 * (unraised) centre; the top face is drawn raised by `elevOffset`.
 *
 * No-ops for water tiles (art-direction round 3): the sea is a continuous
 * splatted field, not filled hexes — see tiles-water.js. A caller that (out
 * of habit) still calls `drawTileBase` on every tile regardless of
 * land/water is safe, it just won't draw anything for water; drive the
 * actual water render from `drawOceanBase` + `drawWaterSplat` instead.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Tile} tile
 * @param {number} cx
 * @param {number} cy
 * @param {number} s
 */
export function drawTileBase(ctx, tile, cx, cy, s) {
  if (isWaterTile(tile)) return;

  const off = elevOffset(tile, s);
  const topCy = cy - off;
  const base = terrainTopColor(tile);

  if (off > 0.6 && s >= SKIRT_MIN_S) {
    const top = hexCorners(cx, topCy, s);
    const bot = hexCorners(cx, cy, s);
    const rocky = tile.elev >= 2;
    const leftBase = rocky ? mix(base, ROCK_GREY, 0.4) : base;
    const rightBase = rocky ? mix(base, ROCK_GREY, 0.52) : base;
    // Light from top-left (DESIGN §7.1): lower-right skirt darker than lower-left.
    const leftColor = shade(leftBase, -0.26);
    const rightColor = shade(rightBase, -0.4);
    fillQuad(ctx, top[2], top[3], bot[3], bot[2], rightColor);
    fillQuad(ctx, top[3], top[4], bot[4], bot[3], leftColor);
  } else if (tile.elev >= 1) {
    bevelEdges(ctx, cx, topCy, s, base);
  }

  hexPath(ctx, cx, topCy, s);
  if (s >= 20) {
    // Subtle painterly gradient, light from top-left. Skipped at tiny sizes
    // (world-overview zoom) where it would be invisible but not free.
    const g = ctx.createLinearGradient(cx - s * 0.7, topCy - s * 0.7, cx + s * 0.5, topCy + s * 0.6);
    g.addColorStop(0, shade(base, 0.08));
    g.addColorStop(0.6, base);
    g.addColorStop(1, shade(base, -0.07));
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = base;
  }
  ctx.fill();
}

// -------------------------------------------------------------- rivers/roads

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function strokePath(ctx, pts, color, width, cap) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = cap || 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
  ctx.stroke();
}

function ribbonThroughTile(ctx, cx, cy, s, bits, colors, widths, wiggle) {
  const dirs = [];
  for (let d = 0; d < 6; d++) if (bits & (1 << d)) dirs.push(d);
  if (dirs.length === 0) return;

  const passes = colors.length;
  const mids = dirs.map((d) => edgeMid(cx, cy, s, d));

  if (mids.length === 1) {
    for (let p = 0; p < passes; p++) strokePath(ctx, [[cx, cy], mids[0]], colors[p], widths[p]);
    return;
  }

  // One continuous path through every edge midpoint, via a control point
  // near the centre (nudged by `wiggle` for a natural meander) — for the
  // common 2-direction case this is a single smooth curve corner-to-corner.
  const ctrlX = cx + wiggle;
  const ctrlY = cy + wiggle * 0.6;
  for (let p = 0; p < passes; p++) {
    ctx.strokeStyle = colors[p];
    ctx.lineWidth = widths[p];
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(mids[0][0], mids[0][1]);
    for (let k = 1; k < mids.length; k++) {
      ctx.quadraticCurveTo(ctrlX, ctrlY, mids[k][0], mids[k][1]);
    }
    ctx.stroke();
  }
  // Confluence dot so 3+ way joins don't show a gap at the centre.
  if (mids.length > 2) {
    ctx.fillStyle = colors[colors.length - 1];
    ctx.beginPath();
    ctx.arc(cx, cy, widths[widths.length - 1] * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * River ribbon across a tile, following `tile.river` bits, on the raised top face.
 */
export function drawRiver(ctx, tile, cx, cy, s) {
  if (!tile.river) return;
  const topCy = cy - elevOffset(tile, s);
  const j = (typeof tile.jitter === 'number' ? tile.jitter : 0.5) - 0.5;
  const wiggle = j * s * 0.3;
  const bank = shade(RIVER_COLOR, -0.3);
  const glint = shade(RIVER_COLOR, 0.28);
  ribbonThroughTile(
    ctx, cx, topCy, s, tile.river,
    [bank, RIVER_COLOR, rgba(glint, 0.6)],
    [s * 0.32, s * 0.22, s * 0.08],
    wiggle,
  );
}

/**
 * Dirt road across a tile, following `tile.road` bits, on the raised top face.
 */
export function drawRoad(ctx, tile, cx, cy, s) {
  if (!tile.road) return;
  const topCy = cy - elevOffset(tile, s);
  ribbonThroughTile(
    ctx, cx, topCy, s, tile.road,
    [ROAD_EDGE_COLOR, ROAD_COLOR],
    [s * 0.26, s * 0.16],
    0,
  );
}

/**
 * Foam/beach rim on water-facing edges (`tile.coast`), drawn at the true
 * (unraised) waterline — where the tile's skirt actually meets the sea —
 * so it lines up with flat water tiles regardless of the land's elevation.
 */
export function drawCoastFoam(ctx, tile, cx, cy, s) {
  if (!tile.coast) return;
  for (let d = 0; d < 6; d++) {
    if (!(tile.coast & (1 << d))) continue;
    const [a, b] = edgePoints(cx, cy, s, d);
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const nx = -(b[1] - a[1]);
    const ny = b[0] - a[0];
    const len = Math.hypot(nx, ny) || 1;
    const inX = (nx / len) * s * 0.1;
    const inY = (ny / len) * s * 0.1;
    // Wet-sand band, just inside the edge.
    ctx.strokeStyle = rgba('#fff7df', 0.16);
    ctx.lineWidth = s * 0.22;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a[0] + inX, a[1] + inY);
    ctx.lineTo(b[0] + inX, b[1] + inY);
    ctx.stroke();
    // Foam line, gently scalloped.
    ctx.strokeStyle = rgba(FOAM_COLOR, 0.82);
    ctx.lineWidth = Math.max(1, s * 0.07);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.quadraticCurveTo(mx + nx / len * s * 0.06, my + ny / len * s * 0.06, b[0], b[1]);
    ctx.stroke();
    // A couple of foam bubbles along the seam.
    ctx.fillStyle = rgba(FOAM_COLOR, 0.6);
    for (const t of [0.32, 0.68]) {
      const bx = a[0] + (b[0] - a[0]) * t;
      const by = a[1] + (b[1] - a[1]) * t;
      ctx.beginPath();
      ctx.arc(bx, by, Math.max(0.8, s * 0.045), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ------------------------------------------------------------------- fields

// Crop colours: a small warm palette (wheat, ripe gold, green crop, young crop, fallow), kept close
// to grass so farmland is an accent on the biome, not a quilt over it.
const FIELD_TONES = ['#e8d17c', '#e0b95c', '#a2c766', '#94c060', '#c8a86c'];

/**
 * Farm plots for a land tile adjacent to a hamlet/village/town (DESIGN §7.1): two to four soft-edged
 * rounded plots (a shared field orientation per tile, each with its own crop colour, faint furrows and
 * a thin hedge edge), with plenty of grass left between them. Deterministic per `seed`; everything
 * stays inside the tile's top face.
 * `cx, cy` should already be the tile's top-face position (pre-shifted by the caller using
 * `elevOffset`, same as the hex primitives below). Pass the `tile` as the last argument and the road
 * and river ribbons that run across it are painted again on top of the plots, so farmland never hides
 * them.
 */
export function drawFarmFields(ctx, cx, cy, s, seed, tile) {
  const rng = mulberry32((seed >>> 0) || 1);
  const rot = Math.floor(rng() * 6) * (Math.PI / 6) + (rng() - 0.5) * 0.35;
  const roll = rng();
  const count = roll < 0.34 ? 2 : roll < 0.76 ? 3 : 4;
  const A = 0.66; // half extents of the layout box, in hex units; its corners stay inside the hex
  const B = 0.56;
  const GAP = 0.1;
  const jit = () => (rng() - 0.5);
  const cells = []; // [u0, u1, v0, v1]
  if (count === 2) {
    const c = jit() * 0.3;
    cells.push([-A, A, -B, c - GAP / 2], [-A, A, c + GAP / 2, B]);
  } else if (count === 3) {
    const c1 = -B / 3 + jit() * 0.2;
    const c2 = B / 3 + jit() * 0.2;
    cells.push([-A, A, -B, c1 - GAP / 2], [-A, A, c1 + GAP / 2, c2 - GAP / 2], [-A, A, c2 + GAP / 2, B]);
  } else {
    const cu = jit() * 0.3;
    const cv = jit() * 0.25;
    cells.push([-A, cu - GAP / 2, -B, cv - GAP / 2], [cu + GAP / 2, A, -B, cv - GAP / 2],
      [-A, cu - GAP / 2, cv + GAP / 2, B], [cu + GAP / 2, A, cv + GAP / 2, B]);
  }
  // Rolls happen for every cell whether or not it is drawn, so one tile's layout never shifts another decision.
  const plots = cells.map((c) => ({
    c,
    tone: FIELD_TONES[Math.floor(rng() * FIELD_TONES.length)],
    skip: rng() < 0.2,
    shrink: [rng() * 0.12, rng() * 0.12, rng() * 0.12, rng() * 0.12],
    hedge: rng() < 0.6,
    along: rng() < 0.5,
    spacing: 0.12 + rng() * 0.05,
    tilt: jit() * 0.1,
  }));
  if (plots.filter((p) => !p.skip).length < 2) plots.forEach((p) => { p.skip = false; });

  const fine = s >= 12;
  ctx.save();
  hexPath(ctx, cx, cy, s);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.scale(s, s); // everything below is in hex units
  const roundRect = (x0, y0, x1, y1, r) => {
    const rr = Math.max(0.001, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
    ctx.beginPath();
    ctx.moveTo(x0 + rr, y0);
    ctx.arcTo(x1, y0, x1, y1, rr);
    ctx.arcTo(x1, y1, x0, y1, rr);
    ctx.arcTo(x0, y1, x0, y0, rr);
    ctx.arcTo(x0, y0, x1, y0, rr);
    ctx.closePath();
  };
  for (const p of plots) {
    if (p.skip) continue;
    const x0 = p.c[0] + p.shrink[0];
    const x1 = p.c[1] - p.shrink[1];
    const y0 = p.c[2] + p.shrink[2];
    const y1 = p.c[3] - p.shrink[3];
    if (x1 - x0 < 0.2 || y1 - y0 < 0.14) continue;
    ctx.save();
    ctx.rotate(p.tilt);
    if (fine) {
      // Soft edge: a slightly larger, faint copy underneath the plot.
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = p.tone;
      roundRect(x0 - 0.04, y0 - 0.04, x1 + 0.04, y1 + 0.04, 0.15);
      ctx.fill();
    }
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = p.tone;
    roundRect(x0, y0, x1, y1, 0.11);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (fine) {
      // Furrows along one direction of the plot, faint.
      ctx.save();
      roundRect(x0, y0, x1, y1, 0.11);
      ctx.clip();
      ctx.strokeStyle = 'rgba(70,52,24,0.13)';
      ctx.lineWidth = Math.max(0.014, 0.85 / s);
      ctx.beginPath();
      if (p.along) for (let v = y0 + p.spacing / 2; v < y1; v += p.spacing) { ctx.moveTo(x0, v); ctx.lineTo(x1, v); }
      else for (let u = x0 + p.spacing / 2; u < x1; u += p.spacing) { ctx.moveTo(u, y0); ctx.lineTo(u, y1); }
      ctx.stroke();
      ctx.restore();
      if (p.hedge) {
        ctx.strokeStyle = 'rgba(64,98,48,0.5)';
        ctx.lineWidth = Math.max(0.02, 1 / s);
        roundRect(x0, y0, x1, y1, 0.11);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  ctx.restore();
  if (tile) {
    // The plots repaint part of the hex: put the road and river ribbons back on top.
    const baseY = cy + elevOffset(tile, s);
    drawRiver(ctx, tile, cx, baseY, s);
    drawRoad(ctx, tile, cx, baseY, s);
  }
}
