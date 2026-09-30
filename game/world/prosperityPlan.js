// Prosperity plan (DESIGN §5.6, §7.7): WHERE each prosperity decoration goes, decided once per
// world and independent of any player state. PURE (no DOM, no clock, no Math.random): a
// deterministic function of the world and its seed. render/prosperityDecor.js paints from it during
// the terrain chunk bake; render/ambient.js reads the windmill sites for the turning sails.
//
// Level features (a region shows every feature of its level and below):
//   I   `farm`     life on the EXISTING farmland beside every hamlet, village and town: haystacks, a
//                   hedgerow line, up to two small orchards per region and a scarecrow (ground: baked
//                   under the territory tint, like terrain)
//   II  `cottages` 1-2 extra cottages on a free grass/meadow tile beside a village or town
//       `windmill` a windmill tower on a seeded grassland tile (sails are drawn live)
//   III `paved`    the region's road tiles repainted as pale stone
//       `market`   a market stall with a striped awning on a free tile beside the keep
// Cottages, windmill tower, paving and market are STRUCTURES: baked after the territory tint so they
// keep their natural colours.
//
// Every decoration of a tile belongs to the REGION OF THAT TILE and lies inside the tile's own
// drawing reach, so a region's level alone decides what a chunk shows.
import { DIRS, hexDistance } from '../core/hex.js';
import { hash32 } from '../core/rng.js';
import { AMBIENT } from '../config/ambient.js';

export const FEATURE_LEVEL = Object.freeze({ farm: 1, cottages: 2, windmill: 2, paved: 3, market: 3 });

const FIELD_SETTLEMENTS = new Set(['hamlet', 'village', 'town']);
const COTTAGE_SETTLEMENTS = new Set(['village', 'town']);
// Open, buildable ground. The first two are preferred; the rest are allowed so a beach or savanna
// start region still visibly prospers (the base bake paints ring-one fields on any lowland tile too).
const OPEN_TERRAIN = new Set(['grass', 'meadow']);
const FIELD_TERRAIN = new Set(['grass', 'meadow', 'savanna', 'beach', 'desert']);
const terrainBonus = (t) => (OPEN_TERRAIN.has(t.terrain) ? 0.6 : t.terrain === 'savanna' ? 0.25 : 0);
const R3 = Math.sqrt(3);
const STEP = DIRS.map((d) => ({ x: R3 * (d.q + d.r / 2), y: 1.5 * d.r }));

// Reach of the decorations beyond the tile centre, world units (windmill tower is the tallest).
export const DECOR_REACH = Object.freeze({ left: 1.05, right: 1.05, up: 1.7, down: 0.75 });

const MAX_COTTAGE_TILES = 4;

/**
 * @typedef {Object} TileDecorInfo  (`info` of drawProsperityGround / drawProsperityStructures)
 * @property {number} tile          tile index
 * @property {number} region        region id of the tile
 * @property {number} seed          stable uint32 for this tile
 * @property {object|null} settlement  nearest settlement of the tile's region (or null)
 * @property {number} settlementDist   hex distance to it
 * @property {boolean} farm         base-bake farmland tile (next to a hamlet/village/town); level >= 1 decorates it
 * @property {number} hay           haystacks on the plots (0..2)
 * @property {{n:number,dx:number,dy:number}|null} orchard  a small cluster of round fruit trees
 * @property {{axis:number,off:number}|null} hedge  a hedgerow chord parallel to hex axis `axis`, `off` hex units off centre
 * @property {{dx:number,dy:number}|null} scarecrow
 * @property {{dx:number,dy:number,variant:number}[]|null} cottages  level >= 2 (offsets in world units from the top-face centre)
 * @property {boolean} windmill     level >= 2: windmill tower on this tile
 * @property {boolean} paved        level >= 3: repaint this tile's road as stone
 * @property {{dx:number,dy:number,flip:boolean}|null} market  level >= 3
 */

