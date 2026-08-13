// WHERE a squad is along its trip.
//
// A chained send used to make this a multi-stop walk: the sim stored the
// cumulative fraction of the trip completed at the end of each leg (`legEnds`,
// from movement.js) and this file picked out which leg a global progress
// fraction fell on. Free movement deleted the chain — a send is legal
// wherever a path exists, so there is no authored waypoint list to route
// through any more — and every squad is now a plain two-point trip: it
// leaves `from` and arrives at `to`. This file is what turns "62% of the way
// there" into a point and a heading.
//
// Split out of routes.js purely for the line cap, but the seam is real: routes.js
// knows about formations and dash patterns, and none of that appears here.
//
// ALLOCATION-FREE. The endpoint buffers are module-scope and reused every frame.
import { arcPoint, arcHeading } from './routes.js';

// A squad walks a REAL PATH now, not a line between two buildings, so these
// hold a polyline rather than a pair. 64 is past the diagonal of the biggest
// board (21x16); a longer route is subsampled rather than truncated, because
// dropping the tail would draw a column marching to the wrong place.
const MAX_STOPS = 64;
const _rx = new Float64Array(MAX_STOPS);
const _ry = new Float64Array(MAX_STOPS);
const _s = { x: 0, y: 0 };

/**
 * Load a squad's route into the shared scratch, in world space.
 *
 * Reads `sq.path` — the hexes the sim actually walks it through — rather than
 * looking its two endpoint SITES up. That is the whole point of the change: the
 * old version drew a straight line between two buildings, so a column routing
 * around a mountain range was drawn marching over it, and a camped army (which
 * has no destination site at all) could not be drawn whatsoever.
 *
 * @returns {number} how many points were loaded; 0 when there is no route.
 */
export function loadStops(sq, g) {
  const path = sq.path;
  if (!path || !path.length) return 0;
  const hexPos = g.hexPos;
  // A camped army is one point: it is standing still, and every consumer below
  // handles n === 1 by simply drawing it there.
  const n = Math.min(path.length, MAX_STOPS);
  const step = (path.length - 1) / Math.max(1, n - 1);
  for (let i = 0; i < n; i++) {
    const h = path[Math.min(path.length - 1, Math.round(i * step))];
    hexPos(h.q, h.r, _s);
    _rx[i] = _s.x;
    _ry[i] = _s.y;
  }
  return n;
}

/**
 * Point and heading at trip parameter `tr` in [0,1] along the loaded route.
 *
 * TWO POINTS STILL BOW, and more than two do not. The bow is a screen-space
 * flourish that existed so two squads on the SAME straight hop did not overlap;
 * a real path is already its own separation, and bowing every segment of a
 * twenty-hex route would draw a snake rather than a march.
 * `outH` may be null when only position is wanted.
 * @returns {number} the segment index the parameter fell on.
 */
export function routeAt(sq, n, tr, bow, outP, outH) {
  if (n <= 1) {
    outP.x = _rx[0];
    outP.y = _ry[0];
    if (outH) { outH.x = 1; outH.y = 0; }
    return 0;
  }
  if (n === 2) {
    arcPoint(_rx[0], _ry[0], _rx[1], _ry[1], bow, tr, outP);
    if (outH) arcHeading(_rx[0], _ry[0], _rx[1], _ry[1], bow, tr, outH);
    return 0;
  }
  const t = Math.max(0, Math.min(1, tr)) * (n - 1);
  const i = Math.min(n - 2, Math.floor(t));
  const k = t - i;
  arcPoint(_rx[i], _ry[i], _rx[i + 1], _ry[i + 1], 0, k, outP);
  if (outH) arcHeading(_rx[i], _ry[i], _rx[i + 1], _ry[i + 1], 0, k, outH);
  return i;
}

/** Length of the loaded route — what rank spacing is measured against, so a
 *  column keeps its depth as it crosses a short hop. Summed over the polyline
 *  rather than end to end, or a route that doubles back would report a span
 *  near zero and stack the whole army on one point. */
export function legSpan(n = 2) {
  let sum = 0;
  for (let i = 1; i < n; i++) {
    const dx = _rx[i] - _rx[i - 1];
    const dy = _ry[i] - _ry[i - 1];
    sum += Math.sqrt(dx * dx + dy * dy);
  }
  return sum || 1;
}

/** Trace the loaded route for the route line itself. One bowed segment when
 *  there are only two points (a short hop still wants the separation), the real
 *  polyline otherwise — the road the army is walking is the honest picture. */
export function tracePolyline(ctx, n, bow) {
  ctx.beginPath();
  ctx.moveTo(_rx[0], _ry[0]);
  if (n <= 1) return;
  if (n === 2) {
    const dx = _rx[1] - _rx[0];
    const dy = _ry[1] - _ry[0];
    ctx.quadraticCurveTo((_rx[0] + _rx[1]) * 0.5 - dy * 0.13 * bow,
      (_ry[0] + _ry[1]) * 0.5 + dx * 0.13 * bow, _rx[1], _ry[1]);
    return;
  }
  for (let i = 1; i < n; i++) ctx.lineTo(_rx[i], _ry[i]);
}
