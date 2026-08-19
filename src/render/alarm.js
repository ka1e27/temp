// WHICH SITE THE ALERT IS TALKING ABOUT.
//
// The alert strip has said `ATTACKED — training ground will fall` since the
// melee layer shipped and the board has never singled that site out. Measured
// by a readability pass on a real gallowmoor frame: five enemy counts (5, 7, 8,
// 7, 6) inside one screen-width of the player's own (56, 1, 4) at nearly the
// same size, every inbound force the identical red pennant, and nothing anywhere
// saying which of them the sentence meant. The player had to already know which
// glyph is a training ground, find it among three to six similar icons, and
// trust the text over the picture.
//
// The decision is NOT here — `battle-alert.js alarmSite` owns it, and the text
// and this mark read the same answer, so they cannot name different sites. This
// file only draws.
//
// BRACKETS, NOT A RING, and that is the whole reason it can be found. Selection,
// hover, hp and siege are all rings or structure traces; a fifth ring on a 20px
// glyph is one more of a thing the board is already full of. Four corner
// brackets are unique on this board, they read as "this one" rather than as a
// state of the building, and they cannot be mistaken for ownership the way a
// coloured halo could.
import { siteRadius } from './siteShapes.js';

const TAU = Math.PI * 2;
/** Where the brackets sit, as a multiple of the site's own radius. Outside the
 *  selection halo so a site that is both selected and in trouble shows both. */
const OUT = 2.05;
/** How far round the circle each bracket runs, either side of its corner.
 *
 * Tuned against a screenshot rather than by eye, because the first value was
 * wrong in a way only a picture shows: at TAU/14 each bracket spans 51 degrees,
 * so 205 of the 360 are inked and the four gaps read as a DASHED RING — one more
 * ring among the four the board already draws, which is the exact thing this was
 * meant not to be. At TAU/22 each bracket is 33 degrees, 131 inked against 229
 * open, and the corners read as corners. */
const ARC = TAU / 22;

/**
 * EVERY live threat, not the most recent one. The alert strip is
 * last-write-wins and cannot represent simultaneity — measured, five threats
 * were live on one gallowmoor frame and the one line could only name a single
 * training ground. The board has room for all of them, and marking them all is
 * a better aggregate than a count would be, because it says WHERE.
 *
 * @param {object} view the UI view state — `alarms` is `siteId -> deadline`,
 *   written by the HUD when a danger alert names a site and expired by the
 *   HUD's own refresh. The renderer therefore needs no clock of its own.
 * @param {(id:string)=>object|null} byId resolves through `perceivedSite`, so a
 *   site the player cannot see cannot be marked. Belt and braces: `alarmSite`
 *   is already fog-safe by construction, since every danger alert names ground
 *   the player owns or is themselves assaulting.
 */
export function drawAlarm(ctx, view, byId, sitePos, at, hexSize, p, px, pulse) {
  const alarms = view?.alarms;
  if (!alarms) return;
  ctx.strokeStyle = p.danger;
  ctx.lineWidth = px * 2.5;
  ctx.lineCap = 'butt';
  // The pulse is inherited rather than minted so this breathes in step with the
  // selection halo instead of beating against it.
  ctx.globalAlpha = 0.55 + 0.45 * pulse;
  // `for..in` rather than Object.keys: this runs every frame and the keys array
  // would be a per-frame allocation, which the whole fx path forbids.
  for (const id in alarms) {
    const s = byId(id);
    if (!s) continue;
    sitePos(s, at);
    const r = siteRadius(s.kind, hexSize) * OUT;
    for (let i = 0; i < 4; i++) {
      // Corners rather than the axes: a bracket on the vertical would sit on
      // the garrison plaque, which is the number the player is trying to read.
      const mid = TAU * (i / 4) + TAU / 8;
      ctx.beginPath();
      ctx.arc(at.x, at.y, r, mid - ARC, mid + ARC);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}
