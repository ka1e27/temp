// WATER, drawn as ONE flat translucent ribbon — the third pass at this file.
//
// History, because the geometry only makes sense in light of what it replaced:
//   Pass 1: water crossed hex edges at exact shared midpoints (correct, kept
//           every time since), but a junction of 3+ arms drew as separate
//           curves that bowed toward the middle and back out, leaving a
//           closed loop with an enclosed island — a highway interchange, not
//           a confluence.
//   Pass 2: fixed the loop by making every open edge a STRAIGHT SPOKE to the
//           hex centre — three or more spokes can only fan into open wedges,
//           never enclose a shape. But straight lines meeting at a point read
//           as angular facets, not flowing water, and the spokes were
//           STROKED as separate subpaths, so the wedge BETWEEN two spokes,
//           past the reach of their round caps, showed the bare ground
//           through as a visible triangular notch. Layered shading (a valley,
//           a bed, the water, a lit core) plus a wet-ground wash and a shore
//           hairline turned the whole thing into an engineered "shaded tube."
//   Pass 3 (this file): smooth curves for the case that is actually visible
//           over any distance — a run or a bend, one continuous quadratic
//           per hex, control point at the centre — and a FILLED, WIDE RIBBON
//           rather than a stroked centreline, so a junction's arms and a
//           small hub disc simply overlap solid instead of leaving a gap.
//           One fill, one flat rgba colour, nonzero winding. No wash, no
//           shore, no second lit/dark pass — the ground under and around the
//           water is untouched; only the ribbon itself is blue.
//
// WHY IT CANNOT LOOP (the property pass 1 broke and pass 2 fixed by force):
//   - 0 or 1 open edge: exactly one subpath (a disc, or a tapering spoke).
//     A single simple shape cannot enclose a hole that isn't already part of
//     it.
//   - 2 open edges, opposite directions: exactly one subpath, a straight
//     rectangle. Still just one shape.
//   - 2 open edges, not opposite (a bend): exactly one subpath — ONE
//     continuous quadratic ribbon from one edge to the other, control point
//     at the hex centre. A quadratic Bezier curve never self-intersects, and
//     the curve lies inside the CONVEX HULL of its three control points
//     (start, centre, end) — all three are inside the (convex) hex, so the
//     whole ribbon is too. One non-self-intersecting shape, again nothing to
//     enclose.
//   - 3+ open edges: this is the only case with more than one subpath (one
//     straight spoke per arm, plus a hub disc), and it is exactly pass 2's
//     already-proven case — every spoke's inner end is the SAME point, the
//     hex centre, bit-for-bit, so between any two arms there is an open
//     wedge, never a closed shape. The hub disc is convex and centred on
//     that exact point, so it cannot introduce one either.
// tests/riverdraw.test.js pins all of this as arithmetic, not screenshots —
// see the mutation-test notes there for how a reintroduced loop gets caught.
//
// Runs entirely on the CACHED BACKGROUND canvas (#board-bg, repainted only on
// a signature(state) change), so the per-hex sampling here is real work that
// costs nothing per frame — the two invariants that must not slip are ONE
// beginPath()/fill() for the whole network (so overlapping ribbons composite
// once, never double-blending into a darker patch) and a WINDING DIRECTION
// that is the same sign for every subpath (rectangle, curve or disc), or
// nonzero-winding fill would cancel an overlap into an unwanted hole instead
// of a solid confluence. tests/riverdraw.test.js checks the sign directly.
import {
  DIR_Q, DIR_R, OPPOSITE, hexIndex, hexCx, hexCy, edgeMidX, edgeMidY,
} from './hexGeom.js';

/**
 * THE RIVER LAYER, as presentation state. See the equivalent comment in
 * earlier revisions of this file: it is a CACHE of `state.grid.rivers`, set
 * once per background repaint by battleView.js, never a source of truth.
 */
