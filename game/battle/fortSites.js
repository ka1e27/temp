// Fortifications in battle (DESIGN §10.3): where an Arrow Tower stands in its region, and what a region's fortifications do to a
// defense arena. Pure and dependency-light (config + geometry only), so the meta leaf (game/meta/fortsEffects.js), the defense
// arena and the map renderer can all share one answer.
import { FORTS, FORT_TYPES } from '../config/frontier.js';
import { hexDistance } from './geom.js';
import { hash32 } from '../core/rng.js';

const TYPES = new Set(FORT_TYPES);

/** A valid fortification entry: a known type at a level 1..its max. */
export function validFort(f) {
  return !!f && TYPES.has(f.type) && Number.isInteger(f.level) && f.level >= 1 && f.level <= FORTS.maxLevel[f.type];
}

/** Level (0 = none) of a type in a fortification list. */
export function levelIn(list, type) {
  if (!Array.isArray(list)) return 0;
  for (const f of list) if (validFort(f) && f.type === type) return f.level;
  return 0;
}

/**
 * @typedef {Object} FortEffects  what a region's fortifications do in its defense battles
 * @property {number} towerLevel   0 = no Arrow Tower; 1..3 its level
 * @property {number} towerRange   hexes (0 without a tower)
 * @property {number} towerVolleySec seconds between volleys (0 without a tower)
 * @property {number} towerKills   troops each volley kills, x the attack and (in a defense) x the militia scale
 * @property {number} wallsMult    the keep's and forts' defence x this (1 without Walls)
 * @property {number} hallMult     militia garrisons x this (1 without a Militia Hall)
 * @property {number} refillMult   militia refills this much faster (1 without a Militia Hall)
 * @property {number} warnSec      extra seconds of warning before a raid arrives (0 without a Beacon)
 * @property {number} speedMult    the player's squads march x this in this region's defenses (1 without a Beacon)
 */

/** @param {{type:string, level:number}[]|undefined} list @returns {FortEffects} */
export function fortEffects(list) {
  const e = FORTS.effects;
  const tower = levelIn(list, 'tower');
  const walls = levelIn(list, 'walls');
  const hall = levelIn(list, 'hall');
  const beacon = levelIn(list, 'beacon');
  return {
    towerLevel: tower,
    towerRange: tower ? e.tower.range[tower - 1] : 0,
    towerVolleySec: tower ? e.tower.volleySec[tower - 1] : 0,
    towerKills: tower ? e.tower.kills[tower - 1] : 0,
    wallsMult: walls ? e.walls.defMult[walls - 1] : 1,
    hallMult: hall ? e.hall.garrisonMult[hall - 1] : 1,
    refillMult: hall ? e.hall.refillMult[hall - 1] : 1,
    warnSec: beacon ? e.beacon.warnSec[beacon - 1] : 0,
    speedMult: beacon ? e.beacon.speedMult : 1,
  };
}

const towerTileCache = new WeakMap();

/**
 * World tile indices where a region's Arrow Towers stand, best first (index 0 is where the first tower goes). Deterministic per
 * world: passable tiles of the region with no settlement, at least FORTS.site.minGap hexes from every settlement of the region
 * and from each other, nearest to FORTS.site.keepDist hexes from the keep first (ties: a hash of the world seed and the tile).
 * Falls back to a gap of 1 when the region is too crowded. The renderer draws the tower here; the defense arena puts its site here.
 * @param {object} world
 * @param {number} regionId
 * @param {number} [count=1]
 * @returns {number[]} at most `count` tile indices (fewer only in a region with no free tile at all)
 */
export function fortTowerTiles(world, regionId, count = 1) {
  let perWorld = towerTileCache.get(world);
  if (!perWorld) towerTileCache.set(world, (perWorld = new Map()));
  const key = `${regionId}:${count}`;
  if (perWorld.has(key)) return perWorld.get(key);
  const region = world.regions[regionId];
  const out = [];
  if (region && Array.isArray(world.tiles) && world.tiles.length) {
    const keepTile = world.tiles[world.settlements[region.keep].tile];
    const homes = region.settlements.map((id) => world.tiles[world.settlements[id].tile]);
    const free = region.tiles.map((i) => world.tiles[i]).filter((t) => t && t.passable && !t.ford && t.settlement === -1); // never on a ford (PLAN-PHASE12)
    const ranked = free.map((t) => {
      const d = hexDistance(t, keepTile);
      return { t, key: [Math.abs(d - FORTS.site.keepDist), d, hash32(world.seed, 'fort', t.i)] };
    }).sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2]);
    for (const gap of [FORTS.site.minGap, 1]) {
      for (const { t } of ranked) {
        if (out.length >= count) break;
        if (out.includes(t.i)) continue;
        if (homes.some((h) => hexDistance(h, t) < gap)) continue;
        if (out.some((i) => hexDistance(world.tiles[i], t) < gap)) continue;
        out.push(t.i);
      }
      if (out.length >= count) break;
    }
  }
  perWorld.set(key, out);
  return out;
}
