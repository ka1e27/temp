// The campaign: 24 region hexes in 6 tiers (4 / 5 / 5 / 4 / 3 / 3), adjacency-gated.
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
// THE TWO OTHER LOAD-BEARING RULES THIS TABLE OBEYS — that a region's step must
// be the size of the PLAYER'S step into it, and that the player's step includes
// the mechanics the harness actually plays — are stated in full in
// ./regions.rules.js, with the measurements behind them. They moved there when
// tier 6 needed the budget, and they belong there: both are claims about every
// row rather than about any one of them, which is that file's job.

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
  ENEMY_SCALING, ENEMY_UNITS_BY_TIER, ENEMY_MARSHALS_BY_TIER, BASE_GARRISON,
  NEUTRAL_GARRISON, PLAYER_SITE_GARRISON, BATTLE_START, FALLBACK_MAP,
  DEVELOP_CLAMP, GATE_CLAMP,
} from './regions.rules.js';

// The row builder lives in ./regions.rowbuilder.js — one file further out than
// the two clamps it applies, because authoring the enemy's site MIX needed
// room neither this file nor regions.rules.js could spare. The column order,
// and what changed about `siteCounts`, is documented at `T`.
import { T } from './regions.rowbuilder.js';

/** @type {ReadonlyArray<object>} */
export const REGIONS = Object.freeze([
  // --- Tier 1 (4) -- the vertical slice. These five rows are balance-frozen. ---
  T('riverfen', 'Riverfen', 1, [0, 0], ['ashford', 'ironwood'],
    2.02, 11, 9, [[1, 1, 2], 3, 3], 1, 0, 1, 10,
    'Flooded lowlands: two neutral farms sit in the open and the enemy is slow to claim them.'),
  T('ashford', 'Ashford Downs', 1, [1, 0], ['riverfen', 'ironwood', 'saltmere', 'kaldan', 'highmarch'],
    2.8, 12, 9, [[1, 1, 3], 3, 3], 1, 0, 1.2, 10.5,
    'Open chalk downs with almost no cover — a fast raid arrives before the wall does.'),
  T('ironwood', 'Ironwood', 1, [0, 1], ['riverfen', 'ashford', 'saltmere', 'emberholt'],
    3.13, 13, 10, [[1, 2, 3], 4, 3], 1, 0, 1.5, 9,
    'Dense timber and single-file passes: chokepoints turn every push into a committed one.',
    'choke'),
  T('saltmere', 'Saltmere', 1, [1, 1],
    ['ashford', 'ironwood', 'kaldan', 'greywater', 'thornmoor', 'emberholt'],
    3.25, 13, 10, [[1, 2, 4], 4, 4], 1, 0, 1.8, 7,
    'A salt lagoon splits the field; whoever holds the causeway strongholds holds the region.',
    'split'),

  // --- Tier 2 (5) -- the first real wall. Kaldan proves the upgrade layer matters. ---
  T('kaldan', 'Kaldan Reach', 2, [2, 0],
    ['ashford', 'saltmere', 'highmarch', 'greywater', 'vaelstrand', 'sunder'],
    3.34, 15, 11, [[1, 3, 4], 5, 4], 1, 0, 4, 9,
    'The enemy opens with twelve sites and a real economy. Come with an army or come back later.'),
  T('highmarch', 'Highmarch', 2, [2, -1], ['ashford', 'kaldan', 'sunder'],
    3.34, 15, 11, [[1, 3, 6], 5, 4], 1.0, 0.15, 5.5, 8,
    'Terraced highland: the castle sits behind two stronghold gates and nothing flanks it.',
    'choke'),
  T('greywater', 'Greywater Fen', 2, [2, 1],
    ['saltmere', 'kaldan', 'thornmoor', 'karrowmere', 'duskfell', 'vaelstrand'],
    3.34, 15, 12, [[1, 3, 6], 7, 4], 1.0, 0.2, 6.6, 7,
    'Marsh crossings everywhere and walls nowhere — the widest front line in the campaign.'),
  T('thornmoor', 'Thornmoor', 2, [1, 2],
    ['saltmere', 'greywater', 'emberholt', 'karrowmere', 'gallowmoor'],
    3.34, 15, 12, [[2, 3, 6], 7, 4], 1.0, 0.25, 7.9, 6.5,
    'Bramble country: five neutral farms make the opening land grab the whole battle.',
    'branch'),
  T('emberholt', 'Emberholt', 2, [0, 2], ['ironwood', 'saltmere', 'thornmoor', 'gallowmoor'],
    3.55, 16, 12, [[3, 5, 8], 7, 4], 1.0, 0.3, 9.5, 7.5,
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
  // `siteCounts.player` IS THE BIGGEST LEVER IN THIS TABLE AND IT IS NO LONGER
  // WHAT PAYS FOR A TIER. It measured +21 points per extra starting site on
  // gallowmoor, so every pass that needed a region easier reached for it, and
  // nothing asserted where that ended up: the player was starting tier 5
  // holding 44-48% of the board against the enemy's 38-41% — on nightharrow,
  // twenty-three sites to the enemy's eighteen, in the deepest region of the
  // enemy's own homeland. The campaign's premise is that you are RAIDING
  // country the enemy holds outright, and the raid stopped being a raid exactly
  // where it was meant to be hardest. Every difficulty number passed, because
  // difficulty was measured and ownership never was.
  //
  // The column is now a flat raider's share (~27%) the whole way down and
  // tests/campaign.test.js pins it, ceiling and creep both. What replaced it as
  // the answer to a harder tier is the EXPEDITION (balance.js
  // `perRegionLate` 5 -> 11, which by construction cannot touch regions 1-5)
  // and the enemy's WARM-UP (ai.data.js `AI_TIERS[].warmupSec`, 90s at tiers
  // 1-2 rising to 225s at tier 5). The empire behind you buys an ARMY and the
  // time to land it, not a province the map hands you before the battle starts.
  // The ground it used to hand you is NEUTRAL now: still there, still takeable,
  // just no longer free.
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
    4, 16, 12, [[3, 4, 9], 12, 4], 1.8, 0.55, 11.4, 7,
    'A dead-end moor: one approach, three strongholds stacked along it, no way around.',
    'narrow'),
  T('sunder', 'The Sunder', 3, [3, -1], ['highmarch', 'kaldan', 'vaelstrand', 'blackspire'],
    4, 16, 12, [[3, 4, 9], 12, 4], 1.8, 0.56, 13.7, 5.5,
    'A canyon rift halves the map; both castles are reachable only through the two bridges.',
    'split'),
  T('vaelstrand', 'Vaelstrand', 3, [3, 0],
    ['kaldan', 'greywater', 'sunder', 'duskfell', 'ironcrown', 'blackspire'],
    4.39, 17, 13, [[3, 4, 10], 12, 4], 1.8, 0.57, 16.4, 5.5,
    'Coastal sprawl with the richest farm belt in the game — starve it and the castle falls itself.'),
  T('duskfell', 'Duskfell', 3, [3, 1],
    ['greywater', 'karrowmere', 'vaelstrand', 'thanescar', 'ironcrown', 'obsidian'],
    4.39, 17, 13, [[3, 4, 10], 12, 4], 1.8, 0.58, 19.7, 5,
    'The enemy counter-trains here for the first time. Whatever you spam, it answers within a minute.',
    'branch'),
  T('karrowmere', 'Karrowmere', 3, [2, 2], ['thornmoor', 'greywater', 'duskfell', 'thanescar'],
    4.39, 17, 13, [[3, 4, 11], 14, 4], 1.85, 0.59, 23.6, 4.5,
    'Ringed hill fort: every enemy stronghold is upgraded, so token forces bounce off the walls.',
    'choke'),

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
    4.78, 17, 13, [[3, 4, 12], 15, 4], 2.2, 0.6, 28.4, 7,
    'Sixteen enemy sites and two concurrent attacks. You will lose ground somewhere; choose where.',
    'branch'),
  T('blackspire', 'Blackspire', 4, [4, -1], ['sunder', 'vaelstrand', 'ironcrown', 'ravensmarch'],
    4.78, 17, 13, [[3, 4, 13], 15, 4], 2.2, 0.6, 34, 7,
    'A vertical fortress region: rams are not optional, and the enemy brings its own.',
    'choke'),
  T('ironcrown', 'Ironcrown', 4, [4, 0],
    ['vaelstrand', 'duskfell', 'blackspire', 'obsidian', 'ravensmarch', 'gravenreach'],
    4.88, 17, 13, [[3, 4, 13], 15, 4], 2.2, 0.6, 40.8, 6.5,
    'A Marshal holds the throne: the castle guard fights 25% harder and trains 40% faster.',
    'choke'),
  T('obsidian', 'The Obsidian Throne', 4, [4, 1],
    ['ironcrown', 'duskfell', 'thanescar', 'gravenreach', 'nightharrow'],
    4.88, 17, 13, [[3, 4, 14], 20, 4], 2.2, 0.6, 49, 8.5,
    'Nineteen sites, three fronts, and a castle that retreats rather than feeds you. Their capital.',
    'branch'),

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
  T('ravensmarch', 'Ravensmarch', 5, [5, -1], ['blackspire', 'ironcrown', 'gravenreach', 'stormhalt'],
    4.88, 18, 13, [[3, 4, 15], 20, 4], 2.3, 0.6, 61, 8,
    'Past the throne the road keeps going. Four attacks at once, and no reserve that answers all of them.',
    'branch'),
  T('gravenreach', 'Gravenreach', 5, [5, 0],
    ['ironcrown', 'obsidian', 'ravensmarch', 'nightharrow', 'stormhalt', 'cinderwatch'],
    4.88, 18, 14, [[3, 4, 16], 22, 4], 2.6, 0.6, 76, 7.5,
    'Every wall here is built and manned. Half the enemy yards retrain to answer whatever you brought.',
    'split'),
  T('nightharrow', 'Nightharrow', 5, [5, 1], ['obsidian', 'gravenreach', 'cinderwatch', 'widowsgate'],
    5.27, 19, 15, [[3, 5, 19], 27, 5], 3.05, 0.6, 95, 10.5,
    'The last of them, behind level-four walls with a Marshal on the gate. Bring engines and bring time.',
    'choke'),

  // --- Tier 6 (3) -- what is left when there is nothing left to hold. ---
  //
  // Tier 5 was the enemy's homeland. This is the coast behind it, and the
  // premise of the tier is the one thing the campaign had never shown: an enemy
  // that has already lost. It does not surrender and it does not field anything
  // new — it digs into ground it has burned itself, and the two commanders who
  // survived the homeland take the field in person.
  //
  // WHAT CARRIES IT IS THE SAME THREE THINGS THAT CARRIED TIER 5, for the same
  // reason: the roster is exhausted, and a tier whose identity is a new unit is
  // a tier that cannot be tuned, because a unit is a cliff and the dial is a
  // slope. So:
  //
  //   1. THE COMMANDER. `AI_TIERS[5]` — five simultaneous attacks against tier
  //      5's four, and the first commander in the game that will commit on a
  //      margin under 1.0, i.e. that trades down on purpose to keep a fifth
  //      front alive. `concurrent` is the knob the player feels: the answer to
  //      four threats is that there is no reserve, and the answer to five is
  //      that a front you are winning gets taken back while you are elsewhere.
  //   2. THE GROUND. 20x15 and 21x16 are the biggest boards in the game, and
  //      `develop` reaches the rung where the CASTLE promotes to level 4 on the
  //      tier OPENER rather than the finale — 3.1 is the first value that lands
  //      it (see DEVELOP_CLAMP). MEASURED AT n=96 THAT ONE RUNG IS WORTH ABOUT
  //      TWENTY POINTS here: stormhalt read 46% at develop 2.9 / dial 4.41 and
  //      26% at develop 3.1 / dial 4.37. It is spent on the opener deliberately,
  //      because the opener is also where the player takes the biggest step they
  //      will ever take (`EXPEDITION.finalBonus`, +60 slots), and rule 2 of this
  //      table is that a region's step must be the size of the player's step
  //      into it. The dial then has almost nowhere to go inside the tier — 4.37
  //      to 4.48 across three regions — which is the whole reason the ground
  //      carries this tier and not the dial.
  //   3. THE SECOND BANNER. `ENEMY_MARSHALS_BY_TIER` grants two rather than one,
  //      the second into the best-defended stronghold. It is worth 4-9 points —
  //      the same order as granting the first one cost tier 4 — because `banner`
  //      is stack-local: it makes ONE line of the countryside genuinely
  //      expensive rather than making the whole map slightly harder.
  //
  // `castleGateFrac` runs 0.82-0.85 and is still not doing the work (about a
  // point, as everywhere else). 0.85 is the GATE_CLAMP ceiling and the last
  // region sits on it: the final throne cannot be rushed at all.
  //
  // The band is WIN_BAND[5] = [18, 36]. These are the last three regions in the
  // game and they are meant to cost a good player several attempts each, with
  // the incursion ladder (content/incursion.data.js) waiting past them for a
  // player who wants difficulty without end.
  //
  // MEASURED AT n=240, because at this end of the campaign nothing smaller is
  // worth reading: stormhalt reported 16% at n=32, 23% at n=48, 26% at n=96 and
  // 21% at n=240 on settings that differ by less than the noise between those
  // samples. The advertised lengths are the n=240 win medians too — widowsgate
  // read a 16.0m median off an n=48 sample and 9.6m at n=240, so a table tuned on
  // the small sample would have told the player a region takes half again as long
  // as it does.
  T('stormhalt', 'Stormhalt', 6, [6, -1], ['ravensmarch', 'gravenreach', 'cinderwatch'],
    5.3, 20, 15, [[3, 5, 19], 28, 5], 3.1, 0.6, 118, 9,
    'A storm coast fortress fed from the sea. Five attacks at once, and every one of them means it.'),
  T('cinderwatch', 'Cinderwatch', 6, [6, 0],
    ['gravenreach', 'nightharrow', 'stormhalt', 'widowsgate'],
    5.35, 20, 15, [[3, 5, 19], 30, 5], 3.1, 0.6, 147, 7,
    'They burned their own farms rather than leave them standing. Take the ashes and hold them.'),
  T('widowsgate', 'The Widow’s Gate', 6, [6, 1], ['nightharrow', 'cinderwatch'],
    5.4, 21, 16, [[3, 5, 19], 32, 5], 3.1, 0.6, 183, 6.5,
    'The last gate, two banners behind it, and no throne left to retreat to. Finish it.'),
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