let riverSet = new Set();
let riverQ = new Int32Array(0);
let riverR = new Int32Array(0);
let riverMasks = new Uint8Array(0);
let riverN = 0;

/** @param {Array<string|[number,number]>} rivers hex keys or [q,r] pairs */
export function setRiverLayer(rivers) {
  const next = new Set();
  for (const e of rivers ?? []) next.add(typeof e === 'string' ? e : `${e[0]},${e[1]}`);
  riverSet = next;
  riverN = next.size;
  if (riverQ.length < riverN) {
    riverQ = new Int32Array(riverN);
    riverR = new Int32Array(riverN);
    riverMasks = new Uint8Array(riverN);
  }
  let i = 0;
  for (const key of next) {
    const c = key.indexOf(',');
    riverQ[i] = +key.slice(0, c);
    riverR[i] = +key.slice(c + 1);
    i++;
  }
  for (let j = 0; j < riverN; j++) riverMasks[j] = channelMask(next, riverQ[j], riverR[j]);
}

// --- Topology (unchanged across all three passes) ---------------------------

/** Bit `d` set when the neighbour in direction `d` is also water. */
export function channelMask(set, q, r) {
  let m = 0;
  for (let d = 0; d < 6; d++) {
    if (set.has(`${q + DIR_Q[d]},${r + DIR_R[d]}`)) m |= 1 << d;
  }
  return m;
}

/**
 * The mask a hex actually draws: its river neighbours, plus the BOARD EDGE
 * where a lone course should run off the map rather than stop as a spring.
 */
export function rimOutlet(mask, q, r, cols, rows) {
  let only = -1;
  for (let d = 0; d < 6; d++) {
    if (!(mask & (1 << d))) continue;
    if (only >= 0) return 0;
    only = d;
  }
  if (only < 0) return 0;
  const o = OPPOSITE[only];
  return hexIndex(q + DIR_Q[o], r + DIR_R[o], cols, rows) >= 0 ? 0 : 1 << o;
}

/** Everywhere this hex's water leaves: neighbours plus any board-edge run-off. */
export function outletMask(mask, q, r, cols, rows) {
  return mask | rimOutlet(mask, q, r, cols, rows);
}

// --- Geometry ----------------------------------------------------------------

const HEAD_OVER = 0.22;   // how far a spring's taper reaches past the centre
const SPRING_TIP = 0.28;  // the taper's width at its far tip, as a fraction of hw
const BEND_STEPS = 6;     // samples along a bend's quadratic — smooth at any zoom
const HUB_WIDTH_MULT = 1.2; // hub disc radius, relative to the full ribbon width

/**
 * Every point this hex's water crosses or runs off at, as {x, y, d, flush}.
 * `flush` is false only for a run-off: that end is pulled back by `back` and
 * gets a round cap instead of a flat cut, because there is no neighbour hex
 * on the other side to cut flush against.
 */
export function collectOutlets(q, r, size, mask, rim = 0, back = 0) {
  const cx = hexCx(q, r, size);
  const cy = hexCy(q, r, size);
  const out = [];
  for (let d = 0; d < 6; d++) {
    if (!(mask & (1 << d))) continue;
    let x = edgeMidX(q, r, d, size);
    let y = edgeMidY(q, r, d, size);
    let flush = true;
    if (rim & (1 << d)) {
      const ux = cx - x;
      const uy = cy - y;
      const ul = Math.hypot(ux, uy) || 1;
      x += (ux / ul) * back;
      y += (uy / ul) * back;
      flush = false;
    }
    out.push({ x, y, d, flush });
  }
  return out;
}

/**
 * The CENTRELINE only — no width. Exists so the tangent/crossing maths (the
 * thing that has to be exactly right, twice broken so far) can be tested as
 * plain path ops, independent of the ribbon that gets built on top of it.
 */
