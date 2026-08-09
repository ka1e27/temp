// The campaign: 21 region hexes in 5 tiers (4 / 5 / 5 / 4 / 3), adjacency-gated.
// PURE DATA. No logic reads a number that is not defined here or in balance.js.
//
// The load-bearing rule of this table: MAP SIZE, SITE COUNT AND DEVELOPMENT
// SCALE TOGETHER WITH THE DIAL. A tier-5 region is a bigger war — 19x15, 44
// sites, enemy country already built up the SITE_LEVELS ladder — not a tier-1
// fight with inflated numbers. If you raise `enemyMult` without also raising
// `grid`, `siteCounts` and `develop`, you have made the game worse.
//
// The five columns that must never go backwards down this table are
// `enemyMult`, `grid` area, `siteCounts.enemy`, `siteCounts.player` and
// `develop`. tests/campaign.test.js asserts every one of them off REGIONS, so a
// twenty-second region cannot ship untested the way regions 6-18 did. That has
// already paid for itself: the tier-5 rows below were caught and re-shaped by
// those assertions before they were ever played.
//
// `targetLengthMin` is NOT one of them, and that is measured rather than
// chosen: see the tier-3 and tier-4 headers below. It is measured over WINS —
// how long it takes to TAKE the region, which is what the world map is claiming
// — and NOT over all runs, which past the 50% mark measures how fast you die
// instead. tools/simrunner.js documents the difference with numbers.
//
// `hex` places the region on the world map; `adjacentTo` must be exactly its
// true hex neighbours among the shipped set (tests/modifiers asserts this).
//
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
// THE CURRENT MEASURED CURVE, in campaign order. Tiers 1-4 at n=96, tier 5
// confirmed at n=240 (it is the tier whose band edges are closest, and the dial
// is at its most non-linear there — ravensmarch lost 22 points over +0.10):
//
//     tier 1   88 84 84 86        tier 4   46 45 52 45
//     tier 2   81 75 66 76 80     tier 5   38 30 27
//     tier 3   64 65 71 55 57
//
// Every one of the twenty-one reports `ok` against its tier's WIN_BAND and its
// advertised length. Nothing is balance-frozen any more — the expedition re-base
// changed regions 1-5 by construction, so they are solved with the rest.
// ---------------------------------------------------------------------------

/**
 * The campaign-wide RULES — raid economics, enemy scaling, opening garrisons —
 * live in ./regions.rules.js and are re-exported here, so this file stays the
 * one front door for the campaign and every existing
 * `import { RAID } from '../content/regions.data.js'` keeps working. Same shape
 * as content/balance.js re-exporting ./ai.data.js.
 *
 * `HARD_CAP_MIN_BY_TIER`, `HARD_CAP_RATIO` and the two clamps are additionally
 * IMPORTED below, because `T()` reads them to derive each row. What a `develop`
 * and a `castleGateFrac` MEAN is documented at `DEVELOP_CLAMP` / `GATE_CLAMP`
 * over there — they are statements about every region, which is that file's job.
 */
export {
  HARD_CAP_MIN_BY_TIER, HARD_CAP_RATIO, RAID, FIRST_CLEAR_BONUS_SECONDS,
  ENEMY_SCALING, ENEMY_UNITS_BY_TIER, BASE_GARRISON, NEUTRAL_GARRISON,
  PLAYER_SITE_GARRISON, BATTLE_START, FALLBACK_MAP, DEVELOP_CLAMP, GATE_CLAMP,
} from './regions.rules.js';
import {
  HARD_CAP_MIN_BY_TIER, HARD_CAP_RATIO, DEVELOP_CLAMP, GATE_CLAMP,
} from './regions.rules.js';

