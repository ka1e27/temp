// The dependency-free half of the intel module: reading and writing `state.intel`
// (DESIGN §5.7) and the sabotage multiplier. Pure: no DOM, no Date.now, no Math.random.
//
// This file exists so game/meta/progression.js can import `sabotageTroopMult` without an
// import cycle: game/meta/intel.js (costs, scout report, panel data) imports progression.js
// for the player's and the enemy's battle stats, so progression.js must depend only on THIS
// leaf. game/meta/intel.js re-exports everything here, so the rest of the game (UI wiring,
// tests, tools) can import the whole API from one place.
//
//   state.intel = { [regionId]: { scouted: boolean, sabotage: 0 | 1 | 2 } }
//
// Missing entries mean "not scouted, not sabotaged", so an old save or a state built by a
// test fixture works untouched; entries are only created when the player pays.
import { INTEL } from '../config/intel.js';

/** @typedef {{ scouted: boolean, sabotage: number }} RegionIntel */
/** @typedef {Object<string, RegionIntel>} IntelTable */

const NONE = Object.freeze({ scouted: false, sabotage: 0 });

/** @param {number} level */
function clampLevel(level) {
  const n = Math.floor(Number(level));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, INTEL.sabotage.maxLevel);
}

/**
 * Creates `state.intel` if it is missing (state.js and old saves may not have it) and returns it.
 * @param {{ intel?: IntelTable }} state
 * @returns {IntelTable}
 */
export function ensureIntel(state) {
  if (!state.intel || typeof state.intel !== 'object' || Array.isArray(state.intel)) state.intel = {};
  return state.intel;
}

/**
 * Read-only view of one region's intel. Never creates an entry; the returned object is frozen
 * when it is the shared "nothing yet" default, so do not mutate it.
 * @param {{ intel?: IntelTable }} state
 * @param {number} regionId
 * @returns {RegionIntel}
 */
export function intelOf(state, regionId) {
  const entry = state.intel && state.intel[regionId];
  if (!entry) return NONE;
  return { scouted: !!entry.scouted, sabotage: clampLevel(entry.sabotage) };
}

/** @param {{ intel?: IntelTable }} state @param {number} regionId */
export function isScouted(state, regionId) {
  return intelOf(state, regionId).scouted;
}

/** Sabotage steps applied to a region, 0..INTEL.sabotage.maxLevel. */
export function sabotageLevel(state, regionId) {
  return intelOf(state, regionId).sabotage;
}

/**
 * Multiplier on the region's enemy `troopMult` (and therefore on every starting garrison,
 * the difficulty label and the surrender check): `1 - step x level`, i.e. 1, 0.85, 0.7.
 * Balance applies it once, inside `enemyBattleStats`.
 * @param {{ intel?: IntelTable }} state
 * @param {number} regionId
 */
export function sabotageTroopMult(state, regionId) {
  return 1 - INTEL.sabotage.step * sabotageLevel(state, regionId);
}

/** "15" for level 1, "30" for level 2: the whole-number percent by which garrisons are cut. */
export function sabotagePercent(level) {
  return Math.round(INTEL.sabotage.step * clampLevel(level) * 100);
}

/**
 * Forgets everything scouted or sabotaged. Call when founding a dynasty (the continent is new)
 * and on any full restart. Mutates and returns `state`.
 * @param {{ intel?: IntelTable }} state
 */
export function resetIntel(state) {
  state.intel = {};
  return state;
}

/**
 * Forgets one region's intel: call when the player conquers it (by battle or surrender), so a
 * stale scouted flag never lingers on a region that is now yours. Mutates and returns `state`.
 * @param {{ intel?: IntelTable }} state
 * @param {number} regionId
 */
export function clearRegionIntel(state, regionId) {
  if (state.intel && regionId in state.intel) delete state.intel[regionId];
  return state;
}

/**
 * Turns whatever a save contained into a valid intel table: only non-negative integer region
 * ids, booleans and clamped levels survive, sabotage implies scouted, and empty entries are
 * dropped. For meta/save.js's `withDefaults` (`intel: sanitizeIntel(src.intel)`); never throws.
 * @param {unknown} raw
 * @returns {IntelTable}
 */
export function sanitizeIntel(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!/^\d+$/.test(key) || !value || typeof value !== 'object') continue;
    const sabotage = clampLevel(value.sabotage);
    const scouted = !!value.scouted || sabotage > 0;
    if (scouted) out[key] = { scouted: true, sabotage };
  }
  return out;
}
