// Settlement placement, sizing and type mix (ARCHITECTURE §4, DESIGN §3.2/4.2).
// Naming is deliberately NOT here — generate.js assigns names once regions
// and settlements both exist, so a keep can share its region's name.

import { hexDistance } from '../core/hex.js';
import { neighborIndices } from './terrain.js';

const KEEP_TERRAIN_BONUS = {
  grass: 3, meadow: 3, hills: 3, forest: 2, pine: 2, savanna: 2, desert: 2, snow: 1,
  beach: -3, marsh: -3,
};

// DESIGN §3.3's four non-player personalities; 'player' (the start region)
// is handled separately below (keep + all villages, no roll needed).
const TYPE_WEIGHTS = {
  passive: { hamlet: 0.55, village: 0.45 },
  aggressive: { town: 0.45, village: 0.55 },
  defensive: { fort: 0.35, tower: 0.25, village: 0.3, hamlet: 0.1 },
  swarm: { village: 0.6, hamlet: 0.4 },
  undying: { fort: 0.2, town: 0.3, village: 0.5 }, // the Ashen Host (PLAN-PHASE6) holds its sites thickly: forts and towns, no hamlets
  raider: { village: 0.45, town: 0.2, hamlet: 0.35 }, // the Sea Kings (PLAN-PHASE12) hold their land lightly: fishing villages, few walls
  usurper: { fort: 0.15, town: 0.3, village: 0.35, hamlet: 0.2 }, // the Usurper (PLAN-PHASE13): mixed garrisons, a little of every rival he has subjugated
};

const HILLS_FORT_CHANCE = 0.4;

function weightedPick(rng, weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let x = rng.next() * total;
  for (const [type, w] of entries) {
    x -= w;
    if (x <= 0) return type;
  }
  return entries[entries.length - 1][0];
}

/**
 * The largest connected component of PASSABLE tiles within `regionTiles`,
 * using only steps that stay inside the region. A region's tile set (built
 * from terrain cost, mountains included) can still have its passable tiles
 * split into pockets by a band of mountains that cuts across it; settlements
 * only ever go in the dominant pocket, so any two settlements in the same
 * region are always connected by a passable path that stays inside it.
 */
function largestPassableComponent(regionTiles, tiles, cols, rows) {
  const tileSet = new Set(regionTiles);
  const seen = new Set();
  let best = [];
  for (const start of regionTiles) {
    if (!tiles[start].passable || seen.has(start)) continue;
    const comp = [];
    const queue = [start];
    seen.add(start);
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      comp.push(cur);
      for (const { index: nb } of neighborIndices(cur, cols, rows)) {
        if (tileSet.has(nb) && tiles[nb].passable && !seen.has(nb)) {
          seen.add(nb);
          queue.push(nb);
        }
      }
    }
    if (comp.length > best.length) best = comp;
  }
  return best;
}

/**
 * Most central tile in `candidates`, preferring grass/meadow/hills, avoiding
 * beach/marsh; prefers one >= 2 hexes from every already-placed settlement
 * (any region). Also prefers a tile that leaves SOME other candidate >=
 * minSpacing away — a keep placed dead-centre of a small, roughly-circular
 * region can otherwise leave nothing far enough away for a second
 * settlement, which would silently cost the region its "at least one
 * village" guarantee. Falls back tier by tier if candidates are too tight
 * for all of the above (a keep is never skipped; it is the one settlement
 * every region must have).
 */
