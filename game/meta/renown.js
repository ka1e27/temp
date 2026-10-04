// Renown spends (DESIGN §10.7, §10.12): Festival, Training, hiring a Mercenary, Muster, Heal and Respec, each with its cost, a
// refusal reason (`xRefusal` → null | reason key) and the action itself (returns the result or false). Earning lives in the
// ./renownState.js leaf (re-exported here). Pure: no DOM, no Date.now, no Math.random, no storage.
import { edictMods } from './edicts.js'; // the leaf (PLAN-PHASE5): Grand Festival
import { RENOWN } from '../config/renown.js';
import { GENERALS } from '../config/generals.js';
import { PROSPERITY } from '../config/prosperity.js';
import { PLAYER_FACTION } from './state.js';
import { renownPoints, spendRenown, ensureRenown } from './renownState.js';
import {
  generalById, levelUp, isWounded, clearSkills, addMercenary, mercenaryCount, recordGeneralLevels,
} from './generalsState.js';
import { deedBonuses, recordDeed } from './deeds.js';
import { militiaFill, refillMilitia } from './militia.js';
import { busyGeneralIds } from './generals.js';

export * from './renownState.js';

function reasonText(key, missing = 0) {
  const t = RENOWN.copy.reasons[key] || RENOWN.copy.reasons.unknown;
  return t.replace('{n}', String(Math.max(1, Math.ceil(missing))));
}

function storedLevel(state, regionId) {
  return Array.isArray(state.prosperity) && Number.isInteger(state.prosperity[regionId]) ? state.prosperity[regionId] : 0;
}

// --- Festival ------------------------------------------------------------------------------------------------------------------

/** Renown for a Festival in this region now: festivalPerLevel x the target level x (1 + festivalRise x festivals held), rounded up. */
export function festivalCost(state, regionId) {
  const target = storedLevel(state, regionId) + 1;
  const held = ensureRenown(state).festivals;
  const discount = 1 - deedBonuses(state).festivalDiscount; // the Patron deed
  return Math.ceil(RENOWN.cost.festivalPerLevel * target * (1 + RENOWN.cost.festivalRise * held) * discount * edictMods(state).festivalCostMult); // Grand Festival: half
}

/** Why a Festival cannot be held here now, or null: 'notOwned' | 'maxed' | 'renown'. */
export function festivalRefusal(state, world, regionId) {
  if (!world.regions[regionId] || state.owner[regionId] !== PLAYER_FACTION) return 'notOwned';
  if (storedLevel(state, regionId) >= PROSPERITY.maxLevel) return 'maxed';
  if (renownPoints(state) < festivalCost(state, regionId)) return 'renown';
  return null;
}

/**
 * A Festival (DESIGN §10.12): the region's prosperity rises one level now, and its tenure clock jumps to that level's threshold so
 * natural growth continues from there (a region already past it keeps its tenure). MUTATES Renown, `state.prosperity` and
 * `state.conqueredAt`. Returns `{ cost, level }` or false.
 */
export function festival(state, world, regionId, nowMs) {
  if (festivalRefusal(state, world, regionId) !== null) return false;
  const cost = festivalCost(state, regionId);
  const level = storedLevel(state, regionId) + 1;
  spendRenown(state, cost);
  ensureRenown(state).festivals += 1;
  if (!Array.isArray(state.prosperity)) state.prosperity = [];
  state.prosperity[regionId] = level;
  const threshold = PROSPERITY.thresholdsMs[level - 1];
  const at = state.conqueredAt ? state.conqueredAt[regionId] : null;
  if (state.conqueredAt && Number.isFinite(threshold)) {
    const back = threshold / edictMods(state).prosperityRateMult; // Grand Festival: tenure counts at half speed (prosperity.js)
    state.conqueredAt[regionId] = at == null || !Number.isFinite(at) ? nowMs - back : Math.min(at, nowMs - back);
  }
  recordDeed(state, 'prosperity', level); // the Patron deed
  return { cost, level }; // integration: bounties.onProsperity(state, world, [{ regionId, level, from: level - 1 }])
}

// --- Training, Heal, Respec --------------------------------------------------------------------------------------------------

export function trainCost(general) {
  return RENOWN.cost.trainPerLevel * general.level;
}

/** Why a General cannot be trained now, or null: 'unknown' | 'maxed' | 'renown'. */
export function trainRefusal(state, generalId) {
  const g = generalById(state, generalId);
  if (!g) return 'unknown';
  if (g.level >= GENERALS.maxLevel) return 'maxed';
  if (renownPoints(state) < trainCost(g)) return 'renown';
  return null;
}

/** Training (DESIGN §10.12): a level now, for 2 x the current level. MUTATES. Returns `{ cost, level }` or false. */
export function train(state, generalId) {
  if (trainRefusal(state, generalId) !== null) return false;
  const g = generalById(state, generalId);
  const cost = trainCost(g);
  spendRenown(state, cost);
  levelUp(g);
  recordGeneralLevels(state); // the Mentor deed
  return { cost, level: g.level };
}

