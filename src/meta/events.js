// Meta-domain event names.
//
// Declared PER DOMAIN, not in one shared registry — a single global constants
// file is a guaranteed merge conflict on every append, and there is no upside.
// battle/ declares its own; render/ declares its own.
//
// The bus carries NOTIFICATIONS ONLY. If the shop must repaint after a purchase
// that is a notification; if idle income must run before rewards are granted
// that is a direct call, never an event. Ordering through a bus is how a game
// acquires bugs nobody can reproduce.
//
// PURE: this module owns names, not a bus instance.

export const META_EVENTS = Object.freeze({
  /** { crowns, delta, reason } — reason is 'idle' | 'offline' | 'reward' | 'raid'
   *  | 'incursion' | 'legacy' | 'spend' */
  CROWNS_CHANGED: 'meta:crowns',
  /** { incomePerSec, previous } */
  INCOME_CHANGED: 'meta:income',
  /** { regionId } — became attackable because a neighbour fell */
  REGION_UNLOCKED: 'meta:region-unlocked',
  /** { regionId, clears, rewardPerSec, crowns } */
  REGION_CONQUERED: 'meta:region-conquered',
  /** { regionId, crowns, clears, raidReadyAt } */
  RAID_COMPLETED: 'meta:raid-completed',
  /** { regionId, readyAt } */
  RAID_READY: 'meta:raid-ready',
  /** { depth, crowns, mutators } — a rung of the endless ladder was cleared.
   *  There is deliberately no INCURSION_FAILED: a lost rung changes nothing but
   *  an attempt counter, and an event nobody can act on is the third state this
   *  project has been burned by (see the note at the foot of meta/world.js). */
  INCURSION_CLEARED: 'meta:incursion-cleared',
  /** { points, total, resets } — a run was ended and converted to legacy */
  ABDICATED: 'meta:abdicated',
  /** { id, level, cost } */
  UPGRADE_PURCHASED: 'meta:upgrade-purchased',
  /** { id, count, cost } */
  BOOSTER_PURCHASED: 'meta:booster-purchased',
  /** { id, count } — spent in a battle, deducted by meta/rewards.js */
  BOOSTER_CONSUMED: 'meta:booster-consumed',
  /** { elapsedMs, cappedMs, crowns, rate } — the "while you were away" summary */
  OFFLINE_PROGRESS: 'meta:offline-progress',
  /** { key, bytes, backup } */
  SAVE_WRITTEN: 'meta:save-written',
  /** { reason, detail } — refused to LOAD; the file on disk is untouched */
  SAVE_REFUSED: 'meta:save-refused',
  /** { key } */
  SAVE_CLEARED: 'meta:save-cleared',
  /** { config } — meta has handed a BattleConfig to the seam */
  BATTLE_REQUESTED: 'meta:battle-requested',
  /** { outcome, summary } */
  OUTCOME_APPLIED: 'meta:outcome-applied',
});

/**
 * Emit only if a bus was actually supplied. Every meta function takes an
 * optional `bus`, which is what keeps meta/** headless-testable: the tests pass
 * nothing and assert on state, the game passes a bus and gets repaints.
 * @param {{emit:(t:string,p?:object)=>void}|null|undefined} bus
 */
export function emit(bus, type, payload) {
  if (bus && typeof bus.emit === 'function') bus.emit(type, payload);
  return payload;
}