function pickKeepTile(region, candidates, tiles, globalPlaced, minSpacing) {
  const eccentricity = new Map(); // candidate -> farthest OTHER candidate distance
  for (const i of candidates) {
    const qi = tiles[i].q, ri = tiles[i].r;
    let farthest = 0;
    for (const j of candidates) {
      if (j === i) continue;
      farthest = Math.max(farthest, hexDistance(qi, ri, tiles[j].q, tiles[j].r));
    }
    eccentricity.set(i, farthest);
  }

  let best = -1, bestScore = -Infinity;
  let bestSpaced = -1, bestSpacedScore = -Infinity;
  let bestRoomy = -1, bestRoomyScore = -Infinity;
  let bestRoomySpaced = -1, bestRoomySpacedScore = -Infinity;

  for (const i of candidates) {
    const t = tiles[i];
    const dx = t.x - region.centroid.x;
    const dy = t.y - region.centroid.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const bonus = KEEP_TERRAIN_BONUS[t.terrain] ?? 0;
    const score = bonus * 3 - dist;
    const hasRoom = eccentricity.get(i) >= minSpacing;
    const { minCross } = nearestDistances(i, globalPlaced, tiles, region.id);
    const isSpaced = minCross >= 2;

    if (score > bestScore) { bestScore = score; best = i; }
    if (isSpaced && score > bestSpacedScore) { bestSpacedScore = score; bestSpaced = i; }
    if (hasRoom && score > bestRoomyScore) { bestRoomyScore = score; bestRoomy = i; }
    if (hasRoom && isSpaced && score > bestRoomySpacedScore) { bestRoomySpacedScore = score; bestRoomySpaced = i; }
  }
  // Prefer, in order: central+terrain-good AND roomy AND spaced; roomy AND
  // spaced; just roomy (room for a village matters more than avoiding a
  // neighbour's spacing floor); then the plain best; only a region with no
  // candidate at all would fall through every tier, which can't happen here
  // since `candidates` is never empty by the time this is called.
  return bestRoomySpaced !== -1 ? bestRoomySpaced
    : bestRoomy !== -1 ? bestRoomy
    : bestSpaced !== -1 ? bestSpaced
    : best;
}

/** Total settlements (including the keep) for a region, interpolated by tier. */
function settlementTotalForTier(rng, tier, maxTier, worldCfg) {
  const frac = maxTier > 0 ? Math.min(1, Math.max(0, tier) / maxTier) : 0;
  const lerp = (a, b) => Math.round(a + (b - a) * frac);
  const lo = lerp(worldCfg.nearSettlements[0], worldCfg.farSettlements[0]);
  const hi = lerp(worldCfg.nearSettlements[1], worldCfg.farSettlements[1]);
  return rng.int(Math.min(lo, hi), Math.max(lo, hi));
}

/** Nearest existing settlement distance, split into same-region vs. cross-region. */
function nearestDistances(candidate, globalPlaced, tiles, regionId) {
  let minSame = Infinity;
  let minCross = Infinity;
  const cq = tiles[candidate].q;
  const cr = tiles[candidate].r;
  for (const p of globalPlaced) {
    const d = hexDistance(cq, cr, tiles[p.tile].q, tiles[p.tile].r);
    if (p.region === regionId) minSame = Math.min(minSame, d);
    else minCross = Math.min(minCross, d);
  }
  return { minSame, minCross };
}

/**
 * Farthest-point sampling for the next settlement in `region`: prefers a
 * candidate >= minSettlementSpacing from EVERY settlement placed so far (any
 * region); if geometry can't satisfy that, relaxes the CROSS-region floor to
 * 2; if a region ended up wedged against several already-densely-settled
 * neighbours and even THAT has no candidate, drops the cross-region floor
 * entirely as a last resort. SAME-region spacing never relaxes below
 * minSpacing — that is the one invariant world.*.test.js holds everywhere,
 * so it is never traded away for a rounder settlement count or neater
 * borders. Returns -1 only when the region's passable component is fully
 * built up (every tile in it already holds a settlement).
 */
function pickNextSettlementTile(candidates, tiles, globalPlaced, takenThisRegion, regionId, minSpacing) {
  let bestFull = -1, bestFullScore = -1;
  let bestRelaxed = -1, bestRelaxedScore = -1;
  let bestSameOnly = -1, bestSameOnlyScore = -1;

  for (const i of candidates) {
    const t = tiles[i];
    if (t.settlement !== -1 || takenThisRegion.has(i)) continue;
    const { minSame, minCross } = nearestDistances(i, globalPlaced, tiles, regionId);
    if (minSame < minSpacing) continue; // never negotiable

    const minAll = Math.min(minSame, minCross);
    if (minAll > bestSameOnlyScore) { bestSameOnlyScore = minAll; bestSameOnly = i; }
    if (minCross >= 2 && minAll > bestRelaxedScore) { bestRelaxedScore = minAll; bestRelaxed = i; }
    if (minCross >= minSpacing && minAll > bestFullScore) { bestFullScore = minAll; bestFull = i; }
  }
  if (bestFull !== -1) return bestFull;
  if (bestRelaxed !== -1) return bestRelaxed;
  return bestSameOnly;
}

