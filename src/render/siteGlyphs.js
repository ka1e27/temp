// Site state: what a piece looks like, and what it is doing right now.
//
// The silhouettes live in siteShapes.js; this file is the readout painted onto
// them. Three ideas carry it:
//
//   BODY = KIND.       Shape and size say farm / stronghold / camp / castle.
//   CORE = STRENGTH.   The body fills with the owner's colour in proportion to
//                      how full its garrison is, so troop mass reads as AREA
//                      before a single digit is read. A stripped site is a
//                      hollow outline; a massed one is a solid block.
//   RINGS = TROUBLE.   Wall damage and siege are the ONLY things that draw a
//                      ring, and they always sit outside the silhouette's
//                      circumradius. When every site carried a permanent ring
//                      the board was a field of identical dots and nothing
//                      could be found; now a ring means "look here".
//
// Everything draws in WORLD space and allocates nothing.
import { UNIT_IDS, SITES, SITE_LEVELS } from '../content/balance.js';
import {
  siteRadius, siteTier, traceSiteShape, traceSiteCore, siteFootY, siteHeadY,
  siteOuter, hexSizeFor,
} from './siteShapes.js';

export { SITE_R, siteRadius, traceSiteShape, siteTier } from './siteShapes.js';

const TAU = Math.PI * 2;
const TOP = -Math.PI / 2;
const DASH = [0, 0];
const EMPTY_DASH = [];

/** Largest share of the body the garrison core may fill. The gap left over is
 *  what keeps the owner outline — and therefore the silhouette — readable even
 *  on a site sitting at its cap. */
const CORE_MAX = 0.82;
/** Floor under the core so that ONE surviving defender is still visible. */
const CORE_MIN = 0.3;

/** Garrison cap for a site at its current level. Mirrors battleView's capOf;
 *  duplicated rather than passed so the core can be drawn from the site alone. */
function capOf(site) {
  const base = SITES[site.kind];
  if (!base) return 0;
  const lv = SITE_LEVELS[Math.min(SITE_LEVELS.length - 1, (site.level || 1) - 1)];
  return base.cap + (lv ? lv.cap : 0);
}

function troopCount(comp) {
  let n = 0;
  for (let i = 0; i < UNIT_IDS.length; i++) n += comp[UNIT_IDS[i]] || 0;
  return n;
}

/** How far under a site centre the garrison number's top edge sits. ONE
 *  expression, so the plate, the tether and the digits cannot drift apart. */
const labelDrop = (r, px, hexSize) => r + px * 15 + Math.max(hexSize * 0.19, px * 8);

/**
 * World-space y offset of the TOP of the garrison number, from the site
 * centre. battleView currently inlines this expression; exported so that call
 * site can point here instead and the two can never disagree.
 */
export function garrisonLabelY(kind, hexSize, px) {
  return labelDrop(siteRadius(kind, hexSize), px, hexSize);
}

/** Top edge of the plaque, in world y. */
export const plaqueTopY = (cy, r, px, hexSize) =>
  cy + labelDrop(r, px, hexSize) - px * 4.5;

/**
 * Static part of a site: moat, body, owner outline, level pips. Lives on the
 * background canvas and only redraws when ownership or level changes.
 */
export function drawSiteBase(ctx, site, cx, cy, r, p, px) {
  const tier = siteTier(site.kind);

  // A dark moat under the body. The cheapest way to make a piece sit ON the
  // board rather than be a patch OF it — and it gives every adjacency line a
  // visible place to stop instead of dissolving into the site.
  ctx.beginPath();
  traceSiteShape(ctx, site.kind, cx, cy, r + px * (3 + tier * 2));
  ctx.fillStyle = p.siteShadow;
  ctx.fill();

  // Knock the territory flood out beneath the body: a site is an object ON the
  // terrain, not a tinted patch of it, and that separation is what lets the
  // core and the plaque stay readable over any colour of ground.
  ctx.beginPath();
  traceSiteShape(ctx, site.kind, cx, cy, r);
  ctx.fillStyle = p.siteFill;
  ctx.fill();
  // An owner wash inside the body so ownership survives at low zoom, where a
  // 2px outline stops being legible.
  ctx.fillStyle = p.siteWash[site.owner] || p.siteWash.neutral;
  ctx.fill();

  // Outline weight IS the hierarchy: a farm is hairline, a home base is bold.
  ctx.lineJoin = 'round';
  ctx.strokeStyle = p.owner[site.owner] || p.neutral;
  ctx.lineWidth = px * (1.7 + tier * 1.15);
  ctx.stroke();

  drawLevelPips(ctx, site, cx, cy, r, p, px);
}

