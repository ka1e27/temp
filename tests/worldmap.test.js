// The world map's camera. The map is larger than the window and you drag it
// around, so the maths that decides WHERE the window is has to be right — and
// it is the part that fails silently. A pan that lets you throw the world off
// the edge screenshots perfectly and is unusable in the hand, so the clamp is
// asserted here rather than eyeballed.
//
// Everything imported below is pure. The gesture that calls it (createMapPanner)
// is driven for real by tools/smoke.mjs, which is the only place a pointer
// event means anything.
import test from 'node:test';
import assert from 'node:assert/strict';

import { REGIONS } from '../src/content/regions.data.js';
import {
  TAP_SLOP, HEX, STEP_X, STEP_Y, ZOOM, MIN_VISIBLE,
  hexToPixel, layoutHexes, clampAxis, clampPan, centreOn, revealAxis,
  fitZoom, zoomAbout,
} from '../src/screens/worldmap-pan.js';

const HEXES = REGIONS.map((r) => r.hex);
/** A 1440x900 laptop, minus the header and the decision sidebar. */
const VIEW = { w: 1046, h: 768 };

// ===========================================================================
// Layout. The point of the whole exercise: there must be more map than window.
// ===========================================================================

test('the campaign is bigger than the screen it is looked at through', () => {
  const map = layoutHexes(HEXES);
  assert.equal(map.cells.length, 18, 'every region gets a plate');
  assert.ok(map.width > VIEW.w * 1.25, `map ${map.width}px wide vs a ${VIEW.w}px window`);
  assert.ok(map.height > VIEW.h * 1.25, `map ${map.height}px tall vs a ${VIEW.h}px window`);
  // ...and a plate is big enough to read, not a token on a diagram.
  assert.ok(HEX.w >= 180 && HEX.h >= 200, 'hexes must fill the screen, not dot it');
});

test('plates are laid out on the axial grid, spaced, and never negative', () => {
  // Pointy-top axial: +q steps one full width, +r steps half a width across and
  // three quarters of a height down. Same geometry as the battle map.
  const a = hexToPixel(0, 0);
  assert.deepEqual(hexToPixel(1, 0), { x: a.x + STEP_X, y: a.y });
  assert.deepEqual(hexToPixel(0, 1), { x: a.x + STEP_X / 2, y: a.y + STEP_Y });
  assert.ok(STEP_X > HEX.w && STEP_Y > 0, 'plates are spaced, not stacked');
  assert.ok(STEP_Y < HEX.h, 'rows interlock, as a honeycomb does');

  const map = layoutHexes(HEXES);
  for (const c of map.cells) {
    assert.ok(c.x >= HEX.pad && c.y >= HEX.pad, 'padded away from the world edge');
    assert.ok(c.x + HEX.w <= map.width && c.y + HEX.h <= map.height, 'inside the box');
  }
  // Highmarch sits at r = -1, above the homeland. Shifting the layout is what
  // stops that becoming a negative `top` the clamp would have to know about.
  assert.ok(Math.min(...HEXES.map(([, r]) => r)) < 0, 'the fixture has a negative row');
});

test('no two regions land on the same plate', () => {
  const seen = new Set(layoutHexes(HEXES).cells.map((c) => `${c.x},${c.y}`));
  assert.equal(seen.size, 18);
});

// ===========================================================================
// The clamp. You may reach an edge; you may never lose the world.
// ===========================================================================

test('a map larger than the window may touch each edge and go no further', () => {
  const content = 2000;
  const view = 1000;
  assert.equal(clampAxis(0, content, view), 0, 'flush left is legal');
  assert.equal(clampAxis(-1000, content, view), -1000, 'flush right is legal');
  assert.equal(clampAxis(-450, content, view), -450, 'anywhere between is legal');

  assert.equal(clampAxis(500, content, view), 0, 'dragged right, pinned at the edge');
  assert.equal(clampAxis(-9999, content, view), -1000, 'flung left, pinned at the edge');
});

test('a map that already fits is pinned centred, not free to wander', () => {
  // Motion without information. If it all fits there is nothing to look around
  // at, so the map holds still in the middle instead of sliding to a corner.
  assert.equal(clampAxis(0, 400, 1000), 300);
  assert.equal(clampAxis(-5000, 400, 1000), 300);
  assert.equal(clampAxis(5000, 400, 1000), 300);
  assert.equal(clampAxis(0, 1000, 1000), 0, 'exactly filling is the boundary case');
});

