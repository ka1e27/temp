// The archipelago on the map (PLAN-PHASE12 §12A): sandbar fords, harbours (a pier and boats), sea lanes (dotted coastal arcs), and the
// two ways a squad crosses water in battle (wading a ford, a small longboat on a lane). Pure canvas drawing in the caller's px space;
// no game state. The baked parts (sandbars) are drawn by terrainCache.js into the chunk, after the sea and before the land.
import { rgba, shade } from './palette.js';

const SQ3 = Math.sqrt(3);
// Pointy-top hex: the centre-to-edge-midpoint vector of direction d (core/hex.js DIRS order: E, NE, NW, W, SW, SE).
const EDGE_MID = [0, 1, 2, 3, 4, 5].map((d) => { const a = -d * Math.PI / 3; return [Math.cos(a) * SQ3 / 2, Math.sin(a) * SQ3 / 2]; });
const SAND = '#e3cf98';
const SAND_WET = '#c2ad74';

function hash(n) { n = (n ^ 61) ^ (n >>> 16); n = (n + (n << 3)) | 0; n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15; return (n >>> 0) / 4294967296; }

/**
 * A ford tile: a pale sandbar ribbon from the hex centre toward every neighbour it links (another ford or land), with a wet rim,
 * a few dark shoal stones and a broken foam line on each side, so the crossing reads as "shallow, walkable" over the turquoise sea.
 * @param {number[]} dirs neighbour directions (0..5) the bar runs toward; empty = a lone shoal
 */
