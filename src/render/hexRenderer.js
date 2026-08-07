// The hex grid, shared by the battle map and (later) the world map — one
// visual language at two zoom levels.
//
// The territory flood is the signature mechanic: every hex is painted with
// whichever faction's influence is strongest, and near-ties are hatched, so
// THE FRONT LINE DRAWS ITSELF with no numbers to read. Everything here batches
// by colour — one beginPath/fill per faction, not per hex — and allocates
// nothing inside a draw call.

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
const DIR_Q = [1, 1, 0, -1, -1, 0];
const DIR_R = [0, -1, -1, 0, 1, 1];

/** Owner codes. Kept numeric so a whole map fits in one Uint8Array. */
export const NONE = 0, PLAYER = 1, ENEMY = 2, NEUTRAL = 3, CONTESTED = 4;
const OWNER_CODE = { player: PLAYER, enemy: ENEMY, neutral: NEUTRAL, contested: CONTESTED };
const CODE_KEY = [null, 'player', 'enemy', 'neutral', 'contested'];

// --- Rectangular offset layout ---------------------------------------------
// Row r spans q = -floor(r/2) .. -floor(r/2)+cols-1, which lays a pointy-top
// grid out as a clean brick rectangle. Index <-> axial is pure arithmetic, so
// neighbour lookups during front-line tracing need no map.

export const hexRow = (index, cols) => (index / cols) | 0;
export const hexQ = (index, cols) => (index % cols) - (hexRow(index, cols) >> 1);

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

/**
 * Resolve state.influence into a dense owner buffer. Called only when the
 * background is dirty (an ownership change), never per frame.
 * @returns {Uint8Array}
 */
export function computeOwners(influence, cols, rows, buf) {
  const out = buf && buf.length === cols * rows ? buf : new Uint8Array(cols * rows);
  out.fill(NONE);
  if (!influence) return out;
  for (const k in influence) {
    const c = k.indexOf(',');
    const q = +k.slice(0, c);
    const r = +k.slice(c + 1);
    const i = hexIndex(q, r, cols, rows);
    if (i >= 0) out[i] = OWNER_CODE[influence[k]] || NONE;
  }
  return out;
}

/**
 * Diagonal two-tone hatch for contested ground. Built once and counter-scaled
 * by the camera so the stripes stay a constant width on screen at any zoom.
 */
export function makeHatch(ctx, colorA, colorB, px = 8) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d');
  g.fillStyle = colorA;
  g.fillRect(0, 0, px, px);
  g.strokeStyle = colorB;
  g.lineWidth = px / 2.4;
  g.beginPath();
  // Two offset diagonals so the tile repeats seamlessly.
  g.moveTo(-px, px); g.lineTo(px, -px);
  g.moveTo(0, px * 2); g.lineTo(px * 2, 0);
  g.stroke();
  return ctx.createPattern(c, 'repeat');
}

/**
 * Base terrain plate. Three brightness tiers chosen by a cheap positional hash
 * give the ground texture without an image, and still cost three fills total.
 */
export function drawPlates(ctx, o) {
  const { cols, rows, size, palette: p } = o;
  const shades = _shades(p);
  for (let tier = 0; tier < 3; tier++) {
    ctx.beginPath();
    for (let i = 0; i < cols * rows; i++) {
      const r = hexRow(i, cols);
      const q = hexQ(i, cols);
      if (terrainTier(q, r) !== tier) continue;
      traceHex(ctx, hexCx(q, r, size), hexCy(q, r, size), size * 0.985);
    }
    ctx.fillStyle = shades[tier];
    ctx.fill();
  }
}

/** Deterministic 3-way split — no RNG, so the map looks identical every load. */
export function terrainTier(q, r) {
  const h = ((q * 374761393) ^ (r * 668265263)) >>> 0;
  // `^` yields a SIGNED int32, so the >>> 0 has to come after the mix or the
  // modulo produces five buckets instead of three.
  return (((h ^ (h >>> 13)) >>> 0)) % 3;
}

let _shadeCache = null;
function _shades(p) {
  if (!_shadeCache || _shadeCache.p !== p) {
    _shadeCache = { p, list: [p.plate, p.surface, p.surface2] };
  }
  return _shadeCache.list;
}

/**
 * The territory flood. One fill per faction, plus one patterned fill for
 * contested ground.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{cols:number,rows:number,size:number,owners:Uint8Array,palette:object,
 *          hatch:CanvasPattern|null, zoom:number}} o
 */
export function drawFlood(ctx, o) {
  const { cols, rows, size, owners, palette: p } = o;
  const n = cols * rows;
  for (let code = PLAYER; code <= NEUTRAL; code++) {
    let any = false;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (owners[i] !== code) continue;
      any = true;
      const r = hexRow(i, cols);
      traceHex(ctx, hexCx(hexQ(i, cols), r, size), hexCy(0, r, size), size * 0.985);
    }
    if (!any) continue;
    ctx.fillStyle = p.flood[CODE_KEY[code]];
    ctx.fill();
  }

  // Contested: a hatched band, so a stalemate line is visually distinct from
  // "nobody has been here" rather than just a duller colour.
  let anyContested = false;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    if (owners[i] !== CONTESTED) continue;
    anyContested = true;
    const r = hexRow(i, cols);
    traceHex(ctx, hexCx(hexQ(i, cols), r, size), hexCy(0, r, size), size * 0.985);
  }
  if (!anyContested) return;
  if (o.hatch) {
    if (o.hatch.setTransform && typeof DOMMatrix === 'function') {
      const k = 1 / (o.zoom || 1);
      o.hatch.setTransform(new DOMMatrix([k, 0, 0, k, 0, 0]));
    }
    ctx.fillStyle = o.hatch;
  } else {
    ctx.fillStyle = p.flood.contested;
  }
  ctx.fill();
}

