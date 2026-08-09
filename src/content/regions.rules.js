// The campaign's RULES, as opposed to its twenty-one rows.
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
export const HARD_CAP_MIN_BY_TIER = [12, 14, 17, 20, 24];
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

/**
 * What the enemy is allowed to field, by region tier. Rams arriving at tier 3
 * is the moment sieges stop being one-sided.
 *
 * The roster runs out at tier 4 — there is no sixth unit — so tier 5 REPEATS
 * it rather than inventing one. That is deliberate: a tier whose identity is a
 * new unit is a tier that cannot be tuned, because the unit is a cliff and the
 * dial is a slope. Tier 5's step is the commander (AI_TIERS[4]), the ground
 * (`develop`, grid, site counts) and the dial.
 *
 * `marshal` at tier 4 is now a real grant — see meta/modifiers.js
 * `withEnemyMarshal`. It listed here for this project's whole life and did
 * nothing at all.
 */
export const ENEMY_UNITS_BY_TIER = Object.freeze([
  ['militia', 'spearmen'],
  ['militia', 'spearmen', 'raiders'],
  ['militia', 'spearmen', 'raiders', 'rams'],
  ['militia', 'spearmen', 'raiders', 'rams', 'marshal'],
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

// --- The two clamps every row goes through --------------------------------
// Moved here from ./regions.data.js when tier 5 shipped: both are statements
// about what a `develop` or a `castleGateFrac` MEANS, which is this file's job,
// and the table needed the line budget back. `T()` imports them.

/**
 * HOW DEVELOPED THE ENEMY'S COUNTRY IS — the second half of "a bigger war, not
 * a tier-1 fight with inflated numbers", and the knob that makes the late
 * regions LONG instead of merely lethal.
 *
 * `develop` is a site LEVEL (content/balance.js SITE_LEVELS), not a multiplier.
 * The enemy's castle and strongholds start built to it and its farms one step
 * below, so a tier-4 region is fought over ground that has been worked: x1.96
 * structure HP and repair, x1.75 farm gold, x1.75 training throughput, +40
 * garrison cap. Nothing about a level is a new rule — it is the same ladder the
 * player buys in-battle, handed to the defender at the start.
 *
 * This is what the flavour text has always claimed and nothing implemented.
 * Karrowmere says "every enemy stronghold is upgraded, so token forces bounce
 * off the walls"; before this it generated the same level-1 outposts riverfen
 * does. It also fixes the thing that made the endgame a walkover REGARDLESS of
 * enemyMult: victory is capture-castle, and a level-1 castle is 480 HP repairing
 * at 5/s, which a hundred militia break in under five seconds. Measured at
 * n=48, obsidian resolved in 3.3-5.5 minutes at every dial setting from 1.75 to
 * 3.61 — won or lost, it was never a 23-minute war, because the prize could not
 * hold out. At develop 4 the same castle is 1317 HP repairing at 13.7/s and has
 * to be besieged by an army that brought engines.
 *
 * Tier 1 and kaldan are pinned at 1: regions 1-5 are balance-frozen.
 *
 * WHERE THE FRACTION LANDS MATTERS MORE THAN HOW BIG IT IS, and that is the one
 * thing the original column got wrong. battle/mapgen.js `developLevels` promotes
 * `round(share x pool)` forts BEST FIRST, and the best fort is the CASTLE — the
 * win condition. So the promotion that costs the player the most is not the
 * biggest step in this column, it is whichever step first crosses
 * `share >= 0.5 / pool`. Measured at n=96: vaelstrand at develop 2.05 (castle
 * level 2) won 82%; duskfell, one row later at 2.15, is the same map with the
 * same site counts and won 56%, and the whole difference was one castle level.
 *
 * Two rules follow, and the table obeys both.
 *   1. Put a castle promotion on a region where the PLAYER also takes a step —
 *      thanescar (2.20) is the first, and it is the tier-4 opener where the
 *      expedition also gains two starting sites.
 *   2. Where two neighbouring regions should differ only slightly, give them
 *      develop values inside the SAME rounding bucket (greywater 1.50 and
 *      thornmoor 1.55 both promote two of four forts) rather than values that
 *      look adjacent but straddle a boundary.
 */
export const DEVELOP_CLAMP = (n) => Math.max(1, Math.min(5, Number(n) || 1));

/**
 * THE CASTLE GATE — the fraction of the region's non-castle sites the player
 * must hold before the castle's siege can actually complete (see
 * battle/state.js `castleSealed`, applied in battle/sim.js `siegePhase`).
 * Below it, hp floors at 1 and the siege can run forever without capturing —
 * the same shape as `breachSeconds() === Infinity` one level up: you cannot
 * finish the war by beelining the capital, you have to hold the countryside.
 *
 * This is the SHAPE fix for the thing enemyMult, develop and map size could
 * not touch: victory is capture-castle, so no matter how big or how developed
 * the map got, a player who could reach the throne could always end the war
 * the moment its siege landed, and sites off that one path were never fought
 * over. Gating the throne on territory is what makes "bigger map" mean
 * "longer battle" instead of "more scenery to walk past".
 *
 * 0 for tier 1 and kaldan: regions 1-5 are balance-frozen and rushing the
 * castle is supposed to work early. It rises through tiers 2-5 so a late clear
 * genuinely requires converting real ground first, not just the shortest path
 * to the throne. Tuned against tools/simrunner.js at n>=96 (n=240 spot check on
 * tiers 3-5): every region stays winnable inside its hard cap.
 *
 * The 0.85 ceiling is not decoration. `castleSealed` counts NON-CASTLE sites,
 * and a region whose gate rounds up to "all of them" is one where a single
 * unreachable farm in a mountain pocket makes the throne uncapturable and the
 * battle unwinnable at any skill.
 */
export const GATE_CLAMP = (n) => Math.max(0, Math.min(0.85, Number(n) || 0));
