// ABDICATION — the prestige loop: what a finished run pays, what a point does,
// and the reset itself.
//
// `meta.legacy` has existed in core/store.js since long before this file, unread,
// with the comment "reserved so prestige can land later with no migration". It
// did: nothing about the persisted shape changed to ship this.
//
// PURE: `now` is injected, no storage, no DOM, no randomness. The reset is a
// plain rewrite of the meta slice — the caller owns telling the world about it
// (screens/mainmenu-settings.js also drops any mid-battle resume blob, which is
// storage and therefore not this file's business).
//
// WHY THE EFFECTS LIVE HERE AND ARE FOLDED INTO `upgradeEffects`: a legacy point
// has to reach idle income, offline caps and both battle multipliers, and all
// four of those already read the shop's four buckets. Anything else would be a
// second stacking order — the one thing meta/modifiers.js exists to prevent. So
// meta/upgrades.js calls `legacyEffects` as the last step of its own aggregation
// and every consumer gets legacy for free, in the right order, forever.
//
// THIS FILE MUST NOT IMPORT ./idle.js. idle -> modifiers -> upgrades -> legacy is
// a real chain, so an import back to idle would close a cycle. It does not need
// one: after a reset nothing is conquered, so income is exactly 0 by
// construction rather than by recomputation.

import { LEGACY } from '../content/legacy.data.js';
import { createRegionTable, createStats, metaOf } from '../core/store.js';
import { campaignComplete, incursionRecord } from './incursion.js';
import { META_EVENTS, emit } from './events.js';

export { LEGACY, campaignComplete };

/** Points held. Absent or corrupt reads as 0. */
export const legacyPoints = (metaState) => Math.max(0, Math.floor(
  Number(metaOf(metaState)?.legacy?.points) || 0,
));

/** Runs ended. */
export const legacyResets = (metaState) => Math.max(0, Math.floor(
  Number(metaOf(metaState)?.legacy?.resets) || 0,
));

/**
 * IS THE ENDGAME OPEN? The one predicate both endgame systems are gated on — the
 * incursion ladder's entry point and the shop's post-campaign lines.
 *
 * "Finished the campaign at least once", and the second half is what makes it
 * usable: a player who abdicates would otherwise lose access to the ladder they
 * are half way up and to the shop lines they were saving for, on the run where
 * they need them most. Anything a reset takes away is a reason not to press the
 * button, and a prestige nobody presses is not a mechanic.
 *
 * It is also the reason no measured balance number can move because of any of
 * this: the harness plays region N with N-1 conquests and zero resets, so this is
 * FALSE for every battle in content/regions.data.js. tests/legacy.test.js pins
 * that as a negative control.
 */
export function endgameOpen(metaState) {
  const meta = metaOf(metaState);
  if (!meta) return false;
  return legacyResets(meta) > 0 || campaignComplete(meta);
}

/**
 * What abdicating right now would pay. See content/legacy.data.js for the shape;
 * this is the only implementation of it.
 */
export function abdicationValue(metaState) {
  const meta = metaOf(metaState);
  const regions = Object.values(meta.regions ?? {})
    .filter((r) => r?.status === 'conquered').length;
  const rungs = incursionRecord(meta).cleared;
  const fromRegions = LEGACY.perRegion * regions;
  const fromDepth = Math.floor(rungs / Math.max(1, LEGACY.rungsPerPoint));
  return { points: fromRegions + fromDepth, regions, rungs, fromRegions, fromDepth };
}

/** Can the player end this run? Only from a finished campaign — see rule 1. */
export const canAbdicate = (metaState) => campaignComplete(metaState);

/**
 * Fold legacy into the shop's four buckets. Called by meta/upgrades.js
 * `upgradeEffects` as its last step, and a NO-OP at zero points — which is what
 * makes "the harness measures a player with no legacy" true by construction
 * rather than by hoping the numbers happen to match.
 *
 * @param {object} metaState
 * @param {{add:object, mult:object, flat:object}} fx  the shop's aggregation
 */
export function legacyEffects(metaState, fx) {
  const points = legacyPoints(metaState);
  if (points <= 0) return fx;
  const g = LEGACY.grant;
  // ADDITIVE, not multiplicative, and the same bucket the shop's own percentage
  // upgrades use: two sources of "+x% attack" that stack differently would be
  // exactly the drift meta/modifiers.js STACKING_ORDER exists to forbid.
  fx.add.income = (fx.add.income ?? 0) + g.income * points;
  fx.add.atk = (fx.add.atk ?? 0) + g.atk * points;
  fx.add.def = (fx.add.def ?? 0) + g.def * points;
  fx.flat.expedition = (fx.flat.expedition ?? 0) + g.expedition * points;
  return fx;
}

/**
 * END THE RUN. Everything the empire owns goes; everything the PLAYER has done
 * stays.
 *
 * Gone: crowns, the whole upgrade ladder, booster stock, the carried loadout, and
 * every region back to its starting status.
 * Kept: legacy (plus this run's payout), lifetime stats, preferences, the
 * incursion ladder, and the fact that the tutorial has been seen — a player on
 * their second empire does not need to be taught to drag a squad.
 *
 * Refuses and returns `{ok:false}` unless the campaign is finished, so a stale
 * screen or a hand-called API cannot cash out a half-run.
 *
 * @returns {{ok:boolean, reason:string, points:number, total:number, resets:number}}
 */
export function abdicate(metaState, { bus } = {}) {
  const meta = metaOf(metaState);
  if (!canAbdicate(meta)) {
    return {
      ok: false, reason: 'campaign-incomplete', points: 0,
      total: legacyPoints(meta), resets: legacyResets(meta),
    };
  }
  const { points } = abdicationValue(meta);
  const kept = {
    legacy: { points: legacyPoints(meta) + points, resets: legacyResets(meta) + 1 },
    incursion: { ...incursionRecord(meta) },
    stats: { ...createStats(), ...(meta.stats ?? {}) },
    settings: meta.settings,
    tutorialSeen: meta.tutorialSeen,
  };

  meta.crowns = 0;
  // Exactly 0 rather than a recalculation: `baseIncomePerSec` sums the regions
  // that are conquered, and after the line below none are. See the note at the
  // top of this file for why this cannot just call recalcIncome.
  meta.incomePerSec = 0;
  meta.upgrades = {};
  meta.boosters = {};
  meta.loadout = null;
  meta.regions = createRegionTable();
  meta.legacy = kept.legacy;
  meta.incursion = kept.incursion;
  meta.stats = kept.stats;
  meta.settings = kept.settings;
  meta.tutorialSeen = kept.tutorialSeen;

  const result = {
    ok: true, reason: 'ok', points,
    total: kept.legacy.points, resets: kept.legacy.resets,
  };
  emit(bus, META_EVENTS.ABDICATED, result);
  return result;
}

/** Everything a screen needs to describe the decision, with no DOM. */
export function legacyView(metaState) {
  const meta = metaOf(metaState);
  const value = abdicationValue(meta);
  const points = legacyPoints(meta);
  const g = LEGACY.grant;
  return {
    points,
    resets: legacyResets(meta),
    canAbdicate: canAbdicate(meta),
    endgameOpen: endgameOpen(meta),
    payout: value,
    /** What is currently held is worth this much, as readable percentages. */
    bonus: {
      income: g.income * points,
      atk: g.atk * points,
      def: g.def * points,
      expedition: g.expedition * points,
    },
    /** ...and what one more point would add, which is the number a player is
     *  actually deciding about when they choose to push another rung first. */
    perPoint: { ...g },
  };
}
