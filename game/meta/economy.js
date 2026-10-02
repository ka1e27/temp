// Idle gold economy (DESIGN §5.1, ARCHITECTURE §5). Pure: no DOM, no
// Date.now, no Math.random, no storage globals — time is always injected.

import { ECONOMY, DYNASTY } from '../config/meta.js';
import { PLAYER_FACTION } from './state.js';
import { UPGRADES, levelOf } from './upgrades.js';
import { perkMultipliers } from './perks.js';
import { prosperityIncomeMult } from './prosperity.js';
import { worksIncomeMult } from './worksEffects.js'; // the leaf (DESIGN §5.8): a Market raises its own region's income

/**
 * Gold/s a single region pays, before taxes/perks/dynasty stars.
 * DESIGN §5.1: `baseIncome × incomePerTier^(tier−1)` gold/s, capitals ×2 — except the start
 * region, which is pinned to ECONOMY.startRegionIncome rather than the
 * formula (tier 0 would otherwise mean a negative exponent).
 * @param {import('../world/generate.js').Region} region
 */
export function regionIncome(region) {
  if (region.tier === 0) return ECONOMY.startRegionIncome;
  const base = ECONOMY.baseIncome * Math.pow(ECONOMY.incomePerTier, region.tier - 1);
  return region.isCapital ? base * ECONOMY.capitalIncomeMult : base;
}

/**
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @returns {number} total gold/s across every owned region (each one grown by its prosperity level, DESIGN §5.6, and its Market, §5.8)
 */
export function incomePerSec(state, world) {
  let sum = 0;
  for (const region of world.regions) {
    if (state.owner[region.id] === PLAYER_FACTION) {
      sum += regionIncome(region) * prosperityIncomeMult(state, region.id) * worksIncomeMult(state, region.id);
    }
  }
  const taxMult = 1 + levelOf(state, 'taxes') * UPGRADES.taxes.magnitude;
  const perks = perkMultipliers(state, world);
  const starMult = 1 + state.dynasty.stars * DYNASTY.incomePerStar;
  return sum * taxMult * perks.income * starMult;
}

/**
 * Advances the idle economy by `dtSec` of wall-clock time.
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @param {number} dtSec
 * @returns {number} gold gained this tick
 */
export function tickIncome(state, world, dtSec) {
  const gained = incomePerSec(state, world) * Math.max(0, dtSec);
  state.gold += gained;
  state.stats.goldEarned += gained;
  return gained;
}

/**
 * Reconciles gold earned while away, capped by the Treasury upgrade, and
 * applies it immediately (the "Welcome back" card in welcome.js is a
 * celebration of gold already granted, not a gate on granting it). Also
 * advances `state.lastSeen` to `now` so a second call never double-counts.
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @param {number} now
 * @returns {{ seconds: number, gold: number }}
 */
export function offlineEarnings(state, world, now) {
  const elapsedSec = Math.max(0, (now - state.lastSeen) / 1000);
  const capHours = ECONOMY.offlineCapHours + levelOf(state, 'treasury') * UPGRADES.treasury.magnitude;
  const cappedSec = Math.min(elapsedSec, capHours * 3600);
  const gold = incomePerSec(state, world) * cappedSec;
  state.gold += gold;
  state.stats.goldEarned += gold;
  state.lastSeen = now;
  return { seconds: cappedSec, gold };
}

/**
 * One-time gold for conquering `regionId` (DESIGN §5.1): ECONOMY.bountySeconds of the realm's TOTAL
 * income at this moment (before the new region joins it) × the bounty multipliers (Plunder, Harbour
 * and other perks, dynasty stars). The bounty therefore grows with the realm instead of with the
 * conquered region's own pay. Pure — does not mutate state; progression.js's `conquer` pays it out.
 * Call it BEFORE the region is owned (a region the player already owns would add its own income and
 * perk); crowns.js recomputes it against the region's original owner for that reason.
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @param {number} regionId
 */
export function bounty(state, world, regionId) {
  void regionId; // the bounty depends on the realm, not on which region falls; the argument keeps the contract
  const plunderMult = 1 + levelOf(state, 'plunder') * UPGRADES.plunder.magnitude;
  const perks = perkMultipliers(state, world);
  const starMult = 1 + state.dynasty.stars * DYNASTY.bountyPerStar;
  return ECONOMY.bountySeconds * incomePerSec(state, world) * plunderMult * perks.bounty * starMult;
}