/** In-battle upgrades, as gold rank bars above the body. */
function drawLevelPips(ctx, site, cx, cy, r, p, px) {
  const n = (site.level || 1) - 1;
  if (n <= 0) return;
  const w = px * 6;
  const gap = px * 3;
  let x = cx - (n * w + (n - 1) * gap) * 0.5;
  const y = cy - r * siteHeadY(site.kind) - px * 15;
  ctx.fillStyle = p.gold;
  for (let i = 0; i < n; i++) {
    ctx.fillRect(x, y, w, px * 2.5);
    x += w + gap;
  }
}

/**
 * Everything about a site that changes tick to tick and lives INSIDE its
 * footprint: the garrison core, the tether down to its plaque, and the
 * training crossbar riding that tether.
 *
 * Exported as `drawTrainRing` too, because that is what battleView calls it
 * today; the ring became a bar when the bodies stopped being circles.
 */
export function drawSiteState(ctx, site, cx, cy, r, p, px) {
  const n = troopCount(site.garrison);
  const cap = capOf(site);
  if (n > 0) {
    const f = cap > 0 ? Math.min(1, n / cap) : 1;
    const k = CORE_MAX * (CORE_MIN + (1 - CORE_MIN) * Math.sqrt(f));
    ctx.beginPath();
    traceSiteCore(ctx, site.kind, cx, cy, r * k);
    ctx.fillStyle = p.core[site.owner] || p.core.neutral;
    ctx.fill();
    ctx.strokeStyle = p.coreEdge[site.owner] || p.coreEdge.neutral;
    ctx.lineWidth = px;
    ctx.stroke();
  }
  drawTether(ctx, site, cx, cy, r, p, px);
  drawTrainBar(ctx, site, cx, cy, r, p, px);
}
/** @see drawSiteState — the name battleView currently imports. */
export const drawTrainRing = drawSiteState;

/**
 * The line that pins a garrison plaque to its site.
 *
 * It is drawn in the OWNER'S colour on purpose. An earlier pass filled the gap
 * with a dark plinth, which tied the plaque down but parked a black wedge the
 * size of a farm under every single site; a coloured hairline does the same
 * job with colour identity instead of mass.
 */
function drawTether(ctx, site, cx, cy, r, p, px) {
  const top = plaqueTopY(cy, r, px, hexSizeFor(site.kind, r));
  const y0 = cy + r * siteFootY(site.kind);
  if (top <= y0) return;
  ctx.fillStyle = p.core[site.owner] || p.core.neutral;
  ctx.fillRect(cx - px, y0, px * 2, top - y0 + px * 2);
}

/**
 * Training progress, as a crossbar riding the tether just under the body.
 * Amber whenever the faction is browning out (`brownout < 1`), so an
 * over-extended economy is visible on the map rather than hidden in a tooltip.
 *
 * On the tether rather than free-floating: a bar with its own patch of empty
 * board around it reads as an unrelated third object, and nearly every site
 * that is not a farm carries one.
 */
function drawTrainBar(ctx, site, cx, cy, r, p, px) {
  const brownout = site.brownout ?? 1;
  const prog = site.trainProgress || 0;
  if (prog <= 0 && brownout >= 1) return;
  const w = r * 0.85;
  const h = px * 2.5;
  const y = cy + r * siteFootY(site.kind) + px * 2;
  ctx.fillStyle = p.track;
  ctx.fillRect(cx - w * 0.5, y, w, h);
  if (prog <= 0) return;
  ctx.fillStyle = brownout < 1 ? p.warn : p.train;
  ctx.fillRect(cx - w * 0.5, y, w * Math.min(1, prog), h);
}

/**
 * Structure HP, as an arc outside the silhouette — and ONLY when the walls are
 * actually hurt or under attack. A site at full strength draws nothing, which
 * is the entire reason the board now has somewhere for the eye to go.
 */
