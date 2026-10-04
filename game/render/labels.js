// World-scene region labels (DESIGN §7.5, PLAYFEEL §2): name at the centroid,
// a difficulty chip under frontier regions, a crown glyph on rival capitals,
// fading out past a zoom threshold. Browser only; pure drawing — the scene
// resolves difficulty/ownership and hands over a plain data array.
import { ACCENTS } from './palette.js';
import { drawCrownPips } from './crownPips.js';
import { drawSabotageMark } from './intelMarks.js';
import { DIFFICULTY_COLORS, WORLD_SCENE } from '../scenes/timing.js';
import { drawTypeIcon, drawTwistGlyph, drawPlagueMark } from './featureGlyphs.js';

function labelAlpha(zoom) {
  const { labelFadeStartZoom: a, labelFadeEndZoom: b } = WORLD_SCENE;
  if (zoom <= a) return 1;
  if (zoom >= b) return 0;
  return 1 - (zoom - a) / (b - a);
}

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

function drawCrown(ctx, x, y, size, color) {
  const w = size;
  const h = size * 0.62;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(20,16,10,0.55)';
  ctx.lineWidth = Math.max(1, size * 0.08);
  ctx.beginPath();
  ctx.moveTo(-w / 2, h * 0.15);
  ctx.lineTo(-w / 2, -h * 0.1);
  ctx.lineTo(-w * 0.28, h * 0.2);
  ctx.lineTo(0, -h * 0.55);
  ctx.lineTo(w * 0.28, h * 0.2);
  ctx.lineTo(w / 2, -h * 0.1);
  ctx.lineTo(w / 2, h * 0.15);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (const px of [-w * 0.28, 0, w * 0.28]) {
    ctx.beginPath();
    ctx.arc(px, -h * 0.05, size * 0.055, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * @typedef {Object} RegionLabelDatum
 * @property {number} x @property {number} y world-unit anchor
 * @property {string} name
 * @property {boolean} [isCapital] rival capital: crown glyph
 * @property {{label: 'Easy'|'Fair'|'Hard'|'Deadly'}} [difficulty] omit for owned/non-frontier regions
 * @property {number} [priority] lower places first (0 selected, 1 frontier, 2 rival capital, 3 owned, 4 rest)
 * @property {number} [crowns] owned regions: crowns earned (0-3), drawn as gold pips under the name
 * @property {number} [sabotage] rival/free regions: sabotage steps (0-2), a torch right of the name
 * @property {string} [occupied] a region of yours the enemy occupies (DESIGN 10.2): the occupier's colour; a hatched badge left of the name
 * @property {string} [type] a region type (DESIGN 10.13): its icon in a round badge left of the name (left of the crown on a capital)
 * @property {string} [twist] a battle twist (DESIGN 10.13): its glyph at the front of the difficulty chip
 * @property {boolean} [plague] a plagued rival's region (DESIGN 10.13): the plague mark right of the name
 */

/** "Occupied" (DESIGN 10.2): a small square in the occupier's colour, hatched, with a dark rim: the same hatching as the region on the map. */
function drawOccupiedBadge(ctx, x, y, size, color) {
  const s = size * 0.9;
  ctx.save();
  ctx.translate(x, y);
  roundRect(ctx, -s / 2, -s / 2, s, s, s * 0.22);
  ctx.fillStyle = 'rgba(10,12,18,0.85)';
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.2, s * 0.16);
  for (let k = -s; k <= s; k += s * 0.34) { ctx.beginPath(); ctx.moveTo(k - s / 2, s / 2); ctx.lineTo(k + s / 2, -s / 2); ctx.stroke(); }
  ctx.restore();
  roundRect(ctx, -s / 2, -s / 2, s, s, s * 0.22);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, s * 0.1);
  ctx.stroke();
  ctx.restore();
}

const widthCache = new Map(); // `${font}|${text}` -> px
function textWidth(ctx, font, text) {
  const key = `${font}|${text}`;
  let w = widthCache.get(key);
  if (w === undefined) {
    ctx.font = font;
    w = ctx.measureText(text).width;
    widthCache.set(key, w);
    if (widthCache.size > 400) widthCache.clear();
  }
  return w;
}

const NUDGES = [0, 0.25, -0.25, 0.5, -0.5]; // fractions of the label's own height (PLAYFEEL: up to 0.5)
const PAD = 2;

function overlaps(a, b) {
  return a.x0 < b.x1 + PAD && a.x1 > b.x0 - PAD && a.y0 < b.y1 + PAD && a.y1 > b.y0 - PAD;
}

/**
 * Draws region labels with greedy, priority-ordered collision avoidance: labels are placed in
 * priority order (selected > frontier > rival capital > owned > the rest); a label whose box
 * (name + crown + difficulty chip, which always travel together) overlaps one already placed is
 * first nudged up/down by up to half its height and only then skipped.
 * @param {CanvasRenderingContext2D} ctx screen-space
 * @param {object} camera
 * @param {RegionLabelDatum[]} labelData
 * @param {{fade?: number, time?: number}} [opts] fade: extra 0..1 opacity (labels ease in with the mists);
 *   time: seconds, flickers the sabotage torch (omit for Reduce Motion: a still torch)
 */
export function drawRegionLabels(ctx, camera, labelData, opts = {}) {
  if (!labelData || labelData.length === 0) return [];
  const alpha = labelAlpha(camera.zoom) * (opts.fade ?? 1);
  if (alpha <= 0.01) return [];

  const fontPx = Math.max(11, Math.min(23, camera.zoom * 0.66));
  const showChips = camera.zoom >= 9; // below that the chips would just pile onto neighbouring names
  const nameFont = `700 ${fontPx}px Cinzel, Georgia, serif`;
  const chipFont = Math.max(11, fontPx * 0.56); // never under 11 px (DESIGN 7.5a)
  const chipFontStr = `800 ${chipFont}px Nunito, system-ui, sans-serif`;
  const chipH = chipFont * 1.55;
  // Crown pips: 0.72 x the label font, clamped 11-16 px; they travel with their label.
  const pipPx = Math.max(11, Math.min(16, Math.round(fontPx * 0.72)));
  const W = camera.viewW;
  const H = camera.viewH;

  // Visible candidates with their unplaced boxes.
  const cands = [];
  for (const d of labelData) {
    const p = camera.worldToScreen(d.x, d.y);
    if (p.x < -120 || p.x > W + 120 || p.y < -60 || p.y > H + 60) continue;
    const nameW = textWidth(ctx, nameFont, d.name);
    const hasChip = !!(d.difficulty && showChips);
    const chipW = hasChip ? textWidth(ctx, chipFontStr, d.difficulty.label) + chipFont * 1.1 + (d.twist ? chipFont * 1.25 : 0) : 0;
    const hasPips = !!(d.crowns > 0 && showChips); // same zoom threshold as the difficulty chips
    const pipsW = hasPips ? d.crowns * pipPx + (d.crowns - 1) * Math.max(1, pipPx * 0.22) : 0;
    const torchW = (d.sabotage > 0 ? fontPx * 1.3 : 0) + (d.occupied ? fontPx * 1.3 : 0) + (d.plague ? fontPx * 1.3 : 0); // right of the name / the occupied badge (the capital crown takes the left)
    const typeW = d.type ? fontPx * 1.35 : 0; // the type badge, left of the name (and of a capital's crown)
    const halfW = Math.max(nameW / 2 + (d.isCapital ? fontPx * 1.3 : 0) + typeW + torchW, chipW / 2, pipsW / 2);
    const baseY = p.y - fontPx * 0.6; // text baseline
    const top = baseY - fontPx * 0.95;
    let bottom = hasChip ? baseY + fontPx * 0.5 + chipH : baseY + fontPx * 0.3;
    if (hasPips) bottom = baseY + fontPx * 0.35 + pipPx * 0.8;
    cands.push({
      d, x: p.x, baseY, nameW, hasChip, hasPips, chipW, halfW, h: bottom - top, top,
      priority: d.priority ?? 4,
    });
  }
  cands.sort((a, b) => a.priority - b.priority);

  const placed = [];
  const out = [];
  for (const c of cands) {
    let chosen = null;
    for (const n of NUDGES) {
      const dy = n * c.h;
      const box = { x0: c.x - c.halfW, x1: c.x + c.halfW, y0: c.top + dy, y1: c.top + dy + c.h };
      if (!placed.some((o) => overlaps(box, o))) { chosen = { box, dy }; break; }
    }
    if (!chosen) continue;
    placed.push(chosen.box);
    out.push({ c, dy: chosen.dy });
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  for (const { c, dy } of out) {
    const { d } = c;
    const y = c.baseY + dy;
    ctx.font = nameFont;
    // a region of yours sits on the blue-green owned tint, where cream text needs more than the usual outline (it read poorly zoomed in): a heavier, darker
    // stroke and a soft shadow behind the name
    const owned = d.kind === 3;
    ctx.lineWidth = Math.max(2, fontPx * (owned ? 0.34 : 0.22));
    ctx.strokeStyle = owned ? 'rgba(6,20,38,0.92)' : 'rgba(20,16,10,0.75)';
    if (owned) { ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = Math.max(2, fontPx * 0.3); }
    ctx.strokeText(d.name, c.x, y);
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = d.priority === 0 ? ACCENTS.goldSoft : ACCENTS.cream;
    ctx.fillText(d.name, c.x, y);

    if (c.hasPips) drawCrownPips(ctx, c.x, y + fontPx * 0.35 + pipPx * 0.4, d.crowns, pipPx);

    if (d.sabotage > 0) drawSabotageMark(ctx, c.x + c.nameW / 2 + fontPx * 0.8, y - fontPx * 0.32, fontPx * 1.15, opts.time);

    if (d.plague) drawPlagueMark(ctx, c.x + c.nameW / 2 + fontPx * (0.8 + (d.sabotage > 0 ? 1.3 : 0) + (d.occupied ? 1.3 : 0)), y - fontPx * 0.36, fontPx * 1.15);
    if (d.occupied) drawOccupiedBadge(ctx, c.x + c.nameW / 2 + fontPx * (d.sabotage > 0 ? 2.1 : 0.8), y - fontPx * 0.32, fontPx * 1.05, d.occupied);

    if (d.isCapital) {
      drawCrown(ctx, c.x - c.nameW / 2 - fontPx * 0.75, y - fontPx * 0.32, fontPx * 0.9, ACCENTS.gold);
    }

    if (d.type) drawTypeIcon(ctx, d.type, c.x - c.nameW / 2 - fontPx * (d.isCapital ? 2.05 : 0.8), y - fontPx * 0.34, fontPx * 1.1);

    if (c.hasChip) {
      const chipY = y + fontPx * 0.5;
      const label = d.difficulty.label;
      const color = DIFFICULTY_COLORS[label] || ACCENTS.muted;
      ctx.font = chipFontStr;
      const chipW = c.chipW;
      roundRect(ctx, c.x - chipW / 2, chipY, chipW, chipH, chipH / 2);
      ctx.fillStyle = 'rgba(10,12,18,0.6)';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.textBaseline = 'middle';
      const glyphW = d.twist ? chipFont * 1.25 : 0;
      if (d.twist) drawTwistGlyph(ctx, d.twist, c.x - chipW / 2 + chipFont * 0.55 + glyphW / 2 - chipFont * 0.1, chipY + chipH / 2, chipFont * 1.15);
      ctx.fillStyle = color;
      ctx.fillText(label, c.x + glyphW / 2, chipY + chipH / 2 + 0.5);
      ctx.textBaseline = 'alphabetic';
    }
  }
  ctx.restore();
  return placed; // the screen boxes the labels took ({ x0, x1, y0, y1 }): later map marks keep off them (war-band badges)
}
