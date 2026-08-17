// Site state: what a piece looks like, and what it is doing right now.
//
// The silhouettes live in siteShapes.js; this file is the readout painted onto
// them. Four ideas carry it:
//
//   BODY = KIND.       Shape and size say farm / stronghold / camp / castle.
//   STOREYS = LEVEL.   An upgraded site is built bigger and built UP: one more
//                      storey of its own outline per level, so 400 gold spent
//                      is 400 gold visible. Never a number, never a badge —
//                      the same growth on all four kinds, so the reading
//                      transfers. While the work is in progress the new storey
//                      is dashed scaffolding and the site still produces, and
//                      reads, at its OLD level.
//   CORE = STRENGTH.   The body fills with the owner's colour in proportion to
//                      how full its garrison is, so troop mass reads as AREA
//                      before a single digit is read. A stripped site is a
//                      hollow outline; a massed one is a solid block.
//   RINGS = TROUBLE.   Wall damage and siege are the only ALARMS that draw a
//                      ring, and they always sit outside the whole structure.
//                      When every site carried a permanent ring the board was a
//                      field of identical dots and nothing could be found; now
//                      a ring means "look here".
//   GOLD = UPGRADE, ON THE STOREY ITSELF. siteGild.js strokes each built
//                      storey's own roofline gold — no ring, no orbit, nothing
//                      outside the silhouette. Absent at level 1, never an
//                      alarm hue: the gilt trim says "upgraded" on the tower.
//
// Everything draws in WORLD space and allocates nothing.
import { UNIT_IDS, SITES, SITE_LEVELS } from '../content/balance.js';
import {
  siteRadius, siteTier, traceSiteShape, traceSiteCore, hexSizeFor,
  levelScale, storeyCount, storeyScale, storeyRise, traceStructure,
  siteRingR, siteRingDy, siteFootYAt,
} from './siteShapes.js';
import { drawStoreyGild } from './siteGild.js';
import { ownerDash, NO_DASH } from './ownerDash.js';

export { SITE_R, siteRadius, traceSiteShape, siteTier, siteStackY, siteStackLen }
  from './siteShapes.js';
export { ownerDash } from './ownerDash.js';
// Cursor feedback lives in ./siteCursor.js now; re-exported so battleView and
// the fog tests keep importing it from the same front door.
export { drawSelection, drawHover } from './siteCursor.js';

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

/**
 * The level a site is actually BUILT to.
 *
 * An upgrade banks its new level the instant it is bought and then spends
 * `upgradeTicksLeft` raising it, producing at the old rate the whole time — so
 * the board must keep showing the old structure until the work lands, or the
 * player is told they got something they are not yet getting.
 *
 * Mirrors battle/state.js `effectiveLevel()` on purpose rather than importing
 * it: render reads the sim's DATA, never its code. tests/sitelevels.test.js
 * pins the two together so they cannot drift.
 */
export const builtLevel = (site) => (site.upgradeTicksLeft > 0
  ? Math.max(1, (site.level || 1) - 1)
  : (site.level || 1));

/** Garrison cap for a site at the level it is built to. Mirrors battleView's
 *  capOf; duplicated rather than passed so the core can be drawn from the site
 *  alone. */