export function traceChannel(ctx, q, r, size, mask, rim = 0, back = 0) {
  const cx = hexCx(q, r, size);
  const cy = hexCy(q, r, size);
  const outlets = collectOutlets(q, r, size, mask, rim, back);

  if (outlets.length === 0) { ctx.moveTo(cx, cy); ctx.lineTo(cx, cy); return; }

  if (outlets.length === 1) {
    const o = outlets[0];
    const hx = cx + (cx - o.x) * HEAD_OVER;
    const hy = cy + (cy - o.y) * HEAD_OVER;
    ctx.moveTo(o.x, o.y);
    ctx.lineTo(hx, hy);
    return;
  }

  if (outlets.length === 2) {
    const [a, b] = outlets;
    if (b.d === OPPOSITE[a.d]) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); return; }
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(cx, cy, b.x, b.y);
    return;
  }

  for (const o of outlets) { ctx.moveTo(o.x, o.y); ctx.lineTo(cx, cy); }
}

/**
 * One CLOSED, FILLED subpath from a list of {x, y, tx, ty, hw} samples — a
 * point, its unit tangent, and the ribbon's half-width there.
 *
 * The offset side is `(ty, -tx)`, not `(-ty, tx)` — a 90-degree rotation, but
 * a SPECIFIC one, chosen so every ribbon this file ever emits winds the same
 * direction as `circle()` below (both checked directly in
 * tests/riverdraw.test.js). Nonzero-winding fill treats two overlapping
 * subpaths of the SAME winding sign as one solid union; of OPPOSITE sign, the
 * overlap cancels back out to a hole. A hub disc sitting on top of several
 * spoke rectangles is exactly that overlap, so the sign has to be
 * deliberate, not left to whichever offset formula was reached for first.
 */
function ribbon(ctx, samples) {
  const n = samples.length;
  const near = new Array(n);
  const far = new Array(n);
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const px = s.ty * s.hw;
    const py = -s.tx * s.hw;
    near[i] = [s.x + px, s.y + py];
    far[i] = [s.x - px, s.y - py];
  }
  ctx.moveTo(near[0][0], near[0][1]);
  for (let i = 1; i < n; i++) ctx.lineTo(near[i][0], near[i][1]);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(far[i][0], far[i][1]);
  ctx.closePath();
}

/** A filled disc — its own subpath, always started with moveTo so it never
 *  picks up a stray connecting line from whatever was drawn before it. */
function circle(ctx, cx, cy, r) {
  ctx.moveTo(cx + r, cy);
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
}

const unitTangent = (fromX, fromY, toX, toY) => {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
};

/** A straight ribbon between two points, constant width. Used for a straight
 *  run, a run-off's inland leg, and every hub spoke. */
function straightRibbon(ctx, ax, ay, bx, by, hw) {
  const [tx, ty] = unitTangent(ax, ay, bx, by);
  ribbon(ctx, [{ x: ax, y: ay, tx, ty, hw }, { x: bx, y: by, tx, ty, hw }]);
}

/**
 * A bend: ONE quadratic ribbon, control point the hex centre, sampled into a
 * strip. The tangent at t=0 is `2*(c-p0)`, i.e. exactly the radial direction
 * — the same "leaves perpendicular to the edge" fact pass 2 relied on for a
 * seamless join, so two neighbours' ribbons still meet edge-on with no kink,
 * just with a genuine curve running through the middle instead of a corner.
 */
function bendRibbon(ctx, p0x, p0y, cx, cy, p1x, p1y, hw) {
  const samples = [];
  for (let i = 0; i <= BEND_STEPS; i++) {
    const t = i / BEND_STEPS;
    const mt = 1 - t;
    const x = mt * mt * p0x + 2 * mt * t * cx + t * t * p1x;
    const y = mt * mt * p0y + 2 * mt * t * cy + t * t * p1y;
    const dx = 2 * mt * (cx - p0x) + 2 * t * (p1x - cx);
    const dy = 2 * mt * (cy - p0y) + 2 * t * (p1y - cy);
    const l = Math.hypot(dx, dy) || 1;
    samples.push({ x, y, tx: dx / l, ty: dy / l, hw });
  }
  ribbon(ctx, samples);
}

