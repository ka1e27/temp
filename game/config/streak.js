// The Conquest Streak (PLAN-PHASE4 §4B): momentum between conquests. Every number lives here; read by game/meta/streak.js
// (and conquestBounty in game/meta/progression.js). Times are ACTIVE seconds (state.frontier.activeSec), like the raid clock.

export const STREAK = Object.freeze({
  // A conquest within this many active seconds of the previous one raises the streak by 1; otherwise it starts again at 1.
  // 8 minutes: a D1 conquest comes every ~3 min on the median seed (tools/campaign.mjs), so a steady player keeps it alive,
  // and one long savings wait breaks it.
  windowSec: 8 * 60,
  // The conquest bounty (gold only, never Renown) x this, indexed by the streak count AFTER the conquest (index 0 and 1 = x1).
  // The last entry repeats. PLAN-PHASE4 §4B asked for 5+ -> x1.5; the campaign bot keeps a streak alive almost all game (median
  // best streak 13-21), so 5+ is the multiplier that matters: with x1.5 the D1 median on the 12-seed guard read 1.10 h (the floor of
  // the 1.1-1.6 h target), with x1.3 1.13 h (24 seeds: 1.16 h -> 1.18 h). x1.5 is a one-number change here if the lead wants it.
  mult: Object.freeze([1, 1, 1.1, 1.2, 1.3, 1.3]),
  hideBelow: 2,                // the HUD chip is hidden at a streak of 0-1
  copy: Object.freeze({
    chip: '×{mult} · {count}',
    retreatWarning: 'Retreating ends your conquest streak.',
    broken: Object.freeze({ expired: 'Streak ended', lost: 'Streak broken', retreat: 'Streak broken' }),
  }),
});
