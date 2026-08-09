// THE RIVER'S GEOMETRY, third pass — see the banner in src/render/river.js
// for the full history of what pass 1 and pass 2 got wrong. This file proves
// the CENTRELINE claims arithmetically rather than by looking at a
// screenshot, which is exactly how pass 1 shipped an enclosed loop nobody
// noticed. The ribbon built on top of this centreline — the filled shapes
// actually painted, the winding-direction and hub-coverage proofs — is
// tests/riverribbon.test.js; split there to stay under the 400-line cap.
//
//   NO SEAM   an edge midpoint is bit-identical from either hex (unchanged
//             since pass 1 — hexGeom.js is untouched here), and every
//             crossing's tangent is exactly the edge normal, whether it
//             belongs to a straight line, a spring, or a bend's quadratic.
//   NO LOOP   0 or 1 open edge is one subpath; 2 opposite edges is one
//             subpath; a bend is ONE continuous, non-self-intersecting
//             quadratic (proved by the Bezier convex-hull property, checked
//             by sampling); 3+ open edges is the only case with more than
//             one subpath, and every one of them reaches the exact same
//             shared point, the hex centre — riverribbon.test.js takes it
//             from there to prove the FILLED version of that fact.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EDGE_CORNERS, CORNER_X, CORNER_Y, DIR_Q, DIR_R, OPPOSITE, SQRT3,
  hexCx, hexCy, edgeMidX, edgeMidY, inradius,
} from '../src/render/hexGeom.js';
import { traceChannel, channelMask, outletMask, rimOutlet } from '../src/render/river.js';

const SIZE = 34;
const WIDTH = SIZE * 0.5; // must match RIVER_WIDTH_FRAC in river.js
const near = (a, b, eps = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= eps,
  `${m} ${a} !~ ${b} (delta ${Math.abs(a - b)})`);
const bits = (...ds) => ds.reduce((m, d) => m | (1 << d), 0);
const unit = ([x, y]) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };

/** Records path calls so a curve can be inspected as data. */
function recorder() {
  return {
    ops: [],
    moveTo(x, y) { this.ops.push(['moveTo', x, y]); },
    lineTo(x, y) { this.ops.push(['lineTo', x, y]); },
    quadraticCurveTo(cx, cy, x, y) { this.ops.push(['quad', cx, cy, x, y]); },
  };
}

const KIND = { lineTo: 'line', quad: 'quad' };

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

/** de Casteljau, so one sampler covers lines and quadratics alike. */
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

const startDir = (s) => [s.pts[1][0] - s.pts[0][0], s.pts[1][1] - s.pts[0][1]];
const endDir = (s) => [s.pts.at(-1)[0] - s.pts.at(-2)[0], s.pts.at(-1)[1] - s.pts.at(-2)[1]];

/** Is a point inside the closed hex? Three slabs, each bounded by the
 *  inradius along one of the edge normals. */
function insideHex(px, py, cx, cy, size, slack = 1e-9) {
  const R = inradius(size) + slack;
  const dx = px - cx;
  const dy = (py - cy) * (SQRT3 / 2);
  return Math.abs(dx) <= R && Math.abs(dx * 0.5 + dy) <= R && Math.abs(dy - dx * 0.5) <= R;
}

const trace = (q, r, mask, rim = 0, back = 0) => {
  const ctx = recorder();
  traceChannel(ctx, q, r, SIZE, mask, rim, back);
  return segments(ctx.ops);
};

// --- 1. The crossing point: both hexes land on the SAME two numbers ---------
// Unchanged mechanism from pass 1 and pass 2 — hexGeom.js is not part of this
// rewrite — but re-proved here because it is the one property every ribbon
// shape in riverribbon.test.js depends on for a seamless join.

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
        assert.ok(Object.is(mx, edgeMidX(q + DIR_Q[d], r + DIR_R[d], o, SIZE))
          && Object.is(my, edgeMidY(q + DIR_Q[d], r + DIR_R[d], o, SIZE)),
        `${q},${r} dir ${d}: the two hexes disagree about where they meet`);
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

// --- 2. Topology: what a hex knows about its neighbours (unchanged) ---------

test('channelMask sees exactly the neighbours that are water', () => {
  const set = new Set(['0,0', '1,0', '-1,0', '0,1']);
  assert.equal(channelMask(set, 0, 0), bits(0, 3, 5));
  assert.equal(channelMask(set, 1, 0), bits(3, 4));
  assert.equal(channelMask(set, 5, 5), 0);
  assert.equal(channelMask(new Set(), 0, 0), 0);
  const onRim = channelMask(new Set(['9,0', '10,0']), 10, 0);
  assert.equal(rimOutlet(onRim, 10, 0, 11, 9), bits(0), 'should carry on over the rim');
  assert.equal(outletMask(onRim, 10, 0, 11, 9), bits(0, 3));
  const inland = channelMask(new Set(['4,4', '5,4']), 5, 4);
  assert.equal(rimOutlet(inland, 5, 4, 11, 9), 0, 'a spring is not a rim');
  assert.equal(outletMask(inland, 5, 4, 11, 9), inland);
  const through = channelMask(new Set(['9,0', '10,0', '10,1']), 10, 0);
  assert.equal(rimOutlet(through, 10, 0, 11, 9), 0);
});

// --- 3. The centreline through one hex, every case, exhaustively ------------

