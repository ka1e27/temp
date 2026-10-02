// Drawing parts of the Tapestry (game/render/tapestry.js): the basket weave, the hexagon chain, the seals, the title
// ribbon and the little stat icons. Pure canvas drawing, sized in whatever unit the caller passes; nothing here knows the
// layout. Split out of tapestry.js to keep each file small; not part of any public API.
import { shade, rgba, ACCENTS } from './palette.js';
import { drawCrownPips } from './crownPips.js';

export const INK = ACCENTS.ink; // #2a1d05
export const PARCHMENT = '#efe3c3';
export const PARCHMENT_LIGHT = '#f7efd8';
export const PARCHMENT_DARK = '#d9c79a';
export const GOLD = '#e0a82e';
export const GOLD_LIGHT = '#f7d774';
export const WOOD = '#6b4a2b';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function roman(n) {
  const table = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let v = Math.max(1, Math.round(n));
  let out = '';
  for (const [val, sym] of table) while (v >= val) { out += sym; v -= val; }
  return out || 'I';
}

/** Largest font size (px) at most `size` at which `text` fits `maxW`. */
export function fitFont(ctx, text, maxW, size, weight, family, minSize = size * 0.55) {
  let s = size;
  for (; s > minSize; s -= size * 0.04) {
    ctx.font = `${weight} ${s}px ${family}`;
    if (ctx.measureText(text).width <= maxW) return s;
  }
  return minSize;
}

export function setSpacing(ctx, em, px) {
  try { ctx.letterSpacing = `${(em * px).toFixed(2)}px`; } catch { /* not supported: plain spacing */ }
}

export function polygon(ctx, pts) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

export function hexagon(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3; // pointy-top, like the map
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

// --- the woven border -----------------------------------------------------------------------------------

/** A rectangle of basket weave in three tones of the realm colour. */
export function weaveRect(ctx, x, y, w, h, cell, tones) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = tones.dark;
  ctx.fillRect(x, y, w, h);
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const cx = x + i * cell;
      const cy = y + j * cell;
      const horizontal = (i + j) % 2 === 0;
      ctx.fillStyle = horizontal ? tones.mid : tones.dark;
      ctx.fillRect(cx, cy, cell, cell);
      // the thread's rounded shoulder: a light strip along its length, a shadow strip under it
      ctx.fillStyle = tones.light;
      ctx.globalAlpha = horizontal ? 0.34 : 0.2;
      if (horizontal) ctx.fillRect(cx, cy + cell * 0.14, cell, cell * 0.26);
      else ctx.fillRect(cx + cell * 0.14, cy, cell * 0.26, cell);
      ctx.fillStyle = '#000';
      ctx.globalAlpha = 0.22;
      if (horizontal) ctx.fillRect(cx, cy + cell * 0.74, cell, cell * 0.26);
      else ctx.fillRect(cx + cell * 0.74, cy, cell * 0.26, cell);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

/** A chain of little gold-edged hexagons along a straight run, alternating the realm colour and cream. */
export function hexChain(ctx, x0, y0, x1, y1, r, color, cream) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const step = r * 2.7;
  const n = Math.max(1, Math.floor(len / step));
  const pad = (len - (n - 1) * step) / 2;
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  for (let i = 0; i < n; i++) {
    const cx = x0 + ux * (pad + i * step);
    const cy = y0 + uy * (pad + i * step);
    hexagon(ctx, cx, cy, r);
    ctx.fillStyle = i % 2 ? cream : color;
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.18);
    ctx.strokeStyle = GOLD;
    ctx.stroke();
    hexagon(ctx, cx, cy, r * 0.55);
    ctx.lineWidth = Math.max(0.8, r * 0.08);
    ctx.strokeStyle = rgba(INK, 0.45);
    ctx.stroke();
  }
}

/** A round seal in a corner: gold ring, the realm colour, and either an emblem or a numeral. */
export function seal(ctx, cx, cy, r, color, glyph) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = r * 0.35;
  ctx.shadowOffsetY = r * 0.12;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  const ring = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  ring.addColorStop(0, GOLD_LIGHT);
  ring.addColorStop(1, '#b5801a');
  ctx.fillStyle = ring;
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
  const disc = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r * 0.85);
  disc.addColorStop(0, shade(color, 0.18));
  disc.addColorStop(0.6, color);
  disc.addColorStop(1, shade(color, -0.4));
  ctx.fillStyle = disc;
  ctx.fill();
  ctx.lineWidth = r * 0.05;
  ctx.strokeStyle = rgba(INK, 0.55);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.68, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1, r * 0.04);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.stroke();
  glyph(ctx, cx, cy, r);
}

// --- the ribbon (title cartouche) --------------------------------------------------------------------------