export function drawSandbar(ctx, cx, cy, s, seed, dirs) {
  const legs = dirs && dirs.length ? dirs : [0, 3];
  ctx.save();
  // the strait reads as SHALLOW WATER first: a pale turquoise wash over the hex (the sea field is deep blue a few hexes out)
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = ((-90 + 60 * k) * Math.PI) / 180;
    const px = cx + s * 1.01 * Math.cos(a); const py = cy + s * 1.01 * Math.sin(a);
    if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = rgba('#7fe0d4', 0.42);
  ctx.fill();
  // then sandbars: a few low shoals scattered over the hex (hash-placed, elongated along one of the tile's links), so the strait reads as
  // "shallow, walkable" without drawing a lattice of lines
  const n = 1 + Math.floor(hash(seed * 5) * 2);
  for (let i = 0; i < n; i++) {
    const d = legs[Math.floor(hash(seed * 11 + i) * legs.length) % legs.length];
    const ang = Math.atan2(EDGE_MID[d][1], EDGE_MID[d][0]);
    const a = hash(seed * 3 + i * 17) * Math.PI * 2;
    const r = s * (i === 0 ? 0.05 : 0.32 + hash(seed + i * 7) * 0.22);
    const px = cx + Math.cos(a) * r; const py = cy + Math.sin(a) * r * 0.85;
    const len = s * (0.28 + hash(seed * 13 + i) * 0.16); const wid = s * (0.09 + hash(seed * 19 + i) * 0.05);
    ctx.fillStyle = rgba(SAND_WET, 0.45);
    ctx.beginPath(); ctx.ellipse(px, py, len + s * 0.06, wid + s * 0.05, ang, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rgba(SAND, 0.78);
    ctx.beginPath(); ctx.ellipse(px, py - s * 0.01, len, wid, ang, 0, Math.PI * 2); ctx.fill();
  }
  // ripples across the shallows
  ctx.strokeStyle = rgba('#f7fffb', 0.7);
  ctx.lineWidth = Math.max(0.8, s * 0.03);
  for (let i = 0; i < 3; i++) {
    const a = hash(seed + i * 13) * Math.PI * 2;
    const r = s * (0.35 + hash(seed + i * 29) * 0.3);
    const px = cx + Math.cos(a) * r; const py = cy + Math.sin(a) * r * 0.8;
    ctx.beginPath(); ctx.arc(px, py, s * 0.11, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
  }
  ctx.restore();
}

/**
 * A harbour on the coast: a plank pier reaching from the shore (cx, topY) out along (dirX, dirY) (unit, toward the sea), mooring posts and
 * one or two small boats in the owner's colour beside it. `t` (seconds, undefined = still) bobs the boats.
 */
export function drawHarbour(ctx, cx, topY, s, dirX, dirY, color, t, { boats = 2 } = {}) {
  const len = s * 0.95;
  const px = -dirY; const py = dirX; // across the pier
  const x1 = cx + dirX * len; const y1 = topY + dirY * len * 0.8;
  const hw = s * 0.12;
  ctx.save();
  ctx.lineCap = 'butt';
  // shadow on the water, then the deck
  ctx.fillStyle = 'rgba(10,30,40,0.28)';
  ctx.beginPath();
  ctx.moveTo(cx + px * hw, topY + py * hw + s * 0.06); ctx.lineTo(x1 + px * hw, y1 + py * hw + s * 0.06);
  ctx.lineTo(x1 - px * hw, y1 - py * hw + s * 0.06); ctx.lineTo(cx - px * hw, topY - py * hw + s * 0.06); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#9a7246';
  ctx.strokeStyle = '#4a3420';
  ctx.lineWidth = Math.max(0.8, s * 0.03);
  ctx.beginPath();
  ctx.moveTo(cx + px * hw, topY + py * hw); ctx.lineTo(x1 + px * hw, y1 + py * hw);
  ctx.lineTo(x1 - px * hw, y1 - py * hw); ctx.lineTo(cx - px * hw, topY - py * hw); ctx.closePath(); ctx.fill(); ctx.stroke();
  // planks
  ctx.strokeStyle = 'rgba(60,40,22,0.55)';
  for (let k = 0.2; k < 1; k += 0.2) {
    const bx = cx + (x1 - cx) * k; const by = topY + (y1 - topY) * k;
    ctx.beginPath(); ctx.moveTo(bx + px * hw, by + py * hw); ctx.lineTo(bx - px * hw, by - py * hw); ctx.stroke();
  }
  // mooring posts at the end
  ctx.fillStyle = '#3b2a18';
  for (const side of [1, -1]) { ctx.beginPath(); ctx.arc(x1 + px * hw * side, y1 + py * hw * side, Math.max(1, s * 0.045), 0, Math.PI * 2); ctx.fill(); }
  // the boats, moored either side of the pier
  for (let i = 0; i < boats; i++) {
    const side = i === 0 ? 1 : -1;
    const k = i === 0 ? 0.7 : 0.45;
    const bob = t == null ? 0 : Math.sin(t * 1.7 + i * 2.1) * s * 0.02;
    const bx = cx + (x1 - cx) * k + px * s * 0.3 * side;
    const by = topY + (y1 - topY) * k + py * s * 0.3 * side + bob;
    drawLongboat(ctx, bx, by, s * 0.7, dirX, dirY, color, null);
  }
  ctx.restore();
}

/**
 * A small longboat (a dragon-prowed hull with a striped sail in `color`) centred on (x, y), its bow along (dirX, dirY).
 * `t` (seconds) rocks it and draws a short wake; null/undefined = moored and still.
 */
export function drawLongboat(ctx, x, y, s, dirX, dirY, color, t) {
  const len = Math.hypot(dirX, dirY) || 1;
  let ux = dirX / len; const uy = dirY / len;
  if (Math.abs(ux) < 0.25) ux = ux < 0 ? -0.25 : 0.25; // seen from above-front: a boat heading straight up/down still shows its side
  const flip = ux < 0 ? -1 : 1;
  const rock = t == null ? 0 : Math.sin(t * 3.1) * 0.06;
  ctx.save();
  ctx.translate(x, y);
  if (t != null) {
    // the wake, trailing behind
    ctx.strokeStyle = 'rgba(240,252,250,0.7)';
    ctx.lineWidth = Math.max(1, s * 0.05);
    ctx.beginPath();
    ctx.moveTo(-flip * s * 0.45, s * 0.08); ctx.quadraticCurveTo(-flip * s * 0.8, s * 0.02, -flip * s * 1.05, s * 0.14);
    ctx.moveTo(-flip * s * 0.45, s * 0.16); ctx.quadraticCurveTo(-flip * s * 0.8, s * 0.26, -flip * s * 1.0, s * 0.3);
    ctx.stroke();
  }
  ctx.rotate(rock);
  ctx.scale(flip, 1);
  // hull
  ctx.fillStyle = 'rgba(8,24,34,0.3)';
  ctx.beginPath(); ctx.ellipse(0, s * 0.16, s * 0.55, s * 0.1, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-s * 0.55, -s * 0.02);
  ctx.quadraticCurveTo(-s * 0.2, s * 0.2, s * 0.42, s * 0.04);
  ctx.quadraticCurveTo(s * 0.56, -s * 0.06, s * 0.58, -s * 0.22); // the prow curls up
  ctx.lineTo(s * 0.5, -s * 0.03);
  ctx.lineTo(-s * 0.5, -s * 0.03);
  ctx.closePath();
  ctx.fillStyle = '#7a5532';
  ctx.strokeStyle = 'rgba(20,12,6,0.85)';
  ctx.lineWidth = Math.max(0.8, s * 0.04);
  ctx.fill(); ctx.stroke();
  // shields along the gunwale
  ctx.fillStyle = color;
  for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.arc(i * s * 0.17, -s * 0.02, s * 0.055, 0, Math.PI * 2); ctx.fill(); }
  // mast and sail
  ctx.strokeStyle = '#3b2a18';
  ctx.lineWidth = Math.max(0.8, s * 0.035);
  ctx.beginPath(); ctx.moveTo(0, -s * 0.03); ctx.lineTo(0, -s * 0.62); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-s * 0.26, -s * 0.58); ctx.lineTo(s * 0.26, -s * 0.58); ctx.lineTo(s * 0.22, -s * 0.18); ctx.lineTo(-s * 0.22, -s * 0.18); ctx.closePath();
  ctx.fillStyle = '#f4f1e6';
  ctx.fill();
  ctx.save(); ctx.clip();
  ctx.fillStyle = color;
  for (let i = -1; i <= 1; i += 2) ctx.fillRect(i * s * 0.09 - s * 0.045, -s * 0.6, s * 0.09, s * 0.44);
  ctx.restore();
  ctx.strokeStyle = 'rgba(20,12,6,0.7)';
  ctx.lineWidth = Math.max(0.6, s * 0.025);
  ctx.stroke();
  ctx.restore();
}

