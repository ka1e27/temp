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
import {
  REGION_BY_ID, FIRST_CLEAR_BONUS_SECONDS, RAID, HELD_FIELD,
} from '../content/regions.data.js';
import { metaOf, markDirty } from '../core/store.js';
import {
  markConquered, completeRaid, refreshUnlocks, effectiveEnemyMult, record, isConquered, regionsConquered } from './world.js';
import { recalcIncome, incomePerSec } from './idle.js';
import { consume as consumeBoosters } from './boosters.js';
import { planFor, completeIncursion, INCURSION } from './incursion.js';
import { META_EVENTS, emit } from './events.js';

/** One-off bounty the first time a region falls: 2 minutes of its own income. */
export const firstClearBonus = (region) => region.rewardPerSec * FIRST_CLEAR_BONUS_SECONDS;

/**
 * RELICS, the currency that is not paid for time.
 *
 * Two sources and no third, and the omission is the design: a RAID pays none.
 * `raidLump` exists because re-clearing ground you already hold has to be worth
 * something and must not be worth farming; a relic is the thing that must not be
 * farmable at all, so re-clearing pays it zero rather than a little. The whole
 * argument for `raidLump` not granting permanent income applies here with no
 * softening.
 *
 * A region's first fall pays its TIER, so the campaign yields 78 across all
 * twenty-four and is front-loaded with almost nothing — the early rows pay one
 * each, which is what keeps a first-run player from levelling a troop line
 * before the balance table has met them. The ladder pays with depth and has no
 * end, which is what makes relics a real economy afterwards rather than a
 * seventy-eight-item allowance.
 */
export const conquestRelics = (region) => Math.max(1, Math.floor(region?.tier ?? 1));
/** A rung pays 1, and one more for every five rungs deep. */
export const incursionRelics = (depth) => 1 + Math.floor(Math.max(1, depth) / 5);

/** Pay relics and account for them. The ONLY writer, so "relics never tick" is
 *  a property of this file rather than a convention. */
function grantRelics(meta, amount, reason, bus) {
  const n = Math.max(0, Math.floor(amount));
  if (!n) return 0;
  meta.relics = Math.max(0, Math.floor(meta.relics ?? 0)) + n;
  meta.stats.relicsEarned = (meta.stats.relicsEarned ?? 0) + n;
  emit(bus, META_EVENTS.RELICS_CHANGED, {
    crowns: meta.crowns, relics: meta.relics, delta: n, reason,
  });
  return n;
}

/**
 * What a raid on `regionId` pays right now, in crowns. The relationship it
 * implements — and the two faults it replaces — are stated in full on the RAID
 * block in content/regions.data.js:
 *
 *     lump = EMPIRE income/sec x RAID.lumpSeconds x effectiveEnemyMult
 *
 * `incomePerSec` and NOT `baseIncomePerSec`, deliberately: Tithe and Royal Mint
 * multiply idle income by up to 3.19x between them, so anchoring the lump to
 * the un-upgraded base would let the shop quietly re-open the exact hole this
 * closes. Multiplying by the difficulty the player actually faces is what makes
 * reward-per-difficulty constant across clears rather than merely intended to
 * be — there is no second per-clear dial that can fall behind the first.
 *
 * The `max` is a floor for a state that cannot legitimately occur (a `clears`
 * record without the conquest that produced it, i.e. a hand-edited save), and
 * it guarantees a raid never pays LESS than the region's own ten minutes.
 */
export function raidLump(metaState, regionId) {
  const meta = metaOf(metaState);
  const region = REGION_BY_ID[regionId];
  if (!region) return 0;
  const rate = Math.max(incomePerSec(meta), region.rewardPerSec);
  return rate * RAID.lumpSeconds * effectiveEnemyMult(meta, regionId);
}

