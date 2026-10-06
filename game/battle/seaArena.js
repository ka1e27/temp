// The sea in a battle arena (PLAN-PHASE12 §12A/§12B): on an archipelago, buildArena and buildDefenseArena call decorateSea last (before
// the corridors). Pure: reads the world, mutates only the arena it is given. A land continent's arena is never touched.
//
//   site.coastal   the site's tile touches open sea (a lane may start or end there)
//   site.port      a harbour: the region's harbour settlement, or its QUAY (type 'harbour', attack arenas only: world/archipelago.js quayTile)
//   tile.ford      a ford tile (cost already FORD.baseCost x FORD.marchMult, from the world)
//   arena.sea = { lanes: [{ a, b, tiles, cost }], seaTiles: [{ i, q, r, x, y, cost, terrain: 'sea', sea: true }], tide? }
//     lanes join two coastal sites through open sea (at most LANE.battleMaxTiles tiles, inside the arena's bounds + LANE.battlePad);
//     `tiles` run from site a's side to site b's; `cost` = LANE.tileCost per sea tile. seaTiles are every tile a lane uses (the runtime
//     indexes them so a lane squad can march and be drawn; they are not arena.tiles: no territory, no land route enters them).
//     tide (a 'raider' capital, the Tide Fortress): { site: keep id, harbour: harbour site id|null, tiles: [tile indices], keepTroops }
//       tiles: the tidal tiles (fords, land touching open sea or a ford) on the approach routes from every other site to the Gate and the
//       keep (within TIDE.routeRadius of the keep), plus those within TIDE.keepShore of it; failing that the fords within TIDE.radius of the
//       keep; failing that up to TIDE.fallbackTiles shore tiles nearest it
import { LANE, TIDE, HARBOUR } from '../config/sea.js';
import { touchesOpenSea, seaPath, isOpenSea, quayTile } from '../world/archipelago.js';
import { neighborIndices } from '../world/terrain.js';
import { hexDistance, hexRadiusToWorld, buildTileIndex, findPath, hexKey } from './geom.js';
import { PLAYER_OWNER } from './owner.js';

/** Fords of other regions touching the target region's tiles (PLAN 12A: an island battle uses its tiles plus the fords touching it). */
export function touchingFords(world, region, tileSet) {
  if (!world.archipelago) return [];
  const out = [];
  for (const i of region.tiles) {
    for (const { index } of neighborIndices(i, world.cols, world.rows)) {
      const t = world.tiles[index];
      if (t.ford && t.region !== region.id && !tileSet.has(index) && !out.includes(t)) out.push(t);
    }
  }
  return out.sort((a, b) => a.i - b.i);
}

function quaySites(world, arena, regionId, owner, enemy) {
  const tile = quayTile(world, regionId);
  if (tile == null || !arena.tiles.some((t) => t.i === tile) || arena.sites.some((s) => s.tile === tile)) return;
  arena.sites.push({
    id: arena.sites.length, settlement: -1, tile, type: 'harbour', feature: 'harbour', owner,
    troops: HARBOUR.quayTroops * (enemy.troopMult ?? 1), capMult: enemy.capMult ?? 1, port: true,
  });
}

/** The lanes between the arena's coastal sites, and the sea tiles they use. */
function buildLanes(world, arena) {
  const { cols, rows } = world;
  const pad = hexRadiusToWorld(LANE.battlePad);
  const f = arena.focus;
  const allow = (i) => {
    const t = world.tiles[i];
    return t.x >= f.minX - pad && t.x <= f.maxX + pad && t.y >= f.minY - pad && t.y <= f.maxY + pad;
  };
  const quay = (s) => new Set(neighborIndices(s.tile, cols, rows).map((e) => e.index).filter((i) => isOpenSea(world.tiles[i]) && allow(i)));
  const coastal = arena.sites.filter((s) => s.coastal);
  const lanes = [];
  const used = new Map();
  for (let x = 0; x < coastal.length; x++) {
    for (let y = x + 1; y < coastal.length; y++) {
      const a = coastal[x];
      const b = coastal[y];
      const path = seaPath(world.tiles, quay(a), quay(b), cols, rows, LANE.battleMaxTiles, allow);
      if (!path) continue;
      lanes.push({ a: a.id, b: b.id, tiles: path, cost: +(path.length * LANE.tileCost).toFixed(3) });
      for (const i of path) used.set(i, world.tiles[i]);
    }
  }
  const seaTiles = [...used.values()].sort((p, q) => p.i - q.i)
    .map((t) => ({ i: t.i, q: t.q, r: t.r, x: t.x, y: t.y, cost: LANE.tileCost, terrain: 'sea', sea: true }));
  return { lanes, seaTiles };
}

