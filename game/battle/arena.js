// buildArena: assembles the Arena for a battle (ARCHITECTURE §6, DESIGN §4.1). Pure: no DOM,
// no Math.random, no Date.now — only reads `world`/`owners` and the two stat blocks.
import { BATTLE, SITE_TYPES, ENEMY_SCALING } from '../config/battle.js';
import {
  hexDistance, hexRadiusToWorld, buildTileIndex, findPath, axialNeighbors, hexKey,
} from './geom.js';
import { PLAYER_OWNER, FREE_FOLK_OWNER } from './owner.js';
import { legalRouteFor } from './routing.js';
import { computeTerritory } from './territory.js';
import { TERRAIN_COST } from '../config/world.js';
import { busyKey, normalizeBusy } from './defenseArena.js';
import { fortEffects, fortTowerTiles } from './fortSites.js';
import { FEATURES } from '../config/features.js';
import { banditTile, ancientTowerTile, gateTile, shrineTiles } from '../world/regionFeatures.js';
import { decorateSea, touchingFords } from './seaArena.js';

function isAdjacentToPlayer(world, owners, regionId) {
  return world.regions[regionId].neighbors.some((n) => owners[n] === PLAYER_OWNER);
}

/** Player-owned passable tiles within `BATTLE.arenaPlayerDepth` hexes of the region. */
function playerHaloTiles(world, owners, region, busyRegions = null) {
  const regionAxial = region.tiles.map((i) => world.tiles[i]);
  const depth = BATTLE.arenaPlayerDepth;
  // Cheap bbox pre-filter (world units) before the exact per-tile hex-distance check —
  // keeps this fast on a full-size generated world, not just this module's small fixture.
  const pad = hexRadiusToWorld(depth) * 1.2;
  const bbox = {
    minX: region.bbox.minX - pad, maxX: region.bbox.maxX + pad,
    minY: region.bbox.minY - pad, maxY: region.bbox.maxY + pad,
  };
  const halo = [];
  for (const t of world.tiles) {
    if (!t.passable || t.region === -1 || owners[t.region] !== PLAYER_OWNER) continue;
    if (busyRegions && busyRegions.has(t.region)) continue; // another battle's target (DESIGN §10.5)
    if (t.x < bbox.minX || t.x > bbox.maxX || t.y < bbox.minY || t.y > bbox.maxY) continue;
    let minDist = Infinity;
    for (const rt of regionAxial) {
      const d = hexDistance(t, rt);
      if (d < minDist) minDist = d;
      if (minDist === 0) break;
    }
    if (minDist <= depth) halo.push(t);
  }
  return halo;
}

/** Player-owned passable tiles directly adjacent (hex-distance 1) to the target region. */
function borderTilesOf(world, haloTiles, region) {
  const regionTileSet = new Set(region.tiles);
  const byKey = new Map();
  for (const i of region.tiles) {
    const t = world.tiles[i];
    byKey.set(hexKey(t.q, t.r), true);
  }
  return haloTiles.filter((t) => axialNeighbors(t.q, t.r).some((n) => byKey.has(hexKey(n.q, n.r))));
}

