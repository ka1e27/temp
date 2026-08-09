// The campaign's RULES, as opposed to its eighteen rows.
//
// Split out of ./regions.data.js purely for the line budget, the same way
// ./ai.data.js was, and re-exported from there — so
// `import { RAID } from '../content/regions.data.js'` keeps working and that
// file keeps its promise of being the one front door for the campaign.
//
// The division of labour: THIS file is everything true of every region (how a
// raid pays, how one difficulty dial spreads across the enemy's mods, what the
// enemy may field per tier, what a site starts garrisoned with). ./regions.data.js
// is the table itself and the reasoning behind the shape of its columns.
// PURE DATA. No logic reads a number that is not defined here or in balance.js.

/** Battle hard cap per tier, in minutes. A backstop, not a timer you play
 *  against — each sits well above its tier's targetLengthMin. */
export const HARD_CAP_MIN_BY_TIER = [12, 14, 17, 20];
/** The cap is a stall backstop, not a race: 2.2x the advertised length. */
export const HARD_CAP_RATIO = 1.9;

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

/** How a region's single `enemyMult` difficulty dial is spread across the
 *  enemy's FactionMods. Exponents, so mult=1 leaves everything at baseline. */
export const ENEMY_SCALING = Object.freeze({
  atk: 0.45, def: 0.35, gold: 0.35, train: 0.25, garrison: 0.30,
});

/** What the enemy is allowed to field, by region tier. Rams arriving at tier 3
 *  is the moment sieges stop being one-sided. */
export const ENEMY_UNITS_BY_TIER = Object.freeze([
  ['militia', 'spearmen'],
  ['militia', 'spearmen', 'raiders'],
  ['militia', 'spearmen', 'raiders', 'rams'],
  ['militia', 'spearmen', 'raiders', 'rams', 'marshal'],
]);

/** Starting garrisons the meta layer writes into a generated map, before
 *  enemy scaling. Battle never invents troops; the config says what is there. */
export const BASE_GARRISON = Object.freeze({
  castle: { spearmen: 4, militia: 4 },
  stronghold: { spearmen: 3, militia: 2 },
  farm: { militia: 3 },
  camp: {},
});
/** Neutral sites are lightly held — they are the opening move, not a wall. */
export const NEUTRAL_GARRISON = Object.freeze({ militia: 2 });
/** Player-held outposts at the start of a region. */
export const PLAYER_SITE_GARRISON = Object.freeze({ militia: 2 });

/** Opening battle-gold pools. You are ~1.9x behind on paper and win on tempo. */
export const BATTLE_START = Object.freeze({ playerGold: 300, enemyGold: 200 });

/** Tuning for meta's own fallback layout, used only when battle/mapgen.js is
 *  not injected. Degree 3 keeps the site graph planar-ish with real front lines. */
export const FALLBACK_MAP = Object.freeze({ blockedFrac: 0.08, degree: 3 });
