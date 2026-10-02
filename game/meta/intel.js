// Scout and Sabotage (DESIGN §5.7): costs, the scout report and the data the region card's intel
// panel needs. Pure: no DOM, no Date.now, no Math.random, no storage.
//
//   state.intel = { [regionId]: { scouted: boolean, sabotage: 0 | 1 | 2 } }   (see intelState.js)
//
// The state accessors and the sabotage multiplier live in ./intelState.js (a leaf with no meta
// dependencies, so progression.js can import them without a cycle); this module re-exports them
// and adds everything that needs the economy, the upgrades or the battle arena.
import { INTEL } from '../config/intel.js';
import { BATTLE, SITE_TYPES, ENEMY_SCALING } from '../config/battle.js';
import { PLAYER_FACTION } from './state.js';
import { incomePerSec } from './economy.js';
import { levelOf, upgradeCost } from './upgrades.js';
import { playerBattleStats, enemyBattleStats, difficulty } from './progression.js';
import { buildArena, canBuildArena } from '../battle/arena.js';
import { ownerStats, effectiveGrowth, effectiveCap } from '../battle/combat.js';
import { PLAYER_OWNER, FREE_FOLK_OWNER } from '../battle/owner.js';
import { hexDistance, lineBetween } from '../core/hex.js';
import { buildTileIndex, findPath } from '../battle/geom.js';
import {
  ensureIntel, intelOf, sabotageLevel, sabotagePercent,
} from './intelState.js';
import { worksScoutedFree } from './worksEffects.js'; // the leaf (no cycle): a Watchtower next door scouts for free

export * from './intelState.js';

// --- Frontier / tutorial helpers ------------------------------------------------------------------

/** A region the player can act on: exists, is not player-owned, borders a player-owned region. */
function isFrontierRegion(state, world, regionId) {
  const region = world.regions[regionId];
  if (!region || state.owner[regionId] === PLAYER_FACTION) return false;
  return region.neighbors.some((n) => state.owner[n] === PLAYER_FACTION);
}

function ownedCount(state) {
  let n = 0;
  for (const f of state.owner) if (f === PLAYER_FACTION) n += 1;
  return n;
}

/**
 * The tutorial region: while the realm is still just its start region, the frontier region with
 * the best Army Power to Strength ratio (ties: lowest id) - exactly the region the tutorial hint
 * points at (scenes/world.js `resolveAnchor`). Sabotage is ignored so buying it on another
 * region can never move the free scout. -1 once the player owns more than the start region.
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @returns {number} region id, or -1
 */
export function tutorialRegionId(state, world) {
  if (ownedCount(state) !== 1) return -1;
  const clean = { ...state, intel: {} };
  let best = -1;
  let bestRatio = -Infinity;
  for (const region of world.regions) {
    if (!isFrontierRegion(state, world, region.id)) continue;
    if (!canBuildArena(world, state.owner, region.id)) continue; // the lesson never points at a region that cannot be attacked (mountains all along its border)
    const { ratio } = difficulty(clean, world, region.id);
    if (ratio > bestRatio) { bestRatio = ratio; best = region.id; }
  }
  return best;
}

/**
 * True for the one region whose scouting is free: the easiest tier-1 Free Folk region while the
 * player holds only their start region (so at the start of every dynasty, not only the first).
 */
export function isTutorialRegion(state, world, regionId) {
  const region = world.regions[regionId];
  if (!region || region.tier !== 1 || state.owner[regionId] !== 1) return false;
  return tutorialRegionId(state, world) === regionId;
}

// --- Scout ----------------------------------------------------------------------------------------

/**
 * Gold to scout `regionId`: about INTEL.scout.incomeSeconds of current income with a floor;
 * 0 on the tutorial region.
 * @returns {number}
 */
export function scoutCost(state, world, regionId) {
  if (isTutorialRegion(state, world, regionId)) return 0;
  const { incomeSeconds, minCost } = INTEL.scout;
  return Math.max(minCost, Math.round(incomePerSec(state, world) * incomeSeconds));
}

/**
 * Scouted by the player's money OR for free by a Watchtower next door (DESIGN 5.7, 5.8). The Watchtower scouting is never stored: it follows the building.
 * Exported so the map's garrison badges use the very same predicate as the card.
 */
