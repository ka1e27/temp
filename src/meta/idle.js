// The idle economy: crowns per second, live accrual, and offline progress.
//
// Income accrues in THREE places and they are all the same number:
//   - on the world map          (main.js calls tick())
//   - DURING battles            (there is no reason to punish playing)
//   - offline                   (applyOfflineProgress, closed form)
//
// LONG ABSENCES ARE NEVER SIMULATED. A 30-day gap is one multiplication, not
// 25 million ticks. Simulating it is the classic idle-game freeze on load, and
// it is also wrong, because the cap makes the answer independent of the path.
//
// PURE: `now` is injected everywhere. No Date.now, no storage, no DOM.

import { REGION_BY_ID } from '../content/regions.data.js';
import { metaOf } from '../core/store.js';
import { upgradeEffects, addBonus, offlineCapMs } from './upgrades.js';
import { conqueredIds } from './world.js';
import { stack } from './modifiers.js';
import { META_EVENTS, emit } from './events.js';

export { offlineCapMs, metaOf };

/** Raw sum of permanent region income, before upgrades. */
export function baseIncomePerSec(x) {
  const meta = metaOf(x);
  let sum = 0;
  for (const id of conqueredIds(meta)) sum += REGION_BY_ID[id]?.rewardPerSec ?? 0;
  return sum;
}

/**
 * Crowns per second. Uses the SAME stacking order as every battle modifier:
 * base x (1 + additive) x multiplicative x boosters x tier. Idle has no
 * boosters and no tier, so this reduces to base x (1 + Tithe levels x 0.15) —
 * but it goes through `stack` so it can never drift from the battle side.
 */
export function incomePerSec(x) {
  const meta = metaOf(x);
  const fx = upgradeEffects(meta);
  return stack(baseIncomePerSec(meta), { additive: addBonus(fx, 'income') });
}

/** Recompute and cache. meta.incomePerSec has exactly one writer: this. */
export function recalcIncome(x, bus) {
  const meta = metaOf(x);
  const previous = meta.incomePerSec;
  meta.incomePerSec = incomePerSec(meta);
  if (meta.incomePerSec !== previous) {
    emit(bus, META_EVENTS.INCOME_CHANGED, { incomePerSec: meta.incomePerSec, previous });
  }
  return meta.incomePerSec;
}

/** Grant crowns for `dtMs` of elapsed time. Negative dt is ignored, never
 *  subtracted — a stepped-back clock must not be able to take money away. */
export function accrue(x, dtMs, bus) {
  const meta = metaOf(x);
  if (!(dtMs > 0)) return 0;
  const rate = incomePerSec(meta);
  const gained = (rate * dtMs) / 1000;
  if (!(gained > 0)) return 0;
  meta.crowns += gained;
  meta.stats.crownsEarned += gained;
  emit(bus, META_EVENTS.CROWNS_CHANGED, { crowns: meta.crowns, delta: gained, reason: 'idle' });
  return gained;
}

/**
 * The per-frame heartbeat. Accrues `dtMs` and resynchronises `lastSeenAt` to
 * wall-clock `now`, so closing the tab at any moment leaves a correct anchor
 * for the next offline calculation.
 */
export function tick(state, dtMs, now, bus) {
  const meta = metaOf(state);
  const gained = accrue(meta, dtMs, bus);
  if (dtMs > 0) meta.stats.playMs += dtMs;
  if (typeof now === 'number' && Number.isFinite(now)) state.lastSeenAt = now;
  return gained;
}

/**
 * A gap this long between two frames is not a slow frame, it is an ABSENCE:
 * a closed laptop lid, a locked phone, a tab the browser froze. Above it the
 * heartbeat hands over to the closed-form offline path.
 *
 * A backgrounded tab is throttled to roughly one frame a second, so the value
 * has to sit clear of that or ordinary background play would route through the
 * offline cap on every frame. Five seconds is far above the throttle and far
 * below any real absence.
 */
export const IDLE_CATCHUP_MS = 5000;

