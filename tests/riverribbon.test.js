// THE RIVER'S RIBBON — the filled shapes river.js actually paints, built on
// top of the centreline proved in tests/riverdraw.test.js. Split into its own
// file to stay under the 400-line cap; see the banner there and in
// src/render/river.js for the full three-pass history.
//
// This file's job is the part that is genuinely new in pass 3: a stroked
// centreline became a FILLED ribbon so a junction's arms and a small hub disc
// overlap solid instead of leaving the wedge-shaped gap pass 2 left (visible
// in screenshots/rivers2/kaldan-junction-close.png). Nonzero-winding fill
// only unions an overlap instead of cancelling it into a hole if every
// subpath winds the SAME direction — that is checked directly below, not
// assumed.
import test from 'node:test';
import assert from 'node:assert/strict';

import { hexCx, hexCy, edgeMidX, edgeMidY, inradius } from '../src/render/hexGeom.js';
import {
  setRiverLayer, drawRivers, traceRibbon, collectOutlets, riverLayer,
} from '../src/render/river.js';
import { derive, FALLBACK } from '../src/render/palette.js';
import { siteRadius } from '../src/render/siteShapes.js';

const SIZE = 34;
const WIDTH = SIZE * 0.5; // must match RIVER_WIDTH_FRAC in river.js
const P = derive(FALLBACK);
const near = (a, b, eps = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= eps,
  `${m} ${a} !~ ${b} (delta ${Math.abs(a - b)})`);
const bits = (...ds) => ds.reduce((m, d) => m | (1 << d), 0);
const unit = ([x, y]) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };

/** Records path calls so a filled shape can be inspected as data. */
function recorder() {
  return {
    ops: [], fillStyle: '',
    beginPath() { this.ops.push(['begin']); },
    closePath() { this.ops.push(['close']); },
    moveTo(x, y) { this.ops.push(['moveTo', x, y]); },
    lineTo(x, y) { this.ops.push(['lineTo', x, y]); },
    arc(cx, cy, r, a0, a1, ccw) { this.ops.push(['arc', cx, cy, r, a0, a1, !!ccw]); },
    stroke() { this.ops.push(['stroke']); },
    fill() { this.ops.push(['fill', this.fillStyle]); },
  };
}

const ribbonOps = (q, r, mask, width = WIDTH, rim = 0, back = 0) => {
  const ctx = recorder();
  traceRibbon(ctx, q, r, SIZE, mask, width, rim, back);
  return ctx.ops;
};

/** Ribbon ops -> subpaths, each a filled polygon or a filled disc. */
function ribbonSubpaths(ops) {
  const subs = [];
  let cur = null;
  for (const op of ops) {
    if (op[0] === 'moveTo') { cur = { kind: 'poly', pts: [[op[1], op[2]]] }; subs.push(cur); }
    else if (op[0] === 'lineTo') cur.pts.push([op[1], op[2]]);
    else if (op[0] === 'arc') { cur.kind = 'circle'; cur.cx = op[1]; cur.cy = op[2]; cur.r = op[3]; }
  }
  return subs;
}

const signedArea = (pts) => {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
};

const circlePts = (cx, cy, r, steps = 48) => Array.from({ length: steps }, (_, i) => {
  const a = (i / steps) * Math.PI * 2;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
});

test('every ribbon vertex stays close to its own hex — no width blows a '
  + 'shape out into a hex two cells away', () => {
  const cx = hexCx(2, 3, SIZE);
  const cy = hexCy(2, 3, SIZE);
  const bound = inradius(SIZE) + WIDTH; // generous: the pure centreline is
                                          // already proved inside the hex
                                          // (tests/riverdraw.test.js); this
                                          // only guards a gross regression.
  for (let mask = 0; mask < 64; mask++) {
    for (const sub of ribbonSubpaths(ribbonOps(2, 3, mask))) {
      const pts = sub.kind === 'circle' ? [[sub.cx + sub.r, sub.cy], [sub.cx - sub.r, sub.cy]]
        : sub.pts;
      for (const [x, y] of pts) {
        assert.ok(Math.hypot(x - cx, y - cy) <= bound,
          `mask ${mask}: a ribbon vertex landed ${Math.hypot(x - cx, y - cy).toFixed(1)} `
          + `from centre, past the ${bound.toFixed(1)} bound`);
      }
    }
  }
});

