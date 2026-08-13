// THE ROAD THE PLAYER DREW.
//
// A send used to be "picked up here, released there", and the pathfinder chose
// the road in between. That is the right default and it stays the default —
// most orders do not care which way the army goes. But it left no way to say
// "go the long way round", and going the long way round is the whole answer to
// a wall that shoots at what walks past it (battle/towers.js) and to territory
// that slows an intruder down (battle/influence.js). Without a way to choose
// the route, both of those are taxes with no counterplay.
//
// So a drag now REMEMBERS THE HEXES IT CROSSED, and they ride the order as
// `waypoints`. movement.js `pathThrough` stitches a leg of A* between
// consecutive stops; consecutive stops here are ADJACENT hexes, so each leg is
// a single step and the route the army walks is exactly the line the finger
// drew.
//
// Split out of battle-orders.js at the 400-line cap. It lives on its own rather
// than inside either neighbour because BOTH need it: battle-input.js
// accumulates the trail as the gesture happens, battle-orders.js trims it as
// the order is issued, and a copy in each is two rules that drift.
import { fromPixel } from '../core/hex.js';

/**
 * Ceiling on how many hexes one drag may name.
 *
 * Every waypoint costs the command handler an A* leg to validate before the
 * order is accepted, and past a couple of dozen the extra fidelity is a wobble
 * in the player's hand rather than a route they meant.
 */
export const MAX_WAYPOINTS = 20;

/**
 * Append the hex under (wx, wy) to `trail`, if it is not already the last one.
 *
 * DEDUPED ON ARRIVAL rather than at the end. A pointermove fires far faster
 * than a finger crosses a hex, so without this the trail is hundreds of copies
 * of the same handful of tiles and the cap below throws away the actual shape
 * of the gesture while keeping its jitter.
 *
 * @param {Array<[number,number]>} trail mutated in place
 * @returns {Array<[number,number]>} the same array
 */
export function trackHex(trail, wx, wy, hexSize) {
  const h = fromPixel(wx, wy, hexSize);
  const last = trail[trail.length - 1];
  if (!last || last[0] !== h.q || last[1] !== h.r) trail.push([h.q, h.r]);
  return trail;
}

/**
 * The waypoints an order should carry, from a raw drag trail.
 *
 * Drops the first and last entries: the origin is where the army already
 * stands, and the destination is passed separately as a site or a hex.
 *
 * SUBSAMPLED RATHER THAN TRUNCATED when it is too long. Truncating would march
 * the army to the middle of the gesture and stop there — an order the player
 * never gave — where subsampling gives them a slightly straighter version of
 * the road they actually drew.
 */
export function trimWaypoints(trail) {
  if (!trail || trail.length <= 2) return [];
  const mid = trail.slice(1, -1);
  if (mid.length <= MAX_WAYPOINTS) return mid;
  const out = [];
  const step = (mid.length - 1) / (MAX_WAYPOINTS - 1);
  for (let i = 0; i < MAX_WAYPOINTS; i++) out.push(mid[Math.round(i * step)]);
  return out;
}

/**
 * Is this trail worth sending as a route at all?
 *
 * A straight drag from a site to its neighbour crosses a handful of hexes and
 * means nothing by them — the player was pointing, not drawing. Sending those
 * as waypoints would pin the army to a route the pathfinder would have picked
 * anyway, at the cost of refusing the order outright if one of those incidental
 * hexes happens to be occupied.
 *
 * So a trail only counts as a DRAWN ROUTE when it is meaningfully longer than
 * the straight line between its own endpoints. `slackHexes` is how much longer;
 * below that, the order goes out with no waypoints and the pathfinder decides.
 */
export function isDrawnRoute(trail, slackHexes = 2) {
  if (!trail || trail.length < 3) return false;
  const a = trail[0];
  const b = trail[trail.length - 1];
  // Axial hex distance, written out rather than imported: core/hex.js `distance`
  // takes {q,r} objects and the trail is packed pairs, and converting per call
  // in a per-pointermove path is exactly the allocation this file should not do.
  const dq = a[0] - b[0];
  const dr = a[1] - b[1];
  const straight = (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
  return (trail.length - 1) >= straight + slackHexes;
}
