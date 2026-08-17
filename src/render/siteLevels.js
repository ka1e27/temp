// Site levels: the storey ladder, and the ring geometry and extents it drives.
//
// Split out of ./siteShapes.js for the line budget and re-exported from
// there, so `import { levelScale } from '../render/siteShapes.js'` keeps
// resolving — same arrangement as battle/siteinfo.js off battle/state.js.
// This file depends on that one (SHAPES, coreShapeOf, trace, the extents),
// never the other way round, so siteShapes.js needs no import from here for
// its OWN logic — only the re-export at its foot.
//
// LEVEL IS MASS, AND IT IS THE SAME MOVE ON ALL FOUR SHAPED KINDS: the site is
// built BIGGER and built UP. The body swells a little, and each level stacks
// one more STOREY behind it — a smaller copy of that kind's OWN outline, sunk
// into the body so only its top clears the roofline.
//
// Reusing the kind's own outline is what keeps siteShapes.js's invariant 1
// intact. Nothing is bolted on that the shape did not already say, so a
// level-3 shield is still unmistakably a shield (three shields, in fact), a
// level-3 tent is a bigger camp of tents, and a level-3 farm is a stack of
// silos. Kind still resolves first; level resolves second, from height and
// bulk.
//
// The wall and siege rings are circles drawn outside the whole thing, so
// growth has to stay measurable — see siteRingR().
//
// HOW MANY LEVELS THERE ARE IS CONTENT, NOT GEOMETRY. Everything below is
// generated from SITE_LEVELS.length, so a balance pass that lengthens the
// upgrade ladder re-spaces the whole shape system instead of walking off the
// end of a hand-written table.
import { SITE_LEVELS } from '../content/balance.js';
import {
  SHAPES, coreShapeOf, trace, siteOuter, siteFootY, siteHeadY,
} from './siteShapes.js';

/** Levels the content defines. Never a literal — `balance.js` owns this. */
export const MAX_LEVEL = Math.max(1, SITE_LEVELS.length);

/** The hand-tuned ramp this board was drawn against: a level-3 site is 34%
 *  wider than a level-1 one. Used verbatim while the ladder is this short, so
 *  a three-level game is pixel-for-pixel what it always was. */
const BASE_SCALE = [1, 1.16, 1.34];
/** Ceiling for ANY ladder length. 0.38r (farm) * 1.4 < 0.54r (stronghold), so a
 *  MAXED farm still cannot outgrow a bare military site however many levels get
 *  added: kind outranks level, at every count. */
const SCALE_TOP = 1.4;

/**
 * Whole-structure scale by level. Modest: the storeys are the loud cue and this
 * is the supporting one. A longer ladder keeps the same CEILING and re-spaces
 * the steps under it — the top cannot move, so the extra levels share out the
 * room that is already there rather than each demanding their own.
 */
export function levelRamp(n) {
  const out = new Float64Array(Math.max(1, n));
  for (let i = 0; i < out.length; i++) {
    out[i] = out.length <= BASE_SCALE.length
      ? BASE_SCALE[i]
      : SCALE_TOP ** (i / (out.length - 1));
  }
  return out;
}
export const LEVEL_SCALE = levelRamp(MAX_LEVEL);

/**
 * Storey i (added by level i+2): radius and how far it is lifted, both in units
 * of the SCALED body radius. Each storey's own foot sits below the body's top
 * edge, so the stack is a stepped tower and never a floating pile.
 *
 * The first two are hand-placed; past that the ladder CONVERGES — each storey
 * is 62% of the one below and rises a shrinking share of the last step — so a
 * level-7 keep is a level-4 keep wearing finials, not a skyscraper. That bound
 * is the point: it keeps siteRingR() (and therefore everything that orbits a
 * site) finite — past three or four levels the exact count stops being
 * resolvable off the roofline, which is fine, because the gilded trim
 * siteGild.js paints onto each storey is meant to read as "more reinforced",
 * not as a counter.
 *
 * The one thing a long ladder does move is the FIRST storey, lifted a fraction
 * higher: the level ramp above gets shallower the more levels there are, so
 * without it a camp's first upgrade would disappear behind its own pennant —
 * the tallest thing a level-1 body already owns.
 */
export function storeyLadder(n) {
  const s = new Float64Array(Math.max(0, n));
  const y = new Float64Array(s.length);
  if (s.length > 0) { s[0] = 0.80; y[0] = s.length > BASE_SCALE.length - 1 ? 0.62 : 0.58; }
  if (s.length > 1) { s[1] = 0.54; y[1] = 1.14; }
  for (let i = 2; i < s.length; i++) {
    s[i] = s[i - 1] * 0.62;
    y[i] = y[i - 1] + (y[i - 1] - y[i - 2]) * 0.55;
  }
  return { s, y };
}
const LADDER = storeyLadder(MAX_LEVEL - 1);
const STOREY_S = LADDER.s;
const STOREY_Y = LADDER.y;

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
  const core = coreShapeOf(kind);
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
  const core = coreShapeOf(kind);
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
  const pts = coreShapeOf(kind);
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

/**
 * World-space y offset of a stack that is AT a site — besieging it, or fighting
 * its garrison outside the walls. Negative: it sits ABOVE the site, clear of the
 * garrison plaque below.
 *
 * ONE EXPRESSION, TWO CALLERS, for the same reason `garrisonLabelY` is one: the
 * renderer draws the troop pieces here and the label pass writes the headcount
 * there, and a number floating free of the pieces it counts is worse than no
 * number at all. Hung off the built roofline rather than a fixed multiple of the
 * radius, because a level-3 tower grows up into where besiegers used to stand.
 */
/** Piece length a site stack is drawn at. Beside `siteStackY` because the two
 *  together ARE "how a stack at a site is laid out", and the label pass needs
 *  both to place a number clear of the troops. */
export const siteStackLen = (hexSize, px) => Math.max(hexSize * 0.1, px * 2.2);

export const siteStackY = (kind, level, r, px) =>
  -r * (siteHeadYAt(kind, level) + 0.3) - px * 20;
