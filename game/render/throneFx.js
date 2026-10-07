// The Throne of Ages on the battlefield (PLAN-PHASE13 §13A): pure drawing in screen px. The controller (scenes/battleThrone.js) owns the
// timing and positions; the Rising and the Tide reuse render/ashenFx.js and render/seaFx.js.
//
//   drawChampionBanners(ctx, x, y, s, list, t, still)   three tall Champion banners on the Gate, one per Champion (lowered when it falls)
//   drawPlagueRing(ctx, x, y, r, k, t, still)           the borrowed Plague's telegraph round one of your sites (k 0..1 progress)
//   drawPlagueAura(ctx, x, y, r, k, t, still)           ... and the weakness while it lasts (k 1..0 time left)
//   drawUsurper(ctx, x, y, s, o)                        the Usurper-King on the field: a crowned giant in wine and gold
//   drawUsurperHp(ctx, x, y, s, frac)                   his health bar (wine, gilt rim, a crown at the left end)
//   THRONE_FX                                           the colours
import { rgba } from './palette.js';
import { drawEmblem } from './sprites.js';

const TAU = Math.PI * 2;
export const THRONE_FX = Object.freeze({
  wine: '#650824',     // FACTIONS[7].color
  wineDark: '#33020f',
  gold: '#e9c46a',
  goldBright: '#ffe08a',
  plague: '#b9d24a',   // the borrowed Plague's sickly yellow-green (the map's plague wash)
  plagueDark: '#3d4a12',
});

/**
 * Three Champion banners stuck in the ground beside the Gate. `list`: [{ color, emblem, down }]; a fallen Champion's banner leans over, torn
 * and greyed. (x, y) is the Gate's foot; `s` the hex size in px.
 */
export function drawChampionBanners(ctx, x, y, s, list, t, still) {
  const n = list.length;
  const span = s * 1.5;
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const b = list[i];
    const bx = x + (n === 1 ? 0 : (i / (n - 1) - 0.5) * span);
    const by = y - s * 0.05 + (i === 1 ? -s * 0.12 : 0);
    const h = s * (i === 1 ? 1.25 : 1.1);
    const lean = b.down ? (i < n / 2 ? -0.55 : 0.55) : 0;
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(lean);
    if (b.down) ctx.globalAlpha = 0.55; // a fallen Champion's banner: lowered, torn, faded
    // the pole
    ctx.strokeStyle = 'rgba(18, 12, 8, 0.9)';
    ctx.lineWidth = Math.max(2.4, s * 0.07);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -h); ctx.stroke();
    ctx.strokeStyle = b.down ? '#8b8478' : '#d9b45a';
    ctx.lineWidth = Math.max(1.4, s * 0.04);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -h); ctx.stroke();
    // the cloth: a swallow-tailed banner that ripples
    const w = s * 0.46;
    const ch = s * 0.62;
    const wave = still || b.down ? 0 : Math.sin(t * 3 + i * 1.7) * s * 0.035;
    const top = -h + s * 0.04;
    ctx.beginPath();
    ctx.moveTo(0, top);
    ctx.lineTo(w, top + wave);
    ctx.lineTo(w + wave * 0.5, top + ch);
    ctx.lineTo(w * 0.5, top + ch * (b.down ? 0.62 : 0.78) + wave);
    ctx.lineTo(0, top + ch);
    ctx.closePath();
    ctx.fillStyle = b.down ? '#5d5850' : b.color;
    ctx.strokeStyle = 'rgba(18, 12, 8, 0.85)';
    ctx.lineWidth = Math.max(1.2, s * 0.03);
    ctx.fill(); ctx.stroke();
    if (!b.down) drawEmblem(ctx, b.emblem, w * 0.48, top + ch * 0.4, s * 0.3, '#f3ead7');
    else { // torn: a dark slash
      ctx.strokeStyle = 'rgba(18, 12, 8, 0.7)';
      ctx.beginPath(); ctx.moveTo(w * 0.15, top + ch * 0.25); ctx.lineTo(w * 0.8, top + ch * 0.6); ctx.stroke();
    }
    // the finial
    ctx.fillStyle = b.down ? '#8b8478' : '#ffe08a';
    ctx.beginPath(); ctx.arc(0, -h, Math.max(2, s * 0.06), 0, TAU); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/** The Plague's warning round a site: a sickly ring closing in with a countdown arc. */
