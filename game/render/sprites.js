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
import { bake, blit, bannerStrip, blitStrip, quant, ctxScale } from './spriteCache.js';

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
  const footprint = type === 'gate' ? bs * 1.3 : type === 'keep' ? bs * 1.05 : type === 'fort' ? bs * 1.1 : bs * 0.85;

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
  harbour: { dx: 0.58, dy: -1.12 }, // the quay's crane mast (PLAN-PHASE12)
  bandit: { dx: 0.62, dy: -0.5 },
  gate: { dx: 0.7, dy: -1.5 },
  shrine: { dx: 0.62, dy: -1.0 },
  ancientTower: { dx: 0, dy: -2.0 },
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

// The Ashen Host (Phase 6): a skull under a five-pointed crown, the same silhouette as the `skullCrown` UI icon (the 24-grid mapped to -0.5..0.5).
const SK = (v) => (v - 12) / 21;
const SKY = (v) => (v - 12.2) / 21;
function emblemSkullCrown(ctx, color) {
  ctx.beginPath();
  // crown
  ctx.moveTo(SK(5.4), SKY(9.6)); ctx.lineTo(SK(4.6), SKY(3.4)); ctx.lineTo(SK(8.3), SKY(6.1)); ctx.lineTo(SK(12), SKY(2));
  ctx.lineTo(SK(15.7), SKY(6.1)); ctx.lineTo(SK(19.4), SKY(3.4)); ctx.lineTo(SK(18.6), SKY(9.6)); ctx.closePath();
  // skull: a round cranium over a squared jaw
  ctx.moveTo(SK(19.1), SKY(14.9));
  ctx.ellipse(0, SKY(14.9), 7.1 / 21, 6.5 / 21, 0, 0, Math.PI, true);
  ctx.lineTo(SK(4.9), SKY(15.4)); ctx.lineTo(SK(7.3), SKY(19.3)); ctx.lineTo(SK(7.3), SKY(22.4)); ctx.lineTo(SK(16.7), SKY(22.4));
  ctx.lineTo(SK(16.7), SKY(19.3)); ctx.lineTo(SK(19.1), SKY(15.4)); ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 0.1;
  ctx.strokeStyle = 'rgba(20,16,10,0.8)';
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
  // eye sockets and the nose: dark holes, so the skull reads at 10 px
  ctx.fillStyle = 'rgba(20,16,10,0.82)';
  ctx.beginPath();
  ctx.arc(SK(9.2), SKY(14.6), 2 / 21, 0, Math.PI * 2);
  ctx.moveTo(SK(14.8) + 2 / 21, SKY(14.6));
  ctx.arc(SK(14.8), SKY(14.6), 2 / 21, 0, Math.PI * 2);
  ctx.moveTo(0, SKY(16.6)); ctx.lineTo(SK(10.9), SKY(18.5)); ctx.lineTo(SK(13.1), SKY(18.5)); ctx.closePath();
  ctx.fill();
  // the crown's band
  ctx.fillRect(SK(5.4), SKY(8.4), 13.2 / 21, 1.3 / 21);
}

// The Sea Kings (Phase 12): a barbed trident, the same silhouette as the `trident` UI icon (the 24-grid mapped to about -0.5..0.5; the
// SVG path data is shared through Path2D). Built lazily: Path2D exists only in a browser.
const TRIDENT_D = 'M12 1.6l2.1 4.3h-1.15v5.5h-1.9V5.9H9.9Z M6.1 2.8l2 4H7v2.4H5.2V6.8H4.1Z M17.9 2.8l2 4h-1.1v2.4H17V6.8h-1.1Z '
  + 'M5.2 8.6v.9c0 2.4 1.8 3.9 4.2 3.9h5.2c2.4 0 4.2-1.5 4.2-3.9v-.9h-1.8v.9c0 1.2-.9 2-2.4 2H9.4c-1.5 0-2.4-.8-2.4-2v-.9Z '
  + 'M11.05 13h1.9v8.4h-1.9Z M12 20.4a1.1 1.1 0 1 0 0.01 0Z';
let tridentPath = null;
function emblemTrident(ctx, color) {
  if (!tridentPath) tridentPath = new Path2D(TRIDENT_D);
  ctx.save();
  ctx.scale(1 / 21, 1 / 21);
  ctx.translate(-12, -12.1);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = 'rgba(20,16,10,0.8)';
  ctx.stroke(tridentPath);
  ctx.fillStyle = color;
  ctx.fill(tridentPath);
  ctx.restore();
}

