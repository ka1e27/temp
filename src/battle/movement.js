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
 * Create a squad. `arriveTick` may be requested (the AI synchronizes a wave,
 * and so does the Rally booster) but never brought FORWARD — a wave can only
 * ever hold back for its slowest element, so this cannot become a cheat.
 */
export function spawnSquad(state, { owner, from, to, comp, retreating = false, arriveTick = 0 }) {
  const a = resolve(state, from);
  const b = resolve(state, to);
  const natural = state.tick + travelTicks(state, a, b, comp, owner);
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

  squad.from = abandoned ? abandoned.id : squad.from;
  squad.to = home.id;
  squad.retreating = true;
  squad.spawnTick = state.tick - (trip - travelled);
  squad.arriveTick = state.tick + Math.max(1, back);
  return true;
}