export function drawPlagueRing(ctx, x, y, r, k, t, still) {
  ctx.save();
  const ry = 0.86;
  const inner = r * (1 - 0.8 * k);
  ctx.fillStyle = rgba(THRONE_FX.plague, 0.1 + 0.25 * k);
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * ry, 0, 0, TAU);
  ctx.ellipse(x, y, inner, inner * ry, 0, 0, TAU, true);
  ctx.fill('evenodd');
  ctx.lineWidth = Math.max(3, r * 0.06);
  ctx.strokeStyle = rgba(THRONE_FX.plagueDark, 0.75);
  ctx.beginPath(); ctx.ellipse(x, y, r, r * ry, 0, 0, TAU); ctx.stroke();
  ctx.setLineDash([r * 0.14, r * 0.1]);
  ctx.lineDashOffset = still ? 0 : -t * r * 0.4;
  ctx.lineWidth = Math.max(1.6, r * 0.035);
  ctx.strokeStyle = rgba(THRONE_FX.plague, 0.95);
  ctx.beginPath(); ctx.ellipse(x, y, r, r * ry, 0, 0, TAU); ctx.stroke();
  ctx.setLineDash([]);
  // the countdown arc
  ctx.lineWidth = Math.max(3, r * 0.08);
  ctx.strokeStyle = rgba('#f4ffb0', 0.95);
  ctx.beginPath(); ctx.ellipse(x, y, r * 1.08, r * ry * 1.08, 0, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
  ctx.restore();
}

