// Marching formations: the pure half of the squad renderer.
//
// The load-bearing promise of this layer is that A BIGGER ARMY LOOKS BIGGER,
// so the tests are mostly about monotonicity and about the composition survivng
// the rounding — not about exact pixel counts, which are a tuning decision.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  pieceCount, formationFiles, formationRanks, campFiles, campRanks,
  staticFormationExtent, planUnits, unitOfPiece, wobble,
  SOLO, MAX_PIECES, MAX_FILES, CAMP_RANKS,
} from '../src/render/formation.js';
import { arcHeading, arcPoint } from '../src/render/routes.js';
import { UNIT_IDS } from '../src/content/balance.js';

const V = { x: 0, y: 0 };
const comp = (o) => Object.assign(
  { militia: 0, spearmen: 0, raiders: 0, rams: 0, marshal: 0 }, o,
);
const totalOf = (c) => UNIT_IDS.reduce((a, u) => a + (c[u] || 0), 0);

/** How many pieces each unit type ended up with. */
function blocks(c, pieces) {
  const t = totalOf(c);
  planUnits(c, t, pieces);
  const out = [0, 0, 0, 0, 0];
  for (let i = 0; i < pieces; i++) out[unitOfPiece(i)]++;
  return out;
}

// ---------------------------------------------------------------------------
// Piece count
// ---------------------------------------------------------------------------

test('formation: a small squad is drawn one piece per troop', () => {
  for (let n = 1; n <= SOLO; n++) assert.equal(pieceCount(n), n);
});

test('formation: piece count never falls as the army grows, and is capped', () => {
  let prev = 0;
  for (let n = 1; n <= 400; n++) {
    const p = pieceCount(n);
    assert.ok(p >= prev, `pieceCount(${n}) = ${p} dropped below ${prev}`);
    assert.ok(p <= MAX_PIECES, `pieceCount(${n}) = ${p} broke the cap`);
    prev = p;
  }
  assert.equal(pieceCount(400), MAX_PIECES);
});

test('formation: a big army is drawn with visibly more pieces than a small one', () => {
  // The whole point of the change: 40 troops must not look like 5 troops.
  assert.ok(pieceCount(40) >= pieceCount(5) * 3);
  assert.ok(pieceCount(50) > pieceCount(20));
  assert.ok(pieceCount(20) > pieceCount(10));
});

test('formation: degenerate counts still produce one piece', () => {
  assert.equal(pieceCount(0), 1);
  assert.equal(pieceCount(-5), 1);
  assert.equal(pieceCount(0.4), 1);
});

// ---------------------------------------------------------------------------
// Block shape
// ---------------------------------------------------------------------------

test('formation: the block is always a column, never wider than the cap', () => {
  for (let p = 1; p <= MAX_PIECES; p++) {
    const files = formationFiles(p);
    const ranks = formationRanks(p, files);
    assert.ok(files >= 1 && files <= MAX_FILES, `files ${files} at ${p} pieces`);
    assert.ok(files * ranks >= p, `${files}x${ranks} cannot hold ${p} pieces`);
    // Every rank but the last is full, so the last one holds 1..files.
    const rear = p - (ranks - 1) * files;
    assert.ok(rear >= 1 && rear <= files, `rear rank of ${rear} at ${p} pieces`);
    if (p > 2) assert.ok(ranks >= files, `${files}x${ranks} is not a column`);
  }
});

test('formation: a camped stack is the inverse silhouette of a marching one', () => {
  // The whole cue for "dug in, not walking on the spot" is the aspect ratio, so
  // a camp must be WIDER than deep exactly where a column is DEEPER than wide.
  for (let p = 4; p <= MAX_PIECES; p++) {
    const cFiles = campFiles(p);
    const cRanks = campRanks(p);
    assert.ok(cRanks >= 1 && cRanks <= CAMP_RANKS, `camp ranks ${cRanks} at ${p}`);
    assert.ok(cFiles * cRanks >= p, `camp ${cFiles}x${cRanks} cannot hold ${p}`);
    assert.ok(cFiles > cRanks, `camp ${cFiles}x${cRanks} is not wide and shallow`);
    const mFiles = formationFiles(p);
    const mRanks = formationRanks(p, mFiles);
    assert.ok(cFiles > mFiles, `camp is no wider than the column at ${p} pieces`);
    assert.ok(cRanks <= mRanks, `camp is deeper than the column at ${p} pieces`);
    // The cue is the aspect ratio, and it must be strictly inverted.
    assert.ok(cFiles / cRanks > mFiles / mRanks, `aspect not inverted at ${p}`);
  }
});

test('formation: a camp never gets narrower as the army grows', () => {
  // Width is the cue you read at a glance. Depth may wobble by a row when the
  // width step lets a row be dropped; width may never go backwards.
  let files = 0;
  for (let n = 1; n <= 300; n++) {
    const f = campFiles(pieceCount(n));
    assert.ok(f >= files, `camp width fell from ${files} to ${f} at ${n} troops`);
    files = f;
  }
  assert.equal(campFiles(pieceCount(4)), 3);
  assert.equal(campFiles(pieceCount(5)), 4);
});

