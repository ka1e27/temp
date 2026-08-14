// Squad movement.
//
// Squads STILL never integrate position. Travel time is computed ONCE at spawn
// and stored as `arriveTick`; the sim only ever asks "is arriveTick === tick?".
// That kills an entire class of drift bug and makes the tick O(arrivals) rather
// than O(squads). What changed is only where the interpolation happens ALONG:
// the squad now carries the actual `path` it walks, and `squadHexOf` reads a
// position off it as a pure function of `state.tick`. Nothing is written per
// tick, so replay and determinism are exactly as they were.
//
// THE OLD MODEL WAS A STRAIGHT LINE BETWEEN TWO SITES and that was visible.
// `squadHex` lerped from one site's hex to the other's, so a column routing
// around a mountain range was drawn marching straight over it, and every
// consumer of a squad's position — fog, the route overlay, and now the towers
// that shoot at it — was reading a place the army was not. Storing the path the
// A* already produced costs one array per squad and makes the position true.
//
// A SQUAD MAY NOW END ON BARE GROUND. `to` is a site id or null; a squad whose
// destination is not a site arrives and CAMPS there (`camped`, `hex`) instead of
// resolving an arrival, and can be ordered on again later. That is what lets an
// army take a position rather than only shuttle between buildings.
// PURE.
import { findPath, distance, round } from '../core/hex.js';
import { TICK_HZ } from '../core/loop.js';
import { UNITS, UNIT_IDS, MOVEMENT } from '../content/balance.js';
import { siteById, isBlocked } from './state.js';
import { inGrid } from './mapgen.js';
import { speedMultiplierFor, asHex } from './influence.js';
import { passableFor } from './occupancy.js';
import { emptyComp, addComp } from './combat.js';

// A path is memoised per (battle, faction, pair, map version).
//
// This cache used to be keyed on the site pair alone, on the premise — stated
// right here — that "blocked hexes never change mid-battle". That premise died
// with free movement: a base denies its hex, ownership flips constantly, and the
// route that was open a moment ago now runs through somebody's farm. So the key
// carries BOTH the faction (a hex hostile to you is open to them) and
// `influenceVersion`, which `recomputeOccupancy` bumps on every flip. Stale
// entries are simply never looked at again; `clearPathCache` still empties it
// between battles.
/** @type {Record<string, any>} */
const pathCache = {};

export function clearPathCache() {
  for (const key of Object.keys(pathCache)) delete pathCache[key];
}

const resolve = (state, s) => (typeof s === 'string' ? siteById(state, s) : s);

/**
 * Inclusive hex path between two sites, or null when nothing gets through.
 *
 * `faction` is who is marching. Omit it and you get the old terrain-only answer,
 * which is what map generation and `verifyReachable` want — they ask whether the
 * GROUND connects, not whether an army may cross it today.
 */
export function pathBetween(state, from, to, faction = null) {
  const a = resolve(state, from);
  const b = resolve(state, to);
  if (!a || !b) return null;
  const ck = `${state.battleId}|${faction ?? '-'}|${a.id}>${b.id}|${state.influenceVersion || 0}`;
  if (ck in pathCache) return pathCache[ck];
  const path = pathBetweenHexes(state, asHex(a.hex), asHex(b.hex), faction);
  pathCache[ck] = path;
  return path;
}

/**
 * The same A*, between two bare HEXES rather than two sites.
 *
 * `pathBetween` is now a thin wrapper on this. It exists because a destination
 * is no longer always a building: an army can be sent to open ground, and a
 * waypointed march is several of these stitched end to end. Deliberately NOT
 * cached — the site-pair cache is keyed on ids and there is no bounded key
 * space for arbitrary hex pairs, so a cache here would grow without limit over
 * a fifteen-minute battle. Call it once at spawn and keep the answer, which is
 * exactly what `spawnSquad` does.
 */
export function pathBetweenHexes(state, a, b, faction = null) {
  const goal = asHex(b);
  const passable = faction
    ? passableFor(state, faction, goal)
    : (h) => inGrid(state.grid, h) && !isBlocked(state, h.q, h.r);
  return findPath(asHex(a), goal, passable);
}

