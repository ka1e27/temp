// WHO IS STANDING ON THIS HEX — the per-hex lookup this game never had.
//
// Until armies marched freely it never needed one: sends went along a fixed
// graph of edges, so "can I get from here to there" was a list membership test
// and the ground in between was scenery. Now a squad walks real hexes, and the
// one rule that shapes the whole map is that **you cannot walk through a base**.
//
// A building denies exactly the hex it stands on, and no more. That is a
// measurement rather than a preference: at one ring per building the late maps
// seal outright — riverfen 78% of the board denied, and gallowmoor, thanescar
// and widowsgate all 100%, which is a battle where nothing can move at all. Per
// hex, the same maps deny 3-16%, and what you get is a countryside you have to
// thread rather than a wall you cannot pass. The ring around a building earns
// its keep as DETECTION instead (see the vision layer).
//
// Anyone's base blocks anyone else's march — an NPC farm is as solid as an
// enemy stronghold. What it is not solid to is its own owner.
//
// Modelled on ./influence.js in every respect that matters: a sparse plain-JSON
// record on state, rebuilt only when ownership changes, never per tick and never
// per frame.
// PURE.
import { asHex } from './influence.js';
import { isBlocked } from './state.js';
import { inGrid } from './mapgen.js';

const kOf = (q, r) => `${q},${r}`;

/**
 * Fill `state.occupancy`: hexKey -> owner faction of the site standing there.
 *
 * The value is the OWNER and not the site id, because every consumer asks "may I
 * cross this" rather than "what is this". Storing the id would mean a `siteById`
 * scan inside the A* inner loop, which is the cost this whole file exists to
 * avoid.
 *
 * Also bumps `state.influenceVersion` — the counter the background renderer's
 * `signature()` has always read and NOTHING has ever written (only `demo.html`
 * did). Ownership used to be the only thing that moved a per-hex map, and the
 * signature catches that through each site's own `owner` field; a building
 * appearing mid-battle does not, so without this the flood would silently go
 * stale under the new sites.
 */
export function recomputeOccupancy(state) {
  const map = {};
  for (const site of state.sites) map[kOf(site.hex[0], site.hex[1])] = site.owner;
  state.occupancy = map;
  state.influenceVersion = (state.influenceVersion || 0) + 1;
  return map;
}

/** The faction holding this hex, or null for open ground. */
export const occupantAt = (state, q, r) => state.occupancy?.[kOf(q, r)] ?? null;

/**
 * The passability predicate `core/hex.js findPath` wants, for one faction.
 *
 * `goal` is always passable even when hostile, and that is the point rather than
 * a special case: an assault marches ONTO the site it is taking. Without the
 * exception every attack would be unroutable and the AI would fall silent — the
 * loudest possible bug wearing the quietest possible symptom.
 *
 * @param {object} state @param {string} faction @param {?{q,r}} goal
 * @returns {(h: {q:number,r:number}) => boolean}
 */
export function passableFor(state, faction, goal = null) {
  const gk = goal ? kOf(goal.q, goal.r) : null;
  return (h) => {
    const k = kOf(h.q, h.r);
    if (k === gk) return true;
    if (!inGrid(state.grid, h) || isBlocked(state, h.q, h.r)) return false;
    const held = state.occupancy?.[k];
    return !held || held === faction;
  };
}

/** Is there a clear march from `from` to `to` for `faction`? Convenience for
 *  the places that want the question without the path. */
export const canReach = (state, from, to, faction, pathFn) =>
  pathFn(state, from, to, faction) !== null;

/** @see asHex — re-exported so a caller needs one import for the hex layer. */
export { asHex };
