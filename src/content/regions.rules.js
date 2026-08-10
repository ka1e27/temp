// The campaign's RULES, as opposed to its twenty-four rows.
//
// Split out of ./regions.data.js purely for the line budget, the same way
// ./ai.data.js was, and re-exported from there — so
// `import { RAID } from '../content/regions.data.js'` keeps working and that
// file keeps its promise of being the one front door for the campaign.
//
// The division of labour: THIS file is everything true of every region (how a
// raid pays, how one difficulty dial spreads across the enemy's mods, what the
// enemy may field per tier, what a site starts garrisoned with, and the two rules
// the whole table obeys). ./regions.data.js is the table itself and the reasoning
// behind each tier's own columns.
// PURE DATA. No logic reads a number that is not defined here or in balance.js.

// ---------------------------------------------------------------------------
// THE TWO LOAD-BEARING RULES THE TABLE OBEYS.
//
// Moved here from ./regions.data.js when tier 6 needed that file's line budget,
// verbatim. They belong here for the same reason DEVELOP_CLAMP and GATE_CLAMP do:
// each is a claim about EVERY row, not about any one of them, and each is the
// reasoning a future pass has to read before it moves a column. The table's own
// header points back at this block.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// THE SECOND LOAD-BEARING RULE, and the one this table used to break: A
// REGION'S STEP MUST BE THE SIZE OF THE PLAYER'S STEP INTO IT.
//
// The columns rose smoothly — `enemyMult` moved +0.02 a region for thirteen
// regions straight — but the player does not rise smoothly. Crowns compound at
// roughly 1.3x a region and meta/upgrades.js buys cheapest-affordable-first, so
// the two flat combat multipliers (Veterancy on attack, Bulwark on defence)
// arrive in LUMPS about every second region and nothing at all arrives in
// between. Measured off real BattleConfigs, the player's atk x def stepped
// +15.4% into greywater, +14.3% into emberholt, +11.6% into blackspire and
// EXACTLY 0% into highmarch, thornmoor, gallowmoor, thanescar and obsidian.
//
// Those are, one for one, the regions the win-rate curve zigzagged on: at n=96
// greywater won 92% against highmarch's 84%, emberholt 94% against thornmoor's
// 74%, vaelstrand 84% against sunder's 70%. Nothing was wrong with those three
// regions. They were the regions the player walked into holding a freshly
// bought multiplier, and the table handed them +0.02 on the dial like everyone
// else. A +0.02 answer to a +15% player is a region that plays easier than the
// one before it, and a difficulty curve that goes down is a lie on the map.
//
// So the steps below are UNEVEN ON PURPOSE. greywater, emberholt, sunder,
// vaelstrand and blackspire take big ones (a map row, an enemy site, a whole
// castle level); thornmoor, gallowmoor, thanescar and ironcrown take almost
// none. thornmoor's is deliberately the smallest in tier 2 because the player's
// step into it is NEGATIVE: unlocking rams re-spends the expedition at 5 slots
// a body, so the landing force drops from 54 to 48 and the region is harder at
// an unchanged dial. Two of the five columns are only required to be
// NON-DECREASING, not strictly increasing, and that headroom is what pays for
// this — greywater and thornmoor ship the same grid and the same site counts.
// ---------------------------------------------------------------------------
//
// ---------------------------------------------------------------------------
// THE THIRD LOAD-BEARING RULE, and the one this table broke for its whole life:
// THE PLAYER'S STEP INCLUDES THE MECHANICS THE HARNESS ACTUALLY PLAYS.
//
// Every number in this table was once measured against a bot that never bought
// an in-battle site upgrade. tools/simplayer.js issued no UPGRADE command at
// all, so content/balance.js `SITE_LEVELS` and all four `SITE_UPGRADE` steps
// were unexercised by every measurement this project had ever taken — while the
// enemy was handed that same ladder for free at mapgen through `develop` below.
// Levelling was tuned IN for the defender and tuned OUT for the attacker, and
// every win rate the table was built on was a lower bound on real player power.
//
// Switching it on (tools/simplayer.js `upgradeTurn`) moved the campaign +9 to
// +25 points and flattened it to 76-99% at n=96: tier 2 played exactly as easy
// as tier 1. The dial ramp below is the retune that followed. Two things it
// found are worth more than the numbers.
//
// 1. `siteCounts.player` IS A COMPOUNDING LEVER NOW, NOT A FLAT ONE. It was
//    already the biggest entry in this table (+21 points per site, measured on
//    gallowmoor). With the ladder live it is worth more, because every extra
//    site is also another site to BUILD: more starting ground buys more economy,
//    which buys levels, which buy the next site. Tier 2 shipped SEVEN and became
//    unfixable by the dial alone — solved independently, the dial tier 2 needed
//    (emberholt 2.54 for 83%) overtook the dial tier 3 wanted (gallowmoor 2.43
//    for 80%), and `enemyMult` is required to be non-decreasing, so that is a
//    contradiction rather than a tuning problem. Cutting tier 2 to SIX starting
//    sites resolved it, and bought back the battle length the ladder had eaten
//    at the same time: emberholt went 97% / 9.8m to 81% / 11.9m on that one
//    column, against a 16.5m advertised length.
//
// 2. `castleGateFrac` IS NOT A DIFFICULTY KNOB. Swept end to end on emberholt
//    (0.30 -> 0.60) it moved the win rate ONE point and the median half a
//    minute, because this bot already sweeps the countryside when it is winning.
//    It buys the guarantee against a rush strategy, which is what it was added
//    for. It does not buy difficulty, and reaching for it as though it does is
//    how a region ends up re-tuned by a column that was never moving.
//
// The dial below was solved per region by binary search at n=192 and confirmed
// end to end at n=240. Two other levers were measured and REJECTED, which is
// worth recording so the next pass does not re-derive them: a castle promotion
// via `develop` is worth 25-40 points at tiers 3-4 (gallowmoor 90% -> 54% on one
// rung), far too coarse to tune with; and `enemyMult` itself is violently
// non-linear late — gallowmoor loses 31 points over +0.26 and thanescar 43 over
// +0.50, so anything past tier 2 must be moved in steps of 0.05 and re-measured,
// never extrapolated.
//
// THE CURRENT MEASURED CURVE, in campaign order, at n=64 with the band edges
// confirmed at n=240:
//
//     tier 1   89 84 84 84        tier 4   52 34 52 47
//     tier 2   80 70 72 78 72     tier 5   22 23 36    (34 on nightharrow at n=240)
//     tier 3   55 69 53 59 69     tier 6   36 27 19    (21 25 21 at n=240)
//
// TIERS 1-5 ARE BYTE-FOR-BYTE WHAT THEY WERE BEFORE TIER 6 SHIPPED, and that is
// the property the fourth expedition segment exists to guarantee rather than a
// happy result: `EXPEDITION.finalAfter` is 20, which is the conquest count region
// 21 is attacked with, so nothing tier 6 was paid for can reach backwards. The
// tier-6 rows were solved against that.
//
// Every one of the twenty-four reports `ok` against its tier's WIN_BAND and its
// advertised length. Nothing is balance-frozen any more — the expedition re-base
// changed regions 1-5 by construction, so they are solved with the rest.
//
// NOTE THE DIAL RAMP STEEPENED AT TIER 3 (+0.21 a region against tier 4's
// +0.08), and that is the second load-bearing rule doing its job rather than an
// inconsistency. `EXPEDITION.perRegionSurge` hands the player +23 slots a region
// from region 10 on, which is a far bigger step than the +11 before it, so the
// dial has to climb faster there simply to stand still. Measured before the
// ramp was re-cut, tier 3 ran 23 / 29 / 42 / 60 / 79 across five regions on a
// +0.16 ramp — a 56-point slope inside a 22-point band, entirely because the
// player outgrew it region by region.
// ---------------------------------------------------------------------------

