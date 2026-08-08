// WATER, drawn as part of the ground rather than as a line laid over it.
//
// The old river was a polyline through hex CENTRES. It read as an overlay for
// a geometric reason: a centre-to-centre chain crosses each shared edge at
// whatever angle the chain happens to have, so the water met the hex lattice
// at arbitrary points and cut straight chords through the ground.
//
// This one is built the other way round. Water enters and leaves a hex at the
// MIDPOINT OF EACH SHARED EDGE, and the only thing a hex decides is how to get
// from one of its own edge midpoints to another. Two consequences, and they are
// the whole design:
//
//   1. NO SEAM. Two neighbours compute the same crossing point — bit-for-bit,
//      see edgeMidX in hexGeom.js — so their channels butt together exactly.
//   2. NO KINK. Every curve through a hex is a quadratic with its control
//      point AT THE HEX CENTRE, so its tangent at an edge midpoint is the edge
//      NORMAL. The neighbour's tangent there is the same normal. The join is
//      smooth without either hex knowing anything about the other.
//
// That one rule covers all four local cases: a straight run is the degenerate
// curve through three collinear points, a bend curves around the inside of the
// turn, a source tapers off just past the centre, and a junction is a main
// channel with tributaries merging TANGENTIALLY into it — a confluence, not
// three lines crossing.
//
// Everything here paints on the CACHED BACKGROUND canvas (#board-bg, repainted
// only when signature(state) changes), so four stroked passes over the network
// cost nothing per frame. The topology is computed once, in setRiverLayer, into
// typed arrays; the draw loop allocates nothing and builds no strings.
import {
  DIR_Q, DIR_R, OPPOSITE, EDGE_CORNERS, CORNER_X, CORNER_Y,
  hexIndex, hexCx, hexCy, edgeMidX, edgeMidY, traceHex,
} from './hexGeom.js';

/**
 * THE RIVER LAYER, as presentation state.
 *
 * The background painter is handed a fixed `board` bundle built by
 * battleView.js — cols, rows, size, owners, blocked, palette — and rivers
 * arrived after that bundle was frozen. So the scene that owns the battle
 * pushes the layer in here once, the same way it pushes the fx layer into the
 * view, and drawRivers() picks it up.
 *
 * It is a CACHE, not a source of truth: `state.grid.rivers` is. Set it from
 * whatever the simulation is holding and it can never drift.
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
  // Adjacency LAST, once the coordinates are in: the whole layer has to exist
  // before any hex can ask who its neighbours are.
  for (let j = 0; j < riverN; j++) riverMasks[j] = channelMask(next, riverQ[j], riverR[j]);
}

// --- Topology ---------------------------------------------------------------

/**
 * Bit `d` set when the neighbour in direction `d` is also water. This is the
 * ONLY thing a hex needs to know to draw itself, which is why no ordering or
 * flow-direction information has to be carried through the contract.
 * @param {Set<string>} set @returns {number} 0..63
 */
export function channelMask(set, q, r) {
  let m = 0;
  for (let d = 0; d < 6; d++) {
    if (set.has(`${q + DIR_Q[d]},${r + DIR_R[d]}`)) m |= 1 << d;
  }
  return m;
}

/**
 * The mask a hex actually draws: its river neighbours, plus the BOARD EDGE
 * where the water should run off rather than stop.
 *
 * A hex with a single river neighbour is either a spring or the last hex of a
 * course that walked off the map. Those want opposite treatment — one tapers
 * out inside the hex, the other carries on over the rim — and the grid bounds
 * are the only thing that can tell them apart.
 */
export function rimOutlet(mask, q, r, cols, rows) {
  let only = -1;
  for (let d = 0; d < 6; d++) {
    if (!(mask & (1 << d))) continue;
    if (only >= 0) return 0;   // two or more: nothing to decide
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

/**
 * The two outlets that form the MAIN channel: the straightest pair, i.e. the
 * one whose turn is closest to no turn at all. Everything else at a junction is
 * a tributary of that stem, which is what makes a confluence read as water
 * joining water rather than as roads meeting.
 *
 * Returned packed as `a | (b << 3)` — indices INTO `dirs`, not directions — so
 * a hot loop can ask without allocating a pair.
 * @param {ArrayLike<number>} dirs @param {number} n how many are in use
 */
export function mainPair(dirs, n) {
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sep = (dirs[j] - dirs[i] + 6) % 6;
      const score = sep > 3 ? 6 - sep : sep;   // 3 = dead straight, 1 = hairpin
      if (score > bestScore) { bestScore = score; best = i | (j << 3); }
    }
  }
  return best;
}