export function isScoutedOrFree(state, world, regionId) {
  return intelOf(state, regionId).scouted || worksScoutedFree(state, world, regionId);
}

/** Frontier region, not scouted yet, and the gold is there. */
export function canScout(state, world, regionId) {
  if (!isFrontierRegion(state, world, regionId)) return false;
  if (isScoutedOrFree(state, world, regionId)) return false; // already scouted, or a Watchtower does it for free
  return state.gold >= scoutCost(state, world, regionId);
}

/**
 * Pays for and records a scouting of `regionId`.
 * @returns {{ cost: number } | false} false when refused (nothing changes)
 */
export function scout(state, world, regionId) {
  if (!canScout(state, world, regionId)) return false;
  const cost = scoutCost(state, world, regionId);
  state.gold -= cost;
  ensureIntel(state)[regionId] = { scouted: true, sabotage: intelOf(state, regionId).sabotage };
  return { cost };
}

// --- Sabotage -------------------------------------------------------------------------------------

function nextSteelCost(state) {
  return upgradeCost('steel', levelOf(state, 'steel'));
}

function pick(list, level) {
  return list[Math.min(level, list.length - 1)];
}

/**
 * Gold for the NEXT sabotage step on `regionId` (level -> level + 1):
 * `max(steelMult[level] x next Steel cost, incomeSeconds[level] x income)`, see config/intel.js.
 * Infinity when the region is already at the maximum (or unknown), so `gold >= cost` is false.
 * @returns {number}
 */
export function sabotageCost(state, world, regionId) {
  const level = sabotageLevel(state, regionId);
  if (!world.regions[regionId] || level >= INTEL.sabotage.maxLevel) return Infinity;
  const cfg = INTEL.sabotage;
  const byUpgrade = pick(cfg.steelMult, level) * nextSteelCost(state);
  const byIncome = pick(cfg.incomeSeconds, level) * incomePerSec(state, world);
  return Math.round(Math.max(byUpgrade, byIncome));
}

/** Scouted, below the maximum, frontier and affordable. */
export function canSabotage(state, world, regionId) {
  if (!isFrontierRegion(state, world, regionId)) return false;
  const { sabotage } = intelOf(state, regionId);
  if (!isScoutedOrFree(state, world, regionId) || sabotage >= INTEL.sabotage.maxLevel) return false;
  return state.gold >= sabotageCost(state, world, regionId);
}

/**
 * Pays for one sabotage step. The caller refreshes the region's difficulty afterwards (it now
 * reads `sabotageTroopMult` through `enemyBattleStats`).
 * @returns {{ cost: number, level: number } | false} false when refused (nothing changes)
 */
export function sabotage(state, world, regionId) {
  if (!canSabotage(state, world, regionId)) return false;
  const cost = sabotageCost(state, world, regionId);
  const level = intelOf(state, regionId).sabotage + 1;
  state.gold -= cost;
  ensureIntel(state)[regionId] = { scouted: true, sabotage: level };
  return { cost, level };
}

/** Fills `{region}` and `{pct}` in one of INTEL.toasts. */
export function intelToast(kind, { region = '', pct = 0 } = {}) {
  return String(INTEL.toasts[kind] || '').replace('{region}', region).replace('{pct}', String(pct));
}

/** "Your agents weakened the garrisons (-15%)" for a battle start, or null when not sabotaged. */
export function sabotageBattleNote(state, regionId) {
  const level = sabotageLevel(state, regionId);
  return level > 0 ? intelToast('battle', { pct: sabotagePercent(level) }) : null;
}

// --- Scout report ---------------------------------------------------------------------------------

/**
 * @typedef {Object} ScoutSite
 * @property {number} id          arena site id: the same id the battle uses (index in arena.sites)
 * @property {number} settlement  world settlement id (index in world.settlements)
 * @property {number} tile        world tile index
 * @property {string} name        settlement name
 * @property {'keep'|'fort'|'tower'|'town'|'village'|'hamlet'} type
 * @property {number} garrison    EXACT starting troops, as buildArena places them (not rounded)
 * @property {number} capMult     the site's cap multiplier as buildArena stamps it (depth, capital, Free Folk)
 * @property {number} x           world-unit tile centre
 * @property {number} y
 * @property {number} elev        tile elevation 0..3, for the elevation contract (topY = cy - elevOffset)
 * @property {boolean} isKeep
 * @property {number} owner       faction id that holds it in the battle (Free Folk for a neutral hamlet)
 * @property {boolean} neutral    a Free Folk hamlet inside a rival region (fights nobody's war)
 */