/**
 * What one rung of the endless ladder pays, in crowns.
 *
 * DELIBERATELY THE SAME SHAPE AS `raidLump`, because the property that shape buys
 * is the one an endless ladder needs most:
 *
 *     lump = EMPIRE income/sec x INCURSION.lumpSeconds x difficulty(depth)
 *
 * `difficulty` (meta/incursion.js `planFor`) is the rung's dial times a premium
 * per mutator, so reward-per-difficulty is CONSTANT BY CONSTRUCTION at every
 * depth — there is no second per-depth dial that can fall behind the first, which
 * is the exact decay the raid economy shipped with and had to have removed.
 *
 * `lumpSeconds` is half a raid's, and that is the honest price of having no
 * cooldown: a raid is paid once per ten minutes of waiting and a rung is paid per
 * battle. What makes depth worth pushing is the dial, not the base.
 */
export function incursionLump(metaState, depth) {
  const meta = metaOf(metaState);
  const plan = planFor(depth);
  return incomePerSec(meta) * INCURSION.lumpSeconds * plan.difficulty;
}

/**
 * What a timeout the player LED on territory is worth.
 *
 * Priced off whatever taking this ground would have paid — a first conquest's
 * bounty, a raid's lump, or a rung's — so it needs no fourth price table and
 * cannot drift out of step with the three that exist. Returns 0 for a loss, a
 * draw, an enemy-led timeout, or a lead too thin to be worth announcing.
 *
 * SHARE IS SITES, NOT INFLUENCE, and the two are deliberately different
 * questions. `sim.js endPhase` decides WHO LED on influence plus site count —
 * that verdict crosses the seam as `outcome.timeoutWinner` and is not
 * re-derived here. This asks HOW MUCH was held, which is the only number the
 * outcome carries and the one a player can check against the SITES tally they
 * watched all battle.
 */