/** The Tide Fortress (a 'raider' capital): which tiles flood (the tidal ground on the approach routes, see the header), and its harbour. */
function tideOf(world, arena, regionId) {
  const keep = arena.sites.find((s) => s.type === 'keep' && s.owner === arena.enemyFaction && world.tiles[s.tile].region === regionId);
  if (!keep) return null;
  const k = world.tiles[keep.tile];
  const near = (t) => hexDistance(t, k) <= TIDE.radius;
  const siteTiles = new Set(arena.sites.map((s) => s.tile));
  // tidal ground: a ford, or land touching open sea or a ford (the shore of the sea and of the straits)
  const tidal = (t) => t.ford || neighborIndices(t.i, world.cols, world.rows).some(({ index }) => isOpenSea(world.tiles[index]) || world.tiles[index].ford);
  // the approach routes: the cheapest paths from every other site to the Gate and the keep; the fords and shore tiles on them within
  // TIDE.routeRadius of the keep flood (the tide comes in where the attack has to wade)
  const byKey = buildTileIndex(arena.tiles);
  const goals = arena.sites.filter((s) => s.owner === arena.enemyFaction && (s === keep || s.type === 'gate')).map((s) => byKey.get(hexKey(world.tiles[s.tile].q, world.tiles[s.tile].r)));
  const onRoute = new Set();
  // from every site the player holds or may take (a captured town is the next launch point), not the targets themselves
  for (const from of arena.sites.filter((s) => s !== keep && s.type !== 'gate')) {
    const start = byKey.get(hexKey(world.tiles[from.tile].q, world.tiles[from.tile].r));
    for (const goal of goals) {
      const path = start && goal ? findPath(byKey, start, goal) : null;
      for (const t of path || []) {
        if (siteTiles.has(t.i) || hexDistance(t, k) > TIDE.routeRadius) continue;
        if (tidal(t)) onRoute.add(t.i);
      }
    }
  }
  // ... and the keep's own shore: every assault on it ends on these tiles (within TIDE.keepShore hexes)
  for (const t of arena.tiles) {
    if (!siteTiles.has(t.i) && hexDistance(t, k) <= TIDE.keepShore && tidal(t)) onRoute.add(t.i);
  }
  let tiles = [...onRoute];
  if (!tiles.length) tiles = arena.tiles.filter((t) => t.ford && near(t)).map((t) => t.i);
  if (!tiles.length) {
    tiles = arena.tiles.filter((t) => t.region === regionId && !arena.sites.some((s) => s.tile === t.i)
      && touchesOpenSea(world.tiles, t.i, world.cols, world.rows))
      .sort((a, b) => hexDistance(a, k) - hexDistance(b, k) || a.i - b.i).slice(0, TIDE.fallbackTiles).map((t) => t.i);
  }
  const harbour = arena.sites.find((s) => s.port && s.owner === arena.enemyFaction && world.tiles[s.tile].region === regionId);
  return { site: keep.id, harbour: harbour ? harbour.id : null, tiles: tiles.sort((a, b) => a - b), keepTroops: keep.troops };
}

/**
 * Adds the sea to an arena on an archipelago (no-op on land). `opts`: { regionId, owner (the region's holder, attack arenas: the quay's
 * owner), enemy (EnemyStats), mode ('attack'|'defense') }. MUTATES the arena (sites, tiles, arena.sea).
 */
export function decorateSea(world, arena, opts = {}) {
  if (!world || !world.archipelago) return arena;
  const { regionId, enemy = {}, mode = 'attack' } = opts;
  for (const t of arena.tiles) if (world.tiles[t.i] && world.tiles[t.i].ford) t.ford = true;
  if (mode === 'attack' && opts.owner != null && opts.owner !== PLAYER_OWNER) quaySites(world, arena, regionId, opts.owner, enemy);
  for (const s of arena.sites) {
    if (touchesOpenSea(world.tiles, s.tile, world.cols, world.rows)) s.coastal = true;
    if (s.settlement >= 0 && world.settlements[s.settlement] && world.settlements[s.settlement].harbour) s.port = true;
  }
  arena.sea = buildLanes(world, arena);
  const region = world.regions[regionId];
  if (mode === 'attack' && region && region.isCapital && enemy.personality === 'raider') {
    const tide = tideOf(world, arena, regionId);
    if (tide) arena.sea.tide = tide;
  }
  return arena;
}
