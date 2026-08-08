// THE WATER'S GEOMETRY, as pure functions.
//
// Rivers are drawn hex by hex: water enters and leaves at the MIDPOINT OF EACH
// SHARED EDGE and curves through the hex between those points. Every claim that
// makes that read as terrain rather than as an overlay is geometric, and every
// one is wrong-by-a-rounding-error invisible: the crossing point two neighbours
// compute must be the SAME POINT; the tangent there must be the edge normal from
// both sides, or the join kinks; the curve must stay INSIDE its own hex, or one
// hex's water spills over a tile it does not occupy; a tributary must arrive at
// a confluence ALONG the stem, not across it. So they are tested as arithmetic,
// over all 64 local configurations, rather than by looking at a picture.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CORNER_X, CORNER_Y, EDGE_CORNERS, DIR_Q, DIR_R, OPPOSITE, SQRT3,
  hexCx, hexCy, edgeMidX, edgeMidY, inradius,
} from '../src/render/hexGeom.js';
import {
  setRiverLayer, drawRivers, traceChannel, channelMask, outletMask, rimOutlet,
  mainPair, riverLayer,
} from '../src/render/river.js';
import { derive, FALLBACK } from '../src/render/palette.js';
import { siteRadius } from '../src/render/siteShapes.js';

const SIZE = 34;
const P = derive(FALLBACK);
const near = (a, b, eps = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= eps,
  `${m} ${a} !~ ${b} (delta ${Math.abs(a - b)})`);

/** Records path calls so a curve can be inspected as data. */
function recorder() {
  return {
    ops: [], lineWidth: 0, strokeStyle: '', fillStyle: '', lineCap: '', lineJoin: '',
    beginPath() { this.ops.push(['begin']); },
    closePath() { this.ops.push(['close']); },
    moveTo(x, y) { this.ops.push(['moveTo', x, y]); },
    lineTo(x, y) { this.ops.push(['lineTo', x, y]); },
    quadraticCurveTo(ax, ay, x, y) { this.ops.push(['quad', ax, ay, x, y]); },
    bezierCurveTo(ax, ay, bx, by, x, y) { this.ops.push(['cubic', ax, ay, bx, by, x, y]); },
    stroke() { this.ops.push(['stroke', this.lineWidth, this.strokeStyle]); },
    fill() { this.ops.push(['fill', this.fillStyle]); },
  };
}

const KIND = { lineTo: 'line', quad: 'quad', cubic: 'cubic' };

/** Path ops -> one entry per segment, with its control points in order. */
function segments(ops) {
  const out = [];
  let cur = null;
  for (const op of ops) {
    if (op[0] === 'moveTo') { cur = [op[1], op[2]]; continue; }
    if (!cur || !KIND[op[0]]) continue;
    const pts = [cur];
    for (let i = 1; i < op.length; i += 2) pts.push([op[i], op[i + 1]]);
    out.push({ kind: KIND[op[0]], pts });
    cur = pts[pts.length - 1];
  }
  return out;
}

/** de Casteljau, so one sampler covers lines, quadratics and cubics. */
function at(seg, t) {
  let p = seg.pts.map((q) => q.slice());
  while (p.length > 1) {
    const nx = [];
    for (let i = 0; i + 1 < p.length; i++) {
      nx.push([p[i][0] + (p[i + 1][0] - p[i][0]) * t, p[i][1] + (p[i + 1][1] - p[i][1]) * t]);
    }
    p = nx;
  }
  return p[0];
}

/** Direction of travel at each end: the first and last legs of the hull. */
const startDir = (s) => [s.pts[1][0] - s.pts[0][0], s.pts[1][1] - s.pts[0][1]];
const endDir = (s) => [s.pts.at(-1)[0] - s.pts.at(-2)[0], s.pts.at(-1)[1] - s.pts.at(-2)[1]];
const unit = ([x, y]) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];

/** Is a point inside the closed hex? The hex is three slabs, each bounded by
 *  the inradius along one of the edge normals. */
function insideHex(px, py, cx, cy, size) {
  const R = inradius(size) + 1e-9;
  const dx = px - cx;
  const dy = (py - cy) * (SQRT3 / 2);
  return Math.abs(dx) <= R && Math.abs(dx * 0.5 + dy) <= R && Math.abs(dy - dx * 0.5) <= R;
}

