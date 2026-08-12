// OWNERSHIP'S SECOND CHANNEL — the outline's DASH, not just its hue.
//
// Split out of siteGlyphs.js at the 400-line cap and re-exported from there,
// the same way siteShapes and siteGild already are.
//
// THE MEASUREMENT THIS EXISTS FOR: player-green against enemy-red is **dE 1.8
// at 1.03:1 under protanopia** — one continuous field of ground, on the surface
// the entire game is read from. Colour has been the ONLY ownership cue since
// the first commit, and this project's own accessibility pass has carried
// "ownership needs a second channel" as an open item ever since it took that
// number. It was the oldest unbuilt item in the backlog.
//
// A dash pattern is the cheapest honest fix available to this renderer. It
// survives greyscale, it survives every form of colour blindness, it costs no
// extra draw call, and it batches by owner exactly as the fill already does.
// The house rule is that draw paths allocate nothing per frame, so the patterns
// are module-scope arrays mutated in place — the same shape rallyLines.js and
// routes.js already use for their own dashes.
//
// SOLID for yours, DASHED for theirs, FINE DOTTED for nobody's. The ordering is
// deliberate rather than arbitrary: your own ground should be the quietest to
// read, because it is the ground you are not worrying about, and a busy pattern
// on two thirds of a won board would be noise rather than information.
//
// Scaled by LINE WIDTH rather than fixed in pixels, so the rhythm holds at
// every zoom. A fixed dash resolves into a solid line as the camera pulls out,
// which would silently take the whole channel away at exactly the moment the
// board is hardest to read.
const SOLID = [];
const ENEMY = [0, 0];
const UNOWNED = [0, 0];

/**
 * The dash pattern for a site outline owned by `owner`, sized against the
 * stroke width it will be drawn at.
 *
 * @param {?string} owner 'player' | 'enemy' | 'neutral' | null
 * @param {number} lw     the line width this stroke will use
 * @returns {number[]} a pattern for `ctx.setLineDash`, never a fresh array
 */
export function ownerDash(owner, lw) {
  if (owner === 'player') return SOLID;
  if (owner === 'enemy') {
    ENEMY[0] = lw * 2.8;
    ENEMY[1] = lw * 2.0;
    return ENEMY;
  }
  // Neutral AND a fogged ghost whose owner is unknown (`null`, see
  // battle/vision.js `perceivedSite`) both land here, which is the right
  // reading: "nobody's, as far as you know" is one statement, not two.
  UNOWNED[0] = lw * 0.9;
  UNOWNED[1] = lw * 1.9;
  return UNOWNED;
}

/** The pattern to restore after stroking. Exported because a dash left on the
 *  context leaks into whatever strokes next — and what strokes next is every
 *  other site on the board, so a missed reset would not be subtle. */
export const NO_DASH = SOLID;
