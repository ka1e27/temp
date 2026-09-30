import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIRS, offsetToAxial, axialToOffset, axialToPixel, pixelToAxial, hexDistance,
  neighbors, hexKey, hexCorners, ring, spiral, lineBetween, tileIndex, inBounds,
} from '../core/hex.js';

test('offset <-> axial round-trips over a grid', () => {
  for (let row = 0; row < 12; row++) {
    for (let col = 0; col < 12; col++) {
      const { q, r } = offsetToAxial(col, row);
      assert.deepEqual(axialToOffset(q, r), { col, row });
    }
  }
});

test('offsetToAxial matches the ARCHITECTURE §3 formula directly', () => {
  // q = col - (row - (row & 1)) / 2, r = row
  for (let row = 0; row < 8; row++) {
    for (let col = -3; col < 8; col++) {
      const expectedQ = col - (row - (row & 1)) / 2;
      assert.deepEqual(offsetToAxial(col, row), { q: expectedQ, r: row });
    }
  }
});

test('DIRS is E, NE, NW, W, SW, SE in that order', () => {
  assert.deepEqual(DIRS.map((d) => [d.q, d.r]), [
    [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
  ]);
});

test('neighbors(q,r) are all exactly hex-distance 1 away, matching DIRS', () => {
  const nb = neighbors(2, -1);
  assert.equal(nb.length, 6);
  nb.forEach((n, i) => {
    assert.equal(hexDistance(2, -1, n.q, n.r), 1);
    assert.deepEqual(n, { q: 2 + DIRS[i].q, r: -1 + DIRS[i].r });
  });
});

test('hexDistance is symmetric and zero for a point with itself', () => {
  assert.equal(hexDistance(0, 0, 0, 0), 0);
  assert.equal(hexDistance(3, -2, -1, 4), hexDistance(-1, 4, 3, -2));
  assert.equal(hexDistance(0, 0, 3, 0), 3);
  assert.equal(hexDistance(0, 0, 0, 3), 3);
});

test('hexKey formats as "q,r"', () => {
  assert.equal(hexKey(3, -2), '3,-2');
  assert.equal(hexKey(0, 0), '0,0');
});

test('pixel <-> axial round-trips for integer hexes over a wide range', () => {
  for (let r = -8; r <= 8; r++) {
    for (let q = -8; q <= 8; q++) {
      const { x, y } = axialToPixel(q, r);
      assert.deepEqual(pixelToAxial(x, y), { q, r });
    }
  }
});

test('axialToPixel matches the ARCHITECTURE §3 formula at size 1', () => {
  const { x, y } = axialToPixel(2, 3);
  assert.ok(Math.abs(x - Math.sqrt(3) * (2 + 3 / 2)) < 1e-9);
  assert.ok(Math.abs(y - 1.5 * 3) < 1e-9);
});

test('hexCorners returns 6 points, starting at the top vertex, clockwise', () => {
  const pts = hexCorners(0, 0, 2);
  assert.equal(pts.length, 6);
  // Top vertex: straight up from centre (screen space: negative y).
  assert.ok(Math.abs(pts[0].x) < 1e-9);
  assert.ok(Math.abs(pts[0].y - -2) < 1e-9);
  // Clockwise in screen space (y grows downward): second point is upper-right.
  assert.ok(pts[1].x > 0 && pts[1].y < 0);
  // Fourth point (index 3) is the bottom vertex.
  assert.ok(Math.abs(pts[3].x) < 1e-9);
  assert.ok(Math.abs(pts[3].y - 2) < 1e-9);
});

test('ring(q,r,0) is just the centre; ring(q,r,n) has 6n hexes, all at distance n', () => {
  assert.deepEqual(ring(5, 5, 0), [{ q: 5, r: 5 }]);
  for (const n of [1, 2, 3, 4]) {
    const hexes = ring(0, 0, n);
    assert.equal(hexes.length, 6 * n);
    for (const h of hexes) assert.equal(hexDistance(0, 0, h.q, h.r), n);
    // No duplicates.
    const keys = new Set(hexes.map((h) => hexKey(h.q, h.r)));
    assert.equal(keys.size, hexes.length);
  }
});

test('spiral(q,r,n) is the centre plus every ring up to n, no duplicates', () => {
  const n = 3;
  const hexes = spiral(1, -1, n);
  assert.equal(hexes.length, 1 + 6 * 1 + 6 * 2 + 6 * 3);
  const keys = new Set(hexes.map((h) => hexKey(h.q, h.r)));
  assert.equal(keys.size, hexes.length);
  for (const h of hexes) assert.ok(hexDistance(1, -1, h.q, h.r) <= n);
});

test('lineBetween is inclusive of both ends and has hexDistance+1 steps', () => {
  const a = { q: 0, r: 0 };
  const b = { q: 4, r: -2 };
  const line = lineBetween(a, b);
  assert.deepEqual(line[0], a);
  assert.deepEqual(line[line.length - 1], b);
  assert.equal(line.length, hexDistance(a.q, a.r, b.q, b.r) + 1);
  // Consecutive steps are always adjacent (distance 1).
  for (let i = 1; i < line.length; i++) {
    assert.equal(hexDistance(line[i - 1].q, line[i - 1].r, line[i].q, line[i].r), 1);
  }
});

test('lineBetween of a point to itself is that single point', () => {
  assert.deepEqual(lineBetween({ q: 2, r: 2 }, { q: 2, r: 2 }), [{ q: 2, r: 2 }]);
});

test('tileIndex and inBounds', () => {
  assert.equal(tileIndex(0, 0, 48), 0);
  assert.equal(tileIndex(47, 0, 48), 47);
  assert.equal(tileIndex(0, 1, 48), 48);
  assert.equal(tileIndex(2, 3, 10), 32);

  assert.ok(inBounds(0, 0, 48, 36));
  assert.ok(inBounds(47, 35, 48, 36));
  assert.ok(!inBounds(-1, 0, 48, 36));
  assert.ok(!inBounds(48, 0, 48, 36));
  assert.ok(!inBounds(0, 36, 48, 36));
  assert.ok(!inBounds(0, -1, 48, 36));
});
