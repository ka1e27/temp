// Region perk assignment (DESIGN §3.5). Each non-throne perk is scored per
// region from its own terrain composition, then assigned greedily with a
// diminishing-returns penalty (so one perk can't dominate the map) and a
// same-perk-neighbour penalty (so borders read as varied, not tiled).
// Capitals always get 'throne'; the start region always gets 'fertile' —
// both are hard overrides applied after the competitive assignment, not
// participants in it.

const PERK_IDS = ['fertile', 'timber', 'iron', 'stone', 'horses', 'harbour', 'shrine'];
const MAX_PER_PERK = 5;
const MIN_PER_PERK = 2;
const DIMINISHING_STEP = 0.12; // score penalty per region already holding this perk
const NEIGHBOR_PENALTY = 0.25; // score penalty if a neighbouring region already holds it

/** Fraction of `region`'s own tiles whose terrain is in `types`. */
function terrainShare(region, tiles, types) {
  let count = 0;
  for (const i of region.tiles) if (types.includes(tiles[i].terrain)) count++;
  return count / region.tiles.length;
}

/** Raw per-perk fit, from terrain composition alone (before diminishing returns/neighbour penalties). */
function scoreRegion(region, regions, tiles) {
  const hasMountain = region.tiles.some((i) => tiles[i].terrain === 'mountain');
  const adjacentToMountain = region.neighbors.some((nb) => regions[nb].tiles.some((i) => tiles[i].terrain === 'mountain'));
  const coastalShare = region.tiles.filter((i) => tiles[i].coast !== 0).length / region.tiles.length;

  return {
    fertile: terrainShare(region, tiles, ['grass', 'meadow']),
    timber: terrainShare(region, tiles, ['forest', 'pine']),
    iron: terrainShare(region, tiles, ['hills']),
    stone: (hasMountain ? terrainShare(region, tiles, ['mountain']) : 0) + (adjacentToMountain ? 0.15 : 0),
    horses: terrainShare(region, tiles, ['meadow', 'savanna']),
    harbour: coastalShare,
    shrine: terrainShare(region, tiles, ['marsh', 'snow']),
  };
}

/** Converts the least-costly donor (a region whose current perk can spare one) until `perk` reaches MIN_PER_PERK. */
function topUpDeficientPerk(perk, candidates, scores, counts) {
  while ((counts.get(perk) ?? 0) < MIN_PER_PERK) {
    let donor = null, donorScore = -Infinity;
    for (const region of candidates) {
      if (region.perk === perk) continue;
      if ((counts.get(region.perk) ?? 0) <= MIN_PER_PERK) continue; // never create a new deficiency
      const s = scores.get(region.id)[perk];
      if (s > donorScore) { donorScore = s; donor = region; }
    }
    if (!donor) return; // nothing safe left to convert; accept the shortfall
    counts.set(donor.perk, counts.get(donor.perk) - 1);
    donor.perk = perk;
    counts.set(perk, (counts.get(perk) ?? 0) + 1);
  }
}

/**
 * @param {import('../core/rng.js').Rng} _rng forked for the 'perks' phase (kept for API symmetry with the other assign* functions; the algorithm itself is deterministic from terrain alone)
 * @param {import('./regions.js').Region[]} regions mutated in place: .perk
 * @param {import('./terrain.js').Tile[]} tiles
 * @param {number} startRegion
 */
export function assignPerks(_rng, regions, tiles, startRegion) {
  const scores = new Map(regions.map((r) => [r.id, scoreRegion(r, regions, tiles)]));
  const candidates = regions.filter((r) => !r.isCapital && r.id !== startRegion);

  // Most-distinctive regions (highest best-perk score) commit first, so a
  // region that is genuinely, say, 80% hills locks in Iron Hills before a
  // weaker, more generic region has to settle for whatever's left.
  const order = [...candidates].sort((a, b) => {
    const maxA = Math.max(...Object.values(scores.get(a.id)));
    const maxB = Math.max(...Object.values(scores.get(b.id)));
    return maxB - maxA;
  });

  const counts = new Map(PERK_IDS.map((p) => [p, 0]));
  for (const region of order) {
    const s = scores.get(region.id);
    let best = PERK_IDS[0], bestValue = -Infinity;
    for (const perk of PERK_IDS) {
      if ((counts.get(perk) ?? 0) >= MAX_PER_PERK) continue;
      const neighborHasSame = region.neighbors.some((nb) => regions[nb].perk === perk);
      const value = s[perk] - (counts.get(perk) ?? 0) * DIMINISHING_STEP - (neighborHasSame ? NEIGHBOR_PENALTY : 0);
      if (value > bestValue) { bestValue = value; best = perk; }
    }
    region.perk = best;
    counts.set(best, (counts.get(best) ?? 0) + 1);
  }

  // Every non-throne perk appears at least twice — but only when there's
  // genuinely enough of the map to spare; a very small custom-size world
  // just keeps whatever the greedy pass produced.
  if (order.length >= PERK_IDS.length * MIN_PER_PERK) {
    for (const perk of PERK_IDS) topUpDeficientPerk(perk, order, scores, counts);
  }

  for (const region of regions) if (region.isCapital) region.perk = 'throne';
  regions[startRegion].perk = 'fertile'; // DESIGN §3.5: always fertile, overriding everything else
}
