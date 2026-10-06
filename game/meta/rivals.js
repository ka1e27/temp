// Rival rotation (PLAN-PHASE6 §6A) and the Ashen Host's card helpers. Pure: no DOM, no Date.now, no Math.random, no storage.
//
//   rivalsFor(seed, dynastyLevel, { archipelago }) -> factionId[3]   the faction holding rival sector 0, 1, 2 (generateWorld opts.rivals)
//   archipelagoFor(seed, dynastyLevel) -> boolean   PLAN-PHASE12: this founding is an archipelago (the Sea Kings always hold land on one)
//   rivalsOf(state)               -> factionId[3]   the dynasty's stored line-up (state.rivals; the classic three when missing)
//   rivalsInWorld(world)          -> factionId[]    rivals that hold land on this continent, in id order
//   isRivalPresent(world, id)     -> boolean
//   ashenOnFrontier(state, world) -> regionId|null  a frontier region held by an 'undying' faction (the tutorial hint's trigger)
//   fallenLine(state, world, id)  -> string|null    the region card's line about The Fallen Rise
import { hash32 } from '../core/rng.js';
import { RIVALS, ASHEN } from '../config/ashen.js';
import { SEA_FACTION, SEA, FORD, LANE, TIDE } from '../config/sea.js';
import { archipelagoFor, quayTile, regionHarbours } from '../world/archipelago.js';

export { archipelagoFor }; // PLAN-PHASE12: the seeded 1-in-3 archipelago from dynasty 3 (world/archipelago.js)

const isClassic = (r) => r.length === 3 && r.every((f, i) => f === RIVALS.classic[i]);

/**
 * The rival line-up of a continent: Dynasty 1 the classic three; Dynasty 2 the newcomer replaces one of them (seeded), so every
 * player meets it once; Dynasty 3+ three of the four (seeded per dynasty). Order = sector order; the order of the survivors is kept.
 * PLAN-PHASE12: on an archipelago the Sea Kings (SEA_FACTION) always take one of the three sectors (seeded); a land continent never has
 * them, so its line-up is exactly the Phase 6 one.
 * @param {number} seed the continent's seed
 * @param {number} dynastyLevel 1-based
 * @param {{ archipelago?: boolean }} [opts]
 * @returns {number[]}
 */
export function rivalsFor(seed, dynastyLevel, opts = {}) {
  const level = Math.max(1, Math.floor(Number(dynastyLevel)) || 1);
  if (opts && opts.archipelago) {
    const out = rivalsFor(seed, level);
    out[(hash32(seed >>> 0, 'seaKings', level) >>> 11) % out.length] = SEA_FACTION;
    return out;
  }
  if (level < RIVALS.newcomerDynasty) return [...RIVALS.classic];
  if (level === RIVALS.newcomerDynasty) {
    const out = [...RIVALS.classic];
    out[(hash32(seed >>> 0, 'rivals', level) >>> 13) % out.length] = RIVALS.newcomer;
    return out;
  }
  const drop = RIVALS.pool[(hash32(seed >>> 0, 'rivals', level) >>> 13) % RIVALS.pool.length];
  return RIVALS.pool.filter((f) => f !== drop);
}

/** A clean line-up: 3 distinct faction ids from the pool, else the classic three. Never throws. */
export function sanitizeRivals(raw) {
  if (!Array.isArray(raw) || raw.length !== 3) return [...RIVALS.classic];
  const ok = raw.every((f) => Number.isInteger(f) && (RIVALS.pool.includes(f) || f === SEA_FACTION)) && new Set(raw).size === 3;
  return ok ? [...raw] : [...RIVALS.classic];
}

/** The dynasty's stored line-up (state.rivals), the classic three for a save from before rotation. */
export function rivalsOf(state) {
  return sanitizeRivals(state && state.rivals);
}

/** True when this line-up is the classic one (generateWorld then stays byte-identical to the pre-rotation world). */
export function classicRivals(rivals) {
  return !Array.isArray(rivals) || isClassic(rivals);
}

