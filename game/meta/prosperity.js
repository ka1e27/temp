// Prosperity (DESIGN §5.6): regions the player holds grow prosperous with wall-clock tenure.
// Level I / II / III after 30 min / 2 h / 8 h, each adding +5 % of that region's income.
//
// PURE: no DOM, no Date.now, no Math.random, no storage. Time is always passed in (`now`, ms).
//
// Data: `state.prosperity` is an array of levels (0..3) per region id. It is the level the
// player has already been credited with, i.e. the level the economy pays and the map shows.
// Levels are derived from `state.conqueredAt[regionId]` and `state.owner[regionId]`, so the
// stored array is a cache that also remembers what was already celebrated:
//   * `updateProsperity` syncs it to the truth and reports every level-up exactly once;
//   * `prosperityIncomeMult` reads the STORED level, so offline earnings that run before the
//     first update after a load automatically use the levels at departure (conservative);
//   * a region the player does not own (lost, or a new dynasty) is silently reset to 0;
//   * while the player keeps owning a region its stored level NEVER goes down: a clock that moves back (a manual change, a
//     restored VM) cannot drop the income bonus or make a level "re-fire" its celebration when the clock catches up again.
//     The only resets are losing the region (an update while it is not owned) and a new dynasty (resetRegions / resetProsperity).
import { PROSPERITY } from '../config/prosperity.js';
import { PLAYER_FACTION } from './state.js';
import { recordDeed } from './deeds.js';
import { edictMods } from './edicts.js'; // the leaf (PLAN-PHASE5): Grand Festival halves natural growth
import { harvestBonusMs, harvestReachAt } from './eventsState.js'; // the leaf (PLAN-PHASE8): Harvest Festivals add tenure

/** Tenure counts x this (Grand Festival 0.5). */
function rate(state) {
  return edictMods(state).prosperityRateMult;
}

/**
 * @typedef {Object} LevelUp
 * @property {number} regionId
 * @property {number} level   the level reached (1..3); a long absence can skip levels
 * @property {number} from    the level the region was credited with before
 */

/**
 * Level for a tenure in ms (pure helper; negative or non-finite tenure is level 0).
 * @param {number} tenureMs
 * @returns {number} 0..PROSPERITY.maxLevel
 */
export function levelForTenure(tenureMs) {
  if (!Number.isFinite(tenureMs) || tenureMs <= 0) return 0;
  const th = PROSPERITY.thresholdsMs;
  let level = 0;
  for (let i = 0; i < th.length; i++) if (tenureMs >= th[i]) level = i + 1;
  return Math.min(level, PROSPERITY.maxLevel);
}

/** Effective tenure (ms) from `at` to `now`: wall time plus the Harvest Festivals' extra, x the Grand Festival's rate. */
function tenure(state, at, now) {
  return (now - at + harvestBonusMs(state, at, now)) * rate(state);
}

function owned(state, regionId) {
  return state.owner != null && state.owner[regionId] === PLAYER_FACTION;
}

/**
 * The level a region SHOULD have at `now`: from tenure `now - conqueredAt[regionId]`, and only
 * while the player owns it. Does not read or write `state.prosperity`.
 * @param {import('./state.js').GameState} state
 * @param {number} regionId
 * @param {number} now ms timestamp
 * @returns {number} 0..3
 */
export function prosperityLevel(state, regionId, now) {
  if (!owned(state, regionId)) return 0;
  const at = state.conqueredAt ? state.conqueredAt[regionId] : null;
  if (at == null || !Number.isFinite(at)) return 0;
  return levelForTenure(tenure(state, at, now));
}

function sanitize(v) {
  return Number.isInteger(v) && v > 0 ? Math.min(v, PROSPERITY.maxLevel) : 0;
}

/** The stored level of a region the player owns (0 when it is not owned or nothing is stored). */
function heldLevel(state, regionId) {
  return owned(state, regionId) && Array.isArray(state.prosperity) ? sanitize(state.prosperity[regionId]) : 0;
}

/**
 * Syncs `state.prosperity` to the levels at `now` and returns the level-ups since the last call
 * (each reported exactly once; a region that jumped from 0 to 2 while the game was closed is one
 * entry with `level: 2, from: 0`). Regions the player does not own (lost, or a new dynasty whose
 * `conqueredAt` was repopulated) drop to 0 silently. A region the player keeps never drops: the stored level is the
 * larger of what it already was and what the tenure says now, so a clock set back changes nothing and is never
 * celebrated twice. Creates `state.prosperity` if it is missing.
 * Call it every few seconds and right after `offlineEarnings`.
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @param {number} now ms timestamp
 * @returns {LevelUp[]} ordered by region id
 */