const trace = (q, r, mask, headT = 1, rim = 0, back = 0) => {
  const ctx = recorder();
  traceChannel(ctx, q, r, SIZE, mask, headT, rim, back);
  return segments(ctx.ops);
};
const bits = (...ds) => ds.reduce((m, d) => m | (1 << d), 0);

// --- 1. The crossing point: both hexes must land on the SAME two numbers ----

test('an edge midpoint is bit-identical from either hex, and really is the '
  + 'middle of the shared edge', () => {
  let checked = 0;
  for (let q = -6; q <= 6; q++) {
    for (let r = -6; r <= 6; r++) {
      const cx = hexCx(q, r, SIZE);
      const cy = hexCy(q, r, SIZE);
      for (let d = 0; d < 6; d++) {
        const o = OPPOSITE[d];
        const mx = edgeMidX(q, r, d, SIZE);
        const my = edgeMidY(q, r, d, SIZE);
        // Object.is, not a tolerance: this is the one place in the renderer
        // where "close enough" shows up as a hairline seam between two hexes'
        // water. The mean-of-centres form gets it exactly because IEEE
        // addition is commutative; the corner-offset form does NOT.
        assert.ok(Object.is(mx, edgeMidX(q + DIR_Q[d], r + DIR_R[d], o, SIZE))
          && Object.is(my, edgeMidY(q + DIR_Q[d], r + DIR_R[d], o, SIZE)),
        `${q},${r} dir ${d}: the two hexes disagree about where they meet`);
        // And it is the mean of the two corners bounding that edge — the
        // geometric definition, reached from the table the outline is drawn
        // from — which puts it exactly one inradius out, ON the boundary.
        const [a, b] = EDGE_CORNERS[d];
        near(mx, cx + (CORNER_X[a] + CORNER_X[b]) * 0.5 * SIZE, 1e-9, 'x');
        near(my, cy + (CORNER_Y[a] + CORNER_Y[b]) * 0.5 * SIZE, 1e-9, 'y');
        near(Math.hypot(mx - cx, my - cy), inradius(SIZE), 1e-9, 'inradius');
        checked++;
      }
    }
  }
  assert.equal(checked, 13 * 13 * 6);
});

// --- 2. Topology: what a hex knows about its neighbours ---------------------

test('channelMask sees exactly the neighbours that are water', () => {
  const set = new Set(['0,0', '1,0', '-1,0', '0,1']);
  assert.equal(channelMask(set, 0, 0), bits(0, 3, 5));
  // (0,1) is south-WEST of (1,0) on this lattice, not south of it — the offset
  // rows are exactly why a renderer must ask the direction table, not guess.
  assert.equal(channelMask(set, 1, 0), bits(3, 4));
  assert.equal(channelMask(set, 5, 5), 0);               // dry ground sees nothing
  assert.equal(channelMask(new Set(), 0, 0), 0);
  // One neighbour to the west, and nothing to the east but the rim.
  const onRim = channelMask(new Set(['9,0', '10,0']), 10, 0);
  assert.equal(rimOutlet(onRim, 10, 0, 11, 9), bits(0), 'should carry on over the rim');
  assert.equal(outletMask(onRim, 10, 0, 11, 9), bits(0, 3));
  // The same shape in the middle of the board is a spring, and must stay one.
  const inland = channelMask(new Set(['4,4', '5,4']), 5, 4);
  assert.equal(rimOutlet(inland, 5, 4, 11, 9), 0, 'a spring is not a rim');
  assert.equal(outletMask(inland, 5, 4, 11, 9), inland);
  // Two or more neighbours is never ambiguous, so nothing is added.
  const through = channelMask(new Set(['9,0', '10,0', '10,1']), 10, 0);
  assert.equal(rimOutlet(through, 10, 0, 11, 9), 0);
});

test('mainPair picks the straightest run and is stable on a tie', () => {
  const pick = (...dirs) => {
    const p = mainPair(dirs, dirs.length);
    return [dirs[p & 7], dirs[p >> 3]];
  };
  assert.deepEqual(pick(0, 1, 3), [0, 3], 'the opposite pair is the stem');
  assert.deepEqual(pick(1, 2, 4), [1, 4]);
  assert.deepEqual(pick(0, 1, 2), [0, 2], 'no straight run: take the widest turn');
  // Three arms at 120 degrees are all equally straight; the answer must still
  // be the same every repaint, or the confluence would flicker.
  assert.deepEqual(pick(0, 2, 4), [0, 2]);
  assert.deepEqual(pick(0, 2, 4), [0, 2]);
});