const EMBLEMS = { star: emblemStar, wheat: emblemWheat, sword: emblemSword, sun: emblemSun };
const CUSTOM_EMBLEMS = { eye: emblemEye, skullCrown: emblemSkullCrown, 'skull-crown': emblemSkullCrown, crownSkull: emblemSkullCrown, trident: emblemTrident };

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
  if (CUSTOM_EMBLEMS[emblem]) {
    CUSTOM_EMBLEMS[emblem](ctx, color);
  } else {
    const fn = EMBLEMS[emblem] || emblemStar;
    fn(ctx);
    finishEmblemPath(ctx, color, 0.09);
  }
  ctx.restore();
}

// ------------------------------------------------------------------- banner

// Phase 9 (§9C): the realm's banner style, purely visual. Only the PLAYER's flags change (their cloth keeps the faction colour, so a
// faction still reads at a glance): the hem, the finial and the emblem's tint. `bannerStyleVersion` rises on every change so the baked
// banner strips (render/sites.js, the squad strips here) are rebaked.
export const BANNER_STYLES = Object.freeze({
  plain: null,
  gilded: Object.freeze({ hem: '#f5c451', hem2: '#8a5a12', finial: '#ffd970', emblem: '#ffe9a8', fringe: null, glow: null }),
  ember: Object.freeze({ hem: '#ff7a2f', hem2: '#5e1406', finial: '#ff5a1f', emblem: '#ffd2a1', fringe: '#ff9a3d', glow: 'rgba(255,110,40,0.35)' }),
  frost: Object.freeze({ hem: '#d8f3ff', hem2: '#2d6f8f', finial: '#bfeaff', emblem: '#f1fbff', fringe: '#e9f9ff', glow: 'rgba(170,230,255,0.3)' }),
  ashenBone: Object.freeze({ hem: '#e6dcc4', hem2: '#2c2b33', finial: '#e6dcc4', emblem: '#f3ecdc', fringe: '#cfc4aa', glow: null }),
});
let bannerStyleId = 'plain';
let bannerStyleVer = 0;
/** Sets the realm's banner style (an id of BANNER_STYLES; anything else is plain). */
export function setBannerStyle(id) {
  const next = Object.prototype.hasOwnProperty.call(BANNER_STYLES, id) ? id : 'plain';
  if (next === bannerStyleId) return;
  bannerStyleId = next;
  bannerStyleVer += 1;
}
export function getBannerStyle() { return bannerStyleId; }
export function bannerStyleVersion() { return bannerStyleVer; }
function playerStyleOf(f) {
  return bannerStyleId !== 'plain' && f && f.color === FACTIONS[0].color ? BANNER_STYLES[bannerStyleId] : null;
}

