// The build timer, on the board.
//
// A site being upgraded already wears SCAFFOLDING (siteGlyphs.js `drawScaffold`)
// — but scaffolding is a boolean. It says "something is happening here" and
// never "for another twenty seconds", which is the only part a player can act
// on: whether to hold the line a moment longer or pull out now.
//
// So it is a BAR, in the same slot and the same language as the training bar
// directly above it. Two thin fills under a site read as one instrument with two
// rows; a bar for training and a countdown in a corner panel for building would
// be two.
//
// Its own file because siteGlyphs.js is at the 400-line cap. The whole draw is
// two fillRects and allocates nothing per frame, same as everything else on the
// fx canvas.
import { siteFootYAt } from './siteShapes.js';
import { builtLevel } from './siteGlyphs.js';
import { upgradeProgress } from '../battle/state.js';

/** Matches drawTrainBar's geometry exactly — same width, same height, one gap
 *  below it — because the point is that they read as a pair. */
const WIDTH_R = 0.85;

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} site @param {number} cx @param {number} cy world centre
 * @param {number} r site radius @param {object} p palette @param {number} px
 */
export function drawBuildBar(ctx, site, cx, cy, r, p, px) {
  if (!(site.upgradeTicksLeft > 0)) return;
  const w = r * WIDTH_R;
  const h = px * 2.5;
  // The training bar occupies `+px*2` through `+px*4.5`; this sits one pixel
  // under it, so the two never fuse into a single thick band.
  const y = cy + r * siteFootYAt(site.kind, builtLevel(site)) + px * 5.5;
  ctx.fillStyle = p.track;
  ctx.fillRect(cx - w * 0.5, y, w, h);
  // Gold, because the build is the one of the two you PAID for — and because
  // the training bar is already `p.train`, and two fills in one hue stacked a
  // pixel apart read as one bar glitching rather than two making progress.
  ctx.fillStyle = p.gold;
  ctx.fillRect(cx - w * 0.5, y, w * upgradeProgress(site), h);
}
