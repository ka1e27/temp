// The Throne of Ages in a battle arena (PLAN-PHASE13 §13A): buildArena calls decorateThrone for the Usurper's capital, after the feature
// sites and before the sea and the corridors. Pure: reads the world, mutates only the arena it is given. Every other arena is untouched.
//
//   arena.throne = { keep, gate, champions: [{ site, kind, name }], tide: number[], keepTroops, usurper: { troops, power } }
//     keep / gate      site ids (gate -1 when the region's Gate could not be placed: the battle then opens in phase 2)
//     champions        the three Champions' posts: sites of type 'bandit' (a veteran post), feature 'champion', throneChampion = kind
//     tide             the tiles the borrowed Tide floods: on the cheapest paths from every other site to the keep within
//                      THRONE.borrow.tideRouteRadius of it, plus those within tideKeepShore, nearest first, at most tideMaxTiles
import { THRONE } from '../config/crown.js';
import { SITE_TYPES } from '../config/battle.js';

/** The Usurper's troops: THRONE.usurperCapShare x the Throne keep's cap (x throneHpMult). Shared with the card (progression.js). */
export function usurperTroops(enemy) {
  return THRONE.usurperCapShare * SITE_TYPES.keep.cap * (enemy.capMult ?? 1) * THRONE.capMult * (enemy.throneHpMult ?? 1);
}
import { hexDistance, buildTileIndex, findPath, hexKey } from './geom.js';
import { hash32 } from '../core/rng.js';

/** Up to three free tiles of the region near the Gate (THRONE.championRing), CHAMPION.gap from every site and from each other. */
function championTiles(world, arena, regionId, gateTile) {
  // THRONE.championRing / championGap first; a cramped region widens the ring, then lets the posts stand closer (never on a site)
  for (const [ring, gap] of [[THRONE.championRing, THRONE.championGap], [THRONE.championRing + 2, THRONE.championGap], [THRONE.championRing + 3, 1]]) {
    const out = championTilesAt(world, arena, regionId, gateTile, ring, gap);
    if (out.length >= THRONE.champions.length) return out;
  }
  return championTilesAt(world, arena, regionId, gateTile, THRONE.championRing + 3, 1);
}

function championTilesAt(world, arena, regionId, gateTile, ring, gap) {
  const g = world.tiles[gateTile];
  const taken = arena.sites.map((s) => world.tiles[s.tile]);
  const inArena = new Set(arena.tiles.map((t) => t.i));
  const cands = world.tiles.filter((t) => t.region === regionId && t.passable && t.land && inArena.has(t.i) && t.settlement === -1
    && hexDistance(t, g) <= ring && taken.every((s) => hexDistance(t, s) >= gap))
    .sort((a, b) => hexDistance(a, g) - hexDistance(b, g) || hash32(world.seed >>> 0, 'champion', a.i) - hash32(world.seed >>> 0, 'champion', b.i) || a.i - b.i);
  const out = [];
  for (const t of cands) {
    if (out.length >= THRONE.champions.length) break;
    if (out.every((o) => hexDistance(o, t) >= gap)) out.push(t);
  }
  return out.map((t) => t.i);
}

/** The borrowed Tide's tiles (see the header). */
function tideTiles(world, arena, keep) {
  const k = arena.tiles.find((t) => t.i === keep.tile);
  if (!k) return [];
  const B = THRONE.borrow;
  const siteTiles = new Set(arena.sites.map((s) => s.tile));
  const byKey = buildTileIndex(arena.tiles);
  const goal = byKey.get(hexKey(k.q, k.r));
  const on = new Set();
  for (const from of arena.sites) {
    if (from === keep) continue;
    const ft = arena.tiles.find((t) => t.i === from.tile);
    const start = ft ? byKey.get(hexKey(ft.q, ft.r)) : null;
    const path = start && goal ? findPath(byKey, start, goal) : null;
    for (const t of path || []) if (!siteTiles.has(t.i) && hexDistance(t, k) <= B.tideRouteRadius) on.add(t.i);
  }
  for (const t of arena.tiles) if (!siteTiles.has(t.i) && hexDistance(t, k) <= B.tideKeepShore) on.add(t.i);
  const byI = new Map(arena.tiles.map((t) => [t.i, t]));
  return [...on].sort((a, b) => hexDistance(byI.get(a), k) - hexDistance(byI.get(b), k) || a - b).slice(0, B.tideMaxTiles).sort((a, b) => a - b);
}

/**
 * Turns the Usurper's capital arena into the Throne of Ages (see the header). `enemy` is the EnemyStats (troopMult, capMult,
 * gateTroopMult, throneHpMult). MUTATES the arena (sites, arena.throne). No-op when the region is not the Throne.
 */
export function decorateThrone(world, arena, regionId, enemy) {
  const region = world.regions[regionId];
  if (!region || !region.throne) return arena;
  const foe = arena.enemyFaction;
  const keep = arena.sites.find((s) => s.type === 'keep' && s.owner === foe && world.tiles[s.tile].region === regionId);
  if (!keep) return arena;
  const tm = enemy.troopMult ?? 1;
  // the Throne's own sites hold THRONE.capMult x a capital's (the card counts it: progression.js estimateStrength)
  for (const s of arena.sites) if (s.owner === foe && world.tiles[s.tile].region === regionId) s.capMult = (s.capMult ?? 1) * THRONE.capMult;
  const gate = arena.sites.find((s) => s.type === 'gate' && s.owner === foe);
  if (gate) gate.troops = THRONE.gateTroops * tm * (enemy.gateTroopMult ?? 1); // the realm's last wall (a Siege Gate is 18)
  const vet = THRONE.championVet * THRONE.championVet;
  const champions = [];
  const tiles = championTiles(world, arena, regionId, gate ? gate.tile : keep.tile);
  tiles.forEach((tile, n) => {
    const c = THRONE.champions[n];
    const site = {
      id: arena.sites.length, settlement: -1, tile, type: 'bandit', feature: 'champion', throneChampion: c.kind, owner: foe,
      troops: THRONE.championTroops * tm, capMult: (enemy.capMult ?? 1) * THRONE.capMult, defMult: vet, squadPower: vet,
    };
    arena.sites.push(site);
    champions.push({ site: site.id, kind: c.kind, name: c.name });
  });
  arena.throne = {
    keep: keep.id,
    gate: gate ? gate.id : -1,
    champions,
    tide: tideTiles(world, arena, keep),
    keepTroops: keep.troops,
    usurper: { troops: usurperTroops(enemy), power: THRONE.usurperPower },
  };
  return arena;
}