function capOf(site) {
  const base = SITES[site.kind];
  if (!base) return 0;
  const lv = SITE_LEVELS[Math.min(SITE_LEVELS.length - 1, builtLevel(site) - 1)];
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
 * Static part of a site: moat, storeys, body, owner outline. Lives on the
 * background canvas and only redraws when ownership or level changes.
 *
 * Drawn TOP DOWN — highest storey first, ground floor last — so every block
 * knocks out the one behind it and the stack resolves as a stepped roofline
 * instead of a pile of overlapping outlines.
 */
export function drawSiteBase(ctx, site, cx, cy, r, p, px) {
  const tier = siteTier(site.kind);
  const lv = builtLevel(site);
  const R = r * levelScale(lv);
  const moat = px * (3 + tier * 2);

  // Scaffolding goes UNDER the built stone, so only the part of the new storey
  // that clears the current roofline is visible. Drawn over the body it read as
  // a dashed line ruled across the site.
  if (site.upgradeTicksLeft > 0) drawScaffold(ctx, site, cx, cy, r, p, px);

  ctx.lineJoin = 'round';
  const wash = p.siteWash[site.owner] || p.siteWash.neutral;
  const edge = p.owner[site.owner] || p.neutral;
  // Upper storeys are outlined a touch thinner than the ground floor, which is
  // what makes the stack read as receding rather than as one flat cluster.
  // Each one also gets its own gilt trim, right after its own outline: the
  // gold has to seat on THAT storey, not on the ground floor underneath it.
  for (let i = storeyCount(lv) - 1; i >= 0; i--) {
    const cyi = cy - R * storeyRise(i);
    const ri = R * storeyScale(i);
    block(ctx, site.kind, true, cx, cyi, ri, p, wash, edge, px * (1.3 + tier * 0.75), moat,
      site.owner);
    drawStoreyGild(ctx, site.kind, cx, cyi, ri, i, p, px);
  }
  // Outline weight IS the hierarchy: a farm is hairline, a home base is bold.
  block(ctx, site.kind, false, cx, cy, R, p, wash, edge, px * (1.7 + tier * 1.15), moat,
    site.owner);
}

/**
 * One block of a structure: its own moat, the territory flood knocked out
 * beneath it, an owner wash, an outline.
 *
 * The moat is per block rather than one pass under the whole silhouette, and
 * that is what makes a stack read as stepped: the ground floor's moat lands ON
 * the storey behind it, so every step is separated by a dark band instead of
 * two outlines meeting and fusing into one blob.
 */
function block(ctx, kind, upper, cx, cy, r, p, wash, edge, lw, moat, owner) {
  const trace = upper ? traceSiteCore : traceSiteShape;
  // The cheapest way to make a piece sit ON the board rather than be a patch OF
  // it — and it gives every adjacency line a visible place to stop instead of
  // dissolving into the site.
  ctx.beginPath();
  trace(ctx, kind, cx, cy, r + moat);
  ctx.fillStyle = p.siteShadow;
  ctx.fill();

  ctx.beginPath();
  trace(ctx, kind, cx, cy, r);
  ctx.fillStyle = p.siteFill;
  ctx.fill();
  // An owner wash inside the body so ownership survives at low zoom, where a
  // 2px outline stops being legible.
  ctx.fillStyle = wash;
  ctx.fill();
  ctx.strokeStyle = edge;
  ctx.lineWidth = lw;
  // The second ownership channel — see ./ownerDash.js. Always restored: a dash
  // left on the context leaks into every site that strokes after this one.
  ctx.setLineDash(ownerDash(owner, lw));
  ctx.stroke();
  ctx.setLineDash(NO_DASH);
}

/**
 * Work in progress: the storey being raised, as a dashed ghost of itself.
 *
 * `site.level` is already the level being PAID for; `builtLevel()` is what the
 * site actually is. Drawing the gap between them as scaffolding is what makes
 * "I bought it and nothing happened" impossible — the new floor is visibly
 * pegged out before it is built, in the accent hue this renderer already uses
 * everywhere else for work in progress.
 */
function drawScaffold(ctx, site, cx, cy, r, p, px) {
  const i = storeyCount(site.level) - 1;
  if (i < 0) return;
  const R = r * levelScale(site.level);
  DASH[0] = px * 4;
  DASH[1] = px * 3.5;
  ctx.setLineDash(DASH);
  ctx.beginPath();
  traceSiteCore(ctx, site.kind, cx, cy - R * storeyRise(i), R * storeyScale(i));
  ctx.strokeStyle = p.building;
  ctx.lineWidth = px * 2;
  ctx.stroke();
  ctx.setLineDash(EMPTY_DASH);
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
    // Against the SCALED body, so a full garrison in an upgraded site fills the
    // bigger silhouette rather than rattling around inside it.
    traceSiteCore(ctx, site.kind, cx, cy, r * levelScale(builtLevel(site)) * k);
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
  // The plaque is pinned to the BASE radius, never the level-scaled one: the
  // structure grows upward and the number under it must not walk down the board
  // every time a site is upgraded. The tether simply gets shorter.
  const top = plaqueTopY(cy, r, px, hexSizeFor(site.kind, r));
  const y0 = cy + r * siteFootYAt(site.kind, builtLevel(site));
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
  const y = cy + r * siteFootYAt(site.kind, builtLevel(site)) + px * 2;
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
  const lv = builtLevel(site);
  // Centred on the STRUCTURE, not the site: a tall level-3 keep is not centred
  // on its own hex, and a ring that ignored that would hang off it.
  const my = cy - r * siteRingDy(site.kind, lv);
  const rad = r * siteRingR(site.kind, lv) + px * 3;
  ctx.lineWidth = px * 3.5;
  ctx.lineCap = 'butt';

  ctx.beginPath();
  ctx.arc(cx, my, rad, 0, TAU);
  ctx.strokeStyle = p.wall;
  ctx.stroke();

  if (frac <= 0) return;
  ctx.beginPath();
  ctx.arc(cx, my, rad, TOP, TOP + TAU * frac);
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
  const lv = builtLevel(site);
  const rad = r * siteRingR(site.kind, lv) + px * 9;
  DASH[0] = px * 3;
  DASH[1] = px * 4;
  ctx.setLineDash(DASH);
  ctx.lineDashOffset = -spin * px * 14;
  ctx.lineWidth = px * 2;
  ctx.beginPath();
  ctx.arc(cx, cy - r * siteRingDy(site.kind, lv), rad, 0, TAU);
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
