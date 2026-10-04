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
import { assignRegionFeatures } from './regionFeatures.js';
import { RIVALS } from '../config/ashen.js';

/** The classic line-up: generation is exactly the pre-rotation pipeline (5 faction entries, no remap). */
function isClassicLineup(rivals) {
  return !Array.isArray(rivals) || (rivals.length === 3 && rivals.every((f, i) => f === RIVALS.classic[i]));
}

/**
 * Rival rotation (PLAN-PHASE6 §6A): assignFactions grows the 3 rival sectors as faction ids 2, 3, 4 (sector 0, 1, 2); hand sector k
 * to `rivals[k]`. Map shapes are untouched, only the owner changes. Every FACTIONS entry is kept (index = id): a rival not on this
 * continent keeps `capitalRegion: -1` and is flagged `absent: true`. Runs before settlements, so each sector gets its new owner's
 * settlement mix.
 */
function applyRivals(regions, sectorFactions, rivals) {
  for (const region of regions) if (region.faction >= 2 && region.faction <= 4) region.faction = rivals[region.faction - 2];
  const out = FACTIONS.map((f) => ({ ...f, capitalRegion: -1 }));
  for (const f of out) if (f.id > 1 && !rivals.includes(f.id)) f.absent = true;
  rivals.forEach((id, k) => { out[id].capitalRegion = sectorFactions[2 + k] ? sectorFactions[2 + k].capitalRegion : -1; });
  return out;
}

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
 * @param {{ cols?: number, rows?: number, regionCount?: number, dynasty?: number, edict?: string|null, rivals?: number[] }} [opts]
 *   edict: a Phase 5 Edict id; rivals: the faction holding rival sector 0, 1, 2 (PLAN-PHASE6, meta/rivals.js); both from meta/edicts.js worldOptsFor
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
  const classic = isClassicLineup(opts.rivals);
  const factionDefs = FACTIONS.filter((f) => f.id <= RIVALS.classic[RIVALS.classic.length - 1]); // the classic 5: generation is unchanged

  const { tiles, mainLandmass, beachInfo } = generateTerrain(seed, rng.fork('terrain'), cols, rows, WORLD.landFraction);

  // The start region is the first screen a player sees: lush, and with three fair rival sectors around it (start.js).
  const { labels, startRegion } = chooseStart(rng, tiles, mainLandmass, cols, rows, worldCfg, factionDefs);
  const regionTotal = Math.max(...labels) + 1;
  // Beach is a thin fringe: no region may be more than BEACH.regionCap beach (runs before buildRegions, so biomes,
  // settlements and perks see the final terrain).
  capRegionBeaches(tiles, labels, beachInfo);
  for (const t of tiles) t.region = labels[t.i]; // contract field; buildRegions only tracks it the other way (region.tiles)

  const regions = buildRegions(tiles, labels, regionTotal);
  computeRegionNeighbors(regions, labels, cols, rows);
  computeTiers(regions, startRegion);

  const sectorFactions = assignFactions(rng.fork('factions'), regions, startRegion, factionDefs);
  const factions = classic ? sectorFactions : applyRivals(regions, sectorFactions, opts.rivals);

  const settlements = placeSettlements(
    rng.fork('settlements'), tiles, regions, factions, startRegion, worldCfg, cols, rows,
  );

  buildRoads(tiles, regions, settlements, mainLandmass, cols, rows);

  assignNames(rng.fork('names'), regions, settlements);
  assignPerks(rng.fork('perks'), regions, tiles, startRegion);

  const world = {
    seed, cols, rows, tiles, regions, settlements, factions, startRegion,
    bounds: computeBounds(tiles),
  };
  if (!classic) world.rivals = [...opts.rivals]; // PLAN-PHASE6: set only when the line-up is not the classic one (D1 stays byte-identical)
  assignRegionFeatures(world, { edict: opts.edict }); // region types and battle twists (DESIGN §10.13), from hashes only: nothing above changes; an Edict (PLAN-PHASE5) may reshape them
  return world;
}