/**
 * Stitch a route through `waypoints`, so the PLAYER picks the road rather than
 * the engine picking the shortest one.
 *
 * Each leg is a separate A*, which is what makes the detour real: pathing
 * start -> end directly would throw the waypoints away, and that is the whole
 * order. A leg that cannot be walked fails the WHOLE route rather than being
 * skipped — silently dropping an unreachable waypoint would march the army
 * somewhere the player did not point at, which is worse than a refusal.
 *
 * @param {Array<{q:number,r:number}>} stops start, ...waypoints, goal
 * @returns {Array<{q:number,r:number}>|null} inclusive hex path, or null
 */
export function pathThrough(state, stops, faction = null) {
  if (!stops || stops.length < 2) return null;
  const out = [asHex(stops[0])];
  for (let i = 1; i < stops.length; i++) {
    const leg = pathBetweenHexes(state, out[out.length - 1], stops[i], faction);
    if (!leg) return null;
    // `leg[0]` is where we already stand; appending it would double the hex and
    // give that step of the march twice the weight in every position derived
    // from path length.
    for (let j = 1; j < leg.length; j++) out.push(leg[j]);
  }
  return out;
}

/**
 * A stack marches at the pace of its slowest unit — one ram halves a militia
 * stack, which is exactly what telegraphs a siege push.
 *
 * A HARD `Math.min` IS DELIBERATE, AND THE OBVIOUS OBJECTION TO IT WAS BUILT,
 * MEASURED AND REVERTED. This is the one stack-wide term in the game that is
 * not share-scaled — `counters`, `sunder`, `repair` and `skirmish` all scale by
 * how much of the stack is the unit in question — so replacing it with the
 * slot-weighted harmonic mean of the stack's speeds looks like consistency, and
 * it has the rare property of being provably unable to help the dominant
 * loadout (a one-type stack's weighted mean IS its only member, so mono-militia
 * does not move by construction). At a 700-slot budget it is worth a lot of
 * pace:
 *
 *     loadout          MIN pace     slot-weighted
 *     default spread   2.53 s/hex   1.59 s/hex     (1.6x faster)
 *     no rams          1.69         1.28
 *     mono militia     1.38         1.38           unchanged
 *
 * MEASURED AT n=48 ON FIVE REGIONS, IT BOUGHT THE DEFAULT SPREAD NOTHING:
 * 75/58/58/29/27 became 79/54/52/40/23 — net +1 point across the five, well
 * inside the noise — while the mono-militia gap went 43.6 -> 44.8 average, i.e.
 * very slightly WIDER. Making the mixed army sixty percent faster did not move
 * its win rate at all.
 *
 * THAT IS THE USEFUL PART, and it retires a hypothesis this file's own comments
 * used to carry: march speed is NOT what rams cost you. Dropping rams is worth
 * +23 to +40 points even when the speed penalty is weighted away, so their cost
 * is entirely their SLOTS — which is the older, independently measured finding
 * (23 rams make 276 siege DPS where the 471 militia they displace make 283, at
 * a third of the field power) arriving from the other direction. See CLAUDE.md
 * for the full table; do not re-spend this measurement.
 */
export function slowestSpeed(comp) {
  let s = Infinity;
  for (const u of UNIT_IDS) if ((comp?.[u] || 0) > 0) s = Math.min(s, UNITS[u].speed);
  return Number.isFinite(s) ? s : UNITS.militia.speed;
}

/**
 * Whole ticks for `comp` to march from one site to another: hex path length
 * divided by the slowest unit's speed, modified by the average territory
 * multiplier along the route and the faction's marchSpeedMult.
 * @returns {number} integer >= MOVEMENT.minTicks
 */
export function travelTicks(state, from, to, comp, faction) {
  const a = resolve(state, from);
  const b = resolve(state, to);
  if (!a || !b) return MOVEMENT.minTicks;
  const path = pathBetween(state, a, b, faction);
  const route = path ?? [asHex(a.hex), asHex(b.hex)];
  return ticksAlong(state, route, comp, faction);
}

/**
 * Whole ticks to walk an already-resolved `route`.
 *
 * Split out of `travelTicks` because the route is now decided BEFORE the cost
 * is: a waypointed march is a path the player drew, and pricing it by
 * re-pathing between its endpoints would charge for the short way round and
 * hand the detour out for free. Both callers reach the same arithmetic, which
 * is the point — the route the army walks and the time it is charged cannot
 * disagree.
 * @returns {number} integer >= MOVEMENT.minTicks
 */