test('water never leaves the hex it belongs to, in any of the 64 '
  + 'configurations — true of a bend by construction, since a quadratic '
  + 'lies in the convex hull of its own control points, all three inside '
  + 'the (convex) hex', () => {
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

function crossingAt(seg, pt) {
  const hit = (p) => Math.hypot(p[0] - pt[0], p[1] - pt[1]) < 1e-9;
  if (hit(seg.pts[0])) return { end: seg.pts[0], out: unit(startDir(seg).map((v) => -v)) };
  if (hit(seg.pts.at(-1))) return { end: seg.pts.at(-1), out: unit(endDir(seg)) };
  return null;
}

test('every crossing leaves perpendicular to the edge, whether it belongs to '
  + 'a straight line or a curve — a quadratic\'s tangent at t=0 is parallel '
  + 'to (control - start) and at t=1 to (end - control), so putting the '
  + 'centre in the control slot keeps BOTH ends radial', () => {
  const cx = hexCx(2, 3, SIZE);
  const cy = hexCy(2, 3, SIZE);
  let crossings = 0;
  for (let mask = 0; mask < 64; mask++) {
    for (const seg of trace(2, 3, mask)) {
      for (let d = 0; d < 6; d++) {
        const c = crossingAt(seg, [edgeMidX(2, 3, d, SIZE), edgeMidY(2, 3, d, SIZE)]);
        if (!c) continue;
        crossings++;
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
    near(here.out[0] * there.out[0] + here.out[1] * there.out[1], -1, 1e-12,
      `${q},${r} dir ${d}: headings`);
  }
});

test('a straight run and a bend are each ONE continuous piece — a straight '
  + 'line through the centre, or a smooth quadratic bowed through it, never '
  + 'the two straight facets pass 2 drew', () => {
  const cx = hexCx(2, 3, SIZE);
  const cy = hexCy(2, 3, SIZE);
  const straight = trace(2, 3, bits(0, 3));
  assert.equal(straight.length, 1, 'a straight run must be a single unbroken line, not two spokes');
  assert.equal(straight[0].kind, 'line');
  const mid = at(straight[0], 0.5);
  near(mid[0], cx, 1e-9, 'a straight run passes exactly through the centre');
  near(mid[1], cy, 1e-9);

  for (const [d1, d2] of [[0, 1], [0, 2], [1, 3], [2, 4], [3, 5]]) {
    const [seg] = trace(2, 3, bits(d1, d2));
    assert.equal(seg.kind, 'quad', `dirs ${d1}/${d2}: a bend must be a genuine curve`);
    assert.equal(seg.pts[1][0], cx, 'the control point is exactly the hex centre');
    assert.equal(seg.pts[1][1], cy);
    const chordMid = [(seg.pts[0][0] + seg.pts[2][0]) / 2, (seg.pts[0][1] + seg.pts[2][1]) / 2];
    const curveMid = at(seg, 0.5);
    assert.ok(Math.hypot(curveMid[0] - chordMid[0], curveMid[1] - chordMid[1]) > SIZE * 0.03,
      `dirs ${d1}/${d2}: the curve sits on its own chord — it is straight, not bowed`);
  }
});

test('a junction is a confluence: every arm meets at the SAME shared point, '
  + 'so there is no shape left for it to enclose', () => {
  const cx = hexCx(2, 3, SIZE);
  const cy = hexCy(2, 3, SIZE);
  for (const dirs of [[0, 1, 3], [0, 2, 4], [1, 3, 5], [0, 1, 3, 4], [0, 1, 2, 3, 4, 5]]) {
    const segs = trace(2, 3, bits(...dirs));
    assert.equal(segs.length, dirs.length, `${dirs}: one spoke per arm`);
    for (const seg of segs) {
      assert.equal(seg.kind, 'line');
      const end = seg.pts.at(-1);
      near(end[0], cx, 1e-9, `${dirs}: an arm did not reach the shared centre`);
      near(end[1], cy, 1e-9, `${dirs}: an arm did not reach the shared centre`);
    }
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const a = segs[i].pts[0];
        const b = segs[j].pts[0];
        assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-6,
          `${dirs}: two arms started from the same point — a degenerate wedge`);
      }
    }
  }
});

test('a spring tapers to a head past the centre, and a pool is just a point', () => {
  const cx = hexCx(2, 3, SIZE);
  const cy = hexCy(2, 3, SIZE);
  const [inlet, head] = trace(2, 3, bits(0))[0].pts;
  near(inlet[0], edgeMidX(2, 3, 0, SIZE), 1e-12);
  const along = ((head[0] - inlet[0]) * (cx - inlet[0])
    + (head[1] - inlet[1]) * (cy - inlet[1])) / (inradius(SIZE) ** 2);
  assert.ok(along > 1, `the head stops short of the centre (${along.toFixed(2)})`);
  assert.ok(insideHex(head[0], head[1], cx, cy, SIZE), 'and it stays inside the hex');
  const pool = trace(2, 3, 0);
  assert.equal(pool.length, 1);
  assert.deepEqual(pool[0].pts, [[cx, cy], [cx, cy]]);
});

test('a run-off at the board edge stops half a ribbon short, so its round '
  + 'cap lands exactly ON the rim', () => {
  const edge = [edgeMidX(2, 3, 0, SIZE), edgeMidY(2, 3, 0, SIZE)];
  const seg = trace(2, 3, bits(0, 3), bits(0), WIDTH * 0.5)[0];
  const end = seg.pts[0][0] > seg.pts.at(-1)[0] ? seg.pts[0] : seg.pts.at(-1);
  near(Math.hypot(end[0] - edge[0], end[1] - edge[1]), WIDTH * 0.5, 1e-9);
  assert.ok(insideHex(end[0], end[1], hexCx(2, 3, SIZE), hexCy(2, 3, SIZE), SIZE));
});
