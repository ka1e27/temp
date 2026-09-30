// World-map marks for Scout and Sabotage (DESIGN §5.7). Browser only; pure drawing: the scene passes
// the scout report's plain site data and the current time, nothing here mutates game state.
//
//   drawScoutedGarrisons(ctx, cam, sites, faction, s, opts)   garrison badges at a scouted region's settlements
//   drawWeakPointMarker(ctx, cam, site, s, t, opts)           a soft pulsing ring on the suggested first strike
//   drawSabotageMark(ctx, x, y, sizePx, t)                    a small torch for next to the region label
//
// Screen-space canvas drawing, vector only (no image scaling), so everything stays crisp at DPR 2.
// The sites come from `scoutReport(...).sites` (game/meta/intel.js): `{ x, y, elev, garrison, neutral, ... }`
// with x/y the tile centre in world units. Elevation contract (INTEGRATION-NOTES "Art"): everything is
// anchored at `topY = cy - elevOffset(tile, s)` so it sits on the raised top, not on the baseline.
import { drawTroopBadge } from './sprites.js';
import { elevOffset } from './tiles.js';
import { ACCENTS } from './palette.js';
import { INTEL } from '../config/intel.js';

const FREE_FOLK = 1;

/** 0..1: garrison badges fade in between the configured zoom levels so a zoomed-out map stays clean. */
export function badgeAlphaAtZoom(zoom) {
  const { badgeFadeStartZoom: a, badgeFullZoom: b } = INTEL.marks;
  if (zoom <= a) return 0;
  if (zoom >= b) return 1;
  return (zoom - a) / (b - a);
}

/** Screen position of a site's raised top: the anchor every mark hangs from. */
function anchorOf(cam, site, s) {
  const p = cam.worldToScreen(site.x, site.y);
  return { x: p.x, y: p.y - elevOffset({ elev: site.elev }, s) };
}

/**
 * Garrison badges at every settlement of a scouted region, in the region owner's colour (neutral Free
 * Folk hamlets in Free Folk stone), placed just under each building so the sprite stays visible.
 * Draw this after the settlements and before fx, clouds and labels.
 * @param {CanvasRenderingContext2D} ctx screen-space
 * @param {{ worldToScreen: Function, visibleBounds: Function }} cam
 * @param {{ x: number, y: number, elev?: number, garrison: number, neutral?: boolean, id?: number }[]} sites
 * @param {number|object} faction owner faction id (or faction object) of the region
 * @param {number} s px per world unit (camera.zoom)
 * @param {{ alpha?: number, force?: boolean, skip?: (site: object) => boolean }} [opts]
 *   `force` ignores the zoom fade (e.g. for the selected region on a phone, where the map is small);
 *   `alpha` is an extra 0..1 multiplier (fog reveal); `skip` hides individual sites.
 */
export function drawScoutedGarrisons(ctx, cam, sites, faction, s, opts = {}) {
  if (!sites || sites.length === 0) return;
  const fade = opts.force ? 1 : badgeAlphaAtZoom(s);
  const alpha = fade * (opts.alpha ?? 1);
  if (alpha <= 0.01) return;
  const vb = cam.visibleBounds(2);
  ctx.save();
  ctx.globalAlpha *= alpha;
  for (const site of sites) {
    if (site.x < vb.minX || site.x > vb.maxX || site.y < vb.minY || site.y > vb.maxY + 2) continue;
    if (opts.skip && opts.skip(site)) continue;
    const a = anchorOf(cam, site, s);
    drawTroopBadge(ctx, a.x, a.y + INTEL.marks.badgeDropUnits * s, site.garrison,
      site.neutral ? FREE_FOLK : faction, s * 0.95);
  }
  ctx.restore();
}

/**
 * A subtle pulsing ring around the suggested first strike: a dark casing under a cream line (visible on
 * grass, sand and snow alike) plus a soft ping that widens and fades once per period. Same ground-ellipse
 * language as the selection ring, but cream, so it never reads as "selected".
 * @param {CanvasRenderingContext2D} ctx screen-space
 * @param {{ worldToScreen: Function }} cam
 * @param {{ x: number, y: number, elev?: number }} site a ScoutSite (the weak point)
 * @param {number} s px per world unit
 * @param {number} t seconds (any monotonic clock)
 * @param {{ alpha?: number, reduceMotion?: boolean }} [opts] reduceMotion draws a still ring
 */
