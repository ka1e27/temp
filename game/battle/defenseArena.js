// buildDefenseArena (ARCHITECTURE §10.3, DESIGN §10.1): the arena for a raid on one of the player's regions. Pure: no DOM, no
// Math.random, no Date.now.
//
// It is the attack arena turned around. `arena.regionId` is the DEFENDED region (the player's), `arena.enemyFaction` is the
// raider, and the halo is the RAIDER's land next to it, so the front-line rule (territory.js) works unchanged: the region's tiles
// belong to their nearest settlement's owner, the halo is the raider's, and nobody marches through the other side's land.
//   site 0           the war-band camp (owner: the raider) on the raider's border tile nearest the keep
//   then             the region's settlements, held by the player with their militia garrisons
//   then             the Arrow Tower fortification, if the region has one (a real tower site, `fort: 'tower'`)
//   then             the raider's own settlements in the halo, with a share of their usual garrison
// Walls multiply the keep's and forts' defence (`site.defMult`), a Beacon speeds the player's squads (`arena.playerSpeedMult`).
// Busy regions (another battle's target) are left out of the halo and busy settlements left out entirely (DESIGN §10.5).
import { BATTLE, SITE_TYPES } from '../config/battle.js';
import { TERRAIN_COST } from '../config/world.js';
import { FRONTIER } from '../config/frontier.js';
import { GRUDGES } from '../config/grudges.js';
import {
  hexDistance, hexRadiusToWorld, buildTileIndex, findPath, axialNeighbors, hexKey,
} from './geom.js';
import { PLAYER_OWNER } from './owner.js';
import { fortEffects, fortTowerTiles } from './fortSites.js';

/**
 * The key a settlement has in a battle manager's `busy().sites` set: `"regionId:index"`, where index is the settlement's
 * position in `world.regions[regionId].settlements` (ARCHITECTURE §10.1).
 */
export function busyKey(world, settlementId) {
  const s = world.settlements[settlementId];
  if (!s) return '';
  return `${s.region}:${world.regions[s.region].settlements.indexOf(settlementId)}`;
}

/** Normalises a busy description ({ regions: Set|number[], sites: Set|string[] } or nothing) into two Sets. */
export function normalizeBusy(busy) {
  const toSet = (v) => (v instanceof Set ? v : new Set(Array.isArray(v) ? v : []));
  return { regions: toSet(busy && busy.regions), sites: toSet(busy && busy.sites) };
}

