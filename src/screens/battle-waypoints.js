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
import { pathThrough } from '../battle/movement.js';

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

/**
 * The hexes a send issued RIGHT NOW would actually walk, or null.
 *
 * THE ARROW IS THE ROUTE. A drag used to preview as a bowed arc from source to
 * target, which was honest while a send was "aimed" and became a lie the moment
 * waypoints shipped: the army walks a hex path around mountains, bases and
 * anything else in the way, and the arc drew straight over all of it. A player
 * choosing the long way round a wall that shoots at passers-by could not see
 * whether the road they drew was the road they got.
 *
 * So this builds the SAME `stops` array `cmdSend` builds and hands it to the
 * SAME `pathThrough`, for the same reason the pre-commit battle preview calls
 * `resolveField` rather than approximating it: a preview that disagrees with
 * the order is worse than no preview. Null means no legal route, and the
 * renderer says so by falling back to the dashed "no target" line — which is
 * also the honest answer, because `cmdSend` would refuse it too.
 *
 * @param {object} state the battle
 * @param {object} from the source site
 * @param {?object} to the snapped destination site, or null for bare ground
 * @param {Array<[number,number]>} trail the live drag trail
 */
export function previewPath(state, from, to, trail) {
  if (!from) return null;
  const end = to ? to.hex : (trail && trail[trail.length - 1]);
  if (!end) return null;
  const stops = [{ q: from.hex[0], r: from.hex[1] }];
  if (isDrawnRoute(trail)) {
    for (const w of trimWaypoints(trail)) stops.push({ q: w[0], r: w[1] });
  }
  stops.push({ q: end[0], r: end[1] });
  return pathThrough(state, stops, 'player');
}

/**
 * The route ONE source of a CONCENTRATED send would walk to a shared end hex,
 * ignoring any drawn trail — see `updateDragPreview` below for why a
 * multi-source drag's sources other than the one under the pointer never see
 * the trail at all. Takes the end hex directly rather than deriving it from
 * `to`/`trail` the way `previewPath` does, because a bare-ground multi-target
 * has no site to read `.hex` off in the first place.
 */
function previewPathToHex(state, from, endHex) {
  if (!from || !endHex) return null;
  const stops = [{ q: from.hex[0], r: from.hex[1] }, { q: endHex[0], r: endHex[1] }];
  return pathThrough(state, stops, 'player');
}

/**
 * Does a drag starting on `hitId` commit the whole selection, or just the one
 * site under the finger? Called ONCE, at the moment the press lands
 * (battle-input.js `onDown`) — see battle-orders.js `sendFromSelection` for
 * the verb this feeds. A selection of one, or a press on a site the drag did
 * not start from, is not a surprise worth a new code path: this returns null
 * for both, so every existing single-source drag stays byte-for-byte what it
 * always was.
 * @returns {?string[]} every player-owned site in the selection, or null
 */
export function dragSourcesFor(ord, view, hitId) {
  const owned = view.selection.filter((id) => ord.site(id)?.owner === 'player');
  return view.selection.includes(hitId) && owned.length > 1 ? owned : null;
}

/**
 * Advance a live SEND drag: the snapped target, the drawn trail, and the
 * previewed route(s). ONE path for an ordinary drag; ONE PER SOURCE for a
 * drag that started on a multi-selected site (`view.dragSources`, decided
 * once in battle-input.js `onDown`) — because each source marches from a
 * different hex, and drawing a single arrow while several columns take
 * several roads would be the exact lie the battle redesign's arrow exists to
 * refuse (see CLAUDE.md, "the battle redesign: a squad walks a real path").
 *
 * Recomputed only when the snap target flips or the trail grows by a new
 * hex — a pointermove fires far faster than either, and an A* leg is not
 * free. The single-source branch below is BYTE-IDENTICAL to the code it
 * replaced inline in battle-input.js; `view.dragSources` is null for every
 * ordinary drag, so that branch is the only one an existing gesture can
 * ever reach.
 *
 * A CONCENTRATED SEND NEVER CARRIES WAYPOINTS, for any source — see
 * battle-orders.js `sendFromSelection`. The drawn trail belongs to whichever
 * site the pointer actually left; threading it through a column standing
 * somewhere else would march that column over ground the player never
 * pointed at for IT. So every source previews the plain path `cmdSend` will
 * find on its own, exactly what an un-drawn single send already shows.
 *
 * Mutates `view.dragTo`, `view.dragPathKey`, and either `view.dragPath`
 * (single) or `view.dragPaths` (multi, one entry per `view.dragSources`).
 * @param {object} state @param {object} ord createOrders()'s return value
 * @param {object} view @param {object} from the site the drag started on
 */
export function updateDragPreview(state, ord, view, from, wx, wy, hexSize) {
  const t = ord.snapTarget(from, wx, wy, view.dragTrail);
  view.dragTo = t && t.id !== from.id ? t.id : null;
  trackHex(view.dragTrail, wx, wy, hexSize);

  if (view.dragSources) {
    const key = `${view.dragTo || ''}|${view.dragTrail.length}`;
    if (key === view.dragPathKey) return;
    view.dragPathKey = key;
    const end = view.dragTo ? t.hex : view.dragTrail[view.dragTrail.length - 1];
    view.dragPaths = view.dragSources.map((id) => previewPathToHex(state, ord.site(id), end));
    return;
  }

  const key = `${t ? t.id : ''}|${view.dragTrail.length}`;
  if (key !== view.dragPathKey) {
    view.dragPathKey = key;
    view.dragPath = previewPath(state, from, view.dragTo ? t : null, view.dragTrail);
  }
}