/** The weakness itself: a pulsing sickly wash with hatching over the site; `k` 1..0 the time left. */
export function drawPlagueAura(ctx, x, y, r, k, t, still) {
  if (k <= 0) return;
  ctx.save();
  const ry = 0.86;
  const a = 0.22 + (still ? 0.06 : 0.08 * Math.sin(t * 4));
  ctx.fillStyle = rgba(THRONE_FX.plague, a * Math.min(1, k * 3));
  ctx.beginPath(); ctx.ellipse(x, y, r, r * ry, 0, 0, TAU); ctx.fill();
  ctx.clip();
  ctx.strokeStyle = rgba(THRONE_FX.plagueDark, 0.35 * Math.min(1, k * 3));
  ctx.lineWidth = Math.max(1, r * 0.03);
  const step = Math.max(5, r * 0.18);
  ctx.beginPath();
  for (let d = -r * 2; d < r * 2; d += step) { ctx.moveTo(x + d, y - r); ctx.lineTo(x + d + r * 1.2, y + r); }
  ctx.stroke();
  ctx.restore();
  // the time left: a thin arc
  ctx.save();
  ctx.lineWidth = Math.max(2, r * 0.05);
  ctx.strokeStyle = rgba(THRONE_FX.plague, 0.9);
  ctx.beginPath(); ctx.ellipse(x, y, r * 1.04, r * ry * 1.04, 0, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
  ctx.restore();
}

/**
 * The Usurper-King: a crowned giant in a wine cloak, sword raised, standing at (x, y) (his feet). `s` the hex size in px.
 * o: { facing (1 | -1), flash (0..1 hit flash), dead (0..1 his fall), t, still, step (0..1 walk phase) }
 */
export function drawUsurper(ctx, x, y, s, o = {}) {
  const f = o.facing === -1 ? -1 : 1;
  const dead = Math.max(0, Math.min(1, o.dead || 0));
  const u = s * 0.62; // body unit
  ctx.save();
  // the ground shadow
  ctx.fillStyle = `rgba(0, 0, 0, ${0.32 * (1 - dead * 0.5)})`;
  ctx.beginPath(); ctx.ellipse(x, y, u * 0.9, u * 0.26, 0, 0, TAU); ctx.fill();
  ctx.translate(x, y);
  if (dead) { ctx.rotate(f * dead * 1.35); ctx.globalAlpha = 1 - dead * 0.35; }
  ctx.scale(f, 1);
  const bob = o.still ? 0 : Math.sin((o.step || 0) * TAU) * u * 0.04;
  ctx.translate(0, bob);
  const ink = 'rgba(16, 8, 10, 0.9)';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.4, u * 0.06);
  ctx.strokeStyle = ink;
  // the cloak: a broad wine trapezoid with a gilt hem
  ctx.beginPath();
  ctx.moveTo(-u * 0.42, -u * 1.55); ctx.lineTo(u * 0.36, -u * 1.55);
  ctx.lineTo(u * 0.62, -u * 0.05); ctx.lineTo(-u * 0.72, -u * 0.05); ctx.closePath();
  ctx.fillStyle = THRONE_FX.wine; ctx.fill(); ctx.stroke();
  ctx.strokeStyle = THRONE_FX.gold; ctx.lineWidth = Math.max(1, u * 0.05);
  ctx.beginPath(); ctx.moveTo(-u * 0.68, -u * 0.14); ctx.lineTo(u * 0.58, -u * 0.14); ctx.stroke();
  // the breastplate
  ctx.strokeStyle = ink; ctx.lineWidth = Math.max(1.4, u * 0.06);
  ctx.beginPath(); ctx.roundRect(-u * 0.26, -u * 1.5, u * 0.52, u * 0.72, u * 0.12);
  ctx.fillStyle = '#b8b1a6'; ctx.fill(); ctx.stroke();
  ctx.fillStyle = THRONE_FX.wineDark;
  ctx.fillRect(-u * 0.26, -u * 0.98, u * 0.52, u * 0.1);
  // the head
  ctx.beginPath(); ctx.arc(0, -u * 1.78, u * 0.24, 0, TAU);
  ctx.fillStyle = '#e8c9a8'; ctx.fill(); ctx.stroke();
  // the crown
  ctx.beginPath();
  ctx.moveTo(-u * 0.26, -u * 1.9); ctx.lineTo(-u * 0.3, -u * 2.22); ctx.lineTo(-u * 0.12, -u * 2.06); ctx.lineTo(0, -u * 2.3);
  ctx.lineTo(u * 0.12, -u * 2.06); ctx.lineTo(u * 0.3, -u * 2.22); ctx.lineTo(u * 0.26, -u * 1.9); ctx.closePath();
  ctx.fillStyle = THRONE_FX.goldBright; ctx.fill(); ctx.stroke();
  // the sword, raised forward
  ctx.save();
  ctx.translate(u * 0.32, -u * 1.25);
  ctx.rotate(-0.55 + (o.still ? 0 : Math.sin((o.t || 0) * 2.2) * 0.08));
  ctx.fillStyle = '#e9edf2';
  ctx.beginPath(); ctx.moveTo(-u * 0.05, 0); ctx.lineTo(u * 0.05, 0); ctx.lineTo(u * 0.035, -u * 1.15); ctx.lineTo(0, -u * 1.3); ctx.lineTo(-u * 0.035, -u * 1.15); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = THRONE_FX.gold;
  ctx.fillRect(-u * 0.18, -u * 0.02, u * 0.36, u * 0.08);
  ctx.restore();
  // the chain across the chest: the Usurper's emblem in miniature
  ctx.strokeStyle = THRONE_FX.gold; ctx.lineWidth = Math.max(1, u * 0.04);
  ctx.setLineDash([u * 0.06, u * 0.05]);
  ctx.beginPath(); ctx.moveTo(-u * 0.24, -u * 1.42); ctx.lineTo(u * 0.24, -u * 1.08); ctx.stroke();
  ctx.setLineDash([]);
  // the hit flash
  if (o.flash > 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255, 240, 220, ${0.55 * o.flash})`;
    ctx.beginPath(); ctx.ellipse(0, -u * 1.1, u * 0.75, u * 1.3, 0, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

/** His health bar: wine on dark, a gilt rim and a small crown at the left end. (x, y) the bar's top centre. */
export function drawUsurperHp(ctx, x, y, s, frac) {
  const w = Math.max(64, s * 2.1);
  const hgt = Math.max(6, s * 0.16);
  const k = Math.max(0, Math.min(1, frac));
  ctx.save();
  ctx.fillStyle = 'rgba(10, 4, 8, 0.85)';
  ctx.beginPath(); ctx.roundRect(x - w / 2 - 3, y - 3, w + 6, hgt + 6, (hgt + 6) / 2); ctx.fill();
  ctx.strokeStyle = THRONE_FX.gold; ctx.lineWidth = 1.2;
  ctx.stroke();
  const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  g.addColorStop(0, '#a3123f');
  g.addColorStop(1, '#e0476e');
  ctx.fillStyle = g;
  if (k > 0) { ctx.beginPath(); ctx.roundRect(x - w / 2, y, Math.max(hgt, w * k), hgt, hgt / 2); ctx.fill(); }
  // the crown cap
  const cx = x - w / 2 - hgt * 0.9;
  const cy = y + hgt / 2;
  const c = hgt * 1.25;
  ctx.fillStyle = THRONE_FX.goldBright;
  ctx.strokeStyle = 'rgba(16, 8, 10, 0.9)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - c * 0.6, cy + c * 0.45); ctx.lineTo(cx - c * 0.7, cy - c * 0.45); ctx.lineTo(cx - c * 0.25, cy - c * 0.05); ctx.lineTo(cx, cy - c * 0.6);
  ctx.lineTo(cx + c * 0.25, cy - c * 0.05); ctx.lineTo(cx + c * 0.7, cy - c * 0.45); ctx.lineTo(cx + c * 0.6, cy + c * 0.45); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();
}
