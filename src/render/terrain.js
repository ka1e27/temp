// The ground itself: shading bands, scrub, mountains, and the contested hatch.
//
// Split out of hexRenderer.js so neither file sits against the 400-line cap
// while the board is under art direction. The seam is a real one: this is
// everything painted BEFORE anybody owns anything, plus the impassable terrain
// that decides where the fighting can happen. hexRenderer.js re-exports the
// three entry points, so callers still see a single hex layer.
//
// The background canvas repaints only when ownership changes, so the extra
// passes here are effectively free. Nothing in this file runs per frame.
import {
  hexRow, hexQ, hexCol, hexIndex, hexCx, hexCy, traceHex, terrainTier,
  hashUnit, hashPick,
} from './hexGeom.js';
import { drawRivers } from './river.js';

// The water is its own file — it is the one piece of terrain with a TOPOLOGY,
// and edge-midpoint routing plus the confluence maths is more than a section of
// this one. Re-exported here so callers still see a single terrain layer.
export { setRiverLayer, drawRivers } from './river.js';

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
  g.lineCap = 'square';
  g.beginPath();
  // THREE offset diagonals. Two leaves a gap at the tile's top-left corner,
  // which at map zoom stops reading as a woven band and starts reading as
  // confetti — the one texture the front line must never look like.
  g.moveTo(-px * 2, 0); g.lineTo(0, -px * 2);
  g.moveTo(-px, px); g.lineTo(px, -px);
  g.moveTo(0, px * 2); g.lineTo(px * 2, 0);
  g.stroke();
  return ctx.createPattern(c, 'repeat');
}

/**
 * OWNERSHIP'S SECOND CHANNEL: a faction's territory gets a stripe DIRECTION,
 * not just a hue.
 *
 * Measured on the shipped palette, player-green against enemy-red is **ΔE 1.8
 * at 1.03:1 under protanopia** — one continuous field of ground, and the
 * territory flood is most of what the board actually is. `render/ownerDash.js`
 * already fixed the site-STROKE half of this (solid yours, dashed theirs,
 * dotted nobody's); this is the other half, and the bigger one by area.
 *
 * DIRECTION IS THE CHANNEL, deliberately, because it is the one that survives
 * every colour-vision deficiency AND greyscale at once — where a lightness
 * difference would collide with `floodT`'s depth ramp (the three-tier
 * heartland/frontier shading that already uses lightness to say something
 * else). Player leans one way, enemy the other, so the front line is where the
 * weave changes hands.
 *
 * IT DOES NOT COLLIDE WITH THE CONTESTED HATCH ABOVE, and that was the design
 * constraint that picked these angles: `makeHatch` is opaque (it paints its own
 * background over the flood) and sits at ±45°, while these are TRANSPARENT
 * overlays on top of a fill the flood already laid down, at a steeper pitch and
 * a much lower alpha. So contested ground still reads as the one band that
 * belongs to neither side rather than as a third faction.
 *
 * Built once per battle beside the contested hatch, counter-scaled by the
 * camera at draw time exactly as that one is, so stripe width is constant on
 * screen at any zoom.
 *
 * @param {'up'|'down'} lean which way the stripes run
 */
export function makeOwnerHatch(ctx, color, lean, px = 10) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d');
  // NO background fill: the tile stays transparent so the flood's own colour and
  // depth ramp show through between the stripes. Painting one would flatten the
  // heartland/frontier reading this sits on top of.
  g.strokeStyle = color;
  g.lineWidth = px / 5;
  g.lineCap = 'square';
  g.beginPath();
  if (lean === 'up') {
    g.moveTo(-px, px); g.lineTo(px, -px);
    g.moveTo(0, px * 2); g.lineTo(px * 2, 0);
  } else {
    g.moveTo(-px, 0); g.lineTo(px, px * 2);
    g.moveTo(0, -px); g.lineTo(px * 2, px);
  }
  g.stroke();
  return ctx.createPattern(c, 'repeat');
}

// --- Ground -----------------------------------------------------------------

/**
 * Which shading band a hex belongs to.
 *
 * Three octaves of positional noise, coarsest first, so the ground reads as
 * LANDFORM rather than as static: broad regions, patches inside them, then a
 * per-hex grain. On top of that a light from the top-left and a vignette, which
 * together give the board a direction and pull the eye to the middle where the
 * fighting is. All of it is arithmetic on integers — no gradients, no images.
 */
export function plateBand(q, r, cols, rows, steps) {
  const col = hexCol(q, r);
  const u = cols > 1 ? col / (cols - 1) : 0.5;
  const v = rows > 1 ? r / (rows - 1) : 0.5;
  const coarse = hashUnit(col >> 2, r >> 2);
  const mid = hashUnit((col >> 1) + 71, (r >> 1) + 13);
  const fine = terrainTier(q, r) * 0.5;
  const light = ((1 - u) + (1 - v)) * 0.5 - 0.5;
  const du = (u - 0.5) * 2;
  const dv = (v - 0.5) * 2;
  const vig = (du * du + dv * dv) * 0.5;
  let s = 0.54
    + (coarse - 0.5) * 0.52
    + (mid - 0.5) * 0.26
    + (fine - 0.5) * 0.14
    + light * 0.28
    - vig * 0.26;
  s = s < 0 ? 0 : (s > 0.9999 ? 0.9999 : s);
  return (s * steps) | 0;
}

