// Site silhouettes.
//
// THE RULE: SITE KIND IS SHAPE AND SIZE, OWNERSHIP IS COLOUR. Kind must be
// readable in a black-and-white print of the board, which is why nothing here
// touches a hue — and why the five shapes are chosen to differ in the two
// things the eye resolves first at 20px: OUTLINE PROFILE and AREA.
//
//   farm           small circle        round, passive, the low tier
//   trainingGround low gabled hut      a plain barracks — soft, unfortified
//   stronghold     shield              flat top, pointed foot — a military post
//   camp           peaked tent         the player's home: canvas, temporary
//   castle         crenellated keep    the enemy's home and the whole objective
//
// trainingGround is the barracks half of what used to be one building
// (content/balance.js): a plain single-peak roof over short walls, squatter
// than either shield or tent, with no taper, pennant or comb to borrow.
//
// Camp and castle are a matched pair — both twice a farm's radius, four times
// its area — because "take the castle, don't lose the camp" is the entire
// win condition and both ends of it should be findable without searching.
//
// Every outline is a static flat [x,y,...] array in unit space, traced with a
// plain loop. Nothing here allocates.

const TAU = Math.PI * 2;

/** A low gabled hut: short walls, one shallow roof-peak, no taper or comb —
 *  noticeably squatter than SHIELD or TENT_BODY, so it reads as the lesser,
 *  softer building next to the wall it used to be part of. */
const BARRACKS = new Float64Array([
  -0.95, 0.88, -0.95, 0.42, -0.40, -0.30, 0, -0.62, 0.40, -0.30, 0.95, 0.42, 0.95, 0.88,
]);

/** Flat top, straight shoulders, tapered foot. */
const SHIELD = new Float64Array([
  -0.86, -0.92, 0.86, -0.92, 0.86, 0.02, 0.62, 0.55, 0, 0.95, -0.62, 0.55, -0.86, 0.02,
]);

/**
 * A flared tent flying a pennant. The banner is not decoration: a bare peaked
 * triangle is the same glyph routes.js flies at every travelling squad, and on
 * a board where troops are constantly in motion the player's HOME must not be
 * confusable with a stack passing through.
 */
const TENT = new Float64Array([
  -0.98, 0.9, -0.98, 0.72, -0.34, -0.18, -0.07, -0.95, -0.07, -1.34,
  0.64, -1.12, 0.07, -0.89, 0.07, -0.95, 0.34, -0.18, 0.98, 0.72, 0.98, 0.9,
]);

/** The tent minus its pennant. The garrison core is a scaled copy of the body,
 *  and a flag nested inside a flag is just clutter. */
const TENT_BODY = new Float64Array([
  -0.98, 0.9, -0.98, 0.72, -0.34, -0.18, 0, -0.95, 0.34, -0.18, 0.98, 0.72, 0.98, 0.9,
]);

/** Curtain wall under a comb of five merlons, the outer two raised into
 *  corner towers. The comb is the whole trick: no other shape on the board has
 *  a broken top edge, so a castle is identifiable from its skyline alone. */
const KEEP = new Float64Array([
  -1, 0.88, -1, -0.95, -0.72, -0.95, -0.72, -0.46,
  -0.57, -0.46, -0.57, -0.78, -0.29, -0.78, -0.29, -0.46,
  -0.14, -0.46, -0.14, -0.78, 0.14, -0.78, 0.14, -0.46,
  0.29, -0.46, 0.29, -0.78, 0.57, -0.78, 0.57, -0.46,
  0.72, -0.46, 0.72, -0.95, 1, -0.95, 1, 0.88,
]);

/**
 * A slender lookout spire: a narrow shaft, a small flared platform, and a
 * peaked cap — the only silhouette on the board taller than it is wide at
 * this radius (see SITE_R below), which is the point: it is the smallest,
 * cheapest thing on the build menu and the only one that sees past its own
 * doorstep.
 */
const SPIRE = new Float64Array([
  -0.30, 0.92, -0.30, -0.35, -0.55, -0.35, -0.55, -0.55,
  0, -0.98, 0.55, -0.55, 0.55, -0.35, 0.30, -0.35, 0.30, 0.92,
]);

export const SHAPES = {
  trainingGround: BARRACKS, stronghold: SHIELD, camp: TENT, castle: KEEP, watchtower: SPIRE,
};
/** Where the garrison core uses a simpler outline than the body. */
const CORE_SHAPES = { camp: TENT_BODY };

/** Vertex indices `from..to` inclusive, as a plain array — the run castle's
 *  comb needs, spelled out without a 20-entry literal. */
const run = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/**
 * The sub-chain of each kind's own CORE outline picked out as its "gilded
 * trim" once a site is upgraded — both roof slopes of a training ground's
 * hut or a tent meeting at the peak, both shoulders and the flat top of a
 * shield, the whole crenellated comb of a keep. Each is a vertex-index PATH
 * (not necessarily ascending — a shield's trim wraps shoulder -> top ->
 * shoulder) into the SAME point array a storey is traced from (see
 * coreShapeOf), so the gold can never land anywhere the silhouette itself
 * does not already reach.
 *
 * A farm has no polygon to slice, so it is absent here on purpose — siteGild.js
 * gives it a cap arc across the top of the disc instead. Actually drawing the
 * trim lives there too: it is a FILLED ribbon, not a stroke, so it can never
 * be mistaken for another storey by tests/sitelevels.test.js, which counts
 * storeys off stroked outlines.
 */