test('no drag, at any zoom, can push the world off the screen', () => {
  const map = layoutHexes(HEXES);
  const content = { w: map.width, h: map.height };
  const throws = [
    { x: 1e6, y: 1e6 }, { x: -1e6, y: -1e6 }, { x: 1e6, y: -1e6 }, { x: 0, y: 0 },
  ];
  for (const zoom of [ZOOM.min, 0.8, 1, 1.3, ZOOM.max]) {
    for (const p of throws) {
      const c = clampPan(p, content, VIEW, zoom);
      const right = c.x + content.w * zoom;
      const bottom = c.y + content.h * zoom;
      assert.ok(right > 0 && c.x < VIEW.w, `x=${c.x} at zoom ${zoom} left nothing on screen`);
      assert.ok(bottom > 0 && c.y < VIEW.h, `y=${c.y} at zoom ${zoom} left nothing on screen`);
    }
  }
});

test('clamping applies the zoom itself, so a caller cannot forget to', () => {
  const content = { w: 1000, h: 1000 };
  const view = { w: 500, h: 500 };
  // Unscaled this content is twice the view and may pan to -500. Halve the
  // zoom and it fits exactly, so the only legal offset becomes 0.
  assert.deepEqual(clampPan({ x: -500, y: -500 }, content, view, 1), { x: -500, y: -500 });
  assert.deepEqual(clampPan({ x: -500, y: -500 }, content, view, 0.5), { x: 0, y: 0 });
});

test('clamping is idempotent — settling never drifts', () => {
  const content = { w: 1800, h: 1500 };
  const once = clampPan({ x: 4000, y: -4000 }, content, VIEW);
  assert.deepEqual(clampPan(once, content, VIEW), once);
});

// ===========================================================================
// Centring and revealing: the promise that you cannot get lost.
// ===========================================================================

test('centring puts a point in the middle of the window', () => {
  const p = centreOn(600, 400, VIEW);
  assert.equal(p.x + 600, VIEW.w / 2);
  assert.equal(p.y + 400, VIEW.h / 2);
  // Zoom is part of the projection, not applied afterwards.
  const z = centreOn(600, 400, VIEW, 0.5);
  assert.equal(z.x + 600 * 0.5, VIEW.w / 2);
});

test('the region you can act on is always reachable, corner or not', () => {
  // Every plate, centred then clamped, must end up visible. A corner region is
  // the case that breaks a naive implementation: the clamp overrides the
  // centring, and it still has to land on screen.
  const map = layoutHexes(HEXES);
  const content = { w: map.width, h: map.height };
  for (const [i, c] of map.cells.entries()) {
    const cx = c.x + HEX.w / 2;
    const cy = c.y + HEX.h / 2;
    const p = clampPan(centreOn(cx, cy, VIEW), content, VIEW);
    const sx = p.x + cx;
    const sy = p.y + cy;
    const id = REGIONS[i].id;
    assert.ok(sx > 0 && sx < VIEW.w, `${id} centre landed off screen at x=${sx}`);
    assert.ok(sy > 0 && sy < VIEW.h, `${id} centre landed off screen at y=${sy}`);
  }
});

test('revealing moves the least it can, and not at all when it need not', () => {
  const view = 1000;
  // Already comfortably inside: untouched.
  assert.equal(revealAxis(0, 400, 100, view, 1, 24), 0);
  // Off the trailing edge by 100: pulled back exactly 100 (plus the padding).
  assert.equal(revealAxis(0, 1000, 100, view, 1, 0), -100);
  assert.equal(revealAxis(0, 1000, 100, view, 1, 24), -124);
  // Off the leading edge: pushed forward to the padding, no further.
  assert.equal(revealAxis(-500, 300, 100, view, 1, 24), -276);
  // Something taller than the window shows its LEADING edge — you want the
  // thing, not the end of it. Its top lands on the padding, not its bottom.
  const big = revealAxis(0, 200, 2000, view, 1, 10);
  assert.equal(big + 200, 10, 'leading edge parked at the pad');
});

