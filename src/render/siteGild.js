// GILDING: how a site shows exactly how far it has been upgraded.
//
// This used to be a gold ring orbiting outside the silhouette, cut into one
// cell per upgrade step. Direct feedback: it read as jewellery, not as the
// tower having been upgraded. So the ring is gone, and in its place every
// STOREY the site has actually built (see siteShapes.js / siteGlyphs.js) gets
// a seam of gold FILLED along its own roofline — the flat top and shoulders
// of a shield, the roof slopes of a tent, the whole battlement comb of a
// keep, a cap arc on a farm. The gold is drawn AFTER that storey's
// owner-coloured outline and only along that one sub-path, so the rest of
// the storey's edge is still exactly the owner's colour: this is trim, not a
// recolour.
//
// FILLED, never stroked — same discipline the old ring followed and for the
// same reason: tests/sitelevels.test.js counts a site's storeys off stroked
// outlines, so a trim that stroked would silently pass itself off as another
// floor the moment a site was upgraded.
//
// This is why the whole old counting apparatus — hasRank/rankCells/rankBand —
// is gone with the ring: a site with N storeys built simply HAS N gilded
// roofs, for free, off the same storeyCount() the stacking already uses. Zero
// extra bookkeeping, and level 1 (storeyCount 0) draws nothing, automatically.
//
// The one thing kept from the ring: the ramp. A storey's gold still warms
// toward ivory the further up the (fixed-length) ladder it sits, so a maxed
// site's upper storeys read hotter than its lower ones — "closer to maxed
// reads as heat" survives, just painted onto stone instead of a hoop.
import { RANK_STEPS } from './palette.js';
import { MAX_LEVEL, TRIM_PATH, coreShapeOf } from './siteShapes.js';

/**
 * Append a kind's gilded trim to the current path as a FILLED ribbon — never
 * a stroke; see TRIM_PATH in siteShapes.js for why.
 *
 * A polygon kind's trim is a chain of quads, one per edge of its own vertex
 * path, each half `halfW` wide either side of the edge. A farm has no
 * polygon, so it gets an annular cap instead: the same two-arc sector the old
 * rank ring filled, just over the top quarter of the disc rather than the
 * whole circle.
 */
export function traceTrimRibbon(ctx, kind, cx, cy, r, halfW) {
  const idx = TRIM_PATH[kind];
  if (!idx) {
    sector(ctx, cx, cy, r - halfW, r + halfW, -Math.PI * 0.75, -Math.PI * 0.25);
    return;
  }
  const pts = coreShapeOf(kind);
  for (let k = 0; k < idx.length - 1; k++) {
    const x0 = cx + pts[idx[k] * 2] * r;
    const y0 = cy + pts[idx[k] * 2 + 1] * r;
    const x1 = cx + pts[idx[k + 1] * 2] * r;
    const y1 = cy + pts[idx[k + 1] * 2 + 1] * r;
    quad(ctx, x0, y0, x1, y1, halfW);
  }
}

/** One rectangle, `halfW` either side of a segment — a subpath appended to
 *  whatever is already on the path, so a whole ribbon fills in one call. */
function quad(ctx, x0, y0, x1, y1, halfW) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * halfW;
  const ny = (dx / len) * halfW;
  ctx.moveTo(x0 + nx, y0 + ny);
  ctx.lineTo(x1 + nx, y1 + ny);
  ctx.lineTo(x1 - nx, y1 - ny);
  ctx.lineTo(x0 - nx, y0 - ny);
  ctx.closePath();
}

/** One annular sector, out along r1 and back along r0 — a subpath appended
 *  to whatever is already on the path, exactly like the old rank ring's. */
function sector(ctx, cx, cy, r0, r1, a0, a1) {
  ctx.moveTo(cx + r1 * Math.cos(a0), cy + r1 * Math.sin(a0));
  ctx.arc(cx, cy, r1, a0, a1);
  ctx.arc(cx, cy, r0, a1, a0, true);
  ctx.closePath();
}

/**
 * Which of the RANK_STEPS gold tones storey `i` (of `total` possible, never
 * a literal — `total` defaults to the real ladder length) is painted in.
 *
 * Position is fixed by the storey's OWN index, not by how upgraded the site
 * is right now: a site's first storey is always the same shade wherever the
 * ladder currently tops out, so buying the next level warms only the new
 * storey rather than repainting the ones underneath it.
 */
export function goldStep(i, total = MAX_LEVEL - 1) {
  if (total <= 1) return RANK_STEPS - 1;
  return Math.round((i / (total - 1)) * (RANK_STEPS - 1));
}

/**
 * Fill storey `i`'s own trim ribbon in the gold that step earns.
 *
 * Lives on the BACKGROUND canvas alongside the rest of the storey it
 * decorates, so it costs nothing per frame and repaints only when a level
 * changes — same discipline the ring it replaced followed.
 *
 * @param {number} i     storey index (0 = first storey above the ground floor)
 * @param {number} total storeys the ladder can ever have; a test parameter,
 *                       real callers never pass it
 */
export function drawStoreyGild(ctx, kind, cx, cy, r, i, p, px, total = MAX_LEVEL - 1) {
  ctx.beginPath();
  traceTrimRibbon(ctx, kind, cx, cy, r, px * 1.4);
  ctx.fillStyle = p.rank[goldStep(i, total)];
  ctx.fill();
}
