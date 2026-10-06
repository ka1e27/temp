// The sea in the sim (PLAN-PHASE12): sea-lane routes, the Tide Fortress's Tide and its sea reinforcements, and the Admiral's Broadside.
// Pure: no DOM, no Math.random, no Date.now. Every number is in config/sea.js. The arena side (lanes, harbours, tide tiles) is
// seaArena.js; routing.js asks laneRoute, step() calls processSea.
//
//   battle.sea = { tide: { nextAt, warned, floodUntil, n }, reinforceAt, broadside: { until, perSec, acc: { [siteId]: n } },
//                  drowned?, landed? }  (lazy; drowned: troops the Tide took, landed: troops the boats brought)
//
// Events: tideRising { site, at, tiles, x, y, radius } (the telegraph, TIDE.telegraphSec ahead), tideFlood { site, until, tiles, x, y },
//         tideEbb { site }, tideHit { squad, owner, lost, x, y } (a squad caught on a flooded tile), seaReinforce { site, to, count, x, y }
//         (a boat lands troops at the fortress), broadsideHit { site, count, x, y } (whole troops lost to Broadside).
import { TIDE, BROADSIDE } from '../config/sea.js';
import { PLAYER_OWNER } from './owner.js';
import { getRuntime, tileAt } from './runtime.js';

/** The sea state, created lazily (a battle saved before Phase 12 has none). */
export function seaState(battle) {
  if (!battle.sea || typeof battle.sea !== 'object') battle.sea = { tide: null, reinforceAt: null, broadside: null };
  return battle.sea;
}

function pos(battle, site) {
  const t = site ? tileAt(battle, site.tile) : null;
  return t ? { x: t.x, y: t.y } : { x: 0, y: 0 };
}

/** True when `owner` holds a harbour (port site) in this battle: the boats that sail the lanes are there. */
export function holdsPort(battle, owner) {
  return battle.sites.some((s) => s.port && s.owner === owner);
}

/** True when `owner` is the arena's 'raider' (the Sea Kings): its longships sail between ANY two coastal sites it holds. */
function isLongships(battle, owner) {
  return owner === battle.arena.enemyFaction && !!battle.enemy && battle.enemy.personality === 'raider';
}

/**
 * The sea-lane route from one site to another for `owner`, or null. A lane is usable only between two sites the owner holds, while it
 * holds a harbour: for the player (and any faction but the raider) both ends must be harbours (PLAN: "between two ports held by the same
 * owner"); the raider's longships sail between any two of its coastal sites. Same shape as routing.js routes plus `lane: true`.
 */
export function laneRoute(battle, owner, fromId, toId) {
  const sea = battle.arena.sea;
  if (!sea || !Array.isArray(sea.lanes) || !sea.lanes.length) return null;
  const from = battle.sites[fromId];
  const to = battle.sites[toId];
  if (!from || !to || from.owner !== owner || to.owner !== owner || !from.coastal || !to.coastal) return null;
  if (!isLongships(battle, owner) && !(from.port && to.port)) return null;
  if (!holdsPort(battle, owner)) return null;
  const lane = sea.lanes.find((l) => (l.a === fromId && l.b === toId) || (l.a === toId && l.b === fromId));
  if (!lane) return null;
  const rt = getRuntime(battle);
  const seaTiles = lane.a === fromId ? lane.tiles : lane.tiles.slice().reverse();
  const tiles = [...seaTiles, to.tile];
  const start = rt.byIndex.get(from.tile);
  const points = [Object.freeze({ x: start.x, y: start.y })];
  let cost = 0;
  for (const i of tiles) {
    const t = rt.byIndex.get(i);
    if (!t) return null;
    points.push(Object.freeze({ x: t.x, y: t.y }));
    cost += t.cost;
  }
  return Object.freeze({ tiles: Object.freeze(tiles), points: Object.freeze(points), cost, lane: true });
}

/** The tile a squad stands on now (the one it is leaving until halfway, then the one it enters). */
function squadTile(battle, squad) {
  if (!squad.path || !squad.path.length) return battle.sites[squad.from] ? battle.sites[squad.from].tile : null;
  const seg = Math.min(squad.seg, squad.path.length - 1);
  if (seg === 0 && squad.prog < 0.5) return battle.sites[squad.from] ? battle.sites[squad.from].tile : squad.path[0];
  return squad.prog < 0.5 && seg > 0 ? squad.path[seg - 1] : squad.path[seg];
}

