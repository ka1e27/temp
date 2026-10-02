// The Tapestry (DESIGN §5.9): frames an already-rendered image of the continent as a woven, hanging keepsake, with a title
// ribbon, the dynasty number, the date and the headline stats, ready to be saved as a PNG. Browser only; pure drawing: the
// caller hands in the map canvas (integration renders the whole continent with the real renderer, see
// docs/briefs/keepsakes-hookup.md) and gets a finished canvas back. No server, no game state.
//
//   await ensureTapestryFonts();                       // Cinzel / Nunito are loaded by the page; make sure before drawing
//   const canvas = composeTapestry({ mapCanvas, title, subtitle, stats, factionColor, date, dynasty });
//   await downloadCanvas(canvas, tapestryFilename({ dynasty, date }));
//
// The look is the game's own: the parchment and ink of the UI (cream #f3ead7, gold, ink #2a1d05), a basket-woven border in
// the realm's colour with a chain of little hexagons (the map's own tile), the hanging rod and fringe of a real tapestry, and
// the same Cinzel / Nunito pair as every card. Everything is sized from the map's width, so it scales to any resolution;
// anything random (the paper grain, the fringe) comes from a seeded generator, so the same map composes to the same image.
import { shade, rgba } from './palette.js';
import { drawEmblem } from './sprites.js';
import { createRng } from '../core/rng.js';
import {
  INK, PARCHMENT, PARCHMENT_LIGHT, PARCHMENT_DARK, GOLD, GOLD_LIGHT, WOOD, makeCanvas, roman, fitFont, setSpacing, polygon, hexagon, weaveRect, hexChain, seal, ribbon, drawStatIcon,
} from './tapestryParts.js';

/** Stat keys in display order, with their labels. A stat that is not given is skipped. */
export const TAPESTRY_STATS = Object.freeze([
  ['regions', 'Regions'],
  ['battlesWon', 'Battles won'],
  ['crowns', 'Crowns'],
  ['timePlayed', 'Time played'],
]);

/**
 * @typedef {Object} TapestryOptions
 * @property {HTMLCanvasElement|OffscreenCanvas} mapCanvas   the rendered continent (any size; a bigger one makes a sharper keepsake)
 * @property {string} title        the cartouche, e.g. "The Realm of Greenreach"
 * @property {string} [subtitle]   under the ribbon, e.g. "Dynasty II" or "A new age"
 * @property {Object<string, number|string>|{label: string, value: number|string, icon?: string}[]} [stats]
 *   `{ regions, battlesWon, crowns, timePlayed }` (numbers are grouped, strings used as given), or a list of `{label, value}`
 * @property {string} [factionColor]  the realm's colour (default azure): the border and seals are woven in it
 * @property {Date|number|string} [date]  a Date or timestamp (written "30 September 2026"), or a ready string
 * @property {number} [dynasty]    shown as a Roman numeral on the top-left seal
 * @property {string} [emblem]     the top-right seal's emblem (default 'star')
 * @property {number} [seed]       seeds the paper grain and the fringe (default 1)
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "30 September 2026" from a Date or timestamp; a string is returned as it came. */
export function formatTapestryDate(date) {
  if (date == null) return '';
  if (typeof date === 'string') return date;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** `hex-dominion-dynasty-2-2026-09-30.png`: the keepsake's file name (local date). */
export function tapestryFilename({ dynasty = 1, date } = {}) {
  const d = date instanceof Date ? date : new Date(date == null ? 0 : date);
  const ok = !Number.isNaN(d.getTime()) && date != null && typeof date !== 'string';
  const pad = (n) => String(n).padStart(2, '0');
  const day = ok ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : 'keepsake';
  return `hex-dominion-dynasty-${Math.max(1, Math.round(dynasty))}-${day}.png`;
}

function formatStat(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value).toLocaleString('en-US');
  return String(value);
}

function statList(stats) {
  if (!stats) return [];
  if (Array.isArray(stats)) return stats.filter((s) => s && s.label != null && s.value != null).map((s) => ({ key: s.icon || '', label: s.label, value: formatStat(s.value) }));
  return TAPESTRY_STATS.filter(([key]) => stats[key] != null && stats[key] !== '').map(([key, label]) => ({ key, label, value: formatStat(stats[key]) }));
}

