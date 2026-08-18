// The pre-battle screen's decisions, with no DOM and no clock: labels, the
// region briefing, and the loadout the screen opens with.
//
// Split out of prebattle.js when the slot budget landed — the screen was at 398
// lines against a 400 cap, and these are the parts worth testing directly.

import { compact, rate, duration, percent } from '../ui/format.js';
import { UNIT_IDS, LOADOUT_TYPES_MAX } from '../content/balance.js';
import { UNITS_UI, ENDGAME } from '../content/strings.js';
import { RAID, GATE_CLAMP } from '../content/regions.data.js';
import {
  expeditionSlots, carryComposition, distributeExpedition,
  compositionSlots, compositionTotal, overBudget, slotCost, typeCount,
} from '../meta/modifiers.js';
import { unlockedUnits } from '../meta/upgrades.js';
import { regionById, effectiveEnemyMult, isConquered, record } from '../meta/world.js';
import { planFor, MUTATOR_BY_ID, campaignReplayPlan, incursionRules } from '../meta/incursion.js';
import { legacyResets } from '../meta/legacy.js';
import { previewReward } from '../meta/rewards.js';
import { specialistCallouts } from '../meta/specialists.js';

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
export function regionBrief(meta, regionId, depth = null) {
  const region = regionById(regionId);
  if (!region) return null;
  const raid = isConquered(meta, regionId);
  const reward = previewReward(meta, regionId, depth ?? 0);
  // A RUNG'S DIFFICULTY IS THE RUNG'S, NOT THE GROUND'S. `effectiveEnemyMult` is
  // the raid ladder's dial for this region and has nothing to do with the depth,
  // so showing it on an incursion would advertise a fight the player is not about
  // to have — off by a factor that grows with every rung.
  const plan = depth ? planFor(depth) : null;
  const mult = plan ? plan.enemyMult : effectiveEnemyMult(meta, regionId);
  // HARDERPERCLEAR, SURFACED. `mult` above already folds it into the one
  // figure a fresh attack and a tenth raid show identically — see
  // content/regions.rules.js `RAID.harderPerClear`. Broken out here so a
  // player who has been raiding a region can see how much of that number they
  // chose by clearing it again, rather than watching one figure creep with no
  // label on the reason. Never shown on an incursion, which has its own dial
  // and no relationship to this region's `clears`.
  const clears = record(meta, regionId).clears;
  const raidEscalation = !plan && raid && clears > 0
    ? (1 + RAID.harderPerClear) ** clears : null;
  // ABDICATION'S SECOND HALF — see meta/incursion.js `campaignReplayPlan`. A
  // replayed run's own hand, resolved here for the same reason an incursion's
  // is: it must be visible before the loadout is chosen, never discovered
  // mid-battle. Null on a first run (`legacyResets` 0) and whenever this is an
  // incursion instead, which carries its own hand under `incursion.mutators`.
  const replay = plan ? null : campaignReplayPlan(region, legacyResets(meta));
  // THE GATE THE BATTLE WILL ACTUALLY RUN UNDER, not the region's own — an
  // incursion's `sealed` mutator raises it, and quoting the campaign figure at
  // a rung fought under a different one is the same defect as quoting
  // `effectiveEnemyMult` at a rung, which the comment above already fixes.
  // `incursionRules` is asked rather than re-derived, so there is one owner of
  // the ceiling arithmetic.
  const gateFrac = plan
    ? (incursionRules({ castleGateFrac: region.castleGateFrac ?? 0 }, plan).castleGateFrac ?? 0)
    : GATE_CLAMP(region.castleGateFrac ?? 0);
  return {
    id: region.id, name: region.name, tier: region.tier, flavour: region.flavour,
    raid, reward, enemyMult: mult,
    incursion: plan ? {
      depth: plan.depth,
      label: ENDGAME.incursionDepth(plan.depth),
      mutators: plan.mutators.map((id) => ({
        id, name: MUTATOR_BY_ID[id].name, note: MUTATOR_BY_ID[id].note,
      })),
    } : null,
    replayMutators: (replay?.mutators ?? []).map((id) => ({
      id, name: MUTATOR_BY_ID[id].name, note: MUTATOR_BY_ID[id].note,
    })),
    // A pure derivation off the same region row, so a balance pass moving
    // `develop` or `siteCounts.enemyMix` never needs a second table of hints
    // kept in step by hand. See meta/specialists.js for the two rules and why
    // archers are never among them.
    callouts: specialistCallouts(meta, region),
    rows: [
      ['Difficulty', `x${mult.toFixed(2)}`],
      ...(raidEscalation ? [['Raid escalation', `x${raidEscalation.toFixed(2)} from `
        + `${clears} clear${clears === 1 ? '' : 's'}`]] : []),
      ['Battlefield', `${region.grid.cols} x ${region.grid.rows}`],
      ['Enemy sites', `${region.siteCounts.enemy}`],
      ['Typical length', `~${region.targetLengthMin} min`],
      ['Hard cap', duration(region.hardCapMs / 1000)],
      // THE NUMBER THAT DECIDES SEVERAL OF THESE BATTLES, AND IT WAS NEVER SHOWN.
      // `castleGateFrac` is the share of the countryside the throne holds out
      // for, and until now it appeared nowhere before the fight and, in the
      // fight, only inside the castle's own panel and only once the throne was
      // already under siege (`castleSealed` requires an active siege). So a
      // player correctly taking the countryside for twenty minutes had no way to
      // know whether they were two points short of the gate or forty-seven.
      // Measured: every one of thirty-seven timeouts in the castle-gate pass sat
      // below the gate. It leaks nothing — it is a static rule of the region,
      // like its size — and it is omitted rather than shown as 0%% where there is
      // no gate, because "0%%" reads as a requirement rather than as its absence.
      ...(gateFrac > 0 ? [['Throne holds until', `you hold ${percent(gateFrac)} of the map`]] : []),

      [plan ? 'Clearing pays' : raid ? 'Raid pays' : 'Conquest pays', plan || raid
        ? `${compact(reward.crowns)} crowns, once`
        : `${compact(reward.crowns)} crowns and ${rate(reward.incomeAdded)} forever`],
    ],
  };
}
