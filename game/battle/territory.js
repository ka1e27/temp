// Front lines (DESIGN §4.4): who owns the LAND of a battle arena, tile by tile. Pure bookkeeping, no DOM.
//
//  * A tile of the TARGET region belongs to its nearest settlement of that region (hex distance, ties to the lower
//    site id), so its owner is that settlement's CURRENT owner: land recolours the moment a settlement flips.
//    This is the same rule game/scenes/arenaOwnership.js uses to draw it.
//  * Every other tile (the player's halo around the region, and any connector tile) carries the owner its region had
//    when the arena was built (`tile.own`, stamped by arena.js). An old arena without the stamp counts as the player's.
//  * A link tile (`tile.link`: a border march that arena.js opens so the fight has a soft target, or a connector that keeps every
//    site reachable) is NO-MAN'S-LAND: owner -1 whoever the land around it belongs to, it never recolours when a settlement
//    flips, and it is open to everybody. No squad ever crosses enemy land: the only enemy tiles a route may enter are those of
//    the settlement it is attacking.
//  * A tile's CELL is the settlement it is nearest to (target tiles among the target region's settlements, other tiles
//    among the rest). A squad may always cross the cell of the settlement it is attacking (routing.js).
//
// Nothing here is saved in the battle: the cell map is derived from site positions, and ownership is read live from
// `site.owner`, so it survives a JSON round trip and any direct mutation of a site's owner. The cached view is rebuilt
// (and `version` bumps, which also drops every cached route) whenever the owner of any site changes.
import { getRuntime } from './runtime.js';
import { hexDistance } from './geom.js';
import { PLAYER_OWNER } from './owner.js';

const states = new WeakMap();

/** Builds the static part of the territory: which settlement is nearest to each tile. */
function buildCells(battle, rt) {
  const regionId = battle.arena.regionId;
  const inRegion = [];
  const outside = [];
  for (const site of battle.sites) {
    const tile = rt.byIndex.get(site.tile);
    if (!tile) continue;
    (tile.region === regionId ? inRegion : outside).push({ id: site.id, tile });
  }
  const cell = new Map(); // tile index -> site id (-1: none)
  for (const tile of battle.arena.tiles) {
    const pool = tile.region === regionId ? inRegion : outside;
    let best = -1;
    let bestD = Infinity;
    for (const c of pool) { // ascending site id, strict `<`: ties go to the lower id
      const d = hexDistance(tile, c.tile);
      if (d < bestD) { bestD = d; best = c.id; }
    }
    cell.set(tile.i, best);
  }
  return cell;
}

function ownerSignature(battle, into) {
  const sites = battle.sites;
  for (let i = 0; i < sites.length; i++) into[i] = sites[i].owner;
  return into;
}

function sameOwners(battle, sig) {
  const sites = battle.sites;
  if (sites.length !== sig.length) return false;
  for (let i = 0; i < sites.length; i++) if (sites[i].owner !== sig[i]) return false;
  return true;
}

function refreshOwners(battle, state) {
  const regionId = battle.arena.regionId;
  state.owners.clear();
  for (const tile of battle.arena.tiles) {
    let owner;
    if (tile.link) owner = -1;
    else if (tile.own !== undefined) owner = tile.own;
    else if (tile.region !== regionId) owner = PLAYER_OWNER;
    else {
      const site = battle.sites[state.cell.get(tile.i)];
      owner = site ? site.owner : -1;
    }
    state.owners.set(tile.i, owner);
  }
}

/**
 * The live territory view of a battle, cached per battle object and revalidated against the sites' owners on every
 * call (an O(sites) check). Treat it as read-only.
 * @returns {{version:number, enabled:boolean, enemy:number, cell:Map<number,number>, owners:Map<number,number>,
 *   routes:Map, strict:Map, deadlock:(boolean|null)}}
 *   `enabled` is false for an arena with no `regionId` (hand-built fixtures): then no land is off limits.
 */
export function computeTerritory(battle) {
  let state = states.get(battle);
  if (!state) {
    const rt = getRuntime(battle);
    state = {
      version: 0,
      enabled: typeof battle.arena.regionId === 'number',
      enemy: battle.arena.enemyFaction,
      cell: buildCells(battle, rt),
      owners: new Map(),
      sig: null,
      routes: new Map(),  // final routes (routing.js), keyed by owner/from/to
      strict: new Map(),  // routes that obey the front-line rule only
      deadlock: null,     // routing.js: the player has no legal attack route at all
    };
    states.set(battle, state);
  }
  if (!state.sig || !sameOwners(battle, state.sig)) {
    state.sig = ownerSignature(battle, state.sig || []);
    state.version += 1;
    state.routes.clear();
    state.strict.clear();
    state.deadlock = null;
    refreshOwners(battle, state);
  }
  return state;
}

/** Bumps whenever some settlement changes hands (every cached route is tied to it). */
export function territoryVersion(battle) {
  return computeTerritory(battle).version;
}

/** Faction that owns the land of an arena tile right now (-1: no one). */
export function tileOwner(battle, tileIndex) {
  const owner = computeTerritory(battle).owners.get(tileIndex);
  return owner === undefined ? -1 : owner;
}

/** Nearest settlement (site id) of a tile, or -1. */
export function tileCell(battle, tileIndex) {
  const id = computeTerritory(battle).cell.get(tileIndex);
  return id === undefined ? -1 : id;
}

/** True for land no side claims: anything that is neither the player's nor the enemy faction's (Free Folk hamlets
 * inside a rival region, unowned connector land). Both sides may cross it. */
export function isNeutralOwner(battle, owner) {
  return owner !== PLAYER_OWNER && owner !== battle.arena.enemyFaction;
}