/** The Tide (sim.js step via processSea): telegraph, flood, the 30% loss to squads caught on the flooded tiles, the ebb. */
function processTide(battle, t) {
  const tide = battle.arena.sea && battle.arena.sea.tide;
  if (!tide) return;
  const st = seaState(battle);
  if (!st.tide) st.tide = { nextAt: TIDE.everySec, warned: false, floodUntil: -1, n: 0, done: false };
  const s = st.tide;
  if (s.done) return;
  const keep = battle.sites[tide.site];
  const foe = battle.arena.enemyFaction;
  if (!keep || keep.owner !== foe) { // the fortress fell: the tide no longer answers it
    s.done = true;
    if (t < s.floodUntil) battle.events.push({ type: 'tideEbb', site: tide.site });
    return;
  }
  if (!s.warned && t + 1e-9 >= s.nextAt - TIDE.telegraphSec) {
    s.warned = true;
    battle.events.push({ type: 'tideRising', site: keep.id, at: s.nextAt, tiles: tide.tiles.slice(), radius: TIDE.radius, ...pos(battle, keep) });
  }
  if (t + 1e-9 >= s.nextAt) {
    s.floodUntil = s.nextAt + TIDE.floodSec;
    s.n += 1;
    s.nextAt += TIDE.everySec;
    s.warned = false;
    battle.events.push({ type: 'tideFlood', site: keep.id, until: s.floodUntil, tiles: tide.tiles.slice(), ...pos(battle, keep) });
  }
  if (s.floodUntil < 0) return;
  if (t + 1e-9 >= s.floodUntil) {
    if (s.floodUntil > 0) battle.events.push({ type: 'tideEbb', site: keep.id });
    s.floodUntil = -1;
    return;
  }
  const flooded = new Set(tide.tiles);
  const immune = !!(battle.player.boons && battle.player.boons.tideImmune); // the Drowned Crown (PLAN-PHASE12)
  for (const q of battle.squads) {
    if (q.owner === foe || q.lane || q.tide === s.n || q.state === 'assault') continue;
    if (q.owner === PLAYER_OWNER && immune) continue;
    const at = squadTile(battle, q);
    if (at == null || !flooded.has(at)) continue;
    const lost = q.count * TIDE.loss;
    q.count -= lost;
    q.tide = s.n;
    st.drowned = (st.drowned || 0) + lost; // the tally (results screen, tools)
    const p = tileAt(battle, at);
    battle.events.push({ type: 'tideHit', squad: q.id, owner: q.owner, lost: Math.round(lost), x: p ? p.x : 0, y: p ? p.y : 0 });
  }
}

/** The fortress's reinforcements by sea: while its owner holds the fortress's harbour, a boat lands troops at the keep. */
function processReinforce(battle, t) {
  const tide = battle.arena.sea && battle.arena.sea.tide;
  if (!tide || tide.harbour == null) return;
  const st = seaState(battle);
  if (st.reinforceAt == null) st.reinforceAt = TIDE.reinforce.everySec;
  if (t + 1e-9 < st.reinforceAt) return;
  st.reinforceAt += TIDE.reinforce.everySec;
  const foe = battle.arena.enemyFaction;
  const keep = battle.sites[tide.site];
  const harbour = battle.sites[tide.harbour];
  if (!keep || !harbour || keep.owner !== foe || harbour.owner !== foe) return; // holding its harbour stops them (PLAN 12B)
  const count = Math.max(TIDE.reinforce.minTroops, Math.round(TIDE.reinforce.growthSec * (keep.growth || 0)));
  keep.troops += count;
  st.landed = (st.landed || 0) + count; // the tally (results screen, tools)
  battle.events.push({ type: 'seaReinforce', site: harbour.id, to: keep.id, count, ...pos(battle, harbour) });
}

/** Starts Broadside (abilities.js): for `duration` s every coastal enemy site loses `perSec` of its troops a second. */
export function startBroadside(battle, t, duration = BROADSIDE.duration, perSec = BROADSIDE.perSec) {
  const st = seaState(battle);
  st.broadside = { until: t + duration, perSec, acc: {} };
  return battle.sites.filter((s) => s.coastal && s.owner !== PLAYER_OWNER).map((s) => s.id);
}

function processBroadside(battle, dt, t) {
  const st = battle.sea;
  const b = st && st.broadside;
  if (!b || t > b.until + 1e-9) return;
  for (const s of battle.sites) {
    if (!s.coastal || s.owner === PLAYER_OWNER || !(s.troops > 0)) continue;
    const lost = s.troops * b.perSec * dt;
    s.troops -= lost;
    b.acc[s.id] = (b.acc[s.id] || 0) + lost;
    if (b.acc[s.id] >= 1) {
      const count = Math.floor(b.acc[s.id]);
      b.acc[s.id] -= count;
      battle.events.push({ type: 'broadsideHit', site: s.id, count, ...pos(battle, s) });
    }
  }
}

/** One tick of the sea (sim.js step): the Tide, the fortress's reinforcements, Broadside. Nothing at all on a land continent. */
export function processSea(battle, dt, t) {
  if (battle.result) return;
  if (battle.arena.sea && battle.arena.sea.tide) {
    processTide(battle, t);
    processReinforce(battle, t);
  }
  if (battle.sea && battle.sea.broadside) processBroadside(battle, dt, t);
}
