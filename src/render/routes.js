// Everything that travels between sites: squad chevrons, the live drag arc,
// rally lines and the box-select rectangle.
//
// Split out of battleView.js to keep both files under the 400-line cap; the
// seam is natural, because this is the only layer that has to INVENT position.
// Squads store no coordinates at all — the sim gives them a `spawnTick` and an
// `arriveTick` computed once and never integrates movement, which kills an
// entire class of drift bug. The renderer interpolates against the current
// tick plus the loop's `alpha`, and that lives here.
//
// Allocation-free: scratch vectors are module-scope, dash arrays are mutated
// in place.
import { UNIT_IDS } from '../content/balance.js';
import { numStr } from '../ui/format.js';

const _a = { x: 0, y: 0 };
const _b = { x: 0, y: 0 };
const _c = { x: 0, y: 0 };
const _d = { x: 0, y: 0 };
const DASH = [0, 0];
const NO_DASH = [];

/**
 * Point along a bowed quadratic route. `bow` picks which side the arc leans,
 * so two squads crossing the same link in opposite directions never overlap.
 * PURE — unit tested.
 */
export function arcPoint(ax, ay, bx, by, bow, t, out) {
  const dx = bx - ax;
  const dy = by - ay;
  const cx = (ax + bx) * 0.5 - dy * 0.13 * bow;
  const cy = (ay + by) * 0.5 + dx * 0.13 * bow;
  const u = 1 - t;
  out.x = u * u * ax + 2 * u * t * cx + t * t * bx;
  out.y = u * u * ay + 2 * u * t * cy + t * t * by;
  return out;
}

/** Fraction of the journey completed at tick-with-alpha `t`. */
export function squadProgress(sq, t) {
  const span = Math.max(1, sq.arriveTick - sq.spawnTick);
  const f = (t - sq.spawnTick) / span;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

export const squadBow = (sq) => (sq.id % 2 ? 1 : -1);

export function arcPath(ctx, ax, ay, bx, by, bow) {
  const dx = bx - ax;
  const dy = by - ay;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.quadraticCurveTo((ax + bx) * 0.5 - dy * 0.13 * bow,
    (ay + by) * 0.5 + dx * 0.13 * bow, bx, by);
}

/** Squad glyph: a chevron pointing along its route, area proportional to unit
 *  count so a 30-stack reads as a threat from across the map. */
export function chevron(ctx, x, y, ang, size, color, hollow = 0) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const L = size;
  const W = size * 0.72;
  ctx.beginPath();
  ctx.moveTo(x + L * c, y + L * s);
  ctx.lineTo(x + (-L * 0.72) * c - W * s, y + (-L * 0.72) * s + W * c);
  ctx.lineTo(x + (-L * 0.3) * c, y + (-L * 0.3) * s);
  ctx.lineTo(x + (-L * 0.72) * c + W * s, y + (-L * 0.72) * s - W * c);
  ctx.closePath();
  if (hollow) {
    ctx.strokeStyle = color;
    ctx.lineWidth = hollow;
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.fill();
  }
}

/**
 * All in-flight squads.
 * @param {object} g geometry bundle {pos(site,out), byId(id), hexSize, palette}
 */
export function drawSquads(ctx, state, t, px, g) {
  const p = g.palette;
  for (let i = 0; i < state.squads.length; i++) {
    const sq = state.squads[i];
    const from = g.byId(sq.from);
    const to = g.byId(sq.to);
    if (!from || !to) continue;
    const f = squadProgress(sq, t);
    const bow = squadBow(sq);
    g.pos(from, _a);
    g.pos(to, _b);
    arcPoint(_a.x, _a.y, _b.x, _b.y, bow, f, _c);
    arcPoint(_a.x, _a.y, _b.x, _b.y, bow, f > 0.02 ? f - 0.02 : f + 0.02, _d);
    const ang = f > 0.02
      ? Math.atan2(_c.y - _d.y, _c.x - _d.x)
      : Math.atan2(_d.y - _c.y, _d.x - _c.x);

    let n = 0;
    for (let k = 0; k < UNIT_IDS.length; k++) n += sq.comp[UNIT_IDS[k]] || 0;
    const size = g.hexSize * 0.17 * Math.sqrt(Math.max(1, n));
    // A retreating force cannot be intercepted and does not fight; drawing it
    // hollow says "not a threat" with no legend to read.
    chevron(ctx, _c.x, _c.y, ang, size, p.owner[sq.owner], sq.retreating ? px * 1.6 : 0);

    let x = _c.x - size * 0.55;
    const step = (size * 1.1) / Math.max(1, n);
    const y = _c.y + size * 0.78;
    for (let k = 0; k < UNIT_IDS.length; k++) {
      const c = sq.comp[UNIT_IDS[k]] || 0;
      if (!c) continue;
      ctx.fillStyle = p.units[UNIT_IDS[k]];
      ctx.fillRect(x, y, Math.max(step * c, px), px * 3);
      x += step * c;
    }
  }
}

