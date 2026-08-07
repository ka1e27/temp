// Turning a BattleOutcome into progress.
//
// ECONOMY MATH LIVES ONLY HERE. The battle engine reports facts — who held what,
// how long it took, what was consumed — and never computes a single crown.
// assertBattleOutcome actively rejects an outcome carrying a `rewards` field, so
// this is enforced at the seam rather than by agreement.
//
// A LOST BATTLE COSTS NOTHING. No crowns are deducted on a loss, ever; the only
// thing a defeat spends is the booster charges actually fired. That is what makes
// "retry with a different composition" the natural response to failing a region,
// which is the intended experience for every wall in the campaign.
//
// PURE: `now` is injected. No Date.now, no storage, no DOM.

import { assertBattleOutcome } from '../battle/contract.js';
import { REGION_BY_ID, FIRST_CLEAR_BONUS_SECONDS } from '../content/regions.data.js';
import { metaOf, markDirty } from '../core/store.js';
import {
  markConquered, completeRaid, refreshUnlocks, raidLump, record, isConquered,
} from './world.js';
import { recalcIncome } from './idle.js';
import { consume as consumeBoosters } from './boosters.js';
import { META_EVENTS, emit } from './events.js';

/** One-off bounty the first time a region falls: 2 minutes of its own income. */
export const firstClearBonus = (region) => region.rewardPerSec * FIRST_CLEAR_BONUS_SECONDS;

/**
 * @param {object} metaState  root state or the meta slice
 * @param {object} config     the BattleConfig this outcome answers
 * @param {object} outcome    BattleOutcome from battle/outcome.js
 * @param {{now?:number, bus?:object, state?:object}} [io]
 * @returns {object} summary for the results screen
 */
export function applyOutcome(metaState, config, outcome, { now = 0, bus, state } = {}) {
  const meta = metaOf(metaState);

  // Validate at the seam. Throws with a field path naming the module at fault,
  // including a configHash mismatch (i.e. "was the config mutated mid-battle?").
  assertBattleOutcome(outcome, config);

  const regionId = config.region?.id;
  const region = REGION_BY_ID[regionId];
  if (!region) throw new RangeError(`applyOutcome: unknown region "${regionId}"`);
  if (outcome.regionId != null && outcome.regionId !== regionId) {
    throw new TypeError(
      `applyOutcome: outcome.regionId "${outcome.regionId}" != config.region.id "${regionId}"`,
    );
  }

  const stats = meta.stats;
  const durationMs = Math.max(0, outcome.durationMs ?? 0);
  const won = outcome.result === 'win';
  const wasConquered = isConquered(meta, regionId);

  stats.battles += 1;
  if (won) stats.wins += 1;
  else if (outcome.result === 'loss' || outcome.result === 'timeout') stats.losses += 1;
  stats.unitsLost += Math.max(0, outcome.stats?.unitsLost ?? 0);
  stats.unitsKilled += Math.max(0, outcome.stats?.unitsKilled ?? 0);

  // Charges are deducted from what the battle says it actually FIRED, not from
  // what was carried in — withdrawing without using a booster keeps it.
  const boostersConsumed = consumeBoosters(meta, outcome.boostersConsumed, bus);

  const summary = {
    regionId,
    regionName: region.name,
    result: outcome.result,
    durationMs,
    won,
    conquered: false,
    raided: false,
    crowns: 0,
    incomeAdded: 0,
    incomePerSec: meta.incomePerSec,
    opened: [],
    boostersConsumed,
    newBest: false,
  };

  if (!won) {
    markDirty(state ?? metaState);
    emit(bus, META_EVENTS.OUTCOME_APPLIED, { outcome, summary });
    return summary;
  }

  const rec = record(meta, regionId);
  if (!wasConquered) {
    // ---- First conquest: PERMANENT income plus a one-off bounty. -----------
    markConquered(meta, regionId, { now, durationMs });
    summary.conquered = true;
    summary.newBest = true;
    summary.crowns = firstClearBonus(region);
    summary.incomeAdded = region.rewardPerSec;
    summary.opened = refreshUnlocks(meta, bus);
  } else {
    // ---- Raid: a ONE-TIME lump. Never permanent income, or one region could
    //      be farmed into an infinite economy. -------------------------------
    summary.raided = true;
    summary.crowns = raidLump(meta, regionId);
    summary.newBest = rec.bestMs === 0 || (durationMs > 0 && durationMs < rec.bestMs);
    completeRaid(meta, regionId, { now, durationMs });
    stats.raids += 1;
  }

  meta.crowns += summary.crowns;
  stats.crownsEarned += summary.crowns;
  summary.incomePerSec = recalcIncome(meta, bus);

  emit(bus, META_EVENTS.CROWNS_CHANGED, {
    crowns: meta.crowns, delta: summary.crowns, reason: summary.raided ? 'raid' : 'reward',
  });
  emit(bus, summary.raided ? META_EVENTS.RAID_COMPLETED : META_EVENTS.REGION_CONQUERED, {
    regionId, clears: rec.clears, crowns: summary.crowns,
    rewardPerSec: region.rewardPerSec, raidReadyAt: rec.raidReadyAt,
  });
  emit(bus, META_EVENTS.OUTCOME_APPLIED, { outcome, summary });
  markDirty(state ?? metaState);
  return summary;
}

/**
 * What a win here would be worth right now. The world map shows this on the
 * region card so the player can see whether a raid is worth the ten minutes.
 */
export function previewReward(metaState, regionId) {
  const meta = metaOf(metaState);
  const region = REGION_BY_ID[regionId];
  if (!region) return { crowns: 0, incomeAdded: 0, kind: 'none' };
  if (!isConquered(meta, regionId)) {
    return { crowns: firstClearBonus(region), incomeAdded: region.rewardPerSec, kind: 'conquest' };
  }
  return { crowns: raidLump(meta, regionId), incomeAdded: 0, kind: 'raid' };
}