/**
 * @typedef {Object} ScoutGroup    one composition chip: "Tower 14 x2"
 * @property {string} type @property {string} label @property {number} count
 * @property {number} garrison @property {boolean} neutral
 */

/**
 * @typedef {Object} ScoutReport
 * @property {number} regionId
 * @property {ScoutSite[]} sites            every enemy-side settlement, in arena order
 * @property {ScoutGroup[]} groups          sites grouped for display, keep first
 * @property {number} total                 sum of all garrisons
 * @property {{ id: number, name: string, color: string, colorDark: string, colorLight: string, emblem: string }} faction
 * @property {'passive'|'aggressive'|'defensive'|'swarm'} personality
 * @property {string} personalityLine
 * @property {number} weakPoint             ScoutSite.id of the suggested first strike
 * @property {string} weakPointType
 * @property {string} weakPointReason       one short sentence: why that site
 * @property {string} weakPointGloss        what "weak point" means, in one line (config/intel.js glossary)
 * @property {string[]} notes               at most INTEL.maxNotes short tactical notes
 * @property {number} sabotage              sabotage level the garrisons already reflect
 */

const reportCache = new WeakMap(); // world -> Map(regionId -> { key, report })

function statsKey(player, enemy, owners, level) {
  return [
    owners.join(','), level,
    player.atk, player.def, player.speed, player.campTroops, player.garrisonShare, player.capBonus,
    enemy.troopMult, enemy.atk, enemy.def, enemy.growth, enemy.factionId,
  ].join('|');
}

/** Same rule as buildArena's enemy sites, for a region that is not (yet) adjacent to the player. */
function formulaSites(world, owners, regionId, enemy) {
  const isRival = owners[regionId] !== FREE_FOLK_OWNER;
  const out = [];
  const settlements = world.regions[regionId].settlements
    .map((id) => world.settlements[id]).sort((a, b) => a.id - b.id);
  for (const s of settlements) {
    const neutral = isRival && s.type === 'hamlet';
    out.push({
      id: out.length + 1, settlement: s.id, tile: s.tile, type: s.type,
      owner: neutral ? FREE_FOLK_OWNER : owners[regionId],
      troops: BATTLE.enemyStart[s.type] * (neutral ? 1 : enemy.troopMult),
      capMult: neutral ? ENEMY_SCALING.freeFolkCapMult : (enemy.capMult ?? 1),
    });
  }
  return { sites: out, campTile: null, enemyFaction: owners[regionId], pathFn: null };
}

function enemySitesOf(arena, world) {
  const camp = arena.sites.find((s) => s.type === 'camp');
  const byKey = buildTileIndex(arena.tiles);
  return {
    sites: arena.sites.filter((s) => s.owner !== PLAYER_OWNER && s.type !== 'camp'),
    campTile: camp ? world.tiles[camp.tile] : null,
    enemyFaction: arena.enemyFaction,
    // The march your squads will really take (the same A* the battle uses) through the arena tiles.
    pathFn: (from, to) => findPath(byKey, from, to),
  };
}

/** Straight hex line from `from` to `to`, start excluded, unit terrain cost: the fallback march. */
function straightPath(from, to) {
  return lineBetween(from, to).slice(1).map((t) => ({ q: t.q, r: t.r, cost: 1 }));
}

/**
 * Arrow attrition on the march from your War Camp to each enemy site: every tile of the route that lies
 * inside an enemy tower's range costs (seconds spent crossing it) x (that tower's kills per second), and
 * attacking a tower adds a few more seconds under its own fire (INTEL.weakPoint.towerFightSec). Towers are
 * never within range of another settlement (settlements are 3+ hexes apart, range is 2.6), so this is
 * about the ROUTE, not the target. Sites with no towers on the way cost nothing.
 * @param {ScoutSite[]} sites
 * @param {{ tiles: {q:number,r:number}[] }} world
 * @param {{ q: number, r: number }|null} campTile
 * @param {{ speed: number }} player
 * @param {(from: object, to: object) => {q:number,r:number,cost:number}[]|null} [pathFn]
 * @returns {Map<number, { troops: number, towers: number }>} by site id; `towers` = distinct towers on the route
 */
