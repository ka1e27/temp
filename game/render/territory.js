// Territory drawing (DESIGN §7.3). Called by terrainCache.js while it bakes a chunk, so the
// tint's 'overlay' blend works against real terrain pixels. Browser only; read-only over game data.
//
// Look ("paint the map in your colour", Civ-style): every owned land tile gets a MODERATE
// overlay tint (weaker on rock and snow so mountains do not turn purple) and, along every edge
// that faces another owner or the sea, a soft inner BAND of the owner colour about a third of
// a hex deep, fading inward, plus a crisp 3 px border with a dark hairline outside it. Rivals
// get the same treatment in their colour with a slightly weaker band. The Free Folk are
// passive squatters: border only, no tint and no band. Region boundaries INSIDE one owner's
// land are thin dashed light lines.
import { drawHexTint, drawHexEdge, elevOffset, hexCorners, hexPath } from './tiles.js';
import { factionColor, factionColorLight, faction, rgba } from './palette.js';
import { DIRS } from '../core/hex.js';

export const FREE_FOLK_OWNER = 1;

// Overlay blending alone turns azure-on-grass into teal (it drains red and keeps green), so the
// tint is an overlay for texture-preserving colour PLUS a whisper of flat colour to keep the hue true.
const TINT_PLAYER = 0.22;
const TINT_RIVAL = 0.2;
const FLAT_PLAYER = 0.17;
const FLAT_RIVAL = 0.08;
const BAND_PLAYER = 0.9; // alpha of the band at the border
const BAND_RIVAL = 0.62;
// The Ashen Host's slate is nearly grey: at the rivals' alpha its wash vanished into the terrain (PLAN-PHASE6). An 'undying' faction's interior
// wash is this much stronger, so its land reads as ashen at a glance, like the saturated rivals' land does.
const UNDYING_TINT = 1.9;
const tintBoost = (owner) => (faction(owner)?.personality === 'undying' ? UNDYING_TINT : 1);
const BAND_DEPTH = 0.38; // in hexes (world units): 0.3-0.4 per the brief

// Overlay-blend strength multiplier by terrain: rock and snow drink colour and turn muddy/purple.
const TINT_BY_TERRAIN = Object.freeze({
  grass: 1, meadow: 1, forest: 0.95, pine: 0.95, hills: 0.85, marsh: 0.9,
  beach: 0.8, savanna: 0.85, desert: 0.75, snow: 0.5, mountain: 0.38,
});

// Overlay blending barely moves pale backdrops (sand, snow), so pale terrain gets MORE of the flat
// wash to keep the owner colour readable, while rock gets less of everything.
const FLAT_BY_TERRAIN = Object.freeze({
  grass: 1, meadow: 1, forest: 0.9, pine: 0.9, hills: 0.9, marsh: 0.9,
  beach: 1.15, savanna: 1.05, desert: 1.1, snow: 0.8, mountain: 0.45,
});

// Edge d of a hex spans corners (k, k+1): same table tiles.js uses for drawHexEdge.
const DIR_EDGE_K = [1, 0, 5, 4, 3, 2];

/**
 * Owner of the land tile `t` under `owners` (region id -> faction id), or -1
 * for no territory (water, unassigned, or a region the caller blanked out).
 */
export function tileOwner(t, owners) {
  if (!t || !t.land || t.region < 0) return -1;
  const o = owners[t.region];
  return o == null ? -1 : o;
}

/** Soft inner band along one edge of a tile whose top face is centred at (cx, topY). */
function drawInnerBand(ctx, cx, topY, s, d, color, alpha) {
  const p = hexCorners(cx, topY, s);
  const k = DIR_EDGE_K[d];
  const a = p[k];
  const b = p[(k + 1) % 6];
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  let nx = cx - mx;
  let ny = topY - my;
  const len = Math.hypot(nx, ny) || 1;
  nx /= len;
  ny /= len;
  const depth = BAND_DEPTH * s;
  const g = ctx.createLinearGradient(mx, my, mx + nx * depth, my + ny * depth);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(0.45, rgba(color, alpha * 0.4));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.lineTo(b[0] + nx * depth, b[1] + ny * depth);
  ctx.lineTo(a[0] + nx * depth, a[1] + ny * depth);
  ctx.closePath();
  ctx.fill();
}

/**
 * Draws tint, bands and borders for `landTiles` onto ONE canvas (a terrain chunk being baked, so the
 * tint's 'overlay' blend works against the terrain pixels already on it).
 * @param {CanvasRenderingContext2D} ctx chunk canvas context
 * @param {import('../world/generate.js').World} world
 * @param {object[]} landTiles land tiles touching the chunk, row-major
 * @param {number[]} owners region id -> faction id (-1 = none)
 * @param {number} s device px per world unit of this bake
 * @param {number} ox @param {number} oy canvas px of world (0,0)
 * @param {number} dpr scales border widths so they keep a constant CSS weight
 */