/** A spring or a mouth: width tapers from the full ribbon down to a soft tip
 *  a little past the centre, so it comes to a point instead of a blunt cut. */
function springRibbon(ctx, ox, oy, hx, hy, hw) {
  const [tx, ty] = unitTangent(ox, oy, hx, hy);
  const steps = 4;
  const samples = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    samples.push({
      x: ox + (hx - ox) * t, y: oy + (hy - oy) * t, tx, ty,
      hw: hw * (1 - t * (1 - SPRING_TIP)),
    });
  }
  ribbon(ctx, samples);
  circle(ctx, hx, hy, hw * SPRING_TIP);
}

/**
 * Append one hex's water, as filled ribbon subpath(s), to the current path.
 * Every case is described in the file banner above; this is just the switch
 * on how many places the water crosses this hex's boundary.
 */
export function traceRibbon(ctx, q, r, size, mask, width, rim = 0, back = 0) {
  const cx = hexCx(q, r, size);
  const cy = hexCy(q, r, size);
  const hw = width / 2;
  const outlets = collectOutlets(q, r, size, mask, rim, back);

  if (outlets.length === 0) { circle(ctx, cx, cy, hw); return; }

  if (outlets.length === 1) {
    const o = outlets[0];
    const hx = cx + (cx - o.x) * HEAD_OVER;
    const hy = cy + (cy - o.y) * HEAD_OVER;
    springRibbon(ctx, o.x, o.y, hx, hy, hw);
    return;
  }

  if (outlets.length === 2) {
    const [a, b] = outlets;
    if (b.d === OPPOSITE[a.d]) {
      straightRibbon(ctx, a.x, a.y, b.x, b.y, hw);
      if (!a.flush) circle(ctx, a.x, a.y, hw);
      if (!b.flush) circle(ctx, b.x, b.y, hw);
      return;
    }
    bendRibbon(ctx, a.x, a.y, cx, cy, b.x, b.y, hw);
    return;
  }

  // 3+: a straight spoke per arm, every one reaching the exact same point,
  // plus a hub disc sized to close the widest possible gap (two spokes 60
  // degrees apart, the closest any two hex directions ever are) with margin.
  for (const o of outlets) straightRibbon(ctx, o.x, o.y, cx, cy, hw);
  circle(ctx, cx, cy, width * HUB_WIDTH_MULT);
}

// --- The layer ----------------------------------------------------------------

/** The ribbon's full width, as a fraction of the hex size. Narrower than the
 *  old four-layer channel because there is only one layer now doing the
 *  work; still comfortably read as a river and not a wire. */
const RIVER_WIDTH_FRAC = 0.5;

/**
 * Paint the whole river network in ONE beginPath()/fill(): every hex's
 * ribbon subpaths, then a single flat translucent fill. No wash under it, no
 * hairline shore around it — outside the ribbon a river hex is drawn exactly
 * like any other hex of its terrain, because nothing else is painted here.
 */
export function drawRivers(ctx, o) {
  const { cols, rows, size, palette: p } = o;
  if (riverN === 0 || !p.river) return;

  const width = size * RIVER_WIDTH_FRAC;
  ctx.beginPath();
  for (let i = 0; i < riverN; i++) {
    const q = riverQ[i];
    const r = riverR[i];
    if (hexIndex(q, r, cols, rows) < 0) continue;
    const rim = rimOutlet(riverMasks[i], q, r, cols, rows);
    traceRibbon(ctx, q, r, size, riverMasks[i] | rim, width, rim, width * 0.5);
  }
  ctx.fillStyle = p.river;
  ctx.fill();
}

/** The live layer, for tests and for anything that needs to ask what is wet. */
export function riverLayer() {
  return riverSet;
}
