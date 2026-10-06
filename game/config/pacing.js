// The first hour's pacing (PLAN-PHASE10 10A, measured by tools/firstHour.mjs). Read by game/app/pacer.js, game/app/tutorial.js (the steps' `intro`),
// game/app/goals.js, game/main.js and game/scenes/world.js. Times are PLAY seconds (state.stats.playSec: the map and battles, never the title).

export const PACING = Object.freeze({
  // New systems arrive one at a time: a system's first appearance (its hint, its HUD chip, its first toast, its board) waits until this long after the
  // previous system's. The first raid never waits (core gameplay: its own grace, FRONTIER.graceSec / minRegions) but restarts the clock; the first world event and the first Vendetta wait their turn.
  // PLAN-PHASE11b: the scheduled first raid (FRONTIER.firstRaidAfterGraceSec) keeps its own slot: no other first appearance this many active
  // seconds before or after it is planned to set out (game/app/pacer.js firstRaidReserved)
  firstRaidReserveSec: 150,
  introGapSec: 152, // lead decision after Phase 10: 150 s (+2 s: play seconds and the wall clock drift a little; 150 measured as 149.x)
  // Systems already present in a loaded save count as introduced (nothing waits behind them after a reload).
});