// --- composing -----------------------------------------------------------------------------------------------------

/**
 * Frames a rendered map as a keepsake tapestry and returns the finished canvas.
 * @param {TapestryOptions} opts
 * @returns {HTMLCanvasElement}
 */
export function composeTapestry(opts) {
  const {
    mapCanvas, title, subtitle = '', stats, factionColor = '#3d7ef0', date, dynasty, emblem = 'star', seed = 1,
  } = opts || {};
  if (!mapCanvas || !(mapCanvas.width > 0) || !(mapCanvas.height > 0)) throw new Error('composeTapestry: mapCanvas is required');

  const mapW = mapCanvas.width;
  const mapH = mapCanvas.height;
  const u = mapW / 100; // one unit: everything scales with the map
  const rng = createRng(seed);

  // --- geometry (outer -> inner) --------------------------------------------------------------------------
  const rodH = 2.4 * u;
  const rodOver = 2.6 * u;
  const fringeH = 2.8 * u;
  const bw = 5.4 * u; // the woven band
  const matSide = 3.1 * u;
  const matTop = 6.6 * u;
  const matBottom = 11.6 * u;
  const bodyW = mapW + 2 * (matSide + bw);
  const bodyH = mapH + matTop + matBottom + 2 * bw;
  const W = Math.round(bodyW + 2 * rodOver);
  const H = Math.round(rodH + 1.2 * u + bodyH + fringeH + 1.6 * u);
  const bx = (W - bodyW) / 2;
  const by = rodH + 1.2 * u;
  const mapX = bx + bw + matSide;
  const mapY = by + bw + matTop;

  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.lineJoin = 'round';

  // --- the wall behind it ---------------------------------------------------------------------------------------
  const wall = ctx.createRadialGradient(W / 2, H * 0.42, W * 0.1, W / 2, H / 2, W * 0.75);
  wall.addColorStop(0, '#222b3d');
  wall.addColorStop(1, '#0d111a');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, W, H);

  // --- the body's shadow, then the woven border --------------------------------------------------------------
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 2.4 * u;
  ctx.shadowOffsetY = 0.9 * u;
  ctx.fillStyle = '#000';
  ctx.fillRect(bx, by, bodyW, bodyH);
  ctx.restore();

  const tones = { dark: shade(factionColor, -0.62), mid: shade(factionColor, -0.46), light: shade(factionColor, 0.02) };
  const cell = bw / 9;
  weaveRect(ctx, bx, by, bodyW, bw, cell, tones); // top
  weaveRect(ctx, bx, by + bodyH - bw, bodyW, bw, cell, tones); // bottom
  weaveRect(ctx, bx, by + bw, bw, bodyH - 2 * bw, cell, tones); // left
  weaveRect(ctx, bx + bodyW - bw, by + bw, bw, bodyH - 2 * bw, cell, tones); // right

  // the hexagon chain runs along the middle of every band, with a gold pinstripe either side of it
  const mid = bw / 2;
  ctx.lineWidth = Math.max(1, 0.2 * u);
  ctx.strokeStyle = rgba(GOLD, 0.85);
  for (const off of [-0.34, 0.34]) {
    ctx.strokeRect(bx + mid + off * bw, by + mid + off * bw, bodyW - 2 * (mid + off * bw), bodyH - 2 * (mid + off * bw));
  }
  const hexR = 0.92 * u;
  const cream = '#f3ead7';
  hexChain(ctx, bx + 5.2 * u, by + mid, bx + bodyW - 5.2 * u, by + mid, hexR, factionColor, cream);
  hexChain(ctx, bx + 5.2 * u, by + bodyH - mid, bx + bodyW - 5.2 * u, by + bodyH - mid, hexR, factionColor, cream);
  hexChain(ctx, bx + mid, by + 5.2 * u, bx + mid, by + bodyH - 5.2 * u, hexR, factionColor, cream);
  hexChain(ctx, bx + bodyW - mid, by + 5.2 * u, bx + bodyW - mid, by + bodyH - 5.2 * u, hexR, factionColor, cream);

  // the border's edges: a dark line outside, a gold and a dark line where it meets the parchment
  ctx.lineWidth = 0.3 * u;
  ctx.strokeStyle = rgba('#000', 0.7);
  ctx.strokeRect(bx, by, bodyW, bodyH);
  ctx.lineWidth = 0.34 * u;
  ctx.strokeStyle = GOLD;
  ctx.strokeRect(bx + bw, by + bw, bodyW - 2 * bw, bodyH - 2 * bw);
  ctx.lineWidth = 0.2 * u;
  ctx.strokeStyle = rgba(INK, 0.8);
  ctx.strokeRect(bx + bw + 0.3 * u, by + bw + 0.3 * u, bodyW - 2 * bw - 0.6 * u, bodyH - 2 * bw - 0.6 * u);

  // --- the parchment mat ------------------------------------------------------------------------------------
  const px = bx + bw + 0.3 * u;
  const py = by + bw + 0.3 * u;
  const pw = bodyW - 2 * bw - 0.6 * u;
  const ph = bodyH - 2 * bw - 0.6 * u;
  const paper = ctx.createRadialGradient(px + pw / 2, py + ph * 0.45, pw * 0.1, px + pw / 2, py + ph / 2, pw * 0.72);
  paper.addColorStop(0, PARCHMENT_LIGHT);
  paper.addColorStop(0.7, PARCHMENT);
  paper.addColorStop(1, PARCHMENT_DARK);
  ctx.fillStyle = paper;
  ctx.fillRect(px, py, pw, ph);
  // grain: seeded speckles and a few fibres, kept light
  ctx.save();
  ctx.beginPath();
  ctx.rect(px, py, pw, ph);
  ctx.clip();
  const specks = Math.min(5200, Math.round((pw * ph) / (u * u * 5)));
  for (let i = 0; i < specks; i++) {
    const x = px + rng.next() * pw;
    const y = py + rng.next() * ph;
    ctx.fillStyle = rng.next() < 0.5 ? 'rgba(120, 84, 30, 0.07)' : 'rgba(255, 255, 255, 0.1)';
    const sz = (0.08 + rng.next() * 0.2) * u;
    ctx.fillRect(x, y, sz, sz);
  }
  ctx.strokeStyle = 'rgba(120, 84, 30, 0.05)';
  ctx.lineWidth = 0.1 * u;
  for (let i = 0; i < 90; i++) {
    const x = px + rng.next() * pw;
    const y = py + rng.next() * ph;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng.next() - 0.5) * 7 * u, y + (rng.next() - 0.5) * 2 * u);
    ctx.stroke();
  }
  // the border casts a faint shadow onto the parchment
  const sh = 1.3 * u;
  for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [
    [0, py, 0, py + sh, px, py, pw, sh], [0, py + ph, 0, py + ph - sh, px, py + ph - sh, pw, sh],
    [px, 0, px + sh, 0, px, py, sh, ph], [px + pw, 0, px + pw - sh, 0, px + pw - sh, py, sh, ph],
  ]) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(60, 38, 8, 0.28)');
    g.addColorStop(1, 'rgba(60, 38, 8, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(rx, ry, rw, rh);
  }
  ctx.restore();

  // --- the map in its frame -------------------------------------------------------------------------------------
  ctx.save();
  ctx.shadowColor = 'rgba(40, 26, 6, 0.5)';
  ctx.shadowBlur = 1.2 * u;
  ctx.shadowOffsetY = 0.35 * u;
  ctx.fillStyle = INK;
  ctx.fillRect(mapX - 0.6 * u, mapY - 0.6 * u, mapW + 1.2 * u, mapH + 1.2 * u);
  ctx.restore();
  ctx.fillStyle = GOLD;
  ctx.fillRect(mapX - 0.34 * u, mapY - 0.34 * u, mapW + 0.68 * u, mapH + 0.68 * u);
  ctx.drawImage(mapCanvas, mapX, mapY, mapW, mapH);
  // the map sits a little inside its frame: a soft inner shadow and a hairline
  const edge = 1.6 * u;
  for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [
    [0, mapY, 0, mapY + edge, mapX, mapY, mapW, edge], [0, mapY + mapH, 0, mapY + mapH - edge, mapX, mapY + mapH - edge, mapW, edge],
    [mapX, 0, mapX + edge, 0, mapX, mapY, edge, mapH], [mapX + mapW, 0, mapX + mapW - edge, 0, mapX + mapW - edge, mapY, edge, mapH],
  ]) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(10, 14, 24, 0.34)');
    g.addColorStop(1, 'rgba(10, 14, 24, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(rx, ry, rw, rh);
  }
  ctx.lineWidth = 0.14 * u;
  ctx.strokeStyle = rgba(INK, 0.9);
  ctx.strokeRect(mapX, mapY, mapW, mapH);

  // --- the corner seals ---------------------------------------------------------------------------------------------
  const sealR = 3.0 * u;
  const sx = bw * 0.5;
  const numeral = Number.isFinite(dynasty) ? roman(dynasty) : null;
  seal(ctx, bx + sx, by + sx, sealR, factionColor, (c, cx, cy, r) => {
    if (numeral) {
      c.font = `700 ${fitFont(c, numeral, r * 1.15, r * 0.95, 700, 'Cinzel, Georgia, serif')}px Cinzel, Georgia, serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = '#f3ead7';
      c.strokeStyle = rgba(INK, 0.6);
      c.lineWidth = r * 0.1;
      c.strokeText(numeral, cx, cy + r * 0.04);
      c.fillText(numeral, cx, cy + r * 0.04);
    } else {
      drawEmblem(c, 'star', cx, cy, r * 1.1, '#f3ead7');
    }
  });
  seal(ctx, bx + bodyW - sx, by + sx, sealR, factionColor, (c, cx, cy, r) => drawEmblem(c, emblem, cx, cy, r * 1.15, '#f3ead7'));
  for (const [cx, cy] of [[bx + sx, by + bodyH - sx], [bx + bodyW - sx, by + bodyH - sx]]) {
    seal(ctx, cx, cy, sealR * 0.78, factionColor, (c, x, y, r) => {
      hexagon(c, x, y, r * 0.5);
      c.fillStyle = '#f3ead7';
      c.fill();
      c.lineWidth = r * 0.07;
      c.strokeStyle = rgba(INK, 0.6);
      c.stroke();
    });
  }

  // --- the title ribbon and subtitle ---------------------------------------------------------------------------------
  const family = 'Cinzel, Georgia, serif';
  const numFamily = 'Nunito, system-ui, sans-serif';
  const ribbonH = 7.4 * u;
  const ribbonY = by + bw * 0.5 + 0.2 * u;
  const titleText = String(title || '');
  const maxTitleW = mapW * 0.62;
  const titleSize = fitFont(ctx, titleText, maxTitleW, 3.5 * u, 700, family);
  ctx.font = `700 ${titleSize}px ${family}`;
  setSpacing(ctx, 0.06, titleSize); // measure with the same letter-spacing the text is drawn with
  const titleW = ctx.measureText(titleText).width;
  setSpacing(ctx, 0, titleSize);
  const ribbonW = Math.max(30 * u, titleW + 13 * u);
  ribbon(ctx, W / 2, ribbonY + ribbonH * 0.12, ribbonW, ribbonH, 5.4 * u, 1.3 * u);
  ctx.font = `700 ${titleSize}px ${family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  setSpacing(ctx, 0.06, titleSize);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(titleText, W / 2, ribbonY + ribbonH * 0.12 + titleSize * 0.05 + 0.1 * u);
  ctx.fillStyle = INK;
  ctx.fillText(titleText, W / 2, ribbonY + ribbonH * 0.12 + titleSize * 0.05);
  setSpacing(ctx, 0, titleSize);
  // two small hexagons flank the title
  for (const sign of [-1, 1]) {
    const hx = W / 2 + sign * (titleW / 2 + 3.2 * u);
    hexagon(ctx, hx, ribbonY + ribbonH * 0.12, 0.9 * u);
    ctx.fillStyle = factionColor;
    ctx.fill();
    ctx.lineWidth = 0.15 * u;
    ctx.strokeStyle = rgba(INK, 0.85);
    ctx.stroke();
  }
  if (subtitle) {
    const subSize = fitFont(ctx, String(subtitle), mapW * 0.7, 2.25 * u, 700, family);
    ctx.font = `700 ${subSize}px ${family}`;
    ctx.textBaseline = 'middle';
    setSpacing(ctx, 0.14, subSize);
    ctx.fillStyle = rgba(INK, 0.82);
    ctx.fillText(String(subtitle).toUpperCase(), W / 2, mapY - matTop * 0.27);
    setSpacing(ctx, 0, subSize);
  }

  // --- the stats row -------------------------------------------------------------------------------------------------
  const list = statList(stats);
  const rowTop = mapY + mapH;
  const rowY = rowTop + matBottom * 0.36;
  const dateText = formatTapestryDate(date);
  if (list.length) {
    const innerX = mapX;
    const colW = mapW / list.length;
    list.forEach((st, i) => {
      const cx = innerX + colW * (i + 0.5);
      // the numbers are Nunito 800: lining figures that sit on one baseline (Cinzel's are old-style, which made "2D 14H" and "25 OF 26" read
      // oddly); Cinzel stays for the title, ribbon, subtitle and date. Units stay lower-case, as given ("2d 14h", "25 of 26").
      const valueSize = fitFont(ctx, st.value, colW * 0.5, 3.3 * u, 800, numFamily);
      ctx.font = `800 ${valueSize}px ${numFamily}`;
      const vw = ctx.measureText(st.value).width;
      const iconS = 3.6 * u;
      const groupW = iconS + 1.5 * u + vw;
      const gx = cx - groupW / 2;
      drawStatIcon(ctx, st.key, gx + iconS / 2, rowY, iconS, factionColor);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = INK;
      ctx.fillText(st.value, gx + iconS + 1.5 * u, rowY + 0.15 * u);
      ctx.font = `800 ${1.4 * u}px Nunito, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      setSpacing(ctx, 0.14, 1.4 * u);
      ctx.fillStyle = rgba(INK, 0.62);
      ctx.fillText(st.label.toUpperCase(), cx, rowY + 3.2 * u);
      setSpacing(ctx, 0, 1.4 * u);
      if (i) {
        // a little gold diamond between columns
        const dx = innerX + colW * i;
        polygon(ctx, [[dx, rowY - 1.1 * u], [dx + 0.7 * u, rowY], [dx, rowY + 1.1 * u], [dx - 0.7 * u, rowY]]);
        ctx.fillStyle = GOLD;
        ctx.fill();
        ctx.lineWidth = 0.1 * u;
        ctx.strokeStyle = rgba(INK, 0.7);
        ctx.stroke();
      }
    });
  }
  // the maker's line: the game's name and the date, between two fine rules
  const signY = rowTop + matBottom - 2.0 * u;
  const signText = dateText ? `HEX DOMINION  ·  ${dateText.toUpperCase()}` : 'HEX DOMINION';
  ctx.font = `700 ${1.3 * u}px ${family}`;
  setSpacing(ctx, 0.16, 1.3 * u);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = rgba(INK, 0.55);
  ctx.fillText(signText, W / 2, signY);
  const signW = ctx.measureText(signText).width;
  setSpacing(ctx, 0, 1.3 * u);
  ctx.strokeStyle = rgba(INK, 0.28);
  ctx.lineWidth = 0.1 * u;
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(W / 2 + sign * (signW / 2 + 1.6 * u), signY);
    ctx.lineTo(W / 2 + sign * Math.min(signW / 2 + 12 * u, mapW * 0.4), signY);
    ctx.stroke();
  }

  // --- the fringe, the rod and its loops -----------------------------------------------------------------------------
  const fy = by + bodyH;
  const thread = 0.5 * u;
  for (let x = bx + 0.3 * u; x < bx + bodyW - 0.2 * u; x += thread) {
    const len = fringeH * (0.65 + rng.next() * 0.35);
    const hue = rng.next();
    ctx.strokeStyle = hue < 0.55 ? '#e8dcc0' : hue < 0.85 ? shade(factionColor, 0.2) : GOLD;
    ctx.lineWidth = thread * 0.62;
    ctx.beginPath();
    ctx.moveTo(x, fy - 0.2 * u);
    ctx.lineTo(x + (rng.next() - 0.5) * 0.15 * u, fy + len);
    ctx.stroke();
  }
  // a faint knot line where the fringe leaves the cloth
  ctx.strokeStyle = rgba('#000', 0.35);
  ctx.lineWidth = 0.25 * u;
  ctx.beginPath();
  ctx.moveTo(bx, fy + 0.15 * u);
  ctx.lineTo(bx + bodyW, fy + 0.15 * u);
  ctx.stroke();

  const rodY = by - 0.6 * u - rodH / 2 + 0.6 * u;
  const loops = 7;
  for (let i = 0; i < loops; i++) {
    const lx = bx + (bodyW * (i + 0.5)) / loops;
    const lw = 2.6 * u;
    ctx.fillStyle = tones.mid;
    ctx.fillRect(lx - lw / 2, rodY, lw, by - rodY + 0.4 * u);
    ctx.fillStyle = rgba(tones.light, 0.4);
    ctx.fillRect(lx - lw / 2, rodY, lw * 0.3, by - rodY + 0.4 * u);
    ctx.lineWidth = 0.14 * u;
    ctx.strokeStyle = rgba('#000', 0.6);
    ctx.strokeRect(lx - lw / 2, rodY, lw, by - rodY + 0.4 * u);
  }
  const rx0 = bx - rodOver;
  const rx1 = bx + bodyW + rodOver;
  const rodTop = rodY - rodH / 2 + 0.2 * u;
  const rg = ctx.createLinearGradient(0, rodTop, 0, rodTop + rodH);
  rg.addColorStop(0, shade(WOOD, 0.3));
  rg.addColorStop(0.45, WOOD);
  rg.addColorStop(1, shade(WOOD, -0.45));
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 0.8 * u;
  ctx.shadowOffsetY = 0.4 * u;
  ctx.fillStyle = rg;
  ctx.fillRect(rx0, rodTop, rx1 - rx0, rodH);
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(rx0, rodTop + rodH * 0.14, rx1 - rx0, rodH * 0.14);
  for (const x of [rx0, rx1]) {
    const fg = ctx.createRadialGradient(x - 0.3 * u, rodTop + rodH * 0.35, 0.2 * u, x, rodTop + rodH / 2, rodH * 0.85);
    fg.addColorStop(0, GOLD_LIGHT);
    fg.addColorStop(1, '#a0731a');
    ctx.beginPath();
    ctx.arc(x, rodTop + rodH / 2, rodH * 0.72, 0, Math.PI * 2);
    ctx.fillStyle = fg;
    ctx.fill();
    ctx.lineWidth = 0.14 * u;
    ctx.strokeStyle = rgba('#000', 0.6);
    ctx.stroke();
  }
  return canvas;
}

// --- fonts and saving ---------------------------------------------------------------------------------------------------

/**
 * Resolves once the fonts the tapestry draws with are ready (or after `timeoutMs`), so the title is never set in the
 * fallback face. Safe where `document.fonts` does not exist.
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
export function ensureTapestryFonts(timeoutMs = 1500) {
  const fonts = typeof document !== 'undefined' ? document.fonts : null;
  if (!fonts || typeof fonts.load !== 'function') return Promise.resolve();
  const wait = Promise.all([fonts.load('700 24px Cinzel'), fonts.load('800 14px Nunito')]).then(() => undefined, () => undefined);
  return Promise.race([wait, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
}

/**
 * Downloads a canvas as a PNG: `toBlob` plus an anchor with `download`, falling back to a data URL where `toBlob` is
 * missing or yields nothing. Resolves true once the download was started, false if the canvas could not be exported
 * (a tainted canvas, for instance); never throws.
 * @param {HTMLCanvasElement} canvas
 * @param {string} [filename]
 * @returns {Promise<boolean>}
 */
export function downloadCanvas(canvas, filename = 'hex-dominion.png') {
  const trigger = (href, revoke) => {
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    (document.body || document.documentElement).appendChild(a);
    a.click();
    a.remove();
    if (revoke) setTimeout(() => URL.revokeObjectURL(href), 4000);
    return true;
  };
  const viaDataUrl = () => {
    try { return trigger(canvas.toDataURL('image/png'), false); } catch { return false; }
  };
  return new Promise((resolve) => {
    if (!canvas) { resolve(false); return; }
    if (typeof canvas.toBlob !== 'function') { resolve(viaDataUrl()); return; }
    try {
      canvas.toBlob((blob) => {
        if (!blob) { resolve(viaDataUrl()); return; }
        try { resolve(trigger(URL.createObjectURL(blob), true)); } catch { resolve(viaDataUrl()); }
      }, 'image/png');
    } catch {
      resolve(viaDataUrl());
    }
  });
}

