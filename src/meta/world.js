// The world map: the region graph, the adjacency gate, status transitions, and
// raid cooldowns.
//
// THE GATE: you may only attack a region that TOUCHES YOUR EMPIRE. Riverfen is
// the single seed region; everything else needs a conquered neighbour. That is
// what makes the world map a shape rather than a menu, and it is why
// `adjacentTo` in regions.data.js has to be real hex adjacency (asserted in
// tests/modifiers.test.js).
//
// Availability is MONOTONE — a region never goes back to locked, and a region
// never goes back to unconquered. Anything else and a save could regress.
//
// PURE: `now` is injected. No Date.now, no storage, no DOM.

import { REGIONS, REGION_BY_ID, REGION_IDS, RAID } from '../content/regions.data.js';
import { createRegionRecord } from '../core/store.js';
import { META_EVENTS, emit } from './events.js';

export { REGIONS, REGION_BY_ID, REGION_IDS, RAID };

export const regionById = (id) => REGION_BY_ID[id] ?? null;

/** Heals a missing record rather than throwing — content can add regions to an
 *  existing save without a migration. */
export function record(meta, id) {
  let rec = meta.regions[id];
  if (!rec) {
    rec = createRegionRecord(REGION_BY_ID[id]?.startsUnlocked ? 'available' : 'locked');
    meta.regions[id] = rec;
  }
  return rec;
}

export const statusOf = (meta, id) => record(meta, id).status;
export const isConquered = (meta, id) => statusOf(meta, id) === 'conquered';

export function conqueredIds(meta) {
  return REGION_IDS.filter((id) => isConquered(meta, id));
}

/** The number that sizes your expedition. The whole progression hangs off it. */
export function regionsConquered(meta) {
  return conqueredIds(meta).length;
}

/**
 * How far AHEAD of the campaign's own pacing this region sits, in regions.
 *
 * `REGION_IDS` is campaign order, so a region at index i is "on schedule" once
 * i regions have been taken. Zero or negative means the empire has caught up.
 *
 * WHY THIS EXISTS. `touchesEmpire`/`isAttackable` gate on hex ADJACENCY alone —
 * no tier gate, no conquest count — and Ashford's `adjacentTo` reaches Kaldan,
 * which is tier 2. So two regions in, the map offers a tier-2 fight behind the
 * same green Attack button as its tier-1 neighbours, and measured at n=16 each
 * the difference is total: rushing it wins 0 of 16, arriving on schedule wins
 * 69%. A new player exploring a hex map with locked tiles finds this in the
 * first twenty minutes, and what they get is a wall with no stated cause.
 *
 * NOT A HARD GATE. Locking it would contradict the free-movement philosophy the
 * rest of the design runs on, and a player who wants to try a hard region should
 * be allowed to. What was missing was the telling, not the stopping.
 */
export function campaignGap(meta, regionId) {
  const i = REGION_IDS.indexOf(regionId);
  return i < 0 ? 0 : i - regionsConquered(meta);
}

/**
 * The gap at which the map says something.
 *
 * TWO, AND IT IS MEASURED RATHER THAN CHOSEN. Into kaldan: on schedule (gap 0)
 * wins 69%, one region early (gap 1) wins 56% — hard but plainly playable — and
 * two early (gap 2) wins 0 of 16. The cliff is between one and two, so warning
 * at one would cry wolf on a fight the player can actually take.
 */
export const CAMPAIGN_GAP_WARN = 2;

/** Does this region touch the empire (or is it the seed region)? */
export function touchesEmpire(meta, id) {
  const region = REGION_BY_ID[id];
  if (!region) return false;
  if (region.startsUnlocked) return true;
  return region.adjacentTo.some((n) => isConquered(meta, n));
}

/** Can a battle be started here right now? Conquered regions go through raids. */
export function isAttackable(meta, id) {
  const status = statusOf(meta, id);
  return status === 'available' && touchesEmpire(meta, id);
}

/**
 * Promote every locked region that now touches the empire. Called after any
 * conquest and after a load. Returns the ids that changed, for the map's
 * "new front opened" flourish.
 * @returns {string[]}
 */
export function refreshUnlocks(meta, bus) {
  const opened = [];
  for (const id of REGION_IDS) {
    const rec = record(meta, id);
    if (rec.status !== 'locked') continue;
    if (!touchesEmpire(meta, id)) continue;
    rec.status = 'available';
    opened.push(id);
  }
  for (const id of opened) emit(bus, META_EVENTS.REGION_UNLOCKED, { regionId: id });
  return opened;
}

