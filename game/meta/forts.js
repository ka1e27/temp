// Fortifications (DESIGN §10.3): costs, the build / upgrade / demolish actions, copy, the owned card's panel data and the map
// marks. Pure: no DOM, no Date.now, no Math.random, no storage. Follows the Region Works pattern (meta/works.js).
//
//   state.forts = { [regionId]: [{ type: 'tower'|'walls'|'hall'|'beacon', level }] }     see fortsEffects.js (the leaf)
//
// Everything that does not need the difficulty ladder (slots, effects, reading the state, sanitising) lives in ./fortsEffects.js
// and is re-exported here, so the rest of the game imports the whole API from this module.
import { edictMods } from './edicts.js'; // the leaf (PLAN-PHASE5): Masons
import { FORTS, FORT_TYPES } from '../config/frontier.js';
import { PROSPERITY } from '../config/prosperity.js';
import { enemyDepth } from './progression.js';
import { deedBonuses, recordDeed } from './deeds.js';
import { PLAYER_FACTION } from './state.js';
import {
  ensureForts, fortsOf, fortSlots, MAX_FORT_SLOTS, fortTowerTiles,
} from './fortsEffects.js';

export * from './fortsEffects.js';

const TYPES = new Set(FORT_TYPES);
const pct = (fraction) => Math.round(fraction * 100);

/** Display name ("Arrow Tower"). */
export function fortName(type) {
  return FORTS.copy.names[type] || type;
}

/** The highest level of a type (Beacon II, the others III). */
export function fortMaxLevel(type) {
  return FORTS.maxLevel[type] ?? 0;
}

/**
 * What a fortification does at `level`, in words built from the config numbers (never typed).
 * @param {string} type
 * @param {number} level
 * @returns {string}
 */
export function fortEffectText(type, level) {
  const e = FORTS.effects;
  const i = level - 1;
  if (type === 'tower' && e.tower.range[i] != null) {
    const perSec = Math.round((1 / e.tower.volleySec[i]) * 10) / 10;
    return `A tower that shoots ${perSec} arrows a second, ${e.tower.range[i]} hexes`;
  }
  if (type === 'walls' && e.walls.defMult[i] != null) return `Keep and forts defend x${e.walls.defMult[i]}`;
  if (type === 'hall' && e.hall.garrisonMult[i] != null) {
    return `Militia +${pct(e.hall.garrisonMult[i] - 1)}%, refills ${pct(e.hall.refillMult[i] - 1)}% faster`;
  }
  if (type === 'beacon' && e.beacon.warnSec[i] != null) {
    return `+${e.beacon.warnSec[i]} s warning, troops +${pct(e.beacon.speedMult - 1)}% speed here`;
  }
  return '';
}

/** Toast text: fortsToast('built', { fort: 'Walls', region: 'Fenwall' }), ('upgraded', {..., level}), ('demolished', {..., refund}). */
export function fortsToast(kind, { fort = '', region = '', level = 1, refund = 0 } = {}) {
  return String(FORTS.copy.toasts[kind] || '')
    .replace('{fort}', fort).replace('{region}', region).replace('{level}', FORTS.copy.levels[level] || String(level))
    .replace('{refund}', String(refund));
}

function reasonGold(missing) {
  return FORTS.copy.reasons.gold.replace('{n}', String(Math.max(1, Math.ceil(missing))));
}

// --- Costs ------------------------------------------------------------------------------------------------------------

/**
 * Gold to REACH `level` of `type` in `regionId` (level 1 builds it; the price of that one step):
 *   base x perDepth^(depth - 1) x levelMult[level - 1] x typeMult[type]      (config/frontier.js FORTS.cost)
 * Infinity for an unknown region or type or a level outside 1..max.
 */
export function fortCost(state, world, regionId, type, level) {
  const region = world.regions[regionId];
  if (!region || !TYPES.has(type) || !Number.isInteger(level) || level < 1 || level > fortMaxLevel(type)) return Infinity;
  const depth = Math.max(1, enemyDepth(world, region));
  const c = FORTS.cost;
  const deed = state ? deedBonuses(state).fortCostMult : 1; // the Builder deed
  // Masons (PLAN-PHASE5 Legacy): a region's first fortification (level I, none built there yet) is half price
  const masons = state && level === 1 && fortsOf(state, regionId).length === 0 ? edictMods(state).fortFirstLevelMult : 1;
  return Math.round(c.base * Math.pow(c.perDepth, depth - 1) * c.levelMult[level - 1] * c.typeMult[type] * deed * masons);
}

// --- Build / upgrade / demolish ---------------------------------------------------------------------------------------

