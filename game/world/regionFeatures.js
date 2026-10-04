// A varied map (DESIGN §10.13): every region beyond the first ring may get a TYPE (Gold Mine, Monastery, Bandit Hold, Ruins; one
// Dragon's Lair per continent, deep) and a battle TWIST (Night, Blizzard, Flooded, Holy Ground, Siege, Raid; every rival capital
// has Siege). Seeded per world from hashes only (no shared RNG stream is consumed), so layouts, names and perks are unchanged.
// Also the deterministic tiles of the feature sites a battle adds (the Bandit Camp, the Ancient Tower, the Gate, the Shrines), so
// the arena and the map renderer agree. Pure.
//
//   region.type:  null | 'goldmine' | 'monastery' | 'bandit' | 'ruins' | 'dragon'
//   region.twist: null | 'night' | 'blizzard' | 'flooded' | 'holy' | 'siege' | 'raid'
import { FEATURES, TWISTS } from '../config/features.js';
import { EDICT_LIST, EDICT_NEUTRAL } from '../config/edicts.js';
import { hash32 } from '../core/rng.js';
import { neighbors as axialNeighbors, hexDistance } from '../core/hex.js';

const U = (seed, ...parts) => hash32(seed >>> 0, ...parts) / 4294967296;

function weightedPick(weights, u) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let x = u * total;
  for (const [k, w] of entries) {
    x -= w;
    if (x < 0) return k;
  }
  return entries[entries.length - 1][0];
}

/** True when a hex edge from `a` toward neighbour direction `dir` crosses a river with no road bridge on it. */
export function floodedEdge(a, b, dir) {
  const back = (dir + 3) % 6;
  const river = ((a.river >> dir) & 1) || ((b.river >> back) & 1);
  if (!river) return false;
  const bridge = ((a.road >> dir) & 1) && ((b.road >> back) & 1);
  return !bridge;
}

const qrIndex = new WeakMap();
function tileAtQR(world, q, r) {
  let m = qrIndex.get(world);
  if (!m) qrIndex.set(world, (m = new Map(world.tiles.map((t) => [`${t.q},${t.r}`, t]))));
  return m.get(`${q},${r}`);
}

/** Can the region's passable land be walked as one piece when Flooded (rivers crossed only on bridges), with a river to matter? */
function floodWorks(world, region) {
  const tiles = region.tiles.map((i) => world.tiles[i]).filter((t) => t.passable);
  if (!tiles.length) return false;
  const inRegion = new Set(tiles.map((t) => t.i));
  let rivers = 0;
  const keep = world.tiles[world.settlements[region.keep].tile];
  const seen = new Set([keep.i]);
  const queue = [keep];
  while (queue.length) {
    const cur = queue.shift();
    axialNeighbors(cur.q, cur.r).forEach((n, dir) => {
      const nt = tileAtQR(world, n.q, n.r);
      if (!nt || !inRegion.has(nt.i)) return;
      if (floodedEdge(cur, nt, dir)) { rivers += 1; return; }
      if (seen.has(nt.i)) return;
      seen.add(nt.i);
      queue.push(nt);
    });
  }
  return rivers > 0 && seen.size === inRegion.size;
}