/**
 * @typedef {Object} WindmillSite
 * @property {number} region
 * @property {number} tile
 * @property {number} x    sail hub, world units (elevation lift and hub offset already applied)
 * @property {number} y
 * @property {number} phase  stable sail phase, radians
 */

function tileAt(world, q, r) {
  const col = q + (r - (r & 1)) / 2;
  if (col < 0 || col >= world.cols || r < 0 || r >= world.rows) return null;
  return world.tiles[r * world.cols + col];
}

function neighborTiles(world, t) {
  const out = [];
  for (let d = 0; d < 6; d++) {
    const n = tileAt(world, t.q + DIRS[d].q, t.r + DIRS[d].r);
    if (n) out.push({ tile: n, dir: d });
  }
  return out;
}

const score = (seed, salt) => hash32(seed, salt) / 4294967296;

/**
 * @param {import('./generate.js').World} world
 */
export function createProsperityPlan(world) {
  const infos = new Array(world.tiles.length).fill(null);
  const regionTiles = world.regions.map(() => []);
  const windmills = [];
  const seedOf = (t) => hash32(world.seed, 'prosperity', t.i);

  const get = (t) => {
    let info = infos[t.i];
    if (!info) {
      info = {
        tile: t.i, region: t.region, seed: seedOf(t), settlement: null, settlementDist: 99,
        farm: false, hay: 0, orchard: null, hedge: null, scarecrow: null, cottages: null, windmill: false, paved: false, market: null,
      };
      infos[t.i] = info;
      regionTiles[t.region].push(t.i);
    }
    return info;
  };

  const settlementTile = (s) => world.tiles[s.tile];
  const isPlain = (t) => t.land && t.elev === 1 && t.settlement === -1 && !t.river;

  // ---- ring-one tiles (the base bake already paints fields there) -----------------
  const ringOne = new Set();
  for (const s of world.settlements) {
    if (!FIELD_SETTLEMENTS.has(s.type)) continue;
    for (const { tile } of neighborTiles(world, settlementTile(s))) ringOne.add(tile.i);
  }

  // ---- level III market: a free tile beside each keep (never behind it, never on a road) ----
  const marketTile = new Map(); // region -> tile index
  for (const region of world.regions) {
    const keep = settlementTile(world.settlements[region.keep]);
    let best = null;
    let bestScore = -Infinity;
    for (const { tile, dir } of neighborTiles(world, keep)) {
      if (tile.region !== region.id || !tile.land || tile.terrain === 'mountain' || tile.settlement !== -1 || tile.river) continue;
      if (tile.elev > 2) continue;
      // South-facing neighbours (W, SW, SE) read best: the keep sprite rises behind them.
      const facing = dir === 4 || dir === 5 ? 0.5 : dir === 3 ? 0.35 : dir === 0 ? 0.2 : -1;
      const sc = score(seedOf(tile), 'market') * 0.4 + facing + (tile.road ? -0.6 : 0.5) + (OPEN_TERRAIN.has(tile.terrain) ? 0.3 : 0);
      if (sc > bestScore) { bestScore = sc; best = { tile, dir }; }
    }
    if (best) marketTile.set(region.id, best);
  }
  for (const { tile, dir } of marketTile.values()) {
    const info = get(tile);
    // A little in front of the tile centre, leaning away from the keep.
    info.market = { dx: -STEP[dir].x * 0.06, dy: 0.12, flip: score(info.seed, 'flip') < 0.5 };
  }

  // ---- windmill (level II): one per region, on open ground 2-3 tiles from a settlement ----
  const windmillTile = new Map();
  for (const region of world.regions) {
    const anchors = region.settlements.map((id) => world.settlements[id])
      .filter((s) => FIELD_SETTLEMENTS.has(s.type)).map(settlementTile);
    const fallback = anchors.length ? anchors : [settlementTile(world.settlements[region.keep])];
    let best = null;
    let bestScore = -Infinity;
    for (const ti of region.tiles) {
      const t = world.tiles[ti];
      if (!isPlain(t) || t.road || !FIELD_TERRAIN.has(t.terrain)) continue;
      if (marketTile.get(region.id)?.tile === t) continue;
      // Its sails are large: keep every settlement (any type) at least two hexes away.
      if (neighborTiles(world, t).some((n) => n.tile.settlement !== -1)) continue;
      let near = 99;
      for (const a of fallback) near = Math.min(near, hexDistance(a.q, a.r, t.q, t.r));
      if (near < 2 || near > 4) continue;
      const sc = score(seedOf(t), 'mill') + terrainBonus(t) + (near === 2 ? 0.25 : near === 3 ? 0.15 : 0) + (ringOne.has(t.i) ? 0.1 : 0) - (t.coast ? 0.3 : 0);
      if (sc > bestScore) { bestScore = sc; best = t; }
    }
    if (best) windmillTile.set(region.id, best);
  }
  for (const [rid, t] of windmillTile) {
    const info = get(t);
    info.windmill = true;
    windmills.push({
      region: rid,
      tile: t.i,
      x: t.x + AMBIENT.windmill.hubDx,
      y: t.y - AMBIENT.elevLift[t.elev] + AMBIENT.windmill.hubDy,
      phase: score(info.seed, 'sail') * Math.PI * 2,
    });
  }

  // ---- extra cottages (level II): one tile per village/town, 1-2 cottages ----------------
  for (const region of world.regions) {
    let placed = 0;
    for (const sid of region.settlements) {
      const s = world.settlements[sid];
      if (!COTTAGE_SETTLEMENTS.has(s.type) || placed >= MAX_COTTAGE_TILES) continue;
      const st = settlementTile(s);
      let best = null;
      let bestScore = -Infinity;
      for (const { tile, dir } of neighborTiles(world, st)) {
        if (tile.region !== region.id || !isPlain(tile) || tile.road || !FIELD_TERRAIN.has(tile.terrain)) continue;
        const existing = infos[tile.i];
        if (existing && (existing.windmill || existing.market || existing.cottages)) continue;
        const sc = score(seedOf(tile), 'cottage') + terrainBonus(tile) + (dir >= 3 ? 0.15 : 0); // south side looks best
        if (sc > bestScore) { bestScore = sc; best = { tile, dir }; }
      }
      if (!best) continue;
      const info = get(best.tile);
      const many = s.type === 'town' || score(info.seed, 'many') < 0.5;
      const ux = STEP[best.dir].x / R3;
      const uy = STEP[best.dir].y / 1.5;
      info.cottages = many
        ? [
          { dx: -0.3 + ux * 0.1, dy: 0.02 + uy * 0.06, variant: 0 },
          { dx: 0.26 + ux * 0.1, dy: 0.24 + uy * 0.04, variant: 1 },
        ]
        : [{ dx: (score(info.seed, 'jx') - 0.5) * 0.24 + ux * 0.12, dy: 0.12 + uy * 0.1, variant: 2 }];
      placed++;
    }
  }

  // ---- level I: life on the EXISTING farmland ------------------------------------------------
  // The base bake paints organic plots on every lowland tile next to a hamlet, village or town (ringOne);
  // level I adds haystacks, hedgerows, up to two small orchards per region and a scarecrow to those tiles.
  const farmByRegion = world.regions.map(() => []);
  for (const i of [...ringOne].sort((x, y) => x - y)) {
    const t = world.tiles[i];
    if (!t.land || t.region < 0 || t.elev !== 1 || t.settlement !== -1) continue;
    get(t).farm = true;
    farmByRegion[t.region].push(t);
  }
  for (const region of world.regions) {
    const tiles = farmByRegion[region.id];
    if (!tiles.length) continue;
    const busy = (info) => info.cottages || info.windmill || info.market;
    const free = tiles.filter((t) => !t.road && !t.river && !busy(infos[t.i]));
    // 1-2 small orchard clusters beside each hamlet, village or town of the region (never two on one tile,
    // never touching another orchard).
    const orchards = [];
    for (const sid of region.settlements) {
      const st = world.settlements[sid];
      if (!FIELD_SETTLEMENTS.has(st.type)) continue;
      const stt = settlementTile(st);
      const near = free.filter((t) => hexDistance(stt.q, stt.r, t.q, t.r) === 1 && !orchards.includes(t))
        .sort((x, y) => score(seedOf(y), 'orchard') - score(seedOf(x), 'orchard') || x.i - y.i);
      const want = 1 + (score(hash32(world.seed, sid), 'second') < 0.3 ? 1 : 0);
      let got = 0;
      for (const t of near) {
        if (got >= want || orchards.length >= 5) break;
        if (orchards.some((o) => hexDistance(o.q, o.r, t.q, t.r) < 2)) continue;
        orchards.push(t);
        got++;
      }
    }
    for (const t of orchards) {
      const info = infos[t.i];
      info.orchard = { n: 5 + Math.floor(score(info.seed, 'trees') * 3), dx: (score(info.seed, 'ox') - 0.5) * 0.12, dy: (score(info.seed, 'oy') - 0.5) * 0.1 };
    }
    const scare = free.filter((t) => !orchards.includes(t))
      .sort((x, y) => score(seedOf(y), 'scare') - score(seedOf(x), 'scare') || x.i - y.i)[0];
    if (scare) {
      const info = infos[scare.i];
      info.scarecrow = { dx: (score(info.seed, 'sx') - 0.5) * 0.5, dy: 0.02 + score(info.seed, 'sy') * 0.2 };
    }
    for (const t of tiles) {
      const info = infos[t.i];
      if (busy(info) || info.orchard) continue;
      if (!t.river && score(info.seed, 'hay') < 0.62) info.hay = score(info.seed, 'hay2') < 0.45 ? 3 : score(info.seed, 'hay2') < 0.75 ? 2 : 1;
      if (!t.road && !t.river && !info.scarecrow && score(info.seed, 'hedge') < 0.46) {
        info.hedge = { axis: Math.floor(score(info.seed, 'axis') * 3) % 3, off: score(info.seed, 'off') < 0.5 ? -0.27 : 0.27 };
      }
    }
  }

  // ---- paved roads (level III): every road tile of the region -------------------------------
  for (const region of world.regions) {
    for (const ti of region.tiles) {
      const t = world.tiles[ti];
      if (t.road) get(t).paved = true;
    }
  }

  // ---- nearest settlement per decorated tile ---------------------------------------------
  for (const info of infos) {
    if (!info) continue;
    const t = world.tiles[info.tile];
    for (const sid of world.regions[info.region].settlements) {
      const s = world.settlements[sid];
      const st = settlementTile(s);
      const d = hexDistance(t.q, t.r, st.q, st.r);
      if (d < info.settlementDist) { info.settlementDist = d; info.settlement = s; }
    }
  }

  function boundsOf(regionId) {
    const list = regionTiles[regionId] || [];
    if (!list.length) return null;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const ti of list) {
      const t = world.tiles[ti];
      minX = Math.min(minX, t.x - DECOR_REACH.left);
      maxX = Math.max(maxX, t.x + DECOR_REACH.right);
      minY = Math.min(minY, t.y - DECOR_REACH.up);
      maxY = Math.max(maxY, t.y + DECOR_REACH.down);
    }
    return { minX, minY, maxX, maxY };
  }

  return {
    /** Decoration info of tile `i`, or null when the tile never carries prosperity decor. */
    info: (i) => infos[i],
    /** Tile indices of a region that carry decor at some level. */
    regionTiles: (regionId) => regionTiles[regionId] || [],
    /** All windmill sites (one per region at most). */
    windmills,
    /** Windmill sites of one region. */
    windmillsOf: (regionId) => windmills.filter((w) => w.region === regionId),
    /** World-unit box of everything the region's decor can touch (chunk invalidation), or null. */
    boundsOf,
    /** How many decorated tiles the plan holds. */
    get decorTileCount() { return infos.reduce((n, i) => n + (i ? 1 : 0), 0); },
  };
}
