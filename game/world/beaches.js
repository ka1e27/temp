// Beaches are a thin coastal fringe, not a biome (config/world.js BEACH). terrain.js decides which
// coastal tiles become beach (low, exposed, thinned by a per-tile hash); this module keeps the SHARE
// of beach inside any group of tiles (a region, a decorative islet) under a cap by handing the least
// beach-like tiles back to the terrain they were before. PURE: no DOM, no clock, no randomness (the
// order is decided by exposure and elevation, ties by tile index).
import { BEACH, TERRAIN_COST, RIVER_PENALTY } from '../config/world.js';

/** Number of set bits among the six neighbour-direction bits of a coast mask. */
export function coastSides(mask) {
  let n = 0;
  for (let m = mask & 63; m; m &= m - 1) n++;
  return n;
}

/**
 * How beach-like a beach tile is: more water-facing sides and lower ground rank higher, so those are
 * the last to be handed back.
 * @param {{ rel: number }} info  `rel` = lowland rank (0 lowest .. 1)
 * @param {number} coastMask
 */
export function beachScore(info, coastMask) {
  return coastSides(coastMask) + (1 - info.rel);
}

/**
 * Trims the beach of one group to at most `cap` tiles.
 * @param {number[]} group tile indices of the group
 * @param {number} cap
 * @param {Map<number, {base: string, rel: number}>} beachInfo
 * @param {(i: number) => number} coastOf coast mask of tile i
 * @param {(i: number) => boolean} isBeach
 * @param {(i: number, base: string) => void} revert called for every tile handed back
 * @returns {number} how many tiles were handed back
 */
export function trimBeach(group, cap, beachInfo, coastOf, isBeach, revert) {
  const beach = group.filter((i) => isBeach(i) && beachInfo.has(i));
  if (beach.length <= cap) return 0;
  beach.sort((a, b) => beachScore(beachInfo.get(a), coastOf(a)) - beachScore(beachInfo.get(b), coastOf(b)) || a - b);
  const extra = beach.length - Math.max(0, cap);
  for (let k = 0; k < extra; k++) revert(beach[k], beachInfo.get(beach[k]).base);
  return extra;
}

/**
 * Enforces `BEACH.regionCap` on every region: the least beach-like beach tiles go back to the open
 * terrain (grass, meadow, savanna or desert) they were classified as. Mutates `terrain` and `cost`
 * of the tile objects. Run between region labelling and `buildRegions`, so a region's biome, its
 * settlements and its perk are computed from the final terrain.
 * @param {object[]} tiles
 * @param {ArrayLike<number>} labels region label per tile (-1 = none)
 * @param {Map<number, {base: string, rel: number}>} beachInfo from generateTerrain
 * @returns {number} tiles handed back
 */
export function capRegionBeaches(tiles, labels, beachInfo) {
  const groups = new Map();
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    if (l < 0) continue;
    if (!groups.has(l)) groups.set(l, []);
    groups.get(l).push(i);
  }
  let reverted = 0;
  const revert = (i, base) => {
    const t = tiles[i];
    t.terrain = base;
    t.cost = TERRAIN_COST[base] + (t.river !== 0 ? RIVER_PENALTY : 0);
  };
  for (const [, group] of [...groups].sort((a, b) => a[0] - b[0])) {
    const cap = Math.floor(BEACH.regionCap * group.length);
    reverted += trimBeach(group, cap, beachInfo, (i) => tiles[i].coast, (i) => tiles[i].terrain === 'beach', revert);
  }
  return reverted;
}
