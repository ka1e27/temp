// Squad movement.
//
// Squads NEVER integrate position. Travel time is computed ONCE at spawn and
// stored as `arriveTick`; the sim only ever asks "is arriveTick === tick?".
// That kills an entire class of drift bug and makes the tick O(arrivals)
// rather than O(squads). The renderer interpolates spawnTick -> arriveTick.
// PURE.
import { findPath, distance } from '../core/hex.js';
import { TICK_HZ } from '../core/loop.js';
import { UNITS, UNIT_IDS, MOVEMENT } from '../content/balance.js';
import { siteById, isBlocked } from './state.js';
import { inGrid } from './mapgen.js';
import { speedMultiplierFor, asHex } from './influence.js';
import { emptyComp, addComp } from './combat.js';

// Blocked hexes never change mid-battle, so a site-pair path is computed once
// per battle. Keyed by battleId so two battles in one process never share.
/** @type {Record<string, any>} */
const pathCache = {};

export function clearPathCache() {
  for (const key of Object.keys(pathCache)) delete pathCache[key];
}

const resolve = (state, s) => (typeof s === 'string' ? siteById(state, s) : s);

/** Inclusive hex path between two sites, or null if terrain seals them off. */
export function pathBetween(state, from, to) {
  const a = resolve(state, from);
  const b = resolve(state, to);
  if (!a || !b) return null;
  const ck = `${state.battleId}|${a.id}>${b.id}`;
  if (ck in pathCache) return pathCache[ck];
  const passable = (h) => inGrid(state.grid, h) && !isBlocked(state, h.q, h.r);
  const path = findPath(asHex(a.hex), asHex(b.hex), passable);
  pathCache[ck] = path;
  return path;
}

/** A stack marches at the pace of its slowest unit — one ram halves a militia
 *  stack, which is exactly what telegraphs a siege push. */
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
  const path = pathBetween(state, a, b);
  const hexes = path ? path.length - 1 : distance(asHex(a.hex), asHex(b.hex));
  if (hexes <= 0) return MOVEMENT.minTicks;

  const secPerHex = MOVEMENT.hexSecondsPerSpeed / slowestSpeed(comp);
  let terrain = 0;
  const route = path ?? [asHex(a.hex), asHex(b.hex)];
  for (const h of route) terrain += speedMultiplierFor(state, faction, h);
  terrain = route.length ? terrain / route.length : 1;

  const march = state.mods?.[faction]?.marchSpeedMult || 1;
  const seconds = (hexes * secPerHex) / (terrain * march);
  return Math.max(MOVEMENT.minTicks, Math.round(seconds * TICK_HZ));
}

/**
 * Ticks to march a whole chain of sites, and the cumulative fraction of the
 * journey completed at the end of each leg.
 *
 * A chained send is ONE squad with a longer path, not a relay of squads that
 * stop and re-form: `arriveTick` is still computed once at spawn and the sim
 * still only ever asks "is arriveTick === tick?". The legs exist purely so the
 * renderer can pace a piece along a polyline instead of a single arc — which is
 * why `ends` is stored rather than recomputed per frame.
 *
 * @returns {{ticks:number, ends:number[]}} PURE.
 */
export function routeTicks(state, route, comp, faction) {
  const legs = [];
  let ticks = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const t = travelTicks(state, route[i], route[i + 1], comp, faction);
    legs.push(t);
    ticks += t;
  }
  ticks = Math.max(MOVEMENT.minTicks, ticks);
  const ends = [];
  let acc = 0;
  for (const t of legs) { acc += t; ends.push(acc / ticks); }
  if (ends.length) ends[ends.length - 1] = 1;   // exact, never 0.9999
  return { ticks, ends };
}

/**
 * Create a squad. `arriveTick` may be requested (the AI synchronizes a wave,
 * and so does the Rally booster) but never brought FORWARD — a wave can only
 * ever hold back for its slowest element, so this cannot become a cheat.
 *
 * `via` is an ordered list of intermediate site ids for a chained send. The
 * squad keeps `from`/`to` as the first and last stop, so retreat, arrival and
 * the AI all keep working on it without knowing chains exist.
 */
export function spawnSquad(state, {
  owner, from, to, comp, retreating = false, arriveTick = 0, via = null,
}) {
  const a = resolve(state, from);
  const b = resolve(state, to);
  const stops = via && via.length
    ? [a ? a.id : String(from), ...via, b ? b.id : String(to)]
    : null;
  const plan = stops ? routeTicks(state, stops, comp, owner) : null;
  const natural = state.tick + (plan ? plan.ticks : travelTicks(state, a, b, comp, owner));
  const squad = {
    id: state.nextSquadId++,
    owner,
    from: a ? a.id : String(from),
    to: b ? b.id : String(to),
    comp: addComp(emptyComp(), comp),
    spawnTick: state.tick,
    arriveTick: Math.max(natural, arriveTick | 0),
    retreating: !!retreating,
  };
  if (stops) { squad.route = stops; squad.legEnds = plan.ends; }
  state.squads.push(squad);
  return squad;
}

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
 * Turn an in-flight squad around. It keeps every unit — a retreat is a clean
 * escape and its only cost is time and ground. The remaining trip is the time
 * already travelled, and spawnTick is back-dated so the renderer picks the
 * squad up at the point on the path where it actually turned.
 * @returns {boolean} false if there is nowhere left to run to
 */
export function reverseSquad(state, squad) {
  const origin = siteById(state, squad.from);
  const abandoned = siteById(state, squad.to);
  const home = origin && origin.owner === squad.owner
    ? origin
    : retreatTarget(state, origin ?? abandoned, squad.owner);
  if (!home) return false;

  const trip = Math.max(1, squad.arriveTick - squad.spawnTick);
  const travelled = Math.max(1, Math.min(trip, state.tick - squad.spawnTick));
  let back = travelled;
  if (home.id !== squad.from && origin) {
    back += travelTicks(state, origin, home, squad.comp, squad.owner);
  }

  // A chained squad running for its own start point retreats back down the road
  // it came in on. Anywhere else and the chain is meaningless, so it is dropped
  // and the squad falls back to the plain two-point reversal.
  if (squad.route) {
    if (home.id === squad.route[0]) {
      const back2 = squad.route.slice().reverse();
      squad.legEnds = routeTicks(state, back2, squad.comp, squad.owner).ends;
      squad.route = back2;
    } else {
      delete squad.route;
      delete squad.legEnds;
    }
  }

  squad.from = abandoned ? abandoned.id : squad.from;
  squad.to = home.id;
  squad.retreating = true;
  squad.spawnTick = state.tick - (trip - travelled);
  squad.arriveTick = state.tick + Math.max(1, back);
  return true;
}
