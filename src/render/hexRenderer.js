// WHO OWNS WHAT: the territory flood, the front line, and the lattice they sit
// on. One visual language, shared by the battle map and (later) the world map.
//
// The flood is the signature mechanic: every hex is painted with whichever
// faction's influence is strongest, near-ties are hatched, and the fill fades
// from a saturated heartland out to a pale frontier — so THE FRONT LINE DRAWS
// ITSELF with no numbers to read. Everything here batches by colour: one
// beginPath/fill per faction per depth, not per hex, and no allocation inside
// a draw call.
//
// This module is the middle of three layers, and it re-exports the other two
// so every caller and test still imports one "hex layer":
//   hexGeom.js   pure arithmetic — corners, index <-> axial, the terrain hash
//   hexRenderer  ownership — flood, front line, grid            (this file)
//   terrain.js   the ground — shading, scrub, mountains, rivers, the hatch
import {
  CORNER_X, CORNER_Y, EDGE_CORNERS, DIR_Q, DIR_R, NONE, PLAYER, NEUTRAL,
  CONTESTED, OWNER_CODE, CODE_KEY, hexRow, hexQ, hexIndex, hexCx, hexCy,
  traceHex,
} from './hexGeom.js';

export {
  SQRT3, CORNER_X, CORNER_Y, EDGE_CORNERS, NONE, PLAYER, ENEMY, NEUTRAL,
  CONTESTED, hexRow, hexQ, hexIndex, hexCx, hexCy, gridBounds, traceHex,
  terrainTier,
} from './hexGeom.js';
export {
  makeHatch, plateBand, drawPlates, drawBlocked, drawRivers, setRiverLayer,
} from './terrain.js';

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

// --- Territory --------------------------------------------------------------

/** How enclosed a hex is by its own faction: 0 frontier, 2 heartland. */
function depthTier(owners, q, r, cols, rows, code) {
  let same = 0;
  for (let d = 0; d < 6; d++) {
    const j = hexIndex(q + DIR_Q[d], r + DIR_R[d], cols, rows);
    if (j >= 0 && owners[j] === code) same++;
  }
  return same >= 6 ? 2 : (same >= 4 ? 1 : 0);
}

/**
 * The territory flood, in three depths per faction.
 *
 * A heartland is saturated and a frontier fades out, so held ground has a
 * gradient and a direction instead of being one flat slab — and the fade
 * points at the front line, which is the thing worth looking at. Still one
 * fill per faction per depth, whatever the map size.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{cols:number,rows:number,size:number,owners:Uint8Array,palette:object,
 *          hatch:CanvasPattern|null, zoom:number}} o
 */
export function drawFlood(ctx, o) {
  const { cols, rows, size, owners, palette: p } = o;
  const n = cols * rows;
  for (let code = PLAYER; code <= NEUTRAL; code++) {
    const key = CODE_KEY[code];
    const ramp = p.floodT && p.floodT[key];
    const depths = ramp ? 3 : 1;
    for (let t = 0; t < depths; t++) {
      let any = false;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if (owners[i] !== code) continue;
        const r = hexRow(i, cols);
        const q = hexQ(i, cols);
        if (ramp && depthTier(owners, q, r, cols, rows, code) !== t) continue;
        any = true;
        traceHex(ctx, hexCx(q, r, size), hexCy(0, r, size), size * 0.985);
      }
      if (!any) continue;
      ctx.fillStyle = ramp ? ramp[t] : p.flood[key];
      ctx.fill();
    }
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
 * FACTION is the front — thick, bright, and laid over a wide faint stroke of
 * the same path so it glows without a shadowBlur. An edge against unclaimed
 * ground is merely the limit of your reach — thin and quiet. Drawing both at
 * the same weight turns the map into a wireframe and buries the one line that
 * matters. Batched: at most three strokes per faction, whatever the map size.
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
      // Same path, stroked twice: a soft shoulder, then the line itself.
      if (hard && p.frontGlow) {
        ctx.lineWidth = base * 5;
        ctx.strokeStyle = p.frontGlow[CODE_KEY[code]];
        ctx.stroke();
      }
      ctx.lineWidth = hard ? base * 1.5 : base * 0.55;
      ctx.strokeStyle = hard ? p.border[CODE_KEY[code]] : p.edge[CODE_KEY[code]];
      ctx.stroke();
    }
  }
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
