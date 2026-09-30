// Pointy-top hex grid, axial coordinates (q, r), stored in an offset "odd-r"
// grid of cols x rows (tile index i = row * cols + col). See ARCHITECTURE §3
// for the exact conventions — every formula below is normative, not just an
// implementation choice, because the world, battle and render modules all
// share this file. PURE: no DOM, no Math.random, no Date.now.

/** @typedef {{q: number, r: number}} Axial */
/** @typedef {{x: number, y: number}} Point */

/** Neighbour directions in axial space, in this fixed order: E, NE, NW, W, SW, SE. */
export const DIRS = Object.freeze([
  Object.freeze({ q: 1, r: 0 }),
  Object.freeze({ q: 1, r: -1 }),
  Object.freeze({ q: 0, r: -1 }),
  Object.freeze({ q: -1, r: 0 }),
  Object.freeze({ q: -1, r: 1 }),
  Object.freeze({ q: 0, r: 1 }),
]);

/** Offset (col,row) -> axial. Pointy-top, "odd-r" (odd rows shifted east). */
export function offsetToAxial(col, row) {
  return { q: col - (row - (row & 1)) / 2, r: row };
}

/** Inverse of offsetToAxial. */
export function axialToOffset(q, r) {
  return { col: q + (r - (r & 1)) / 2, row: r };
}

/**
 * Axial -> pixel centre, pointy-top, in WORLD UNITS (hex size = 1 = centre to
 * corner) by default. The renderer multiplies by its own zoom; pass `size` to
 * scale directly when that's more convenient.
 */
export function axialToPixel(q, r, size = 1) {
  return { x: size * Math.sqrt(3) * (q + r / 2), y: size * 1.5 * r };
}

/** Round fractional cube coords to the nearest hex (integer axial). */
function cubeRound(qf, rf) {
  let x = qf;
  let z = rf;
  let y = -x - z;
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

/** Pixel -> nearest hex (axial), inverse of axialToPixel, via cube rounding. */
export function pixelToAxial(x, y, size = 1) {
  const rf = y / (1.5 * size);
  const qf = x / (Math.sqrt(3) * size) - rf / 2;
  return cubeRound(qf, rf);
}

/** Hex distance between two axial points. */
export function hexDistance(q1, r1, q2, r2) {
  return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
}

/** The six axial neighbours of (q, r), in DIRS order. */
export function neighbors(q, r) {
  return DIRS.map((d) => ({ q: q + d.q, r: r + d.r }));
}

/** Canonical string key for an axial hex, e.g. "3,-2". */
export function hexKey(q, r) {
  return `${q},${r}`;
}

/**
 * The six corner points of a pointy-top hex centred at (cx, cy), starting at
 * the top vertex and going clockwise (screen space: y grows downward).
 */
export function hexCorners(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 90);
    pts.push({ x: cx + size * Math.cos(angle), y: cy + size * Math.sin(angle) });
  }
  return pts;
}

/** All hexes at EXACTLY distance `n` from (q, r). `ring(q, r, 0)` is `[{q, r}]`. */
export function ring(q, r, n) {
  if (n === 0) return [{ q, r }];
  const results = [];
  // Walk the ring starting n steps in DIRS[4] (SW), then follow each side.
  let hq = q + DIRS[4].q * n;
  let hr = r + DIRS[4].r * n;
  for (let side = 0; side < 6; side++) {
    const d = DIRS[side];
    for (let step = 0; step < n; step++) {
      results.push({ q: hq, r: hr });
      hq += d.q;
      hr += d.r;
    }
  }
  return results;
}

/** All hexes within radius `n` of (q, r), including the centre, ring by ring. */
export function spiral(q, r, n) {
  const out = [];
  for (let k = 0; k <= n; k++) out.push(...ring(q, r, k));
  return out;
}

/** Hex line from axial point `a` to axial point `b`, inclusive both ends. */
export function lineBetween(a, b) {
  const n = hexDistance(a.q, a.r, b.q, b.r);
  if (n === 0) return [{ q: a.q, r: a.r }];
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const qf = a.q + (b.q - a.q) * t;
    const rf = a.r + (b.r - a.r) * t;
    out.push(cubeRound(qf, rf));
  }
  return out;
}

/** Tile index in the offset grid: i = row * cols + col. */
export function tileIndex(col, row, cols) {
  return row * cols + col;
}

/** Is (col, row) inside a `cols` x `rows` offset grid? */
export function inBounds(col, row, cols, rows) {
  return col >= 0 && col < cols && row >= 0 && row < rows;
}