test('a hex tabbed to from off-screen is brought into view, then stays put', () => {
  const map = layoutHexes(HEXES);
  const last = map.cells[map.cells.length - 1];
  const shown = {
    x: revealAxis(0, last.x, HEX.w, VIEW.w, 1, 24),
    y: revealAxis(0, last.y, HEX.h, VIEW.h, 1, 24),
  };
  assert.ok(shown.x + last.x >= 24 - 1e-9, 'inside the left pad');
  assert.ok(shown.x + last.x + HEX.w <= VIEW.w - 24 + 1e-9, 'inside the right pad');
  assert.deepEqual(
    { x: revealAxis(shown.x, last.x, HEX.w, VIEW.w, 1, 24), y: shown.y },
    { x: shown.x, y: shown.y },
    'a second reveal of the same element is a no-op',
  );
});

// ===========================================================================
// Zoom stays subordinate: it never shrinks the world, and it never slides it.
// ===========================================================================

test('zoom sits at 1:1 for any ordinary window, and only leaves it at the extremes', () => {
  const map = layoutHexes(HEXES);
  const content = { w: map.width, h: map.height };
  assert.equal(fitZoom(content, VIEW), 1, 'on a laptop the map stays 1:1 and overflows');
  assert.equal(fitZoom(content, { w: 1400, h: 900 }), 1, 'and on anything roomier');

  // A wall-sized display would leave the world floating, so it grows to fill.
  const huge = { w: content.w * 1.5, h: content.h * 1.5 };
  assert.ok(fitZoom(content, huge) > 1.2);
  assert.ok(fitZoom(content, { w: 1e6, h: 1e6 }) <= ZOOM.max, 'and never past the ceiling');
});

test('a window too small for a couple of plates scales down until it holds them', () => {
  const map = layoutHexes(HEXES);
  const content = { w: map.width, h: map.height };
  for (const view of [{ w: 584, h: 336 }, { w: 420, h: 700 }, { w: 900, h: 260 }]) {
    const z = fitZoom(content, view);
    assert.ok(z < 1, `a ${view.w}x${view.h} window has to give ground (got ${z})`);
    assert.ok(z >= ZOOM.min, 'but never below the floor');
    if (z > ZOOM.min) {
      assert.ok(view.w / (HEX.w * z) >= MIN_VISIBLE.cols - 1e-9
        || view.h / (HEX.h * z) >= MIN_VISIBLE.rows - 1e-9,
      `${view.w}x${view.h} still cannot show a plate and its neighbour`);
    }
  }
  // Shrinking is a floor, not a fit: it stops the moment the plates fit and
  // leaves the map still overflowing, which is the point of the screen.
  const z = fitZoom(content, { w: 584, h: 336 });
  assert.ok(content.w * z > 584 && content.h * z > 336, 'still a world, not a diagram');
});

test('zooming keeps the point under the pointer under the pointer', () => {
  const pan = { x: -300, y: -200 };
  const at = { x: 512, y: 384 };
  const before = { x: (at.x - pan.x) / 1, y: (at.y - pan.y) / 1 };
  const z = zoomAbout(pan, 1, 1.4, at.x, at.y);
  assert.ok(Math.abs(z.pan.x + before.x * z.zoom - at.x) < 1e-9);
  assert.ok(Math.abs(z.pan.y + before.y * z.zoom - at.y) < 1e-9);
  assert.equal(z.zoom, 1.4);
});

test('zoom is bounded, so the map can never be scrolled into a speck or a wall', () => {
  assert.equal(zoomAbout({ x: 0, y: 0 }, 1, 99, 0, 0).zoom, ZOOM.max);
  assert.equal(zoomAbout({ x: 0, y: 0 }, 1, 0.001, 0, 0).zoom, ZOOM.min);
  assert.ok(ZOOM.min < 1 && ZOOM.max > 1);
});

// ===========================================================================
// The one number the two screens must agree on.
// ===========================================================================

test('a tap and a drag are separated by the same slop the battle board uses', async () => {
  const { readFile } = await import('node:fs/promises');
  const battle = await readFile(new URL('../src/screens/battle-input.js', import.meta.url), 'utf8');
  const theirs = Number(/TAP_SLOP\s*=\s*(\d+)/.exec(battle)?.[1]);
  assert.equal(TAP_SLOP, theirs, 'panning must feel the same on both maps');
  assert.ok(TAP_SLOP > 0 && TAP_SLOP < 16, 'big enough to forgive a hand, small enough to obey');
});
