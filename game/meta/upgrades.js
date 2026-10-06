// War Council upgrade catalogue (DESIGN §5.2, ARCHITECTURE §5). Pure: no DOM,
// no Date.now, no Math.random, no storage globals.
//
// Every upgrade shares one shape so council.js can render all three tabs
// generically:
//   { id, tab, name, icon, desc, magnitude, baseCost, growth, max?,
//     startLevel?, effectText(level) }
// `magnitude` is the single tunable number behind both `effectText` and
// whatever economy.js/progression.js multiplies by it, so the UI copy and
// the actual math can never drift apart.
//
// Cost curve: upgradeCost(id, level) = round(baseCost × growth^level), i.e.
// the cost to advance FROM `level` TO `level + 1`. Bases/growths are picked
// so the first purchases in Army/Realm cost ~25–40 gold — 15–40s of the ~1
// gold/s the player starts with — and Powers unlocks cost enough (150g) that
// they matter only once a couple of regions are paying tribute.
//
// The actual baseCost/growth/magnitude numbers live in game/config/meta.js's
// UPGRADE_TUNING table (a balance pass is then a one-file diff); this file
// spreads that table into each definition below so UPGRADES[id] still carries
// its own baseCost/growth/magnitude exactly as before for every caller.

import { POWERS } from '../config/battle.js';
import { UPGRADE_TUNING, ECONOMY, upgradeCostRamp } from '../config/meta.js';

function pct(magnitude, level) {
  return `${Math.round(magnitude * level * 100)}%`;
}

function cooldownAt(powerId, level) {
  const base = POWERS[powerId].cooldown;
  if (level <= 1) return base;
  return base * Math.pow(POWERS.cooldownPerLevel, level - 1);
}

function powerEffectText(powerId, level, describe) {
  if (level < 1) return 'Locked';
  const cooldown = Math.round(cooldownAt(powerId, level) * 10) / 10;
  return `${describe(level)} · ${cooldown}s cooldown`;
}

/** @typedef {{ id: string, tab: 'army'|'realm'|'powers', name: string, icon: string,
 *   desc: string, magnitude: number, baseCost: number, growth: number,
 *   max?: number, startLevel?: number, effectText: (level: number) => string }} UpgradeDef */

/** @type {Object<string, UpgradeDef>} */
export const UPGRADES = Object.freeze({
  // --- Army --------------------------------------------------------------
  recruitment: {
    id: 'recruitment', tab: 'army', name: 'Recruitment', icon: 'boot',
    desc: 'Every settlement musters new troops faster.',
    ...UPGRADE_TUNING.recruitment,
    effectText: (level) => `+${pct(UPGRADE_TUNING.recruitment.magnitude, level)} troop growth`,
  },
  steel: {
    id: 'steel', tab: 'army', name: 'Steel', icon: 'sword',
    desc: 'Sharper blades hit harder in every clash.',
    ...UPGRADE_TUNING.steel,
    effectText: (level) => `+${pct(UPGRADE_TUNING.steel.magnitude, level)} attack`,
  },
  armour: {
    id: 'armour', tab: 'army', name: 'Armour', icon: 'shield',
    desc: 'Heavier plate shrugs off more of every blow.',
    ...UPGRADE_TUNING.armour,
    effectText: (level) => `+${pct(UPGRADE_TUNING.armour.magnitude, level)} defence`,
  },
  logistics: {
    id: 'logistics', tab: 'army', name: 'Logistics', icon: 'horse',
    desc: 'Supply trains and better roads move squads faster.',
    ...UPGRADE_TUNING.logistics,
    effectText: (level) => `+${pct(UPGRADE_TUNING.logistics.magnitude, level)} march speed`,
  },
  muster: {
    id: 'muster', tab: 'army', name: 'Muster', icon: 'tent',
    desc: 'A bigger War Camp starts every battle stronger.',
    ...UPGRADE_TUNING.muster,
    effectText: (level) => `+${Math.round(UPGRADE_TUNING.muster.magnitude * level)} War Camp troops`,
  },

  // --- Realm ---------------------------------------------------------------
  taxes: {
    id: 'taxes', tab: 'realm', name: 'Taxes', icon: 'coin',
    desc: 'Your regions pay a heavier tithe every second.',
    ...UPGRADE_TUNING.taxes,
    effectText: (level) => `+${pct(UPGRADE_TUNING.taxes.magnitude, level)} income`,
  },
  treasury: {
    id: 'treasury', tab: 'realm', name: 'Treasury', icon: 'castle',
    desc: 'A deeper vault keeps earning longer while you are away.',
    ...UPGRADE_TUNING.treasury, max: 16,
    effectText: (level) => `${Number((ECONOMY.offlineCapHours + UPGRADE_TUNING.treasury.magnitude * level).toFixed(1))} h offline cap`,
  },
  plunder: {
    id: 'plunder', tab: 'realm', name: 'Plunder', icon: 'scroll',
    desc: 'Conquered regions pay a richer one-time bounty.',
    ...UPGRADE_TUNING.plunder,
    effectText: (level) => `+${pct(UPGRADE_TUNING.plunder.magnitude, level)} bounty`,
  },

  // --- Powers --------------------------------------------------------------
  // level 0 = locked (all except rally, which starts at 1 — see state.js's
  // createGame). First purchase of a locked power unlocks it at level 1.
  rally: {
    id: 'rally', tab: 'powers', name: 'Rally', icon: 'horn',
    desc: 'Every settlement you own sends reinforcements at once.',
    ...UPGRADE_TUNING.rally, startLevel: 1,
    effectText: (level) => powerEffectText('rally', level,
      (l) => `Send ${Math.round(POWERS.rally.share * 100)}% from every settlement`),
  },
  firestorm: {
    id: 'firestorm', tab: 'powers', name: 'Firestorm', icon: 'flame',
    desc: 'Rain fire on a hex, hurting every squad and garrison inside.',
    ...UPGRADE_TUNING.firestorm,
    effectText: (level) => powerEffectText('firestorm', level,
      (l) => `−${Math.round(POWERS.firestorm.damage + POWERS.firestorm.damagePerLevel * (l - 1))} troops in blast`),
  },
  bulwark: {
    id: 'bulwark', tab: 'powers', name: 'Bulwark', icon: 'shield',
    desc: 'Brace a settlement behind a wall of shields.',
    ...UPGRADE_TUNING.bulwark,
    effectText: (level) => powerEffectText('bulwark', level,
      (l) => `Defence ×${POWERS.bulwark.mult} for ${Math.round(POWERS.bulwark.duration + POWERS.bulwark.durationPerLevel * (l - 1))}s`),
  },
  march: {
    id: 'march', tab: 'powers', name: 'Forced March', icon: 'boot',
    desc: 'Every squad on the field doubles its pace.',
    ...UPGRADE_TUNING.march,
    effectText: (level) => powerEffectText('march', level,
      (l) => `Speed ×${POWERS.march.mult} for ${Math.round(POWERS.march.duration + POWERS.march.durationPerLevel * (l - 1))}s`),
  },
  levy: {
    id: 'levy', tab: 'powers', name: 'Levy', icon: 'bell',
    desc: 'Ring every bell in the realm and swell every garrison.',
    ...UPGRADE_TUNING.levy,
    effectText: (level) => powerEffectText('levy', level,
      (l) => `+${Math.round(POWERS.levy.troops + POWERS.levy.troopsPerLevel * (l - 1))} troops at every settlement`),
  },
});

