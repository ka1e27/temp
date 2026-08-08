// Rally lines and the rally drag — STANDING ORDERS, not marching bodies.
//
// Split from routes.js at the 400-line cap, and the seam is a real one: routes.js
// answers "where is this column right now", and nothing in here has a position
// that changes with the tick. A rally is a rule about the future.
//
// Allocation-free, same as its neighbour: module-scope scratch, dash arrays
// mutated in place.
import { arcPath, arcPoint, chevron } from './routes.js';

const _a = { x: 0, y: 0 };
const _b = { x: 0, y: 0 };
const _c = { x: 0, y: 0 };
const _d = { x: 0, y: 0 };
const DASH = [0, 0];
const NO_DASH = [];

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
    if (any) {
      ctx.strokeStyle = g.palette.border[owner];
      ctx.stroke();
      ctx.setLineDash(NO_DASH);
      drawRallyArrows(ctx, state, px, g, owner);
      ctx.setLineDash(DASH);
    }
  }
  ctx.setLineDash(NO_DASH);
}

/**
 * Which WAY a rally points, drawn on the line itself.
 *
 * A dashed line between two sites is symmetric, so the direction was only
 * discoverable by opening the panel or by dragging and watching what happened.
 * Since one link can point either way — and dragging it now cycles off / this
 * way / that way — the direction has to be readable at a glance or the gesture
 * is guesswork.
 *
 * Two arrowheads at fixed fractions rather than one at the midpoint: on a long
 * link a single mark is easy to miss, and on a short one an end-anchored mark
 * disappears under a site glyph.
 */
function drawRallyArrows(ctx, state, px, g, owner) {
  const size = Math.max(g.hexSize * 0.13, px * 4.5);
  ctx.strokeStyle = g.palette.border[owner];
  ctx.lineWidth = px * 1.8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < state.sites.length; i++) {
    const s = state.sites[i];
    if (!s.rallyTarget || s.owner !== owner) continue;
    const o = g.byId(s.rallyTarget);
    if (!o) continue;
    g.pos(s, _a);
    g.pos(o, _b);
    const dx = _b.x - _a.x;
    const dy = _b.y - _a.y;
    const m = Math.sqrt(dx * dx + dy * dy) || 1;
    const hx = dx / m;
    const hy = dy / m;
    for (let k = 0; k < ARROW_AT.length; k++) {
      const t = ARROW_AT[k];
      const x = _a.x + dx * t;
      const y = _a.y + dy * t;
      // An open ">" traced along the line, NOT a filled arrowhead: troop pieces
      // are solid chevrons, so a filled marker here reads as soldiers standing
      // on the road rather than as the road's direction.
      ctx.moveTo(x - hx * size + -hy * size * 0.62, y - hy * size + hx * size * 0.62);
      ctx.lineTo(x, y);
      ctx.lineTo(x - hx * size - -hy * size * 0.62, y - hy * size - hx * size * 0.62);
    }
  }
  ctx.stroke();
}
const ARROW_AT = [0.4, 0.68];
const OWNERS2 = ['player', 'enemy'];

/**
 * The live RALLY drag — the right-button twin of drawDragArc.
 *
 * Dashed at the same rhythm drawRallies uses, so the gesture already looks like
 * the standing order it is about to become and never reads as a squad leaving
 * now. Three states, because a rally drag has one the send drag does not:
 * snapped to a target (accent), back on its own source (warning — release here
 * CLEARS), and reaching at nothing (grey).
 */
export function drawRallyDrag(ctx, from, to, pointer, px, g) {
  const p = g.palette;
  const clearing = !!to && to.id === from.id;
  g.pos(from, _a);
  if (to && !clearing) g.pos(to, _b);
  else { _b.x = pointer.x; _b.y = pointer.y; }

  const tint = clearing ? p.border.enemy : (to ? p.selection : p.border.neutral);
  DASH[0] = px * 4;
  DASH[1] = px * 6;
  ctx.setLineDash(DASH);
  arcPath(ctx, _a.x, _a.y, _b.x, _b.y, 1);
  ctx.strokeStyle = tint;
  ctx.lineWidth = px * 2.5;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.setLineDash(NO_DASH);

  // No arrowhead while clearing: there is nowhere for it to point.
  if (clearing) return to;
  arcPoint(_a.x, _a.y, _b.x, _b.y, 1, 1, _c);
  arcPoint(_a.x, _a.y, _b.x, _b.y, 1, 0.94, _d);
  chevron(ctx, _c.x, _c.y, Math.atan2(_c.y - _d.y, _c.x - _d.x), g.hexSize * 0.26, tint);
  return to;
}
