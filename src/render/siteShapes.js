// Site silhouettes.
//
// THE RULE: SITE KIND IS SHAPE AND SIZE, OWNERSHIP IS COLOUR. Kind must be
// readable in a black-and-white print of the board, which is why nothing here
// touches a hue — and why the four shapes are chosen to differ in the two
// things the eye resolves first at 20px: OUTLINE PROFILE and AREA.
//
//   farm       small circle        round, passive, the low tier
//   stronghold shield              flat top, pointed foot — a military post
//   camp       peaked tent         the player's home: canvas, temporary
//   castle     crenellated keep    the enemy's home and the whole objective
//
// Camp and castle are a matched pair — both twice a farm's radius, four times
// its area — because "take the castle, don't lose the camp" is the entire
// win condition and both ends of it should be findable without searching.
//
// Every outline is a static flat [x,y,...] array in unit space, traced with a
// plain loop. Nothing here allocates.

const TAU = Math.PI * 2;

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

const SHAPES = { stronghold: SHIELD, camp: TENT, castle: KEEP };
/** Where the garrison core uses a simpler outline than the body. */
const CORE_SHAPES = { camp: TENT_BODY };

/**
 * Body radius as a fraction of the hex circumradius.
 *
 * The spread is deliberately wide. The old set ran 0.46 -> 0.62, which is
 * inside the noise floor at real zoom: every site looked like the same dot.
 */
export const SITE_R = { farm: 0.38, stronghold: 0.54, camp: 0.74, castle: 0.78 };

/** Attention tier — how heavily a kind is outlined. 0 ambient, 2 objective. */
export const SITE_TIER = { farm: 0, stronghold: 1, camp: 2, castle: 2 };

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
  trace(ctx, CORE_SHAPES[kind] || SHAPES[kind], cx, cy, r);
}