export function updateProsperity(state, world, now) {
  if (!Array.isArray(state.prosperity)) state.prosperity = [];
  const stored = state.prosperity;
  const n = world.regions.length;
  const ups = [];
  for (let id = 0; id < n; id++) {
    const prev = sanitize(stored[id]);
    const level = owned(state, id) ? Math.max(prev, prosperityLevel(state, id, now)) : 0;
    if (level > prev) ups.push({ regionId: id, level, from: prev });
    stored[id] = level;
  }
  stored.length = n;
  if (ups.length) recordDeed(state, 'prosperity', Math.max(...ups.map((u) => u.level))); // the Patron deed
  return ups;
}

/**
 * Sets `state.prosperity` to the levels at `now` WITHOUT reporting anything. Use it once after
 * loading a save that predates the feature (no `prosperity` field) so a long-held realm does not
 * fire a celebration per region, and never for anything else.
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @param {number} now
 */
export function baselineProsperity(state, world, now) {
  updateProsperity(state, world, now);
}

/**
 * Zeroes every level (a new dynasty / fresh realm). `updateProsperity` would also do this on its
 * own, but calling this next to `resetRegions` keeps the income multiplier honest in between.
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 */
export function resetProsperity(state, world) {
  state.prosperity = world.regions.map(() => 0);
}

/**
 * Income multiplier for a region: `1 + incomeBonusPerLevel * level`, from the STORED level (the
 * one the player was credited with). 1 for regions the player does not own or when the state has
 * no `prosperity` array (old fixtures). Balance multiplies `regionIncome` by this.
 * @param {import('./state.js').GameState} state
 * @param {number} regionId
 * @returns {number}
 */
export function prosperityIncomeMult(state, regionId) {
  if (!owned(state, regionId) || !Array.isArray(state.prosperity)) return 1;
  return 1 + PROSPERITY.incomeBonusPerLevel * sanitize(state.prosperity[regionId]);
}

/**
 * ms timestamp at which the region reaches its next level, or null when it is not owned, has no
 * conquest timestamp, or is already at the top. With `now` it is the first FUTURE-or-current
 * threshold (robust when the stored level lags behind a long absence); without it, the level after
 * the stored one. For "Prosperity II · next in 1h 12m": `formatDuration(next - now)`.
 * @param {import('./state.js').GameState} state
 * @param {number} regionId
 * @param {number} [now]
 * @returns {number|null}
 */
export function nextProsperityAt(state, regionId, now) {
  if (!owned(state, regionId)) return null;
  const at = state.conqueredAt ? state.conqueredAt[regionId] : null;
  if (at == null || !Number.isFinite(at)) return null;
  const th = PROSPERITY.thresholdsMs;
  let level;
  if (now != null) {
    level = Math.max(levelForTenure(tenure(state, at, now)), heldLevel(state, regionId)); // never below what is already credited
  } else {
    level = Array.isArray(state.prosperity) ? sanitize(state.prosperity[regionId]) : 0;
  }
  if (level >= PROSPERITY.maxLevel || level >= th.length) return null;
  return harvestReachAt(state, at, th[level] / rate(state)); // = at + th / rate with no Harvest Festival
}

/**
 * The earliest timestamp AFTER `now` at which any player-owned region reaches its next level, or
 * null when nothing will change (no owned regions, or all at the top). Levels are computed from
 * tenure, not read from `state.prosperity`. For simulations that advance a clock in big jumps
 * (tools/campaign.mjs, exact offline crediting): jump to this instant instead of past it, call
 * `updateProsperity`, and continue, so income is integrated across level changes.
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @param {number} now ms timestamp
 * @returns {number|null}
 */
export function nextProsperityChangeAt(state, world, now) {
  let best = null;
  for (let id = 0; id < world.regions.length; id++) {
    const at = nextProsperityAt(state, id, now);
    if (at == null || at <= now) continue;
    if (best == null || at < best) best = at;
  }
  return best;
}

/**
 * Everything the region card needs in one call.
 * @param {import('./state.js').GameState} state
 * @param {number} regionId
 * @param {number} now
 * @returns {{ level: number, label: string, nextAt: number|null, nextInMs: number|null,
 *   incomeBonus: number }}
 */
export function prosperityInfo(state, regionId, now) {
  const level = Math.max(prosperityLevel(state, regionId, now), heldLevel(state, regionId)); // what the economy pays and the map shows
  const nextAt = nextProsperityAt(state, regionId, now);
  return {
    level,
    label: PROSPERITY.labels[level] || '',
    nextAt,
    nextInMs: nextAt == null ? null : Math.max(0, nextAt - now),
    incomeBonus: PROSPERITY.incomeBonusPerLevel * level,
  };
}