/**
 * The heartbeat, with a real stall credited instead of thrown away.
 *
 * THE BUG THIS EXISTS TO FIX, because it is worth stating plainly: idle income
 * used to be reconciled ONLY at boot. Within a running session main.js clamped
 * the gap between two frames to one second and discarded the rest, on the
 * reasoning that "a long stall is the offline calculation's job" — but the
 * offline calculation had exactly one caller, in the save-load path, so nothing
 * reconciled a stall that happened mid-session. Measured in the live game at
 * 1 crown/s with the clock stepped forward ten minutes: **1 crown credited
 * against 600 expected.**
 *
 * The player-facing shape of that is the part that matters. Closing the tab
 * credited the full absence up to the cap; leaving it open credited one second.
 * The game paid you LESS for leaving it running, which is the exact opposite of
 * the promise an idle game is played for, and it did it silently — no message,
 * no cap notice, just a number that had not moved.
 *
 * Below the threshold the whole gap is credited rather than clamped: it is
 * bounded by the threshold itself, so there is nothing left for a clamp to
 * protect against, and every millisecond it used to shave was a millisecond the
 * player had genuinely waited. Above it, `applyOfflineProgress` does the work it
 * was always meant to do — same cap, same backwards-clock handling, same resync
 * — so there is one implementation of "time passed while you were away" rather
 * than two that can disagree.
 *
 * Wall clock only, exactly as `tick` is. The battle speed control makes the loop
 * run up to 4x as often and paying per frame would make it a money printer;
 * nothing here is derived from the simulation clock.
 *
 * @returns {?object} the offline summary when a stall was credited, else null
 */
export function tickOrCatchUp(state, gapMs, now, bus) {
  const gap = Number.isFinite(gapMs) ? Math.max(0, gapMs) : 0;
  if (gap >= IDLE_CATCHUP_MS) return applyOfflineProgress(state, now, undefined, bus);
  tick(state, gap, now, bus);
  return null;
}

/**
 * Closed-form offline accrual: min(now - lastSeenAt, cap) x rate.
 *
 * Three cases this has to survive, all covered in tests/idle.test.js:
 *   - a 30-day gap  -> credited exactly `cap`, never 30 days of income
 *   - now < lastSeenAt (clock stepped back, DST, a synced device) -> ZERO
 *     crowns and no negative anything; lastSeenAt resyncs to the new clock so
 *     the player is not stuck owing time
 *   - rate 0 (nothing conquered yet) -> zero, and still resyncs
 *
 * @param {object} state  root state (needs lastSeenAt + meta)
 * @param {number} now    epoch ms, injected
 * @param {number} [capMs] override; defaults to the Granary-extended cap
 */
export function applyOfflineProgress(state, now, capMs, bus) {
  const meta = metaOf(state);
  const last = Number.isFinite(state.lastSeenAt) ? state.lastSeenAt : now;
  const cap = Number.isFinite(capMs) ? Math.max(0, capMs) : offlineCapMs(meta);
  const rate = incomePerSec(meta);

  const rawElapsedMs = now - last;
  const elapsedMs = Math.max(0, rawElapsedMs);      // backwards clock -> 0, never negative
  const creditedMs = Math.min(elapsedMs, cap);
  const crowns = Math.max(0, (rate * creditedMs) / 1000);

  if (crowns > 0) {
    meta.crowns += crowns;
    meta.stats.crownsEarned += crowns;
  }
  meta.stats.offlineMsClaimed += creditedMs;
  state.lastSeenAt = now;                            // always resync, even when clamped

  const summary = {
    elapsedMs, rawElapsedMs, creditedMs, capMs: cap, crowns, rate,
    cappedOut: elapsedMs > cap,
    backwards: rawElapsedMs < 0,
  };
  if (crowns > 0) {
    emit(bus, META_EVENTS.CROWNS_CHANGED, { crowns: meta.crowns, delta: crowns, reason: 'offline' });
  }
  emit(bus, META_EVENTS.OFFLINE_PROGRESS, summary);
  return summary;
}

/** What `seconds` of idling is worth right now. Used by the shop's "in 2:14". */
export function projectCrowns(x, seconds) {
  return incomePerSec(metaOf(x)) * Math.max(0, seconds);
}

/**
 * Seconds of idling before `cost` is affordable. The pacing target for the whole
 * game is that this stays under ~180 for the next NEEDED upgrade; when it does
 * not, the answer is a balance change, not a longer session.
 * @returns {number} 0 if already affordable, Infinity if income is 0
 */
export function timeToAfford(x, cost) {
  const meta = metaOf(x);
  const missing = cost - meta.crowns;
  if (missing <= 0) return 0;
  const rate = incomePerSec(meta);
  return rate > 0 ? missing / rate : Infinity;
}