/** Rival factions holding land on this continent, in id order. */
export function rivalsInWorld(world) {
  const out = new Set();
  for (const r of world.regions) if (r.faction > 1) out.add(r.faction);
  return [...out].sort((a, b) => a - b);
}

export function isRivalPresent(world, factionId) {
  const f = world.factions[factionId];
  return !!f && !f.absent && world.regions.some((r) => r.faction === factionId);
}

function holder(state, world, regionId) {
  const occ = state.occupation && state.occupation[regionId];
  return occ && Number.isInteger(occ.by) ? occ.by : state.owner[regionId];
}

function undyingHeld(state, world, regionId) {
  const f = world.factions[holder(state, world, regionId)];
  return !!f && f.personality === 'undying';
}

/** A frontier region (not yours, bordering yours) held by an 'undying' faction, lowest id; null when none. */
export function ashenOnFrontier(state, world) {
  for (const region of world.regions) {
    if (state.owner[region.id] === 0 || !undyingHeld(state, world, region.id)) continue;
    if (region.neighbors.some((n) => state.owner[n] === 0)) return region.id;
  }
  return null;
}

/** The card's line about The Fallen Rise for a region held by an 'undying' faction (plus the Barrow Keep's on its capital); else null. */
export function fallenLine(state, world, regionId) {
  if (!world.regions[regionId] || state.owner[regionId] === 0 || !undyingHeld(state, world, regionId)) return null;
  const line = ASHEN.copy.cardLine.replace('{pct}', `${Math.round(ASHEN.fallen.share * 100)}%`);
  if (!world.regions[regionId].isCapital) return line;
  return `${line}. ${ASHEN.copy.capitalLine.replace('{sec}', String(ASHEN.rising.everySec))}`;
}

// --- PLAN-PHASE12: the sea on the region card -----------------------------------------------------------------------------------

/**
 * The region card's sea lines for a region on an archipelago, in display order (empty on a land continent or for the player's own
 * region): the fords it has, its harbour ("holding it opens the sea lanes"), the Tide on a 'raider' capital, and the raider's habit.
 * @returns {string[]}
 */
export function seaLines(state, world, regionId) {
  const region = world && world.archipelago ? world.regions[regionId] : null;
  if (!region || state.owner[regionId] === 0) return [];
  const out = [];
  const fords = region.tiles.filter((i) => world.tiles[i] && world.tiles[i].ford).length;
  if (fords > 0) out.push(SEA.copy.cardFords.replace('{n}', String(fords)).replace('{mult}', String(FORD.marchMult)));
  if (regionHarbours(world, regionId).length || quayTile(world, regionId) != null) out.push(SEA.copy.cardHarbour); // its battle has a harbour site
  const f = world.factions[holder(state, world, regionId)];
  const raider = !!f && f.personality === 'raider';
  if (raider && region.isCapital) {
    out.push(SEA.copy.cardTide.replace('{sec}', String(TIDE.everySec)).replace('{flood}', String(TIDE.floodSec))
      .replace('{pct}', `${Math.round(TIDE.loss * 100)}%`));
  }
  if (raider) out.push(SEA.copy.cardRaider);
  return out;
}

/** The sea-lane line for the realm panel / codex ("Sea lanes: your harbours sail troops at x0.6 march cost"). */
export function laneLine() {
  return SEA.copy.cardLane.replace('{mult}', String(LANE.tileCost));
}

/** A frontier region on an archipelago with fords (the first-fords tutorial hint's trigger), lowest id; null when none. */
export function fordsOnFrontier(state, world) {
  if (!world || !world.archipelago) return null;
  for (const region of world.regions) {
    if (state.owner[region.id] === 0 || !region.neighbors.some((n) => state.owner[n] === 0)) continue;
    if (region.tiles.some((i) => world.tiles[i] && world.tiles[i].ford)) return region.id;
  }
  return null;
}