export function routeExposure(sites, world, campTile, player, pathFn) {
  const out = new Map();
  const towers = sites.filter((s) => s.type === 'tower' && !s.neutral);
  if (!campTile || towers.length === 0) {
    for (const s of sites) out.set(s.id, { troops: 0, towers: 0 });
    return out;
  }
  const { range, volleySec, volleyKills } = SITE_TYPES.tower;
  const kills = volleyKills / volleySec;
  const speed = Math.max(0.01, BATTLE.baseSpeed * player.speed);
  for (const s of sites) {
    const t = world.tiles[s.tile];
    const path = (pathFn && pathFn(campTile, t)) || straightPath(campTile, t);
    let troops = 0;
    const hit = new Set();
    for (const tile of path) {
      for (const tw of towers) {
        const tt = world.tiles[tw.tile];
        if (hexDistance(tile.q, tile.r, tt.q, tt.r) <= range) {
          troops += (tile.cost / speed) * kills;
          hit.add(tw.id);
        }
      }
    }
    if (s.type === 'tower' && !s.neutral) {
      troops += INTEL.weakPoint.towerFightSec * kills;
      hit.add(s.id);
    }
    out.set(s.id, { troops, towers: hit.size });
  }
  return out;
}

/**
 * The suggested first strike (see INTEL.weakPoint). Candidates are enemy sites that are neither the keep
 * nor a neutral hamlet; the keep is the fallback when nothing else is left. Exported for tests;
 * scoutReport is the public entry point.
 * @param {ScoutSite[]} sites
 * @param {{ tiles: {q:number,r:number}[] }} world
 * @param {{ q: number, r: number }|null} campTile  your War Camp's tile (null: no distance bias)
 * @param {Map<number, { troops: number, towers: number }>} [exposure] from routeExposure (none: towers do not matter)
 * @returns {{ site: ScoutSite, reason: string }}
 */
export function chooseWeakPoint(sites, world, campTile, player, enemy, enemyFaction, exposure = new Map()) {
  const cfg = INTEL.weakPoint;
  const speed = Math.max(0.01, BATTLE.baseSpeed * player.speed);
  const pool = sites.filter((s) => !s.isKeep && !s.neutral);
  const anyTower = sites.some((s) => s.type === 'tower' && !s.neutral);
  let best = null;
  let bestScore = Infinity;
  let bestShot = 0;
  const costs = [];
  for (const s of pool) {
    const t = world.tiles[s.tile];
    const dist = campTile ? hexDistance(campTile.q, campTile.r, t.q, t.r) : 0;
    const stats = ownerStats(s.owner, player, enemyFaction, enemy);
    const growth = effectiveGrowth(s.type, s.owner, player, enemyFaction, enemy);
    const cap = effectiveCap(s.type, s.owner, player, s.capMult);
    // Troops grow toward the cap while your first squad marches over; never below where they start.
    const atArrival = Math.max(s.garrison, Math.min(cap, s.garrison + growth * (dist / speed)));
    const shot = exposure.get(s.id)?.troops ?? 0;
    const cost = (atArrival * SITE_TYPES[s.type].def * stats.atk * stats.def + shot) * (1 + cfg.campBiasPerHex * dist);
    costs.push({ s, cost, shot });
    if (cost < bestScore - 1e-9) { bestScore = cost; best = s; bestShot = shot; }
  }
  if (best && best.type !== 'town' && cfg.townPreference > 0) {
    // Towns out-grow everything once held (DESIGN §5.7): take one first when it costs at most 20% more than the softest site.
    const towns = costs.filter((c) => c.s.type === 'town' && c.cost <= bestScore * (1 + cfg.townPreference) + 1e-9);
    if (towns.length) {
      const t = towns.reduce((a, b) => (b.cost < a.cost ? b : a));
      return { site: t.s, reason: 'A town: it out-grows everything once it is yours' };
    }
  }
  if (best) {
    let reason = 'Softest site to take, close to your camp';
    if (bestShot > 0) reason = 'Softest site, even counting tower fire';
    else if (anyTower) reason = 'Softest site, and no tower covers the way in';
    return { site: best, reason };
  }
  const keep = sites.find((s) => s.isKeep) || sites[0];
  return { site: keep, reason: 'Nothing else to take first: go for the keep' };
}

