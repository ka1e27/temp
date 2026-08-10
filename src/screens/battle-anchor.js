// Where a floating panel goes when it belongs to a THING ON THE BOARD.
//
// The site panel used to live in a HUD corner: you clicked a fort on the right
// of the map and read about it on the bottom left, with a whole battle in
// between. It now hangs off the site itself, which turns the panel into three
// geometry problems that are exactly the kind that break silently:
//
//   1. it must follow the camera, so the position is recomputed per frame;
//   2. it must never leave the viewport, so it flips to the other side of the
//      site and then clamps;
//   3. it must not cover the site it describes, the sites ADJACENT to it (those
//      are drag targets — covering one makes an order unissuable), the training
//      fan, or the HUD's own plates.
//
// The one import is the trainable roster, and only for its LENGTH: the fan's
// radius has to grow with the number of chips hung on it, and the alternative —
// threading a count through two unrelated call sites — buys nothing.
//
// So the maths lives here, as pure functions over plain rectangles, and
// tests/sitepanelpos.test.js drives it with no DOM at all. Everything is in
// CSS pixels in the coordinate space shared by the camera projection and #hud
// (both are inset:0 over the same box, which is what lets battle-hud.js hand
// `board.siteScreen()` output straight to a transform).
// PURE: no DOM, no clock.

import { TRAINABLE_UNITS } from '../battle/training.js';

/**
 * Candidate placements, in preference order. Sideways first: the panel is
 * wider than it is tall and the board is wider than it is high, so a panel to
 * the left or right of a site hides less of the map than one above or below.
 */
export const SIDES = Object.freeze([
  'right', 'left', 'below', 'above',
  'below-right', 'below-left', 'above-right', 'above-left',
]);

/** Which panel edge the caret sits on, so it points back at its site. */
export const CARET_EDGE = Object.freeze({
  right: 'left', left: 'right', below: 'top', above: 'bottom',
  'below-right': 'left', 'below-left': 'right',
  'above-right': 'left', 'above-left': 'right',
});

/**
 * The training fan's geometry, DERIVED FROM THE ROSTER rather than fixed.
 *
 * It was a literal 94, chosen when five chips hung on it: 170/360 * 2*pi*94 is
 * about 279px of arc for 220px of chip. The roster has grown twice since, and a
 * fixed radius means every new unit is another chip crammed into the same arc —
 * at seven they overlap and the fan stops being clickable at all. Both the
 * placement (battle-hud.js) and the site panel's clearance (this file) read
 * these, so the panel cannot end up under a fan that outgrew it.
 */
const TRAIN_CHIP_PX = 44;   // the tap target; matches .train-chip in hud.css
const TRAIN_CHIP_GAP = 6;
export const TRAIN_FAN_DEG = 170;
export const TRAIN_FAN_R = Math.round(
  (TRAINABLE_UNITS.length * (TRAIN_CHIP_PX + TRAIN_CHIP_GAP))
  / ((TRAIN_FAN_DEG / 360) * 2 * Math.PI),
);

/** Area, in px², by which a NEW side has to beat the current one before the
 *  panel is allowed to jump. Without it a slow pan makes the panel flap
 *  between two near-equal sides, which is far worse than a slightly poor side. */
export const STICKY = 900;

const DIAG = Math.SQRT1_2;

/**
 * How much each kind of collision COSTS.
 *
 * Not all overlaps are equal, and scoring them equally is what produced the
 * one genuinely bad placement in the sweep: a site jammed into the top-left
 * corner had no clear side at all, so the panel picked the option that covered
 * its OWN site over the one that clipped a corner of the treasury plate. Hiding
 * the thing you just clicked is the worst outcome available; overlapping a HUD
 * plate is merely untidy.
 */
export const WEIGHT = Object.freeze({ self: 6, neighbour: 3, plate: 1 });

/** @param {number} x @param {number} y @param {number} r @param {number} [w] */
export const boxAround = (x, y, r, w = 1) => ({
  left: x - r, top: y - r, right: x + r, bottom: y + r, w,
});

/** Overlapping AREA of two boxes — 0 when they merely touch. */
export function overlapArea(a, b) {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  if (w <= 0) return 0;
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return h <= 0 ? 0 : w * h;
}

/**
 * Push a w x h box back inside `bounds`. A box too big for the bounds pins to
 * the top-left rather than going negative — off the near edge is recoverable
 * (you can still read the start of it), off the far edge is not.
 */
export function clampBox(x, y, w, h, bounds) {
  const maxX = bounds.right - w;
  const maxY = bounds.bottom - h;
  return {
    x: maxX <= bounds.left ? bounds.left : Math.min(Math.max(x, bounds.left), maxX),
    y: maxY <= bounds.top ? bounds.top : Math.min(Math.max(y, bounds.top), maxY),
  };
}

/** The free box: the viewport minus the furniture the HUD parks in it. */
export function panelBounds(vw, vh, insets) {
  const i = insets || {};
  return {
    left: i.left ?? 8,
    top: i.top ?? 8,
    right: vw - (i.right ?? 8),
    bottom: vh - (i.bottom ?? 8),
  };
}