/**
 * The front line: only those edges where influence changes.
 *
 * Two tiers, and the distinction is the whole point. An edge against ANOTHER
 * FACTION is the front — thick and bright. An edge against unclaimed ground is
 * merely the limit of your reach — thin and quiet. Drawing both at the same
 * weight turns the map into a wireframe and buries the one line that matters.
 * Batched: two strokes per faction, whatever the map size.
 */
export function drawFrontLine(ctx, o) {
  const { cols, rows, size, owners, palette: p } = o;
  const n = cols * rows;
  const base = o.lineWidth ?? 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (let code = PLAYER; code <= CONTESTED; code++) {
    for (let hard = 0; hard < 2; hard++) {
      let any = false;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if (owners[i] !== code) continue;
        const r = hexRow(i, cols);
        const q = hexQ(i, cols);
        const cx = hexCx(q, r, size);
        const cy = hexCy(q, r, size);
        for (let d = 0; d < 6; d++) {
          const j = hexIndex(q + DIR_Q[d], r + DIR_R[d], cols, rows);
          const other = j >= 0 ? owners[j] : NONE;
          if (other === code) continue;
          // Neutral ground counts as unclaimed on BOTH sides: nobody is
          // fighting over it, so it never earns the front-line weight.
          const isFront = other !== NONE && other !== NEUTRAL && code !== NEUTRAL;
          if (isFront !== !!hard) continue;
          any = true;
          // Front-line edges are inset toward their own hex centre so BOTH
          // factions' colours survive on a shared border: two armies facing
          // each other, not whichever one happened to draw last.
          const z = hard ? size * 0.955 : size;
          const e = EDGE_CORNERS[d];
          ctx.moveTo(cx + CORNER_X[e[0]] * z, cy + CORNER_Y[e[0]] * z);
          ctx.lineTo(cx + CORNER_X[e[1]] * z, cy + CORNER_Y[e[1]] * z);
        }
      }
      if (!any) continue;
      ctx.lineWidth = hard ? base * 1.5 : base * 0.55;
      ctx.strokeStyle = hard ? p.border[CODE_KEY[code]] : p.edge[CODE_KEY[code]];
      ctx.stroke();
    }
  }
}

/** Mountains and water: impassable, and the reason chokepoints exist. */
export function drawBlocked(ctx, o) {
  const { cols, rows, size, blocked, palette: p } = o;
  if (!blocked || blocked.size === 0) return;
  ctx.beginPath();
  for (const k of blocked) {
    const c = k.indexOf(',');
    const q = +k.slice(0, c);
    const r = +k.slice(c + 1);
    if (hexIndex(q, r, cols, rows) < 0) continue;
    traceHex(ctx, hexCx(q, r, size), hexCy(q, r, size), size * 0.985);
  }
  ctx.fillStyle = p.blocked;
  ctx.fill();

  // A ridge glyph reads as terrain at any zoom and costs one extra path.
  ctx.beginPath();
  for (const k of blocked) {
    const c = k.indexOf(',');
    const q = +k.slice(0, c);
    const r = +k.slice(c + 1);
    if (hexIndex(q, r, cols, rows) < 0) continue;
    const cx = hexCx(q, r, size);
    const cy = hexCy(q, r, size);
    const w = size * 0.44;
    ctx.moveTo(cx - w, cy + w * 0.5);
    ctx.lineTo(cx - w * 0.25, cy - w * 0.55);
    ctx.lineTo(cx + w * 0.2, cy + w * 0.1);
    ctx.lineTo(cx + w * 0.55, cy - w * 0.3);
    ctx.lineTo(cx + w, cy + w * 0.5);
  }
  ctx.strokeStyle = p.blockedEdge;
  ctx.lineWidth = (o.lineWidth ?? 2) * 0.8;
  ctx.stroke();
}

/** Grid lattice. Each interior edge is drawn exactly once (one direction from
 *  each opposing pair), plus the outer boundary, so no edge double-darkens. */
export function drawGridLines(ctx, o) {
  const { cols, rows, size, palette: p } = o;
  const n = cols * rows;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const r = hexRow(i, cols);
    const q = hexQ(i, cols);
    const cx = hexCx(q, r, size);
    const cy = hexCy(q, r, size);
    for (let d = 0; d < 6; d++) {
      // 0/4/5 is one direction from each opposite pair; 1/2/3 only at the rim.
      if (d !== 0 && d !== 4 && d !== 5
        && hexIndex(q + DIR_Q[d], r + DIR_R[d], cols, rows) >= 0) continue;
      const e = EDGE_CORNERS[d];
      ctx.moveTo(cx + CORNER_X[e[0]] * size, cy + CORNER_Y[e[0]] * size);
      ctx.lineTo(cx + CORNER_X[e[1]] * size, cy + CORNER_Y[e[1]] * size);
    }
  }
  ctx.strokeStyle = p.grid;
  ctx.lineWidth = o.lineWidth ?? 1;
  ctx.stroke();
}

/** Outline a single hex, used for hover and selection highlights. */
export function strokeHex(ctx, q, r, size, color, width) {
  ctx.beginPath();
  traceHex(ctx, hexCx(q, r, size), hexCy(q, r, size), size * 0.94);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}
