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
import { applyArchipelago } from './archipelago.js';
import { crownRivals, applyCrownFactions, crownIslands } from './crown.js';
import { CROWN } from '../config/crown.js';

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
  // every entry up to the highest id in play (PLAN-PHASE12: a line-up without the Sea Kings keeps the Phase 6 shape, 6 entries)
  const top = Math.max(RIVALS.pool[RIVALS.pool.length - 1], ...rivals);
  const out = FACTIONS.filter((f) => f.id <= top).map((f) => ({ ...f, capitalRegion: -1 }));
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
 * @param {{ cols?: number, rows?: number, regionCount?: number, dynasty?: number, edict?: string|null, rivals?: number[], archipelago?: boolean }} [opts]
 *   edict: a Phase 5 Edict id; rivals: the faction holding rival sector 0, 1, 2 (PLAN-PHASE6, meta/rivals.js); archipelago: islands, fords,
 *   harbours and sea lanes (PLAN-PHASE12, world/archipelago.js); all from meta/edicts.js worldOptsFor
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
  const crownOfAges = !!opts.crownOfAges; // PLAN-PHASE13: the final continent (world/crown.js); every other world kind never reaches its lines
  if (crownOfAges) regionCount = Math.min(DYNASTY.maxRegions, Math.max(regionCount, CROWN.regionCount));
  const worldCfg = { ...WORLD, regionCount };

  const rng = createRng(seed);
  const rivalsIn = crownOfAges ? (Array.isArray(opts.rivals) ? opts.rivals : crownRivals(seed)) : opts.rivals; // the Crown's three sector rivals
  const classic = isClassicLineup(rivalsIn);
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
  let factions = classic ? sectorFactions : applyRivals(regions, sectorFactions, rivalsIn);
  // PLAN-PHASE13 §13A: the Usurper takes the centre, the Sea Kings a coast (before settlements: each region gets its owner's mix)
  const crown = crownOfAges ? applyCrownFactions(seed, tiles, regions, sectorFactions, rivalsIn, cols, rows) : null;
  if (crown) factions = crown.factions;

  const settlements = placeSettlements(
    rng.fork('settlements'), tiles, regions, factions, startRegion, worldCfg, cols, rows,
  );

  buildRoads(tiles, regions, settlements, mainLandmass, cols, rows);
  // PLAN-PHASE12 §12A: an archipelago cuts the continent into islands joined by fords, with harbours and sea lanes (hash-seeded: a land
  // continent never reaches this line, so every non-archipelago world stays byte-identical)
  const arch = crown ? crownIslands(seed, tiles, regions, settlements, crown.crown, cols, rows) // PLAN-PHASE13: the Sea Kings' partial archipelago
    : opts.archipelago ? applyArchipelago(seed, tiles, regions, settlements, startRegion, cols, rows) : null;

  assignNames(rng.fork('names'), regions, settlements);
  assignPerks(rng.fork('perks'), regions, tiles, startRegion);

  const world = {
    seed, cols, rows, tiles, regions, settlements, factions, startRegion,
    bounds: computeBounds(tiles),
  };
  if (arch) world.archipelago = arch; // PLAN-PHASE12: { islands, harbours, seaLanes, fords }; absent on a land continent
  if (!classic) world.rivals = [...rivalsIn]; // PLAN-PHASE6: set only when the line-up is not the classic one (D1 stays byte-identical)
  if (crown && crown.crown) world.crown = { ...crown.crown }; // PLAN-PHASE13: { throne, usurper: regionIds, seaKings: regionIds }; absent on every other world
  assignRegionFeatures(world, { edict: opts.edict }); // region types and battle twists (DESIGN §10.13), from hashes only: nothing above changes; an Edict (PLAN-PHASE5) may reshape them
  return world;
}