export function heldFieldPay(base, outcome) {
  if (outcome?.result !== 'timeout') return 0;
  if (outcome.timeoutWinner !== 'player') return 0;
  const total = outcome.stats?.sitesTotal ?? 0;
  if (!(total > 0)) return 0;
  const share = (outcome.stats?.sitesHeld ?? 0) / total;
  if (share < HELD_FIELD.minShare) return 0;
  return Math.max(0, base) * HELD_FIELD.frac * share;
}

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
  // Which rung of the endless ladder this was, straight off the config the
  // battle actually ran (contract v6) rather than off meta — a screen that
  // launched depth 9 and a `cleared` that has since moved on cannot disagree.
  const inc = config.rules?.incursion ?? null;
  const depth = inc ? Math.max(1, Math.floor(inc.depth)) : 0;

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
    /** Relics paid. Nonzero only on a first conquest or a cleared rung — a raid
     *  pays none, deliberately (see `conquestRelics`). */
    relics: 0,
    incomeAdded: 0,
    incomePerSec: meta.incomePerSec,
    opened: [],
    boostersConsumed,
    newBest: false,
    /** `{depth, cleared, mutators}` when this was a rung, else null. */
    incursion: null,
    /** The FIRST region this empire has ever taken. The results screen says the
     *  quiet part out loud on exactly this one — that the region now pays while
     *  you are not playing — because nothing else in the game ever states it. */
    firstConquest: false,
    /** A timeout the player LED on territory, paid a share of what taking the
     *  ground would have been worth. Never true on a win — see `heldFieldPay`. */
    heldField: false,
  };

  if (!won) {
    // A LOST RUNG STILL COUNTS AS AN ATTEMPT AND COSTS NOTHING ELSE. The attempt
    // count is the one thing a defeat moves anywhere in this file, and it exists
    // so "depth 14, eleven tries" can be shown; `cleared` is untouched, so the
    // same rung is waiting, unchanged, when the player comes back with a
    // different army.
    if (depth) completeIncursion(meta, depth, { won: false });

    // ...AND A BATTLE YOU LED BUT DID NOT FINISH IS NOT NOTHING — see
    // content/payout.data.js `HELD_FIELD`. 93% of every non-win in this game is
    // a timeout and 63% of those end AHEAD, so "you held most of the map for
    // twenty minutes, here is nothing" was the game's DOMINANT failure message.
    //
    // Priced off whatever taking this ground would have paid, so a rung, a raid
    // and a first conquest each grade against their own number. It stays a
    // TIMEOUT throughout: nothing is conquered, `clears` does not move, the
    // rung's `cleared` does not move and no relics are paid — which is what
    // keeps it out of the balance table, since every measured win rate is
    // `status === 'win'`.
    const base = depth ? incursionLump(meta, depth)
      : wasConquered ? raidLump(meta, regionId) : firstClearBonus(region);
    summary.crowns = heldFieldPay(base, outcome);
    summary.heldField = summary.crowns > 0;
    if (summary.crowns > 0) {
      meta.crowns += summary.crowns;
      stats.crownsEarned += summary.crowns;
      emit(bus, META_EVENTS.CROWNS_CHANGED, {
        crowns: meta.crowns, delta: summary.crowns, reason: 'held-field',
      });
    }
    markDirty(state ?? metaState);
    emit(bus, META_EVENTS.OUTCOME_APPLIED, { outcome, summary });
    return summary;
  }

  const rec = record(meta, regionId);
  // ---- An incursion is NOT a raid on the same ground, and this branch is what
  //      keeps the two ladders from paying each other. A rung must not touch the
  //      region record at all: `clears` is the raid ladder's difficulty AND its
  //      price (world.js `effectiveEnemyMult`), so advancing it here would make
  //      every future raid on that region harder because of a fight that was
  //      never a raid. Depth is the incursion's own counter and the only thing
  //      that moves. -----------------------------------------------------------
  if (depth) {
    summary.incursion = { depth, cleared: depth, mutators: [...(inc.mutators ?? [])] };
    summary.crowns = incursionLump(meta, depth);
    summary.relics = grantRelics(meta, incursionRelics(depth), 'incursion', bus);
    completeIncursion(meta, depth, { won: true });
    stats.incursions = (stats.incursions ?? 0) + 1;
    meta.crowns += summary.crowns;
    stats.crownsEarned += summary.crowns;
    summary.incomePerSec = recalcIncome(meta, bus);
    emit(bus, META_EVENTS.CROWNS_CHANGED, {
      crowns: meta.crowns, delta: summary.crowns, reason: 'incursion',
    });
    emit(bus, META_EVENTS.INCURSION_CLEARED, {
      depth, crowns: summary.crowns, mutators: summary.incursion.mutators,
    });
    emit(bus, META_EVENTS.OUTCOME_APPLIED, { outcome, summary });
    markDirty(state ?? metaState);
    return summary;
  }

  if (!wasConquered) {
    // ---- First conquest: PERMANENT income plus a one-off bounty. -----------
    markConquered(meta, regionId, { now, durationMs });
    summary.conquered = true;
    summary.newBest = true;
    summary.firstConquest = regionsConquered(meta) === 1;
    summary.crowns = firstClearBonus(region);
    summary.relics = grantRelics(meta, conquestRelics(region), 'conquest', bus);
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
export function previewReward(metaState, regionId, depth = 0) {
  const meta = metaOf(metaState);
  const region = REGION_BY_ID[regionId];
  if (!region) return { crowns: 0, incomeAdded: 0, kind: 'none' };
  // A rung is worth what its DEPTH says, not what the ground under it is worth,
  // so the incursion case has to be asked about before the region's own status.
  if (depth > 0) {
    return { crowns: incursionLump(meta, depth), incomeAdded: 0, kind: 'incursion' };
  }
  if (!isConquered(meta, regionId)) {
    return { crowns: firstClearBonus(region), incomeAdded: region.rewardPerSec, kind: 'conquest' };
  }
  return { crowns: raidLump(meta, regionId), incomeAdded: 0, kind: 'raid' };
}
