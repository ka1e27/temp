// Routes under the front-line rule (DESIGN §4.4). A squad of owner O marches only through land O holds, neutral land,
// connector tiles, and the land of the settlement it is attacking (territory.js). The route is chosen when the squad
// sets out and never changes afterwards, however the front moves.
//
// Everything here is read-only over the battle and memoised in the territory view, which drops its caches the moment
// any settlement changes hands, so a capture can never leave a stale route behind.
//
// Safety net (player only): if, at this moment, the player has NO legal attack route at all (no owned settlement can
// reach any settlement that is not the player's under the rule, e.g. the only path to the last enemy sites is walled
// in by mountains), the player's routes fall back to the plain cheapest path so the battle can always be won. The
// enemy is never relaxed.
import { getRuntime } from './runtime.js';
import { findPath } from './geom.js';
import { PLAYER_OWNER } from './owner.js';
import { computeTerritory } from './territory.js';

const KEY_SPAN = 4096;

function keyOf(owner, from, to) {
  return ((owner + 2) * KEY_SPAN + from) * KEY_SPAN + to;
}

function makeRoute(rt, startTile, tileObjs) {
  const tiles = tileObjs.map((t) => t.i);
  const points = [Object.freeze({ x: startTile.x, y: startTile.y })];
  let cost = 0;
  for (const t of tileObjs) {
    points.push(Object.freeze({ x: t.x, y: t.y }));
    cost += t.cost;
  }
  return Object.freeze({ tiles: Object.freeze(tiles), points: Object.freeze(points), cost });
}

/** Cheapest path that obeys the front-line rule, or null. Memoised per territory version. */
function strictRoute(battle, terr, owner, fromId, toId) {
  const key = keyOf(owner, fromId, toId);
  if (terr.strict.has(key)) return terr.strict.get(key);
  const rt = getRuntime(battle);
  const from = battle.sites[fromId];
  const to = battle.sites[toId];
  const start = rt.byIndex.get(from.tile);
  const goal = rt.byIndex.get(to.tile);
  let route = null;
  if (start && goal) {
    let path;
    if (terr.enabled) {
      const enemy = terr.enemy;
      const allow = (tile) => {
        if (tile.link) return true;
        const o = terr.owners.get(tile.i);
        if (o === owner || (o !== PLAYER_OWNER && o !== enemy)) return true; // mine, or neutral
        return terr.cell.get(tile.i) === toId; // the land of the settlement under attack
      };
      path = findPath(rt.byKey, start, goal, allow);
    } else {
      path = findPath(rt.byKey, start, goal);
    }
    if (path && path.length > 0) route = makeRoute(rt, start, path);
  }
  terr.strict.set(key, route);
  return route;
}

/** True when the player has no legal route from any owned settlement to any settlement that is not theirs. */
function playerDeadlocked(battle, terr) {
  if (terr.deadlock !== null) return terr.deadlock;
  let found = false;
  for (const s of battle.sites) {
    if (found) break;
    if (s.owner !== PLAYER_OWNER) continue;
    for (const t of battle.sites) {
      if (t.owner === PLAYER_OWNER) continue;
      if (strictRoute(battle, terr, PLAYER_OWNER, s.id, t.id)) { found = true; break; }
    }
  }
  terr.deadlock = !found;
  return terr.deadlock;
}

/**
 * The route a squad of `owner` would take from one settlement to another right now, or null if the front-line rule
 * leaves none (or the two are the same settlement / unknown). Read-only and cached: the returned object is frozen and
 * stays valid as long as the front does not move (it is what `send` uses, so a preview matches the real march).
 * `tiles` are arena tile indices from the first tile entered to the target's tile (the start tile is NOT included, the
 * same format as a squad's `path`); `points` are the world-unit centres of the start tile followed by every tile of
 * `tiles`, so `points.length === tiles.length + 1`; `cost` is the sum of the tile costs entered.
 * @returns {{tiles:number[], points:{x:number,y:number}[], cost:number}|null}
 */
export function routeFor(battle, owner, fromSiteId, toSiteId) {
  const from = battle.sites[fromSiteId];
  const to = battle.sites[toSiteId];
  if (!from || !to || fromSiteId === toSiteId) return null;
  const terr = computeTerritory(battle);
  const key = keyOf(owner, fromSiteId, toSiteId);
  if (terr.routes.has(key)) return terr.routes.get(key);
  let route = strictRoute(battle, terr, owner, fromSiteId, toSiteId);
  if (!route && terr.enabled && owner === PLAYER_OWNER && playerDeadlocked(battle, terr)) {
    const rt = getRuntime(battle);
    const start = rt.byIndex.get(from.tile);
    const goal = rt.byIndex.get(to.tile);
    if (start && goal) {
      const path = findPath(rt.byKey, start, goal);
      if (path && path.length > 0) route = makeRoute(rt, start, path);
    }
  }
  terr.routes.set(key, route);
  return route;
}

/** The route under the front-line rule ONLY (no safety net): null if the rule leaves none. arena.js uses it to see whether
 * a fight really opens on a soft target; `routeFor` is what sends use. */
export function legalRouteFor(battle, owner, fromSiteId, toSiteId) {
  const from = battle.sites[fromSiteId];
  const to = battle.sites[toSiteId];
  if (!from || !to || fromSiteId === toSiteId) return null;
  return strictRoute(battle, computeTerritory(battle), owner, fromSiteId, toSiteId);
}

/** Whether `owner` may send from one settlement to another at all right now. */
export function canRoute(battle, owner, fromSiteId, toSiteId) {
  return routeFor(battle, owner, fromSiteId, toSiteId) !== null;
}

/** Total tile cost of the route (cost-1.0-hex equivalents), or Infinity when there is none. */
export function routeCost(battle, owner, fromSiteId, toSiteId) {
  const route = routeFor(battle, owner, fromSiteId, toSiteId);
  return route ? route.cost : Infinity;
}
