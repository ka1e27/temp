// WHAT A COLUMN DOES WHEN IT STOPS GOING FORWARD: finding friendly ground,
// turning around, and re-tasking an army that is holding open country.
//
// Split out of `movement.js` for the 400-line cap, and it is a real seam rather
// than an arbitrary cut: everything above it in that file answers "where is this
// squad and how long does the trip take", which is pure geometry, while
// everything here answers "where should it go instead", which needs to know who
// owns what. Consumers import from here directly — the same shape as
// `rally.js` out of `sim.js` and `refund.js` out of `store.js` — rather than
// being re-exported back, because a re-export would make the pair a cycle and
// `resolve` is a `const` that would then be read in its own temporal dead zone.
import { distance } from '../core/hex.js';
import { siteById } from './state.js';
import { asHex } from './influence.js';
import {
  squadHexOf, travelTicks, ticksAlong, pathBetweenHexes, pathThrough,
} from './movement.js';

/** A site id or a site object, either way a site. Mirrors movement.js's own. */
const resolve = (state, s) => (typeof s === 'string' ? siteById(state, s) : s);

/**
 * Nearest site owned by `faction`, measured over the site graph (BFS, so it
 * respects the front line rather than flying over it). Falls back to raw hex
 * distance if the graph is no help.
 */
export function retreatTarget(state, site, faction) {
  const start = resolve(state, site);
  if (!start) return null;
  const seen = { [start.id]: true };
  let frontier = [start];
  while (frontier.length) {
    const next = [];
    const found = [];
    for (const s of frontier) {
      for (const id of s.adj) {
        if (seen[id]) continue;
        seen[id] = true;
        const n = siteById(state, id);
        if (!n) continue;
        if (n.owner === faction) found.push(n);
        else next.push(n);
      }
    }
    if (found.length) {
      found.sort((x, y) => (x.id < y.id ? -1 : 1));
      return found[0];
    }
    frontier = next;
  }
  const owned = state.sites
    .filter((s) => s.owner === faction && s.id !== start.id)
    .sort((x, y) => distance(asHex(x.hex), asHex(start.hex))
      - distance(asHex(y.hex), asHex(start.hex)) || (x.id < y.id ? -1 : 1));
  return owned[0] ?? null;
}

/**
 * Nearest site owned by `faction` to a bare HEX, by hex distance, ties by id.
 *
 * The hex-anchored twin of `retreatTarget`, which needs a SITE to start its BFS
 * from. It exists because free movement produced a column that has no site to
 * name: see `reverseSquad` below.
 */
function nearestOwnedToHex(state, hex, faction) {
  if (!hex) return null;
  let best = null;
  let bestD = Infinity;
  for (const s of state.sites) {
    if (s.owner !== faction) continue;
    const d = distance(asHex(s.hex), hex);
    if (d < bestD || (d === bestD && best && s.id < best.id)) { best = s; bestD = d; }
  }
  return best;
}

/**
 * Turn an in-flight squad around. It keeps every unit — a retreat is a clean
 * escape and its only cost is time and ground. The remaining trip is the time
 * already travelled, and spawnTick is back-dated so the renderer picks the
 * squad up at the point on the path where it actually turned.
 *
 * BOTH ENDS OF A SQUAD CAN BE NULL, AND THAT STRANDED ARMIES PERMANENTLY. This
 * function anchored entirely on sites — `retreatTarget(state, from ?? to, ...)` —
 * which was sound while every column ran between two buildings. It is not sound
 * under free movement: `marchCamped` sets `from = null` (a column re-tasked off
 * open ground came from no building) and `to` is already null for a march onto
 * bare ground, so a squad that has camped, been re-tasked with `MOVE_SQUAD`, and
 * camped again has NEITHER. `retreatTarget` got `undefined`, resolved no start
 * and returned null, so `cmdRetreatSquad` answered `nowhere-to-retreat` — with
 * friendly sites a couple of hexes away and in easy reach. The Retreat button
 * simply blipped a rejection, forever, for that column.
 *
 * It reads as working in casual testing because a FIRST-generation camped squad
 * still has its origin site in `from` and retreats fine. Only the second hop
 * strands it. It also compounds with the towers: park such a column beside an
 * enemy stronghold and it is ground down with no order that can save it.
 *
 * So the anchor falls back to the one thing a column always has — the hex it is
 * standing on, which is exactly what the squad-path rewrite made knowable.
 * @returns {boolean} false if there is nowhere left to run to
 */
