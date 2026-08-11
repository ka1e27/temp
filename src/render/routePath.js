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

const _rx = new Float64Array(2);
const _ry = new Float64Array(2);
const _s = { x: 0, y: 0 };

/**
 * Load a squad's two endpoints into the shared scratch, in world space.
 * @returns {number} 2, or 0 when a site has vanished.
 */
export function loadStops(sq, g) {
  const a = g.byId(sq.from);
  const b = g.byId(sq.to);
  if (!a || !b) return 0;
  g.pos(a, _s); _rx[0] = _s.x; _ry[0] = _s.y;
  g.pos(b, _s); _rx[1] = _s.x; _ry[1] = _s.y;
  return 2;
}

/**
 * Point and heading at trip parameter `tr` in [0,1], using the endpoints last
 * passed to loadStops(). `sq`/`n` stay in the signature only because every
 * caller still passes them; there is no chain left to look either up in.
 * `outH` may be null when only position is wanted.
 * @returns {number} 0 — the leg index, kept for callers that used to measure
 *   which leg of a chain this was; there is only ever the one now.
 */
export function routeAt(sq, n, tr, bow, outP, outH) {
  arcPoint(_rx[0], _ry[0], _rx[1], _ry[1], bow, tr, outP);
  if (outH) arcHeading(_rx[0], _ry[0], _rx[1], _ry[1], bow, tr, outH);
  return 0;
}

/** Straight-line length of the loaded trip — what rank spacing is measured
 *  against, so a column keeps its depth as it crosses a short hop. */
export function legSpan() {
  const dx = _rx[1] - _rx[0];
  const dy = _ry[1] - _ry[0];
  return Math.sqrt(dx * dx + dy * dy) || 1;
}

/** Trace the trip as one bowed segment, for the route line itself. `n` stays
 *  in the signature so the call sites that used to pass a stop count are
 *  unchanged — there is only one segment to trace now. */
export function tracePolyline(ctx, n, bow) {
  ctx.beginPath();
  ctx.moveTo(_rx[0], _ry[0]);
  const dx = _rx[1] - _rx[0];
  const dy = _ry[1] - _ry[0];
  ctx.quadraticCurveTo((_rx[0] + _rx[1]) * 0.5 - dy * 0.13 * bow,
    (_ry[0] + _ry[1]) * 0.5 + dx * 0.13 * bow, _rx[1], _ry[1]);
}
