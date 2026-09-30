// Water rendering (DESIGN §7.1, art-direction round 3): the sea as one
// continuous splatted field rather than filled hexes. Even a perfectly
// smooth per-tile colour still shows the hex grid once every tile is its
// own hard-edged polygon fill — the fix is the same one clouds.js already
// uses for puffs: soft, overlapping, alpha-feathered radial discs with no
// hard boundary anywhere. Split out of tiles.js purely to keep files under
// ARCHITECTURE's ~500-line guideline; every export here is re-exported from
// tiles.js, which is the only import path anything outside this directory
// should use.
//
// INTEGRATION (terrain-cache chunks, ARCHITECTURE §7): per chunk canvas,
//   1. `drawOceanBase(ctx, 0, 0, chunkW, chunkH)` once, first.
//   2. Clip to the chunk's own rect (`ctx.save(); ctx.rect(...); ctx.clip()`).
//   3. For every water tile within `WATER_SPLAT_MARGIN` tiles OUTSIDE the
//      chunk too (not just tiles inside it), `drawWaterSplat(ctx, tile, x, y, s)`.
//      Iterate tiles in a fixed global order (e.g. tile index) — not some
//      chunk-local order — so two chunks that both happen to splat the same
//      boundary tile composite its alpha in the same relative sequence a
//      single unclipped render would have used, or the seam can show a
//      faint double-blend.
//   4. `ctx.restore()` (drop the clip), then draw land tiles as before —
//      `drawTileBase` no-ops for water tiles now, so calling it on every
//      tile regardless of land/water remains harmless.
//   5. Coast foam is unchanged and still drawn per land tile.
// Per-frame overlay is unchanged: `drawWaterGlints` per visible water tile.

import { TERRAIN_COLORS, shade, mix, rgba } from './palette.js';

/** Flat base colour the sea is splatted on top of. */
export const OCEAN_BASE = TERRAIN_COLORS.deep;

/**
 * Fills a rect with `OCEAN_BASE` and a very subtle vertical gradient. Call
 * once per chunk/canvas, before any `drawWaterSplat` — it's what shows
 * through the gaps between distant splats as open sea rather than the
 * canvas's own clear colour.
 */
export function drawOceanBase(ctx, x, y, w, h) {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, shade(OCEAN_BASE, 0.05));
  g.addColorStop(1, shade(OCEAN_BASE, -0.06));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

// Continuous depth colour purely from `tile.height` (not the discrete
// deep/ocean/shallows bucket), so neighbouring water tiles blend smoothly
// even right at a terrain-label boundary. No jitter: the sea should vary
// with depth, not with tile identity.
function depthColor(tile) {
  const h = typeof tile.height === 'number' ? tile.height : 0.2;
  const e = h / 0.5 < 0 ? 0 : h / 0.5 > 1 ? 1 : h / 0.5;
  const c = e < 0.55
    ? mix(TERRAIN_COLORS.deep, TERRAIN_COLORS.ocean, e / 0.55)
    : mix(TERRAIN_COLORS.ocean, TERRAIN_COLORS.shallows, (e - 0.55) / 0.45);
  return { c, e };
}

/**
 * How many tiles beyond a terrain chunk's own bounds a water tile's splat
 * can visually reach (max radius 2.2×s comfortably fits inside 2 tiles'
 * spacing in any direction). See the integration recipe at the top of this
 * file for why the chunk renderer must also splat — and clip — this margin.
 */
export const WATER_SPLAT_MARGIN = 2;

/**
 * One soft splat of sea: a radial gradient in this tile's depth colour,
 * a soft core fading all the way to transparent by radius ≈ 1.6–2.2×s
 * (the exact radius varies a little with `tile.jitter` so splats aren't a
 * uniform polka-dot grid). Many overlapping splats — every water tile,
 * drawn over `drawOceanBase` — blend into one continuous field with no hex
 * edges: turquoise shallows hugging the coast, fading to deep blue offshore.
 * Very shallow tiles also get a tight, brighter "surf band" ring.
 * `drawTileBase` no-ops for water tiles; this is the entire water render.
 */
export function drawWaterSplat(ctx, tile, cx, cy, s) {
  const { c: base, e } = depthColor(tile);
  const j = typeof tile.jitter === 'number' ? tile.jitter : 0.5;
  const r = s * (1.6 + j * 0.6);

  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, rgba(base, 0.6));
  g.addColorStop(0.5, rgba(base, 0.34));
  g.addColorStop(1, rgba(base, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Optional faint surf band (DESIGN feedback): a tighter, brighter ring
  // right at the shoreline so the coast reads as a bright band, not just
  // the tail end of a gradient.
  if (e > 0.86) {
    const surfColor = mix(TERRAIN_COLORS.shallows, '#ffffff', 0.32);
    const rr = s * 0.95;
    const sg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
    sg.addColorStop(0, rgba(surfColor, 0.24));
    sg.addColorStop(0.7, rgba(surfColor, 0.12));
    sg.addColorStop(1, rgba(surfColor, 0));
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.fill();
  }
}

function hash01(n) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Cheap animated sparkle for the per-frame water overlay. Call once per
 * visible water tile per frame (not baked into the terrain cache) — this is
 * deliberately sparse (most calls draw nothing) so "call it on every water
 * tile" still reads as "a few soft glints per screen", not a dash per hex.
 */
export function drawWaterGlints(ctx, cx, cy, s, t, seed) {
  const gate = hash01(seed * 0.618034 + 11.13);
  if (gate > 0.05) return;
  const twinkle = Math.sin(t * 0.55 + gate * 71.0);
  if (twinkle < 0.3) return;
  const alpha = ((twinkle - 0.3) / 0.7) * 0.4;
  const ang = hash01(seed * 3.77 + 2) * Math.PI - Math.PI / 2;
  const len = s * 0.55;
  const dx = Math.cos(ang) * len * 0.5;
  const dy = Math.sin(ang) * len * 0.3;
  ctx.strokeStyle = rgba('#eaf9ff', alpha);
  ctx.lineWidth = Math.max(1, s * 0.06);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - dx, cy - dy);
  ctx.quadraticCurveTo(cx, cy - s * 0.06, cx + dx, cy + dy);
  ctx.stroke();
}