/** Battle hard cap per tier, in minutes. A backstop, not a timer you play
 *  against — each sits well above its tier's targetLengthMin. */
export const HARD_CAP_MIN_BY_TIER = [12, 14, 17, 20, 24, 28];
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
 *
 * TIER 6 REPEATS IT AGAIN, for the same reason tier 5 did. What separates tier 6
 * is the commander (content/ai.data.js `AI_TIERS[5]`), the ground, and the
 * SECOND BANNER below — none of which is a cliff.
 */
export const ENEMY_UNITS_BY_TIER = Object.freeze([
  ['militia', 'spearmen'],
  ['militia', 'spearmen', 'raiders'],
  ['militia', 'spearmen', 'raiders', 'rams'],
  ['militia', 'spearmen', 'raiders', 'rams', 'marshal'],
  ['militia', 'spearmen', 'raiders', 'rams', 'marshal'],
  ['militia', 'spearmen', 'raiders', 'rams', 'marshal'],
]);

/**
 * HOW MANY MARSHALS THE ENEMY IS GRANTED, by tier — the throne first, then its
 * best-defended stronghold (meta/modifiers.js `withEnemyMarshal`).
 *
 * Tiers 4 and 5 read 1, which is exactly what they already shipped, so this
 * table changes nothing about a region that was measured before it existed
 * (tests/enemymarshal.js pins that as a negative control).
 *
 * Tier 6 gets TWO, and the second one is the tier's step rather than a new unit.
 * `banner` is stack-local (battle/combat.js), so a marshal is worth +25% to the
 * comp he is standing in and nothing to any other — one in the throne defends
 * the win condition, and a second in a wall makes one line of the countryside
 * genuinely expensive instead of making everything slightly harder. That is a
 * step the per-region dial can absorb (measured: it costs 4-9 points, the same
 * order as granting the first one cost tier 4) and it lands where the flavour
 * has always said it does: their surviving warlords take the field.
 *
 * `maxPerSite` (battle/training.js) is 1 and still binds, so a count larger than
 * the number of eligible sites simply grants fewer — never two in one garrison,
 * where the second would be worth literally nothing.
 */
export const ENEMY_MARSHALS_BY_TIER = Object.freeze([0, 0, 0, 1, 1, 2]);

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

/**
 * THE ROW BUILDER. Lives here rather than in ./regions.data.js because every
 * line of it is a statement about EVERY region — the two clamps above, and the
 * hard cap being derived rather than authored — which is this file's job, and
 * because that file needs its budget for the table.
 *
 * id, name, tier, hex, adjacentTo, enemyMult, cols, rows, [enemy,neutral,player],
 * develop, castleGateFrac, rewardPerSec, targetLengthMin, flavour
 */
export const T = (id, name, tier, hex, adjacentTo, enemyMult, cols, rows, siteCounts,
  develop, castleGateFrac, rewardPerSec, targetLengthMin, flavour) => ({
  id, name, tier, hex, adjacentTo, enemyMult,
  grid: { cols, rows },
  siteCounts: { enemy: siteCounts[0], neutral: siteCounts[1], player: siteCounts[2] },
  develop: DEVELOP_CLAMP(develop),
  castleGateFrac: GATE_CLAMP(castleGateFrac),
  rewardPerSec, targetLengthMin, flavour,
  hardCapMs: Math.round(
    Math.max(HARD_CAP_MIN_BY_TIER[tier - 1], targetLengthMin * HARD_CAP_RATIO) * 60 * 1000,
  ),
  startsUnlocked: false,
});
