// The sea as one smooth, continuous colour field (DESIGN §7.1 "depth-shaded
// water"). Replaces the per-tile water splats for the integrated game:
//  * the world generator's `tile.height` on water is plain noise, not depth, so
//    shading from it paints random patches unrelated to the coast, and
//  * overlapping radial splats leave a faint honeycomb (coverage differs between
//    tile centres and tile corners).
// Instead every water tile gets a depth value from its hex distance to land
// (turquoise shallows with a bright surf band hugging every shore, fading to deep
// blue offshore, plus the world's own gentle noise for organic variation). That
// depth is smoothed over the hex lattice into a global sample grid, and each
// terrain chunk paints its slice of the grid as a small image scaled up with
// bilinear smoothing. Because the grid is a function of WORLD position only,
// neighbouring chunks agree exactly (no seams), and open water outside the world
// matches open water inside it. Browser only (canvases); read-only over the world.
import { DIRS, pixelToAxial } from '../core/hex.js';
import { TERRAIN_COLORS, mix } from './palette.js';
import { isWaterTile } from './tiles.js';

const SQ3 = Math.sqrt(3);
export const RES = 6; // field samples per world unit
export const SEA_DEEP_E = 0.2;
const DEPTH_BY_DIST = [1, 0.95, 0.78, 0.6, 0.44, 0.32]; // hex distance from land; beyond = SEA_DEEP_E
const SIGMA = 0.85;
const SIGMA2X2 = 2 * SIGMA * SIGMA;

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const C_DEEP = hexToRgb(TERRAIN_COLORS.deep);
const C_OCEAN = hexToRgb(TERRAIN_COLORS.ocean);
const C_SHALLOW = hexToRgb(TERRAIN_COLORS.shallows);
const C_SURF = hexToRgb(mix(TERRAIN_COLORS.shallows, '#ffffff', 0.34));

/**
 * Sea colour for depth value `e` (0 deep .. 1 shore) at world y (a very gentle
 * north-light to south-shadow gradient, shared with the plain background fill).
 * Writes RGB into `out` (length >= 3).
 */
export function seaRGB(e, yNorm, out) {
  let r; let g; let b;
  if (e < 0.55) {
    const t = e / 0.55;
    r = C_DEEP[0] + (C_OCEAN[0] - C_DEEP[0]) * t;
    g = C_DEEP[1] + (C_OCEAN[1] - C_DEEP[1]) * t;
    b = C_DEEP[2] + (C_OCEAN[2] - C_DEEP[2]) * t;
  } else {
    const t = Math.min(1, (e - 0.55) / 0.45);
    r = C_OCEAN[0] + (C_SHALLOW[0] - C_OCEAN[0]) * t;
    g = C_OCEAN[1] + (C_SHALLOW[1] - C_OCEAN[1]) * t;
    b = C_OCEAN[2] + (C_SHALLOW[2] - C_OCEAN[2]) * t;
  }
  if (e > 0.84) {
    const k = Math.min(1, (e - 0.84) / 0.16) * 0.32;
    r += (C_SURF[0] - r) * k;
    g += (C_SURF[1] - g) * k;
    b += (C_SURF[2] - b) * k;
  }
  const shade = 1.035 - 0.08 * yNorm;
  out[0] = Math.min(255, r * shade);
  out[1] = Math.min(255, g * shade);
  out[2] = Math.min(255, b * shade);
  return out;
}