// id, name, tier, hex, adjacentTo, enemyMult, cols, rows, [enemy,neutral,player],
// develop, castleGateFrac, rewardPerSec, targetLengthMin, flavour
const T = (id, name, tier, hex, adjacentTo, enemyMult, cols, rows, siteCounts,
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

/** @type {ReadonlyArray<object>} */
export const REGIONS = Object.freeze([
  // --- Tier 1 (4) -- the vertical slice. These five rows are balance-frozen. ---
  T('riverfen', 'Riverfen', 1, [0, 0], ['ashford', 'ironwood'],
    1.27, 11, 9, [5, 3, 3], 1, 0, 1, 8,
    'Flooded lowlands: two neutral farms sit in the open and the enemy is slow to claim them.'),
  T('ashford', 'Ashford Downs', 1, [1, 0], ['riverfen', 'ironwood', 'saltmere', 'kaldan', 'highmarch'],
    1.91, 12, 9, [6, 3, 3], 1, 0, 1.2, 10,
    'Open chalk downs with almost no cover — a fast raid arrives before the wall does.'),
  T('ironwood', 'Ironwood', 1, [0, 1], ['riverfen', 'ashford', 'saltmere', 'emberholt'],
    2.26, 13, 10, [7, 3, 4], 1, 0, 1.5, 12,
    'Dense timber and single-file passes: chokepoints turn every push into a committed one.'),
  T('saltmere', 'Saltmere', 1, [1, 1],
    ['ashford', 'ironwood', 'kaldan', 'greywater', 'thornmoor', 'emberholt'],
    2.74, 13, 10, [8, 4, 4], 1, 0, 1.8, 13,
    'A salt lagoon splits the field; whoever holds the causeway strongholds holds the region.'),

  // --- Tier 2 (5) -- the first real wall. Kaldan proves the upgrade layer matters. ---
  T('kaldan', 'Kaldan Reach', 2, [2, 0],
    ['ashford', 'saltmere', 'highmarch', 'greywater', 'vaelstrand', 'sunder'],
    2.75, 15, 11, [9, 4, 5], 1, 0, 4, 14,
    'The enemy opens with twelve sites and a real economy. Come with an army or come back later.'),
  T('highmarch', 'Highmarch', 2, [2, -1], ['ashford', 'kaldan', 'sunder'],
    2.76, 15, 11, [9, 4, 6], 1.35, 0.15, 5.5, 15,
    'Terraced highland: the castle sits behind two stronghold gates and nothing flanks it.'),
  T('greywater', 'Greywater Fen', 2, [2, 1],
    ['saltmere', 'kaldan', 'thornmoor', 'karrowmere', 'duskfell', 'vaelstrand'],
    2.77, 15, 12, [10, 5, 6], 1.5, 0.2, 6.6, 15.5,
    'Marsh crossings everywhere and walls nowhere — the widest front line in the campaign.'),
  T('thornmoor', 'Thornmoor', 2, [1, 2],
    ['saltmere', 'greywater', 'emberholt', 'karrowmere', 'gallowmoor'],
    2.79, 15, 12, [11, 5, 6], 1.7, 0.25, 7.9, 16,
    'Bramble country: five neutral farms make the opening land grab the whole battle.'),
  T('emberholt', 'Emberholt', 2, [0, 2], ['ironwood', 'saltmere', 'thornmoor', 'gallowmoor'],
    2.88, 16, 12, [11, 5, 6], 1.7, 0.3, 9.5, 16.5,
    'Ash plains where the enemy trains raiders first. Bring spears or lose your farms by 2:00.'),

  // --- Tier 3 (5) -- 16x12 to 17x13, ~7.5-8 min. Sieges are the conversation. ---
  //
  // THE TIER BOUNDARY IS THE ONE STEP THE DIAL CANNOT UNDO. Every column here
  // is required to be non-decreasing, so the first region of a tier can never
  // be tuned EASIER than the last region of the tier before it — whatever the
  // AI ladder adds at the boundary is a floor on the drop. Counter-training
  // used to arrive here as a BOOLEAN worth 17 points on gallowmoor and 32 on
  // karrowmere (content/ai.data.js `counterShare`), which left one choice:
  // leave tier 2 a walkover, or push tier 3 under the harness floor. It did
  // the first, and emberholt shipped at 94%. As a per-tier share the boundary
  // costs about nine points, which the columns below absorb.
  //
  // The other half of the answer is `siteCounts.player`, and it is the biggest
  // lever in this table: gallowmoor measured +21 points per extra starting
  // site at n=96. Tier 3 lands with eleven and tier 4 with thirteen, which is
  // what pays for meeting a smarter commander — the empire behind you IS the
  // answer to the endgame, and it should be visible on the map at tick zero.
  //
  // The advertised length still DROPS here, from tier 2's 14-16.5 minutes, and
  // that is measured rather than authored: the previous pass tried raising
  // enemyMult, developing the enemy's country, garrisoning the throne, growing
  // the map to 26 enemy sites on a 21x15 grid and tapering the expedition, and
  // NONE of it moved a clean win past ten minutes, for a reason none of those
  // levers touch — victory is capture-castle, and sites off the direct path to
  // the throne were never fought over. A bigger map does not make a longer
  // battle when the player can walk past most of it.
  //
  // `castleGateFrac` (see the comment above GATE_CLAMP) is the fix: the throne
  // cannot fall below that fraction of the region's OTHER sites in play hands,
  // so a clean win now costs real conquest of the countryside, not just the
  // shortest road to the capital. Measured at n=240 with the gate live, every
  // tier-3 region still resolves in the neighbourhood of 7-8.5 minutes for a
  // scripted player who already sweeps broadly when winning — the throne
  // itself was never the long pole, the countryside always was, and this bot
  // already goes and gets it. What the gate buys is the GUARANTEE: a rush
  // strategy that skips the countryside now finds the castle sealed instead of
  // an early win, and the regions the mechanism was built to fix (blackspire,
  // ironcrown, obsidian below) gained 1.2-2.0 real minutes at matched n.
  // These numbers say what the regions do; see tests/world.test.js ("map size,
  // site count and battle length scale together across tiers") for why the
  // campaign-wide monotonic length claim is still NOT restored here.
  T('gallowmoor', 'Gallowmoor', 3, [0, 3], ['emberholt', 'thornmoor'],
    2.95, 16, 12, [12, 5, 11], 1.8, 0.55, 11.4, 7,
    'A dead-end moor: one approach, three strongholds stacked along it, no way around.'),
  T('sunder', 'The Sunder', 3, [3, -1], ['highmarch', 'kaldan', 'vaelstrand', 'blackspire'],
    3.15, 16, 12, [12, 5, 11], 1.92, 0.58, 13.7, 7,
    'A canyon rift halves the map; both castles are reachable only through the two bridges.'),
  T('vaelstrand', 'Vaelstrand', 3, [3, 0],
    ['kaldan', 'greywater', 'sunder', 'duskfell', 'ironcrown', 'blackspire'],
    3.16, 17, 13, [13, 5, 11], 2, 0.6, 16.4, 7,
    'Coastal sprawl with the richest farm belt in the game — starve it and the castle falls itself.'),
  T('duskfell', 'Duskfell', 3, [3, 1],
    ['greywater', 'karrowmere', 'vaelstrand', 'thanescar', 'ironcrown', 'obsidian'],
    3.38, 17, 13, [13, 5, 11], 2.05, 0.62, 19.7, 8.5,
    'The enemy counter-trains here for the first time. Whatever you spam, it answers within a minute.'),
  T('karrowmere', 'Karrowmere', 3, [2, 2], ['thornmoor', 'greywater', 'duskfell', 'thanescar'],
    3.57, 17, 13, [14, 6, 12], 2.08, 0.65, 23.6, 8.5,
    'Ringed hill fort: every enemy stronghold is upgraded, so token forces bounce off the walls.'),

  // --- Tier 4 (4) -- 17x13, 33-37 sites, ~7 min, develop 2.20-2.52.
  // The endgame: the enemy's country is built, its throne is a capital with an
  // army in it, it fields rams, a marshal and three concurrent attacks, AND its
  // castle is gated behind the deepest territory requirement in the campaign
  // (0.65-0.72). A player who reaches the throne early sees it stay sealed
  // (screens/battle-panel.js says so) until enough of the endgame map has
  // actually changed hands.
  //
  // `develop` READS LOWER here than it used to (2.20-2.52 against 2.35-2.95)
  // and the endgame is nonetheless harder, because the number was never the
  // point — where its rounding boundaries fall is (see DEVELOP_CLAMP above).
  // Thanescar is where the enemy castle first reaches level 3, and that single
  // promotion is worth more than the whole 2.52-to-2.95 stretch it replaces.
  // `enemyMult` carries the rest, which is why it reads 3.0+ here: the dial is
  // the advertised difficulty and it should say what the region costs.
  //
  // Obsidian lands with SIXTEEN starting sites, three more than ironcrown. It
  // is the one place the enemy site count has to cross 15 (tests/campaign.test
  // pins the last region at three times the first), and 15 is where
  // MAPGEN.enemyStrongholdShare rounds up a fifth stronghold — a step worth
  // ~25 points on its own. The landing force is what pays for it. ---
  T('thanescar', 'Thanescar', 4, [3, 2], ['karrowmere', 'duskfell', 'obsidian'],
    3.75, 17, 13, [14, 6, 13], 2.2, 0.65, 28.4, 6.5,
    'Sixteen enemy sites and two concurrent attacks. You will lose ground somewhere; choose where.'),
  T('blackspire', 'Blackspire', 4, [4, -1], ['sunder', 'vaelstrand', 'ironcrown', 'ravensmarch'],
    3.81, 17, 13, [14, 6, 13], 2.45, 0.68, 34, 7.5,
    'A vertical fortress region: rams are not optional, and the enemy brings its own.'),
  T('ironcrown', 'Ironcrown', 4, [4, 0],
    ['vaelstrand', 'duskfell', 'blackspire', 'obsidian', 'ravensmarch', 'gravenreach'],
    3.9, 17, 13, [14, 6, 13], 2.48, 0.7, 40.8, 7.5,
    'A Marshal holds the throne: the castle guard fights 25% harder and trains 40% faster.'),
  T('obsidian', 'The Obsidian Throne', 4, [4, 1],
    ['ironcrown', 'duskfell', 'thanescar', 'gravenreach', 'nightharrow'],
    4, 17, 13, [15, 6, 16], 2.52, 0.72, 49, 8.5,
    'Nineteen sites, three fronts, and a castle that retreats rather than feeds you. Their capital.'),

  // --- Tier 5 (3) -- the enemy's homeland, east of the throne. ---
  //
  // The campaign used to END at a capital, which is a strange place for a war
  // to stop: taking the enemy's capital is the moment you find out how much
  // country is behind it. These three are that country, and they are the first
  // ground in the game the enemy has ever had to defend rather than hold.
  //
  // WHAT MAKES TIER 5 HARD IS NOT A NEW UNIT. The roster runs out at tier 4
  // (regions.rules.js ENEMY_UNITS_BY_TIER repeats itself here, on purpose — a
  // tier whose identity is a new unit is a tier that cannot be tuned, because a
  // unit is a cliff and the dial is a slope). Three things carry it instead:
  //
  //   1. THE COMMANDER. AI_TIERS[4] is the first that thinks more than once a
  //      second, commits on a margin under 1.10, and runs FOUR simultaneous
  //      attacks. `concurrent` is the knob the player feels, because the answer
  //      to two threats is to shuttle one relief force and the answer to four
  //      is that there is no such thing as a reserve.
  //   2. THE GROUND. `develop` finally crosses into level-4 walls on
  //      nightharrow, which is the single largest step in this column and is
  //      deliberately spent on the LAST region rather than the tier opener (see
  //      DEVELOP_CLAMP: a castle promotion is 25-40 points, so it is a finale,
  //      not a ramp). 18x14 and 19x15 are the biggest maps in the campaign.
  //   3. THE MARSHAL IN THE THRONE, which by tier 5 is standing on a level-4
  //      castle: +25% to the garrison defending the win condition and +40% to
  //      the rate it refills. Measured at n=96, granting it cost tier 4 between
  //      1 and 8 points — that is the size of this half of the step, and it is
  //      already paid for by the time a player arrives here.
  //
  // `castleGateFrac` runs 0.74-0.80 and is NOT doing the work (it is worth
  // about a point — see the note above tier 3). It is here so the last three
  // regions cannot be rushed, which is the guarantee it was added for.
  //
  // The band is WIN_BAND[4] = [22, 42]: these are meant to cost a good player
  // several attempts. Measured at n=240, in campaign order: see CLAUDE.md.
  T('ravensmarch', 'Ravensmarch', 5, [5, -1], ['blackspire', 'ironcrown', 'gravenreach'],
    4.12, 18, 13, [16, 6, 17], 2.6, 0.74, 61, 8,
    'Past the throne the road keeps going. Four attacks at once, and no reserve that answers all of them.'),
  T('gravenreach', 'Gravenreach', 5, [5, 0],
    ['ironcrown', 'obsidian', 'ravensmarch', 'nightharrow'],
    4.42, 18, 14, [17, 6, 19], 2.8, 0.77, 76, 8.5,
    'Every wall here is built and manned. Half the enemy yards retrain to answer whatever you brought.'),
  T('nightharrow', 'Nightharrow', 5, [5, 1], ['obsidian', 'gravenreach'],
    4.56, 19, 15, [18, 7, 23], 3.1, 0.8, 95, 9,
    'The last of them, behind level-four walls with a Marshal on the gate. Bring engines and bring time.'),
]);

// Riverfen is the only region reachable with an empire of zero.
REGIONS[0].startsUnlocked = true;
for (const r of REGIONS) Object.freeze(r);

/** @type {Record<string, object>} */
export const REGION_BY_ID = Object.freeze(
  Object.fromEntries(REGIONS.map((r) => [r.id, r])),
);

export const REGION_IDS = Object.freeze(REGIONS.map((r) => r.id));

/** Total sites a region generates, used by mapgen and by the results screen. */
export const totalSites = (region) =>
  region.siteCounts.enemy + region.siteCounts.neutral + region.siteCounts.player;

/** Income at 100% conquest, for balance sanity checks. 508/s: the first
 *  eighteen regions pay 276 and tier 5 adds 232.
 *
 *  That 276 is itself load-bearing and unchanged. The tail was re-spread onto a
 *  smooth x1.2-a-region ramp (the old table stepped 1.8 -> 4.0 -> 13.0 -> 38.0
 *  at the tier boundaries, and the first region of every tier was therefore the
 *  hardest in the campaign, because it met a new AI tier before the income that
 *  pays for the answer to it) with the total deliberately held constant.
 *
 *  Tier 5 continues the same x1.24-1.25 ramp rather than stepping, which is why
 *  it nearly doubles the figure: eighteen regions of compounding is most of the
 *  curve, and three more at the same rate is the rest of it. Nothing reads this
 *  total as a budget — `meta/rewards.js` `raidLump` is denominated in seconds of
 *  EMPIRE income, so raids stay stage-invariant however large it gets. */
export const fullConquestIncome = () =>
  REGIONS.reduce((a, r) => a + r.rewardPerSec, 0);