// --- One hex's water --------------------------------------------------------

// Scratch for the outlets of the hex being traced. Module scope so tracing a
// whole network allocates nothing.
const _dirs = new Int32Array(6);
const _mx = new Float64Array(6);
const _my = new Float64Array(6);

/** How far past the centre a spring's head reaches, as a fraction of the
 *  distance from the centre to an edge midpoint. */
const HEAD_OVER = 0.22;
/** Where every layer of a spring head ENDS, in hex-size units measured from
 *  the inlet. Each pass stops half its own width short of it, so the layers
 *  converge to a point and the channel tapers out instead of ending blunt. */
const HEAD_REACH = 1.2;
/** Tributary control points: how far toward the centre it leaves the edge, and
 *  how long a run it gets to line up with the stem before merging. */
const TRIB_IN = 0.82;
const TRIB_OUT = 0.34;

/**
 * Append one hex's water to the current path.
 *
 * @param {number} mask outlets, from outletMask()
 * @param {number} headT how far along its head a spring runs, 0..1 — the
 *   per-pass taper. Ignored by every other case.
 * @param {number} rim outlets that are the BOARD EDGE, from rimOutlet()
 * @param {number} back how far to hold those short of the rim, in world units.
 *   Pass half the stroke width and the round cap lands exactly ON the boundary,
 *   so the water is cut off by the edge of the world instead of hanging a bead
 *   of every layer's cap out over the void.
 */
export function traceChannel(ctx, q, r, size, mask, headT = 1, rim = 0, back = 0) {
  const cx = hexCx(q, r, size);
  const cy = hexCy(q, r, size);
  let n = 0;
  for (let d = 0; d < 6; d++) {
    if (!(mask & (1 << d))) continue;
    _dirs[n] = d;
    _mx[n] = edgeMidX(q, r, d, size);
    _my[n] = edgeMidY(q, r, d, size);
    if (rim & (1 << d)) {
      const ux = cx - _mx[n];
      const uy = cy - _my[n];
      const ul = Math.sqrt(ux * ux + uy * uy) || 1;
      _mx[n] += (ux / ul) * back;
      _my[n] += (uy / ul) * back;
    }
    n++;
  }

  // A pool. Nothing borders it, so it is a round of still water — and a hex
  // that silently drew nothing would be a lie about where the ford is.
  if (n === 0) { ctx.moveTo(cx, cy); ctx.lineTo(cx, cy); return; }

  // A spring or a mouth: in at the one edge, out just past the centre.
  if (n === 1) {
    const hx = cx + (cx - _mx[0]) * HEAD_OVER;
    const hy = cy + (cy - _my[0]) * HEAD_OVER;
    ctx.moveTo(_mx[0], _my[0]);
    ctx.lineTo(_mx[0] + (hx - _mx[0]) * headT, _my[0] + (hy - _my[0]) * headT);
    return;
  }

  // The stem. Control point at the CENTRE: collinear for a straight run, and
  // for a bend it pulls the water around the INSIDE of the turn, where a river
  // actually runs, instead of cutting the chord.
  const pair = mainPair(_dirs, n);
  const a = pair & 7;
  const b = pair >> 3;
  ctx.moveTo(_mx[a], _my[a]);
  ctx.quadraticCurveTo(cx, cy, _mx[b], _my[b]);
  if (n === 2) return;

  // The confluence. Every tributary ends at the SAME point on the stem, moving
  // in the SAME direction the stem moves there, so the water merges instead of
  // crossing. J is the stem's midpoint and T its tangent, both exact for a
  // quadratic: P(0.5) = (A + 2C + B)/4 and P'(0.5) = B - A.
  const jx = 0.25 * _mx[a] + 0.5 * cx + 0.25 * _mx[b];
  const jy = 0.25 * _my[a] + 0.5 * cy + 0.25 * _my[b];
  let tx = _mx[b] - _mx[a];
  let ty = _my[b] - _my[a];
  const tl = Math.sqrt(tx * tx + ty * ty) || 1;
  tx /= tl;
  ty /= tl;
  for (let i = 0; i < n; i++) {
    if (i === a || i === b) continue;
    const mx = _mx[i];
    const my = _my[i];
    // Downstream is whichever way along the stem this branch is already
    // heading: the merge that needs the least turning is the one water makes.
    const sgn = (jx - mx) * tx + (jy - my) * ty >= 0 ? 1 : -1;
    ctx.moveTo(mx, my);
    ctx.bezierCurveTo(
      mx + (cx - mx) * TRIB_IN, my + (cy - my) * TRIB_IN,
      jx - sgn * tx * size * TRIB_OUT, jy - sgn * ty * size * TRIB_OUT,
      jx, jy,
    );
  }
}