/** Lexicographic less-than of two equal-length number arrays. */
function lexLess(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

/**
 * Picks the War Camp tile among the border tiles: preferring (not requiring) one that isn't on/adjacent to an existing
 * settlement, then the one from which the most settlements other than the keep can legally be attacked at the start (so
 * the first drag from the camp has soft targets; front lines, DESIGN §4.4), then the one that reaches the most of the
 * player's own halo settlements, then the nearest by in-arena path cost to the keep.
 * @param {(tile: object) => {soft:number, ally:number}} [reach] what a camp on this tile could legally reach
 */
function chooseCampTile(world, borderCandidates, arenaByKey, keepTile, settlementTileSet, reach = () => ({ soft: 0, ally: 0 })) {
  const nearSettlement = (t) => settlementTileSet.has(t.i)
    || axialNeighbors(t.q, t.r).some((n) => {
      for (const st of settlementTileSet) {
        const st2 = world.tiles[st];
        if (st2.q === n.q && st2.r === n.r) return true;
      }
      return false;
    });

  const rank = (t) => {
    const path = findPath(arenaByKey, t, keepTile);
    const cost = path ? path.reduce((sum, p) => sum + p.cost, 0) : Infinity;
    return cost;
  };

  const preferred = borderCandidates.filter((t) => !nearSettlement(t));
  const pool = preferred.length ? preferred : borderCandidates;
  let best = null;
  let bestKey = null;
  for (const t of pool) {
    const r = reach(t);
    const key = [-r.soft, -r.ally, rank(t), t.i]; // lexicographic, smaller is better
    if (!bestKey || lexLess(key, bestKey)) {
      bestKey = key;
      best = t;
    }
  }
  return best;
}

/** BFS reachability check within a tile set (unweighted — connectivity only). */
function reachableSet(byKey, startTile) {
  const seen = new Set([hexKey(startTile.q, startTile.r)]);
  const queue = [startTile];
  while (queue.length) {
    const cur = queue.shift();
    for (const n of axialNeighbors(cur.q, cur.r)) {
      const k = hexKey(n.q, n.r);
      if (seen.has(k)) continue;
      const nt = byKey.get(k);
      if (!nt) continue;
      seen.add(k);
      queue.push(nt);
    }
  }
  return seen;
}

const walkIndexCache = new WeakMap();

/**
 * q,r -> tile for the tiles an approach strip may use (cached per world: worlds are immutable once generated): every passable
 * tile, and with `BATTLE.approachCrossesMountains` the impassable land (mountains) too.
 */
function walkIndex(world) {
  const withPass = BATTLE.approachCrossesMountains;
  let cached = walkIndexCache.get(world);
  if (!cached) walkIndexCache.set(world, (cached = {}));
  const key = withPass ? 'pass' : 'plain';
  if (!cached[key]) cached[key] = buildTileIndex(world.tiles.filter((t) => t.passable || (withPass && t.land)));
  return cached[key];
}

/**
 * How the War Camp reaches the target. The camp must stand on a passable player tile from which the target's own passable land
 * (the pocket its keep sits in) can be walked, and the walk may leave the arena's tile set (the target's passable tiles plus the
 * player's halo) for at most `BATTLE.corridorMaxTiles` tiles: the approach strip, a short neutral border march.
 * A 0-1 search outward from the target pocket, free inside the tile set and 1 per tile outside it, finds out:
 *   - `direct`: border tiles (halo tiles touching a target tile) from which the pocket is reachable inside the tile set,
 *     the ordinary case (the camp is then picked among them by chooseCampTile);
 *   - else `camp` + `strip`: the player tile with the shortest strip (fewest tiles outside the tile set; the camp itself is not
 *     one of them), for borders made of mountains, which no tile of the halo crosses; a strip may climb the ridge itself
 *     (`BATTLE.approachCrossesMountains`, those tiles then become `pass` hills in the arena);
 *   - else `null`: no passable approach within the cap, the region cannot be attacked from the current border.
 * @returns {{ direct: object[], camp: object|null, strip: object[] }|null}
 */
function planApproach(world, owners, tileSet, targetTiles, keepTile, border) {
  const cap = BATTLE.corridorMaxTiles;
  const pocketKeys = reachableSet(buildTileIndex(targetTiles), keepTile);
  const sources = targetTiles.filter((t) => pocketKeys.has(hexKey(t.q, t.r))).sort((a, b) => a.i - b.i);
  const index = walkIndex(world);
  // Cost of a step into a tile: 0 inside the tile set, 16 for a tile outside it, one more for a mountain (so among strips of
  // the same length the one that climbs less wins). Costs stay below 16 x (cap + 1) because a strip has at most cap tiles.
  const STEP = 16;
  const stepInto = (b) => (tileSet.has(b.i) ? 0 : STEP + (b.passable ? 0 : 1));
  const dist = new Map();
  const parent = new Map();
  const buckets = new Map([[0, sources.slice()]]);
  for (const t of sources) dist.set(t.i, 0);
  for (let L = 0; L <= STEP * cap + cap; L++) {
    const level = buckets.get(L);
    if (!level) continue;
    for (let h = 0; h < level.length; h++) { // `level` grows while free (cost 0) neighbours are appended
      const a = level[h];
      if (dist.get(a.i) !== L) continue; // reached cheaper since it was queued
      for (const n of axialNeighbors(a.q, a.r)) {
        const b = index.get(hexKey(n.q, n.r));
        if (!b) continue;
        const nd = L + stepInto(b);
        const old = dist.get(b.i);
        if (Math.floor(nd / STEP) > cap || (old !== undefined && old <= nd)) continue;
        dist.set(b.i, nd);
        parent.set(b.i, a);
        if (!buckets.has(nd)) buckets.set(nd, []);
        buckets.get(nd).push(b);
      }
    }
  }

  const direct = border.filter((t) => dist.get(t.i) === 0);
  if (direct.length) return { direct, camp: null, strip: [] };

  let camp = null;
  let campKey = null;
  for (const [i, d] of [...dist.entries()].sort((a, b) => a[0] - b[0])) {
    const t = world.tiles[i];
    if (!t.passable || t.region < 0 || owners[t.region] !== PLAYER_OWNER) continue; // the camp stands on the player's own passable land
    const cost = d - stepInto(t); // the camp tile itself is not part of the strip
    const key = [Math.floor(cost / STEP), cost % STEP, hexDistance(t, keepTile), i];
    if (!campKey || lexLess(key, campKey)) { campKey = key; camp = t; }
  }
  if (!camp) return null;
  const sourceSet = new Set(sources.map((t) => t.i));
  const strip = [];
  for (let t = parent.get(camp.i); t && !sourceSet.has(t.i); t = parent.get(t.i)) if (!tileSet.has(t.i)) strip.push(t);
  return { direct: [], camp, strip };
}

/**
 * Everything buildArena needs before it creates a single site, or the reason it cannot: `{ code, message }` with code
 * 'no-region' | 'owned' | 'not-adjacent' | 'no-passable-border'.
 */
function planArena(world, owners, regionId, busy = null) {
  const region = world.regions[regionId];
  if (!region) return { code: 'no-region', message: `buildArena: no such region ${regionId}` };
  if (owners[regionId] === PLAYER_OWNER) return { code: 'owned', message: `buildArena: region ${regionId} is already player-owned` };
  if (!isAdjacentToPlayer(world, owners, regionId)) {
    return { code: 'not-adjacent', message: `buildArena: region ${regionId} is not adjacent to any player-owned region` };
  }
  const targetTiles = region.tiles.map((i) => world.tiles[i]).filter((t) => t.passable);
  const halo = playerHaloTiles(world, owners, region, busy ? busy.regions : null);
  const tileSet = new Map(); // world tile index -> tile
  for (const t of targetTiles) tileSet.set(t.i, t);
  for (const t of halo) tileSet.set(t.i, t);
  const keepTile = world.tiles[world.settlements[region.keep].tile];
  const border = borderTilesOf(world, halo, region);
  const approach = planApproach(world, owners, tileSet, targetTiles, keepTile, border);
  if (!approach) {
    return { code: 'no-passable-border', message: `buildArena: no passable approach from the player's land to region ${regionId} (mountains in the way)` };
  }
  return { region, targetTiles, halo, tileSet, keepTile, border, approach };
}

/**
 * Can an arena be built for this attack? True for every region next to the player's land whose border the army can walk:
 * a passable border tile, or a short strip of no-man's-land (at most `BATTLE.corridorMaxTiles` tiles) to the player's
 * nearest passable land. False for a region that is already the player's, not adjacent, or walled off by mountains
 * ("No passable border: conquer a neighbour first"). Never throws; costs about one buildArena without the sites.
 * @param {object} world
 * @param {number[]} owners current owner faction id per region id
 * @param {number} regionId
 * @returns {boolean}
 */
export function canBuildArena(world, owners, regionId) {
  return approachSummary(world, owners, regionId).code === null;
}

/**
 * Why an attack on this region is not possible, or null when it is: 'no-region' | 'owned' | 'not-adjacent' |
 * 'no-passable-border' | 'unbuildable' (a world with no usable tile data). For the region card: only 'no-passable-border' reads "No passable border: conquer a neighbour first".
 * @returns {string|null}
 */
export function arenaBlockedReason(world, owners, regionId) {
  return approachSummary(world, owners, regionId).code;
}

/**
 * How many tiles long the War Camp's approach strip is when this region is attacked from the current border: 0 for an ordinary
 * border (the camp touches the target), 1..BATTLE.corridorMaxTiles for a border of mountains, null when the region cannot be
 * attacked at all. The difficulty card charges for it (DIFFICULTY.approachPerTile): such fights play harder than they read.
 * @returns {number|null}
 */
export function approachTiles(world, owners, regionId) {
  const sum = approachSummary(world, owners, regionId);
  return sum.code === null ? sum.tiles : null;
}

const summaryCache = new WeakMap();

/**
 * `{ code, tiles }` for a region: the block reason (null when the arena can be built) and the approach strip length. What
 * decides it is only which regions the player owns, so it is remembered per world and ownership: the card asks about every
 * frontier region on every refresh.
 */
function approachSummary(world, owners, regionId) {
  let perWorld = summaryCache.get(world);
  if (!perWorld) summaryCache.set(world, (perWorld = new Map()));
  let mask = '';
  for (let i = 0; i < owners.length; i++) mask += owners[i] === PLAYER_OWNER ? '1' : '0';
  const key = `${regionId}|${mask}`;
  let sum = perWorld.get(key);
  if (!sum) {
    let plan;
    try { plan = planArena(world, owners, regionId); } catch { plan = { code: 'unbuildable' }; } // a world without tile data (a test fixture) has no arenas
    sum = 'code' in plan ? { code: plan.code, tiles: 0 } : { code: null, tiles: plan.approach.strip.length };
    if (perWorld.size > 4000) perWorld.clear();
    perWorld.set(key, sum);
  }
  return sum;
}

/**
 * @param {object} world World contract (ARCHITECTURE §4).
 * @param {number[]} owners current owner faction id per region id.
 * @param {number} regionId the target region to attack.
 * @param {object} player PlayerStats.
 * @param {object} enemy EnemyStats.
 * @param {object} [opts]
 * @param {{regions:Set<number>, sites:Set<string>}} [opts.busy] what other running battles hold (ARCHITECTURE §10.1, DESIGN §10.5):
 *   regions that are another battle's target are left out of the halo, and settlements in `busy.sites` ("regionId:index",
 *   see defenseArena.js busyKey) are left out of the arena. A busy target throws an Error with `code: 'busy'`.
 * @param {{type:string, level:number}[]} [opts.forts] fortifications the target's occupier captured (DESIGN §10.2): an Arrow
 *   Tower becomes an enemy tower site, Walls multiply the enemy keep's and forts' defence.
 * @returns {object} Arena (ARCHITECTURE §6).
 */
export function buildArena(world, owners, regionId, player, enemy, opts = {}) {
  const busy = normalizeBusy(opts.busy);
  if (busy.regions.has(regionId)) throw Object.assign(new Error(`buildArena: region ${regionId} is already being fought over`), { code: 'busy' });
  const plan = planArena(world, owners, regionId, busy);
  if ('code' in plan) throw Object.assign(new Error(plan.message), { code: plan.code });
  const {
    region, targetTiles, halo, tileSet, keepTile, approach,
  } = plan;
  for (const t of touchingFords(world, region, tileSet)) tileSet.set(t.i, t); // PLAN-PHASE12: an island battle includes the fords touching it

  // A border of mountains: the camp stands on the nearest player land and a short strip of no-man's-land leads to the target.
  const stripTiles = approach.strip;
  for (const t of approach.camp ? [approach.camp, ...stripTiles] : []) tileSet.set(t.i, t);

  const arenaByKeyForCamp = buildTileIndex([...tileSet.values()]);
  const allSettlementTileIds = new Set(world.settlements.map((s) => s.tile));

  // --- Sites other than the camp (the camp is always site 0, the others follow in this order) -----
  const rest = [];
  const targetSettlements = region.settlements
    .map((id) => world.settlements[id])
    .filter((s) => tileSet.has(s.tile) && !(busy.sites.size && busy.sites.has(busyKey(world, s.id))))
    .sort((a, b) => a.id - b.id);
  const isRivalRegion = owners[regionId] !== FREE_FOLK_OWNER;
  const captured = opts.forts ? fortEffects(opts.forts) : null; // an occupied region's fortifications fight for the occupier
  for (const s of targetSettlements) {
    const isNeutralHamlet = isRivalRegion && s.type === 'hamlet';
    const owner = isNeutralHamlet ? FREE_FOLK_OWNER : owners[regionId];
    const troopMult = isNeutralHamlet ? 1 : enemy.troopMult;
    // Enemy caps scale with depth, capitals get a bonus, Free Folk sites cap lower (DESIGN §4.6): one number per
    // site, fixed here. `enemy.capMult` already holds depth x capital x Free Folk for the region's own owner.
    const capMult = isNeutralHamlet ? ENEMY_SCALING.freeFolkCapMult : (enemy.capMult ?? 1);
    const site = {
      id: rest.length + 1, settlement: s.id, tile: s.tile, type: s.type, owner,
      troops: BATTLE.enemyStart[s.type] * troopMult * (!isNeutralHamlet && (s.type === 'tower' || s.type === 'fort') ? (enemy.fortTroopMult ?? 1) : 1) // Merchant Princes (PLAN-PHASE5)
        * (!isNeutralHamlet && s.type === 'keep' ? (enemy.keepTroopMult ?? 1) : 1), // Kingslayer (PLAN-PHASE7)
      capMult,
    };
    if (captured && captured.wallsMult !== 1 && (s.type === 'keep' || s.type === 'fort')) site.defMult = captured.wallsMult;
    rest.push(site);
  }
  if (captured && captured.towerLevel > 0) {
    const occupied = new Set(rest.map((x) => x.tile));
    const tile = fortTowerTiles(world, regionId, 1).find((i) => tileSet.has(i) && !occupied.has(i));
    if (tile !== undefined) {
      rest.push({
        id: rest.length + 1, settlement: -1, tile, type: 'tower', owner: owners[regionId], fort: 'tower',
        troops: BATTLE.enemyStart.tower * enemy.troopMult * (enemy.fortTroopMult ?? 1), capMult: enemy.capMult ?? 1,
        range: captured.towerRange, volleySec: captured.towerVolleySec, volleyKills: captured.towerKills,
      });
    }
  }

  // A varied map (DESIGN §10.13): the region's type and twist add sites (tiles from world/regionFeatures.js)
  const features = opts.noFeatures ? { type: null, twist: null } : { type: region.type || null, twist: region.twist || null };
  addFeatureSites(world, region, features, rest, tileSet, owners[regionId], enemy);

  const haloTileIds = new Set(halo.map((t) => t.i));
  const playerSettlements = world.settlements
    .filter((s) => haloTileIds.has(s.tile) && owners[s.region] === PLAYER_OWNER && !(busy.sites.size && busy.sites.has(busyKey(world, s.id))))
    .sort((a, b) => a.id - b.id);
  for (const s of playerSettlements) {
    const cap = SITE_TYPES[s.type].cap + player.capBonus;
    rest.push({
      id: rest.length + 1, settlement: s.id, tile: s.tile, type: s.type, owner: PLAYER_OWNER,
      troops: Math.max(player.garrisonShare * cap, BATTLE.playerGarrisonFloor), // never paper-thin: a raid must not take it for free
    });
  }

  // Front lines (DESIGN §4.4): every tile has an owner. Tiles of the target region are owned live by their nearest
  // settlement (territory.js); every other tile carries the owner its region had when the arena was built (`own`:
  // the player's halo is the player's). Connector tiles added to keep every site reachable are `link`: open to all.
  const toArenaTile = (t) => {
    const tile = {
      i: t.i, q: t.q, r: t.r, x: t.x, y: t.y, cost: t.cost, terrain: t.terrain, region: t.region,
    };
    // a pass over a ridge (approach strip): the mountain becomes a hill tile the army can walk, flagged `pass`
    if (!t.passable) {
      tile.terrain = 'hills';
      tile.cost = TERRAIN_COST.hills;
      tile.pass = true;
    }
    if (t.region !== regionId) tile.own = t.region >= 0 && owners[t.region] != null ? owners[t.region] : -1;
    return tile;
  };
  const enemyFaction = owners[regionId];
  const baseTiles = [...tileSet.values()].sort((a, b) => a.i - b.i).map(toArenaTile);
  const campSite = (tile) => ({ id: 0, settlement: -1, tile, type: 'camp', owner: PLAYER_OWNER, troops: player.campTroops });

  /** What a camp on `t` could legally attack or reach at the start, judged on the arena as it stands. */
  const reachFrom = (t) => {
    const sitesT = [campSite(t.i), ...rest];
    const view = { arena: { regionId, enemyFaction, tiles: baseTiles, sites: sitesT }, sites: sitesT };
    let soft = 0;
    let ally = 0;
    for (const site of rest) {
      if (!legalRouteFor(view, PLAYER_OWNER, 0, site.id)) continue;
      if (site.owner === PLAYER_OWNER) ally += 1;
      else if (site.type !== 'keep') soft += 1;
    }
    return { soft, ally };
  };
  const campTile = approach.camp || chooseCampTile(world, approach.direct, arenaByKeyForCamp, keepTile, allSettlementTileIds, reachFrom);
  if (!campTile) throw new Error(`buildArena: could not place a War Camp for region ${regionId}`);
  const sites = [campSite(campTile.i), ...rest];

  // Connectivity: the camp reaches the target's whole passable pocket inside the tile set (directly or by the approach strip),
  // and every enemy site lies in it. Nothing is carved for the player's own halo settlements: one cut off from the camp
  // (a ridge between them) fights from where it stands and has no legal route.
  const linkIds = new Set(stripTiles.map((t) => t.i));

  const allTiles = [...tileSet.values()].sort((a, b) => a.i - b.i);
  const arenaTiles = allTiles.map((t) => {
    const tile = toArenaTile(t);
    if (linkIds.has(t.i)) tile.link = true;
    return tile;
  });

  const focus = {
    minX: Math.min(...allTiles.map((t) => t.x)), maxX: Math.max(...allTiles.map((t) => t.x)),
    minY: Math.min(...allTiles.map((t) => t.y)), maxY: Math.max(...allTiles.map((t) => t.y)),
  };

  const arena = { regionId, enemyFaction, tiles: arenaTiles, sites, focus, marches: [] };
  if (features.twist) arena.twist = features.twist;
  if (features.type) arena.type = features.type;
  if (features.type === 'dragon') arena.dragon = { hp: FEATURES.dragon.hp * (enemy.troopMult ?? 1) * (enemy.dragonHpMult ?? 1) }; // Age of Dragons +25% (PLAN-PHASE5)
  if (features.twist === 'flooded') flood(world, arena, regionId);
  // The Barrow Keep (PLAN-PHASE6 §6B): an 'undying' capital's keep raises a squad every ASHEN.rising.everySec (battle/fallen.js)
  if (region.isCapital && enemy.personality === 'undying') {
    const keep = sites.find((x) => x.type === 'keep' && x.owner === enemyFaction && world.tiles[x.tile].region === regionId);
    if (keep) arena.rising = { site: keep.id, keepTroops: keep.troops };
  }
  if (stripTiles.length) {
    const end = stripTiles[stripTiles.length - 1]; // the strip's end nearest the target
    const near = sites.filter((x) => x.owner !== PLAYER_OWNER)
      .sort((a, b) => hexDistance(world.tiles[a.tile], end) - hexDistance(world.tiles[b.tile], end) || a.id - b.id)[0];
    arena.marches.push({ to: near ? near.id : 0, tiles: stripTiles.map((t) => t.i), approach: true });
  }
  // PLAN-PHASE12: on an archipelago, coastal sites, harbours (a quay when the region has none), sea lanes and the Tide Fortress (seaArena.js)
  decorateSea(world, arena, { regionId, owner: owners[regionId], enemy, mode: 'attack' });
  openCorridors(arena, region.tier === 1 ? BATTLE.openingTargetsFirstRing : BATTLE.openingTargets);
  return arena;
}

/**
 * The feature sites a region's type and twist add to its attack arena (DESIGN §10.13), pushed onto `rest` (ids follow on): a
 * Bandit Hold's veteran camp, the Ruins' Ancient Tower, a Siege's Gate, a Raid's three Shrines. Each is held by the region's owner
 * with FEATURES' garrison x the troop multiplier, on its tile from world/regionFeatures.js (skipped when that tile is missing or taken).
 */
function addFeatureSites(world, region, features, rest, tileSet, owner, enemy) {
  const taken = new Set(rest.map((x) => x.tile));
  const tm = enemy.troopMult ?? 1;
  const capMult = enemy.capMult ?? 1;
  const put = (tile, site) => {
    if (tile == null || taken.has(tile) || !tileSet.has(tile)) return;
    taken.add(tile);
    rest.push({ id: rest.length + 1, settlement: -1, tile, owner, capMult, ...site });
  };
  if (features.type === 'bandit') {
    const vet = FEATURES.bandit.vet * FEATURES.bandit.vet; // +30% attack and defence
    put(banditTile(world, region.id), { type: 'bandit', feature: 'bandit', troops: FEATURES.bandit.troops * tm, defMult: vet, squadPower: vet });
  }
  if (features.type === 'ruins') {
    const a = FEATURES.ancientTower;
    put(ancientTowerTile(world, region.id), { type: 'tower', feature: 'ancientTower', troops: a.troops * tm, range: a.range, volleySec: a.volleySec, volleyKills: a.kills });
  }
  if (features.twist === 'siege') put(gateTile(world, region.id), { type: 'gate', feature: 'gate', troops: FEATURES.gate.troops * tm * (enemy.gateTroopMult ?? 1) }); // Kingmaker
  if (features.twist === 'raid') {
    for (const tile of shrineTiles(world, region.id)) put(tile, { type: 'shrine', feature: 'shrine', troops: FEATURES.shrine.troops * tm });
  }
}

/**
 * Flooded (DESIGN §10.13): the target region's tiles carry their river and road edges and `flood`, so routes cross its rivers only on
 * road bridges (geom.js findPath). If that would cut the War Camp off from the keep, the twist is dropped for this fight.
 */
function flood(world, arena, regionId) {
  const backup = [];
  for (const t of arena.tiles) {
    if (t.region !== regionId) continue;
    const w = world.tiles[t.i];
    backup.push(t);
    t.flood = true;
    t.river = w.river || 0;
    t.road = w.road || 0;
  }
  const byKey = buildTileIndex(arena.tiles);
  const camp = arena.tiles.find((t) => t.i === arena.sites[0].tile);
  const keepSite = arena.sites.find((x) => x.type === 'keep' && x.owner !== PLAYER_OWNER);
  const keep = keepSite && arena.tiles.find((t) => t.i === keepSite.tile);
  if (camp && keep && findPath(byKey, camp, keep)) return;
  for (const t of backup) { delete t.flood; delete t.river; delete t.road; }
  delete arena.twist;
}

/**
 * Front lines (DESIGN §4.4), border marches: the fight must be playable the way the design says, "take the near settlements,
 * then the keep". Flags short strips of no-man's-land (`link` tiles, neutral and open to everyone) through the enemy land until
 *   1. at least `want` settlements other than the keep can be attacked from the War Camp at the start, and
 *   2. (`BATTLE.softBeforeKeep`) every settlement other than the keep can be taken, in some order, without taking the keep
 *      first: capturing whatever is attackable and repeating must reach them all, or the keep's land is what walls them in.
 * A strip is the path to a settlement that crosses the fewest foreign tiles, at most `BATTLE.corridorMaxTiles` of them, and one
 * that would touch the keep's tile or its neighbours is only taken when nothing else works. A guarantee no short strip can give
 * is simply not given (the player's safety net, routing.js, still keeps a fight from deadlocking). Nothing is carved to join the
 * player's own settlements: a halo village cut off from the camp fights from where it stands. Every strip is recorded in
 * `arena.marches` ({ to, tiles }). Mutates `arena.tiles`.
 */
function openCorridors(arena, want) {
  const sites = arena.sites;
  const camp = sites[0];
  const soft = sites.filter((s) => s.owner !== PLAYER_OWNER && s.type !== 'keep');
  const need = Math.min(want, soft.length);
  const byKey = buildTileIndex(arena.tiles);
  const tileByIndex = new Map(arena.tiles.map((t) => [t.i, t]));
  const tileOfSite = (s) => tileByIndex.get(s.tile);
  const keepTiles = sites.filter((s) => s.type === 'keep' && s.owner !== PLAYER_OWNER).map(tileOfSite).filter(Boolean);
  const nearKeep = (tile) => keepTiles.some((k) => hexDistance(tile, k) <= 1);

  /** The best strip from any of `sources` to any of `targets` (site objects, ids as in the arena) in `view`, or null. */
  function cheapest(view, sources, targets) {
    const terr = computeTerritory(view);
    let best = null;
    for (const target of targets) {
      const blocked = (tile) => !tile.link && terr.cell.get(tile.i) !== target.id
        && terr.owners.get(tile.i) === arena.enemyFaction;
      const extra = (tile) => (blocked(tile) ? BATTLE.corridorTilePenalty + (nearKeep(tile) ? BATTLE.corridorKeepPenalty : 0) : 0);
      for (const source of sources) {
        const path = findPath(byKey, tileOfSite(source), tileOfSite(target), null, extra);
        if (!path) continue;
        const tiles = path.filter(blocked);
        if (tiles.length === 0 || tiles.length > BATTLE.corridorMaxTiles) continue; // nothing to flag, or no longer a short strip
        const key = [tiles.some(nearKeep) ? 1 : 0, tiles.length, path.reduce((sum, t) => sum + t.cost, 0), target.id];
        if (!best || key.some((v, i) => v !== best.key[i] && v < best.key[i] && key.slice(0, i).every((w, j) => w === best.key[j]))) {
          best = { target, tiles, key };
        }
      }
    }
    return best;
  }

  // (A settlement on the camp's own tile has no route to it at all and needs none; a stage with nothing to flag hands over.)
  const flag = (best) => {
    if (!best) return false;
    for (const t of best.tiles) t.link = true;
    arena.marches.push({ to: best.target.id, tiles: best.tiles.map((t) => t.i) });
    return true;
  };

  for (let guard = 0; guard <= 3 * sites.length; guard++) {
    // a fresh view each round: flagging a tile invalidates any route cache built on the old one
    const view = { arena, sites };
    const reach = (x) => legalRouteFor(view, PLAYER_OWNER, camp.id, x.id) !== null;
    const openSoft = soft.filter(reach);
    if (openSoft.length < need && flag(cheapest(view, [camp], soft.filter((x) => !openSoft.includes(x))))) continue;
    if (!BATTLE.softBeforeKeep) return;
    // capture closure on a copy: take whatever is attackable, repeat, and see what the keep's land still hides
    const sim = sites.map((x) => ({ ...x }));
    const simView = { arena, sites: sim };
    const simSoft = sim.filter((x) => x.owner !== PLAYER_OWNER && x.type !== 'keep');
    for (let progress = true; progress;) {
      progress = false;
      for (const x of simSoft) {
        if (x.owner === PLAYER_OWNER) continue;
        if (sim.some((m) => m.owner === PLAYER_OWNER && m.tile !== x.tile && legalRouteFor(simView, PLAYER_OWNER, m.id, x.id))) {
          x.owner = PLAYER_OWNER;
          progress = true;
        }
      }
    }
    const stuck = simSoft.filter((x) => x.owner !== PLAYER_OWNER);
    if (stuck.length === 0 || !flag(cheapest(simView, sim.filter((x) => x.owner === PLAYER_OWNER), stuck))) return;
  }
}