/** Lexicographic less-than of two equal-length number arrays. */
function lexLess(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

function isBusySettlement(world, busy, settlementId) {
  return busy.sites.size > 0 && busy.sites.has(busyKey(world, settlementId));
}

const walkCache = new WeakMap();
/** q,r -> tile for every passable tile (and, with BATTLE.approachCrossesMountains, every land tile), cached per world. */
function walkIndex(world) {
  let idx = walkCache.get(world);
  if (!idx) {
    idx = buildTileIndex(world.tiles.filter((t) => t.passable || (BATTLE.approachCrossesMountains && t.land)));
    walkCache.set(world, idx);
  }
  return idx;
}

/** The raider's passable tiles within BATTLE.arenaPlayerDepth hexes of the region (busy regions left out). */
function raiderHalo(world, owners, region, attacker, busy) {
  const depth = BATTLE.arenaPlayerDepth;
  const pad = hexRadiusToWorld(depth) * 1.2;
  const b = region.bbox;
  const cells = region.tiles.map((i) => world.tiles[i]);
  const halo = [];
  for (const t of world.tiles) {
    if (!t.passable || t.region < 0 || owners[t.region] !== attacker || busy.regions.has(t.region)) continue;
    if (t.x < b.minX - pad || t.x > b.maxX + pad || t.y < b.minY - pad || t.y > b.maxY + pad) continue;
    let near = false;
    for (const c of cells) if (hexDistance(t, c) <= depth) { near = true; break; }
    if (near) halo.push(t);
  }
  return halo;
}

/** Tiles of the region reachable from its keep through the region's own passable tiles (the pocket a raid must reach). */
function keepPocket(world, region) {
  const tiles = region.tiles.map((i) => world.tiles[i]).filter((t) => t.passable);
  const byKey = buildTileIndex(tiles);
  const keep = world.tiles[world.settlements[region.keep].tile];
  const seen = new Set([keep.i]);
  const queue = [keep];
  while (queue.length) {
    const cur = queue.shift();
    for (const n of axialNeighbors(cur.q, cur.r)) {
      const nt = byKey.get(hexKey(n.q, n.r));
      if (!nt || seen.has(nt.i)) continue;
      seen.add(nt.i);
      queue.push(nt);
    }
  }
  return { tiles, pocket: seen, keep };
}

/**
 * Where the war band makes camp: `{ camp, strip }` or null. The camp stands on a raider tile touching the region's keep pocket
 * (preferring the raiding region `fromRegionId`, a tile not on or next to a settlement, then the shortest march to the keep).
 * A border of mountains is crossed by a strip of at most BATTLE.corridorMaxTiles no-man's-land tiles, as attack arenas do.
 */
function placeCamp(world, owners, region, attacker, fromRegionId, halo, pocketInfo, busy) {
  const { pocket, keep } = pocketInfo;
  const settlementTiles = new Set(world.settlements.map((s) => s.tile));
  const nearSettlement = (t) => settlementTiles.has(t.i)
    || axialNeighbors(t.q, t.r).some((n) => { const nt = walkIndex(world).get(hexKey(n.q, n.r)); return nt && settlementTiles.has(nt.i); });
  const pocketKeys = new Set([...pocket].map((i) => hexKey(world.tiles[i].q, world.tiles[i].r)));
  const border = halo.filter((t) => axialNeighbors(t.q, t.r).some((n) => pocketKeys.has(hexKey(n.q, n.r))));
  if (border.length) {
    const arenaTiles = [...pocketInfo.tiles, ...halo];
    const byKey = buildTileIndex(arenaTiles);
    let best = null;
    let bestKey = null;
    for (const t of border) {
      const path = findPath(byKey, t, keep);
      const cost = path ? path.reduce((s, p) => s + p.cost, 0) : Infinity;
      const key = [t.region === fromRegionId ? 0 : 1, nearSettlement(t) ? 1 : 0, cost, t.i];
      if (!bestKey || lexLess(key, bestKey)) {
        best = t;
        bestKey = key;
      }
    }
    return { camp: best, strip: [] };
  }
  // No passable border: a short strip of no-man's-land from the pocket to the raider's nearest passable tile (0-1 BFS by the
  // number of tiles outside the region; the camp tile itself is not part of the strip).
  const index = walkIndex(world);
  const cap = BATTLE.corridorMaxTiles;
  const regionSet = new Set(region.tiles);
  const dist = new Map();
  const parent = new Map();
  const queue = [];
  for (const i of [...pocket].sort((a, b) => a - b)) { dist.set(i, 0); queue.push(world.tiles[i]); }
  let found = null;
  let foundKey = null;
  for (let h = 0; h < queue.length; h++) {
    const a = queue[h];
    const d = dist.get(a.i);
    for (const n of axialNeighbors(a.q, a.r)) {
      const b = index.get(hexKey(n.q, n.r));
      if (!b || dist.has(b.i)) continue;
      const nd = regionSet.has(b.i) ? d : d + 1;
      if (regionSet.has(b.i) && !b.passable) continue; // the region's own mountains are not a road
      if (nd > cap + 1) continue;
      dist.set(b.i, nd);
      parent.set(b.i, a);
      queue.push(b);
      if (b.passable && b.region >= 0 && owners[b.region] === attacker && !busy.regions.has(b.region)) {
        const key = [nd, b.region === fromRegionId ? 0 : 1, hexDistance(b, keep), b.i];
        if (!foundKey || lexLess(key, foundKey)) {
          found = b;
          foundKey = key;
        }
      }
    }
  }
  if (!found) return null;
  const strip = [];
  for (let t = parent.get(found.i); t && !pocket.has(t.i); t = parent.get(t.i)) if (!regionSet.has(t.i)) strip.push(t);
  return { camp: found, strip };
}

const buildableCache = new WeakMap();

/**
 * Can a raid by `attacker` on the player's region be fought here at all? True when the region is the player's and the raider has
 * land touching it (or within a short strip over mountains). Cached per world, ownership and raider: the scheduler asks often.
 * @returns {boolean}
 */
export function canBuildDefenseArena(world, owners, regionId, attacker) {
  let perWorld = buildableCache.get(world);
  if (!perWorld) buildableCache.set(world, (perWorld = new Map()));
  const key = `${regionId}|${attacker}|${owners.join(',')}`;
  if (perWorld.has(key)) return perWorld.get(key);
  let ok = false;
  try {
    const region = world.regions[regionId];
    if (region && owners[regionId] === PLAYER_OWNER && Array.isArray(world.tiles) && world.tiles.length) {
      const busy = normalizeBusy(null);
      const halo = raiderHalo(world, owners, region, attacker, busy);
      ok = !!placeCamp(world, owners, region, attacker, -1, halo, keepPocket(world, region), busy);
    }
  } catch { ok = false; }
  if (perWorld.size > 4000) perWorld.clear();
  perWorld.set(key, ok);
  return ok;
}

/**
 * @param {object} world World contract (ARCHITECTURE §4).
 * @param {number[]} owners current owner faction id per region id (the defended region must be the player's, 0).
 * @param {number} regionId the region being raided.
 * @param {object} opts
 * @param {number} opts.attackerFaction the raiding faction id
 * @param {number} [opts.fromRegionId] the raiding region (the camp prefers its border)
 * @param {object} opts.player PlayerStats
 * @param {object} opts.enemy EnemyStats of the war band (meta/frontier.js raidEnemyStats); `enemy.campTroops` is the camp
 * @param {{type:string, level:number}[]} [opts.forts] the region's fortifications
 * @param {number[]} [opts.militia] garrison per settlement, in `region.settlements` order (meta/militia.js militiaGarrisons,
 *   Militia Hall already applied); missing entries use FRONTIER.militia.perType
 * @param {number} [opts.towerTroops] the Arrow Tower's garrison (default FRONTIER.militia.towerFort)
 * @param {number} [opts.militiaCapMult] scales the player's caps on the militia sites (default 1)
 * @param {{regions:Set<number>, sites:Set<string>}} [opts.busy] what other battles hold (see busyKey)
 * @param {number} [opts.siegeSec] the siege timer (default FRONTIER.siegeSecByTier by the region's tier)
 * @param {{faction:number, leader:string}|boolean} [opts.vendetta] a Vendetta: adds `arena.vendetta` and `arena.champion`
 *   ({ troops, power, launchSec }: the Champion squad, GRUDGES.vendetta.champion)
 * @returns {object} Arena with `mode: 'defense'`, `siegeSec`, `fromRegionId`, `campSite` (0), `keepSite`
 */
export function buildDefenseArena(world, owners, regionId, opts = {}) {
  const region = world.regions[regionId];
  if (!region) throw Object.assign(new Error(`buildDefenseArena: no such region ${regionId}`), { code: 'no-region' });
  if (owners[regionId] !== PLAYER_OWNER) throw Object.assign(new Error(`buildDefenseArena: region ${regionId} is not the player's`), { code: 'not-owned' });
  const attacker = opts.attackerFaction;
  if (!(attacker > PLAYER_OWNER)) throw Object.assign(new Error('buildDefenseArena: attackerFaction is required'), { code: 'no-attacker' });
  const busy = normalizeBusy(opts.busy);
  const player = opts.player || {};
  const enemy = opts.enemy || {};
  const fromRegionId = opts.fromRegionId ?? -1;

  const pocketInfo = keepPocket(world, region);
  const halo = raiderHalo(world, owners, region, attacker, busy);
  const placed = placeCamp(world, owners, region, attacker, fromRegionId, halo, pocketInfo, busy);
  if (!placed) throw Object.assign(new Error(`buildDefenseArena: faction ${attacker} has no way into region ${regionId}`), { code: 'no-passable-border' });
  const keepSettlement = world.settlements[region.keep];
  if (isBusySettlement(world, busy, keepSettlement.id)) {
    throw Object.assign(new Error(`buildDefenseArena: the keep of region ${regionId} is in another battle`), { code: 'busy' });
  }

  const tileSet = new Map();
  for (const t of pocketInfo.tiles) tileSet.set(t.i, t);
  for (const t of halo) tileSet.set(t.i, t);
  tileSet.set(placed.camp.i, placed.camp);
  for (const t of placed.strip) tileSet.set(t.i, t);
  const linkIds = new Set(placed.strip.map((t) => t.i));

  const effects = fortEffects(opts.forts);
  const capMult = Math.max(1, opts.militiaCapMult ?? 1);
  const militiaPer = FRONTIER.militia.perType;
  const sites = [];
  const campTroops = enemy.campTroops ?? FRONTIER.warBand.campTroops * (enemy.troopMult ?? 1);
  sites.push({
    id: 0, settlement: -1, tile: placed.camp.i, type: 'camp', owner: attacker, troops: campTroops,
    // the camp holds its whole war band (x warBand.capMult headroom): a raid must not bleed away before it strikes
    capMult: Math.max(enemy.capMult ?? 1, campTroops / SITE_TYPES.camp.cap) * FRONTIER.warBand.capMult,
  });

  let keepSite = -1;
  const order = region.settlements.map((id, idx) => ({ s: world.settlements[id], idx })).sort((a, b) => a.s.id - b.s.id);
  for (const { s, idx } of order) {
    if (!tileSet.has(s.tile) || isBusySettlement(world, busy, s.id)) continue;
    const militia = Array.isArray(opts.militia) && Number.isFinite(opts.militia[idx]) ? opts.militia[idx] : militiaPer[s.type] ?? 0;
    const site = {
      id: sites.length, settlement: s.id, tile: s.tile, type: s.type, owner: PLAYER_OWNER,
      troops: Math.max(BATTLE.playerGarrisonFloor, militia), capMult: enemy.capMult ?? 1, pCapMult: capMult,
    };
    if ((s.type === 'keep' || s.type === 'fort') && effects.wallsMult !== 1) site.defMult = effects.wallsMult;
    if (s.type === 'keep') keepSite = site.id;
    sites.push(site);
  }
  if (effects.towerLevel > 0) {
    const occupied = new Set(sites.map((x) => x.tile));
    const tile = fortTowerTiles(world, regionId, 1).find((i) => tileSet.has(i) && !occupied.has(i));
    if (tile !== undefined) {
      sites.push({
        id: sites.length, settlement: -1, tile, type: 'tower', owner: PLAYER_OWNER, fort: 'tower',
        troops: Math.max(BATTLE.playerGarrisonFloor, opts.towerTroops ?? FRONTIER.militia.towerFort),
        capMult: enemy.capMult ?? 1, pCapMult: capMult, range: effects.towerRange, volleySec: effects.towerVolleySec,
        volleyKills: effects.towerKills * (opts.towerKillScale ?? 1),
      });
    }
  }
  const haloIds = new Set(halo.map((t) => t.i));
  const raiderSettlements = world.settlements
    .filter((s) => haloIds.has(s.tile) && owners[s.region] === attacker && s.tile !== placed.camp.i && !isBusySettlement(world, busy, s.id))
    .sort((a, b) => a.id - b.id);
  for (const s of raiderSettlements) {
    sites.push({
      id: sites.length, settlement: s.id, tile: s.tile, type: s.type, owner: attacker,
      troops: Math.max(1, (BATTLE.enemyStart[s.type] ?? 0) * (enemy.troopMult ?? 1) * FRONTIER.warBand.haloShare),
      capMult: enemy.capMult ?? 1,
    });
  }

  const allTiles = [...tileSet.values()].sort((a, b) => a.i - b.i);
  const tiles = allTiles.map((t) => {
    const tile = { i: t.i, q: t.q, r: t.r, x: t.x, y: t.y, cost: t.cost, terrain: t.terrain, region: t.region };
    if (!t.passable) { tile.terrain = 'hills'; tile.cost = TERRAIN_COST.hills; tile.pass = true; }
    if (t.region !== regionId) tile.own = t.region >= 0 && owners[t.region] != null ? owners[t.region] : -1;
    if (linkIds.has(t.i)) tile.link = true;
    return tile;
  });
  const focus = {
    minX: Math.min(...allTiles.map((t) => t.x)), maxX: Math.max(...allTiles.map((t) => t.x)),
    minY: Math.min(...allTiles.map((t) => t.y)), maxY: Math.max(...allTiles.map((t) => t.y)),
  };
  const siegeTable = FRONTIER.siegeSecByTier;
  const siegeSec = opts.siegeSec ?? siegeTable[Math.min(Math.max(0, region.tier), siegeTable.length - 1)]
    * (region.isCapital ? FRONTIER.capitalSiegeMult : 1);
  const arena = {
    mode: 'defense', regionId, enemyFaction: attacker, fromRegionId, tiles, sites, focus,
    marches: placed.strip.length ? [{ to: keepSite, tiles: placed.strip.map((t) => t.i), approach: true }] : [],
    siegeSec, campSite: 0, keepSite,
  };
  if (effects.speedMult !== 1) arena.playerSpeedMult = effects.speedMult;
  // a Vendetta (PLAN-PHASE4 §4D): the leader's Champion marches with the war band (battle/champion.js)
  if (opts.vendetta) {
    const v = typeof opts.vendetta === 'object' ? opts.vendetta : {};
    const cfg = GRUDGES.vendetta.champion;
    arena.vendetta = { faction: attacker, leader: typeof v.leader === 'string' ? v.leader : '' };
    // Oathkeeper (PLAN-PHASE7): opts.noChampion, the Vendetta comes without its Champion
    if (!opts.noChampion) arena.champion = { troops: Math.max(1, Math.round(campTroops * cfg.share)), power: cfg.power, launchSec: cfg.launchSec };
  }
  return arena;
}
