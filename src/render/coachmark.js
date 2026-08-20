// WHICH BUILDING THE TUTORIAL IS TALKING ABOUT.
//
// The opening instruction is "Drag from your camp across the map". The camp is
// also the lose condition — losing it ends the region however well the rest is
// going — and nothing on the board has ever said which of the three starting
// glyphs it is. Measured by a first-session critic driving the real game: they
// dragged from the FARM on their first attempt, going off the picture alone,
// because at ~20-30px a camp (peaked tent) and a training ground (gabled hut)
// differ by a small pennant.
//
// A CHEVRON, NOT A RING AND NOT BRACKETS. The board already draws four rings
// (selection, hover, hp, siege) and `alarm.js` has taken corner brackets to mean
// "this one is in trouble" — in the danger colour. A fifth ring would be one more
// of a thing the board is full of, and re-using the brackets would make the
// friendliest moment in the game share a mark with the most alarming. A wedge
// floating above the site is unique here, it POINTS, and it cannot be read as a
// state of the building.
//
// It only ever appears while a coach beat is up, so it retires with the tutorial
// and can never become clutter in an ordinary battle.
import { siteRadius } from './siteShapes.js';

/**
 * How far above the site the wedge floats, as a multiple of its radius. Just
 * clear of `alarm.js`'s OUT (2.05), so a camp that is both taught and under
 * attack shows both marks rather than one on top of the other.
 *
 * Measured rather than guessed: a camp's radius is 25 world units, so the first
 * value (2.9) put the wedge 95-105 SCREEN pixels above the glyph centre — about
 * three times the glyph's own height, far enough that it reads as something
 * floating near the camp rather than as a mark ON it. 2.35 lands it just outside
 * the brackets.
 */
const RISE = 2.35;
/** Half-width and height of the wedge, in hexSize. Sized against the garrison
 *  plaque rather than against the glyph: it has to read at a glance without
 *  becoming the biggest thing on the board. */
const HALF = 0.22;
const TALL = 0.30;
/** How far it bobs, in hexSize. Motion is what finds it in peripheral vision;
 *  the amount is deliberately small, because this sits over the one building
 *  the player must not lose and a big bounce reads as an alarm. */
const BOB = 0.10;

/**
 * @param {object} view  `coachMark` is a site id or null, written by
 *   `screens/battle.js` from the beat currently on screen — so the mark and the
 *   sentence name the same building by construction, the same rule
 *   `alarm.js`/`battle-alert.js` follow for the danger mark.
 * @param {(id:string)=>object|null} byId resolves through `perceivedSite`. The
 *   tutorial only ever points at the player's own camp, so this cannot leak —
 *   belt and braces, exactly as the alarm mark is.
 * @param {number} pulse 0..1, inherited so this breathes in step with the
 *   selection halo instead of beating against it.
 */
export function drawCoachMark(ctx, view, byId, sitePos, at, hexSize, p, px, pulse) {
  const id = view?.coachMark;
  if (!id) return;
  const s = byId(id);
  if (!s) return;
  sitePos(s, at);
  const r = siteRadius(s.kind, hexSize);
  const y = at.y - r * RISE - hexSize * BOB * pulse;
  const half = hexSize * HALF;
  const tall = hexSize * TALL;
  // THE TUTORIAL'S OWN COLOUR, not the player's. `.hint` in screens.css carries
  // `border-left-color: var(--c-accent)`, so the strip and this mark are the
  // same thing seen twice and read as one. Drawing it in `owner.player` was
  // measured on a screenshot and rejected: the camp is green, the territory
  // under it floods green, and a green wedge on green ground is a shape the eye
  // has to hunt for — which is the whole complaint this closes.
  ctx.fillStyle = p.accent;
  ctx.globalAlpha = 0.65 + 0.35 * pulse;
  ctx.beginPath();
  ctx.moveTo(at.x - half, y - tall);
  ctx.lineTo(at.x + half, y - tall);
  ctx.lineTo(at.x, y);
  ctx.closePath();
  ctx.fill();
  // A thin dark keyline, because the wedge sits over open ground as often as
  // over a plate and a flat fill disappears against the lighter terrain.
  ctx.strokeStyle = p.siteShadow;
  ctx.lineWidth = px;
  ctx.stroke();
  ctx.globalAlpha = 1;
}
