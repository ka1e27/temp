// WHERE the site panel ends up, as arithmetic.
//
// The panel moved out of a HUD corner and onto the site the player clicked, and
// that turned a static stylesheet rule into geometry that runs sixty times a
// second. Geometry like that fails SILENTLY: a panel three pixels off the edge,
// or sitting on the neighbour you were about to drag to, looks fine in a
// screenshot taken on the one map the author happened to test.
//
// So battle-anchor.js is pure functions over plain rectangles and this file
// drives them with no DOM at all — including the cases a hand test never
// reaches: a viewport smaller than the panel, a site clamped into a corner, and
// a camera panning past the point where the chosen side stops being the best
// one. tools/smoke.mjs and the browser pass cover the other half (that the
// thing is actually hit-testable); this covers the half that is maths.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  placePanel, placeTip, panelBounds, clampBox, overlapArea, boxAround,
  SIDES, CARET_EDGE, WEIGHT, STICKY, TRAIN_FAN_R,
} from '../src/screens/battle-anchor.js';

const BOUNDS = panelBounds(1440, 800, { left: 8, right: 8, top: 8, bottom: 96 });
const SIZE = { w: 240, h: 160 };

/** The panel's own box, from a placement result. */
const boxOf = (at, size = SIZE) => ({
  left: at.x, top: at.y, right: at.x + size.w, bottom: at.y + size.h,
});

const inside = (box, b) =>
  box.left >= b.left && box.top >= b.top && box.right <= b.right && box.bottom <= b.bottom;

// ---------------------------------------------------------------------------
// The primitives
// ---------------------------------------------------------------------------

test('overlapArea is the shared area, and touching edges do not count', () => {
  const a = { left: 0, top: 0, right: 10, bottom: 10 };
  assert.equal(overlapArea(a, { left: 5, top: 5, right: 15, bottom: 15 }), 25);
  assert.equal(overlapArea(a, { left: 10, top: 0, right: 20, bottom: 10 }), 0, 'edge to edge');
  assert.equal(overlapArea(a, { left: 20, top: 20, right: 30, bottom: 30 }), 0);
  assert.equal(overlapArea(a, a), 100);
});

test('clampBox pushes a box back inside, and pins one that cannot fit', () => {
  const b = { left: 0, top: 0, right: 100, bottom: 100 };
  assert.deepEqual(clampBox(-20, -20, 40, 40, b), { x: 0, y: 0 });
  assert.deepEqual(clampBox(90, 90, 40, 40, b), { x: 60, y: 60 });
  assert.deepEqual(clampBox(10, 10, 40, 40, b), { x: 10, y: 10 }, 'already inside: untouched');
  // Bigger than the bounds: the near edge is the one worth keeping, because a
  // panel running off the far edge can still be read from its start.
  assert.deepEqual(clampBox(50, 50, 300, 300, b), { x: 0, y: 0 });
});

test('panelBounds subtracts the furniture the HUD parks in the viewport', () => {
  const b = panelBounds(1000, 600, { left: 8, right: 8, top: 20, bottom: 100 });
  assert.deepEqual(b, { left: 8, top: 20, right: 992, bottom: 500 });
});

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

test('with room on every side the panel goes beside the site, vertically centred', () => {
  const site = { x: 700, y: 400 };
  const at = placePanel({ site, size: SIZE, bounds: BOUNDS, blockers: [], r: 40, gap: 14 });
  assert.equal(at.side, 'right', 'sideways first — it hides less of the board');
  assert.equal(at.x, 700 + 40 + 14);
  assert.equal(at.y, 400 - SIZE.h / 2);
  assert.equal(at.clear, true);
  assert.equal(at.edge, 'left', 'so the caret sits on the panel edge facing the site');
});

test('the panel never covers the site it describes', () => {
  const size = { w: 240, h: 160 };
  for (let x = 0; x <= 1440; x += 45) {
    for (let y = 0; y <= 800; y += 40) {
      const site = { x, y };
      const self = boxAround(x, y, 40, WEIGHT.self);
      const at = placePanel({ site, size, bounds: BOUNDS, blockers: [self], r: 40 });
      assert.equal(overlapArea(boxOf(at, size), self), 0,
        `site at ${x},${y}: panel at ${at.x},${at.y} (${at.side}) sits on its own site`);
    }
  }
});

