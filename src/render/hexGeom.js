// Pure hex geometry: corners, index <-> axial, centres, bounds, and the
// positional hash the terrain is shaded from. NO imports and no canvas state,
// which is what lets both the map painter and the site glyphs sit on top of it
// without a dependency cycle.
//
// Everything here is arithmetic. Nothing allocates.

export const SQRT3 = Math.sqrt(3);

// Unit corner offsets for a pointy-top hex (angles -30 + 60k degrees).
export const CORNER_X = new Float64Array(6);
export const CORNER_Y = new Float64Array(6);
for (let i = 0; i < 6; i++) {
  const a = (Math.PI / 180) * (60 * i - 30);
  CORNER_X[i] = Math.cos(a);
  CORNER_Y[i] = Math.sin(a);
}

/** Corner pair bounding the edge facing hex.js DIRS[i]. Derived once, by hand,
 *  so edge drawing never has to do trigonometry. */
export const EDGE_CORNERS = [[0, 1], [5, 0], [4, 5], [3, 4], [2, 3], [1, 2]];
export const DIR_Q = [1, 1, 0, -1, -1, 0];
export const DIR_R = [0, -1, -1, 0, 1, 1];

/** Owner codes. Kept numeric so a whole map fits in one Uint8Array. */
export const NONE = 0, PLAYER = 1, ENEMY = 2, NEUTRAL = 3, CONTESTED = 4;
export const OWNER_CODE = {
  player: PLAYER, enemy: ENEMY, neutral: NEUTRAL, contested: CONTESTED,
};
export const CODE_KEY = [null, 'player', 'enemy', 'neutral', 'contested'];

// --- Rectangular offset layout ---------------------------------------------
// Row r spans q = -floor(r/2) .. -floor(r/2)+cols-1, which lays a pointy-top
// grid out as a clean brick rectangle. Index <-> axial is pure arithmetic, so
// neighbour lookups during front-line tracing need no map.

export const hexRow = (index, cols) => (index / cols) | 0;
export const hexQ = (index, cols) => (index % cols) - (hexRow(index, cols) >> 1);
/** Offset column of an axial q on row r: 0..cols-1 across every row. */
export const hexCol = (q, r) => q + (r >> 1);

export function hexIndex(q, r, cols, rows) {
  if (r < 0 || r >= rows) return -1;
  const col = q + (r >> 1);
  return col < 0 || col >= cols ? -1 : r * cols + col;
}

export const hexCx = (q, r, size) => size * SQRT3 * (q + r * 0.5);
export const hexCy = (q, r, size) => size * 1.5 * r;

/** World-space AABB of the whole grid, for camera.fit(). */
export function gridBounds(cols, rows, size, out) {
  const b = out || { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  b.minX = -size * SQRT3 * 0.5;
  b.maxX = hexCx(cols - 1, 0, size) + size * SQRT3 * 0.5;
  b.minY = -size;
  b.maxY = hexCy(0, rows - 1, size) + size;
  return b;
}

/** Append one hex outline to the current path. No allocation. */
export function traceHex(ctx, cx, cy, size) {
  ctx.moveTo(cx + CORNER_X[0] * size, cy + CORNER_Y[0] * size);
  for (let i = 1; i < 6; i++) ctx.lineTo(cx + CORNER_X[i] * size, cy + CORNER_Y[i] * size);
  ctx.closePath();
}

/** Deterministic 3-way split — no RNG, so the map looks identical every load. */
export function terrainTier(q, r) {
  const h = ((q * 374761393) ^ (r * 668265263)) >>> 0;
  // `^` yields a SIGNED int32, so the >>> 0 has to come after the mix or the
  // modulo produces five buckets instead of three.
  return (((h ^ (h >>> 13)) >>> 0)) % 3;
}

/** The same hash, but as a 0..1 float — the terrain shader's noise source. */
export function hashUnit(x, y) {
  let h = ((x * 374761393) ^ (y * 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h / 4294967296;
}

/** Small deterministic integer in [0,n) — picks which variant a glyph uses. */
export const hashPick = (x, y, n) => ((hashUnit(x, y) * n) | 0) % n;