/**
 * Up to INTEL.maxNotes short tactical notes, most useful first:
 *  1. towers that cover the road to the keep (arrow fire on the way in)
 *  2. forts (walls: defence x1.8)
 *  3. other towers, then neutral Free Folk hamlets (free reinforcement points)
 *  4. towns (they out-produce everything else: take them early)
 *  5. a long march from your War Camp to the keep
 *  6. otherwise reassure: no walls or towers, just a fight
 */
export function buildNotes(sites, world, campTile, exposure) {
  const notes = [];
  const keep = sites.find((s) => s.isKeep);
  const towers = sites.filter((s) => s.type === 'tower' && !s.neutral);
  const forts = sites.filter((s) => s.type === 'fort');
  const guarding = keep ? (exposure.get(keep.id)?.towers ?? 0) : 0;

  if (guarding > 0) notes.push(`${guarding === 1 ? 'A tower guards' : `${guarding} towers guard`} the keep road`);
  if (forts.length > 0) notes.push(`${forts.length > 1 ? 'Forts defend' : 'Fort defends'} at ${SITE_TYPES.fort.def}\u00d7`);
  if (towers.length > 0 && guarding === 0) {
    notes.push(`${towers.length > 1 ? `${towers.length} towers shoot` : 'A tower shoots'} within ${SITE_TYPES.tower.range} hexes`);
  }
  const neutral = sites.filter((s) => s.neutral);
  if (neutral.length > 0) notes.push(`${neutral.length} neutral hamlet${neutral.length > 1 ? 's' : ''}: free to take`);
  if (sites.some((s) => s.type === 'town')) notes.push('Towns grow fastest: take them early');
  if (keep && campTile) {
    const kt = world.tiles[keep.tile];
    const hexes = hexDistance(campTile.q, campTile.r, kt.q, kt.r);
    if (hexes >= INTEL.notes.longMarchHexes) notes.push(`Long march: keep is ${hexes} hexes from camp`);
  }
  if (notes.length === 0) notes.push('No walls or towers: a straight fight');
  return notes.slice(0, INTEL.maxNotes);
}

function groupSites(sites) {
  const map = new Map();
  for (const s of sites) {
    const key = `${s.type}|${s.neutral ? 1 : 0}|${Math.round(s.garrison)}`;
    let g = map.get(key);
    if (!g) {
      g = { type: s.type, label: INTEL.siteNames[s.type] || s.type, count: 0, garrison: s.garrison, neutral: s.neutral };
      map.set(key, g);
    }
    g.count += 1;
  }
  const order = (t) => { const i = INTEL.siteOrder.indexOf(t); return i < 0 ? 99 : i; };
  return [...map.values()].sort((a, b) => order(a.type) - order(b.type) || Number(a.neutral) - Number(b.neutral));
}

/**
 * What a scout would learn about `regionId`: every enemy settlement with its EXACT starting
 * garrison (taken from `buildArena`, so it matches the battle that follows), the leader's
 * faction and personality, a suggested weak point and up to two tactical notes.
 *
 * By default it uses the live `playerBattleStats` / `enemyBattleStats`, which include the
 * region's sabotage once `enemyBattleStats` applies `sabotageTroopMult`. Pass explicit stats
 * to preview something else (the contract test does). The result is cached per world, region,
 * ownership, sabotage level and stats, so calling it on every card refresh is cheap; treat it
 * as read-only. Returns null for a player-owned or unknown region.
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @param {number} regionId
 * @param {import('../battle/sim.js').PlayerStats} [playerStats]
 * @param {import('../battle/sim.js').EnemyStats} [enemyStats]
 * @returns {ScoutReport|null}
 */