/** Why `type` cannot be built here now, or null: 'notOwned' | 'noSlot' | 'duplicate' | 'gold'. */
export function fortBuildRefusal(state, world, regionId, type) {
  if (!world.regions[regionId] || !TYPES.has(type) || state.owner[regionId] !== PLAYER_FACTION) return 'notOwned';
  const list = fortsOf(state, regionId);
  if (list.length >= fortSlots(state, regionId)) return 'noSlot';
  if (list.some((f) => f.type === type)) return 'duplicate';
  if (state.gold < fortCost(state, world, regionId, type, 1)) return 'gold';
  return null;
}

export function canBuildFort(state, world, regionId, type) {
  return fortBuildRefusal(state, world, regionId, type) === null;
}

/** Pays for and builds a level-I fortification in the next free slot. MUTATES gold and `state.forts`. */
export function buildFort(state, world, regionId, type) {
  if (!canBuildFort(state, world, regionId, type)) return false;
  const cost = fortCost(state, world, regionId, type, 1);
  const forts = ensureForts(state);
  const list = Array.isArray(forts[regionId]) ? forts[regionId] : (forts[regionId] = []);
  const slot = list.length;
  state.gold -= cost;
  list.push({ type, level: 1 });
  recordDeed(state, 'fortLevels', 1); // the Builder deed
  return { slot, cost, fort: { type, level: 1 } };
}

/** Why the fortification in `slotIdx` cannot be upgraded now, or null: 'notOwned' | 'maxed' | 'gold'. */
export function fortUpgradeRefusal(state, world, regionId, slotIdx) {
  if (!world.regions[regionId] || state.owner[regionId] !== PLAYER_FACTION) return 'notOwned';
  const f = Array.isArray(state.forts && state.forts[regionId]) ? state.forts[regionId][slotIdx] : null;
  if (!f || !TYPES.has(f.type) || !Number.isInteger(f.level) || f.level < 1) return 'notOwned';
  if (f.level >= fortMaxLevel(f.type)) return 'maxed';
  if (state.gold < fortCost(state, world, regionId, f.type, f.level + 1)) return 'gold';
  return null;
}

export function canUpgradeFort(state, world, regionId, slotIdx) {
  return fortUpgradeRefusal(state, world, regionId, slotIdx) === null;
}

/** Pays for one level of the fortification in `slotIdx`. MUTATES gold and the entry. */
export function upgradeFort(state, world, regionId, slotIdx) {
  if (!canUpgradeFort(state, world, regionId, slotIdx)) return false;
  const f = state.forts[regionId][slotIdx];
  const cost = fortCost(state, world, regionId, f.type, f.level + 1);
  state.gold -= cost;
  f.level += 1;
  recordDeed(state, 'fortLevels', 1);
  return { slot: slotIdx, cost, level: f.level, type: f.type };
}

/** Gold a demolish gives back: FORTS.demolishRefund of everything spent on it (levels I..current). */
export function fortDemolishRefund(state, world, regionId, slotIdx) {
  const f = Array.isArray(state.forts && state.forts[regionId]) ? state.forts[regionId][slotIdx] : null;
  if (!f || !TYPES.has(f.type) || !Number.isInteger(f.level) || f.level < 1) return 0;
  let spent = 0;
  for (let level = 1; level <= Math.min(f.level, fortMaxLevel(f.type)); level++) spent += fortCost(state, world, regionId, f.type, level);
  return Number.isFinite(spent) ? Math.round(spent * FORTS.demolishRefund) : 0;
}

export function canDemolishFort(state, world, regionId, slotIdx) {
  if (!world.regions[regionId] || state.owner[regionId] !== PLAYER_FACTION) return false;
  const list = state.forts && state.forts[regionId];
  if (!Array.isArray(list) || !Number.isInteger(slotIdx)) return false;
  const f = list[slotIdx];
  return !!f && TYPES.has(f.type) && Number.isInteger(f.level) && f.level >= 1;
}

/** Tears it down and refunds half; later slots move up; an emptied region's entry is removed. MUTATES gold and `state.forts`. */
export function demolishFort(state, world, regionId, slotIdx) {
  if (!canDemolishFort(state, world, regionId, slotIdx)) return false;
  const refund = fortDemolishRefund(state, world, regionId, slotIdx);
  const list = state.forts[regionId];
  const [gone] = list.splice(slotIdx, 1);
  if (list.length === 0) delete state.forts[regionId];
  state.gold += refund;
  return { refund, type: gone.type, level: gone.level };
}

// --- Panel data (the owned card's Fortifications panel, built like the Works panel) ------------------------------------

