// The dependency-free half of Region Works (DESIGN §5.8): reading and writing `state.works`, slots,
// and every EFFECT a Work has. Pure: no DOM, no Date.now, no Math.random, no storage.
//
// This file exists so game/meta/progression.js (battle stats, difficulty) and economy.js (income) can
// import the effects without an import cycle: game/meta/works.js (costs, actions, panel data) imports
// progression.js for `enemyDepth`, so progression.js and economy.js must depend only on THIS leaf.
// works.js re-exports everything here, so the rest of the game (scenes, UI wiring, tests, tools) can
// import the whole API from one place.
//
//   state.works = { [regionId]: [{ type, level }] }     one list per region, list index = slot index
//
// A missing entry means "no Works", so an old save or a state built by a test fixture works untouched;
// entries are only created when the player builds. Effects only ever count regions the player OWNS, so
// a stale list on a region that is no longer owned is inert even if nobody cleaned it up.
import { WORKS, WORK_TYPES } from '../config/works.js';
import { PLAYER_FACTION } from './state.js';

/**
 * @typedef {Object} Work
 * @property {'barracks'|'stables'|'shrine'|'watchtower'|'market'} type
 * @property {number} level  1..WORKS.maxLevel
 *
 * @typedef {Object} WorksBattleEffects  what the Works next to a target region add to a battle
 * @property {number} campTroops         extra War Camp troops (add to PlayerStats.campTroops)
 * @property {number} speedMult          multiply PlayerStats.speed by this (>= 1)
 * @property {number} cooldownMult       multiply PlayerStats.cooldownMult by this (<= 1)
 * @property {number} campVolleyLevel    0 = the War Camp shoots nothing; 1..3 = it looses arrows like a tower
 * @property {number} campGrowthMult     multiply the War Camp's troop growth by this (>= 1): Barracks
 * @property {number} supplyIntervalMult multiply the player's supply-line interval by this (<= 1): Stables
 * @property {number} fieldStrengthMult  multiply the player's squad-against-squad strength by this (>= 1): Stables, the charge
 */

const TYPES = new Set(WORK_TYPES);

/** The most Works one region can ever hold (conquest slot + every prosperity slot). */
export const MAX_WORK_SLOTS = WORKS.slots.onConquest + WORKS.slots.extraAtProsperity.length;

/** "No Works anywhere": what a battle next to nothing gets. Frozen; do not mutate. */
export const NO_WORKS_EFFECTS = Object.freeze({
  campTroops: 0, speedMult: 1, cooldownMult: 1, campVolleyLevel: 0, campGrowthMult: 1, supplyIntervalMult: 1, fieldStrengthMult: 1,
});

const EMPTY = Object.freeze([]);

function validWork(w) {
  return !!w && TYPES.has(w.type) && Number.isInteger(w.level) && w.level >= 1 && w.level <= WORKS.maxLevel;
}

function owned(state, regionId) {
  return !!state.owner && state.owner[regionId] === PLAYER_FACTION;
}

/**
 * Creates `state.works` if it is missing (state.js and old saves may not have it) and returns it.
 * @param {{ works?: object }} state
 * @returns {Object<string, Work[]>}
 */
export function ensureWorks(state) {
  if (!state.works || typeof state.works !== 'object') state.works = {};
  return state.works;
}

/**
 * Read-only view of one region's Works, in slot order. Never creates an entry. Entries that are not
 * valid Works are skipped (so a hand-edited save cannot break a fight), so do not rely on the index
 * of the returned list when the state may be corrupt: use `state.works[id][slot]` through the actions.
 * @param {{ works?: object }} state
 * @param {number} regionId
 * @returns {readonly Work[]}
 */
export function worksOf(state, regionId) {
  const list = state.works && state.works[regionId];
  if (!Array.isArray(list)) return EMPTY;
  return list.every(validWork) ? list : list.filter(validWork);
}

/** Level (0 = none) of a Work type in a region. */
export function workLevel(state, regionId, type) {
  for (const w of worksOf(state, regionId)) if (w.type === type) return w.level;
  return 0;
}

/** Total Works built in the realm (for tutorial conditions and stats). */
export function totalWorks(state) {
  let n = 0;
  if (!state.works) return 0;
  for (const id of Object.keys(state.works)) n += worksOf(state, Number(id)).length;
  return n;
}

/**
 * How many Work slots a region has right now: 0 when the player does not own it, otherwise
 * `slots.onConquest` plus one for every prosperity milestone in `slots.extraAtProsperity` the region's
 * STORED prosperity level (`state.prosperity`, see prosperity.js) has reached: 1 on conquest, 2 at
 * Prosperity II, 3 at III.
 * @param {{ owner?: number[], prosperity?: number[] }} state
 * @param {number} regionId
 * @returns {number} 0..MAX_WORK_SLOTS
 */
export function workSlots(state, regionId) {
  if (!owned(state, regionId)) return 0;
  const level = Array.isArray(state.prosperity) && Number.isInteger(state.prosperity[regionId]) ? state.prosperity[regionId] : 0;
  let slots = WORKS.slots.onConquest;
  for (const at of WORKS.slots.extraAtProsperity) if (level >= at) slots += 1;
  return slots;
}

// --- Effects ------------------------------------------------------------------------------------

