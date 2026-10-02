// World-map marks for Region Works (DESIGN §5.8, §7.7): a few small buildings by the keep of every owned region
// that has Works. Browser only; pure drawing: the scene passes plain data from game/meta/works.js
// `worksMarksData(state, world)` and the camera, nothing here touches game state.
//
//   drawWorksMarks(ctx, cam, marks, s, opts)          every mark in view, fading with zoom like the region labels
//   drawWorkBuilding(ctx, type, cx, baseY, w, opts)   one building (gallery specimens, tests)
//   worksMarkAlpha(zoom)                              the zoom fade, 0..1
//
// Screen-space canvas drawing, vector only (no image scaling), so everything stays crisp at DPR 2. Elevation
// contract (INTEGRATION-NOTES "Art"): the anchor is the keep's raised top, `cy - elevOffset(tile, s)`. The five
// silhouettes match game/ui/worksIcons.js on purpose: the icon on the card is the building on the map. Draw this
// after the settlements and before clouds and labels, and never inside the battle arena.
import { shade, ACCENTS } from './palette.js';
import { elevOffset } from './tiles.js';
import { WORKS } from '../config/works.js';

const STONE = '#b7b2a6';
const STONE_DARK = shade(STONE, -0.34);
const WOOD = '#a97c50';
const OUTLINE = 'rgba(20, 14, 6, 0.55)';

/** Where slot `i` sits relative to the keep, in world units (x right, y down): a little yard to its lower right. */
export const MARK_OFFSETS = Object.freeze([
  Object.freeze({ dx: 1.3, dy: 0.5 }),
  Object.freeze({ dx: 2.15, dy: 0.22 }),
  Object.freeze({ dx: 1.7, dy: 1.15 }),
]);

/** 0..1: nothing at overview zoom (a building would be a speck), full through the working zooms, gone with the labels. */
export function worksMarkAlpha(zoom) {
  const m = WORKS.marks;
  if (zoom <= m.fadeInStartZoom || zoom >= m.fadeOutEndZoom) return 0;
  if (zoom < m.fadeInFullZoom) return (zoom - m.fadeInStartZoom) / (m.fadeInFullZoom - m.fadeInStartZoom);
  if (zoom <= m.fadeOutStartZoom) return 1;
  return 1 - (zoom - m.fadeOutStartZoom) / (m.fadeOutEndZoom - m.fadeOutStartZoom);
}

function tri(ctx, x0, y0, x1, y1, x2, y2, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.closePath();
  ctx.fill();
}

function flag(ctx, x, poleBaseY, h, color, t) {
  ctx.strokeStyle = '#5a4632';
  ctx.lineWidth = Math.max(1, h * 0.09);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, poleBaseY);
  ctx.lineTo(x, poleBaseY - h);
  ctx.stroke();
  const wave = t == null ? 0 : Math.sin(t * 2.2 + x * 0.3) * h * 0.06;
  tri(ctx, x, poleBaseY - h, x + h * 0.62, poleBaseY - h * 0.82 + wave, x, poleBaseY - h * 0.62, color);
}