/**
 * Base terrain plate. One fill per shading band for the whole map, plus one
 * stroke of scattered scrub. The background canvas repaints only on an
 * ownership change, so this is effectively free.
 */
export function drawPlates(ctx, o) {
  const { cols, rows, size, palette: p } = o;
  const plates = p.plates;
  const n = cols * rows;
  if (!plates) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const r = hexRow(i, cols);
      traceHex(ctx, hexCx(hexQ(i, cols), r, size), hexCy(0, r, size), size * 0.985);
    }
    ctx.fillStyle = p.plate;
    ctx.fill();
    return;
  }
  const steps = plates.length;
  for (let band = 0; band < steps; band++) {
    let any = false;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const r = hexRow(i, cols);
      const q = hexQ(i, cols);
      if (plateBand(q, r, cols, rows, steps) !== band) continue;
      any = true;
      traceHex(ctx, hexCx(q, r, size), hexCy(0, r, size), size * 0.985);
    }
    if (!any) continue;
    ctx.fillStyle = plates[band];
    ctx.fill();
  }
  drawScrub(ctx, o);
}

/**
 * Sparse grit. The board has large empty stretches and they need something to
 * look at that is not a site — pitched low enough that it reads as ground
 * cover rather than as content.
 *
 * Deliberately DOTS, not tufts: the first pass drew little chevrons and at
 * real zoom they were indistinguishable from the mountain glyphs, which turned
 * decoration into a false terrain signal.
 */
function drawScrub(ctx, o) {
  const { cols, rows, size, palette: p } = o;
  if (!p.speck) return;
  const n = cols * rows;
  const d = size * 0.055;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const r = hexRow(i, cols);
    const q = hexQ(i, cols);
    if (hashUnit(q * 3 + 7, r * 5 + 11) > 0.5) continue;
    const cx = hexCx(q, r, size);
    const cy = hexCy(0, r, size);
    const grains = hashPick(q + 5, r - 3, 4);
    for (let m = 0; m <= grains; m++) {
      const x = cx + (hashUnit(q * 17 + m, r * 29 - m) - 0.5) * size * 1.05;
      const y = cy + (hashUnit(q * 31 - m, r * 13 + m) - 0.5) * size;
      ctx.rect(x, y, d, d);
    }
  }
  ctx.fillStyle = p.speck;
  ctx.fill();
}

// --- Terrain features -------------------------------------------------------

/**
 * The terrain features pass: rivers, then the mountains.
 *
 * Both go ON TOP of the territory flood, for the same reason: ground the
 * player must plan around has to be legible whoever currently owns it, and a
 * saturated faction wash underneath turns blue water purple. They keep a little
 * transparency so held ground still tints them — a river inside your heartland
 * should read as water AND as yours. Mountains last, because where the two
 * could ever meet, rock wins.
 *
 * Mountains are drawn as a lit range rather than an outline, so blocked ground
 * reads as MASS and is never mistaken for empty board.
 */
export function drawBlocked(ctx, o) {
  const { cols, rows, size, blocked, palette: p } = o;
  drawRivers(ctx, o);
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

  // Two passes: the whole massif in shadow, then its top-left faces in light.
  for (let lit = 0; lit < 2; lit++) {
    ctx.beginPath();
    for (const k of blocked) {
      const c = k.indexOf(',');
      const q = +k.slice(0, c);
      const r = +k.slice(c + 1);
      if (hexIndex(q, r, cols, rows) < 0) continue;
      const cx = hexCx(q, r, size);
      const cy = hexCy(q, r, size);
      const v = hashPick(q, r, 3);
      const w = size * (0.5 + v * 0.06);
      const h = size * (0.6 + hashUnit(q + 3, r + 9) * 0.3);
      peak(ctx, cx - size * 0.26, cy + size * 0.24, w * 0.66, h * 0.7, lit);
      peak(ctx, cx + size * 0.24, cy + size * 0.32, w * 0.86, h, lit);
    }
    ctx.fillStyle = lit ? p.rockLit : p.rockDim;
    ctx.fill();
  }
}

/** One ridge triangle, or just its sunward half when `lit`. */
function peak(ctx, cx, cy, w, h, lit) {
  ctx.moveTo(cx - w, cy);
  ctx.lineTo(cx - w * 0.18, cy - h);
  if (lit) ctx.lineTo(cx - w * 0.18, cy);
  else ctx.lineTo(cx + w, cy);
  ctx.closePath();
}
