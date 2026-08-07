// Booster inventory: what is unlocked, how many charges you own, and what gets
// carried into a battle.
//
// Boosters are the one consumable in the game. Forced March and Emergency
// Fortify need no unlock, so even a brand-new player has an "accelerate" verb
// and a "survive" verb; Rally, War Tithe and Bombardment are shop unlocks.
//
// WHO DECREMENTS: buildBattleConfig is PURE and must never mutate meta, so it
// only *lists* the charges being carried. meta/rewards.js decrements the ones
// the battle reports as actually spent (outcome.boostersConsumed). A battle you
// withdraw from without firing anything therefore costs you nothing, which is
// the behaviour players expect and the opposite of what pre-decrementing gives.
//
// PURE: no time, no storage, no randomness.

import { BOOSTERS } from '../content/balance.js';
import { BOOSTER_SHOP } from '../content/upgrades.data.js';
import { levelOf } from './upgrades.js';
import { META_EVENTS, emit } from './events.js';

export const BOOSTER_IDS = Object.freeze(Object.keys(BOOSTER_SHOP));

export const specOf = (id) => BOOSTERS[id] ?? null;
export const shopEntry = (id) => BOOSTER_SHOP[id] ?? null;

export function isUnlocked(meta, id) {
  const entry = BOOSTER_SHOP[id];
  if (!entry) return false;
  return entry.unlockedBy === null || levelOf(meta, entry.unlockedBy) > 0;
}

export function countOf(meta, id) {
  return Math.max(0, Math.floor(meta?.boosters?.[id] ?? 0));
}

export function chargeCost(id) {
  return BOOSTER_SHOP[id]?.chargeCost ?? Infinity;
}

/** @returns {{ok:boolean, reason:string, cost:number, count:number}} */
export function canBuyCharge(meta, id, n = 1) {
  const entry = BOOSTER_SHOP[id];
  const count = countOf(meta, id);
  if (!entry) return { ok: false, reason: 'unknown', cost: Infinity, count };
  if (!isUnlocked(meta, id)) return { ok: false, reason: 'locked', cost: entry.chargeCost, count };
  const want = Math.max(1, Math.floor(n));
  if (count + want > entry.maxStock) {
    return { ok: false, reason: 'full', cost: entry.chargeCost * want, count };
  }
  const cost = entry.chargeCost * want;
  if (!(meta.crowns >= cost)) return { ok: false, reason: 'insufficient', cost, count };
  return { ok: true, reason: 'ok', cost, count };
}

/** Atomic, exactly like an upgrade purchase: all charges or none. */
export function buyCharge(meta, id, n = 1, bus) {
  const check = canBuyCharge(meta, id, n);
  if (!check.ok) return check;
  const want = Math.max(1, Math.floor(n));

  meta.crowns -= check.cost;
  meta.boosters[id] = check.count + want;
  meta.stats.crownsSpent += check.cost;

  const result = { ok: true, reason: 'ok', cost: check.cost, count: meta.boosters[id] };
  emit(bus, META_EVENTS.BOOSTER_PURCHASED, { id, added: want, ...result });
  emit(bus, META_EVENTS.CROWNS_CHANGED, {
    crowns: meta.crowns, delta: -check.cost, reason: 'spend',
  });
  return result;
}

/** Deduct spent charges. Clamped at zero: a battle can never put the inventory
 *  negative no matter what it reports. */
export function consume(meta, consumed, bus) {
  const applied = [];
  for (const entry of consumed ?? []) {
    const id = entry?.id;
    const want = Math.max(0, Math.floor(entry?.count ?? 0));
    if (!id || !BOOSTER_SHOP[id] || want === 0) continue;
    const have = countOf(meta, id);
    const take = Math.min(have, want);
    if (take === 0) continue;
    meta.boosters[id] = have - take;
    applied.push({ id, count: take });
  }
  for (const a of applied) emit(bus, META_EVENTS.BOOSTER_CONSUMED, a);
  return applied;
}

/** Everything the pre-battle strip needs. */
export function inventory(meta) {
  return BOOSTER_IDS.map((id) => ({
    id,
    unlocked: isUnlocked(meta, id),
    count: countOf(meta, id),
    chargeCost: chargeCost(id),
    maxStock: BOOSTER_SHOP[id].maxStock,
    spec: specOf(id),
  }));
}

/** Sensible default: bring everything you own. */
export function defaultSelection(meta) {
  return BOOSTER_IDS.filter((id) => isUnlocked(meta, id) && countOf(meta, id) > 0);
}

/**
 * Normalise a player selection into the contract's `boosters: [{id, charges}]`.
 * Accepts either `['rally','tithe']` or `[{id:'rally', charges:2}]`, clamps to
 * what is actually owned and unlocked, and sorts by id so two identical
 * selections always produce the same configHash.
 */
export function toConfigBoosters(meta, selection) {
  const requested = new Map();
  for (const entry of selection ?? []) {
    const id = typeof entry === 'string' ? entry : entry?.id;
    if (!id || !BOOSTER_SHOP[id]) continue;
    const want = typeof entry === 'object' && Number.isFinite(entry.charges)
      ? Math.max(0, Math.floor(entry.charges))
      : countOf(meta, id);
    requested.set(id, Math.max(requested.get(id) ?? 0, want));
  }
  const out = [];
  for (const id of BOOSTER_IDS) {
    if (!requested.has(id) || !isUnlocked(meta, id)) continue;
    const charges = Math.min(requested.get(id), countOf(meta, id));
    if (charges > 0) out.push({ id, charges });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
