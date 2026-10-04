// Militia garrisons (DESIGN §10.4): every settlement of a region the player holds keeps a militia that defends it in a raid and
// refills over time (full in about 8 min after a defense; a Militia Hall raises and speeds it). Pure: time is passed in.
//
//   state.militia = { [regionId]: { fill: 0..1, at: ms } }    fill at time `at`; refilled lazily from the clock
//
// A missing entry means a full militia, so nothing needs creating until a defense drains one. Militia only fight in DEFENSE
// battles: in the player's own attacks the halo still uses the small border share (arena.js), so attacks are not trivialised.
import { FRONTIER } from '../config/frontier.js';
import { ENEMY_SCALING } from '../config/battle.js';
import { PLAYER_BASE, DYNASTY } from '../config/meta.js';
import { UPGRADES, levelOf } from './upgrades.js';
import { enemyDepth } from './progression.js';
import { regionFortEffects } from './fortsEffects.js';

/** Garrison multiplier the enemy depth ladder gives a fight at `depth` (ENEMY_SCALING troops x the dynasty multiplier). */
export function depthTroopMult(state, depth) {
  const done = Math.max(0, ((state.dynasty && state.dynasty.level) || 1) - 1);
  const dynastyMult = done === 0 ? 1 : DYNASTY.enemyMultFirst * Math.pow(DYNASTY.enemyMultPerDynasty, done - 1);
  return ENEMY_SCALING.troopAtDepth1 * Math.pow(ENEMY_SCALING.troopPerTier, Math.max(0, depth - 1)) * dynastyMult;
}

/**
 * The size of a region's militia relative to FRONTIER.militia.perType: (War Camp troops from Muster / the base camp)^musterExp
 * x (the region's depth troop multiplier)^depthExp. Militia Halls are NOT included (see militiaGarrisons).
 * @returns {number}
 */
export function militiaScale(state, world, regionId) {
  const cfg = FRONTIER.militia;
  const camp = PLAYER_BASE.campTroops + levelOf(state, 'muster') * UPGRADES.muster.magnitude;
  const region = world.regions[regionId];
  const depth = region ? Math.max(1, enemyDepth(world, region)) : 1;
  return Math.pow(camp / PLAYER_BASE.campTroops, cfg.musterExp) * Math.pow(depthTroopMult(state, depth), cfg.depthExp);
}

/** Creates `state.militia` if it is missing and returns it. */
export function ensureMilitia(state) {
  if (!state.militia || typeof state.militia !== 'object' || Array.isArray(state.militia)) state.militia = {};
  return state.militia;
}

/**
 * How full a region's militia is at `nowMs`, 0..1: the stored fill plus the refill since it was stored
 * (FRONTIER.militia.refillMs from empty to full, faster with a Militia Hall). 1 when nothing is stored.
 */
export function militiaFill(state, regionId, nowMs) {
  const entry = state.militia && state.militia[regionId];
  if (!entry || !Number.isFinite(entry.fill)) return 1;
  const refill = regionFortEffects(state, regionId).refillMult;
  const elapsed = Number.isFinite(entry.at) && Number.isFinite(nowMs) ? Math.max(0, nowMs - entry.at) : Infinity;
  return Math.max(0, Math.min(1, entry.fill + (elapsed * refill) / FRONTIER.militia.refillMs));
}

/**
 * The militia garrison of every settlement in the region at `nowMs`, in `world.regions[regionId].settlements` order:
 * FRONTIER.militia.perType[type] x militiaScale x the Militia Hall x the fill. (buildDefenseArena's `opts.militia`.)
 * @returns {number[]}
 */
export function militiaGarrisons(state, world, regionId, nowMs) {
  const region = world.regions[regionId];
  if (!region) return [];
  const k = militiaScale(state, world, regionId) * regionFortEffects(state, regionId).hallMult * militiaFill(state, regionId, nowMs);
  return region.settlements.map((id) => (FRONTIER.militia.perType[world.settlements[id].type] ?? 0) * k);
}

/** The Arrow Tower fortification's garrison at `nowMs` (buildDefenseArena's `opts.towerTroops`). */
export function militiaTowerGarrison(state, world, regionId, nowMs) {
  return FRONTIER.militia.towerFort * militiaScale(state, world, regionId) * regionFortEffects(state, regionId).hallMult
    * militiaFill(state, regionId, nowMs);
}

/** Cap scale for the player's sites in this region's defenses (buildDefenseArena's `opts.militiaCapMult`). */
export function militiaCapMult(state, world, regionId) {
  return Math.max(1, militiaScale(state, world, regionId) * regionFortEffects(state, regionId).hallMult * FRONTIER.militia.capHeadroom);
}

/**
 * After a defense: the militia lost `lost` (a fraction 0..1 of the garrison it started with; at least FRONTIER.militia.lossFloor)
 * and refills from now. MUTATES `state.militia`. Returns the new fill.
 */
export function drainMilitia(state, regionId, lost, nowMs) {
  const now = militiaFill(state, regionId, nowMs);
  const loss = Math.max(FRONTIER.militia.lossFloor, Math.min(1, Number.isFinite(lost) ? lost : 1));
  const fill = Math.max(0, now - loss);
  ensureMilitia(state)[regionId] = { fill, at: nowMs };
  return fill;
}

/** Fills a region's militia at once (Phase 2's Muster with Renown). MUTATES `state.militia`. */
export function refillMilitia(state, regionId, nowMs) {
  ensureMilitia(state)[regionId] = { fill: 1, at: nowMs };
}

/**
 * The share of the militia a finished defense cost: 1 - (the player's troops on the region's sites at the end / at the start),
 * clamped to 0..1. Troops that grew during the siege count, so a comfortable hold costs little.
 */
export function defenseLossFraction(battle) {
  const regionId = battle.arena.regionId;
  const tiles = new Map(battle.arena.tiles.map((t) => [t.i, t]));
  const inRegion = (s) => tiles.get(s.tile) && tiles.get(s.tile).region === regionId;
  const start = battle.arena.sites.filter((s) => s.owner === 0 && inRegion(s)).reduce((a, s) => a + s.troops, 0);
  const end = battle.sites.filter((s) => s.owner === 0 && inRegion(s)).reduce((a, s) => a + s.troops, 0);
  if (!(start > 0)) return 1;
  return Math.max(0, Math.min(1, 1 - end / start));
}

/** Drops every militia record (a new dynasty or realm). */
export function resetMilitia(state) {
  state.militia = {};
  return state;
}

/** A save's militia table, made valid: integer region ids, fill 0..1, finite `at`. Never throws. For save.js withDefaults. */
export function sanitizeMilitia(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, v] of Object.entries(raw)) {
    if (!/^\d+$/.test(key) || !v || typeof v !== 'object') continue;
    const fill = Number(v.fill);
    const at = Number(v.at);
    if (!Number.isFinite(fill) || !Number.isFinite(at)) continue;
    out[key] = { fill: Math.max(0, Math.min(1, fill)), at };
  }
  return out;
}