export function drawWeakPointMarker(ctx, cam, site, s, t, opts = {}) {
  if (!site) return;
  const alpha = opts.alpha ?? 1;
  if (alpha <= 0.01) return;
  const a = anchorOf(cam, site, s);
  const cx = a.x;
  const cy = a.y + s * INTEL.marks.ringDropUnits;
  const period = INTEL.marks.ringPeriodSec;
  const phase = opts.reduceMotion ? 0.25 : ((t % period) + period) % period / period; // 0..1
  const breathe = opts.reduceMotion ? 1 : 1 + Math.sin(phase * Math.PI * 2) * 0.045;
  const r = INTEL.marks.ringRadiusUnits * s * breathe;
  const ry = r * 0.55;
  const core = Math.max(1.5, s * 0.06);

  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.lineJoin = 'round';

  if (!opts.reduceMotion) {
    // The ping: a faint ring that grows from the marker outward and dissolves.
    const grow = 1 + phase * 0.55;
    ctx.globalAlpha *= (1 - phase) * 0.6;
    ctx.strokeStyle = ACCENTS.cream;
    ctx.lineWidth = Math.max(1, core * 0.8);
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * grow, ry * grow, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = alpha;
  }

  const pulse = opts.reduceMotion ? 0.95 : 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(phase * Math.PI * 2));
  ctx.globalAlpha *= pulse;
  ctx.strokeStyle = 'rgba(14, 10, 8, 0.6)';
  ctx.lineWidth = core * 2.3;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = ACCENTS.cream;
  ctx.lineWidth = core;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, ry, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Four little notches make it read as a mark, not just a highlight.
  ctx.lineWidth = core;
  ctx.lineCap = 'round';
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const inner = 0.82;
    const outer = 1.16;
    ctx.beginPath();
    ctx.moveTo(cx + dx * r * inner, cy + dy * ry * inner);
    ctx.lineTo(cx + dx * r * outer, cy + dy * ry * outer);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * A small torch, centred at (x, y), `sizePx` tall: the "this region has been sabotaged" mark for next to a
 * region label. A dark outline keeps it legible over both the map and the label's dark text stroke.
 * @param {CanvasRenderingContext2D} ctx screen-space
 * @param {number} x @param {number} y centre, in CSS px
 * @param {number} sizePx overall height (about the label's font size)
 * @param {number} [t] seconds; when given the flame flickers (omit for Reduce Motion)
 */
export function drawSabotageMark(ctx, x, y, sizePx, t) {
  const u = sizePx / 24; // design grid: 24 units tall, torch centred on the origin
  const flick = typeof t === 'number' ? Math.sin(t * 9 + x * 0.05) * 0.06 : 0;
  ctx.save();
  ctx.translate(Math.round(x * 2) / 2, Math.round(y * 2) / 2);
  ctx.rotate(0.28);
  ctx.scale(u, u);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // soft glow behind the flame
  const glow = ctx.createRadialGradient(0, -8, 1, 0, -8, 13);
  glow.addColorStop(0, 'rgba(255, 170, 60, 0.55)');
  glow.addColorStop(1, 'rgba(255, 140, 40, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, -8, 13, 0, Math.PI * 2);
  ctx.fill();

  const outline = 'rgba(24, 12, 4, 0.92)';
  const outlineW = Math.max(1.4 / u, 2.2);

  // handle
  ctx.beginPath();
  ctx.roundRect(-2.5, -3.5, 5, 16.5, 1.8);
  ctx.fillStyle = '#7a4a22';
  ctx.strokeStyle = outline;
  ctx.lineWidth = outlineW;
  ctx.stroke();
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 214, 160, 0.35)';
  ctx.fillRect(-1.5, -2.5, 1.2, 14.5);
  // iron band
  ctx.beginPath();
  ctx.roundRect(-3.9, -4.4, 7.8, 3.4, 1.3);
  ctx.fillStyle = '#4a4f5a';
  ctx.stroke();
  ctx.fill();

  // flame: outer, mid, hot core
  const fy = -4.6;
  const lean = flick * 24;
  const flame = (w, h, tipLean) => {
    ctx.beginPath();
    ctx.moveTo(0, fy);
    ctx.bezierCurveTo(-w * 1.05, fy - h * 0.18, -w * 0.9, fy - h * 0.62, tipLean, fy - h);
    ctx.bezierCurveTo(w * 0.9, fy - h * 0.62, w * 1.05, fy - h * 0.18, 0, fy);
    ctx.closePath();
  };
  flame(7, 16, lean * 0.5);
  ctx.strokeStyle = outline;
  ctx.lineWidth = outlineW;
  ctx.stroke();
  const g = ctx.createLinearGradient(0, fy, 0, fy - 16);
  g.addColorStop(0, '#ff7a1a');
  g.addColorStop(0.6, '#ffb02e');
  g.addColorStop(1, '#ffe27a');
  ctx.fillStyle = g;
  ctx.fill();
  flame(3.6, 10, lean * 0.3);
  ctx.fillStyle = '#fff2b8';
  ctx.fill();
  ctx.restore();
}
