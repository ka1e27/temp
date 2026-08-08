// WHERE a squad is when its journey has more than one leg.
//
// A chained send is one squad with a longer path, not a relay: the sim computes
// `arriveTick` once for the whole chain and stores the cumulative fraction of
// the trip completed at the end of each leg (`legEnds`, from movement.js). This
// file is the only place that turns "62% of the way along a four-stop route"
// into a point and a heading.
//
// Split out of routes.js purely for the line cap, but the seam is real: routes.js
// knows about formations and dash patterns, and none of that appears here.
//
// ALLOCATION-FREE. The stop buffers are module-scope and reused every frame; a
// route is bounded by the site count because commands.js rejects a chain that
// revisits a stop, and MAX_STOPS is a generous ceiling over that.
import { arcPoint, arcHeading } from './routes.js';

const MAX_STOPS = 24;
const _rx = new Float64Array(MAX_STOPS);
const _ry = new Float64Array(MAX_STOPS);
const _s = { x: 0, y: 0 };

/**
 * Load a squad's stops into the shared scratch, in world space.
 * @returns {number} stop count (>= 2), or 0 when a site has vanished.
 */
export function loadStops(sq, g) {
  const stops = sq.route;
  if (!stops || stops.length < 2) {
    const a = g.byId(sq.from);
    const b = g.byId(sq.to);
    if (!a || !b) return 0;
    g.pos(a, _s); _rx[0] = _s.x; _ry[0] = _s.y;
    g.pos(b, _s); _rx[1] = _s.x; _ry[1] = _s.y;
    return 2;
  }
  const n = stops.length > MAX_STOPS ? MAX_STOPS : stops.length;
  for (let i = 0; i < n; i++) {
    const site = g.byId(stops[i]);
    if (!site) return 0;
    g.pos(site, _s);
    _rx[i] = _s.x;
    _ry[i] = _s.y;
  }
  return n;
}

/** Which leg global parameter `tr` falls on, for an already-loaded route. */
export function legIndex(sq, n, tr) {
  const ends = sq.legEnds;
  if (n <= 2 || !ends) return 0;
  const last = n - 2;
  for (let i = 0; i < last; i++) if (tr <= ends[i]) return i;
  return last;
}

/**
 * Point and heading at global route parameter `tr` in [0,1], using the stops
 * last passed to loadStops(). `outH` may be null when only position is wanted.
 * @returns {number} the leg index used, so a caller can measure that leg.
 */
export function routeAt(sq, n, tr, bow, outP, outH) {
  const leg = legIndex(sq, n, tr);
  let local = tr;
  if (n > 2 && sq.legEnds) {
    const t0 = leg > 0 ? sq.legEnds[leg - 1] : 0;
    const t1 = sq.legEnds[leg];
    // A zero-width leg would divide by zero; it can only happen if two stops
    // resolve to the same travel time of zero, which minTicks already forbids,
    // so this is belt and braces rather than an expected branch.
    const span = t1 - t0;
    local = span > 1e-9 ? (tr - t0) / span : 0;
  }
  const ax = _rx[leg];
  const ay = _ry[leg];
  const bx = _rx[leg + 1];
  const by = _ry[leg + 1];
  arcPoint(ax, ay, bx, by, bow, local, outP);
  if (outH) arcHeading(ax, ay, bx, by, bow, local, outH);
  return leg;
}

/** Straight-line length of one leg of the loaded route — what rank spacing is
 *  measured against, so a column keeps its depth as it crosses a short hop. */
export function legSpan(leg) {
  const dx = _rx[leg + 1] - _rx[leg];
  const dy = _ry[leg + 1] - _ry[leg];
  return Math.sqrt(dx * dx + dy * dy) || 1;
}

/** Trace the whole polyline as bowed segments, for the route line itself. */
export function tracePolyline(ctx, n, bow) {
  ctx.beginPath();
  ctx.moveTo(_rx[0], _ry[0]);
  for (let i = 0; i < n - 1; i++) {
    const ax = _rx[i];
    const ay = _ry[i];
    const bx = _rx[i + 1];
    const by = _ry[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    ctx.quadraticCurveTo((ax + bx) * 0.5 - dy * 0.13 * bow,
      (ay + by) * 0.5 + dx * 0.13 * bow, bx, by);
  }
}
