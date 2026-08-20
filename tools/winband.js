import { atTier } from '../src/content/tiers.js';

// THE WIN-RATE BAND EACH TIER IS AIMING AT.
//
// Extracted from simrunner.js so a TEST can read it. That file runs its CLI on
// import — it sweeps regions and calls `process.exit` — so anything importing it
// for one constant would run the whole harness instead, and the alternative was
// a second copy of the band in tests/, which is exactly the two-tables-drifting
// shape this project keeps finding.
//
// It lives in `tools/` and not in `content/`: this is an acceptance threshold
// for the measuring instrument, not a rule of the game. Nothing the player can
// observe depends on it.
/**
 * The win-rate band each TIER is aiming at, as [floor, ceiling] percentages.
 *
 * This was a single global floor of 55%, which stopped being usable the moment
 * the campaign was meant to end in a genuine wall: an endgame region designed to
 * take two or three attempts reads as TOO HARD against a number chosen when
 * every region was supposed to be a probable win.
 *
 * A CEILING matters as much as a floor, and there never was one. Most of this
 * project's real mis-tunes were regions that were too EASY — a walkover reports
 * "ok" against a floor and looks healthy right up until someone plays it.
 *
 * You are raiding regions the enemy owns outright, so the campaign descends:
 * the opening teaches, the endgame is meant to cost you attempts.
 */
// Tier 6's floor is 18 and NOT lower, and the constraint is a sample size rather
// than taste: tests/campaignplay.test.js proves each region is winnable by
// playing fixed seeds, and at an 18% true rate a 24-seed sample comes up empty
// 1% of the time. A band that floors at 12 would need 40 seeds a region to tell
// "hard" from "broken", which is the distinction that assertion exists to make.
export const WIN_BAND = [[78, 92], [66, 84], [50, 72], [34, 56], [22, 42], [18, 36]];

/** The band for a region, [floor, ceiling]. Clamped, so a tier outside the
 *  table reads as the nearest one rather than as `undefined`. */
export function bandFor(tier) {
  return atTier(WIN_BAND, tier);
}

/** Is a measured win rate inside its tier's band? */
export function inBand(pct, tier) {
  const [lo, hi] = bandFor(tier);
  return pct >= lo && pct <= hi;
}
