// WHAT A BATTLE PAYS — the three rules that turn an outcome into crowns.
//
// Split out of ./regions.rules.js at the 400-line cap, along the seam that
// matters: that file is what a REGION IS (its ground, its dial, its enemy
// roster), this is what FIGHTING one is worth. Re-exported from there, so no
// importer has to know it moved. The arithmetic itself stays in
// meta/rewards.js, which is the only file allowed to touch crowns.
// PURE DATA.

/**
 * Conquered regions re-fight as Raids: a one-time crown lump, never permanent
 * income — one region could otherwise be farmed into an infinite economy.
 *
 * THE RELATIONSHIP, stated here so it can be tested instead of hoped for.
 * Implemented by meta/rewards.js `raidLump`, asserted by tests/raideconomy.test.js:
 *
 *     lump  =  EMPIRE income/sec  x  lumpSeconds  x  effectiveEnemyMult
 *
 * Two properties fall out of that one line, and the test drives both off
 * REGIONS so a nineteenth region cannot ship broken.
 *
 * 1. A RAID IS WORTH THE TIME. The lump is denominated in seconds of THE
 *    EMPIRE'S income, not the region's. The old formula paid
 *    `region.rewardPerSec * 600` — ten minutes of a number that is a rounding
 *    error by the time you are allowed to raid it. Measured at full conquest
 *    (~682/s): riverfen paid 600 crowns, under ONE SECOND of idling, for an
 *    eight-minute battle; obsidian paid 29.4k, 43 seconds, for nine. Every raid
 *    in the game was dominated by leaving the tab open. Anchored to empire
 *    income the payoff is stage-INVARIANT — a raid is worth the same number of
 *    minutes of your own income at region 1 and at region 18 — and that number
 *    is `minPayoffRatio` or better for every region in the table (measured
 *    1.25x on the thinnest, 3.8x on the best). It is paid ON TOP of the idle
 *    income that keeps accruing during the battle (main.js ticks in every
 *    scene), so a raid is a rate multiplier on time spent playing, never a
 *    tax on it.
 *
 * 2. REPEAT RAIDS DO NOT DECAY. Reward is PROPORTIONAL to the difficulty the
 *    player actually faces, so reward-per-difficulty is constant by
 *    construction and cannot drift whatever `harderPerClear` becomes. The old
 *    pair — 0.15 harder against 0.10 richer — made every clear 1.10/1.15 =
 *    0.957x the value of the one before it, permanently: ten clears in, a raid
 *    was 35% worse value than the first and never recovered. `richerPerClear`
 *    is gone because proportionality leaves it nothing to do.
 *
 * WHAT BOUNDS THE LOOP is winnability, not a cap. Difficulty compounds 15% a
 * clear while the shop is finite, so a farmed region walls the player out by
 * itself and they move to the next one — which is the endgame verb the back
 * half of the campaign did not have. `lump ∝ income` is not a feedback loop
 * either: raids pay lumps, only conquest adds income, and the two income
 * multipliers (Tithe, Royal Mint) are level-capped.
 */
export const RAID = Object.freeze({
  cooldownMs: 10 * 60 * 1000,
  harderPerClear: 0.15,   // effectiveEnemyMult = enemyMult x (1 + this) ^ clears
  lumpSeconds: 600,       // seconds of EMPIRE income a difficulty-1.0 raid pays
  /** Design floor: a raid pays at least this multiple of what its own
   *  advertised battle length (`targetLengthMin`) would have idled. */
  minPayoffRatio: 1.0,
});

/** One-off crown bounty the first time a region falls, in seconds of its income. */
export const FIRST_CLEAR_BONUS_SECONDS = 120;

/**
 * WHAT A BATTLE YOU LED BUT DID NOT FINISH IS WORTH. Full argument in CLAUDE.md;
 * the two facts that justify it are that **93% of every non-win is a TIMEOUT and
 * 63% of those end AHEAD**, and that `sim.js endPhase` has computed the
 * territorial verdict into `state.meta.timeoutWinner` for that mechanic's whole
 * life with nothing ever reading it. IT PAYS, IT DOES NOT WIN: `result` stays
 * `timeout`, nothing is conquered, `clears` and `cleared` do not move, and no
 * relics are paid. Every measured number is `status === 'win'`, so it is outside
 * the balance table by construction.
 */
export const HELD_FIELD = Object.freeze({
  /** Share of what taking the region would have paid. */
  frac: 0.30,
  /** Below this share of the map, leading is a technicality and pays nothing —
   *  otherwise a 50.1% verdict would announce itself as an achievement. */
  minShare: 0.45,
});