export function scoutReport(state, world, regionId, playerStats, enemyStats) {
  const region = world.regions[regionId];
  if (!region || state.owner[regionId] === PLAYER_FACTION) return null;
  const player = playerStats || playerBattleStats(state, world, regionId);
  const enemy = enemyStats || enemyBattleStats(world, state, regionId);
  const level = sabotageLevel(state, regionId);

  const key = statsKey(player, enemy, state.owner, level);
  let perWorld = reportCache.get(world);
  if (!perWorld) { perWorld = new Map(); reportCache.set(world, perWorld); }
  const hit = perWorld.get(regionId);
  if (hit && hit.key === key) return hit.report;

  let source;
  try {
    source = enemySitesOf(buildArena(world, state.owner, regionId, player, enemy), world);
  } catch {
    source = formulaSites(world, state.owner, regionId, enemy);
  }
  const { sites: raw, campTile, enemyFaction, pathFn } = source;

  const sites = raw.map((s) => {
    const t = world.tiles[s.tile];
    return {
      id: s.id,
      settlement: s.settlement,
      tile: s.tile,
      name: world.settlements[s.settlement]?.name ?? '',
      type: s.type,
      garrison: s.troops,
      capMult: s.capMult ?? 1,
      x: t.x,
      y: t.y,
      elev: t.elev ?? 0,
      isKeep: s.type === 'keep',
      owner: s.owner,
      neutral: s.owner !== enemyFaction,
    };
  });

  const faction = world.factions[enemyFaction] || world.factions[region.faction];
  const personality = faction.personality;
  const exposure = routeExposure(sites, world, campTile, player, pathFn);
  const weak = chooseWeakPoint(sites, world, campTile, player, enemy, enemyFaction, exposure);

  const report = {
    regionId,
    sites,
    groups: groupSites(sites),
    total: sites.reduce((sum, s) => sum + s.garrison, 0),
    faction: {
      id: faction.id, name: faction.name, color: faction.color,
      colorDark: faction.colorDark, colorLight: faction.colorLight, emblem: faction.emblem,
    },
    personality,
    personalityLine: INTEL.personalityLines[personality] || '',
    weakPoint: weak.site.id,
    weakPointType: weak.site.type,
    weakPointReason: weak.reason,
    weakPointGloss: INTEL.glossary.weakPoint, // plain words for the term, shown in the panel (touch has no hover)
    notes: buildNotes(sites, world, campTile, exposure),
    sabotage: level,
  };
  perWorld.set(regionId, { key, report });
  return report;
}

// --- Region card data -----------------------------------------------------------------------------

/**
 * @typedef {Object} IntelPanelData   what ui/intelPanel.js `update()` takes
 * @property {number} regionId
 * @property {number} gold                   current gold, so the panel can say how much is missing
 * @property {boolean} scouted
 * @property {'watchtower'|null} scoutedBy   set when a Watchtower next door did it (no purchase); the panel can say so
 * @property {number} scoutCost              0 = free
 * @property {ScoutReport|null} report       null until scouted
 * @property {number} sabotage               0..sabotageMax
 * @property {number} sabotageMax
 * @property {number} sabotageStep           fraction per step, 0.15
 * @property {number|null} sabotageCost      null when maxed
 */

/**
 * Everything the region card's intel panel needs for one frontier region, in one call. Cheap
 * enough for the 300 ms card refresh (the scout report is cached).
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @param {number} regionId
 * @returns {IntelPanelData}
 */
export function intelPanelData(state, world, regionId) {
  const { sabotage: level } = intelOf(state, regionId);
  const scouted = isScoutedOrFree(state, world, regionId);
  const cost = sabotageCost(state, world, regionId);
  return {
    regionId,
    gold: state.gold,
    scouted,
    scoutedBy: scouted && !intelOf(state, regionId).scouted ? 'watchtower' : null,
    scoutCost: scouted ? 0 : scoutCost(state, world, regionId),
    report: scouted ? scoutReport(state, world, regionId) : null,
    sabotage: level,
    sabotageMax: INTEL.sabotage.maxLevel,
    sabotageStep: INTEL.sabotage.step,
    sabotageCost: Number.isFinite(cost) ? cost : null,
  };
}