// --- 3. The curve through one hex, every case, exhaustively -----------------

test('water never leaves the hex it belongs to, in any of the 64 configurations', () => {
  const cx = hexCx(2, 3, SIZE);
  const cy = hexCy(2, 3, SIZE);
  for (let mask = 0; mask < 64; mask++) {
    for (const segment of trace(2, 3, mask)) {
      for (let i = 0; i <= 40; i++) {
        const [x, y] = at(segment, i / 40);
        assert.ok(insideHex(x, y, cx, cy, SIZE),
          `mask ${mask}: water at ${x.toFixed(2)},${y.toFixed(2)} is outside its hex`);
      }
    }
  }
});

/** The end of `seg` that lands on `pt`, and the direction the water is heading
 *  as it leaves the hex there. Which end a subpath starts from is an internal
 *  detail; the crossing is not. */
function crossingAt(seg, pt) {
  const hit = (p) => Math.hypot(p[0] - pt[0], p[1] - pt[1]) < 1e-9;
  if (hit(seg.pts[0])) return { end: seg.pts[0], out: unit(startDir(seg).map((v) => -v)) };
  if (hit(seg.pts.at(-1))) return { end: seg.pts.at(-1), out: unit(endDir(seg)) };
  return null;
}

test('every crossing leaves perpendicular to the edge — which is what makes the '
  + 'join with the next hex smooth', () => {
  const cx = hexCx(2, 3, SIZE);
  const cy = hexCy(2, 3, SIZE);
  let crossings = 0;
  for (let mask = 0; mask < 64; mask++) {
    for (const seg of trace(2, 3, mask)) {
      // Only endpoints that sit ON an edge are crossings; a spring's head and a
      // confluence are interior and free to point anywhere.
      for (let d = 0; d < 6; d++) {
        const c = crossingAt(seg, [edgeMidX(2, 3, d, SIZE), edgeMidY(2, 3, d, SIZE)]);
        if (!c) continue;
        crossings++;
        // The outward edge normal is simply the direction away from the centre.
        const want = unit([c.end[0] - cx, c.end[1] - cy]);
        near(c.out[0], want[0], 1e-12, `mask ${mask} dir ${d} tangent x`);
        near(c.out[1], want[1], 1e-12, `mask ${mask} dir ${d} tangent y`);
      }
    }
  }
  assert.ok(crossings > 100, `only ${crossings} crossings checked`);
});

test('two neighbours meet at one point, moving in exactly opposite directions', () => {
  const set = new Set(['1,3', '2,3', '3,3', '4,3', '3,2']);
  // Every shared edge on this little network, including the one into the hex
  // that turns — a bend and a straight run have to agree just as exactly.
  for (const [q, r, d] of [[2, 3, 0], [3, 3, 0], [3, 3, 2]]) {
    const nq = q + DIR_Q[d];
    const nr = r + DIR_R[d];
    const pt = [edgeMidX(q, r, d, SIZE), edgeMidY(q, r, d, SIZE)];
    const here = trace(q, r, channelMask(set, q, r)).map((s) => crossingAt(s, pt)).find(Boolean);
    const there = trace(nq, nr, channelMask(set, nq, nr))
      .map((s) => crossingAt(s, [edgeMidX(nq, nr, OPPOSITE[d], SIZE),
        edgeMidY(nq, nr, OPPOSITE[d], SIZE)])).find(Boolean);
    assert.ok(here && there, `${q},${r} dir ${d}: one side never reached the edge`);
    assert.ok(Object.is(here.end[0], there.end[0]) && Object.is(here.end[1], there.end[1]),
      `met at ${here.end} and ${there.end} — that gap is a visible seam`);
    // Leaving one hex and entering the next along the same line: no kink.
    near(here.out[0] * there.out[0] + here.out[1] * there.out[1], -1, 1e-12,
      `${q},${r} dir ${d}: headings`);
  }
});