/** Why a General cannot be healed now, or null: 'unknown' | 'notWounded' | 'renown'. */
export function healRefusal(state, generalId, nowMs) {
  const g = generalById(state, generalId);
  if (!g) return 'unknown';
  if (!isWounded(g, nowMs)) return 'notWounded';
  if (renownPoints(state) < RENOWN.cost.heal) return 'renown';
  return null;
}

/** Heal (DESIGN §10.12): a wounded General returns now. MUTATES. Returns `{ cost }` or false. */
export function heal(state, generalId, nowMs) {
  if (healRefusal(state, generalId, nowMs) !== null) return false;
  spendRenown(state, RENOWN.cost.heal);
  generalById(state, generalId).woundedUntil = null;
  return { cost: RENOWN.cost.heal };
}

/** Why a General cannot respec now, or null: 'unknown' | 'noSkills' | 'busy' | 'renown'. */
export function respecRefusal(state, generalId) {
  const g = generalById(state, generalId);
  if (!g) return 'unknown';
  if (g.skills.length === 0) return 'noSkills';
  if (busyGeneralIds(state).has(g.id)) return 'busy';
  if (renownPoints(state) < RENOWN.cost.respec) return 'renown';
  return null;
}

/** Respec (DESIGN §10.12): every skill pick is cleared, to be picked again. MUTATES. Returns `{ cost, picks }` or false. */
export function respec(state, generalId) {
  if (respecRefusal(state, generalId) !== null) return false;
  spendRenown(state, RENOWN.cost.respec);
  const g = generalById(state, generalId);
  clearSkills(g);
  return { cost: RENOWN.cost.respec, picks: GENERALS.skillLevels.filter((l) => g.level >= l).length };
}

// --- Mercenaries, Muster ------------------------------------------------------------------------------------------------------

/** Why a mercenary cannot be hired now, or null: 'full' | 'renown'. */
export function hireRefusal(state) {
  if (mercenaryCount(state) >= GENERALS.maxMercenaries) return 'full';
  if (renownPoints(state) < RENOWN.cost.mercenary) return 'renown';
  return null;
}

/** Hire a Mercenary (DESIGN §10.12): a seeded General with a smaller passive. MUTATES. Returns the General or false. */
export function hireMercenary(state) {
  if (hireRefusal(state) !== null) return false;
  spendRenown(state, RENOWN.cost.mercenary);
  return addMercenary(state);
}

/** Why a region's militia cannot be mustered now, or null: 'notOwned' | 'full_militia' | 'renown'. */
export function musterRefusal(state, world, regionId, nowMs) {
  if (!world.regions[regionId] || state.owner[regionId] !== PLAYER_FACTION) return 'notOwned';
  if (militiaFill(state, regionId, nowMs) >= 1) return 'full_militia';
  if (renownPoints(state) < RENOWN.cost.muster) return 'renown';
  return null;
}

/** Muster (DESIGN §10.12): the region's militia is full again now. MUTATES. Returns `{ cost }` or false. */
export function muster(state, world, regionId, nowMs) {
  if (musterRefusal(state, world, regionId, nowMs) !== null) return false;
  spendRenown(state, RENOWN.cost.muster);
  refillMilitia(state, regionId, nowMs);
  return { cost: RENOWN.cost.muster };
}

// --- Panel data -----------------------------------------------------------------------------------------------------------------

/**
 * Every spend the UI offers, priced and checked: the owned card's Festival and Muster for `regionId` (when given), and per General
 * Train / Heal / Respec, plus Hire. Each entry `{ kind, cost, can, reason }` (reason: the words to show when it cannot).
 */
export function renownSpends(state, world, regionId, nowMs) {
  const points = renownPoints(state);
  const entry = (kind, cost, refusal, extra = {}) => ({
    kind, name: RENOWN.copy.names[kind], cost, can: refusal === null,
    reason: refusal ? reasonText(refusal, cost - points) : null, ...extra,
  });
  const out = { renown: points, region: null, generals: [], hire: entry('hire', RENOWN.cost.mercenary, hireRefusal(state)) };
  if (regionId != null && world.regions[regionId]) {
    out.region = {
      festival: entry('festival', festivalCost(state, regionId), festivalRefusal(state, world, regionId), { toLevel: storedLevel(state, regionId) + 1 }),
      muster: entry('muster', RENOWN.cost.muster, musterRefusal(state, world, regionId, nowMs)),
    };
  }
  for (const g of (state.generals && state.generals.roster) || []) {
    out.generals.push({
      id: g.id,
      train: entry('train', trainCost(g), trainRefusal(state, g.id)),
      heal: entry('heal', RENOWN.cost.heal, healRefusal(state, g.id, nowMs)),
      respec: entry('respec', RENOWN.cost.respec, respecRefusal(state, g.id)),
    });
  }
  return out;
}
