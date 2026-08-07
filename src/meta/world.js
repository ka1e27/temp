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

/** Each clear makes the region +15% harder. Applied to the region's enemyMult. */
export function effectiveEnemyMult(meta, id) {
  const region = REGION_BY_ID[id];
  if (!region) return 1;
  const clears = record(meta, id).clears;
  return region.enemyMult * (1 + RAID.harderPerClear) ** Math.max(0, clears);
}

/** ...and +10% richer. A lump in crowns, paid once, never added to income. */
export function raidLump(meta, id) {
  const region = REGION_BY_ID[id];
  if (!region) return 0;
  const clears = Math.max(0, record(meta, id).clears);
  return region.rewardPerSec * RAID.lumpSeconds * (1 + RAID.richerPerClear) ** (clears - 1);
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

/** Regions whose raid timer expired since `previousNow`. main.js polls this to
 *  fire RAID_READY without every region needing its own timer. */
export function raidsBecomingReady(meta, previousNow, now) {
  const ready = [];
  for (const id of REGION_IDS) {
    const rec = record(meta, id);
    if (rec.status !== 'conquered') continue;
    if (rec.raidReadyAt > previousNow && rec.raidReadyAt <= now) ready.push(id);
  }
  return ready;
}