export function drawHpRing(ctx, site, cx, cy, r, p, px) {
  const frac = Math.max(0, Math.min(1, site.hp / site.hpMax));
  if (frac >= 0.999 && !site.siege) return;
  const rad = r * siteOuter(site.kind) + px * 3;
  ctx.lineWidth = px * 3.5;
  ctx.lineCap = 'butt';

  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, TAU);
  ctx.strokeStyle = p.wall;
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
 * the wall ring. Distinct from "damaged" — this site is actively being taken.
 */
export function drawSiegeRing(ctx, site, cx, cy, r, p, px, spin) {
  if (!site.siege) return;
  const rad = r * siteOuter(site.kind) + px * 9;
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

/**
 * The garrison plaque: an opaque plate hung off the site's tether, tab
 * upward, so the number BELONGS to the site instead of floating near it.
 * battleView writes the digits into the middle in its one text pass, and the
 * plate is what makes them read identically over green ground, red ground and
 * bare rock.
 *
 * Composition is demoted to a hairline ribbon along the bottom edge. It used
 * to be a five-segment bar the same size as everything else on the board,
 * which at real zoom was indistinguishable from noise — and the moving troops
 * now carry unit colour anyway.
 *
 * `cap` is unused: fullness moved to the garrison core, where it reads as area
 * instead of as a second bar. The parameter stays for battleView's call.
 * @returns {number} the plaque's bottom edge in world y.
 */
export function drawGarrisonPlaque(ctx, comp, cap, cx, cy, r, p, px, hexSize) {
  const top = plaqueTopY(cy, r, px, hexSize);
  const h = px * 17;
  const w = px * 33 + r * 0.28;
  const x0 = cx - w * 0.5;
  const tab = px * 5;
  // A chip with a tab pointing back up the tether, so the plate reads as a
  // sign hung off the site rather than a label lying on the ground next to it.
  ctx.beginPath();
  ctx.moveTo(x0, top);
  ctx.lineTo(cx - tab, top);
  ctx.lineTo(cx, top - px * 5);
  ctx.lineTo(cx + tab, top);
  ctx.lineTo(x0 + w, top);
  ctx.lineTo(x0 + w, top + h);
  ctx.lineTo(x0, top + h);
  ctx.closePath();
  ctx.fillStyle = p.plaque;
  ctx.fill();
  ctx.strokeStyle = p.plaqueEdge;
  ctx.lineWidth = px;
  ctx.stroke();

  drawCompRibbon(ctx, comp, x0 + px * 4, top + h - px * 3.2, w - px * 8, px * 2, p, px);
  return top + h;
}
/** @see drawGarrisonPlaque — the name battleView currently imports. */
export const drawGarrisonBar = drawGarrisonPlaque;

/** Five-segment composition strip: secondary information, drawn like it. */
function drawCompRibbon(ctx, comp, x0, y, w, h, p, px) {
  const n = troopCount(comp);
  if (n <= 0) {
    ctx.fillStyle = p.track;
    ctx.fillRect(x0, y, w, h);
    return;
  }
  let x = x0;
  for (let i = 0; i < UNIT_IDS.length; i++) {
    const u = UNIT_IDS[i];
    const c = comp[u] || 0;
    if (!c) continue;
    // Last visible segment absorbs the rounding, so the strip ends flush.
    const seg = (c / n) * w;
    ctx.fillStyle = p.unitsDim ? p.unitsDim[u] : p.units[u];
    ctx.fillRect(x, y, Math.max(seg, px), h);
    x += seg;
  }
}

/** Selection halo. Deliberately the accent hue, never a faction hue. */
export function drawSelection(ctx, site, cx, cy, r, p, px, pulse) {
  ctx.beginPath();
  traceSiteShape(ctx, site.kind, cx, cy, r + px * (7 + pulse * 2.5));
  ctx.strokeStyle = p.selection;
  ctx.lineWidth = px * 2;
  ctx.stroke();
}

/** Hover affordance — subtler than selection, same shape language. */
export function drawHover(ctx, site, cx, cy, r, p, px) {
  ctx.beginPath();
  traceSiteShape(ctx, site.kind, cx, cy, r + px * 4);
  ctx.strokeStyle = p.hover || p.selectionFill;
  ctx.lineWidth = px * 6;
  ctx.stroke();
}