export function reverseSquad(state, squad) {
  const origin = siteById(state, squad.from);
  const abandoned = siteById(state, squad.to);

  // A CAMPED COLUMN IS NOT IN FLIGHT, so there is no trip to halve and nothing
  // to turn around: retreating it is an ordinary march home, which is precisely
  // `marchCamped`'s job. Reusing it rather than repeating the arithmetic also
  // keeps the timing honest — the reversal path below prices the trip as "as far
  // as you have already come", which for a column that has been sitting still
  // for four minutes is not a distance at all.
  if (squad.camped) {
    const home = origin && origin.owner === squad.owner
      ? origin
      : nearestOwnedToHex(state, squadHexOf(state, squad), squad.owner);
    if (!home || !marchCamped(state, squad, { to: home.id })) return false;
    squad.retreating = true;
    return true;
  }

  const home = origin && origin.owner === squad.owner
    ? origin
    : (origin || abandoned
      ? retreatTarget(state, origin ?? abandoned, squad.owner)
      : nearestOwnedToHex(state, squadHexOf(state, squad), squad.owner));
  if (!home) return false;

  const trip = Math.max(1, squad.arriveTick - squad.spawnTick);
  const travelled = Math.max(1, Math.min(trip, state.tick - squad.spawnTick));
  let back = travelled;
  if (home.id !== squad.from && origin) {
    back += travelTicks(state, origin, home, squad.comp, squad.owner);
  }

  squad.from = abandoned ? abandoned.id : squad.from;
  squad.to = home.id;
  squad.retreating = true;
  squad.spawnTick = state.tick - (trip - travelled);
  squad.arriveTick = state.tick + Math.max(1, back);
  // THE PATH HAS TO TURN AROUND TOO. Leaving the outbound one in place would
  // draw the column still marching at the enemy while the sim walked it home,
  // and every position-reading consumer — fog, the towers, the route overlay —
  // would agree with the picture and not with the order. Repathed from where
  // it actually stands, which is the one hex the old model could not name.
  const at = squadHexOf(state, squad) ?? asHex(home.hex);
  squad.path = pathBetweenHexes(state, at, asHex(home.hex), squad.owner)
    ?? [at, asHex(home.hex)];
  squad.camped = false;
  squad.hex = null;
  return true;
}

/**
 * Order a squad that is standing on open ground to march again.
 *
 * A camped squad is the only thing in the game that can be re-tasked without
 * passing through a building, so this is its whole verb. It re-uses
 * `spawnSquad`'s arithmetic by rewriting the same object rather than making a
 * second one: a new id would break every event, order and selection already
 * pointing at this column.
 * @returns {boolean} false when nothing can be walked
 */
export function marchCamped(state, squad, { to = null, toHex = null, waypoints = null }) {
  const at = squadHexOf(state, squad);
  if (!at) return false;
  const dest = resolve(state, to);
  const goal = dest ? asHex(dest.hex) : (toHex ? asHex(toHex) : null);
  if (!goal) return false;
  const stops = waypoints && waypoints.length
    ? [at, ...waypoints.map(asHex), goal] : [at, goal];
  const path = pathThrough(state, stops, squad.owner);
  if (!path) return false;

  squad.from = null;
  squad.to = dest ? dest.id : null;
  squad.path = path;
  squad.spawnTick = state.tick;
  squad.arriveTick = state.tick + ticksAlong(state, path, squad.comp, squad.owner);
  squad.camped = false;
  squad.hex = null;
  return true;
}
