// Moving around the board WITHOUT A POINTER.
//
// Everything else in this game's input layer answers a gesture. This file
// answers a question no gesture ever had to ask: given where the keyboard
// cursor is, what is the next place it can go? Until it existed there was no
// keyboard path to a SELECTION at all — `battle-hotkeys.js` bound filters,
// boosters, speed, the send fraction, Escape and retreat, and every one of
// those either needs a selection or does nothing to the board. So the site
// panel could not be opened without a mouse, and with it went train, upgrade,
// build, rally and the send itself: the whole game behind one gesture.
//
// PURE, and deliberately not on `board`. `board.siteAt` answers "what is under
// this point", which is a rendering question about a camera; this answers "what
// may I address", which is a rule about fog and ownership and needs no camera
// at all. Keeping them apart is what lets this be tested with a plain state
// object and no canvas.
import { siteKnown } from '../battle/vision.js';

/**
 * READING ORDER, not array order, and the difference is not cosmetic.
 *
 * `state.sites` is generation order with anything the player BUILT appended at
 * the end, so cycling it would walk the map in a sequence nobody can predict
 * and would move a site's place in the queue the moment a neighbour finished
 * building. A site's hex never moves, so ordering by it is stable for the whole
 * battle and inserts a new building where it actually stands.
 *
 * `hex` is AXIAL and rows are offset, so the column is `q + floor(r/2)` — the
 * documented conversion, and reading it as plain `q` tilts every row by half
 * its index. Row first, then column: the order a player would point along.
 */
const colOf = (hex) => hex[0] + Math.floor(hex[1] / 2);
const readingOrder = (a, b) => (a.hex[1] - b.hex[1]) || (colOf(a.hex) - colOf(b.hex)) || (a.id < b.id ? -1 : 1);

/**
 * The sites a keyboard may land on, in reading order.
 *
 * FOG-GATED ON THE SAME PREDICATE THE CURSOR USES. `battleView.js siteAt`
 * refuses a site the player has never seen — "a thing that draws nothing and
 * still answers the cursor is a worse tell than drawing it" — and a keyboard
 * cycle that walked the raw list would be that same leak with a keystroke
 * instead of a sweep, disclosing every enemy building's existence for free.
 *
 * @param {object} state battle state
 * @param {'player'|'enemy'} faction whose knowledge to filter by
 * @param {boolean} mine own sites only — the ones an order can be given FROM
 * @returns {object[]}
 */
export function navigableSites(state, faction, mine = false) {
  const out = [];
  for (const s of state.sites) {
    if (mine ? s.owner !== faction : !siteKnown(state, faction, s)) continue;
    out.push(s);
  }
  return out.sort(readingOrder);
}

/**
 * The id `dir` places along `list` from `currentId`, wrapping.
 *
 * An id that is not in the list — a site just lost, or one the cursor was on
 * before fog closed over it — starts from the beginning rather than refusing,
 * because the alternative is a cursor that silently stops responding.
 *
 * @param {object[]} list @param {?string} currentId @param {number} dir +1/-1
 * @returns {?string}
 */
export function stepId(list, currentId, dir) {
  if (!list.length) return null;
  const i = list.findIndex((s) => s.id === currentId);
  if (i < 0) return list[dir > 0 ? 0 : list.length - 1].id;
  return list[(i + dir + list.length) % list.length].id;
}
