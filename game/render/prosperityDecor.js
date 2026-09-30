// Prosperity decoration (DESIGN §5.6, §7.7): what a region's terrain chunks gain as it grows
// prosperous. BAKED INTO THE TERRAIN CHUNKS, so it costs nothing per frame. Browser only (canvas),
// read-only over the world. Two bake hooks, because some decor is terrain and some is not:
//
//   GROUND      `drawProsperityGround`      baked BEFORE the territory tint, like terrain
//     level I   life on the existing farmland: haystacks, a hedgerow line, up to two small orchards
//               per region and a scarecrow
//   STRUCTURES  `drawProsperityStructures`  baked AFTER the territory tint and borders, so they keep
//                                           their natural colours (the tint is an overlay)
//     level II  1-2 extra cottages beside villages/towns, and a windmill TOWER (the sails turn live,
//               drawn by render/ambient.js at the plan's windmill hub)
//     level III the region's roads repainted as pale paved stone, and a market stall with a striped
//               awning beside the keep
//
// Hook into the chunk bake (docs/briefs/living-map-hookup.md):
//
//   per land tile, right after drawTileDecor:   drawProsperityGround(ctx, t, x, y, s, level, info)
//   after drawChunkTerritory (the tint pass):   for each land tile: drawProsperityStructures(ctx, t, x, y, s, level, info)
//   with  info = plan.info(t.i)  (plan = createProsperityPlan(world), once per world)  and  level = levels[t.region] | 0
//
// `cx, cy` are the tile's UNRAISED centre exactly like every tile call in tiles.js; the elevation
// contract (`topY = cy - elevOffset(tile, s)`) is applied inside.
import { createProsperityPlan, FEATURE_LEVEL, DECOR_REACH } from '../world/prosperityPlan.js';
import { AMBIENT } from '../config/ambient.js';
import { TERRAIN_COLORS, factionColor, shade, mix, rgba } from './palette.js';
import { elevOffset } from './tiles.js';

export { createProsperityPlan, FEATURE_LEVEL, DECOR_REACH };

const R3 = Math.sqrt(3);
const HALF_STEP = [
  { x: R3 / 2, y: 0 }, { x: R3 / 4, y: -0.75 }, { x: -R3 / 4, y: -0.75 },
  { x: -R3 / 2, y: 0 }, { x: -R3 / 4, y: 0.75 }, { x: R3 / 4, y: 0.75 },
];

const WALL = '#ece0c4'; // as the settlement sprites: structures are baked AFTER the territory tint, so no compensation
const PAVE_STONE = '#c8b68f'; // warm stone, just above the dirt road (#c9a66b) in value, same family
const PAVE_EDGE = '#a78f64';
const HAY = '#dcbc5c';

/** World-unit box of the decor of one region (chunk invalidation); null when it has none. */
export function prosperityDecorBounds(plan, regionId) {
  return plan.boundsOf(regionId);
}

/**
 * Which regions' chunks change when `regionId` levels up: just that region (every decoration of a
 * tile belongs to the region of the tile). Kept as a function so callers do not bake the rule in.
 */
export function prosperityDecorRegions(regionId) {
  return [regionId];
}

/** Sail hub of every windmill of `plan` that has reached level II, for the live sails. */
export function windmillHubs(plan, levels) {
  return plan.windmills.filter((w) => (levels[w.region] | 0) >= FEATURE_LEVEL.windmill);
}

// ------------------------------------------------------------------ helpers