test('formation: the reported extent covers the block it would draw', () => {
  const E = { w: 0, h: 0 };
  let prevW = 0;
  for (const n of [1, 5, 12, 30, 70, 200]) {
    staticFormationExtent(n, 3.4, E);
    assert.ok(E.w >= 3.4 && E.h >= 3.4, `extent smaller than one piece at ${n}`);
    assert.ok(E.w >= E.h, `extent is not wide and shallow at ${n}`);
    assert.ok(E.w >= prevW, `extent shrank at ${n}`);
    prevW = E.w;
  }
  // Linear in piece size, so a caller can scale it with the camera.
  const a = staticFormationExtent(70, 2, { w: 0, h: 0 });
  const b = staticFormationExtent(70, 4, { w: 0, h: 0 });
  assert.ok(Math.abs(b.w - a.w * 2) < 1e-6);
  assert.ok(Math.abs(b.h - a.h * 2) < 1e-6);
});

test('formation: the wobble is stable and bounded', () => {
  for (let i = 0; i < 200; i++) {
    const w = wobble(7, i, 1);
    assert.ok(w >= -0.5 && w < 0.5, `wobble out of range: ${w}`);
    assert.equal(w, wobble(7, i, 1), 'wobble must not change between frames');
  }
  assert.notEqual(wobble(7, 3, 1), wobble(7, 3, 2), 'axes must differ');
  assert.notEqual(wobble(7, 3, 1), wobble(8, 3, 1), 'squads must differ');
});

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

test('formation: the pieces always add up to exactly the piece count', () => {
  const cases = [
    comp({ militia: 5 }), comp({ militia: 3, spearmen: 2 }),
    comp({ militia: 60, spearmen: 20, raiders: 8, rams: 1, marshal: 1 }),
    comp({ militia: 1, spearmen: 1, raiders: 1, rams: 1, marshal: 1 }),
    comp({ rams: 200 }), comp({ militia: 100, marshal: 1 }),
  ];
  for (const c of cases) {
    const t = totalOf(c);
    const p = pieceCount(t);
    const b = blocks(c, p);
    assert.equal(b.reduce((a, x) => a + x, 0), p, JSON.stringify(c));
  }
});

test('formation: a type that is present keeps at least one piece', () => {
  // A lone marshal inside a 90-stack is the most important thing in it.
  const b = blocks(comp({ militia: 60, spearmen: 20, raiders: 8, rams: 1, marshal: 1 }), 30);
  for (let u = 0; u < b.length; u++) assert.ok(b[u] >= 1, `${UNIT_IDS[u]} vanished`);
});

test('formation: the dominant contingent is never the one rounded away', () => {
  const b = blocks(comp({ militia: 100, marshal: 1 }), pieceCount(101));
  assert.ok(b[0] > 20, `militia collapsed to ${b[0]}`);
  assert.equal(b[4], 1);
  assert.equal(b[1] + b[2] + b[3], 0, 'absent types must take no pieces');
});

test('formation: blocks are proportional and contiguous, in battle order', () => {
  const c = comp({ militia: 20, rams: 20 });
  const p = pieceCount(40);
  const b = blocks(c, p);
  assert.equal(b[0], b[3], 'an even split must draw evenly');
  // Contiguous: the type index never returns to a value it has left.
  const seen = new Set();
  let last = -1;
  for (let i = 0; i < p; i++) {
    const u = unitOfPiece(i);
    if (u !== last) {
      assert.ok(!seen.has(u), `block for ${UNIT_IDS[u]} is split in two`);
      seen.add(u);
      assert.ok(u > last, 'blocks must run in UNIT_IDS order');
      last = u;
    }
  }
});

// ---------------------------------------------------------------------------
// Route heading (the direction every piece faces)
// ---------------------------------------------------------------------------

test('routes: the heading points from the source toward the target', () => {
  arcHeading(0, 0, 100, 0, 0, 0.5, V);
  assert.ok(Math.abs(V.x - 1) < 1e-9 && Math.abs(V.y) < 1e-9);
  arcHeading(0, 0, 0, -100, 0, 0.5, V);
  assert.ok(Math.abs(V.x) < 1e-9 && Math.abs(V.y + 1) < 1e-9);
});

test('routes: the heading is a unit vector everywhere on a bowed route', () => {
  for (const bow of [-1, 1]) {
    for (let t = 0; t <= 1.0001; t += 0.05) {
      arcHeading(10, -30, 140, 90, bow, t, V);
      assert.ok(Math.abs(Math.hypot(V.x, V.y) - 1) < 1e-6, `|h| at t=${t}`);
    }
  }
});

test('routes: the heading tracks the curve, so a column bends through the bow', () => {
  // Same route, opposite bows: the tangent at the start must lean opposite ways.
  const a = arcHeading(0, 0, 100, 0, 1, 0, { x: 0, y: 0 });
  const b = arcHeading(0, 0, 100, 0, -1, 0, { x: 0, y: 0 });
  assert.ok(a.y > 0 && b.y < 0, 'bows must separate the heading');
  // And it must agree with where the route actually goes next.
  const p0 = arcPoint(0, 0, 100, 0, 1, 0, { x: 0, y: 0 });
  const p1 = arcPoint(0, 0, 100, 0, 1, 1e-4, { x: 0, y: 0 });
  const m = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  assert.ok(Math.abs((p1.x - p0.x) / m - a.x) < 1e-3);
  assert.ok(Math.abs((p1.y - p0.y) / m - a.y) < 1e-3);
});

test('routes: a zero-length route still yields a usable heading', () => {
  arcHeading(50, 50, 50, 50, 1, 0.5, V);
  assert.ok(Number.isFinite(V.x) && Number.isFinite(V.y));
  assert.equal(Math.hypot(V.x, V.y), 1);
});