test('a straight run is straight, and a bend actually bends', () => {
  const cx = hexCx(2, 3, SIZE);
  const cy = hexCy(2, 3, SIZE);
  const straight = trace(2, 3, bits(0, 3))[0];
  assert.equal(straight.kind, 'quad');
  near(cross(unit([straight.pts[2][0] - straight.pts[0][0],
    straight.pts[2][1] - straight.pts[0][1]]),
  unit([cx - straight.pts[0][0], cy - straight.pts[0][1]])), 0, 1e-12,
  'a run through opposite edges must be a straight line');

  for (const [d1, d2] of [[0, 1], [0, 2], [1, 3], [2, 4], [3, 5]]) {
    const seg = trace(2, 3, bits(d1, d2))[0];
    const mid = at(seg, 0.5);
    const chord = [(seg.pts[0][0] + seg.pts[2][0]) / 2, (seg.pts[0][1] + seg.pts[2][1]) / 2];
    const dCurve = Math.hypot(mid[0] - cx, mid[1] - cy);
    const dChord = Math.hypot(chord[0] - cx, chord[1] - cy);
    // The water hugs the INSIDE of the turn, the way a river does, rather than
    // cutting the chord across the tile.
    assert.ok(dCurve < dChord - SIZE * 0.05,
      `dirs ${d1}/${d2}: curve sits ${dCurve.toFixed(1)} from centre, chord ${dChord.toFixed(1)}`);
    assert.equal(seg.pts[1][0], cx, 'the control point is the hex centre');
    assert.equal(seg.pts[1][1], cy);
  }
});

test('a junction is a confluence: tributaries arrive ALONG the stem, not across it', () => {
  for (const dirs of [[0, 1, 3], [0, 2, 4], [1, 3, 5], [0, 1, 3, 4], [0, 1, 2, 3, 4, 5]]) {
    const segs = trace(2, 3, bits(...dirs));
    assert.equal(segs.length, dirs.length - 1, `${dirs}: one stem plus its tributaries`);
    const stem = segs[0];
    assert.equal(stem.kind, 'quad');
    const join = at(stem, 0.5);
    const flow = unit([stem.pts[2][0] - stem.pts[0][0], stem.pts[2][1] - stem.pts[0][1]]);
    for (let i = 1; i < segs.length; i++) {
      const t = segs[i];
      assert.equal(t.kind, 'cubic', 'a tributary needs both ends aimed');
      const end = t.pts[3];
      // Every branch ends at the SAME point, and that point is on the stem:
      // water joining water, not three lines crossing at a shared pixel.
      near(end[0], join[0], 1e-9, `${dirs}: tributary ${i} x`);
      near(end[1], join[1], 1e-9, `${dirs}: tributary ${i} y`);
      near(Math.abs(cross(unit(endDir(t)), flow)), 0, 1e-9,
        `${dirs}: tributary ${i} crosses the stem instead of merging with it`);
    }
  }
});

test('a spring tapers to a head past the centre, and a pool is just a pool', () => {
  const cx = hexCx(2, 3, SIZE);
  const cy = hexCy(2, 3, SIZE);
  const [inlet, head] = trace(2, 3, bits(0))[0].pts;
  near(inlet[0], edgeMidX(2, 3, 0, SIZE), 1e-12);
  // The head is past the centre, on the far side from where the water came in.
  const along = ((head[0] - inlet[0]) * (cx - inlet[0])
    + (head[1] - inlet[1]) * (cy - inlet[1])) / (inradius(SIZE) ** 2);
  assert.ok(along > 1, `the head stops short of the centre (${along.toFixed(2)})`);
  assert.ok(insideHex(head[0], head[1], cx, cy, SIZE), 'and it stays inside the hex');
  // A narrower layer runs further, so the layers nest into a taper instead of
  // stacking into a blunt end.
  const short = trace(2, 3, bits(0), 0.5)[0];
  assert.ok(Math.hypot(short.pts[1][0] - inlet[0], short.pts[1][1] - inlet[1])
    < Math.hypot(head[0] - inlet[0], head[1] - inlet[1]));

  const pool = trace(2, 3, 0);
  assert.equal(pool.length, 1);
  assert.deepEqual(pool[0].pts, [[cx, cy], [cx, cy]], 'a lone hex is a round of water');
});

test('a run-off at the board edge stops half a stroke short, so every layer '
  + 'ends flush ON the rim', () => {
  const edge = [edgeMidX(2, 3, 0, SIZE), edgeMidY(2, 3, 0, SIZE)];
  for (const w of [0.2, 0.56, 1.02]) {
    const seg = trace(2, 3, bits(0, 3), 1, bits(0), SIZE * w * 0.5)[0];
    const end = seg.pts[0][0] > seg.pts.at(-1)[0] ? seg.pts[0] : seg.pts.at(-1);
    // endpoint + the round cap it wears == the boundary itself.
    near(Math.hypot(end[0] - edge[0], end[1] - edge[1]), SIZE * w * 0.5, 1e-9, `width ${w}`);
    assert.ok(insideHex(end[0], end[1], hexCx(2, 3, SIZE), hexCy(2, 3, SIZE), SIZE));
  }
});

