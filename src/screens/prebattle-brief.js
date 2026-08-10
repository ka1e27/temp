// The pre-battle screen's decisions, with no DOM and no clock: labels, the
// region briefing, and the loadout the screen opens with.
//
// Split out of prebattle.js when the slot budget landed — the screen was at 398
// lines against a 400 cap, and these are the parts worth testing directly.

import { compact, rate, duration } from '../ui/format.js';
import { UNIT_IDS, LOADOUT_TYPES_MAX } from '../content/balance.js';
import { UNITS_UI } from '../content/strings.js';
import {
  expeditionSlots, carryComposition, distributeExpedition,
  compositionSlots, compositionTotal, overBudget, slotCost, typeCount,
} from '../meta/modifiers.js';
import { unlockedUnits } from '../meta/upgrades.js';
import { regionById, effectiveEnemyMult, isConquered } from '../meta/world.js';
import { previewReward } from '../meta/rewards.js';

export { compositionSlots, compositionTotal, overBudget, slotCost, typeCount };

/** Derived from content/strings.js rather than listed, so the loadout screen
 *  and the unit tooltip can never disagree about what a troop is called — and a
 *  new unit cannot ship with a blank label. */
export const UNIT_LABEL = Object.freeze(
  Object.fromEntries(UNIT_IDS.map((u) => [u, UNITS_UI[u].name])),
);

/** Label + what the booster actually does. Shared with the shop. */
export const BOOSTER_LABEL = Object.freeze({
  rally: 'Rally', march: 'Forced March', bombard: 'Bombardment',
  fortify: 'Emergency Fortify', tithe: 'War Tithe',
});

export const BOOSTER_NOTE = Object.freeze({
  rally: 'Every site within 2 hops sends half its garrison, arriving together.',
  march: 'Halves squad travel time for a short window.',
  bombard: 'Kills a quarter of a garrison and 60 structure HP. Never captures.',
  fortify: 'One site: double regen, half incoming damage, for 20s.',
  tithe: 'Instant battle gold plus 15s of faster training.',
});

/** Slots the empire grants this expedition. The screen's whole budget. */
export const loadoutBudget = (meta) => expeditionSlots(meta);

/**
 * The army the screen opens with.
 *
 * CARRIED, not re-fitted: the player's last picks come back as themselves and a
 * budget that grew arrives as militia. Re-fitting here would quietly re-spend
 * the decision — swapping raiders back out because the ratios moved — which is
 * exactly what "carry over my troop selections" asks us not to do.
 * With nothing to carry it falls back to the default spread, never a blank form.
 */
export function initialComposition(meta, composition) {
  return carryComposition(loadoutBudget(meta), unlockedUnits(meta), composition ?? null);
}

/** "Reset to default" — throw the carried picks away and re-spend by weight. */
export function defaultComposition(meta) {
  return distributeExpedition(loadoutBudget(meta), unlockedUnits(meta));
}

/** Everything the budget line renders, in one place so the test can read it. */
export function budgetSummary(chosen, budget) {
  const spent = compositionSlots(chosen);
  const types = typeCount(chosen);
  return {
    spent,
    budget,
    free: budget - spent,
    troops: compositionTotal(chosen),
    over: overBudget(chosen, budget),
    // The second budget on this screen. Slots say how big the army is; types say
    // how many different answers it carries, and the cap is what stops "a bit of
    // everything" — which is both the dullest loadout and, because the
    // specialists are share-scaled, the weakest.
    types,
    typesMax: LOADOUT_TYPES_MAX,
    typesFull: types >= LOADOUT_TYPES_MAX,
  };
}

export function describeComposition(comp, unlocked) {
  return unlocked
    .filter((u) => (comp?.[u] ?? 0) > 0)
    .map((u) => `${comp[u]} ${UNIT_LABEL[u]}`)
    .join(', ') || 'empty';
}

/**
 * Everything the briefing panel shows, with no DOM and no clock. Difficulty,
 * map size, target length and reward all come off the region record.
 */
export function regionBrief(meta, regionId) {
  const region = regionById(regionId);
  if (!region) return null;
  const raid = isConquered(meta, regionId);
  const reward = previewReward(meta, regionId);
  const mult = effectiveEnemyMult(meta, regionId);
  return {
    id: region.id, name: region.name, tier: region.tier, flavour: region.flavour,
    raid, reward, enemyMult: mult,
    rows: [
      ['Difficulty', `x${mult.toFixed(2)}`],
      ['Battlefield', `${region.grid.cols} x ${region.grid.rows}`],
      ['Enemy sites', `${region.siteCounts.enemy}`],
      ['Typical length', `~${region.targetLengthMin} min`],
      ['Hard cap', duration(region.hardCapMs / 1000)],
      [raid ? 'Raid pays' : 'Conquest pays', raid
        ? `${compact(reward.crowns)} crowns, once`
        : `${compact(reward.crowns)} crowns and ${rate(reward.incomeAdded)} forever`],
    ],
  };
}
