// Supply lines (DESIGN §4.3) and the send-drag's "where can I go" marks, drawn on the canvas. Pure drawing: the caller turns the sim's
// `routeFor` points into screen points and says which colour each line wears. Browser only.
//
//  * A standing line is a row of chevrons flowing along the route in its owner's colour, on a faint dark track. It is deliberately thinner and
//    quieter than the send arrow (`drawDragArrow`: a solid ~4.6 px shaft), so a handful of lines never drown the fight.
//  * During a send drag every settlement the drag could reach glows, and every one it could not is greyed (with a dashed cross), so the answer to
//    "can I send there?" is visible before the finger is lifted.
import { ACCENTS } from './palette.js';

const TAU = Math.PI * 2;

/** Lengths of a polyline of {x, y}. @returns {{ total: number, seg: number[] }} */
export function polylineLength(pts) {
  const seg = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    seg.push(d);
    total += d;
  }
  return { total, seg };
}

/** The point and unit tangent `d` px along a polyline (clamped). */
export function pointAlong(pts, seg, d) {
  let rest = Math.max(0, d);
  for (let i = 0; i < seg.length; i++) {
    if (rest <= seg[i] || i === seg.length - 1) {
      const k = seg[i] > 1e-6 ? Math.min(1, rest / seg[i]) : 0;
      const a = pts[i];
      const b = pts[i + 1];
      const len = seg[i] || 1;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, tx: (b.x - a.x) / len, ty: (b.y - a.y) / len };
    }
    rest -= seg[i];
  }
  const last = pts[pts.length - 1];
  return { x: last.x, y: last.y, tx: 1, ty: 0 };
}

/**
 * Flowing chevrons along a route.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number,y:number}[]} pts   the route in SCREEN px (start settlement first)
 * @param {string} color                the owner's colour
 * @param {number} t                    seconds (the flow)
 * @param {{ zoom?: number, alpha?: number, inset?: number }} [opts]  `inset` px kept clear at both ends (the settlement sprites)
 * @returns {number} how many chevrons were drawn (for tests)
 */
export function drawSupplyLine(ctx, pts, color, t, opts = {}) {
  if (!pts || pts.length < 2) return 0;
  const zoom = opts.zoom || 46;
  const k = Math.max(0.7, Math.min(1.35, Math.pow(zoom / 46, 0.35)));
  const size = 4.6 * k; // chevron half-width; the send arrow's shaft is ~4.6 px across, this reads as about half of it
  const { total, seg } = polylineLength(pts);
  if (total < 12) return 0; // two settlements on top of each other: nothing to show
  // A short hop (two neighbouring settlements) still shows its line: the gaps shrink with the route so at least one chevron always fits.
  const inset = Math.min(opts.inset ?? 18 * k, total * 0.22);
  const spacing = Math.min(19 * k, Math.max(9 * k, (total - 2 * inset) * 0.6));
  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // a faint dark track under the chevrons keeps them readable on snow and sand
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.strokeStyle = 'rgba(6, 10, 18, 0.34)';
  ctx.lineWidth = 3.4 * k;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.globalAlpha = (opts.alpha ?? 1) * 0.35;
  ctx.lineWidth = 1.3 * k;
  ctx.stroke();
  ctx.globalAlpha = opts.alpha ?? 1;
  const phase = (t * 26 * k) % spacing;
  let drawn = 0;
  for (let d = phase; d < total; d += spacing) {
    if (d < inset || d > total - inset) continue;
    const edge = Math.min(d - inset, total - inset - d);
    const fade = Math.max(0, Math.min(1, edge / (spacing * 0.8)));
    const p = pointAlong(pts, seg, d);
    const nx = -p.ty;
    const ny = p.tx;
    const tipX = p.x + p.tx * size * 0.9;
    const tipY = p.y + p.ty * size * 0.9;
    const aX = p.x - p.tx * size * 0.7 + nx * size;
    const aY = p.y - p.ty * size * 0.7 + ny * size;
    const bX = p.x - p.tx * size * 0.7 - nx * size;
    const bY = p.y - p.ty * size * 0.7 - ny * size;
    ctx.globalAlpha = (opts.alpha ?? 1) * fade;
    ctx.beginPath();
    ctx.moveTo(aX, aY);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(bX, bY);
    ctx.strokeStyle = 'rgba(6, 10, 18, 0.75)';
    ctx.lineWidth = 3.6 * k;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.1 * k;
    ctx.stroke();
    drawn += 1;
  }
  ctx.restore();
  return drawn;
}