function contactShadow(ctx, x, y, rx, ry, alpha) {
  if (rx <= 0.5 || ry <= 0.3) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(8,14,10,${alpha})`);
  g.addColorStop(1, 'rgba(8,14,10,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function tri(ctx, ax, ay, bx, by, cx, cy, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.lineTo(cx, cy);
  ctx.closePath();
  ctx.fill();
}

// A small cottage in the style of sprites-buildings.js `cottage` (cream walls, roof in the owner
// colour, darker right half), standing on the ground line `baseY`.
function cottage(ctx, x, baseY, w, h, wall, roof, detailed) {
  const wallTop = baseY - h;
  ctx.fillStyle = wall;
  ctx.fillRect(x - w / 2, wallTop, w, h);
  ctx.fillStyle = shade(wall, -0.13);
  ctx.fillRect(x + w * 0.14, wallTop, w * 0.36, h);
  const roofH = h * 0.9;
  tri(ctx, x - w * 0.64, wallTop + h * 0.05, x, wallTop - roofH, x + w * 0.64, wallTop + h * 0.05, roof);
  tri(ctx, x, wallTop - roofH, x + w * 0.64, wallTop + h * 0.05, x + w * 0.1, wallTop + h * 0.05, shade(roof, -0.24));
  if (detailed) {
    const dw = w * 0.22;
    const dh = h * 0.52;
    ctx.fillStyle = shade(wall, -0.42);
    ctx.fillRect(x - dw / 2, baseY - dh, dw, dh);
    ctx.fillStyle = 'rgba(247,196,81,0.5)';
    ctx.fillRect(x - w * 0.36, wallTop + h * 0.3, w * 0.14, h * 0.2);
  }
}

// ------------------------------------------------------------------ level I (ground)

// Level I is LIFE ON THE EXISTING FARMLAND (the organic plots `drawFarmFields` paints beside every
// hamlet, village and town): haystacks, a hedgerow line, small orchards and a scarecrow. Ground
// decor: baked BEFORE the territory tint, so it takes the tint like the terrain under it.

const HEDGE_AXIS = [[0, 1], [0.866, 0.5], [0.866, -0.5]]; // unit vectors parallel to the three hex edge directions
const HEDGE_NORMAL = [[1, 0], [0.5, -0.866], [-0.5, -0.866]];

function hayStack(ctx, x, y, r) {
  contactShadow(ctx, x + r * 0.2, y + r * 0.12, r * 1.45, r * 0.55, 0.32);
  ctx.fillStyle = shade(HAY, -0.3);
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = HAY;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.9, y - r * 0.05);
  ctx.quadraticCurveTo(x - r * 0.62, y - r * 1.55, x, y - r * 1.6);
  ctx.quadraticCurveTo(x + r * 0.52, y - r * 1.45, x + r * 0.9, y - r * 0.05);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgba('#000000', 0.16);
  ctx.beginPath();
  ctx.moveTo(x + r * 0.05, y - r * 1.55);
  ctx.quadraticCurveTo(x + r * 0.52, y - r * 1.45, x + r * 0.9, y - r * 0.05);
  ctx.lineTo(x + r * 0.05, y - r * 0.05);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgba('#fff3c2', 0.35);
  ctx.beginPath();
  ctx.ellipse(x - r * 0.3, y - r * 0.95, r * 0.2, r * 0.45, -0.5, 0, Math.PI * 2);
  ctx.fill();
}

// A small round deciduous tree in the style of the forest trees (three same-toned lobes, one
// darker underside, one soft highlight), optionally with fruit.
function roundTree(ctx, x, y, r, tone, fruit, seed) {
  contactShadow(ctx, x + r * 0.15, y + r * 0.78, r * 1.25, r * 0.45, 0.26);
  const trunkW = Math.max(1, r * 0.16);
  ctx.fillStyle = shade('#5a3a24', -0.1);
  ctx.fillRect(x - trunkW / 2, y, trunkW, r * 0.55);
  const cy = y - r * 0.32;
  ctx.fillStyle = tone;
  for (const [dx, dy, rr] of [[0, 0, 0.6], [-0.34, 0.1, 0.45], [0.32, 0.14, 0.42]]) {
    ctx.beginPath();
    ctx.arc(x + dx * r, cy + dy * r, rr * r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = mix(tone, '#20401c', 0.38);
  ctx.beginPath();
  ctx.ellipse(x + r * 0.05, cy + r * 0.27, r * 0.62, r * 0.3, 0, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = rgba('#ffffff', 0.18);
  ctx.beginPath();
  ctx.arc(x - r * 0.22, cy - r * 0.27, r * 0.27, 0, Math.PI * 2);
  ctx.fill();
  if (fruit) {
    // A few blossom dabs (and one red fruit) on the green canopy: a tree first, blossom second.
    const cols = ['#fbe4ea', '#f5c6d2', '#ffffff', '#d9534a'];
    for (let k = 0; k < 4; k++) {
      const a = (seed >>> (k * 4)) & 15;
      const b = (seed >>> (k * 3 + 1)) & 7;
      ctx.fillStyle = cols[k % cols.length];
      ctx.beginPath();
      ctx.arc(x + ((a / 15) - 0.5) * r * 1.2, cy + ((b / 7) - 0.45) * r * 0.8, Math.max(0.9, r * 0.08), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawOrchard(ctx, cx, topY, s, o, seed) {
  // Staggered rows of round fruit trees, two or three across, painter-ordered.
  const cols = o.n >= 6 ? 3 : 2;
  const trees = [];
  for (let k = 0; k < o.n; k++) {
    const row = Math.floor(k / cols);
    const col = k % cols;
    const jx = ((((seed >>> (k * 3)) & 7) / 7) - 0.5) * 0.06;
    trees.push({
      x: cx + (o.dx + (col - (cols - 1) / 2) * 0.4 + (row & 1 ? 0.18 : 0) + jx) * s,
      y: topY + (o.dy - 0.2 + row * 0.3) * s,
      r: s * (0.21 + (((seed >>> (k * 2 + 5)) & 3) / 3) * 0.05),
    });
  }
  trees.sort((a, b) => a.y - b.y);
  for (const [i, t] of trees.entries()) roundTree(ctx, t.x, t.y, t.r, i % 2 ? shade(TERRAIN_COLORS.forest, 0.07) : TERRAIN_COLORS.forest, s >= 16, seed + i * 977);
}

function drawHedge(ctx, cx, topY, s, h, seed) {
  const [ax, ay] = HEDGE_AXIS[h.axis];
  const [nx, ny] = HEDGE_NORMAL[h.axis];
  const ox = cx + nx * h.off * s;
  const oy = topY + ny * h.off * s;
  const half = 0.5 * s;
  if (s < 14) {
    ctx.strokeStyle = '#4f7f3f';
    ctx.lineWidth = Math.max(1.4, s * 0.1);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ox - ax * half, oy - ay * half);
    ctx.lineTo(ox + ax * half, oy + ay * half);
    ctx.stroke();
    return;
  }
  const n = 8;
  // Soft shadow strip on the ground below and right of the hedge.
  ctx.strokeStyle = 'rgba(20,34,18,0.2)';
  ctx.lineWidth = s * 0.16;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ox - ax * half + s * 0.03, oy - ay * half + s * 0.07);
  ctx.lineTo(ox + ax * half + s * 0.03, oy + ay * half + s * 0.07);
  ctx.stroke();
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < n; k++) {
      const f = k / (n - 1) - 0.5;
      const jr = ((seed >>> (k * 3)) & 7) / 7;
      const x = ox + ax * f * 2 * half + (jr - 0.5) * s * 0.03;
      const y = oy + ay * f * 2 * half + ((((seed >>> (k * 3 + 1)) & 7) / 7) - 0.5) * s * 0.04 - pass * s * 0.03;
      ctx.fillStyle = pass === 0 ? '#4c7c3d' : (k & 1 ? '#6a9a4a' : '#7aa955');
      ctx.beginPath();
      ctx.arc(x, y, s * (0.1 - pass * 0.024 + jr * 0.016), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawScarecrow(ctx, cx, topY, s, sc) {
  const x = cx + sc.dx * s;
  const y = topY + sc.dy * s;
  const h = s * 0.42;
  contactShadow(ctx, x + s * 0.05, y + s * 0.02, s * 0.15, s * 0.05, 0.28);
  ctx.strokeStyle = '#6b4a2c';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - h);
  ctx.moveTo(x - s * 0.15, y - h * 0.68);
  ctx.lineTo(x + s * 0.15, y - h * 0.68);
  ctx.stroke();
  ctx.fillStyle = '#c0574a'; // tattered shirt
  ctx.beginPath();
  ctx.moveTo(x - s * 0.1, y - h * 0.74);
  ctx.lineTo(x + s * 0.1, y - h * 0.74);
  ctx.lineTo(x + s * 0.07, y - h * 0.36);
  ctx.lineTo(x - s * 0.07, y - h * 0.36);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e2c98a'; // straw head and hat
  ctx.beginPath();
  ctx.arc(x, y - h * 0.9, s * 0.055, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8a5a35';
  ctx.beginPath();
  ctx.ellipse(x, y - h * 0.97, s * 0.1, s * 0.03, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x - s * 0.045, y - h * 1.08, s * 0.09, s * 0.06);
}

function hayPositions(info, s, cx, topY) {
  const out = [];
  for (let k = 0; k < info.hay; k++) {
    const a = (((info.seed >>> (k * 6)) & 63) / 63) * Math.PI * 2 + k * 2.4;
    const d = 0.34 + (((info.seed >>> (k * 6 + 3)) & 7) / 7) * 0.2;
    out.push([cx + Math.cos(a) * d * s, topY + Math.sin(a) * d * s * 0.85]);
  }
  return out;
}

/**
 * GROUND decoration of one land tile for its region's `level` (0 draws nothing): level I life on the
 * existing farmland. Call it during the chunk bake right AFTER `drawTileDecor`, i.e. BEFORE the
 * territory tint, like terrain. Deterministic per tile (everything derives from `info`).
 * @param {CanvasRenderingContext2D} ctx chunk context
 * @param {object} tile
 * @param {number} cx  unraised tile centre x (chunk pixels)
 * @param {number} cy  unraised tile centre y
 * @param {number} s   device px per world unit of this bake
 * @param {number} level 0..3 prosperity of the tile's region
 * @param {import('../world/prosperityPlan.js').TileDecorInfo} info `plan.info(tile.i)`
 */
export function drawProsperityGround(ctx, tile, cx, cy, s, level, info) {
  if (!info || level < FEATURE_LEVEL.farm || !info.farm) return;
  const topY = cy - elevOffset(tile, s);
  if (info.hedge) drawHedge(ctx, cx, topY, s, info.hedge, info.seed);
  if (info.orchard) drawOrchard(ctx, cx, topY, s, info.orchard, info.seed);
  if (info.hay > 0) for (const [x, y] of hayPositions(info, s, cx, topY)) hayStack(ctx, x, y, s * 0.2);
  if (info.scarecrow && s >= 14) drawScarecrow(ctx, cx, topY, s, info.scarecrow);
}

// ----------------------------------------------------------------- level II

function drawCottages(ctx, cx, topY, s, info) {
  const roof = factionColor(0);
  for (const c of info.cottages) {
    const x = cx + c.dx * s;
    const baseY = topY + c.dy * s;
    const w = s * (c.variant === 1 ? 0.46 : 0.53);
    const h = s * (c.variant === 1 ? 0.31 : 0.36);
    contactShadow(ctx, x + w * 0.1, baseY + h * 0.08, w * 0.95, w * 0.34, 0.34);
    // A little garden patch in front, so the cottage sits in something.
    ctx.fillStyle = rgba('#5c8a3e', 0.38);
    ctx.beginPath();
    ctx.ellipse(x - w * 0.05, baseY + h * 0.16, w * 0.62, h * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
    cottage(ctx, x, baseY, w, h, c.variant === 1 ? shade(WALL, -0.05) : WALL, c.variant === 2 ? shade(roof, 0.05) : roof, s >= 22);
    if (s >= 30) {
      ctx.fillStyle = '#5b8a44';
      ctx.beginPath();
      ctx.arc(x + w * 0.66, baseY + h * 0.05, s * 0.06, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// The tower of a windmill; the rotor is drawn live by ambient.js at (cx + hubDx s, topY + hubDy s).
function drawWindmillTower(ctx, cx, topY, s) {
  const W = AMBIENT.windmill;
  const baseY = topY + s * 0.1;
  const bodyTop = topY - s * (W.towerH - 0.16);
  const wBase = s * W.towerW;
  const wTop = wBase * 0.6;
  contactShadow(ctx, cx + s * 0.16, baseY + s * 0.03, s * 0.42, s * 0.14, 0.4);
  // Body: tapered, lit left, shaded right.
  ctx.fillStyle = shade(WALL, -0.02);
  ctx.beginPath();
  ctx.moveTo(cx - wBase / 2, baseY);
  ctx.lineTo(cx - wTop / 2, bodyTop);
  ctx.lineTo(cx + wTop / 2, bodyTop);
  ctx.lineTo(cx + wBase / 2, baseY);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shade(WALL, -0.2);
  ctx.beginPath();
  ctx.moveTo(cx + wBase * 0.04, baseY);
  ctx.lineTo(cx + wTop * 0.04, bodyTop);
  ctx.lineTo(cx + wTop / 2, bodyTop);
  ctx.lineTo(cx + wBase / 2, baseY);
  ctx.closePath();
  ctx.fill();
  // Timber bands, door, window.
  if (s >= 16) {
    ctx.strokeStyle = rgba('#6b4a2c', 0.55);
    ctx.lineWidth = Math.max(1, s * 0.03);
    for (const f of [0.32, 0.66]) {
      const y = baseY + (bodyTop - baseY) * f;
      const half = (wBase + (wTop - wBase) * f) / 2;
      ctx.beginPath();
      ctx.moveTo(cx - half, y);
      ctx.lineTo(cx + half, y);
      ctx.stroke();
    }
    const dw = wBase * 0.28;
    ctx.fillStyle = shade(WALL, -0.55);
    ctx.beginPath();
    ctx.moveTo(cx - dw / 2, baseY);
    ctx.lineTo(cx - dw / 2, baseY - s * 0.16);
    ctx.arc(cx, baseY - s * 0.16, dw / 2, Math.PI, 0);
    ctx.lineTo(cx + dw / 2, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(247,196,81,0.5)';
    ctx.fillRect(cx - wBase * 0.09, bodyTop + (baseY - bodyTop) * 0.32, wBase * 0.18, s * 0.09);
  }
  // Cap: a cone in the owner colour with a darker right half.
  const roof = factionColor(0);
  const capW = wTop * 0.72;
  const apexY = topY - s * (W.towerH + 0.16);
  tri(ctx, cx - capW, bodyTop + s * 0.02, cx, apexY, cx + capW, bodyTop + s * 0.02, roof);
  tri(ctx, cx, apexY, cx + capW, bodyTop + s * 0.02, cx + capW * 0.05, bodyTop + s * 0.02, shade(roof, -0.26));
  // Hub boss where the sails will turn.
  const hx = cx + W.hubDx * s;
  const hy = topY + W.hubDy * s;
  ctx.fillStyle = '#4a3320';
  ctx.beginPath();
  ctx.arc(hx, hy, Math.max(1.2, s * 0.05), 0, Math.PI * 2);
  ctx.fill();
}

// ---------------------------------------------------------------- level III

// The ribbon `drawRoad` paints, traced by hand: edge midpoint -> centre control -> edge midpoint
// for every direction in bit order (a one-direction road is a stub from the centre).
function traceRibbon(ctx, cx, cy, s, bits) {
  const mids = [];
  for (let d = 0; d < 6; d++) if (bits & (1 << d)) mids.push([cx + HALF_STEP[d].x * s, cy + HALF_STEP[d].y * s]);
  if (!mids.length) return false;
  ctx.beginPath();
  if (mids.length === 1) {
    ctx.moveTo(cx, cy);
    ctx.lineTo(mids[0][0], mids[0][1]);
  } else {
    ctx.moveTo(mids[0][0], mids[0][1]);
    for (let k = 1; k < mids.length; k++) ctx.quadraticCurveTo(cx, cy, mids[k][0], mids[k][1]);
  }
  return true;
}

// Paved road: the dirt ribbon's width (0.26 s), in pale warm stone with a faint darker edge and a few
// sparse cobble dabs. Flat like the rest of the paint: no bevel, no shadow, no kerb, butt caps (the
// curves meet the neighbouring tile's ribbon tangentially at the edge midpoints, so butt ends join
// seamlessly).
function drawPavedRoad(ctx, tile, cx, cy, s) {
  const topY = cy - elevOffset(tile, s);
  const stroke = (color, width) => {
    if (!traceRibbon(ctx, cx, topY, s, tile.road)) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    ctx.stroke();
  };
  ctx.save();
  stroke(PAVE_EDGE, s * 0.27);
  stroke(PAVE_STONE, s * 0.2);
  if (s >= 15) {
    // Sparse, irregular joints and dabs, faint enough that they read as texture, not markings.
    ctx.setLineDash([s * 0.022, s * 0.16, s * 0.018, s * 0.21, s * 0.026, s * 0.13]);
    stroke(rgba('#8f7f5e', 0.2), s * 0.13);
    ctx.setLineDash([s * 0.02, s * 0.24, s * 0.022, s * 0.15]);
    ctx.lineDashOffset = -s * 0.09;
    stroke(rgba('#f6ecd2', 0.4), s * 0.075);
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function drawMarket(ctx, cx, topY, s, m) {
  const x = cx + m.dx * s;
  const y = topY + m.dy * s;
  const flip = m.flip ? -1 : 1;
  const stripe = factionColor(0);
  const w = s * 0.7;
  contactShadow(ctx, x + s * 0.08, y + s * 0.1, w * 0.85, s * 0.17, 0.36);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(flip, 1);
  // Counter.
  ctx.fillStyle = '#8b5e3a';
  ctx.fillRect(-w * 0.44, -s * 0.16, w * 0.88, s * 0.19);
  ctx.fillStyle = shade('#8b5e3a', -0.22);
  ctx.fillRect(w * 0.05, -s * 0.16, w * 0.39, s * 0.19);
  ctx.fillStyle = shade('#8b5e3a', 0.2);
  ctx.fillRect(-w * 0.46, -s * 0.18, w * 0.92, s * 0.045);
  // Goods on the counter: little heaps of colour.
  if (s >= 14) {
    const goods = ['#d9503f', '#f0b13a', '#7fbf4f', '#e88a3c', '#d9503f'];
    for (let k = 0; k < goods.length; k++) {
      ctx.fillStyle = goods[k];
      ctx.beginPath();
      ctx.arc(-w * 0.34 + k * w * 0.17, -s * 0.2, Math.max(1, s * 0.045), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Poles.
  ctx.fillStyle = '#5a3d24';
  ctx.fillRect(-w * 0.46, -s * 0.5, Math.max(1, s * 0.035), s * 0.4);
  ctx.fillRect(w * 0.42, -s * 0.5, Math.max(1, s * 0.035), s * 0.4);
  // Awning: striped, sloping toward the viewer, scalloped hem.
  const top = -s * 0.5;
  const hem = -s * 0.3;
  const stripes = 6;
  const left = -w * 0.54;
  const right = w * 0.54;
  const sw = (right - left) / stripes;
  for (let k = 0; k < stripes; k++) {
    const x0 = left + k * sw;
    ctx.fillStyle = k % 2 === 0 ? stripe : '#f3ead7';
    ctx.beginPath();
    ctx.moveTo(x0 + sw * 0.15, top);
    ctx.lineTo(x0 + sw * 1.15, top);
    ctx.lineTo(x0 + sw, hem);
    ctx.lineTo(x0, hem);
    ctx.closePath();
    ctx.fill();
    // Scallop.
    ctx.beginPath();
    ctx.moveTo(x0, hem);
    ctx.quadraticCurveTo(x0 + sw / 2, hem + s * 0.11, x0 + sw, hem);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = rgba('#000000', 0.14);
  ctx.beginPath();
  ctx.moveTo(right - sw * 0.05, top);
  ctx.lineTo(right + sw * 0.15, top);
  ctx.lineTo(right, hem);
  ctx.lineTo(right - sw * 0.8, hem);
  ctx.closePath();
  ctx.fill();
  // Crate and barrel beside the stall.
  if (s >= 16) {
    ctx.fillStyle = '#a5794b';
    ctx.fillRect(w * 0.5, -s * 0.15, s * 0.15, s * 0.14);
    ctx.fillStyle = shade('#a5794b', -0.3);
    ctx.fillRect(w * 0.5 + s * 0.08, -s * 0.15, s * 0.07, s * 0.14);
    ctx.fillStyle = '#7d5533';
    ctx.beginPath();
    ctx.ellipse(-w * 0.62, -s * 0.07, s * 0.075, s * 0.095, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgba('#2b1c10', 0.6);
    ctx.lineWidth = Math.max(1, s * 0.02);
    ctx.beginPath();
    ctx.moveTo(-w * 0.62 - s * 0.075, -s * 0.09);
    ctx.lineTo(-w * 0.62 + s * 0.075, -s * 0.09);
    ctx.stroke();
  }
  ctx.restore();
}

// -------------------------------------------------------------------- structures

/**
 * STRUCTURES of one land tile for its region's `level` (0 draws nothing): level II cottages and the
 * windmill tower, level III paving and the market stall. Call it AFTER the territory tint and borders
 * of the chunk (`drawChunkTerritory`), in tile order, so they keep their natural colours (the tint is
 * an overlay that would grey cream walls toward blue). Deterministic per tile.
 * @param {CanvasRenderingContext2D} ctx chunk context
 * @param {object} tile
 * @param {number} cx  unraised tile centre x (chunk pixels)
 * @param {number} cy  unraised tile centre y
 * @param {number} s   device px per world unit of this bake
 * @param {number} level 0..3 prosperity of the tile's region
 * @param {import('../world/prosperityPlan.js').TileDecorInfo} info `plan.info(tile.i)`
 */
export function drawProsperityStructures(ctx, tile, cx, cy, s, level, info) {
  if (!info || level <= 0) return;
  const topY = cy - elevOffset(tile, s);
  if (level >= FEATURE_LEVEL.paved && info.paved) drawPavedRoad(ctx, tile, cx, cy, s);
  if (level >= FEATURE_LEVEL.cottages && info.cottages) drawCottages(ctx, cx, topY, s, info);
  if (level >= FEATURE_LEVEL.windmill && info.windmill) drawWindmillTower(ctx, cx, topY, s);
  if (level >= FEATURE_LEVEL.market && info.market) drawMarket(ctx, cx, topY, s, info.market);
}