test('the flush pair at one edge is the same regardless of whether that arm '
  + 'is part of a straight run or a bend — the seam is a property of the '
  + 'EDGE, not of the shape drawn on top of it', () => {
  const q = 2;
  const r = 3;
  const roles = [bits(0, 3), bits(0, 1), bits(0, 2), bits(0, 4)];
  const pairs = roles.map((m) => {
    const verts = ribbonSubpaths(ribbonOps(q, r, m))[0].pts;
    return [verts[0], verts.at(-1)];
  });
  // Independently re-derived from the documented formula (tangent = radial,
  // offset = (ty, -tx) * halfWidth) rather than re-running river.js's own
  // code, so a bug that changes the sign or the tangent in ONE place, without
  // the other, is what this test is actually for.
  const mx = edgeMidX(q, r, 0, SIZE);
  const my = edgeMidY(q, r, 0, SIZE);
  const cx = hexCx(q, r, SIZE);
  const cy = hexCy(q, r, SIZE);
  const [tx, ty] = unit([cx - mx, cy - my]);
  const hw = WIDTH / 2;
  const expected = [[mx + ty * hw, my - tx * hw], [mx - ty * hw, my + tx * hw]];
  for (const pair of pairs) {
    near(pair[0][0], expected[0][0], 1e-9); near(pair[0][1], expected[0][1], 1e-9);
    near(pair[1][0], expected[1][0], 1e-9); near(pair[1][1], expected[1][1], 1e-9);
  }
});

test('every ribbon subpath (rectangle, bend, spoke, disc) winds the same '
  + 'direction, so nonzero-winding fill unions an overlap instead of '
  + 'cancelling it into a hole', () => {
  let polys = 0;
  let circles = 0;
  for (let mask = 0; mask < 64; mask++) {
    for (const sub of ribbonSubpaths(ribbonOps(2, 3, mask))) {
      const pts = sub.kind === 'circle' ? circlePts(sub.cx, sub.cy, sub.r) : sub.pts;
      if (pts.length < 3) continue;
      const area = signedArea(pts);
      assert.ok(area > 0, `mask ${mask} ${sub.kind}: signed area ${area.toFixed(1)} — winding flipped`);
      if (sub.kind === 'circle') circles++; else polys++;
    }
  }
  assert.ok(polys > 0 && circles > 0, 'both shapes must appear across the 64 configurations');
});

test('a junction: every spoke ribbon overlaps the SAME hub disc in a solid '
  + '2-D region, so nothing is left for a loop to enclose', () => {
  const cx = hexCx(2, 3, SIZE);
  const cy = hexCy(2, 3, SIZE);
  const hubR = WIDTH * 1.2; // mirrors HUB_WIDTH_MULT in river.js, re-derived
                             // rather than imported, so the two can't drift
                             // apart silently.
  for (const dirs of [[0, 1, 3], [0, 2, 4], [1, 3, 5], [0, 1, 3, 4], [0, 1, 2, 3, 4, 5]]) {
    const subs = ribbonSubpaths(ribbonOps(2, 3, bits(...dirs)));
    const hub = subs.find((s) => s.kind === 'circle');
    assert.ok(hub, `${dirs}: no hub disc drawn`);
    near(hub.cx, cx, 1e-9); near(hub.cy, cy, 1e-9); near(hub.r, hubR, 1e-9);
    const spokes = subs.filter((s) => s.kind === 'poly');
    assert.equal(spokes.length, dirs.length, `${dirs}: one ribbon per arm`);
    for (const spoke of spokes) {
      const n = spoke.pts.length / 2;
      for (const [x, y] of [spoke.pts[n - 1], spoke.pts[n]]) {
        const d = Math.hypot(x - cx, y - cy);
        assert.ok(d <= hub.r + 1e-9,
          `${dirs}: a spoke's inner edge (${d.toFixed(2)}) reaches past the hub disc (${hub.r.toFixed(2)})`);
      }
    }
  }
});

/** True if (px,py) is within `hw` of the segment from (ox,oy) to (cx,cy). */
function coveredBySpoke(px, py, ox, oy, cx, cy, hw) {
  const dx = cx - ox;
  const dy = cy - oy;
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  const relx = px - ox;
  const rely = py - oy;
  const along = relx * ux + rely * uy;
  if (along < -1e-6 || along > l + 1e-6) return false;
  return Math.abs(ux * rely - uy * relx) <= hw + 1e-9;
}