// --- The layer --------------------------------------------------------------

/**
 * Four concentric passes over ONE network, widest first: the valley the water
 * has cut, the dark bed, the water, and a lit core down the middle.
 *
 * Depth is what stops a thick river reading as a fat stroke — a channel with a
 * dark edge and a bright centre is a thing with a cross-section. It costs four
 * strokes for the whole map on a canvas that repaints on an ownership change,
 * and no shadowBlur is involved (10-50x a plain fill).
 *
 * Widths are WORLD units keyed off the hex, so the river is the same fraction
 * of a hex at every zoom, and each pass is a single stroke() — self-overlap
 * inside one path composites once, so a junction never double-darkens.
 */
const PASS_KEY = ['riverValley', 'riverBed', 'river', 'riverLit'];
const PASS_W = [1.02, 0.76, 0.56, 0.30];
const PASS_HEAD = new Float64Array(4);
for (let i = 0; i < 4; i++) {
  const reach = (HEAD_REACH - PASS_W[i] * 0.5) / (Math.sqrt(3) * 0.5 * (1 + HEAD_OVER));
  PASS_HEAD[i] = reach < 0 ? 0 : (reach > 1 ? 1 : reach);
}

export function drawRivers(ctx, o) {
  const { cols, rows, size, palette: p } = o;
  if (riverN === 0 || !p.river) return;

  // Wet ground, first: the floodplain the channel runs through. It is what
  // answers "WHICH hexes are river" at a glance — a river hex is passable, a
  // farm beside one earns more, and units fight differently on it, so that
  // question is rules information and must never need counting. Pitched far
  // enough back that the channel still carries the eye.
  if (p.riverWash) {
    ctx.beginPath();
    for (let i = 0; i < riverN; i++) {
      const q = riverQ[i];
      const r = riverR[i];
      if (hexIndex(q, r, cols, rows) < 0) continue;
      traceHex(ctx, hexCx(q, r, size), hexCy(q, r, size), size * 0.985);
    }
    ctx.fillStyle = p.riverWash;
    ctx.fill();
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let pass = 0; pass < PASS_KEY.length; pass++) {
    const color = p[PASS_KEY[pass]];
    if (!color) continue;
    const w = size * PASS_W[pass];
    ctx.beginPath();
    for (let i = 0; i < riverN; i++) {
      const q = riverQ[i];
      const r = riverR[i];
      if (hexIndex(q, r, cols, rows) < 0) continue;
      const rim = rimOutlet(riverMasks[i], q, r, cols, rows);
      traceChannel(ctx, q, r, size, riverMasks[i] | rim, PASS_HEAD[pass], rim, w * 0.5);
    }
    ctx.lineWidth = w;
    ctx.strokeStyle = color;
    ctx.stroke();
  }
  drawBanks(ctx, o);
}

/**
 * The SHORE: every hex edge where wet ground meets dry.
 *
 * This is the piece that answers "which hexes are river" without shouting,
 * because it is the one part of the water drawn ON the lattice. Interior edges
 * are skipped, so a run of river hexes outlines as one floodplain rather than
 * as a chain of lozenges — which is exactly what filling the tiles used to look
 * like, and the reason the first river was a bare stroke.
 *
 * Inset toward its own centre for the same reason the front line is: two wet
 * hexes on opposite sides of a dry one both keep their own bank.
 */
export function drawBanks(ctx, o) {
  const { cols, rows, size, palette: p } = o;
  if (!p.riverBank) return;
  const px = o.lineWidth ?? size * 0.03;
  ctx.beginPath();
  for (let i = 0; i < riverN; i++) {
    const q = riverQ[i];
    const r = riverR[i];
    if (hexIndex(q, r, cols, rows) < 0) continue;
    const mask = riverMasks[i];
    const cx = hexCx(q, r, size);
    const cy = hexCy(q, r, size);
    for (let d = 0; d < 6; d++) {
      if (mask & (1 << d)) continue;
      const e = EDGE_CORNERS[d];
      const z = size * 0.955;
      ctx.moveTo(cx + CORNER_X[e[0]] * z, cy + CORNER_Y[e[0]] * z);
      ctx.lineTo(cx + CORNER_X[e[1]] * z, cy + CORNER_Y[e[1]] * z);
    }
  }
  ctx.lineWidth = px * 2.2;
  ctx.strokeStyle = p.riverBank;
  ctx.stroke();
}

/** The live layer, for tests and for anything that needs to ask what is wet. */
export function riverLayer() {
  return riverSet;
}