/**
 * What the Works next to `targetRegionId` add to a battle there: the sum over every region the player
 * owns that shares a border with the target (Works in several regions stack), clamped by WORKS.caps.
 * Pure and cheap (a few array reads per neighbour): safe to call for every frontier region on every card
 * refresh. Balance calls it from `playerBattleStats` and so also from `difficulty`.
 *  - campTroops:  Barracks, flat troops
 *  - campGrowthMult: Barracks, 1 + sum, at most caps.campGrowthMult
 *  - speedMult:   Stables, 1 + sum
 *  - supplyIntervalMult: Stables, 1 - sum, never below caps.supplyIntervalFloor
 *  - fieldStrengthMult: Stables, 1 + sum, at most caps.fieldStrengthMult
 *  - cooldownMult: Shrine, 1 - sum, never below caps.cooldownFloor
 *  - campVolleyLevel: Watchtower, sum of levels, at most caps.campVolleyLevel
 * @param {{ owner: number[], works?: object }} state
 * @param {import('../world/generate.js').World} world
 * @param {number} targetRegionId
 * @returns {WorksBattleEffects}
 */
export function worksBattleEffects(state, world, targetRegionId) {
  const target = world.regions[targetRegionId];
  if (!target || !state.works) return NO_WORKS_EFFECTS;
  let troops = 0;
  let growth = 0;
  let supply = 0;
  let field = 0;
  let speed = 0;
  let cooldown = 0;
  let volley = 0;
  let any = false;
  for (const n of target.neighbors) {
    if (!owned(state, n)) continue;
    for (const w of worksOf(state, n)) {
      any = true;
      const v = WORKS.effects[w.type].perLevel * w.level;
      if (w.type === 'barracks') { troops += v; growth += WORKS.effects.barracks.growthPerLevel * w.level; }
      else if (w.type === 'stables') {
        speed += v;
        supply += WORKS.effects.stables.supplyPerLevel * w.level;
        field += WORKS.effects.stables.fieldPerLevel * w.level;
      }
      else if (w.type === 'shrine') cooldown += v;
      else if (w.type === 'watchtower') volley += v;
    }
  }
  if (!any) return NO_WORKS_EFFECTS;
  const caps = WORKS.caps;
  return {
    campTroops: Math.min(caps.campTroops, troops),
    campGrowthMult: Math.min(caps.campGrowthMult, 1 + growth),
    supplyIntervalMult: Math.max(caps.supplyIntervalFloor, 1 - supply),
    fieldStrengthMult: Math.min(caps.fieldStrengthMult, 1 + field),
    speedMult: Math.min(caps.speedMult, 1 + speed),
    cooldownMult: Math.max(caps.cooldownFloor, 1 - cooldown),
    campVolleyLevel: Math.min(caps.campVolleyLevel, Math.floor(volley)),
  };
}

/**
 * Multiplier on a region's OWN income from its Market: `1 + perLevel x level` (1 when there is no Market, the
 * region is not owned, or the state has no Works). Balance multiplies `regionIncome` by this, next to the
 * prosperity multiplier.
 * @param {{ owner: number[], works?: object }} state
 * @param {number} regionId
 * @returns {number}
 */
export function worksIncomeMult(state, regionId) {
  if (!owned(state, regionId)) return 1;
  return 1 + WORKS.effects.market.perLevel * workLevel(state, regionId, 'market');
}

/**
 * True when a Watchtower next door scouts `regionId` for free: a region the player owns that borders it
 * has a Watchtower of at least WORKS.scoutFreeFromLevel. Says nothing about regions the player owns.
 * @param {{ owner: number[], works?: object }} state
 * @param {import('../world/generate.js').World} world
 * @param {number} regionId
 * @returns {boolean}
 */
export function worksScoutedFree(state, world, regionId) {
  const region = world.regions[regionId];
  if (!region || !state.works || owned(state, regionId)) return false;
  for (const n of region.neighbors) {
    if (owned(state, n) && workLevel(state, n, 'watchtower') >= WORKS.scoutFreeFromLevel) return true;
  }
  return false;
}

// --- Resetting ---------------------------------------------------------------------------------

/**
 * Forgets every Work. Call when founding a dynasty (the continent is new) and on any full restart, next to
 * `resetRegions`. Mutates and returns `state`.
 * @param {{ works?: object }} state
 */
export function resetWorks(state) {
  state.works = {};
  return state;
}

/**
 * What happens to a region's Works if the region is ever lost: they are destroyed with it, with no refund
 * (the player does not own the ground any more, and a region retaken later starts over with one slot). Call it
 * wherever ownership flips away from the player. Nothing does that today; `worksBattleEffects`,
 * `worksIncomeMult` and `worksScoutedFree` ignore regions the player does not own anyway, so a missed call
 * is harmless. Mutates and returns `state`.
 * @param {{ works?: object }} state
 * @param {number} regionId
 */
export function clearRegionWorks(state, regionId) {
  if (state.works && regionId in state.works) delete state.works[regionId];
  return state;
}

/**
 * Turns whatever a save contained into a valid Works table: only non-negative integer region ids, known
 * types, integer levels 1..maxLevel, one Work per type per region, at most MAX_WORK_SLOTS per region, and
 * empty regions dropped. Accepts the object form and an array indexed by region id. For meta/save.js's
 * `withDefaults` (`works: sanitizeWorks(src.works)`); never throws.
 * @param {unknown} raw
 * @returns {Object<string, Work[]>}
 */
export function sanitizeWorks(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  const entries = Array.isArray(raw) ? raw.map((v, i) => [String(i), v]) : Object.entries(raw);
  for (const [key, list] of entries) {
    if (!/^\d+$/.test(key) || !Array.isArray(list)) continue;
    const seen = new Set();
    const clean = [];
    for (const w of list) {
      if (!validWork(w) || seen.has(w.type) || clean.length >= MAX_WORK_SLOTS) continue;
      seen.add(w.type);
      clean.push({ type: w.type, level: w.level });
    }
    if (clean.length) out[key] = clean;
  }
  return out;
}