function trace(ctx, pts, cx, cy, r) {
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

// --- levels ------------------------------------------------------------------
//
// LEVEL IS MASS, AND IT IS THE SAME MOVE ON ALL FOUR KINDS: the site is built
// BIGGER and built UP. The body swells a little, and each level stacks one more
// STOREY behind it — a smaller copy of that kind's OWN outline, sunk into the
// body so only its top clears the roofline.
//
// Reusing the kind's own outline is what keeps invariant 1 of this file intact.
// Nothing is bolted on that the shape did not already say, so a level-3 shield
// is still unmistakably a shield (three shields, in fact), a level-3 tent is a
// bigger camp of tents, and a level-3 farm is a stack of silos. Kind still
// resolves first; level resolves second, from height and bulk.
//
// The wall and siege rings are circles drawn outside the whole thing, so growth
// has to stay measurable — see siteRingR().

/** Whole-structure scale by level. Modest: the storeys are the loud cue and
 *  this is the supporting one, and a farm that outgrows a stronghold would
 *  break the size ordering that tells the two apart. */
export const LEVEL_SCALE = new Float64Array([1, 1.16, 1.34]);
export const MAX_LEVEL = LEVEL_SCALE.length;

/** Storey i (added by level i+2): radius and how far it is lifted, both in
 *  units of the SCALED body radius. Each storey's own foot sits below the body's
 *  top edge, so the stack is a stepped tower and never a floating pile. */
const STOREY_S = new Float64Array([0.80, 0.54]);
const STOREY_Y = new Float64Array([0.58, 1.14]);

const lvIndex = (level) => {
  const n = ((level | 0) || 1) - 1;
  return n < 0 ? 0 : (n > MAX_LEVEL - 1 ? MAX_LEVEL - 1 : n);
};

export const levelScale = (level) => LEVEL_SCALE[lvIndex(level)];
/** Storeys above the body: 0 at L1, 1 at L2, 2 at L3. */
export const storeyCount = (level) => lvIndex(level);
export const storeyScale = (i) => STOREY_S[i];
export const storeyRise = (i) => STOREY_Y[i];

/**
 * Append the WHOLE structure — body plus every storey — to the current path,
 * each block expanded by `grow` world units.
 *
 * One function for the moat, the selection halo and the hover band, so a
 * level-3 site can never end up with furniture that hugs only its ground floor.
 */
export function traceStructure(ctx, kind, level, cx, cy, r, grow) {
  const R = r * levelScale(level);
  const g = grow || 0;
  const core = CORE_SHAPES[kind] || SHAPES[kind];
  for (let i = storeyCount(level) - 1; i >= 0; i--) {
    trace(ctx, core, cx, cy - R * STOREY_Y[i], R * STOREY_S[i] + g);
  }
  trace(ctx, SHAPES[kind], cx, cy, R + g);
}

/**
 * The circle the wall and siege rings are drawn on: `siteRingR` is its radius
 * and `siteRingDy` how far ABOVE the site centre it sits, both in units of the
 * base r.
 *
 * For a site with storeys it is the smallest enclosing circle centred somewhere
 * on the site's own vertical axis, solved once per kind per level by scanning
 * that axis. Pinning the ring to the site centre instead would force it to
 * clear a tower's roof at every angle, so a level-3 site would wear a hoop
 * twice its own width with nothing but board inside it — which is precisely
 * the "field of identical dots" this renderer spent its ring budget escaping.
 *
 * LEVEL 1 IS LEFT EXACTLY AS IT WAS, circumradius about the site centre. The
 * fit would pull a shield's ring in by a tenth, and an un-upgraded site is not
 * allowed to move a pixel because of a feature the player has not bought.
 */
const RINGS = {};
function ringsOf(kind) {
  let t = RINGS[kind];
  if (t) return t;
  t = RINGS[kind] = { dy: new Float64Array(MAX_LEVEL), r: new Float64Array(MAX_LEVEL) };
  t.r[0] = siteOuter(kind);
  for (let l = 1; l < MAX_LEVEL; l++) {
    let bestD = 0;
    let bestR = Infinity;
    // 0.02R steps to 0.8R: finer than a pixel at any zoom this game reaches.
    for (let s = 0; s <= 40; s++) {
      const d = s * 0.02;
      const m = maxDist(kind, l, d);
      if (m < bestR) { bestR = m; bestD = d; }
    }
    t.dy[l] = bestD * LEVEL_SCALE[l];
    t.r[l] = bestR * LEVEL_SCALE[l];
  }
  return t;
}

/** Farthest point of the level-`li` structure from (0,-d), in units of the
 *  SCALED body radius. */
function maxDist(kind, li, d) {
  let m = blockDist(SHAPES[kind], 1, 0, d);
  const core = CORE_SHAPES[kind] || SHAPES[kind];
  for (let i = 0; i < li; i++) {
    const v = blockDist(core, STOREY_S[i], STOREY_Y[i], d);
    if (v > m) m = v;
  }
  return m;
}

/** One block: outline `pts` at scale `s`, lifted `y`, measured from (0,-d). */
function blockDist(pts, s, y, d) {
  if (!pts) return s + Math.abs(y - d);   // a farm is a disc, not a polygon
  let m = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i] * s;
    const py = pts[i + 1] * s - y + d;
    const v = Math.sqrt(x * x + py * py);
    if (v > m) m = v;
  }
  return m;
}

export const siteRingR = (kind, level) => ringsOf(kind).r[lvIndex(level)];
export const siteRingDy = (kind, level) => ringsOf(kind).dy[lvIndex(level)];

/** Head extent of the outline the STOREYS are cut from, which is not always the
 *  body's: a camp's storeys drop the pennant, and measuring them against it
 *  would put a tent's roofline half a radius above where it really is. */
const CORE_HEAD = {};
function coreHeadY(kind) {
  let h = CORE_HEAD[kind];
  if (h !== undefined) return h;
  const pts = CORE_SHAPES[kind] || SHAPES[kind];
  h = 1;
  if (pts) {
    h = 0;
    for (let i = 1; i < pts.length; i += 2) if (-pts[i] > h) h = -pts[i];
  }
  CORE_HEAD[kind] = h;
  return h;
}

/** Foot and head of the structure at `level`, in units of the base r. The foot
 *  is the BODY's — storeys only ever rise — and the head is whatever storey
 *  ended up highest. */
export const siteFootYAt = (kind, level) => siteFootY(kind) * levelScale(level);
export function siteHeadYAt(kind, level) {
  let m = siteHeadY(kind);
  const h = coreHeadY(kind);          // storeys are built from the core outline
  for (let i = storeyCount(level) - 1; i >= 0; i--) {
    const d = STOREY_Y[i] + STOREY_S[i] * h;
    if (d > m) m = d;
  }
  return m * levelScale(level);
}
