// The upgrade shop: costs, purchase, and the aggregation of every owned level
// into the four buckets meta/modifiers.js consumes.
//
// PURITY: no time, no storage, no randomness. Every number lives in
// content/upgrades.data.js; this file only does arithmetic on them.
//
// ATOMICITY is the whole point of buy(): it either deducts the exact integer
// cost and raises the level, or it changes nothing at all. There is no
// intermediate state where crowns have been spent and the level has not moved,
// and `crowns` can never go negative — including at cost - 0.001, which a
// float-accumulating idle income WILL produce.

import { UPGRADES, UPGRADE_BY_ID, UPGRADE_GROUPS, STARTING_UNITS, OFFLINE, upgradeCost }
  from '../content/upgrades.data.js';
import { META_EVENTS, emit } from './events.js';

export { UPGRADES, UPGRADE_BY_ID, UPGRADE_GROUPS };

/** Levels already owned. Absent === 0. */
export function levelOf(meta, id) {
  return meta?.upgrades?.[id] ?? 0;
}

/** Cost of the NEXT level, or Infinity when maxed. Always an integer. */
export function nextCost(meta, id) {
  const u = UPGRADE_BY_ID[id];
  if (!u) return Infinity;
  const level = levelOf(meta, id);
  if (level >= u.maxLevel) return Infinity;
  return upgradeCost(u, level);
}

/** Cost of a specific level index (0 = first purchase). Exposed for tests and
 *  for the shop tooltip's "total to max" line. */
export function costAtLevel(id, level) {
  const u = UPGRADE_BY_ID[id];
  if (!u || level < 0 || level >= u.maxLevel) return Infinity;
  return upgradeCost(u, level);
}

/** Total crowns to take an upgrade from its current level to max. */
export function costToMax(meta, id) {
  const u = UPGRADE_BY_ID[id];
  if (!u) return Infinity;
  let total = 0;
  for (let l = levelOf(meta, id); l < u.maxLevel; l++) total += upgradeCost(u, l);
  return total;
}

/**
 * @returns {{ok:boolean, reason:string, cost:number, level:number, maxLevel:number}}
 */
export function canBuy(meta, id) {
  const u = UPGRADE_BY_ID[id];
  if (!u) return { ok: false, reason: 'unknown', cost: Infinity, level: 0, maxLevel: 0 };
  const level = levelOf(meta, id);
  if (level >= u.maxLevel) {
    return { ok: false, reason: 'maxed', cost: Infinity, level, maxLevel: u.maxLevel };
  }
  const cost = upgradeCost(u, level);
  if (!(meta.crowns >= cost)) {
    return { ok: false, reason: 'insufficient', cost, level, maxLevel: u.maxLevel };
  }
  return { ok: true, reason: 'ok', cost, level, maxLevel: u.maxLevel };
}

/**
 * Atomic purchase. Mutates `meta` only on success.
 * @returns {{ok:boolean, reason:string, cost:number, level:number}}
 */
export function buy(meta, id, bus) {
  const check = canBuy(meta, id);
  if (!check.ok) return { ...check, level: check.level };

  // Single assignment pair, nothing between them that can throw.
  meta.crowns -= check.cost;
  meta.upgrades[id] = check.level + 1;
  meta.stats.crownsSpent += check.cost;

  const result = { ok: true, reason: 'ok', cost: check.cost, level: check.level + 1 };
  emit(bus, META_EVENTS.UPGRADE_PURCHASED, { id, ...result });
  emit(bus, META_EVENTS.CROWNS_CHANGED, {
    crowns: meta.crowns, delta: -check.cost, reason: 'spend',
  });
  return result;
}

// ---------------------------------------------------------------------------
// Aggregation. One pass over owned levels producing the four buckets.
// ---------------------------------------------------------------------------

/**
 * @typedef {object} UpgradeEffects
 * @property {Record<string,number>} add   additive fractions, applied as (1 + sum)
 * @property {Record<string,number>} mult  independent multipliers, multiplied together
 * @property {Record<string,number>} flat  raw additions (gold, troops, ms, slots)
 * @property {string[]} units             unlocked unit ids, in roster order
 * @property {string[]} boosters          unlocked booster ids
 * @property {Record<string,boolean>} features
 */

/** @returns {UpgradeEffects} */
export function upgradeEffects(meta) {
  const out = {
    add: {}, mult: {}, flat: {},
    units: [...STARTING_UNITS], boosters: [], features: {},
  };
  for (const u of UPGRADES) {
    const level = levelOf(meta, u.id);
    if (level <= 0) continue;
    for (const e of u.effects) {
      if (e.bucket === 'add') out.add[e.key] = (out.add[e.key] ?? 0) + e.value * level;
      else if (e.bucket === 'mult') out.mult[e.key] = (out.mult[e.key] ?? 1) * e.value ** level;
      else if (e.bucket === 'flat') out.flat[e.key] = (out.flat[e.key] ?? 0) + e.value * level;
      else if (e.bucket === 'unlock') {
        if (e.key === 'unit') { if (!out.units.includes(e.value)) out.units.push(e.value); }
        else if (e.key === 'booster') out.boosters.push(e.value);
        else if (e.key === 'feature') out.features[e.value] = true;
      }
    }
  }
  return out;
}

/** Convenience readers used by idle.js and modifiers.js. */
export const addBonus = (fx, key) => fx.add[key] ?? 0;
export const multBonus = (fx, key) => fx.mult[key] ?? 1;
export const flatBonus = (fx, key) => fx.flat[key] ?? 0;

/** Offline cap: base 8h, +4h per Granary level, clamped to the 24h design max. */
export function offlineCapMs(meta) {
  const fx = upgradeEffects(meta);
  return Math.min(OFFLINE.hardMaxCapMs, OFFLINE.baseCapMs + flatBonus(fx, 'offlineCapMs'));
}

/** Units the player may put in an expedition, in canonical roster order. */
export function unlockedUnits(meta) {
  return upgradeEffects(meta).units;
}

export function hasFeature(meta, feature) {
  return upgradeEffects(meta).features[feature] === true;
}

/** Shop listing, grouped, with everything the UI needs and no DOM. */
export function shopListing(meta) {
  return UPGRADE_GROUPS.map((g) => ({
    ...g,
    items: UPGRADES.filter((u) => u.group === g.id).map((u) => {
      const check = canBuy(meta, u.id);
      return {
        id: u.id,
        name: u.name,
        desc: u.desc,
        level: levelOf(meta, u.id),
        maxLevel: u.maxLevel,
        cost: check.cost,
        affordable: check.ok,
        reason: check.reason,
      };
    }),
  }));
}