/**
 * A sea lane as a dotted arc through `pts` (screen px, already curved by the caller or not), white dots over a soft dark casing,
 * drifting toward the end when `t` is given. `color` tints the dots (the holder's colour; light = usable, dim = not).
 */
export function drawSeaLane(ctx, pts, color, t, { alpha = 1, width = 2.4, dim = false } = {}) {
  if (!pts || pts.length < 2) return;
  ctx.save();
  ctx.globalAlpha = alpha * (dim ? 0.45 : 1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2; const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
  };
  const gap = width * 3.4;
  ctx.setLineDash([0.1, gap]);
  ctx.lineDashOffset = t == null ? 0 : -(t * 9) % gap;
  ctx.strokeStyle = 'rgba(6,26,40,0.45)';
  ctx.lineWidth = width * 2.3;
  trace(); ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width * 1.5;
  trace(); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = width * 0.7;
  trace(); ctx.stroke();
  ctx.restore();
}

/** A coastal arc between two sea points (world or screen units): bowed sideways by `bend` × the distance, sampled into `n` points. */
export function arcPoints(a, b, bend = 0.22, n = 12) {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const mx = (a.x + b.x) / 2 - dy * bend; const my = (a.y + b.y) / 2 + dx * bend;
  const out = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    out.push({ x: (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * mx + u * u * b.x, y: (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * my + u * u * b.y });
  }
  return out;
}

/** Ripples round a squad wading a ford (drawn UNDER its figure): two expanding rings and a foam fleck. */
export function drawWading(ctx, x, y, s, t) {
  ctx.save();
  const ph = t == null ? 0.4 : (t * 1.3) % 1;
  for (const k of [ph, (ph + 0.5) % 1]) {
    ctx.strokeStyle = `rgba(240,252,250,${(0.75 * (1 - k)).toFixed(3)})`;
    ctx.lineWidth = Math.max(1, s * 0.05);
    ctx.beginPath(); ctx.ellipse(x, y + s * 0.12, s * (0.45 + k * 0.45), s * (0.18 + k * 0.18), 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(120,200,210,0.35)';
  ctx.beginPath(); ctx.ellipse(x, y + s * 0.12, s * 0.5, s * 0.2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export const SEA_MARKS = Object.freeze({ sand: SAND, sandWet: SAND_WET, foam: '#f2fbfa', water: shade('#3fb7c9', 0) });
