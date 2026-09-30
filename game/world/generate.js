// World generation orchestrator (ARCHITECTURE §4). Deterministic for a given
// (seed, opts); never touches the DOM/clock/unseeded randomness. Callers time
// this themselves — see tools/worldcli.mjs and game/tests/world.*.test.js.

import { createRng } from '../core/rng.js';
import { WORLD, FACTIONS } from '../config/world.js';
import { DYNASTY } from '../config/meta.js';
import { generateTerrain } from './terrain.js';
import { buildRegions, computeRegionNeighbors, computeTiers } from './regions.js';
import { chooseStart } from './start.js';
import { capRegionBeaches } from './beaches.js';
import { assignFactions } from './factions.js';
import { placeSettlements } from './settlements.js';
import { buildRoads } from './roads.js';
import { createNameGenerator } from './names.js';
import { assignPerks } from './perks.js';

/**
 * @typedef {'deep'|'ocean'|'shallows'|'beach'|'grass'|'meadow'|'forest'|'pine'|'hills'
 *   |'mountain'|'snow'|'savanna'|'desert'|'marsh'} Terrain
 */

/**
 * @typedef {Object} Faction
 * @property {number} id @property {string} name
 * @property {string} color @property {string} colorDark @property {string} colorLight
 * @property {'star'|'wheat'|'sword'|'eye'|'sun'} emblem
 * @property {'player'|'passive'|'aggressive'|'defensive'|'swarm'} personality
 * @property {number} capitalRegion -1 for player/Free Folk
 */

/**
 * @typedef {Object} Settlement
 * @property {number} id @property {number} tile @property {number} region
 * @property {'hamlet'|'village'|'town'|'fort'|'tower'|'keep'} type
 * @property {string} name
 */

function assignNames(rng, regions, settlements) {
  const nameGen = createNameGenerator(rng);
  for (const region of [...regions].sort((a, b) => a.id - b.id)) {
    region.name = nameGen();
    settlements[region.keep].name = region.name; // keeps share their region's name
  }
  for (const settlement of settlements) {
    if (settlement.type !== 'keep') settlement.name = nameGen();
  }
}

function computeBounds(tiles) {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const t of tiles) {
    if (!t.land) continue;
    bounds.minX = Math.min(bounds.minX, t.x);
    bounds.minY = Math.min(bounds.minY, t.y);
    bounds.maxX = Math.max(bounds.maxX, t.x);
    bounds.maxY = Math.max(bounds.maxY, t.y);
  }
  return bounds;
}

/**
 * @param {number} seed
 * @param {{ cols?: number, rows?: number, regionCount?: number, dynasty?: number }} [opts]
 * @returns {import('./generate.js').World}
 */
export function generateWorld(seed, opts = {}) {
  const cols = opts.cols ?? WORLD.cols;
  const rows = opts.rows ?? WORLD.rows;

  let regionCount = opts.regionCount ?? WORLD.regionCount;
  if (opts.dynasty && opts.dynasty > 1) {
    regionCount += (opts.dynasty - 1) * DYNASTY.regionsPerDynasty;
  }
  regionCount = Math.min(regionCount, DYNASTY.maxRegions);
  const worldCfg = { ...WORLD, regionCount };

  const rng = createRng(seed);

  const { tiles, mainLandmass, beachInfo } = generateTerrain(seed, rng.fork('terrain'), cols, rows, WORLD.landFraction);

  // The start region is the first screen a player sees: lush, and with three fair rival sectors around it (start.js).
  const { labels, startRegion } = chooseStart(rng, tiles, mainLandmass, cols, rows, worldCfg, FACTIONS);
  const regionTotal = Math.max(...labels) + 1;
  // Beach is a thin fringe: no region may be more than BEACH.regionCap beach (runs before buildRegions, so biomes,
  // settlements and perks see the final terrain).
  capRegionBeaches(tiles, labels, beachInfo);
  for (const t of tiles) t.region = labels[t.i]; // contract field; buildRegions only tracks it the other way (region.tiles)

  const regions = buildRegions(tiles, labels, regionTotal);
  computeRegionNeighbors(regions, labels, cols, rows);
  computeTiers(regions, startRegion);

  const factions = assignFactions(rng.fork('factions'), regions, startRegion, FACTIONS);

  const settlements = placeSettlements(
    rng.fork('settlements'), tiles, regions, factions, startRegion, worldCfg, cols, rows,
  );

  buildRoads(tiles, regions, settlements, mainLandmass, cols, rows);

  assignNames(rng.fork('names'), regions, settlements);
  assignPerks(rng.fork('perks'), regions, tiles, startRegion);

  return {
    seed, cols, rows, tiles, regions, settlements, factions, startRegion,
    bounds: computeBounds(tiles),
  };
}