/** True when removing region `id` (and the regions in `also`) leaves some other region unreachable from the start region. */
function cutsTheMap(world, id, also = []) {
  const gone = new Set([id, ...also]);
  const seen = new Set([world.startRegion]);
  const queue = [world.startRegion];
  while (queue.length) {
    const cur = queue.shift();
    for (const n of world.regions[cur].neighbors) {
      if (gone.has(n) || seen.has(n)) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return seen.size < world.regions.length - gone.size;
}

/** The world-generation mods of an Edict id (config/edicts.js): { blizzardShare, dragonCount, noNight }, neutral for none. */
export function edictWorldMods(edictId) {
  const e = EDICT_LIST.find((x) => x.id === edictId);
  const m = e ? e.mods : {};
  return {
    blizzardShare: m.blizzardShare ?? EDICT_NEUTRAL.blizzardShare,
    dragonCount: m.dragonCount ?? EDICT_NEUTRAL.dragonCount,
    noNight: m.noNight ?? EDICT_NEUTRAL.noNight,
  };
}

/**
 * Assigns `type` and `twist` to every region (MUTATES the regions; called once by generateWorld, after perks). Deterministic per
 * world seed. The start region and the first ring get none.
 * @param {object} world a generated world (tiles, regions, settlements, factions, startRegion)
 */
export function assignRegionFeatures(world, opts = {}) {
  const { seed, regions } = world;
  // PLAN-PHASE5: an Edict may reshape the continent (Long Winter, Age of Dragons, Open Roads); none changes nothing at all
  const em = edictWorldMods(opts.edict);
  for (const r of regions) { r.type = null; r.twist = null; }
  const eligible = regions.filter((r) => r.tier >= FEATURES.minTier && r.id !== world.startRegion);
  // the Dragon's Lair: one non-capital region deep in the continent (lowest hash among the deep ones)
  const maxTier = Math.max(0, ...regions.map((r) => r.tier));
  // never a region that every path to some other region runs through: the Lair is optional, so skipping it must lock nothing away
  const deep = eligible.filter((r) => !r.isCapital && r.tier >= Math.max(FEATURES.minTier, Math.round(maxTier * FEATURES.dragonFromTierShare))
    && !cutsTheMap(world, r.id));
  const lair = deep.sort((a, b) => hash32(seed >>> 0, 'lair', a.id) - hash32(seed >>> 0, 'lair', b.id))[0] || null;
  if (lair) lair.type = 'dragon';
  // Age of Dragons: more Lairs, the next ones in the same hash order, never together cutting the map
  const lairs = lair ? [lair] : [];
  for (const r of deep) {
    if (lairs.length >= em.dragonCount) break;
    if (lairs.includes(r) || cutsTheMap(world, r.id, lairs.map((x) => x.id))) continue;
    r.type = 'dragon';
    lairs.push(r);
  }
  for (const r of eligible) {
    if (lairs.includes(r)) continue;
    if (!r.isCapital && U(seed, 'type', r.id) < FEATURES.typeShare) r.type = weightedPick(FEATURES.typeWeights, U(seed, 'type-kind', r.id));
    if (r.isCapital) { r.twist = FEATURES.capitalTwist; continue; }
    if (U(seed, 'twist', r.id) >= FEATURES.twistShare) continue;
    // a twist that cannot work here (Flooded with no river or a river that cuts the region, Raid with no room) gives way to the next
    const order = [];
    const weights = { ...FEATURES.twistWeights };
    for (let k = 0; k < TWISTS.length; k++) {
      const t = weightedPick(weights, U(seed, 'twist-kind', r.id, k));
      order.push(t);
      weights[t] = 0;
      if (!Object.values(weights).some((w) => w > 0)) break;
    }
    for (const t of order) {
      if (t === 'night' && em.noNight) continue; // Open Roads: Night never falls
      if (t === 'flooded' && !floodWorks(world, r)) continue;
      if (t === 'raid' && shrineTiles(world, r.id).length < FEATURES.shrine.count) continue;
      r.twist = t;
      break;
    }
  }
  // Long Winter: Blizzard on about blizzardShare of the regions beyond the first ring (capitals keep their Siege)
  if (em.blizzardShare > 0) {
    for (const r of eligible) if (!r.isCapital && U(seed, 'winter', r.id) < em.blizzardShare) r.twist = 'blizzard';
  }
  if (opts.edict && (em.blizzardShare > 0 || em.dragonCount > 1 || em.noNight)) world.edict = opts.edict;
  return world;
}

// --- Where the feature sites stand -----------------------------------------------------------------------------------------

const siteCache = new WeakMap();

function freeTiles(world, region) {
  return region.tiles.map((i) => world.tiles[i]).filter((t) => t && t.passable && t.settlement === -1);
}

function homes(world, region) {
  return region.settlements.map((id) => world.tiles[world.settlements[id].tile]);
}

/** Tiles ranked by |distance to the keep - want|, then distance, then a hash: the shared rule for single feature sites. */
function rankedAround(world, region, want, key) {
  const keep = world.tiles[world.settlements[region.keep].tile];
  return freeTiles(world, region).map((t) => {
    const d = hexDistance(t.q, t.r, keep.q, keep.r);
    return { t, k0: Math.abs(d - want), k1: d, k2: hash32(world.seed >>> 0, key, t.i) };
  }).sort((a, b) => a.k0 - b.k0 || a.k1 - b.k1 || a.k2 - b.k2).map((x) => x.t);
}

function cached(world, key, fn) {
  let m = siteCache.get(world);
  if (!m) siteCache.set(world, (m = new Map()));
  if (!m.has(key)) m.set(key, fn());
  return m.get(key);
}

/** The Gate's tile: next to the keep, on the side facing the region's shallower neighbours (where attacks come from). null if none. */
export function gateTile(world, regionId) {
  return cached(world, `gate:${regionId}`, () => {
    const region = world.regions[regionId];
    if (!region) return null;
    const keep = world.tiles[world.settlements[region.keep].tile];
    const shallower = region.neighbors.map((n) => world.regions[n]).filter((n) => n.tier < region.tier);
    const toward = shallower.length ? shallower : region.neighbors.map((n) => world.regions[n]);
    const cx = toward.reduce((a, n) => a + n.centroid.x, 0) / Math.max(1, toward.length);
    const cy = toward.reduce((a, n) => a + n.centroid.y, 0) / Math.max(1, toward.length);
    const home = new Set(homes(world, region).map((t) => t.i));
    const ring = (d) => freeTiles(world, region).filter((t) => hexDistance(t.q, t.r, keep.q, keep.r) === d && !home.has(t.i));
    for (const d of [1, 2]) {
      const cands = ring(d).sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy) || a.i - b.i);
      if (cands.length) return cands[0].i;
    }
    return null;
  });
}

