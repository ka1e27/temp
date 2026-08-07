// Site iconography.
//
// The rule that makes the board readable: SITE KIND IS SHAPE, OWNERSHIP IS
// COLOUR. Keeping kind out of the colour channel leaves the three faction hues
// free for the single most important read on screen — who holds what.
//
//   farm = circle   stronghold = square   camp = hexagon   castle = hexagon+ring
//
// Split out of battleView.js purely to keep both files under the 400-line cap.
// Everything here draws in WORLD space and allocates nothing.
import { UNIT_IDS } from '../content/balance.js';
import { CORNER_X, CORNER_Y } from './hexRenderer.js';

/** Body radius as a fraction of the hex circumradius. Home sites read bigger
 *  because "don't lose the Camp" is the other half of the objective. */
export const SITE_R = { farm: 0.46, stronghold: 0.5, camp: 0.62, castle: 0.62 };

const TAU = Math.PI * 2;
const TOP = -Math.PI / 2;
const DASH = [0, 0];

export const siteRadius = (kind, hexSize) => (SITE_R[kind] ?? 0.5) * hexSize;

/** Append a site body outline to the current path — lets a caller batch every
 *  site of one owner into a single fill. */
export function traceSiteShape(ctx, kind, cx, cy, r) {
  if (kind === 'farm') {
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, TAU);
  } else if (kind === 'stronghold') {
    const a = r * 0.86;
    ctx.moveTo(cx - a, cy - a);
    ctx.lineTo(cx + a, cy - a);
    ctx.lineTo(cx + a, cy + a);
    ctx.lineTo(cx - a, cy + a);
    ctx.closePath();
  } else {
    ctx.moveTo(cx + CORNER_X[0] * r, cy + CORNER_Y[0] * r);
    for (let i = 1; i < 6; i++) ctx.lineTo(cx + CORNER_X[i] * r, cy + CORNER_Y[i] * r);
    ctx.closePath();
  }
}

/**
 * Static part of a site: body, owner ring, castle/camp inner ring, level pips.
 * Lives on the background canvas and only redraws when ownership, level or
 * selection changes.
 */
export function drawSiteBase(ctx, site, cx, cy, r, p, px) {
  // Knock the territory flood out beneath the body: a site is an object ON the
  // terrain, not a tinted patch of it, and that separation is what lets the
  // rings and the garrison bar stay readable over any colour of ground.
  ctx.beginPath();
  traceSiteShape(ctx, site.kind, cx, cy, r);
  ctx.fillStyle = p.siteFill;
  ctx.fill();
  // An owner wash inside the body so ownership survives at low zoom, where a
  // 2px outline stops being legible.
  ctx.fillStyle = p.siteWash[site.owner] || p.siteWash.neutral;
  ctx.fill();

  ctx.beginPath();
  traceSiteShape(ctx, site.kind, cx, cy, r);
  ctx.strokeStyle = p.owner[site.owner] || p.neutral;
  ctx.lineWidth = px * 2.5;
  ctx.stroke();

  // The two sites that end the battle get a second ring — you should never
  // have to hunt for the Castle or the Camp.
  if (site.kind === 'castle' || site.kind === 'camp') {
    ctx.beginPath();
    traceSiteShape(ctx, site.kind, cx, cy, r * 0.6);
    ctx.lineWidth = px * 1.5;
    ctx.stroke();
  }

  for (let i = 1; i < site.level; i++) {
    ctx.beginPath();
    ctx.arc(cx - r * 0.34 + (i - 1) * r * 0.36, cy - r - px * 5, px * 2, 0, TAU);
    ctx.fillStyle = p.gold;
    ctx.fill();
  }
}

/**
 * Structure HP ring. Drains visibly while besieged — the entire second stage
 * of a capture is legible from this one arc.
 */
export function drawHpRing(ctx, site, cx, cy, r, p, px) {
  const frac = Math.max(0, Math.min(1, site.hp / site.hpMax));
  const rad = r + px * 5;
  ctx.lineWidth = px * 3;
  ctx.lineCap = 'butt';

  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, TAU);
  ctx.strokeStyle = p.track;
  ctx.stroke();

  if (frac <= 0) return;
  ctx.beginPath();
  ctx.arc(cx, cy, rad, TOP, TOP + TAU * frac);
  // Under siege the ring turns hostile, so a draining wall is unmistakable
  // even in peripheral vision.
  ctx.strokeStyle = site.siege
    ? (frac < 0.35 ? p.danger : p.warn)
    : (p.owner[site.owner] || p.neutral);
  ctx.stroke();
}