export function ribbon(ctx, cx, cy, w, h, tail, fold) {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const top = cy - h / 2;
  const bottom = cy + h / 2;
  const lowered = fold; // the tails sit lower than the body, as a folded ribbon does
  // tails first (behind the body), each a swallow-tailed strip
  for (const side of [-1, 1]) {
    const inner = side < 0 ? x0 + tail * 0.25 : x1 - tail * 0.25;
    const outer = side < 0 ? x0 - tail : x1 + tail;
    const notch = side < 0 ? outer + tail * 0.32 : outer - tail * 0.32;
    polygon(ctx, [[inner, top + lowered], [outer, top + lowered], [notch, cy + lowered], [outer, bottom + lowered], [inner, bottom + lowered]]);
    const g = ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, '#d8c07a');
    g.addColorStop(1, '#b99a4c');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = h * 0.04;
    ctx.strokeStyle = rgba(INK, 0.8);
    ctx.lineJoin = 'round';
    ctx.stroke();
    // the fold: a dark triangle where the tail tucks behind the body
    const fx = side < 0 ? x0 + tail * 0.25 : x1 - tail * 0.25;
    polygon(ctx, [[fx, top + lowered], [fx + side * -tail * 0.25, top + lowered], [fx, top]]);
    ctx.fillStyle = shade('#b99a4c', -0.35);
    ctx.fill();
    ctx.stroke();
  }
  // the body
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = h * 0.22;
  ctx.shadowOffsetY = h * 0.1;
  ctx.beginPath();
  ctx.rect(x0, top, w, h);
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, '#fbf0c8');
  g.addColorStop(0.5, '#f1dc9a');
  g.addColorStop(1, '#e0c070');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = h * 0.045;
  ctx.strokeStyle = rgba(INK, 0.85);
  ctx.strokeRect(x0, top, w, h);
  ctx.lineWidth = h * 0.02;
  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.strokeRect(x0 + h * 0.09, top + h * 0.09, w - h * 0.18, h - h * 0.18);
}

// --- small stat icons (drawn, not images: they stay crisp at any size) -------------------------------------------

export function iconFlag(ctx, cx, cy, s, color) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = s * 0.1;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.26, cy + s * 0.5);
  ctx.lineTo(cx - s * 0.26, cy - s * 0.5);
  ctx.stroke();
  polygon(ctx, [[cx - s * 0.2, cy - s * 0.46], [cx + s * 0.5, cy - s * 0.22], [cx - s * 0.2, cy + s * 0.04]]);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = s * 0.06;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

export function iconSwords(ctx, cx, cy, s) {
  ctx.lineCap = 'round';
  for (const dir of [-1, 1]) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((dir * Math.PI) / 4);
    ctx.fillStyle = '#e4e6ea';
    ctx.strokeStyle = INK;
    ctx.lineWidth = s * 0.06;
    polygon(ctx, [[-s * 0.07, s * 0.2], [-s * 0.07, -s * 0.46], [0, -s * 0.58], [s * 0.07, -s * 0.46], [s * 0.07, s * 0.2]]);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = GOLD;
    ctx.fillRect(-s * 0.2, s * 0.2, s * 0.4, s * 0.09);
    ctx.strokeRect(-s * 0.2, s * 0.2, s * 0.4, s * 0.09);
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(-s * 0.05, s * 0.29, s * 0.1, s * 0.2);
    ctx.restore();
  }
}

export function iconHourglass(ctx, cx, cy, s) {
  ctx.lineJoin = 'round';
  ctx.fillStyle = '#6b4a2b';
  ctx.fillRect(cx - s * 0.32, cy - s * 0.52, s * 0.64, s * 0.1);
  ctx.fillRect(cx - s * 0.32, cy + s * 0.42, s * 0.64, s * 0.1);
  polygon(ctx, [[cx - s * 0.26, cy - s * 0.42], [cx + s * 0.26, cy - s * 0.42], [cx + s * 0.03, cy], [cx + s * 0.26, cy + s * 0.42], [cx - s * 0.26, cy + s * 0.42], [cx - s * 0.03, cy]]);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fill();
  ctx.lineWidth = s * 0.07;
  ctx.strokeStyle = INK;
  ctx.stroke();
  polygon(ctx, [[cx - s * 0.16, cy + s * 0.4], [cx + s * 0.16, cy + s * 0.4], [cx, cy + s * 0.14]]);
  ctx.fillStyle = GOLD;
  ctx.fill();
}

export function iconGeneric(ctx, cx, cy, s) {
  hexagon(ctx, cx, cy, s * 0.46);
  ctx.fillStyle = GOLD;
  ctx.fill();
  ctx.lineWidth = s * 0.07;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

export function drawStatIcon(ctx, key, cx, cy, s, color) {
  if (key === 'regions') iconFlag(ctx, cx, cy, s, color);
  else if (key === 'battlesWon') iconSwords(ctx, cx, cy, s);
  else if (key === 'crowns') drawCrownPips(ctx, cx, cy, 1, s * 1.1);
  else if (key === 'timePlayed') iconHourglass(ctx, cx, cy, s);
  else iconGeneric(ctx, cx, cy, s);
}