// --- 4. The layer as it is actually painted ---------------------------------

const board = (over = {}) => ({
  cols: 9, rows: 9, size: SIZE, palette: P, lineWidth: 1, ...over,
});

test('setRiverLayer takes keys or pairs, and the two agree exactly', () => {
  const draw = (rivers) => {
    setRiverLayer(rivers);
    const ctx = recorder();
    drawRivers(ctx, board());
    return ctx.ops;
  };
  const byPair = draw([[2, 3], [3, 3], [4, 3]]);
  assert.deepEqual(draw(['2,3', '3,3', '4,3']), byPair);
  setRiverLayer([[2, 3]]);
  assert.deepEqual([...riverLayer()], ['2,3']);
  assert.deepEqual(draw(null), [], 'no water, no paint');
});

test('the channel is drawn in nested layers, widest first, all keyed off the hex', () => {
  setRiverLayer([[2, 3], [3, 3], [4, 3]]);
  const ctx = recorder();
  drawRivers(ctx, board());
  const widths = ctx.ops.filter((o) => o[0] === 'stroke').map((o) => o[1]);
  assert.ok(widths.length >= 4, `expected the channel in layers, got ${widths.length} strokes`);
  const channel = widths.slice(0, 4);
  for (let i = 1; i < channel.length; i++) {
    assert.ok(channel[i] < channel[i - 1],
      `layer ${i} (${channel[i]}) must sit inside layer ${i - 1} (${channel[i - 1]})`);
  }
  // Thick enough to read as a river — the version this replaced drew the water
  // at 0.26 of a hex and it looked like a wire — and never so thick that it
  // swallows the smallest site body sitting on it, or reaches past the tile.
  const water = channel[2];
  assert.ok(water > SIZE * 0.4, `the water is only ${(water / SIZE).toFixed(2)} of a hex`);
  assert.ok(water < siteRadius('farm', SIZE) * 2,
    'the water must stay narrower than a farm, or a site on the river disappears');
  assert.ok(channel[0] * 0.5 < inradius(SIZE),
    'even the valley must not reach beyond the edge of its own hex');
});

test('the wet ground goes down BEFORE the channel, and the shore only where it '
  + 'meets dry land', () => {
  setRiverLayer([[2, 3], [3, 3]]);
  const ctx = recorder();
  drawRivers(ctx, board());
  const kinds = ctx.ops.filter((o) => o[0] === 'fill' || o[0] === 'stroke');
  assert.equal(kinds[0][0], 'fill', 'the floodplain is under the water, not over it');
  assert.equal(kinds[0][1], P.riverWash);
  assert.equal(kinds[kinds.length - 1][2], P.riverBank, 'the shore is drawn last');

  // Two hexes side by side: 12 edges, of which the shared one is interior.
  const bankOps = ctx.ops.slice(ctx.ops.lastIndexOf(
    ctx.ops.filter((o) => o[0] === 'begin').pop()));
  assert.equal(bankOps.filter((o) => o[0] === 'lineTo').length, 10,
    'the shared edge must not be banked — a floodplain has one outline, not two');
});

test('a river hex off the grid is not drawn at all', () => {
  setRiverLayer([[2, 3], [3, 3], [99, 99]]);
  const ctx = recorder();
  drawRivers(ctx, board());
  assert.ok(ctx.ops.filter((o) => o[0] === 'moveTo')
    .every(([, x, y]) => Math.hypot(x - hexCx(99, 99, SIZE), y - hexCy(99, 99, SIZE)) > SIZE),
  'an off-grid hex leaked onto the board');
});

test('the palette gives the channel a dark bed and a lighter core, so it reads '
  + 'as depth rather than as a stroke', () => {
  const lum = (s) => {
    assert.match(s, /^rgba\(/, 'must be a ready-made canvas colour');
    const [r, g, b] = s.match(/[\d.]+/g).map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  [P.riverWash, P.riverBank].forEach(lum);
  assert.ok(lum(P.riverBed) < lum(P.river), 'the bed must be darker than the water');
  assert.ok(lum(P.riverLit) > lum(P.river), 'the core must be lighter than the water');
  assert.ok(lum(P.riverValley) < lum(P.riverBed), 'the valley is the deepest shadow');
});
