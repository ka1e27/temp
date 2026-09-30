// Start selection (round 3): the start region is the first screen a player sees, so the world is formed
// around a start tile that gives a lush start region AND three fair rival sectors. Walk down the ranked start
// tiles (regions.js `rankStartTiles`), form the world around each (seeds, labels, regions, factions: a few ms
// each) and take the first that passes; when none does, keep the best by a simple quality score.
//
// generate.js and the world tests share this, so a test that builds the pipeline by hand gets the same
// start tile, labels and regions as `generateWorld`.

import { START } from '../config/world.js';
import { hexDistance } from '../core/hex.js';
import {
  rankStartTiles, placeRegionSeeds, assignRegionLabels, compactLabels, regionComposition,
  buildRegions, computeRegionNeighbors, computeTiers,
} from './regions.js';
import { assignFactions } from './factions.js';

/**
 * Sizes (in regions) of the three rival sectors, in faction-id order (2, 3, 4).
 * @param {{faction:number}[]} regions
 */
export function rivalSectorSizes(regions) {
  return [2, 3, 4].map((f) => regions.filter((r) => r.faction === f).length);
}

/**
 * Quality of one candidate start; 1 or more is "accepted". Lushness counts up to START.minGreen; each
 * region of rival-sector gap beyond START.maxSectorGap costs START.gapPenalty; a sector smaller than
 * START.minSector costs a full point.
 * @param {number} green green share of the start region, 0..1
 * @param {number[]} sizes rival sector sizes
 */
export function startQuality(green, sizes) {
  const gap = Math.max(...sizes) - Math.min(...sizes);
  return Math.min(green / START.minGreen, 1)
    - START.gapPenalty * Math.max(0, gap - START.maxSectorGap)
    - (Math.min(...sizes) < START.minSector ? 1 : 0);
}

/**
 * Choose the start tile and form the region labels around it.
 * @param {object} rng the root world rng (only forks are used, so it is not advanced)
 * @param {object[]} tiles
 * @param {ArrayLike<boolean>} mainLandmass
 * @param {number} cols
 * @param {number} rows
 * @param {object} worldCfg WORLD config (nearRegionTiles, farRegionTiles, regionCount)
 * @param {object[]} factionDefs FACTIONS config (for the provisional faction pass)
 * @returns {{ startTile:number, labels:Int32Array|number[], startRegion:number, quality:number, tried:number }}
 */
export function chooseStart(rng, tiles, mainLandmass, cols, rows, worldCfg, factionDefs) {
  const ranked = rankStartTiles(tiles, mainLandmass, cols, rows);
  let best = null;
  const tried = [];
  for (const startTile of ranked) {
    if (tried.length >= START.candidates) break;
    const at = tiles[startTile];
    // a start a hex or two from one already tried forms nearly the same region: skip it
    if (tried.some((o) => hexDistance(tiles[o].q, tiles[o].r, at.q, at.r) < 3)) continue;
    tried.push(startTile);

    const seeds = placeRegionSeeds(rng.fork('regions'), tiles, mainLandmass, cols, rows, startTile, worldCfg);
    const formed = compactLabels(assignRegionLabels(tiles, mainLandmass, seeds, cols, rows), seeds);
    const trial = buildRegions(tiles, formed.labels, Math.max(...formed.labels) + 1);
    computeRegionNeighbors(trial, formed.labels, cols, rows);
    computeTiers(trial, formed.startRegion);
    assignFactions(rng.fork('factions'), trial, formed.startRegion, factionDefs);

    const green = regionComposition(tiles, formed.labels, formed.startRegion).green;
    const quality = startQuality(green, rivalSectorSizes(trial));
    if (!best || quality > best.quality) {
      best = { startTile, labels: formed.labels, startRegion: formed.startRegion, quality };
    }
    if (quality >= 1) break;
  }
  return { ...best, tried: tried.length };
}