/**
 * Everything the Fortifications panel needs in one call (cheap enough for the card's 1 s refresh). Same shape as
 * worksPanelData: `slots` always has MAX_FORT_SLOTS entries ('built' | 'empty' | 'locked'), `freeSlot`, `choices`, `intro`.
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @param {number} regionId
 * @param {number} [now] ms timestamp; with it, a locked slot says how long until it opens
 */
export function fortsPanelData(state, world, regionId, now) {
  const isOwned = state.owner[regionId] === PLAYER_FACTION;
  const unlocked = fortSlots(state, regionId);
  const list = fortsOf(state, regionId);
  const at = state.conqueredAt ? state.conqueredAt[regionId] : null;
  const slots = [];
  let freeSlot = -1;
  for (let i = 0; i < MAX_FORT_SLOTS; i++) {
    if (i < list.length) {
      const f = list[i];
      const maxed = f.level >= fortMaxLevel(f.type);
      const cost = maxed ? null : fortCost(state, world, regionId, f.type, f.level + 1);
      const refusal = fortUpgradeRefusal(state, world, regionId, i);
      const refund = fortDemolishRefund(state, world, regionId, i);
      slots.push({
        index: i, state: 'built', type: f.type, name: fortName(f.type), icon: f.type, level: f.level, maxLevel: fortMaxLevel(f.type),
        effect: fortEffectText(f.type, f.level), nextEffect: maxed ? null : fortEffectText(f.type, f.level + 1),
        upgradeCost: cost, affordable: refusal === null, refund,
        demolishPrompt: FORTS.copy.demolishPrompt.replace('{fort}', fortName(f.type)).replace('{n}', String(refund)),
        reason: refusal === 'gold' ? reasonGold(cost - state.gold) : refusal === 'maxed' ? FORTS.copy.reasons.maxed : null,
      });
    } else if (i < unlocked) {
      if (freeSlot < 0) freeSlot = i;
      const costs = FORT_TYPES.filter((t) => !list.some((f) => f.type === t)).map((t) => fortCost(state, world, regionId, t, 1));
      slots.push({
        index: i, state: 'empty', cheapest: costs.length ? Math.min(...costs) : null,
        canBuild: FORT_TYPES.some((t) => fortBuildRefusal(state, world, regionId, t) === null),
      });
    } else {
      const level = FORTS.slots.extraAtProsperity[i - FORTS.slots.base];
      const threshold = PROSPERITY.thresholdsMs[level - 1];
      slots.push({
        index: i, state: 'locked', unlockLabel: `${FORTS.copy.lockedLabel} ${PROSPERITY.labels[level]}`.trim(),
        unlockInMs: now != null && at != null && Number.isFinite(at) && isOwned && threshold != null ? Math.max(0, at + threshold - now) : null,
      });
    }
  }
  const choices = freeSlot < 0 ? [] : FORT_TYPES.map((type) => {
    const cost = fortCost(state, world, regionId, type, 1);
    const refusal = fortBuildRefusal(state, world, regionId, type);
    return {
      type, name: fortName(type), icon: type, effect: fortEffectText(type, 1), cost, affordable: refusal === null,
      reason: refusal === 'gold' ? reasonGold(cost - state.gold) : refusal ? FORTS.copy.reasons[refusal] : null,
      missing: refusal === 'gold' ? Math.max(1, Math.ceil(cost - state.gold)) : 0,
    };
  });
  return { regionId, gold: state.gold, owned: isOwned, slots, freeSlot, choices, intro: FORTS.copy.intro };
}

// --- Map marks (fortifications show on the map as real structures, DESIGN §10.3) ---------------------------------------

/**
 * Every region with fortifications, for the map layer: owned regions from `state.forts`, occupied ones from
 * `state.occupation` (drawn in the occupier's colour). `towerTile` is where the Arrow Tower stands (fortTowerTiles).
 * @returns {{ regionId:number, occupiedBy:number|null, forts:{type:string, level:number}[], towerTile:number|null, keepTile:number }[]}
 */
export function fortsMarksData(state, world) {
  const out = [];
  const add = (regionId, list, occupiedBy) => {
    if (!list.length || !world.regions[regionId]) return;
    const region = world.regions[regionId];
    const tower = list.find((f) => f.type === 'tower');
    out.push({
      regionId, occupiedBy, forts: list.map((f) => ({ type: f.type, level: f.level })),
      towerTile: tower ? (fortTowerTiles(world, regionId, 1)[0] ?? null) : null,
      keepTile: world.settlements[region.keep].tile,
    });
  };
  for (const region of world.regions) {
    if (state.owner[region.id] === PLAYER_FACTION) add(region.id, fortsOf(state, region.id), null);
    const occ = state.occupation && state.occupation[region.id];
    if (occ && Array.isArray(occ.forts)) add(region.id, occ.forts, occ.by);
  }
  return out;
}