/** Stable tab order for council.js. */
export const UPGRADE_TABS = Object.freeze(['army', 'realm', 'powers']);

/** All power upgrade ids, in DESIGN §4.5 table order. */
export const POWER_IDS = Object.freeze(['rally', 'firestorm', 'bulwark', 'march', 'levy']);

export function upgradesByTab(tab) {
  return Object.values(UPGRADES).filter((u) => u.tab === tab);
}

/** @param {import('./state.js').GameState} state @param {string} id */
export function levelOf(state, id) {
  const def = UPGRADES[id];
  const stored = state.upgrades[id];
  return stored != null ? stored : (def && def.startLevel) || 0;
}

/**
 * Gold cost to advance `id` from `level` to `level + 1`.
 * @param {string} id
 * @param {number} level
 */
export function upgradeCost(id, level) {
  const def = UPGRADES[id];
  if (!def) return Infinity;
  return Math.round(def.baseCost * Math.pow(def.growth, level) * upgradeCostRamp(level)); // PLAN-PHASE11: early levels cheap, late ones dear
}

/** @param {import('./state.js').GameState} state @param {string} id */
export function canBuy(state, id) {
  const def = UPGRADES[id];
  if (!def) return false;
  const level = levelOf(state, id);
  if (def.max != null && level >= def.max) return false;
  return state.gold >= upgradeCost(id, level);
}

/**
 * Spends gold and raises the level by one. Never lets gold go negative.
 * @param {import('./state.js').GameState} state
 * @param {string} id
 * @returns {number|false} the new level, or false if the purchase was refused
 */
export function buy(state, id) {
  const def = UPGRADES[id];
  if (!def) return false;
  const level = levelOf(state, id);
  if (def.max != null && level >= def.max) return false;
  const cost = upgradeCost(id, level);
  if (state.gold < cost) return false;
  state.gold -= cost;
  const next = level + 1;
  state.upgrades[id] = next;
  return next;
}

/**
 * Buys as many levels of `id` as the player can currently afford.
 * @param {import('./state.js').GameState} state
 * @param {string} id
 * @returns {{ levels: number, spent: number, level: number }}
 */
export function buyMax(state, id) {
  let levels = 0;
  let spent = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const def = UPGRADES[id];
    if (!def) break;
    const level = levelOf(state, id);
    if (def.max != null && level >= def.max) break;
    const cost = upgradeCost(id, level);
    if (state.gold < cost) break;
    state.gold -= cost;
    state.upgrades[id] = level + 1;
    levels += 1;
    spent += cost;
  }
  return { levels, spent, level: levelOf(state, id) };
}