/** Top-left corner a candidate side puts the panel at, before clamping. */
function corner(side, sx, sy, r, gap, w, h) {
  const out = { x: 0, y: 0 };
  // Keep-outs are SQUARES, not circles, so a diagonal has to clear `r` on both
  // axes — `r * cos45` would tuck the panel's corner inside the square's and
  // leave the eight-candidate search with nowhere genuinely clear to go when a
  // site is ringed by neighbours.
  const d = r + gap * DIAG;
  switch (side) {
    case 'right': out.x = sx + r + gap; out.y = sy - h / 2; break;
    case 'left': out.x = sx - r - gap - w; out.y = sy - h / 2; break;
    case 'below': out.x = sx - w / 2; out.y = sy + r + gap; break;
    case 'above': out.x = sx - w / 2; out.y = sy - r - gap - h; break;
    case 'below-right': out.x = sx + d; out.y = sy + d; break;
    case 'below-left': out.x = sx - d - w; out.y = sy + d; break;
    case 'above-right': out.x = sx + d; out.y = sy - d - h; break;
    default: out.x = sx - d - w; out.y = sy - d - h; break;   // above-left
  }
  return out;
}

/**
 * Place a panel next to a point on the board.
 *
 * Every candidate is CLAMPED FIRST and scored afterwards, which is what makes
 * the edge case work: near the right-hand edge the "right" placement gets
 * clamped back over its own site, scores badly on that, and loses to "left" —
 * the flip falls out of the scoring instead of needing a rule of its own.
 *
 * @param {{site:{x:number,y:number}, size:{w:number,h:number},
 *          bounds:{left:number,top:number,right:number,bottom:number},
 *          blockers?:Array<{left:number,top:number,right:number,bottom:number}>,
 *          r?:number, gap?:number, prefer?:?string}} o
 *   `blockers` are boxes the panel should stay off: the selected site, its
 *   adjacent sites, and any HUD plate, each carrying a `w` from WEIGHT. `r` is
 *   the keep-out radius of the selected site itself; `prefer` is last frame's
 *   side, for hysteresis.
 * @returns {{x:number, y:number, side:string, edge:string, caretX:number,
 *            caretY:number, overlap:number, clear:boolean}}
 */
export function placePanel(o) {
  const { site, size, bounds } = o;
  const blockers = o.blockers || [];
  const r = o.r ?? 30;
  const gap = o.gap ?? 14;
  const w = size.w;
  const h = size.h;

  const score = (side) => {
    const c = corner(side, site.x, site.y, r, gap, w, h);
    const at = clampBox(c.x, c.y, w, h, bounds);
    const box = { left: at.x, top: at.y, right: at.x + w, bottom: at.y + h };
    let sum = 0;
    for (let i = 0; i < blockers.length; i++) {
      sum += overlapArea(box, blockers[i]) * (blockers[i].w ?? 1);
    }
    return { x: at.x, y: at.y, side, overlap: sum };
  };

  // The incumbent is scored up front so the early exit below can never skip it.
  const preferred = SIDES.includes(o.prefer) ? score(o.prefer) : null;
  let best = null;
  for (const side of SIDES) {
    const cand = side === o.prefer ? preferred : score(side);
    if (!best || cand.overlap < best.overlap) best = cand;   // strict: ties keep order
    if (best.overlap === 0) break;
  }

  // Hysteresis: hold the side we were already on unless the winner is clearly
  // better, so panning does not make the panel flap around its site.
  const pick = preferred && preferred.overlap <= best.overlap + STICKY ? preferred : best;
  const edge = CARET_EDGE[pick.side];
  return {
    x: Math.round(pick.x),
    y: Math.round(pick.y),
    side: pick.side,
    edge,
    // Where the caret sits along the panel edge: the site's own coordinate,
    // held far enough from the corners that the arrow always has a wall to sit
    // on even after a hard clamp.
    caretX: Math.round(Math.min(Math.max(site.x - pick.x, 14), Math.max(14, w - 14))),
    caretY: Math.round(Math.min(Math.max(site.y - pick.y, 14), Math.max(14, h - 14))),
    overlap: pick.overlap,
    clear: pick.overlap === 0,
  };
}

/**
 * Centre a small transient box (the unit tooltip) over an anchor, kept inside
 * the bounds. Returns the CENTRE x, because the tip is drawn with a
 * translate(-50%) and the caret has to know how far it was pushed.
 * @param {{anchor:{x:number,y:number}, size:{w:number,h:number},
 *          bounds:object, gap?:number}} o
 */
export function placeTip(o) {
  const { anchor, size, bounds } = o;
  const gap = o.gap ?? 10;
  const half = size.w / 2;
  const lo = bounds.left + half;
  const hi = bounds.right - half;
  const cx = hi <= lo ? (bounds.left + bounds.right) / 2 : Math.min(Math.max(anchor.x, lo), hi);
  // Above the anchor by default; below it when there is no room overhead.
  const above = anchor.y - gap - size.h >= bounds.top;
  return {
    x: Math.round(cx),
    y: Math.round(above ? anchor.y - gap : anchor.y + gap),
    above,
    caretX: Math.round(Math.min(Math.max(anchor.x - (cx - half), 12), Math.max(12, size.w - 12))),
  };
}