/**
 * available -> conquered. Idempotent: re-conquering is a raid and goes through
 * completeRaid() instead, so this can never double-grant permanent income.
 * @returns {boolean} true if this call was the transition
 */
export function markConquered(meta, id, { now = 0, durationMs = 0 } = {}) {
  const rec = record(meta, id);
  if (rec.status === 'conquered') return false;
  rec.status = 'conquered';
  rec.clears = Math.max(1, rec.clears + 1);
  rec.bestMs = durationMs > 0 ? durationMs : rec.bestMs;
  rec.raidReadyAt = now + RAID.cooldownMs;
  return true;
}

// ---------------------------------------------------------------------------
// Raids. Replay without infinite grinding: a conquered region re-fights on a
// 10-minute cooldown for a ONE-TIME lump — never permanent income, or a single
// region could be farmed into an infinite economy.
// ---------------------------------------------------------------------------

export function raidCooldownRemaining(meta, id, now) {
  const rec = record(meta, id);
  return Math.max(0, rec.raidReadyAt - now);
}

export function canRaid(meta, id, now) {
  if (!isConquered(meta, id)) return false;
  return raidCooldownRemaining(meta, id, now) === 0;
}

/**
 * Each clear makes the region +15% harder. Applied to the region's enemyMult.
 *
 * This is also the DIFFICULTY TERM THE PAYOUT IS PROPORTIONAL TO — see the RAID
 * block in content/regions.data.js and meta/rewards.js `raidLump`. The crowns
 * live over there because rewards.js owns every crown in the game and because
 * the lump is anchored to empire income, which world.js cannot see without
 * importing idle.js back the other way.
 */
export function effectiveEnemyMult(meta, id) {
  const region = REGION_BY_ID[id];
  if (!region) return 1;
  const clears = record(meta, id).clears;
  return region.enemyMult * (1 + RAID.harderPerClear) ** Math.max(0, clears);
}

/** Bookkeeping half of a won raid. meta/rewards.js owns paying for it. */
export function completeRaid(meta, id, { now = 0, durationMs = 0 } = {}) {
  const rec = record(meta, id);
  rec.clears += 1;
  rec.raidReadyAt = now + RAID.cooldownMs;
  if (durationMs > 0 && (rec.bestMs === 0 || durationMs < rec.bestMs)) rec.bestMs = durationMs;
  return rec;
}

/** Whichever mode this region is in right now. The world map badge reads this. */
export function modeOf(meta, id, now) {
  if (!isConquered(meta, id)) return isAttackable(meta, id) ? 'attack' : 'locked';
  return canRaid(meta, id, now) ? 'raid' : 'cooldown';
}

/** Everything the world map needs, with zero DOM and zero clock reads. */
export function worldView(meta, now) {
  return REGIONS.map((r) => {
    const rec = record(meta, r.id);
    return {
      id: r.id,
      name: r.name,
      tier: r.tier,
      hex: r.hex,
      adjacentTo: r.adjacentTo,
      flavour: r.flavour,
      status: rec.status,
      mode: modeOf(meta, r.id, now),
      clears: rec.clears,
      bestMs: rec.bestMs,
      rewardPerSec: r.rewardPerSec,
      enemyMult: effectiveEnemyMult(meta, r.id),
      cooldownMs: raidCooldownRemaining(meta, r.id, now),
      targetLengthMin: r.targetLengthMin,
    };
  });
}

// There is deliberately no `raidsBecomingReady` / RAID_READY poll here. It
// existed as an exported, finished-looking function that main.js never called,
// no screen ever subscribed to and no test ever covered — the third state this
// project has been burned by twice (dead boosters, an unclickable UI). The
// META_EVENTS.RAID_READY name in meta/events.js is now unemitted and should go
// with it next time someone is in that file. Raid readiness IS surfaced, by
// polling: screens/worldmap.js re-reads `modeOf` every 250ms for the selected
// region and re-renders when it flips to 'raid', and every region card carries
// `data-mode`. If a "a raid came off cooldown while you were away" banner is
// ever wanted, it belongs next to the existing offline-earnings banner in
// worldmap.js and should be written then, against that surface.