/** CSS colours of the open-sea gradient at the top and bottom of the world. */
export function seaBackgroundStops() {
  const c = [0, 0, 0];
  const css = (yn) => { seaRGB(SEA_DEEP_E, yn, c); return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; };
  return [css(0), css(1)];
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * @param {import('../world/generate.js').World} world
 * @param {{ minY: number, maxY: number }} extentY world-y range the vertical shade spans
 */
export function createSeaField(world, extentY) {
  const { cols, rows, tiles } = world;

  // --- per-tile depth value, on an EXTENDED grid ---------------------------------
  // The tile grid stops at the map edge, but land can sit a couple of tiles from it
  // (the home region hugs an edge) and the sea keeps going. Extend the grid with
  // MARGIN rings of virtual water so depth keeps deepening past the edge instead of
  // snapping to open sea there.
  const MARGIN = 8;
  const extCols = cols + MARGIN * 2;
  const extRows = rows + MARGIN * 2;
  const extIdx = (col, row) => (row + MARGIN) * extCols + (col + MARGIN);
  const extIn = (col, row) => col >= -MARGIN && col < cols + MARGIN && row >= -MARGIN && row < rows + MARGIN;
  const inGrid = (col, row) => col >= 0 && col < cols && row >= 0 && row < rows;

  const dist = new Int16Array(extCols * extRows).fill(-1);
  const queue = []; // ext indices
  const qOf = (col, row) => col - (row - (row & 1)) / 2;
  const colOf = (q, r) => q + (r - (r & 1)) / 2;
  for (const t of tiles) {
    if (!isWaterTile(t)) { const k = extIdx(t.col, t.row); dist[k] = 0; queue.push(t.col, t.row); }
  }
  for (let head = 0; head < queue.length; head += 2) {
    const col = queue[head];
    const row = queue[head + 1];
    const d0 = dist[extIdx(col, row)];
    const q = qOf(col, row);
    for (let d = 0; d < 6; d++) {
      const nr = row + DIRS[d].r;
      const nc = colOf(q + DIRS[d].q, nr);
      if (!extIn(nc, nr)) continue;
      const k = extIdx(nc, nr);
      if (dist[k] >= 0) continue;
      dist[k] = d0 + 1;
      queue.push(nc, nr);
    }
  }
  const eExt = new Float32Array(extCols * extRows).fill(SEA_DEEP_E);
  for (let row = -MARGIN; row < rows + MARGIN; row++) {
    for (let col = -MARGIN; col < cols + MARGIN; col++) {
      const k = extIdx(col, row);
      const d = dist[k];
      let e;
      if (inGrid(col, row)) {
        const t = tiles[row * cols + col];
        if (!isWaterTile(t)) { eExt[k] = 1; continue; }
        const base = d >= 0 && d < DEPTH_BY_DIST.length ? DEPTH_BY_DIST[d] : SEA_DEEP_E;
        const wobble = ((typeof t.height === 'number' ? t.height : 0.5) - 0.5) * 0.3;
        // Wobble fades near the shore so the surf band stays a clean, continuous ribbon.
        e = Math.max(0.05, Math.min(1, base + wobble * (base > 0.9 ? 0.25 : 1)));
      } else {
        e = d >= 0 && d < DEPTH_BY_DIST.length ? DEPTH_BY_DIST[d] : SEA_DEEP_E;
      }
      eExt[k] = e;
    }
  }

  // --- global sample lattice ---------------------------------------------------
  const PADU = 8; // world units of sea sampled beyond the tile grid (terrainCache SEA_PAD)
  const gx0 = Math.floor((-1 - PADU) * RES);
  const gx1 = Math.ceil((SQ3 * cols + PADU) * RES);
  const gy0 = Math.floor((-1.5 - PADU) * RES);
  const gy1 = Math.ceil(((rows - 1) * 1.5 + 1.5 + PADU) * RES);
  const gw = gx1 - gx0 + 1;
  const gh = gy1 - gy0 + 1;
  const field = new Float32Array(gw * gh);

  for (let j = 0; j < gh; j++) {
    const wy = (gy0 + j) / RES;
    for (let i = 0; i < gw; i++) {
      const wx = (gx0 + i) / RES;
      const c = pixelToAxial(wx, wy, 1);
      let num = 0;
      let den = 0;
      for (let dq = -2; dq <= 2; dq++) {
        const lo = Math.max(-2, -dq - 2);
        const hi = Math.min(2, -dq + 2);
        const q = c.q + dq;
        for (let dr = lo; dr <= hi; dr++) {
          const r = c.r + dr;
          const dx = SQ3 * (q + r / 2) - wx;
          const dy = 1.5 * r - wy;
          const w = Math.exp(-(dx * dx + dy * dy) / SIGMA2X2);
          const col = q + (r - (r & 1)) / 2;
          num += (extIn(col, r) ? eExt[extIdx(col, r)] : SEA_DEEP_E) * w;
          den += w;
        }
      }
      field[j * gw + i] = den > 0 ? num / den : SEA_DEEP_E;
    }
  }

  const yRange = Math.max(1, extentY.maxY - extentY.minY);
  const rgb = [0, 0, 0];
  let scratch = null; // { canvas, ctx, img, w, h } reused across chunk bakes

  /**
   * Paints the sea over the whole canvas. `ox, oy` = canvas px of world (0,0);
   * `s` = canvas px per world unit.
   */
  function paint(ctx, cw, ch, s, ox, oy) {
    const wxMin = -ox / s;
    const wxMax = (cw - ox) / s;
    const wyMin = -oy / s;
    const wyMax = (ch - oy) / s;
    const i0 = Math.floor(wxMin * RES) - 1;
    const i1 = Math.ceil(wxMax * RES) + 1;
    const j0 = Math.floor(wyMin * RES) - 1;
    const j1 = Math.ceil(wyMax * RES) + 1;
    const nw = i1 - i0 + 1;
    const nh = j1 - j0 + 1;
    if (!scratch || scratch.w < nw || scratch.h < nh) {
      const w = Math.max(nw, scratch ? scratch.w : 0);
      const h = Math.max(nh, scratch ? scratch.h : 0);
      const canvas = makeCanvas(w, h);
      const sctx = canvas.getContext('2d');
      scratch = { canvas, sctx, w, h };
    }
    const img = scratch.sctx.createImageData(nw, nh);
    const data = img.data;
    for (let j = 0; j < nh; j++) {
      const gj = j0 + j;
      const wy = gj / RES;
      const yn = Math.max(0, Math.min(1, (wy - extentY.minY) / yRange));
      const gjc = Math.max(0, Math.min(gh - 1, gj - gy0));
      for (let i = 0; i < nw; i++) {
        const gi = i0 + i;
        const gic = Math.max(0, Math.min(gw - 1, gi - gx0));
        seaRGB(field[gjc * gw + gic], yn, rgb);
        const k = (j * nw + i) * 4;
        data[k] = rgb[0];
        data[k + 1] = rgb[1];
        data[k + 2] = rgb[2];
        data[k + 3] = 255;
      }
    }
    scratch.sctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Texel (i, j) is centred on world ((i0+i)/RES, (j0+j)/RES).
    const dx = ox + ((i0 - 0.5) / RES) * s;
    const dy = oy + ((j0 - 0.5) / RES) * s;
    ctx.drawImage(scratch.canvas, 0, 0, nw, nh, dx, dy, (nw / RES) * s, (nh / RES) * s);
    ctx.restore();
  }

  return { paint };
}