// Each builder draws a building of footprint width `w` standing on (cx, baseY).
const BUILDERS = {
  // A long hall, terracotta roof, a dark door, the realm's banner on a pole.
  barracks(ctx, cx, baseY, w, o) {
    const h = w * 0.4;
    const top = baseY - h;
    ctx.fillStyle = '#ece0c4';
    ctx.fillRect(cx - w / 2, top, w, h);
    ctx.fillStyle = shade('#ece0c4', -0.14);
    ctx.fillRect(cx + w * 0.12, top, w * 0.38, h);
    const roofH = w * 0.34;
    tri(ctx, cx - w * 0.6, top + h * 0.06, cx, top - roofH, cx + w * 0.6, top + h * 0.06, '#c8553d');
    tri(ctx, cx, top - roofH, cx + w * 0.6, top + h * 0.06, cx + w * 0.08, top + h * 0.06, shade('#c8553d', -0.26));
    ctx.fillStyle = 'rgba(28, 20, 18, 0.62)';
    ctx.fillRect(cx - w * 0.09, baseY - h * 0.62, w * 0.18, h * 0.62);
    flag(ctx, cx + w * 0.3, top + h * 0.05, w * 0.62, o.color || ACCENTS.gold, o.t);
  },
  // A barn: timber walls, dark roof, X-braced double doors, a hay bale beside it.
  stables(ctx, cx, baseY, w) {
    const h = w * 0.44;
    const top = baseY - h;
    ctx.fillStyle = WOOD;
    ctx.fillRect(cx - w / 2, top, w, h);
    ctx.fillStyle = shade(WOOD, -0.18);
    ctx.fillRect(cx + w * 0.12, top, w * 0.38, h);
    const roofH = w * 0.36;
    tri(ctx, cx - w * 0.6, top + h * 0.08, cx, top - roofH, cx + w * 0.6, top + h * 0.08, '#6e4b2f');
    tri(ctx, cx, top - roofH, cx + w * 0.6, top + h * 0.08, cx + w * 0.08, top + h * 0.08, shade('#6e4b2f', -0.28));
    const dw = w * 0.44;
    const dh = h * 0.78;
    ctx.fillStyle = shade(WOOD, -0.42);
    ctx.fillRect(cx - dw / 2, baseY - dh, dw, dh);
    ctx.strokeStyle = shade(WOOD, 0.22);
    ctx.lineWidth = Math.max(1, w * 0.045);
    ctx.beginPath();
    ctx.moveTo(cx - dw / 2, baseY - dh);
    ctx.lineTo(cx + dw / 2, baseY);
    ctx.moveTo(cx + dw / 2, baseY - dh);
    ctx.lineTo(cx - dw / 2, baseY);
    ctx.stroke();
    ctx.fillStyle = '#d9c36a';
    ctx.beginPath();
    ctx.ellipse(cx + w * 0.62, baseY - w * 0.07, w * 0.12, w * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
  },
  // A little pillared shrine on a plinth, a flame between the columns.
  shrine(ctx, cx, baseY, w, o) {
    const ph = w * 0.1;
    ctx.fillStyle = STONE;
    ctx.fillRect(cx - w * 0.52, baseY - ph, w * 1.04, ph);
    const colH = w * 0.4;
    const colTop = baseY - ph - colH;
    for (const sx of [-1, 1]) {
      ctx.fillStyle = shade(STONE, 0.12);
      ctx.fillRect(cx + sx * w * 0.34 - w * 0.07, colTop, w * 0.14, colH);
      ctx.fillStyle = STONE_DARK;
      ctx.fillRect(cx + sx * w * 0.34 + w * 0.01, colTop, w * 0.06, colH);
    }
    tri(ctx, cx - w * 0.54, colTop + w * 0.04, cx, colTop - w * 0.3, cx + w * 0.54, colTop + w * 0.04, '#7fc2b6');
    tri(ctx, cx, colTop - w * 0.3, cx + w * 0.54, colTop + w * 0.04, cx + w * 0.06, colTop + w * 0.04, shade('#7fc2b6', -0.3));
    // the flame, with a soft glow (a still one under Reduce Motion: pass no `t`)
    const fy = baseY - ph - colH * 0.42;
    const flick = o.t == null ? 1 : 1 + Math.sin(o.t * 7 + cx) * 0.12;
    ctx.fillStyle = 'rgba(255, 214, 120, 0.3)';
    ctx.beginPath();
    ctx.arc(cx, fy, w * 0.2 * flick, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd36b';
    ctx.beginPath();
    ctx.moveTo(cx, fy - w * 0.17 * flick);
    ctx.quadraticCurveTo(cx + w * 0.11, fy - w * 0.02, cx, fy + w * 0.1);
    ctx.quadraticCurveTo(cx - w * 0.11, fy - w * 0.02, cx, fy - w * 0.17 * flick);
    ctx.fill();
  },
  // A slim stone tower with crenellations, an arrow slit and a pennant.
  watchtower(ctx, cx, baseY, w, o) {
    const tw = w * 0.5;
    const th = w * 1.05;
    const top = baseY - th;
    ctx.fillStyle = STONE;
    ctx.fillRect(cx - tw / 2, top, tw, th);
    ctx.fillStyle = STONE_DARK;
    ctx.fillRect(cx + tw * 0.08, top, tw * 0.42, th);
    const cw = tw * 1.22;
    ctx.fillStyle = shade(STONE, -0.08);
    ctx.fillRect(cx - cw / 2, top - w * 0.06, cw, w * 0.14);
    const tooth = cw / 5;
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i === 1 ? shade(STONE, 0.1) : shade(STONE, -0.1);
      ctx.fillRect(cx - cw / 2 + tooth * (i * 2), top - w * 0.2, tooth, w * 0.16);
    }
    ctx.fillStyle = 'rgba(22, 18, 20, 0.6)';
    ctx.fillRect(cx - tw * 0.09, top + th * 0.28, tw * 0.18, th * 0.26);
    ctx.fillStyle = 'rgba(28, 20, 18, 0.5)';
    ctx.fillRect(cx - tw * 0.16, baseY - th * 0.2, tw * 0.32, th * 0.2);
    flag(ctx, cx, top - w * 0.2, w * 0.5, o.color || ACCENTS.gold, o.t);
  },
  // A market stall: striped awning, posts, a counter with crates and a coin.
  market(ctx, cx, baseY, w) {
    const ch = w * 0.26;
    ctx.fillStyle = WOOD;
    ctx.fillRect(cx - w * 0.44, baseY - ch, w * 0.88, ch);
    ctx.fillStyle = shade(WOOD, -0.22);
    ctx.fillRect(cx + w * 0.06, baseY - ch, w * 0.38, ch);
    const postH = w * 0.62;
    ctx.fillStyle = '#6b5334';
    ctx.fillRect(cx - w * 0.44, baseY - postH, w * 0.07, postH);
    ctx.fillRect(cx + w * 0.37, baseY - postH, w * 0.07, postH);
    const ay = baseY - postH;
    const aw = w * 1.04;
    const ah = w * 0.26;
    const stripes = 5;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 ? '#f3ead7' : '#e0952f';
      ctx.beginPath();
      ctx.moveTo(cx - aw / 2 + (aw / stripes) * i, ay);
      ctx.lineTo(cx - aw / 2 + (aw / stripes) * (i + 1), ay);
      ctx.lineTo(cx - aw / 2 + (aw / stripes) * (i + 1) + w * 0.03, ay + ah);
      ctx.lineTo(cx - aw / 2 + (aw / stripes) * i + w * 0.03, ay + ah);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
    ctx.fillRect(cx - aw / 2, ay + ah, aw, w * 0.05);
    ctx.fillStyle = '#f5c451';
    ctx.beginPath();
    ctx.arc(cx, baseY - ch - w * 0.07, w * 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 70, 8, 0.6)';
    ctx.lineWidth = Math.max(0.8, w * 0.025);
    ctx.stroke();
  },
};

/** The five building types this module can draw. */
export const WORK_BUILDING_TYPES = Object.freeze(Object.keys(BUILDERS));

/**
 * One Work building plus its level pips. `w` is the footprint width in px.
 * @param {CanvasRenderingContext2D} ctx screen-space
 * @param {'barracks'|'stables'|'shrine'|'watchtower'|'market'} type
 * @param {number} cx  @param {number} baseY  the ground point under the building's centre
 * @param {number} w
 * @param {{ level?: number, color?: string, t?: number, pips?: boolean }} [opts]
 *   `level` 1..3 draws that many gold pips under it; `color` is the realm colour for banners; `t` (seconds)
 *   animates pennants and flames: omit it for Reduce Motion.
 */
export function drawWorkBuilding(ctx, type, cx, baseY, w, opts = {}) {
  const build = BUILDERS[type];
  if (!build || !(w > 0)) return;
  // contact shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.26)';
  ctx.beginPath();
  ctx.ellipse(cx + w * 0.08, baseY + w * 0.03, w * 0.6, w * 0.15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.lineJoin = 'round';
  build(ctx, cx, baseY, w, opts);
  ctx.restore();

  const level = opts.pips === false ? 0 : Math.max(0, Math.min(3, Math.floor(opts.level || 0)));
  if (level > 0) {
    const r = Math.max(1.2, w * 0.06);
    const gap = r * 2.9;
    const py = baseY + w * 0.17 + r;
    for (let i = 0; i < level; i++) {
      const px = cx + (i - (level - 1) / 2) * gap;
      ctx.fillStyle = OUTLINE;
      ctx.beginPath();
      ctx.arc(px, py, r + Math.max(0.7, r * 0.35), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = ACCENTS.goldSoft;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Draws the Works of every mark in view, in the owner's colour, fading with zoom.
 * @param {CanvasRenderingContext2D} ctx screen-space
 * @param {{ worldToScreen: Function, visibleBounds: Function }} cam
 * @param {import('../meta/works.js').WorksMark[]} marks  `worksMarksData(state, world)`
 * @param {number} s  px per world unit (camera.zoom)
 * @param {{ alpha?: number, color?: string, t?: number, force?: boolean, skip?: (mark: object) => boolean }} [opts]
 *   `alpha` is an extra 0..1 multiplier (fog reveal); `color` the realm colour (banners); `t` seconds (omit for
 *   Reduce Motion); `force` ignores the zoom fade; `skip` hides individual marks (e.g. fogged regions).
 */
export function drawWorksMarks(ctx, cam, marks, s, opts = {}) {
  if (!marks || marks.length === 0) return;
  const fade = opts.force ? 1 : worksMarkAlpha(s);
  const alpha = fade * (opts.alpha ?? 1);
  if (alpha <= 0.01) return;
  const w = WORKS.marks.sizeUnits * s;
  const vb = cam.visibleBounds(3);
  const drawn = [];
  for (const mark of marks) {
    if (mark.x < vb.minX || mark.x > vb.maxX || mark.y < vb.minY || mark.y > vb.maxY + 3) continue;
    if (opts.skip && opts.skip(mark)) continue;
    const p = cam.worldToScreen(mark.x, mark.y);
    const topY = p.y - elevOffset({ elev: mark.elev }, s);
    mark.works.slice(0, WORKS.marks.maxShown).forEach((work, i) => {
      const off = MARK_OFFSETS[i] || MARK_OFFSETS[MARK_OFFSETS.length - 1];
      drawn.push({ type: work.type, level: work.level, x: p.x + off.dx * s, y: topY + off.dy * s });
    });
  }
  if (drawn.length === 0) return;
  // back to front, so a building lower on the screen overlaps the one behind it
  drawn.sort((a, b) => a.y - b.y);
  ctx.save();
  ctx.globalAlpha *= alpha;
  for (const d of drawn) drawWorkBuilding(ctx, d.type, d.x, d.y, w, { level: d.level, color: opts.color, t: opts.t });
  ctx.restore();
}