test('the hub disc plus its spokes fully cover the 60-degree gap between two '
  + 'adjacent arms — no dry triangle at a junction, which is the exact bug '
  + 'the player saw in pass 2 (screenshots/rivers2/kaldan-junction-close.png)', () => {
  const cx = hexCx(2, 3, SIZE);
  const cy = hexCy(2, 3, SIZE);
  const hw = WIDTH / 2;
  const o0 = [edgeMidX(2, 3, 0, SIZE), edgeMidY(2, 3, 0, SIZE)];
  const o1 = [edgeMidX(2, 3, 1, SIZE), edgeMidY(2, 3, 1, SIZE)];
  // Read the hub back from what traceRibbon ACTUALLY drew, rather than
  // recomputing its radius from the formula — a mutation that drops the hub
  // subpath entirely (reverting to pass 2's bare spokes) must fail HERE, not
  // just in the "one shared point" test above, or this coverage check would
  // keep passing against a hub that was never actually painted.
  const subs = ribbonSubpaths(ribbonOps(2, 3, bits(0, 1, 3)));
  const hub = subs.find((s) => s.kind === 'circle');
  assert.ok(hub, 'no hub disc drawn at all — the pass-2 gap is back');
  const a0 = Math.atan2(o0[1] - cy, o0[0] - cx);
  const a1 = Math.atan2(o1[1] - cy, o1[0] - cx);
  let sampled = 0;
  for (let ri = 0; ri <= 20; ri++) {
    const rr = (WIDTH * 1.05 * ri) / 20;
    for (let ai = 0; ai <= 20; ai++) {
      const a = a0 + (a1 - a0) * (ai / 20);
      const px = cx + rr * Math.cos(a);
      const py = cy + rr * Math.sin(a);
      const covered = Math.hypot(px - cx, py - cy) <= hub.r + 1e-9
        || coveredBySpoke(px, py, o0[0], o0[1], cx, cy, hw)
        || coveredBySpoke(px, py, o1[0], o1[1], cx, cy, hw);
      assert.ok(covered, `r=${rr.toFixed(2)} angle-frac=${ai / 20}: an uncovered gap remains`);
      sampled++;
    }
  }
  assert.ok(sampled > 300);
});

// --- The layer as it is actually painted ------------------------------------

const board = (over = {}) => ({ cols: 9, rows: 9, size: SIZE, palette: P, ...over });

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

test('the whole network is ONE beginPath and ONE fill, in a single flat '
  + 'colour — no stroking any more, so an overlap at a junction cannot '
  + 'double-blend into a darker patch', () => {
  setRiverLayer([[2, 3], [3, 3], [4, 3], [3, 2]]);
  const ctx = recorder();
  drawRivers(ctx, board());
  assert.equal(ctx.ops.filter((o) => o[0] === 'begin').length, 1);
  const fills = ctx.ops.filter((o) => o[0] === 'fill');
  assert.equal(fills.length, 1);
  assert.equal(fills[0][1], P.river);
  assert.ok(!ctx.ops.some((o) => o[0] === 'stroke'), 'the ribbon is filled, never stroked');
});

test('nothing paints outside the ribbon: no floodplain wash, no shore '
  + 'hairline, no second darker or lighter pass — deleted entirely, per '
  + 'the player asking for the rest of the tile to keep its normal colour', () => {
  for (const key of ['riverWash', 'riverBank', 'riverValley', 'riverBed', 'riverLit']) {
    assert.equal(P[key], undefined, `${key} must not exist any more`);
  }
});

test('the river colour is one flat, translucent rgba — no gradient, no '
  + 'multi-layer shading', () => {
  assert.match(P.river, /^rgba\(/);
  const [red, green, blue, alpha] = P.river.match(/[\d.]+/g).map(Number);
  assert.ok(alpha > 0.3 && alpha < 0.75,
    `alpha ${alpha}: must stay translucent enough that the ground and territory `
    + 'tint under it are still clearly visible, and opaque enough to read as water');
  assert.ok(blue > red && blue > green, 'the flat colour itself must read as blue');
});

test('the ribbon is thick enough to read as a river and narrow enough not '
  + 'to swallow a farm sitting on it', () => {
  assert.ok(WIDTH > SIZE * 0.35, `the water is only ${(WIDTH / SIZE).toFixed(2)} of a hex`);
  assert.ok(WIDTH < siteRadius('farm', SIZE) * 2,
    'the water must stay narrower than a farm, or a site on the river disappears');
});

test('a river hex off the grid is not drawn at all', () => {
  setRiverLayer([[2, 3], [3, 3], [99, 99]]);
  const ctx = recorder();
  drawRivers(ctx, board());
  assert.ok(ctx.ops.filter((o) => o[0] === 'moveTo')
    .every(([, x, y]) => Math.hypot(x - hexCx(99, 99, SIZE), y - hexCy(99, 99, SIZE)) > SIZE),
  'an off-grid hex leaked onto the board');
});

test('collectOutlets marks a run-off as not flush, and a real neighbour as '
  + 'flush — the ribbon caps one and cuts the other exactly on the edge', () => {
  const inland = collectOutlets(5, 4, SIZE, bits(0), 0, 0);
  assert.equal(inland[0].flush, true);
  const rim = collectOutlets(10, 0, SIZE, bits(0, 3), bits(0), WIDTH * 0.5);
  assert.equal(rim.find((o) => o.d === 0).flush, false);
  assert.equal(rim.find((o) => o.d === 3).flush, true);
});