export const TRIM_PATH = {
  trainingGround: [2, 3, 4], // both roof slopes, corner to peak to corner
  stronghold: [6, 0, 1, 2],  // left shoulder -> flat top -> right shoulder
  camp: [2, 3, 4],           // both roof slopes, corner to peak to corner
  castle: run(1, 18),        // the entire battlement top, towers and merlons
  watchtower: [2, 3, 4, 5, 6], // the lookout platform and its peaked cap
};

/** The point array a storey — and therefore its trim — is traced from. */
export const coreShapeOf = (kind) => CORE_SHAPES[kind] || SHAPES[kind];

/**
 * Body radius as a fraction of the hex circumradius.
 *
 * The spread is deliberately wide. The old set ran 0.46 -> 0.62, which is
 * inside the noise floor at real zoom: every site looked like the same dot.
 */
export const SITE_R = {
  farm: 0.38, trainingGround: 0.46, stronghold: 0.54, camp: 0.74, castle: 0.78,
  // The smallest footprint on the board — cap 15 is the smallest in SITES too
  // (content/balance.js) — so its FOOTPRINT reads as minor even though its
  // outline (above) is deliberately the tallest.
  watchtower: 0.34,
};

/**
 * Attention tier — how heavily a kind is outlined. 0 ambient, 2 objective.
 * trainingGround joins stronghold at 1: a real martial site with a garrison,
 * not passive income — shape and SITE_R already say "softer than a
 * stronghold", so tier only has to say "still matters, unlike a farm".
 */
// watchtower joins farm at 0: it produces nothing and defends barely more than
// bare ground, so it does not earn the outline weight of a real martial site
// — the shape and radius above already say "small and strange", tier only has
// to say "not a fight".
export const SITE_TIER = {
  farm: 0, trainingGround: 1, stronghold: 1, camp: 2, castle: 2, watchtower: 0,
};

export const siteRadius = (kind, hexSize) => (SITE_R[kind] ?? 0.5) * hexSize;
export const siteTier = (kind) => SITE_TIER[kind] ?? 0;
/** Inverse of siteRadius. The per-frame passes are handed a radius but some of
 *  their geometry is pinned to hex scale; this recovers it exactly rather than
 *  threading another argument through every call site. */
export const hexSizeFor = (kind, r) => r / (SITE_R[kind] ?? 0.5);

/**
 * Append a site body outline to the current path — lets a caller batch every
 * site of one owner into a single fill, and lets the same call draw the body,
 * the garrison core inside it and the selection halo outside it.
 */
export function traceSiteShape(ctx, kind, cx, cy, r) {
  trace(ctx, SHAPES[kind], cx, cy, r);
}

/** The garrison core's outline — the body, minus anything that only makes
 *  sense at full size. */
export function traceSiteCore(ctx, kind, cx, cy, r) {
  trace(ctx, coreShapeOf(kind), cx, cy, r);
}

/** Exported for ./siteLevels.js, which traces the same outlines at a stacked
 *  set of storeys — one tracer, so a storey can never disagree with the body
 *  it was cut from. */
export function trace(ctx, pts, cx, cy, r) {
  if (!pts) {
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, TAU);
    return;
  }
  ctx.moveTo(cx + pts[0] * r, cy + pts[1] * r);
  for (let i = 2; i < pts.length; i += 2) {
    ctx.lineTo(cx + pts[i] * r, cy + pts[i + 1] * r);
  }
  ctx.closePath();
}

/**
 * Extents in units of r, measured once per kind and cached.
 *
 * `foot` is how far the body reaches below its centre — the training bar and
 * the plaque hang off THAT, not off r, so a tent's flat base and a shield's
 * point sit the same distance from their labels. `outer` is the circumradius,
 * and every arc the renderer draws is placed outside it, which is the rule
 * that stops a wall ring from slicing through a castle's corner towers.
 */
const EXTENTS = {};
function extentsOf(kind) {
  let e = EXTENTS[kind];
  if (e) return e;
  const pts = SHAPES[kind];
  e = { foot: 1, head: 1, outer: 1 };
  if (pts) {
    e.foot = 0; e.head = 0; e.outer = 0;
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i];
      const y = pts[i + 1];
      if (y > e.foot) e.foot = y;
      if (-y > e.head) e.head = -y;
      const d = Math.sqrt(x * x + y * y);
      if (d > e.outer) e.outer = d;
    }
  }
  EXTENTS[kind] = e;
  return e;
}

export const siteFootY = (kind) => extentsOf(kind).foot;
export const siteHeadY = (kind) => extentsOf(kind).head;
export const siteOuter = (kind) => extentsOf(kind).outer;

// LEVEL IS MASS: the storey ladder, the ring geometry it drives, and the
// extents a leveled structure occupies live in ./siteLevels.js now, split out
// for the line budget. Re-exported here so this file stays the one front
// door — every existing `import { levelScale } from '../render/siteShapes.js'`
// (siteGlyphs.js, siteGild.js, battleView.js, and the site-level tests) keeps
// resolving without knowing the split happened.
export {
  MAX_LEVEL, LEVEL_SCALE, levelRamp, storeyLadder, levelScale, storeyCount,
  storeyScale, storeyRise, traceStructure, siteRingR, siteRingDy,
  siteFootYAt, siteHeadYAt,
} from './siteLevels.js';