/** Rolls a type for every non-keep settlement in `region`, then enforces "at least one village". */
function assignTypes(rng, region, tiles, settlements, personality, isStartRegion) {
  const others = region.settlements.filter((id) => id !== region.keep);
  const weights = TYPE_WEIGHTS[personality] ?? TYPE_WEIGHTS.passive;

  for (const id of others) {
    const s = settlements[id];
    if (isStartRegion) {
      s.type = 'village'; // DESIGN §3.2: the start region gets keep + villages
      continue;
    }
    if (tiles[s.tile].terrain === 'hills' && rng.chance(HILLS_FORT_CHANCE)) {
      s.type = 'fort';
      continue;
    }
    s.type = weightedPick(rng, weights);
  }

  if (!isStartRegion && others.length > 0 && !others.some((id) => settlements[id].type === 'village')) {
    settlements[others[0]].type = 'village';
  }
}

/**
 * Places a keep plus interpolated-count other settlements in every region.
 * Mutates `tiles[*].settlement` and each region's `keep`/`settlements`.
 * @param {import('../core/rng.js').Rng} rng forked for the 'settlements' phase
 * @param {import('./terrain.js').Tile[]} tiles
 * @param {import('./regions.js').Region[]} regions
 * @param {import('./generate.js').Faction[]} factions
 * @param {number} startRegion
 * @param {typeof import('../config/world.js').WORLD} worldCfg
 * @param {number} cols @param {number} rows
 * @returns {import('./generate.js').Settlement[]}
 */
export function placeSettlements(rng, tiles, regions, factions, startRegion, worldCfg, cols, rows) {
  const settlements = [];
  const globalPlaced = []; // { tile, region } for every settlement placed so far
  const maxTier = Math.max(0, ...regions.map((r) => r.tier));

  for (const region of [...regions].sort((a, b) => a.id - b.id)) {
    // Settlements only ever go in the region's DOMINANT passable pocket, so
    // any two of them are guaranteed reachable via a path that stays inside
    // the region (a stray mountain band can otherwise split a region's
    // passable tiles into more than one component).
    const candidates = largestPassableComponent(region.tiles, tiles, cols, rows);

    const keepTile = pickKeepTile(region, candidates, tiles, globalPlaced, worldCfg.minSettlementSpacing);
    const keepId = settlements.length;
    settlements.push({ id: keepId, tile: keepTile, region: region.id, type: 'keep', name: '' });
    tiles[keepTile].settlement = keepId;
    region.keep = keepId;
    region.settlements = [keepId];
    globalPlaced.push({ tile: keepTile, region: region.id });

    const total = settlementTotalForTier(rng, region.tier, maxTier, worldCfg);
    const othersCount = Math.max(0, total - 1);
    const takenThisRegion = new Set([keepTile]);

    for (let k = 0; k < othersCount; k++) {
      const tile = pickNextSettlementTile(
        candidates, tiles, globalPlaced, takenThisRegion, region.id, worldCfg.minSettlementSpacing,
      );
      if (tile === -1) break; // region has no more room; a smaller region is fine
      const id = settlements.length;
      settlements.push({ id, tile, region: region.id, type: 'village', name: '' });
      tiles[tile].settlement = id;
      region.settlements.push(id);
      takenThisRegion.add(tile);
      globalPlaced.push({ tile, region: region.id });
    }

    const personality = region.id === startRegion ? 'player' : factions[region.faction]?.personality;
    assignTypes(rng, region, tiles, settlements, personality, region.id === startRegion);
  }

  return settlements;
}
