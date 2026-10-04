// The dependency-free half of Fortifications (DESIGN §10.3): reading and writing `state.forts`, slots and effects. Pure: no
// DOM, no Date.now, no Math.random, no storage.
//
// Like worksEffects.js this is a LEAF: game/meta/forts.js (costs, actions, panel data) imports progression.js for `enemyDepth`,
// so anything progression.js, frontierState.js or militia.js needs from fortifications comes from here. forts.js re-exports it.
//
//   state.forts = { [regionId]: [{ type, level }] }     one list per region, list index = slot index
//
// A missing entry means "no fortifications". Entries are created only when the player builds. While a region is occupied its
// list lives in `state.occupation[regionId].forts` instead (meta/frontierState.js) and comes back on retake.
import { FORTS, FORT_TYPES } from '../config/frontier.js';
import { PLAYER_FACTION } from './state.js';
import { validFort, fortEffects, fortTowerTiles } from '../battle/fortSites.js';
import { boostedForts } from './featuresState.js';

export { validFort, fortEffects, fortTowerTiles };

/** The most fortifications one region can ever hold (base slots + every prosperity slot). */
export const MAX_FORT_SLOTS = FORTS.slots.base + FORTS.slots.extraAtProsperity.length;

const EMPTY = Object.freeze([]);

function owned(state, regionId) {
  return !!state.owner && state.owner[regionId] === PLAYER_FACTION;
}

/** Creates `state.forts` if it is missing and returns it. */
export function ensureForts(state) {
  if (!state.forts || typeof state.forts !== 'object' || Array.isArray(state.forts)) state.forts = {};
  return state.forts;
}

/** Read-only view of a region's fortifications in slot order (invalid entries skipped; never creates an entry). */
export function fortsOf(state, regionId) {
  const list = state.forts && state.forts[regionId];
  if (!Array.isArray(list)) return EMPTY;
  return list.every(validFort) ? list : list.filter(validFort);
}

/** Level (0 = none) of a fortification type in a region. */
export function fortLevel(state, regionId, type) {
  for (const f of fortsOf(state, regionId)) if (f.type === type) return f.level;
  return 0;
}

/** Fortifications standing in the whole realm. */
export function totalForts(state) {
  if (!state.forts) return 0;
  let n = 0;
  for (const id of Object.keys(state.forts)) n += fortsOf(state, Number(id)).length;
  return n;
}

/**
 * Fortification slots of a region now: 0 when the player does not own it, else FORTS.slots.base plus one per prosperity level
 * in `extraAtProsperity` the region's STORED prosperity level has reached (2, and 3 at Prosperity II).
 */
export function fortSlots(state, regionId) {
  if (!owned(state, regionId)) return 0;
  const level = Array.isArray(state.prosperity) && Number.isInteger(state.prosperity[regionId]) ? state.prosperity[regionId] : 0;
  let slots = FORTS.slots.base;
  for (const at of FORTS.slots.extraAtProsperity) if (level >= at) slots += 1;
  return slots;
}

/** What this region's fortifications do in its defenses (all neutral when it has none). */
export function regionFortEffects(state, regionId) {
  return fortEffects(boostedForts(state, fortsOf(state, regionId))); // Dragonscale counts each one a level higher (DESIGN §10.13)
}

/** Forgets every fortification (a new dynasty or realm, next to resetRegions). Mutates and returns `state`. */
export function resetForts(state) {
  state.forts = {};
  return state;
}

/**
 * Turns whatever a save held into a valid fortifications table: non-negative integer region ids, known types, levels 1..max,
 * one per type per region, at most MAX_FORT_SLOTS per region, empty regions dropped. Never throws. For save.js withDefaults.
 * @param {unknown} raw
 * @returns {Object<string, {type:string, level:number}[]>}
 */
export function sanitizeForts(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  const entries = Array.isArray(raw) ? raw.map((v, i) => [String(i), v]) : Object.entries(raw);
  for (const [key, list] of entries) {
    if (!/^\d+$/.test(key)) continue;
    const clean = sanitizeFortList(list);
    if (clean.length) out[key] = clean;
  }
  return out;
}

/** One region's list, sanitised (also used for the lists kept inside `state.occupation`). */
export function sanitizeFortList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const clean = [];
  for (const f of list) {
    if (!validFort(f) || seen.has(f.type) || clean.length >= MAX_FORT_SLOTS) continue;
    seen.add(f.type);
    clean.push({ type: f.type, level: f.level });
  }
  return clean;
}

export { FORT_TYPES };
