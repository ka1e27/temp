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
// A site being RAISED (as opposed to upgraded) gets a SECOND cue on top of the
// bar: a ring closing clockwise from 12 o'clock around the whole silhouette,
// same geometry family as the HP and siege rings (siteGlyphs.js). A bar under a
// brand-new one-HP scaffold is easy to lose among a dozen established sites
// each carrying their own bars and rings; a ring around the thing itself is
// not. Gated on `buildTicksLeft` alone, never `upgradeTicksLeft`: an upgrading
// site already has an established silhouette and its own HP ring meaning
// something, where a scaffold's HP ring (1 HP against whatever `hpMax` its kind
// carries) says nothing until the count itself does.
//
// Its own file because siteGlyphs.js is at the 400-line cap. Every draw here is
// a handful of fillRect/arc/stroke calls and allocates nothing per frame, same
// as everything else on the fx canvas — no `shadowBlur` anywhere.
import { siteFootYAt, siteRingR, siteRingDy } from './siteShapes.js';
import { builtLevel } from './siteGlyphs.js';
import { upgradeProgress, buildProgress } from '../battle/state.js';

/** Matches drawTrainBar's geometry exactly — same width, same height, one gap
 *  below it — because the point is that they read as a pair. */
const WIDTH_R = 0.85;

const TAU = Math.PI * 2;
/** 12 o'clock, in canvas angle terms — the same origin drawHpRing sweeps from,
 *  so "closing clockwise" reads identically on every ring this board draws. */
const TOP = -Math.PI / 2;
/** Clear of the HP ring (+px*3) and the siege ring (+px*9) — see siteGlyphs.js
 *  — so a scaffold under siege still reads as three distinct rings rather than
 *  one blurred band. */
const RING_OFFSET = 15;

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} site @param {number} cx @param {number} cy world centre
 * @param {number} r site radius @param {object} p palette @param {number} px
 */
export function drawBuildBar(ctx, site, cx, cy, r, p, px) {
  // A site being upgraded and one still being RAISED never overlap — an
  // upgrade needs an existing level to leave, and a raised site sits at level
  // 1 with hp:1 until `buildTicksLeft` reaches 0 — so one slot carries both,
  // same as the panel's own bar (screens/battle-panel.js).
  const upgrading = site.upgradeTicksLeft > 0;
  const constructing = site.buildTicksLeft > 0;
  // The ring first, so it sits under nothing the bar draws — order only
  // matters here because both can be true-ish at the boundary tick and the
  // ring is the one that should read as "around the whole site" rather than
  // "over its own bar".
  if (constructing) drawBuildRing(ctx, site, cx, cy, r, p, px);
  if (!upgrading && !constructing) return;
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
  ctx.fillRect(cx - w * 0.5, y, w * (upgrading ? upgradeProgress(site) : buildProgress(site)), h);
}

/**
 * The ring closing around a site as it RISES: a full track, then an arc from
 * 12 o'clock sweeping clockwise as `buildProgress()` advances.
 *
 * CONSTRUCTION ONLY. An upgrade leaves a site's silhouette and HP meaningful
 * the whole time (it is still the old, established level until the work
 * lands), so its own HP ring is a real reading; a freshly-raised site sits at
 * 1 HP against a real `hpMax` the instant it appears; that ring is not a
 * reading of anything yet, and this one is what a player should watch instead.
 *
 * Reuses the HP/siege rings' own geometry (siteShapes.js `siteRingR`/
 * `siteRingDy`) rather than a plain circle at `r`, so the ring clears an
 * upgraded structure's actual roofline the same way theirs do — not that a
 * raised site is ever above level 1 while going up, but the call is cheap and
 * keeping ONE formula for "the ring circle" is what stops the three rings on a
 * besieged scaffold from disagreeing about where "around it" is.
 */
function drawBuildRing(ctx, site, cx, cy, r, p, px) {
  const lv = builtLevel(site);
  const my = cy - r * siteRingDy(site.kind, lv);
  const rad = r * siteRingR(site.kind, lv) + px * RING_OFFSET;
  ctx.lineWidth = px * 3;
  ctx.lineCap = 'butt';

  ctx.beginPath();
  ctx.arc(cx, my, rad, 0, TAU);
  ctx.strokeStyle = p.track;
  ctx.stroke();

  const frac = buildProgress(site);
  if (frac <= 0) return;
  ctx.beginPath();
  ctx.arc(cx, my, rad, TOP, TOP + TAU * frac);
  // The same accent hue the scaffolding ghost already uses for "paid for, not
  // finished yet" (siteGlyphs.js drawScaffold) — one more place that vocabulary
  // means the same thing rather than minting a second colour for it.
  ctx.strokeStyle = p.building;
  ctx.stroke();
}