/**
 * Siege indicator: a rotating dashed ring in the BESIEGER's colour, outside
 * the HP ring. Distinct from "damaged" — this site is actively being taken.
 */
export function drawSiegeRing(ctx, site, cx, cy, r, p, px, spin) {
  if (!site.siege) return;
  const rad = r + px * 9;
  DASH[0] = px * 3;
  DASH[1] = px * 4;
  ctx.setLineDash(DASH);
  ctx.lineDashOffset = -spin * px * 14;
  ctx.lineWidth = px * 2;
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, TAU);
  ctx.strokeStyle = p.owner[site.siege.owner] || p.enemy;
  ctx.stroke();
  ctx.setLineDash(EMPTY_DASH);
  ctx.lineDashOffset = 0;
}
const EMPTY_DASH = [];

/**
 * Training progress ring, drawn just inside the body. Amber whenever the
 * faction is browning out (`brownout < 1`) so an over-extended economy is
 * visible on the map rather than hidden in a tooltip.
 */
export function drawTrainRing(ctx, site, cx, cy, r, p, px) {
  const brownout = site.brownout ?? 1;
  const prog = site.trainProgress || 0;
  if (prog <= 0 && brownout >= 1) return;
  const rad = r * 0.78;
  ctx.lineWidth = px * 2.5;
  ctx.lineCap = 'butt';
  if (brownout < 1) {
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, TAU);
    ctx.strokeStyle = p.flood.contested;
    ctx.stroke();
  }
  if (prog <= 0) return;
  ctx.beginPath();
  ctx.arc(cx, cy, rad, TOP, TOP + TAU * Math.min(1, prog));
  ctx.strokeStyle = brownout < 1 ? p.warn : p.accent;
  ctx.stroke();
}

/**
 * The five-segment stacked garrison composition bar.
 *
 * This is the single most important element on the board. The counter triangle
 * only works if the player can see "that's a spearwall" without reading a
 * number, so every site carries one, always, no hover required. Bar LENGTH
 * encodes how full the garrison is against its cap; the SEGMENTS encode what
 * it is made of.
 *
 * @returns {number} the bar's bottom edge in world y, so callers can stack
 *                   labels beneath it without re-deriving the geometry.
 */
export function drawGarrisonBar(ctx, comp, cap, cx, cy, r, p, px, hexSize) {
  let n = 0;
  for (let i = 0; i < UNIT_IDS.length; i++) n += comp[UNIT_IDS[i]] || 0;

  const minW = hexSize * 0.78;
  const maxW = hexSize * 1.5;
  const fill = cap > 0 ? Math.min(1, n / cap) : 0;
  const w = minW + (maxW - minW) * fill;
  const hgt = Math.max(hexSize * 0.19, px * 8);
  const x0 = cx - w / 2;
  const y0 = cy + r + px * 11;

  // Opaque plate first: the bar has to read over green ground, red ground and
  // bare terrain identically.
  ctx.fillStyle = p.siteFill;
  ctx.fillRect(x0 - px * 2, y0 - px * 2, w + px * 4, hgt + px * 4);
  ctx.fillStyle = p.surface2;
  ctx.fillRect(x0 - px, y0 - px, w + px * 2, hgt + px * 2);

  if (n <= 0) {
    ctx.fillStyle = p.track;
    ctx.fillRect(x0, y0, w, hgt);
    return y0 + hgt;
  }

  let x = x0;
  for (let i = 0; i < UNIT_IDS.length; i++) {
    const u = UNIT_IDS[i];
    const c = comp[u] || 0;
    if (!c) continue;
    // Last visible segment absorbs the rounding, so the bar always ends flush.
    const seg = (c / n) * w;
    ctx.fillStyle = p.units[u];
    ctx.fillRect(x, y0, Math.max(seg, px), hgt);
    x += seg;
  }
  return y0 + hgt;
}

/** Selection halo. Deliberately the accent hue, never a faction hue. */
export function drawSelection(ctx, site, cx, cy, r, p, px, pulse) {
  ctx.beginPath();
  traceSiteShape(ctx, site.kind, cx, cy, r + px * (13 + pulse * 2));
  ctx.strokeStyle = p.selection;
  ctx.lineWidth = px * 2;
  ctx.stroke();
}

/** Hover affordance — subtler than selection, same shape language. */
export function drawHover(ctx, site, cx, cy, r, p, px) {
  ctx.beginPath();
  traceSiteShape(ctx, site.kind, cx, cy, r + px * 6);
  ctx.strokeStyle = p.selectionFill;
  ctx.lineWidth = px * 6;
  ctx.stroke();
}
