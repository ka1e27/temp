// What the CURSOR says about a site, as opposed to what the site says about
// itself. Split out of siteGlyphs.js at the 400-line cap and re-exported from
// there, the same way siteShapes, siteGild and ownerDash are.
//
// The seam is a real one rather than a convenient cut: everything in
// siteGlyphs is a readout of simulation state — who holds this, how full it is,
// whether it is under siege. These two are feedback about the POINTER, owned by
// the view and present on no other client's screen. They also both deliberately
// use the accent hue rather than a faction one, for a reason worth keeping
// together with them: a selection ring in the player's own green would read as
// ownership, and the one thing a halo must not do is claim territory.
import { traceStructure } from './siteShapes.js';
import { builtLevel } from './siteGlyphs.js';

/** Selection halo. Deliberately the accent hue, never a faction hue. */
export function drawSelection(ctx, site, cx, cy, r, p, px, pulse) {
  ctx.beginPath();
  traceStructure(ctx, site.kind, builtLevel(site), cx, cy, r, px * (7 + pulse * 2.5));
  ctx.strokeStyle = p.selection;
  ctx.lineWidth = px * 2;
  ctx.stroke();
}

/** Hover affordance — subtler than selection, same shape language. */
export function drawHover(ctx, site, cx, cy, r, p, px) {
  ctx.beginPath();
  traceStructure(ctx, site.kind, builtLevel(site), cx, cy, r, px * 4);
  ctx.strokeStyle = p.hover || p.selectionFill;
  ctx.lineWidth = px * 6;
  ctx.stroke();
}
