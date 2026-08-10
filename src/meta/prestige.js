// THE RESET ITSELF — abdication's destructive half.
//
// Split from ./legacy.js for one hard reason: it has to call `recalcIncome`, and
// `meta.incomePerSec` has exactly one writer in this codebase (meta/idle.js).
// legacy.js cannot import idle.js — `idle -> modifiers -> upgrades -> legacy` is a
// real chain and the import back would close a cycle — so the file that performs
// the reset is the file that is allowed to depend on both. legacy.js keeps the
// arithmetic (what a run is worth, what a point does); this keeps the act.
//
// PURE: no clock, no storage, no DOM. Dropping the mid-battle resume blob is the
// caller's job (screens/mainmenu-legacy.js), because that is storage.

import { LEGACY } from '../content/legacy.data.js';
import { REGIONS } from '../content/regions.data.js';
import { createRegionTable, createStats, metaOf } from '../core/store.js';
import { markConquered, refreshUnlocks } from './world.js';
import { recalcIncome } from './idle.js';
import {
  abdicationValue, canAbdicate, legacyPoints, legacyResets,
} from './legacy.js';
import { incursionRecord } from './incursion.js';
import { META_EVENTS, emit } from './events.js';

/**
 * HOW MUCH OF THE CAMPAIGN A SECOND RUN SKIPS.
 *
 * This exists because of a measurement, and it is the more interesting half of
 * abdication. A prestige bonus big enough to be worth pressing the button for
 * makes the replayed campaign a formality — measured at 27 points (a first
 * payout), n=32:
 *
 *     riverfen gallowmoor thanescar nightharrow widowsgate
 *        97%      100%       97%        94%        81%
 *
 * and that is not a tuning failure, it is what a permanent multiplier MEANS at the
 * tail of a curve this steep. The grants were already cut twice (a flat +3
 * expedition slots a point became a percentage, then everything halved) and the
 * numbers barely moved, because +2 shop levels and +16% army compound.
 *
 * So the fix is not to make the replay harder — it is to make it SHORTER. Twenty
 * four unloseable battles is a chore; nine is a run. The head start hands back the
 * regions a second run has nothing left to learn from, and the cap is what keeps
 * the part that is still a fight in front of the player: `headStartMax` is 15, so
 * tiers 5 and 6 are earned on every single run, forever.
 *
 * WHAT THAT ADDS UP TO, measured:
 *
 *     run 1   24 regions, the tuned campaign, 89% down to 21%
 *     run 2   opens on 8 (first fight emberholt), so 16 regions at 81-100%
 *     run 3+  opens on 15 (first fight blackspire), so 9 regions at 81-100%
 *
 * A replay is therefore fast (2-5 minutes a region against 7-16 on the first run)
 * and nearly safe, with the last region the only one that can still take it off
 * you. THAT IS THE INTENT, stated plainly rather than tuned around: the point of a
 * second run is to bank the next payout and get back to the incursion ladder,
 * which is where a permanent multiplier actually buys difficulty — a rung's dial
 * keeps compounding, and a region's does not.
 */
export const headStartFor = (resets) => Math.min(
  LEGACY.headStartMax,
  Math.max(0, Math.floor(LEGACY.headStartPerReset * Math.max(0, resets))),
);

/**
 * END THE RUN. Everything the empire owns goes; everything the PLAYER has done
 * stays; and the next run starts partway along the road it has already walked.
 *
 * Gone: crowns, the whole upgrade ladder, booster stock, the carried loadout.
 * Kept: legacy (plus this run's payout), lifetime stats, preferences, the
 * incursion ladder, and the fact that the tutorial has been seen — a player on
 * their second empire does not need to be taught to drag a squad.
 * Handed back: the first `headStartFor(resets)` regions, already conquered.
 *
 * Refuses and returns `{ok:false}` unless the campaign is finished, so a stale
 * screen or a hand-called API cannot cash out a half-run.
 *
 * @returns {{ok:boolean, reason:string, points:number, total:number,
 *   resets:number, headStart:number}}
 */
export function abdicate(metaState, { bus, now = 0 } = {}) {
  const meta = metaOf(metaState);
  if (!canAbdicate(meta)) {
    return {
      ok: false, reason: 'campaign-incomplete', points: 0, headStart: 0,
      total: legacyPoints(meta), resets: legacyResets(meta),
    };
  }
  const { points } = abdicationValue(meta);
  const legacy = { points: legacyPoints(meta) + points, resets: legacyResets(meta) + 1 };
  const kept = {
    incursion: { ...incursionRecord(meta) },
    stats: { ...createStats(), ...(meta.stats ?? {}) },
    settings: meta.settings,
    tutorialSeen: meta.tutorialSeen,
  };

  meta.crowns = 0;
  meta.upgrades = {};
  meta.boosters = {};
  meta.loadout = null;
  meta.regions = createRegionTable();
  meta.legacy = legacy;
  meta.incursion = kept.incursion;
  meta.stats = kept.stats;
  meta.settings = kept.settings;
  meta.tutorialSeen = kept.tutorialSeen;

  // The head start goes through `markConquered` rather than writing statuses,
  // because that is the function that owns the transition — and then
  // `refreshUnlocks` opens whatever now touches the empire, exactly as a conquest
  // does. A hand-written status would leave the adjacency gate closed and the
  // player holding regions with nothing to attack from them.
  const headStart = headStartFor(legacy.resets);
  for (const r of REGIONS.slice(0, headStart)) {
    markConquered(meta, r.id, { now, durationMs: 0 });
  }
  refreshUnlocks(meta, bus);
  // ...and only now is the cached income right. It is NOT zero any more — the head
  // start pays — which is precisely why this cannot live in legacy.js.
  recalcIncome(meta, bus);

  const result = {
    ok: true, reason: 'ok', points, headStart,
    total: legacy.points, resets: legacy.resets,
  };
  emit(bus, META_EVENTS.ABDICATED, result);
  return result;
}