/** Squad head-counts, drawn inside the renderer's single text pass. */
export function drawSquadLabels(ctx, state, t, px, g, owner) {
  for (let i = 0; i < state.squads.length; i++) {
    const sq = state.squads[i];
    if (sq.owner !== owner) continue;
    let n = 0;
    for (let k = 0; k < UNIT_IDS.length; k++) n += sq.comp[UNIT_IDS[k]] || 0;
    if (n < 3) continue;
    const from = g.byId(sq.from);
    const to = g.byId(sq.to);
    if (!from || !to) continue;
    g.pos(from, _a);
    g.pos(to, _b);
    arcPoint(_a.x, _a.y, _b.x, _b.y, squadBow(sq), squadProgress(sq, t), _c);
    ctx.fillText(numStr(n), _c.x, _c.y - g.hexSize * 0.44);
  }
}

/** Rally lines: a site that auto-sends once its garrison passes the threshold.
 *  Dashed, low contrast — a standing order, not an event. */
export function drawRallies(ctx, state, px, g) {
  DASH[0] = px * 4;
  DASH[1] = px * 6;
  ctx.setLineDash(DASH);
  ctx.lineWidth = px * 1.5;
  for (const owner of OWNERS2) {
    let any = false;
    ctx.beginPath();
    for (let i = 0; i < state.sites.length; i++) {
      const s = state.sites[i];
      if (!s.rallyTarget || s.owner !== owner) continue;
      const o = g.byId(s.rallyTarget);
      if (!o) continue;
      any = true;
      g.pos(s, _a);
      g.pos(o, _b);
      ctx.moveTo(_a.x, _a.y);
      ctx.lineTo(_b.x, _b.y);
    }
    if (any) { ctx.strokeStyle = g.palette.border[owner]; ctx.stroke(); }
  }
  ctx.setLineDash(NO_DASH);
}
const OWNERS2 = ['player', 'enemy'];

/**
 * The live drag arc. Solid and accent-coloured once it has snapped to a legal
 * adjacent target, dashed and grey while it has not — so the adjacency rule is
 * learned by feel rather than read in a tooltip.
 * @returns {object|null} the snapped target site
 */
export function drawDragArc(ctx, from, to, pointer, px, g) {
  const p = g.palette;
  g.pos(from, _a);
  if (to) g.pos(to, _b);
  else { _b.x = pointer.x; _b.y = pointer.y; }

  arcPath(ctx, _a.x, _a.y, _b.x, _b.y, 1);
  ctx.strokeStyle = to ? p.selection : p.border.neutral;
  ctx.lineWidth = px * 3;
  ctx.lineCap = 'round';
  if (!to) { DASH[0] = px * 5; DASH[1] = px * 5; ctx.setLineDash(DASH); }
  ctx.stroke();
  ctx.setLineDash(NO_DASH);

  arcPoint(_a.x, _a.y, _b.x, _b.y, 1, 1, _c);
  arcPoint(_a.x, _a.y, _b.x, _b.y, 1, 0.94, _d);
  chevron(ctx, _c.x, _c.y, Math.atan2(_c.y - _d.y, _c.x - _d.x),
    g.hexSize * 0.3, to ? p.selection : p.border.neutral);
  return to;
}

export function drawBox(ctx, box, px, g) {
  const x = Math.min(box.x0, box.x1);
  const y = Math.min(box.y0, box.y1);
  const w = Math.abs(box.x1 - box.x0);
  const hh = Math.abs(box.y1 - box.y0);
  ctx.fillStyle = g.palette.selectionFill;
  ctx.fillRect(x, y, w, hh);
  ctx.strokeStyle = g.palette.selection;
  ctx.lineWidth = px;
  ctx.strokeRect(x, y, w, hh);
}
