// Pure sprite drawing (DESIGN §7.2): settlements, banners, emblems, troop
// badges and squads. Screen-space pixels, no caching, no state — callers are
// responsible for positioning, animation time and any offscreen caching
// (ARCHITECTURE §7 caches sprites per type/owner/zoom bucket).
//
// Split into helper files to stay under ARCHITECTURE's ~500-line guideline;
// every export below is still the complete, stable public API of
// `sprites.js` (`sprites-buildings.js` is an internal implementation detail).

import {
  ACCENTS, FACTIONS, roofColor as roofColorFor, factionColorDark, shade, rgba,
} from './palette.js';
import { buildSettlement } from './sprites-buildings.js';

function resolveFaction(f) {
  if (f == null) {
    return { color: ACCENTS.muted, colorDark: shade(ACCENTS.muted, -0.32), colorLight: shade(ACCENTS.muted, 0.32), emblem: 'star', personality: 'neutral' };
  }
  if (typeof f === 'number') return FACTIONS[f] || resolveFaction(null);
  if (!f.colorDark) return { ...f, colorDark: factionColorDark(f) };
  return f;
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

// ------------------------------------------------------------------ helpers

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function groundShadow(ctx, x, y, rx, ry, alpha) {
  if (rx <= 0 || ry <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(5,8,6,${alpha})`);
  g.addColorStop(1, 'rgba(5,8,6,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

const WALL_COLOR = '#ece0c4';

// -------------------------------------------------------------- settlements

// Settlements were reading small inside their hex, especially at battle
// zoom (DESIGN feedback) — inflate the whole building geometry by scaling
// the `s` handed to the builders, so every internal `s * fraction` grows
// with it "for free" and BANNER_ANCHOR just needs the same multiplier.
const SETTLEMENT_SCALE = 1.2;

/**
 * A settlement building (DESIGN §7.2). `cx, cy` is the tile's ground point;
 * the sprite is drawn standing on it. Readable from s=14 up to s=60.
 * @param {CanvasRenderingContext2D} ctx
 * @param {'hamlet'|'village'|'town'|'fort'|'tower'|'keep'|'camp'} type
 * @param {number} cx
 * @param {number} cy
 * @param {number} s
 * @param {number|object} faction
 * @param {{highlight?:boolean, selected?:boolean, dim?:boolean}} [opts]
 */
export function drawSettlement(ctx, type, cx, cy, s, faction, opts = {}) {
  const f = resolveFaction(faction);
  const bs = s * SETTLEMENT_SCALE;
  const baseY = cy + bs * 0.16;
  const footprint = type === 'keep' ? bs * 1.05 : type === 'fort' ? bs * 1.1 : bs * 0.85;

  ctx.save();
  if (opts.dim) ctx.globalAlpha *= 0.42;

  if (opts.highlight) {
    const g = ctx.createRadialGradient(cx, baseY - bs * 0.3, 0, cx, baseY - bs * 0.3, footprint * 1.5);
    g.addColorStop(0, rgba(ACCENTS.gold, 0.32));
    g.addColorStop(1, rgba(ACCENTS.gold, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, baseY - bs * 0.3, footprint * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  groundShadow(ctx, cx, baseY + bs * 0.06, footprint, footprint * 0.4, 0.3);

  const wall = WALL_COLOR;
  const roof = roofColorFor(f);
  buildSettlement(type, ctx, cx, baseY, bs, wall, roof, f);

  if (opts.selected) {
    ctx.save();
    ctx.strokeStyle = rgba(ACCENTS.gold, 0.9);
    ctx.lineWidth = Math.max(1.5, bs * 0.06);
    ctx.setLineDash([bs * 0.14, bs * 0.1]);
    ctx.beginPath();
    ctx.ellipse(cx, baseY + bs * 0.06, footprint * 1.15, footprint * 0.48, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

/**
 * Recommended banner-mount anchor (dx, dy in units of `s`, relative to the
 * same cx, cy passed to `drawSettlement`) for each settlement type. Already
 * scaled by the same factor as the building geometry.
 */
export const BANNER_ANCHOR = Object.freeze({
  hamlet: { dx: 0.36, dy: -0.43 },
  village: { dx: 0.19, dy: -0.5 },
  town: { dx: 0.17, dy: -1.18 },
  fort: { dx: 0.9, dy: -1.08 },
  tower: { dx: 0, dy: -1.8 },
  keep: { dx: 0.72, dy: -1.32 },
  camp: { dx: 0, dy: -0.66 },
});

// ------------------------------------------------------------------ emblems

// Some emblems (wheat, sun) are partly open line strokes rather than closed
// silhouettes, so `fill()` alone would leave them nearly invisible. Draw a
// dark contact halo (for legibility on any banner colour), then fill closed
// regions AND stroke the same path in `color` so line-based glyph parts show.
function finishEmblemPath(ctx, color, lw) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // A firm dark outline: cream wheat on the Free Folk's stone-grey disc must still read.
  ctx.lineWidth = lw * 2.4;
  ctx.strokeStyle = 'rgba(20,16,10,0.8)';
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function emblemStar(ctx) {
  const R = 0.46, r = 0.19;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? R : r;
    const px = Math.cos(ang) * rad;
    const py = Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function emblemWheat(ctx) {
  // A bound stem with rows of plump grain husks fanning out near the top —
  // the earlier ladder-of-ticks read as a ribcage rather than wheat.
  ctx.beginPath();
  ctx.moveTo(0, 0.46);
  ctx.lineTo(0, -0.38);
  const rows = 3;
  for (let k = 0; k < rows; k++) {
    const y = -0.36 + k * 0.15;
    const spread = 0.32 - k * 0.06;
    for (const side of [-1, 1]) {
      ctx.moveTo(0, y);
      ctx.lineTo(side * spread, y + 0.16);
    }
  }
  for (let k = 0; k < rows; k++) {
    const y = -0.36 + k * 0.15;
    const spread = 0.32 - k * 0.06;
    for (const side of [-1, 1]) {
      const gx = side * spread;
      const gy = y + 0.16;
      ctx.moveTo(gx + 0.1, gy);
      ctx.ellipse(gx, gy, 0.1, 0.15, side * 0.55, 0, Math.PI * 2);
    }
  }
}

function emblemSword(ctx) {
  ctx.beginPath();
  ctx.moveTo(0, -0.48);
  ctx.lineTo(0.09, -0.05);
  ctx.lineTo(0.04, 0.06);
  ctx.lineTo(-0.04, 0.06);
  ctx.lineTo(-0.09, -0.05);
  ctx.closePath();
  ctx.moveTo(-0.24, 0.02);
  ctx.lineTo(0.24, 0.02);
  ctx.lineTo(0.24, 0.11);
  ctx.lineTo(-0.24, 0.11);
  ctx.closePath();
  ctx.moveTo(-0.05, 0.11);
  ctx.lineTo(0.05, 0.11);
  ctx.lineTo(0.05, 0.4);
  ctx.lineTo(0, 0.46);
  ctx.lineTo(-0.05, 0.4);
  ctx.closePath();
}

function emblemEye(ctx, color) {
  ctx.beginPath();
  ctx.moveTo(-0.46, 0);
  ctx.quadraticCurveTo(0, -0.34, 0.46, 0);
  ctx.quadraticCurveTo(0, 0.34, -0.46, 0);
  ctx.closePath();
  ctx.lineWidth = 0.15;
  ctx.strokeStyle = 'rgba(20,16,10,0.8)';
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.lineWidth = 0.06;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 0.13, 0, Math.PI * 2);
  ctx.fill();
}

function emblemSun(ctx) {
  ctx.beginPath();
  ctx.arc(0, 0, 0.25, 0, Math.PI * 2);
  for (let k = 0; k < 8; k++) {
    const ang = (k / 8) * Math.PI * 2;
    ctx.moveTo(Math.cos(ang) * 0.32, Math.sin(ang) * 0.32);
    ctx.lineTo(Math.cos(ang) * 0.48, Math.sin(ang) * 0.48);
  }
}

const EMBLEMS = { star: emblemStar, wheat: emblemWheat, sword: emblemSword, sun: emblemSun };

/**
 * A single-colour, colour-blind-safe emblem glyph, centred at (x, y).
 * @param {CanvasRenderingContext2D} ctx
 * @param {'star'|'wheat'|'sword'|'eye'|'sun'} emblem
 * @param {number} x
 * @param {number} y
 * @param {number} size overall bounding size
 * @param {string} color
 */
export function drawEmblem(ctx, emblem, x, y, size, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, size);
  ctx.lineJoin = 'round';
  if (emblem === 'eye') {
    emblemEye(ctx, color);
  } else {
    const fn = EMBLEMS[emblem] || emblemStar;
    fn(ctx);
    finishEmblemPath(ctx, color, 0.09);
  }
  ctx.restore();
}

// ------------------------------------------------------------------- banner

/**
 * A waving banner on a pole, planted with its base at (x, y), with the
 * faction emblem stamped on the cloth. `t` is seconds (or any monotonic
 * clock) driving the flutter.
 * @param {{phase?: number}} [opts] `phase` (radians) is this banner's own flutter offset. Pass a
 *   STABLE per-banner value (site id, tile index...): without it the phase is derived from the
 *   banner's on-screen position, which makes flags shimmer while the camera pans.
 */
export function drawBanner(ctx, x, y, s, faction, t, opts = {}) {
  const f = resolveFaction(faction);
  const time = typeof t === 'number' ? t : now() / 1000;
  const poleH = s * 1.7;
  const topY = y - poleH;

  ctx.strokeStyle = '#5a4632';
  ctx.lineWidth = Math.max(1, s * 0.07);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, topY);
  ctx.stroke();
  ctx.fillStyle = ACCENTS.gold;
  ctx.beginPath();
  ctx.arc(x, topY - s * 0.04, s * 0.06, 0, Math.PI * 2);
  ctx.fill();

  const w = s * 1.15;
  const h = s * 0.6;
  const segs = 6;
  const amp = s * 0.14;
  const speed = 2.1;
  const flagTop = topY + s * 0.08;
  // Offset the phase by this banner's own position so a row of banners
  // doesn't flap in perfect, slightly robotic unison.
  const desync = typeof opts.phase === 'number' ? opts.phase : (x * 0.37 + y * 0.19) % (Math.PI * 2);
  const top = [];
  const bot = [];
  for (let i = 0; i <= segs; i++) {
    const fx = i / segs;
    const wave = Math.sin(time * speed + desync - fx * 3.2) * amp * fx;
    const px = x + fx * w;
    top.push([px, flagTop + wave]);
    bot.push([px, flagTop + h + wave]);
  }
  const notchX = x + w * 0.86;
  const notchY = (top[segs][1] + bot[segs][1]) / 2;

  ctx.fillStyle = f.color;
  ctx.beginPath();
  ctx.moveTo(top[0][0], top[0][1]);
  for (let i = 1; i <= segs; i++) ctx.lineTo(top[i][0], top[i][1]);
  ctx.lineTo(notchX, notchY);
  for (let i = segs; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  ctx.beginPath();
  ctx.moveTo(x, (top[0][1] + bot[0][1]) / 2);
  for (let i = 0; i <= segs; i++) ctx.lineTo(top[i][0], (top[i][1] + bot[i][1]) / 2);
  ctx.lineTo(notchX, notchY);
  for (let i = segs; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
  ctx.closePath();
  ctx.fill();

  const emx = x + w * 0.4;
  const midT = top[Math.round(segs * 0.4)][1];
  const midB = bot[Math.round(segs * 0.4)][1];
  drawEmblem(ctx, f.emblem, emx, (midT + midB) / 2, s * 0.42, ACCENTS.cream);
}

// -------------------------------------------------------------- troop badge

function shortNum(n) {
  const v = Math.round(n);
  const sign = v < 0 ? '-' : '';
  let x = Math.abs(v);
  if (x < 1000) return sign + String(x);
  const units = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp'];
  let u = -1;
  while (x >= 1000 && u < units.length - 1) { x /= 1000; u++; }
  const digits = x < 10 ? 2 : x < 100 ? 1 : 0;
  return `${sign}${x.toFixed(digits)}${units[u]}`;
}

/**
 * Rounded troop-count pill, owner colour, bold white numerals with a dark
 * outline — legible over any terrain (DESIGN §7.2).
 * @param {{pulse?: boolean|number}} [opts]
 */
export function drawTroopBadge(ctx, x, y, count, faction, s, opts = {}) {
  const f = resolveFaction(faction);
  const label = shortNum(count);
  const h = Math.max(10, s * 0.62);
  const phase = typeof opts.pulse === 'number' ? opts.pulse : (opts.pulse ? now() / 1000 : null);
  const pulse = phase != null ? 1 + Math.sin(phase * 6) * 0.07 : 1;

  ctx.save();
  ctx.font = `800 ${Math.round(h * 0.6)}px Nunito, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const textW = ctx.measureText(label).width;
  const w = Math.max(h * 1.2, textW + h * 0.85) * pulse;
  const hh = h * pulse;

  groundShadow(ctx, x, y + hh * 0.55, w * 0.55, hh * 0.32, 0.3);

  roundRect(ctx, x - w / 2, y - hh / 2, w, hh, hh / 2);
  ctx.fillStyle = f.color;
  ctx.fill();
  ctx.lineWidth = Math.max(1, hh * 0.09);
  ctx.strokeStyle = f.colorDark;
  ctx.stroke();

  ctx.lineWidth = Math.max(2, hh * 0.17);
  ctx.strokeStyle = 'rgba(12,10,16,0.8)';
  ctx.lineJoin = 'round';
  ctx.strokeText(label, x, y + hh * 0.02);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, x, y + hh * 0.02);
  ctx.restore();
}

// ------------------------------------------------------------------- squads

/**
 * A tight cluster of soldier dots (up to 12 drawn) with a leading banner and
 * a count pill, facing (dirX, dirY). `t` drives the gentle marching bob.
 * @param {{phase?: number}} [opts] stable per-squad banner flutter phase (see drawBanner)
 */
export function drawSquad(ctx, x, y, count, faction, s, t, dirX, dirY, opts = {}) {
  const f = resolveFaction(faction);
  let dx = dirX || 0;
  let dy = dirY || 0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-4) { dx = 0; dy = -1; } else { dx /= len; dy /= len; }
  const rx = -dy;
  const ry = dx;
  const n = Math.max(1, Math.min(12, Math.round(count)));

  const bannerX = x + dx * s * 1.05;
  const bannerY = y + dy * s * 1.05;
  drawBanner(ctx, bannerX, bannerY, s * 0.5, f, t, { phase: opts.phase });

  const slots = [];
  let row = 0;
  while (slots.length < n) {
    const capacity = row === 0 ? 1 : Math.min(row * 2 + 1, 5);
    const take = Math.min(capacity, n - slots.length);
    for (let k = 0; k < take; k++) slots.push({ row, side: k - (take - 1) / 2 });
    row++;
  }
  const spacing = s * 0.42;
  for (let idx = 0; idx < slots.length; idx++) {
    const p = slots[idx];
    const bob = Math.sin((t || 0) * 3.4 + idx * 0.9) * s * 0.045;
    const bx = x - dx * p.row * spacing + rx * p.side * spacing;
    const by = y - dy * p.row * spacing + ry * p.side * spacing + bob;
    groundShadow(ctx, bx, by + s * 0.14, s * 0.17, s * 0.08, 0.28);
    ctx.fillStyle = f.colorDark;
    ctx.beginPath();
    ctx.arc(bx, by + s * 0.03, s * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.arc(bx, by - s * 0.07, s * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }

  drawTroopBadge(ctx, x, y + s * 0.7, count, f, s * 0.9);
}

// ---------------------------------------------------------- selection / fx

/** A soft glow ring plus a crisp ring, optionally pulsing if `t` is given. */
export function drawSelectionRing(ctx, cx, cy, r, color, t) {
  const pulse = typeof t === 'number' ? 1 + Math.sin(t * 3) * 0.05 : 1;
  ctx.save();
  ctx.strokeStyle = rgba(color, 0.28);
  ctx.lineWidth = Math.max(3, r * 0.24);
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * pulse, r * pulse * 0.55, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = rgba(color, 0.95);
  ctx.lineWidth = Math.max(1.5, r * 0.08);
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * pulse, r * pulse * 0.55, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Dashed range circle (tower range, power radius, etc). */
export function drawRangeCircle(ctx, cx, cy, r, color, alpha = 0.16) {
  ctx.save();
  ctx.fillStyle = rgba(color, alpha * 0.5);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgba(color, Math.min(1, alpha * 3.2));
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * The drag-to-send arrow (DESIGN §4.3): the thing the tutorial says "tells you if you'll take it", so it has to be unmissable on any
 * terrain. A solid `color` shaft about 4.6 px wide at the usual battle zoom (it scales gently with `opts.zoom`, 3.6 to 6.2 px) inside a dark
 * casing with a soft shadow, light dashes flowing along it toward the target (the animation), and a big outlined head at the target.
 * `opts.zoom` is the camera's px per world unit (default: the usual desktop battle zoom).
 * @param {{ zoom?: number }} [opts]
 */
export function drawDragArrow(ctx, x1, y1, x2, y2, color, t, opts = {}) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 2) return;
  const ang = Math.atan2(dy, dx);
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  const core = Math.max(3.6, Math.min(6.2, 4.6 * Math.pow((opts.zoom || 46) / 46, 0.3)));
  const headLen = Math.min(core * 4.9, len * 0.7);
  const bx = x2 - cos * headLen * 0.7; // the shaft ends inside the head
  const by = y2 - sin * headLen * 0.7;
  const half = 0.5;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const shaft = () => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(bx, by); };
  // dark casing with a soft shadow: readable on grass, forest, snow and sand alike
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 7;
  ctx.strokeStyle = 'rgba(6, 10, 18, 0.82)';
  ctx.lineWidth = core + 3.8;
  shaft();
  ctx.stroke();
  ctx.shadowBlur = 0;
  // the colour itself: solid, saturated
  ctx.strokeStyle = color;
  ctx.lineWidth = core;
  shaft();
  ctx.stroke();
  // light dashes flowing toward the target
  ctx.setLineDash([core * 1.5, core * 3.3]);
  ctx.lineDashOffset = -((t || 0) * 64) % (core * 4.8);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
  ctx.lineWidth = core * 0.4;
  shaft();
  ctx.stroke();
  ctx.setLineDash([]);
  // the head: dark outline, then the colour
  const head = () => {
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(ang - half), y2 - headLen * Math.sin(ang - half));
    ctx.lineTo(x2 - headLen * 0.62 * cos, y2 - headLen * 0.62 * sin);
    ctx.lineTo(x2 - headLen * Math.cos(ang + half), y2 - headLen * Math.sin(ang + half));
    ctx.closePath();
  };
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 7;
  ctx.strokeStyle = 'rgba(6, 10, 18, 0.88)';
  ctx.lineWidth = 3.6;
  head();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  head();
  ctx.fill();
  ctx.restore();
}