test('the panel stays inside the bounds wherever the site is, including off screen', () => {
  for (const [x, y] of [[0, 0], [1440, 0], [0, 800], [1440, 800], [-500, 400], [2000, -900]]) {
    const at = placePanel({ site: { x, y }, size: SIZE, bounds: BOUNDS, r: 40 });
    assert.ok(inside(boxOf(at), BOUNDS),
      `site at ${x},${y}: panel ${JSON.stringify(boxOf(at))} escaped ${JSON.stringify(BOUNDS)}`);
  }
});

test('at the right-hand edge it FLIPS to the left rather than clamping over the site', () => {
  const site = { x: 1400, y: 400 };
  const self = boxAround(site.x, site.y, 40, WEIGHT.self);
  const at = placePanel({ site, size: SIZE, bounds: BOUNDS, blockers: [self], r: 40, gap: 14 });
  assert.equal(at.side, 'left');
  assert.equal(at.x + SIZE.w, 1400 - 40 - 14, 'its right edge stops short of the site');
  assert.equal(at.edge, 'right');
});

test('adjacent sites are drag targets, so the panel goes around them', () => {
  // A site with neighbours left and right: the only clear sides are up and down.
  const site = { x: 700, y: 400 };
  const blockers = [
    boxAround(700, 400, 40, WEIGHT.self),
    boxAround(700 - 200, 400, 60, WEIGHT.neighbour),
    boxAround(700 + 200, 400, 60, WEIGHT.neighbour),
  ];
  const at = placePanel({ site, size: SIZE, bounds: BOUNDS, blockers, r: 40 });
  for (const b of blockers) {
    assert.equal(overlapArea(boxOf(at), b), 0, `covered a blocker while placed ${at.side}`);
  }
});

test('ringed by neighbours on all four sides, it goes out diagonally', () => {
  // This is what the four diagonal candidates are FOR. A site in the middle of
  // its own front has a neighbour in every cardinal direction, and with only
  // four candidates the panel would have to sit on one of them.
  const site = { x: 700, y: 400 };
  const blockers = [
    boxAround(700, 400, 60, WEIGHT.self),
    boxAround(490, 400, 60, WEIGHT.neighbour),
    boxAround(910, 400, 60, WEIGHT.neighbour),
    boxAround(700, 210, 60, WEIGHT.neighbour),
    boxAround(700, 590, 60, WEIGHT.neighbour),
  ];
  const at = placePanel({ site, size: SIZE, bounds: BOUNDS, blockers, r: 60 });
  assert.equal(at.clear, true, `${at.side} still collided`);
  assert.ok(at.side.includes('-'), `expected a diagonal, got ${at.side}`);
  for (const b of blockers) assert.equal(overlapArea(boxOf(at), b), 0);
});

test('in a viewport too small for any clear placement it still stays on screen', () => {
  // 400x300 with the site dead centre: the panel is 240x160 and the site's own
  // keep-out is 120 across, so SOMETHING has to be covered. The one invariant
  // that survives is the one the player cannot recover from — it must not walk
  // off the screen.
  const bounds = panelBounds(400, 300, { left: 8, right: 8, top: 8, bottom: 8 });
  const site = { x: 200, y: 150 };
  const at = placePanel({
    site, size: SIZE, bounds, r: 60,
    blockers: [boxAround(200, 150, 60, WEIGHT.self)],
  });
  assert.ok(inside(boxOf(at), bounds), `${JSON.stringify(boxOf(at))} escaped the viewport`);
});

test('a selected stronghold keeps clear of its own training fan', () => {
  const site = { x: 700, y: 400 };
  const fan = boxAround(site.x, site.y, TRAIN_FAN_R + 24, WEIGHT.self);
  const at = placePanel({
    site, size: SIZE, bounds: BOUNDS, blockers: [fan], r: TRAIN_FAN_R + 24, gap: 14,
  });
  assert.equal(overlapArea(boxOf(at), fan), 0);
  assert.ok(at.x >= site.x + TRAIN_FAN_R, 'pushed out past the chips, not onto them');
});

test('a HUD plate is worth avoiding, but not at the cost of covering the site', () => {
  // Site in the top-left corner, with the treasury plate right where the panel
  // would like to go. Covering a plate is untidy; covering the site is a bug.
  const site = { x: 40, y: 40 };
  const self = boxAround(site.x, site.y, 40, WEIGHT.self);
  const plate = { left: 0, top: 0, right: 280, bottom: 130, w: WEIGHT.plate };
  const at = placePanel({ site, size: SIZE, bounds: BOUNDS, blockers: [self, plate], r: 40 });
  assert.equal(overlapArea(boxOf(at), self), 0);
  assert.ok(inside(boxOf(at), BOUNDS));
});