/** The style's trim over a drawn cloth: a glow, a two-tone hem and (ember, frost, bone) a fringe of points along the bottom edge. */
function drawBannerTrim(ctx, st, top, bot, notchX, notchY, s) {
  const segs = top.length - 1;
  const outline = () => {
    ctx.beginPath();
    ctx.moveTo(top[0][0], top[0][1]);
    for (let i = 1; i <= segs; i++) ctx.lineTo(top[i][0], top[i][1]);
    ctx.lineTo(notchX, notchY);
    for (let i = segs; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
    ctx.closePath();
  };
  ctx.save();
  ctx.lineJoin = 'round';
  if (st.glow) { ctx.shadowColor = st.glow; ctx.shadowBlur = s * 0.35; }
  outline();
  ctx.strokeStyle = st.hem2;
  ctx.lineWidth = Math.max(1.2, s * 0.16);
  ctx.stroke();
  ctx.shadowBlur = 0;
  outline();
  ctx.strokeStyle = st.hem;
  ctx.lineWidth = Math.max(0.8, s * 0.085);
  ctx.stroke();
  if (st.fringe) {
    ctx.fillStyle = st.fringe;
    const n = 5;
    for (let i = 0; i < n; i++) {
      const a = bot[Math.min(segs, Math.floor((i / n) * segs * 0.86))];
      const b2 = bot[Math.min(segs, Math.floor(((i + 1) / n) * segs * 0.86))];
      const mx = (a[0] + b2[0]) / 2;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(mx, (a[1] + b2[1]) / 2 + s * 0.13);
      ctx.lineTo(b2[0], b2[1]);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

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
  const style = playerStyleOf(f);
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
  ctx.fillStyle = style ? style.finial : ACCENTS.gold;
  ctx.beginPath();
  ctx.arc(x, topY - s * 0.04, s * (style ? 0.1 : 0.06), 0, Math.PI * 2);
  ctx.fill();

  // a bigger cloth and emblem (colour-blind players tell factions apart by the emblem as much as by the colour: DESIGN 7.5a)
  const w = s * 1.3;
  const h = s * 0.74;
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
  if (style) drawBannerTrim(ctx, style, top, bot, notchX, notchY, s);

  const emx = x + w * 0.4;
  const midT = top[Math.round(segs * 0.4)][1];
  const midB = bot[Math.round(segs * 0.4)][1];
  const emy = (midT + midB) / 2;
  drawEmblem(ctx, f.emblem, emx, emy + s * 0.02, s * 0.66, 'rgba(24,16,8,0.6)'); // a dark under-stroke: the cream emblem must read on pale cloth too
  drawEmblem(ctx, f.emblem, emx, emy, s * 0.6, style ? style.emblem : ACCENTS.cream);
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

let measureCtx = null;
/** The width of a badge's numerals at `fontPx` (a scratch context; bakes need it before they draw). */
function measureBadgeText(label, fontPx) {
  if (!measureCtx) {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(4, 4) : (globalThis.document ? globalThis.document.createElement('canvas') : null);
    measureCtx = c ? c.getContext('2d') : null;
  }
  if (!measureCtx) return label.length * fontPx * 0.62;
  measureCtx.font = `800 ${fontPx}px Nunito, system-ui, sans-serif`;
  return measureCtx.measureText(label).width;
}

/**
 * Rounded troop-count pill, owner colour, bold white numerals with a dark
 * outline — legible over any terrain (DESIGN §7.2).
 * @param {{pulse?: boolean|number}} [opts]
 */
export function drawTroopBadge(ctx, x, y, count, faction, s, opts = {}) {
  const f = resolveFaction(faction);
  const label = typeof count === 'string' ? count : shortNum(count); // a string is drawn as is (Night's '?' for a hidden garrison)
  const h = Math.max(10, s * 0.62);
  const phase = typeof opts.pulse === 'number' ? opts.pulse : (opts.pulse ? now() / 1000 : null);
  const pulse = phase != null ? 1 + Math.sin(phase * 6) * 0.07 : 1;
  // Phase 8 perf: a still badge is the same drawing baked once per (label, colours, size) and blitted; a pulsing one is drawn live
  if (pulse === 1 && !opts.live) {
    const dpr = ctxScale(ctx);
    const want = h * dpr;
    const b = bake(`badge|${label}|${f.color}|${f.colorDark}`, quant(want), (q) => {
      const hc = q / dpr; // the badge height in CSS px the bake is drawn at
      const w = Math.max(hc * 1.2, measureBadgeText(label, Math.round(hc * 0.6)) + hc * 0.85);
      const W = (w * 1.2 + hc * 0.2 + 4) * dpr;
      return { w: W, h: (hc * 1.5 + 6) * dpr, ox: W / 2, oy: (hc * 0.6 + 3) * dpr };
    }, (bctx, ox, oy, q) => {
      bctx.scale(dpr, dpr);
      drawTroopBadge(bctx, ox / dpr, oy / dpr, label, f, q / dpr / 0.62, { live: true });
    });
    if (b) { blit(ctx, b, x, y, dpr, want); return; }
  }

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
  // Phase 8 perf: the banner's flutter and the soldier figure are baked (render/spriteCache.js) and blitted; `opts.live` draws them as before
  const dpr = opts.live ? 1 : ctxScale(ctx);
  const fkey = `${f.color}|${f.colorDark}|${f.emblem}`;
  const strip = opts.live || typeof opts.phase !== 'number' || typeof t !== 'number' ? null
    : bannerStrip(`squad|${fkey}|${playerStyleOf(f) ? bannerStyleId : ''}`, quant(s * 0.5 * dpr), (bctx, ox, oy, sb, tt) => drawBanner(bctx, ox, oy, sb, f, tt, { phase: 0 }));
  if (strip) blitStrip(ctx, strip, bannerX, bannerY, dpr, s * 0.5 * dpr, t, opts.phase);
  else drawBanner(ctx, bannerX, bannerY, s * 0.5, f, t, { phase: opts.phase });
  const fig = opts.live ? null : bake(`soldier|${fkey}`, quant(s * dpr), (q) => ({ w: q * 0.4 + 4, h: q * 0.46 + 4, ox: q * 0.2 + 2, oy: q * 0.21 + 2 }), (bctx, ox, oy, q) => {
    groundShadow(bctx, ox, oy + q * 0.14, q * 0.17, q * 0.08, 0.28);
    bctx.fillStyle = f.colorDark;
    bctx.beginPath();
    bctx.arc(ox, oy + q * 0.03, q * 0.15, 0, Math.PI * 2);
    bctx.fill();
    bctx.fillStyle = f.color;
    bctx.beginPath();
    bctx.arc(ox, oy - q * 0.07, q * 0.12, 0, Math.PI * 2);
    bctx.fill();
  });

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
    if (fig) { blit(ctx, fig, bx, by, dpr, s * dpr); continue; }
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
 *
 * SHAPE as well as colour (DESIGN 7.5a): `opts.shape` is 'solid' (a capture, a reinforcement), 'dashed' (not enough) or 'dotted' (no route); `opts.mark` puts a check or a cross
 * in the head; `opts.word` writes the outcome beside the head. Red and green are never the only difference between a good send and a bad one.
 * @param {{ zoom?: number, shape?: 'solid'|'dashed'|'dotted', mark?: 'check'|'cross'|null, word?: string|null, viewW?: number }} [opts]
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
  const shape = opts.shape || 'solid';
  // the pattern of the shaft: whole (a capture), long dashes (not enough), round dots (no route)
  const pattern = shape === 'dashed' ? [core * 2.6, core * 1.7] : shape === 'dotted' ? [0.01, core * 2.1] : null;
  ctx.save();
  ctx.lineCap = shape === 'dashed' ? 'butt' : 'round';
  ctx.lineJoin = 'round';
  const shaft = () => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(bx, by); };
  // dark casing with a soft shadow: readable on grass, forest, snow and sand alike (a patterned shaft keeps its gaps: the casing is not a solid line behind it)
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 7;
  ctx.strokeStyle = 'rgba(6, 10, 18, 0.82)';
  ctx.lineWidth = core + 3.8;
  if (pattern) ctx.setLineDash(shape === 'dashed' ? [core * 2.6 + 3, core * 1.7 - 3] : [0.01, core * 2.1]);
  shaft();
  ctx.stroke();
  ctx.shadowBlur = 0;
  // the colour itself: saturated, solid or patterned
  ctx.strokeStyle = color;
  ctx.lineWidth = shape === 'dotted' ? core * 1.15 : core;
  if (pattern) ctx.setLineDash(pattern);
  shaft();
  ctx.stroke();
  ctx.setLineDash([]);
  if (!pattern) {
    // light dashes flowing toward the target
    ctx.setLineDash([core * 1.5, core * 3.3]);
    ctx.lineDashOffset = -((t || 0) * 64) % (core * 4.8);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.lineWidth = core * 0.4;
    shaft();
    ctx.stroke();
    ctx.setLineDash([]);
  }
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
  // the mark in the head: a check for a capture, a cross for not enough (white on a dark outline, so it reads on green, red and grey alike)
  if (opts.mark) {
    const mx = x2 - cos * headLen * 0.5;
    const my = y2 - sin * headLen * 0.5;
    const r = Math.max(3.4, headLen * 0.2);
    const glyph = () => {
      ctx.beginPath();
      if (opts.mark === 'check') {
        ctx.moveTo(mx - r * 0.95, my + r * 0.05);
        ctx.lineTo(mx - r * 0.3, my + r * 0.7);
        ctx.lineTo(mx + r * 1.0, my - r * 0.75);
      } else {
        ctx.moveTo(mx - r * 0.8, my - r * 0.8);
        ctx.lineTo(mx + r * 0.8, my + r * 0.8);
        ctx.moveTo(mx + r * 0.8, my - r * 0.8);
        ctx.lineTo(mx - r * 0.8, my + r * 0.8);
      }
    };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(6, 10, 18, 0.9)';
    ctx.lineWidth = Math.max(3.2, r * 0.9);
    glyph();
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1.8, r * 0.5);
    glyph();
    ctx.stroke();
  }
  // the outcome in a word, beside the head and above it (a finger on a phone covers what is below): the words the tooltip says, where the eye already is
  if (opts.word) {
    ctx.font = '800 12px Nunito, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(opts.word).width + 14;
    let px = x2 - cos * headLen * 0.3;
    let py = Math.min(y2, y2 - sin * headLen * 0.3) - headLen * 0.75 - 14;
    px = Math.max(w / 2 + 4, Math.min((opts.viewW || 4096) - w / 2 - 4, px));
    py = Math.max(14, py);
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = 'rgba(8, 12, 20, 0.88)';
    ctx.beginPath();
    ctx.roundRect(px - w / 2, py - 10, w, 20, 10);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(opts.word, px, py + 0.5);
  }
  ctx.restore();
}
