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
// `develop`. tests/campaign.test.js asserts every one off REGIONS, so a
// twenty-second region cannot ship untested the way regions 6-18 did — the
// tier-5 rows below were caught and re-shaped by it before they were played.
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
//
// PER-TIER AND PER-REGION PROVENANCE — why a dial sits where it sits, and what
// measuring it cost — lives in ./regions.provenance.js, moved there for the
// same 400-line cap. It is NOT imported by anything (there is no data in it,
// only reasoning); the short comment above each tier/row here is the
// pointer, not the whole story.

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
    1.82, 11, 9, [[1, 1, 2], 3, 3], 1, 0, 1, 9.5,
    'Flooded lowlands: two neutral farms sit in the open and the enemy is slow to claim them.'),
  T('ashford', 'Ashford Downs', 1, [1, 0], ['riverfen', 'ironwood', 'saltmere', 'kaldan', 'highmarch'],
    2.66, 12, 9, [[1, 1, 3], 3, 3], 1, 0, 1.2, 10,
    'Open chalk downs with almost no cover — a fast raid arrives before the wall does.'),
  T('ironwood', 'Ironwood', 1, [0, 1], ['riverfen', 'ashford', 'saltmere', 'emberholt'],
    3.19, 13, 10, [[1, 2, 3], 5, 3], 1, 0, 1.5, 9.5,
    'Dense timber and single-file passes: chokepoints turn every push into a committed one.',
    'choke'),
  T('saltmere', 'Saltmere', 1, [1, 1],
    ['ashford', 'ironwood', 'kaldan', 'greywater', 'thornmoor', 'emberholt'],
    3.19, 13, 10, [[1, 2, 4], 3, 4], 1, 0, 1.8, 7.5,
    'A salt lagoon splits the field; whoever holds the causeway strongholds holds the region.',
    'split'),

  // --- Tier 2 (5) -- the first real wall. Kaldan proves the upgrade layer
  // matters. `develop` is quantised (highmarch/greywater/thornmoor land on the
  // realised-mean-fort-level boundary, not the raw column) and neutral is a
  // difficulty knob that moves the WRONG way (more neutral reads EASIER, since
  // it is a race the enemy's running economy already wins more of). Full
  // reasoning: ./regions.provenance.js, "TIER 2".
  T('kaldan', 'Kaldan Reach', 2, [2, 0],
    ['ashford', 'saltmere', 'highmarch', 'greywater', 'vaelstrand', 'sunder'],
    3.19, 15, 11, [[1, 3, 4], 5, 4], 1, 0, 4, 8.5,
    'The enemy opens with twelve sites and a real economy. Come with an army or come back later.'),
  T('highmarch', 'Highmarch', 2, [2, -1], ['ashford', 'kaldan', 'sunder'],
    3.32, 15, 12, [[1, 3, 5], 5, 4], 1.2, 0.15, 5.5, 9,
    'Terraced highland: the castle sits behind two stronghold gates and nothing flanks it.',
    'choke'),
  T('greywater', 'Greywater Fen', 2, [2, 1],
    ['saltmere', 'kaldan', 'thornmoor', 'karrowmere', 'duskfell', 'vaelstrand'],
    3.34, 15, 12, [[1, 3, 5], 6, 4], 1.2, 0.2, 6.6, 8,
    'Marsh crossings everywhere and walls nowhere — the widest front line in the campaign.'),
  T('thornmoor', 'Thornmoor', 2, [1, 2],
    ['saltmere', 'greywater', 'emberholt', 'karrowmere', 'gallowmoor'],
    3.45, 15, 12, [[2, 3, 4], 7, 4], 1.25, 0.25, 7.9, 6.5,
    'Bramble country: five neutral farms make the opening land grab the whole battle.',
    'branch'),
  T('emberholt', 'Emberholt', 2, [0, 2], ['ironwood', 'saltmere', 'thornmoor', 'gallowmoor'],
    3.60, 16, 12, [[2, 3, 5], 7, 4], 1.7, 0.3, 9.5, 8,
    'Ash plains where the enemy trains raiders first. Bring spears or lose your farms by 2:00.'),

  // --- Tier 3 (5) -- 16x12 to 17x13. Sieges are the conversation.
  // `siteCounts.player` is the biggest lever in this table and is no longer
  // what pays for a tier (flat ~27% raider's share; the EXPEDITION and the
  // enemy's warm-up pay for the rest instead). `castleGateFrac` is what makes
  // a clean win cost real conquest rather than a beeline to the throne.
  // `targetLengthMin` (20-23m) is raised campaign-wide from here on, off its
  // stale pre-melee-layer 6-8.5m promise — full reasoning and the numbers
  // behind every claim in this paragraph: ./regions.provenance.js, "TIER 3".
  T('gallowmoor', 'Gallowmoor', 3, [0, 3], ['emberholt', 'thornmoor'],
    3.95, 16, 12, [[2, 3, 6], 12, 4], 1.8, 0.55, 11.4, 20,
    'A dead-end moor: one approach, three strongholds stacked along it, no way around.',
    'narrow'),
  T('sunder', 'The Sunder', 3, [3, -1], ['highmarch', 'kaldan', 'vaelstrand', 'blackspire'],
    4.08, 16, 12, [[2, 3, 6], 12, 4], 1.92, 0.56, 13.7, 20,
    'A canyon rift halves the map; both castles are reachable only through the two bridges.',
    'split'),
  T('vaelstrand', 'Vaelstrand', 3, [3, 0],
    ['kaldan', 'greywater', 'sunder', 'duskfell', 'ironcrown', 'blackspire'],
    4.38, 17, 13, [[2, 3, 7], 12, 4], 2, 0.57, 16.4, 20,
    'Coastal sprawl with the richest farm belt in the game — starve it and the castle falls itself.'),
  T('duskfell', 'Duskfell', 3, [3, 1],
    ['greywater', 'karrowmere', 'vaelstrand', 'thanescar', 'ironcrown', 'obsidian'],
    4.45, 17, 13, [[2, 3, 7], 12, 4], 2.05, 0.58, 19.7, 19,
    'The enemy counter-trains here for the first time. Whatever you spam, it answers within a minute.',
    'branch'),
  T('karrowmere', 'Karrowmere', 3, [2, 2], ['thornmoor', 'greywater', 'duskfell', 'thanescar'],
    4.48, 17, 13, [[2, 4, 7], 14, 4], 2.08, 0.59, 23.6, 19,
    'Ringed hill fort: every enemy stronghold is upgraded, so token forces bounce off the walls.',
    'choke'),

  // --- Tier 4 (4) -- 17x13, 33-37 sites, 20-21m (was ~7 before the melee-layer
  // re-tune), develop 2.20-2.52. The endgame: the enemy's country is built,
  // it fields rams, a marshal and three concurrent attacks, and its castle is
  // gated at the campaign's flat 0.60 castleGateFrac ceiling. Thanescar's
  // `develop` (2.45) carries its own frontage correction and its own gap to
  // blackspire; ironcrown's neutral pool (19, against obsidian's 20 on the
  // same dial and mix) is a deliberate difficulty knob, not a stray number.
  // Full reasoning: ./regions.provenance.js, "TIER 4".
  T('thanescar', 'Thanescar', 4, [3, 2], ['karrowmere', 'duskfell', 'obsidian'],
    4.55, 17, 13, [[2, 4, 7], 15, 4], 2.10, 0.6, 28.4, 16,
    'Sixteen enemy sites and two concurrent attacks. You will lose ground somewhere; choose where.',
    'branch'),
  T('blackspire', 'Blackspire', 4, [4, -1], ['sunder', 'vaelstrand', 'ironcrown', 'ravensmarch'],
    4.55, 17, 13, [[2, 4, 7], 15, 4], 2.12, 0.6, 34, 16,
    'A vertical fortress region: rams are not optional, and the enemy brings its own.',
    'choke'),
  T('ironcrown', 'Ironcrown', 4, [4, 0],
    ['vaelstrand', 'duskfell', 'blackspire', 'obsidian', 'ravensmarch', 'gravenreach'],
    4.60, 17, 13, [[2, 4, 7], 19, 4], 2.14, 0.6, 40.8, 16,
    'A Marshal holds the throne: the castle guard fights 25% harder and trains 40% faster.',
    'choke'),
  T('obsidian', 'The Obsidian Throne', 4, [4, 1],
    ['ironcrown', 'duskfell', 'thanescar', 'gravenreach', 'nightharrow'],
    4.60, 17, 13, [[2, 4, 7], 20, 4], 2.16, 0.6, 49, 16,
    'Nineteen sites, three fronts, and a castle that retreats rather than feeds you. Their capital.',
    'branch'),

  // --- Tier 5 (3) -- the enemy's homeland, east of the throne. What makes it
  // hard is not a new unit (the roster is exhausted): a commander running
  // four concurrent attacks, `develop` finally reaching level-4 walls (on
  // nightharrow, the tier finale rather than its opener), and a Marshal
  // standing on that wall. `castleGateFrac` is a flat 0.60 and is NOT doing
  // the work here. Ravensmarch's mix and gravenreach's `develop` cut are
  // both deliberate, cross-checked lever choices, not stray numbers — full
  // reasoning: ./regions.provenance.js, "TIER 5".
  T('ravensmarch', 'Ravensmarch', 5, [5, -1], ['blackspire', 'ironcrown', 'gravenreach', 'stormhalt'],
    4.65, 18, 13, [[2, 5, 8], 18, 4], 2.19, 0.6, 61, 16,
    'Past the throne the road keeps going. Four attacks at once, and no reserve that answers all of them.',
    'branch'),
  T('gravenreach', 'Gravenreach', 5, [5, 0],
    ['ironcrown', 'obsidian', 'ravensmarch', 'nightharrow', 'stormhalt', 'cinderwatch'],
    4.65, 18, 14, [[2, 5, 8], 22, 4], 2.20, 0.6, 76, 17,
    'Every wall here is built and manned. Half the enemy yards retrain to answer whatever you brought.',
    'split'),
  T('nightharrow', 'Nightharrow', 5, [5, 1], ['obsidian', 'gravenreach', 'cinderwatch', 'widowsgate'],
    4.75, 19, 15, [[2, 5, 8], 27, 5], 2.25, 0.6, 95, 18,
    'The last of them, behind level-four walls with a Marshal on the gate. Bring engines and bring time.',
    'choke'),

  // --- Tier 6 (3) -- what is left when there is nothing left to hold. The
  // enemy has already lost and digs in anyway: a commander running five
  // concurrent attacks, the two biggest boards in the game, and a second
  // Marshal in the best-defended stronghold. Stormhalt's `develop` (2.9,
  // rather than the 3.1 that promoted its castle to level 4 on the opener)
  // was walked back in the third re-tune pass after the region measured
  // outright UNWINNABLE against the melee/fog layers — 0 wins in 48 seeded
  // attempts. Full reasoning and the current numbers: ./regions.provenance.js,
  // "TIER 6", and CLAUDE.md ("Still open" -> the campaign re-tune, third pass).
  T('stormhalt', 'Stormhalt', 6, [6, -1], ['ravensmarch', 'gravenreach', 'cinderwatch'],
    4.78, 20, 15, [[2, 5, 9], 28, 5], 2.28, 0.6, 118, 16,
    'A storm coast fortress fed from the sea. Five attacks at once, and every one of them means it.'),
  T('cinderwatch', 'Cinderwatch', 6, [6, 0],
    ['gravenreach', 'nightharrow', 'stormhalt', 'widowsgate'],
    4.85, 20, 15, [[2, 5, 9], 30, 5], 2.30, 0.6, 147, 17,
    'They burned their own farms rather than leave them standing. Take the ashes and hold them.'),
  T('widowsgate', 'The Widow’s Gate', 6, [6, 1], ['nightharrow', 'cinderwatch'],
    4.90, 21, 16, [[3, 5, 9], 32, 5], 2.32, 0.6, 183, 18,
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