/** The Bandit Camp's tile (about 3 hexes from the keep, clear of settlements). null if none. */
export function banditTile(world, regionId) {
  return cached(world, `bandit:${regionId}`, () => single(world, regionId, 3, 'bandit'));
}

/** The Ancient Tower's tile (about 2 hexes from the keep). null if none. */
export function ancientTowerTile(world, regionId) {
  return cached(world, `ancient:${regionId}`, () => single(world, regionId, 2, 'ancient'));
}

function single(world, regionId, want, key) {
  const region = world.regions[regionId];
  if (!region) return null;
  const hs = homes(world, region);
  const gate = key === 'gate' ? null : gateTileRaw(world, region);
  for (const gap of [2, 1]) {
    for (const t of rankedAround(world, region, want, key)) {
      if (hs.some((h) => hexDistance(h.q, h.r, t.q, t.r) < gap)) continue;
      if (gate != null && t.i === gate) continue;
      return t.i;
    }
  }
  return null;
}

function gateTileRaw(world, region) {
  return region.twist === 'siege' || region.isCapital ? gateTile(world, region.id) : null;
}

/** The three Shrines' tiles (spread out, clear of settlements and of each other by FEATURES.shrine.minGap). [] if no room. */
export function shrineTiles(world, regionId) {
  return cached(world, `shrines:${regionId}`, () => {
    const region = world.regions[regionId];
    if (!region) return [];
    const hs = homes(world, region);
    const cands = freeTiles(world, region).sort((a, b) => hash32(world.seed >>> 0, 'shrine', a.i) - hash32(world.seed >>> 0, 'shrine', b.i));
    const out = [];
    for (const gap of [FEATURES.shrine.minGap, 2]) {
      out.length = 0;
      for (const t of cands) {
        if (out.length >= FEATURES.shrine.count) break;
        if (hs.some((h) => hexDistance(h.q, h.r, t.q, t.r) < gap)) continue;
        if (out.some((i) => hexDistance(world.tiles[i].q, world.tiles[i].r, t.q, t.r) < gap)) continue;
        out.push(t.i);
      }
      if (out.length >= FEATURES.shrine.count) break;
    }
    return out.length >= FEATURES.shrine.count ? out.slice() : [];
  });
}