test('the caret points back at the site, and stays on the panel', () => {
  const site = { x: 700, y: 400 };
  const at = placePanel({ site, size: SIZE, bounds: BOUNDS, r: 40 });
  assert.equal(at.caretY, site.y - at.y, 'level with the site it points at');
  assert.equal(CARET_EDGE[at.side], at.edge);
  // Hard clamp in a corner: the caret is held off the corners rather than
  // running past the end of the edge it lives on.
  const corner = placePanel({ site: { x: 0, y: 0 }, size: SIZE, bounds: BOUNDS, r: 40 });
  assert.ok(corner.caretX >= 14 && corner.caretX <= SIZE.w - 14, `caretX ${corner.caretX}`);
  assert.ok(corner.caretY >= 14 && corner.caretY <= SIZE.h - 14, `caretY ${corner.caretY}`);
});

test('every candidate side has a caret edge, and none is missing from the table', () => {
  for (const s of SIDES) assert.ok(CARET_EDGE[s], `no caret edge for "${s}"`);
  assert.equal(Object.keys(CARET_EDGE).length, SIDES.length);
});

// ---------------------------------------------------------------------------
// Following a camera
// ---------------------------------------------------------------------------

test('panning moves the panel with its site, one to one', () => {
  const blockers = (x, y) => [boxAround(x, y, 40, WEIGHT.self)];
  const a = placePanel({
    site: { x: 700, y: 400 }, size: SIZE, bounds: BOUNDS, blockers: blockers(700, 400), r: 40,
  });
  const b = placePanel({
    site: { x: 640, y: 370 }, size: SIZE, bounds: BOUNDS, blockers: blockers(640, 370), r: 40,
    prefer: a.side,
  });
  assert.equal(b.side, a.side, 'same side');
  assert.equal(a.x - b.x, 60);
  assert.equal(a.y - b.y, 30);
});

test('a side it is already on is held through a small change, and dropped for a big one', () => {
  const site = { x: 700, y: 400 };
  // A blocker that costs the incumbent side less than the sticky threshold.
  const nibble = { left: 754, top: 320, right: 764, bottom: 340, w: 1 };
  assert.ok(overlapArea({ left: 754, top: 320, right: 954, bottom: 480 }, nibble) < STICKY);
  const held = placePanel({
    site, size: SIZE, bounds: BOUNDS, blockers: [nibble], r: 40, prefer: 'right',
  });
  assert.equal(held.side, 'right', 'a nibble is not worth jumping across the site for');

  // A blocker that swallows the whole right-hand placement is.
  const wall = { left: 740, top: 200, right: 1100, bottom: 600, w: WEIGHT.neighbour };
  const moved = placePanel({
    site, size: SIZE, bounds: BOUNDS, blockers: [wall], r: 40, prefer: 'right',
  });
  assert.notEqual(moved.side, 'right');
  assert.equal(overlapArea(boxOf(moved), wall), 0);
});

test('an unknown remembered side is ignored rather than trusted', () => {
  const at = placePanel({
    site: { x: 700, y: 400 }, size: SIZE, bounds: BOUNDS, r: 40, prefer: 'sideways',
  });
  assert.ok(SIDES.includes(at.side));
});

// ---------------------------------------------------------------------------
// The unit hover card
// ---------------------------------------------------------------------------

test('the tip centres over its control and is pushed off neither edge', () => {
  const bounds = panelBounds(1440, 800, { top: 8, bottom: 8 });
  const size = { w: 280, h: 120 };
  const mid = placeTip({ anchor: { x: 700, y: 640 }, size, bounds });
  assert.equal(mid.x, 700, 'centred on the chip');
  assert.equal(mid.above, true, 'over the dock, not out across the board');
  assert.equal(mid.y, 640 - 10);

  const left = placeTip({ anchor: { x: 20, y: 640 }, size, bounds });
  assert.equal(left.x - size.w / 2 >= bounds.left, true, 'never off the left edge');
  assert.equal(left.caretX >= 12, true, 'and the caret still points at the chip');

  const right = placeTip({ anchor: { x: 1430, y: 640 }, size, bounds });
  assert.equal(right.x + size.w / 2 <= bounds.right, true);
});

test('a tip with no room above it flips below instead of off the top', () => {
  const bounds = panelBounds(1440, 800, { top: 8, bottom: 8 });
  const at = placeTip({ anchor: { x: 700, y: 40 }, size: { w: 280, h: 120 }, bounds });
  assert.equal(at.above, false);
  assert.equal(at.y, 50);
});