export function drawChunkTerritory(ctx, world, landTiles, owners, s, ox, oy, dpr = 1) {
  drawTerritory({ tint: ctx, over: ctx, overlay: true }, world, landTiles, (t) => tileOwner(t, owners), s, ox, oy, dpr);
}

/**
 * The general form. `ownerOf(tile)` returns the faction owning ANY world tile (or -1), so the caller
 * can decide per tile (the battle scene owns tiles by nearest settlement, not by region).
 * `target.tint` receives the tint; `target.over` receives the flat wash, bands and borders. They may
 * be the same context (`overlay: true`: tint uses 'overlay' blending against what is already there)
 * or two separate transparent canvases (`overlay: false`): the caller then blits `tint` with
 * globalCompositeOperation 'overlay' and `over` normally, which gives the identical look live.
 * @param {{tint: CanvasRenderingContext2D, over: CanvasRenderingContext2D, overlay: boolean}} target
 * @param {(tile: object) => number} ownerOf
 */
export function drawTerritory(target, world, landTiles, ownerOf, s, ox, oy, dpr = 1) {
  const { tint: tctx, over: ctx } = target;
  const { cols, rows, tiles } = world;
  const borderW = 3 * dpr;
  const ffBorderW = 2 * dpr;
  const hairExtra = 1.5 * dpr;
  const dashW = Math.max(1, s * 0.05);
  const dash = [s * 0.12, s * 0.11];

  const neighborOf = (t, d) => {
    const nr = t.r + DIRS[d].r;
    const nc = (t.q + DIRS[d].q) + (nr - (nr & 1)) / 2;
    return nc >= 0 && nc < cols && nr >= 0 && nr < rows ? tiles[nr * cols + nc] : null;
  };
  const ownerOfOrNone = (t) => (t && t.land ? ownerOf(t) : -1);

  // Pass 1: interior tint (never for the Free Folk), strength scaled by terrain.
  for (const t of landTiles) {
    const owner = ownerOfOrNone(t);
    if (owner < 0 || owner === FREE_FOLK_OWNER) continue;
    const mult = TINT_BY_TERRAIN[t.terrain] ?? 1;
    const x = ox + t.x * s;
    const topY = oy + t.y * s - elevOffset(t, s);
    const color = factionColor(owner);
    const boost = tintBoost(owner);
    const tintAlpha = (owner === 0 ? TINT_PLAYER : TINT_RIVAL) * mult * boost;
    if (target.overlay) {
      drawHexTint(tctx, x, topY, s, color, tintAlpha);
    } else {
      tctx.globalAlpha = tintAlpha;
      tctx.fillStyle = color;
      hexPath(tctx, x, topY, s);
      tctx.fill();
      tctx.globalAlpha = 1;
    }
    ctx.globalAlpha = (owner === 0 ? FLAT_PLAYER : FLAT_RIVAL) * (FLAT_BY_TERRAIN[t.terrain] ?? 1) * boost;
    ctx.fillStyle = color;
    hexPath(ctx, x, topY, s);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Pass 2: inner bands along borders, clipped to the tile's own top face.
  for (const t of landTiles) {
    const owner = ownerOfOrNone(t);
    if (owner < 0 || owner === FREE_FOLK_OWNER) continue;
    let clipped = false;
    const x = ox + t.x * s;
    const topY = oy + t.y * s - elevOffset(t, s);
    const color = factionColorLight(owner);
    const alpha = (owner === 0 ? BAND_PLAYER : BAND_RIVAL) * (TINT_BY_TERRAIN[t.terrain] === undefined ? 1 : Math.max(0.6, TINT_BY_TERRAIN[t.terrain]));
    for (let d = 0; d < 6; d++) {
      if (ownerOfOrNone(neighborOf(t, d)) === owner) continue;
      if (!clipped) {
        ctx.save();
        hexPath(ctx, x, topY, s);
        ctx.clip();
        clipped = true;
      }
      drawInnerBand(ctx, x, topY, s, d, color, alpha);
    }
    if (clipped) ctx.restore();
  }

  // Pass 3: crisp borders (dark hairline outside, owner colour on top) + dashed region seams.
  for (const t of landTiles) {
    const owner = ownerOfOrNone(t);
    if (owner < 0) continue;
    const x = ox + t.x * s;
    const topY = oy + t.y * s - elevOffset(t, s);
    const color = factionColor(owner);
    const w = owner === FREE_FOLK_OWNER ? ffBorderW : borderW;
    for (let d = 0; d < 6; d++) {
      const nb = neighborOf(t, d);
      const nbOwner = ownerOfOrNone(nb);
      if (nbOwner !== owner) {
        drawHexEdge(ctx, x, topY, s, d, 'rgba(6,10,8,0.6)', w + hairExtra);
        drawHexEdge(ctx, x, topY, s, d, color, w);
      } else if (nb.region !== t.region) {
        drawHexEdge(ctx, x, topY, s, d, 'rgba(243,234,215,0.42)', dashW, dash);
      }
    }
  }
}
