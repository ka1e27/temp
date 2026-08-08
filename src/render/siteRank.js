// The rank gauge: how far up the upgrade ladder a site has been taken.
//
// The STOREYS in siteShapes.js say a site has been upgraded — the body swells
// and another copy of its own outline stacks up behind it. That reading is the
// one that carries kind and level in the same glyph, and it stays. What it
// cannot do is COUNT: by the fourth or fifth storey the ladder has converged to
// finials nobody can resolve at the zoom a whole region is framed at, and
// "which of these two keeps is further along" stops being answerable.
//
// So the exact number gets its own channel, and it is the cheapest one there
// is: GOLD.
//
//   ONE CELL PER UPGRADE STEP, laid out as an arc gauge just outside the
//   structure. SITE_LEVELS.length - 1 cells, always: the ring is cut into as
//   many pieces as there are steps in the ladder the content defines. Gold
//   cells are steps BOUGHT, the dark track is steps still available, and the
//   cell being built right now is drawn in the same accent as the scaffolding.
//
// This is the one permanent ring on the board, and it is deliberately built to
// stay subordinate to the rule it bends ("a ring means look here"): it is
// absent entirely at level 1, it is gold rather than a faction or an alarm hue,
// it never grows — one radius, whatever the level — and it sits INSIDE the wall
// and siege rings, which step out over it, so trouble always orbits further out
// than rank does.
//
// Two readings for the price of one fill each: count the gold cells for the
// exact level, or read the fraction of the ring that is gold for "how close to
// maxed" without counting anything.
import { MAX_LEVEL, siteRingR, siteRingDy } from './siteShapes.js';

const TAU = Math.PI * 2;
const TOP = -Math.PI / 2;

// Radial budget around a site, in SCREEN px, measured out from the structure's
// enclosing circle. One table, because four different things orbit a site and
// none of them may touch: gauge (here) < wall ring < siege ring.
const TRACK_IN = 0.8;    // clear of the moat
const TRACK_OUT = 5.8;   // dark casing, so gold reads over any ground
const CELL_IN = 1.6;
const CELL_OUT = 5.0;
const GAP_PX = 3.6;      // the split between cells, constant on screen
/** How far the wall and siege rings step out to clear the gauge. The wall ring
 *  is 3.5px wide about a centreline 3px out, so its inner edge already sits
 *  1.25px out; this leaves 2.6px of bare board between the two. That air is
 *  load-bearing — under siege the wall ring turns amber, and amber against gold
 *  with nothing between them would read as one thick ring. */
const BAND = TRACK_OUT - 1.25 + 2.6;

/** Cells the gauge is cut into: one per purchasable step. Zero when the content
 *  defines a single level, in which case there is nothing to say. */
export const rankCells = (max = MAX_LEVEL) => Math.max(0, max - 1);

/** True when a site at this BUILT level wears a gauge at all. Level 1 does not:
 *  an un-upgraded site has to stay exactly as it was before rank existed. */
export const hasRank = (level, max = MAX_LEVEL) => rankCells(max) > 0 && level >= 2;

/**
 * Screen-px the wall and siege rings must move out by, so they clear the gauge.
 * ZERO at level 1 — which is what keeps an un-upgraded site pixel-identical.
 */
export const rankBand = (level, max = MAX_LEVEL) => (hasRank(level, max) ? BAND : 0);

/**
 * Paint the gauge. Lives on the BACKGROUND canvas with the rest of the site
 * base, so it costs nothing per frame and repaints only when a level changes.
 *
 * FILLS ONLY, never a stroke: the storey stack is counted off stroked outlines
 * (tests/sitelevels.test.js), and rank must not be able to pass itself off as
 * another floor.
 *
 * @param {object} site  for kind and whether it is mid-build
 * @param {number} lv    the BUILT level — never the paid-for one
 * @param {number} max   levels in the ladder; defaults to what content defines
 */
export function drawRankGauge(ctx, site, lv, cx, cy, r, p, px, max = MAX_LEVEL) {
  const n = rankCells(max);
  if (!hasRank(lv, max)) return;
  // Concentric with the wall ring, i.e. on the structure's own axis rather than
  // the hex centre: a level-4 keep is not centred on its own tile and a gauge
  // that ignored that would hang off it.
  const my = cy - r * siteRingDy(site.kind, lv);
  const base = r * siteRingR(site.kind, lv);
  sector(ctx, cx, my, base + px * TRACK_IN, base + px * TRACK_OUT, 0, TAU, p.rankTrack);

  const r0 = base + px * CELL_IN;
  const r1 = base + px * CELL_OUT;
  const pitch = TAU / n;
  // A gap that is constant in screen pixels, not in degrees: on a farm at six
  // levels the cells are small and a proportional gap would close up.
  const gap = Math.min((px * GAP_PX) / r1, pitch * 0.34);
  const filled = Math.min(n, lv - 1);
  // The step being raised right now, previewed in the scaffolding's accent —
  // the same "paid for, not finished" the dashed storey is saying above it.
  const building = site.upgradeTicksLeft > 0 && filled < n ? filled : -1;
  for (let i = 0; i < n; i++) {
    let hue = null;
    if (i < filled) hue = p.rank[rankStep(i, n)];
    else if (i === building) hue = p.building;
    if (!hue) continue;
    sector(ctx, cx, my, r0, r1,
      TOP + i * pitch + gap * 0.5, TOP + (i + 1) * pitch - gap * 0.5, hue);
  }
}

/** Which step of the gold ramp cell `i` of `n` is painted in. The ramp is a
 *  fixed length in palette.js precisely so it never has to know how long the
 *  upgrade ladder got. */
function rankStep(i, n) {
  const steps = 8;
  if (n <= 1) return steps - 1;
  return Math.round((i / (n - 1)) * (steps - 1));
}

/** One annular sector as a single fill: out along r1, back along r0. */
function sector(ctx, cx, cy, r0, r1, a0, a1, style) {
  ctx.beginPath();
  ctx.arc(cx, cy, r1, a0, a1);
  ctx.arc(cx, cy, r0, a1, a0, true);
  ctx.closePath();
  ctx.fillStyle = style;
  ctx.fill();
}