/** The glow on a settlement a send drag could reach: a soft ring that breathes. */
export function drawReachGlow(ctx, x, y, radius, t, strong = false) {
  const breathe = 0.5 + 0.5 * Math.sin(t * 4 + x * 0.05);
  ctx.save();
  ctx.lineWidth = strong ? 3.2 : 2.4;
  ctx.strokeStyle = `rgba(255, 233, 166, ${(strong ? 0.95 : 0.6 + breathe * 0.2).toFixed(3)})`;
  ctx.shadowColor = ACCENTS.gold;
  ctx.shadowBlur = strong ? 14 : 8;
  ctx.beginPath();
  ctx.arc(x, y, radius + breathe * 1.5, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/** A settlement the drag cannot reach (no route: the front-line rule): greyed with a dashed ring and a small cross. */
export function drawNoRoute(ctx, x, y, radius, shake = 0) {
  ctx.save();
  ctx.translate(x + shake, y);
  ctx.fillStyle = 'rgba(40, 44, 52, 0.42)';
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(190, 196, 206, 0.8)';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  const c = radius * 0.34;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(6, 10, 18, 0.85)';
  ctx.lineWidth = 4.2;
  ctx.beginPath();
  ctx.moveTo(-c, -c); ctx.lineTo(c, c); ctx.moveTo(c, -c); ctx.lineTo(-c, c);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(214, 219, 228, 0.95)';
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.restore();
}

/** A pulsing ring marking the source the player is holding down for a supply line (touch: after the long press). */
export function drawArmedRing(ctx, x, y, radius, t, color) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 7);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.6;
  ctx.setLineDash([5, 4]);
  ctx.lineDashOffset = -t * 18;
  ctx.globalAlpha = 0.65 + pulse * 0.3;
  ctx.beginPath();
  ctx.arc(x, y, radius + pulse * 2.5, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/**
 * A supply line whose route is closed (the front moved): it waits. A short dashed grey stub leaves the source toward the target, ending in a pause
 * mark. Deliberately NOT a line to the target: there is no legal way across the land in between.
 * @param {{x:number,y:number}} from source settlement on screen
 * @param {{x:number,y:number}} toward target settlement on screen (only the direction is used)
 */
export function drawWaitingLine(ctx, from, toward, alpha = 1, zoom = 46) {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const k = Math.max(0.75, Math.min(1.4, Math.pow(zoom / 46, 0.35)));
  const ux = dx / len;
  const uy = dy / len;
  const start = 22 * k;
  const end = Math.min(len * 0.5, 72 * k); // long enough to clear a neighbouring settlement
  if (end <= start + 8) return;
  const line = () => { ctx.beginPath(); ctx.moveTo(from.x + ux * start, from.y + uy * start); ctx.lineTo(from.x + ux * end, from.y + uy * end); };
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(6, 10, 18, 0.7)';
  ctx.lineWidth = 5 * k;
  line();
  ctx.stroke();
  ctx.setLineDash([5 * k, 4 * k]);
  ctx.strokeStyle = 'rgba(205, 211, 221, 0.98)';
  ctx.lineWidth = 2.4 * k;
  line();
  ctx.stroke();
  ctx.setLineDash([]);
  // the pause badge at the end of the stub: a pale disc with a dark rim and two dark bars (it must read over any land and beside any settlement)
  const bx = from.x + ux * (end + 11 * k);
  const by = from.y + uy * (end + 11 * k);
  ctx.fillStyle = 'rgba(232, 236, 244, 0.98)';
  ctx.strokeStyle = 'rgba(10, 14, 24, 0.95)';
  ctx.lineWidth = 2.2 * k;
  ctx.beginPath();
  ctx.arc(bx, by, 11 * k, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(10, 14, 24, 0.95)';
  ctx.fillRect(bx - 4.6 * k, by - 5.2 * k, 3.2 * k, 10.4 * k);
  ctx.fillRect(bx + 1.4 * k, by - 5.2 * k, 3.2 * k, 10.4 * k);
  ctx.restore();
}