export function ticksAlong(state, route, comp, faction) {
  const hexes = route ? route.length - 1 : 0;
  if (hexes <= 0) return MOVEMENT.minTicks;

  const secPerHex = MOVEMENT.hexSecondsPerSpeed / slowestSpeed(comp);
  // TERRAIN IS AVERAGED OVER THE ROUTE, not sampled per step, and that is what
  // keeps position a pure function of tick: `squadHexOf` paces the path
  // uniformly, so a per-hex cost would put the drawn column somewhere the
  // arithmetic never agreed to.
  let terrain = 0;
  for (const h of route) terrain += speedMultiplierFor(state, faction, h);
  terrain = route.length ? terrain / route.length : 1;

  const march = state.mods?.[faction]?.marchSpeedMult || 1;
  const seconds = (hexes * secPerHex) / (terrain * march);
  return Math.max(MOVEMENT.minTicks, Math.round(seconds * TICK_HZ));
}

/**
 * Where a squad is RIGHT NOW, as a hex.
 *
 * Lives here rather than in vision.js (which re-exports it, so every existing
 * import still works) because it is the other half of `spawnSquad`: the path
 * and the reading-off of it are one mechanism, and they were in two files only
 * because fog happened to be the first consumer that needed a position.
 *
 * Pure in `state.tick`, so a squad still stores no position and a replay lands
 * a column on exactly the hex the original run did.
 */
export function squadHexOf(state, sq) {
  if (sq.camped && sq.hex) return asHex(sq.hex);
  const path = sq.path;
  if (!path || !path.length) return null;
  const last = path.length - 1;
  const span = Math.max(1, sq.arriveTick - sq.spawnTick);
  const f = Math.max(0, Math.min(1, (state.tick - sq.spawnTick) / span));
  const t = f * last;
  const i = Math.min(last, Math.floor(t));
  const j = Math.min(last, i + 1);
  const k = t - i;
  const a = path[i];
  const b = path[j];
  return round({ q: a.q + (b.q - a.q) * k, r: a.r + (b.r - a.r) * k });
}

/**
 * Create a squad. `arriveTick` may be requested (the AI synchronizes a wave,
 * and so does the Rally booster) but never brought FORWARD — a wave can only
 * ever hold back for its slowest element, so this cannot become a cheat.
 *
 * There is no `via` any more. A chained send existed to express several legal
 * adjacent hops as one order, because a send could not otherwise cross ground
 * it did not border; free movement makes that a plain march, so the route, the
 * per-leg fractions and the whole validation ladder behind them are gone.
 */
export function spawnSquad(state, {
  owner, from, to, comp, retreating = false, arriveTick = 0,
  fromHex = null, toHex = null, waypoints = null,
}) {
  const a = resolve(state, from);
  const b = resolve(state, to);
  const start = a ? asHex(a.hex) : asHex(fromHex);
  const goal = b ? asHex(b.hex) : asHex(toHex);

  // THE PATH IS AN INVARIANT, never a maybe. Every position derived from a
  // squad reads it, so a squad without one would be an army with no location —
  // and the failure would look like fog working rather than like a bug, which
  // is precisely how the empty-vision default nearly shipped. When A* finds
  // nothing (a route that closed behind an order already given) the straight
  // line is the honest fallback: it is what `travelTicks` has always priced.
  const stops = waypoints && waypoints.length
    ? [start, ...waypoints.map(asHex), goal]
    : [start, goal];
  const path = pathThrough(state, stops, owner) ?? [start, goal];

  const natural = state.tick + ticksAlong(state, path, comp, owner);
  const squad = {
    id: state.nextSquadId++,
    owner,
    from: a ? a.id : (from == null ? null : String(from)),
    // `to` is null for a march onto BARE GROUND. arrivals.js reads exactly that
    // to decide between resolving a fight and making camp, so the null is the
    // order rather than a missing value.
    to: b ? b.id : (to == null ? null : String(to)),
    comp: addComp(emptyComp(), comp),
    path,
    spawnTick: state.tick,
    arriveTick: Math.max(natural, arriveTick | 0),
    retreating: !!retreating,
    camped: false,
    hex: null,
  };
  state.squads.push(squad);
  return squad;
}
