// The Conquest Streak (PLAN-PHASE4 §4B): conquests close together multiply the conquest bounty (gold only). A LEAF (config and
// deeds.js only), so progression.js can apply it inside conquestBounty / conquer. Pure: no DOM, no Date.now, no Math.random.
//
//   state.streak = { v:1, count, lastAt, best }      PER DYNASTY (reset by foundDynasty / resetRegions)
//     count: the live streak (0 = none); lastAt: active seconds (state.frontier.activeSec) of the last conquest or won defense that
//     kept it alive; best: the best count this dynasty.
//
// Who calls what: conquer() calls onStreakConquest itself (and conquestBounty already prices the NEXT conquest with the streak it
// would make), defenseReward() calls onStreakDefenseWon on a win, tickFrontier() calls tickStreak. Integration calls
// onStreakBroken(state, 'lost' | 'retreat') when an ATTACK is lost or retreated (no meta function sees those).
import { boonMods } from './boonsState.js';
import { STREAK } from '../config/streak.js';
import { deedBonuses, recordDeed } from './deeds.js';
import { edictMods } from './edicts.js'; // the leaf (PLAN-PHASE5): Bounty Hunters has no Conquest Streak

export function defaultStreak() {
  return { v: 1, count: 0, lastAt: null, best: 0 };
}

export function ensureStreak(state) {
  if (!state.streak || typeof state.streak !== 'object' || state.streak.v !== 1) state.streak = defaultStreak();
  return state.streak;
}

function nowSec(state) {
  const f = state.frontier;
  return f && Number.isFinite(f.activeSec) ? f.activeSec : 0;
}

/** The window in active seconds (STREAK.windowSec, plus the Unstoppable deed). */
export function streakWindowSec(state) {
  return STREAK.windowSec + deedBonuses(state).streakWindowSec;
}

function alive(state, s) {
  return s.count > 0 && s.lastAt != null && nowSec(state) - s.lastAt <= streakWindowSec(state) + 1e-9;
}

/** The bounty multiplier for a streak count (STREAK.mult; the last entry repeats). */
export function multForCount(count) {
  const m = STREAK.mult;
  return m[Math.max(0, Math.min(m.length - 1, Math.floor(count) || 0))];
}

/** The live streak's multiplier now (1 when it has run out). */
export function streakMultiplier(state) {
  if (!edictMods(state).streak) return 1;
  const s = state.streak;
  return s && alive(state, s) ? multForCount(s.count) : 1;
}

/** The streak count the next conquest would make: the live count + 1, or 1 when it has run out. */
export function projectedStreak(state) {
  const s = state.streak;
  return s && alive(state, s) ? s.count + 1 : 1;
}

/** The multiplier the next conquest's bounty gets (conquestBounty uses this, so the card shows what a win pays). */
export function projectedStreakMultiplier(state) {
  if (!edictMods(state).streak) return 1; // Bounty Hunters (PLAN-PHASE5)
  return multForCount(projectedStreak(state));
}

/**
 * For the HUD flame chip: `{ count, mult, remainingSec, windowSec, best, visible }`. `visible` is false at a streak of 0-1
 * (STREAK.hideBelow); `remainingSec` drains to 0 as the window runs out (the ring).
 */
export function streakInfo(state) {
  const s = state.streak || defaultStreak();
  const windowSec = streakWindowSec(state);
  const live = alive(state, s);
  const count = live ? s.count : 0;
  const remainingSec = live ? Math.max(0, windowSec - (nowSec(state) - s.lastAt)) : 0;
  return { count, mult: multForCount(count), remainingSec, windowSec, best: s.best || 0, visible: count >= STREAK.hideBelow };
}

/** A conquest: the streak rises (or starts at 1). MUTATES. Records the Unstoppable deed. Called by conquer(). */
export function onStreakConquest(state) {
  const s = ensureStreak(state);
  if (!edictMods(state).streak) return { count: 0, mult: 1 }; // Bounty Hunters: nothing counts
  s.count = projectedStreak(state);
  s.lastAt = nowSec(state);
  s.best = Math.max(s.best || 0, s.count);
  recordDeed(state, 'streak', s.count);
  return { count: s.count, mult: multForCount(s.count) };
}

/** A won defense keeps a live streak alive: the window starts again, the count stays. MUTATES. Called by defenseReward(). */
export function onStreakDefenseWon(state) {
  const s = ensureStreak(state);
  if (alive(state, s)) s.lastAt = nowSec(state);
  return streakInfo(state);
}

/**
 * The streak ends now: a lost attack ('lost'), a retreat ('retreat'), or the window ran out ('expired'). MUTATES.
 * @returns {{ was:number, reason:string }}
 */
export function onStreakBroken(state, reason = 'lost') {
  // Rearguard (PLAN-PHASE8): a retreat keeps the streak; `was: 0` so no "streak broken" toast fires, `kept` says why
  if (reason === 'retreat' && boonMods(state).rearguard) return { was: 0, reason, kept: true };
  const s = ensureStreak(state);
  const was = alive(state, s) ? s.count : 0;
  s.count = 0;
  s.lastAt = null;
  return { was, reason };
}

/** Expires a streak whose window has run out. MUTATES. Returns `{ was, reason: 'expired' }` when it ended now, else null. */
export function tickStreak(state) {
  const s = state.streak;
  if (!s || !(s.count > 0) || alive(state, s)) return null;
  const was = s.count;
  s.count = 0;
  s.lastAt = null;
  return { was, reason: 'expired' };
}

/** A save's `streak`, made valid. Never throws. */
export function sanitizeStreak(raw) {
  const out = defaultStreak();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0);
  const count = Math.min(999, Math.floor(n(raw.count)));
  out.lastAt = raw.lastAt != null && Number.isFinite(Number(raw.lastAt)) && Number(raw.lastAt) >= 0 ? Number(raw.lastAt) : null;
  out.count = out.lastAt == null ? 0 : count;
  out.best = Math.max(count, Math.min(999, Math.floor(n(raw.best))));
  return out;
}
