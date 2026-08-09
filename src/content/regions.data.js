// The campaign: 18 region hexes in 4 tiers (4 / 5 / 5 / 4), adjacency-gated.
// PURE DATA. No logic reads a number that is not defined here or in balance.js.
//
// The load-bearing rule of this table: MAP SIZE, SITE COUNT AND DEVELOPMENT
// SCALE TOGETHER WITH THE DIAL. A tier-4 region is a bigger war — 17x13, 36
// sites, enemy country already built up the SITE_LEVELS ladder — not a tier-1
// fight with inflated numbers. If you raise `enemyMult` without also raising
// `grid`, `siteCounts` and `develop`, you have made the game worse.
//
// The five columns that must never go backwards down this table are
// `enemyMult`, `grid` area, `siteCounts.enemy`, `siteCounts.player` and
// `develop`. tests/campaign.test.js asserts every one of them off REGIONS, so a
// nineteenth region cannot ship untested the way regions 6-18 did.
//
// `targetLengthMin` is NOT one of them, and that is measured rather than
// chosen: see the tier-3 and tier-4 headers below.
//
// `hex` places the region on the world map; `adjacentTo` must be exactly its
// true hex neighbours among the shipped set (tests/modifiers asserts this).

/** Battle hard cap per tier, in minutes. A backstop, not a timer you play
 *  against — each sits well above its tier's targetLengthMin. */
export const HARD_CAP_MIN_BY_TIER = [12, 14, 17, 20];
/** The cap is a stall backstop, not a race: 2.2x the advertised length. */
export const HARD_CAP_RATIO = 1.9;

/** Conquered regions re-fight as Raids: a one-time lump, never permanent income. */
export const RAID = Object.freeze({
  cooldownMs: 10 * 60 * 1000,
  harderPerClear: 0.15,   // enemyMult x (1 + this) ^ clears
  richerPerClear: 0.10,   // lump x (1 + this) ^ clears
  lumpSeconds: 600,       // a clean raid pays ~10 minutes of that region's income
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
 */
const DEVELOP_CLAMP = (n) => Math.max(1, Math.min(5, Number(n) || 1));

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
 * castle is supposed to work early. It rises through tiers 2-4 so a tier-3/4
 * clear genuinely requires converting real ground first, not just the shortest
 * path to the throne. Tuned against tools/simrunner.js at n>=96 (n=240 spot
 * check on tiers 3-4): every region stays winnable inside its hard cap.
 */
const GATE_CLAMP = (n) => Math.max(0, Math.min(0.85, Number(n) || 0));

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
    1.00, 11, 9, [5, 3, 3], 1, 0, 1.0, 8,
    'Flooded lowlands: two neutral farms sit in the open and the enemy is slow to claim them.'),
  T('ashford', 'Ashford Downs', 1, [1, 0], ['riverfen', 'ironwood', 'saltmere', 'kaldan', 'highmarch'],
    1.15, 12, 9, [6, 3, 3], 1, 0, 1.2, 10,
    'Open chalk downs with almost no cover — a fast raid arrives before the wall does.'),
  T('ironwood', 'Ironwood', 1, [0, 1], ['riverfen', 'ashford', 'saltmere', 'emberholt'],
    1.30, 13, 10, [7, 3, 4], 1, 0, 1.5, 12,
    'Dense timber and single-file passes: chokepoints turn every push into a committed one.'),
  T('saltmere', 'Saltmere', 1, [1, 1],
    ['ashford', 'ironwood', 'kaldan', 'greywater', 'thornmoor', 'emberholt'],
    1.45, 13, 10, [8, 4, 4], 1, 0, 1.8, 13,
    'A salt lagoon splits the field; whoever holds the causeway strongholds holds the region.'),

  // --- Tier 2 (5) -- the first real wall. Kaldan proves the upgrade layer matters. ---
  T('kaldan', 'Kaldan Reach', 2, [2, 0],
    ['ashford', 'saltmere', 'highmarch', 'greywater', 'vaelstrand', 'sunder'],
    1.85, 15, 11, [9, 4, 5], 1, 0, 4.0, 14,
    'The enemy opens with twelve sites and a real economy. Come with an army or come back later.'),
  T('highmarch', 'Highmarch', 2, [2, -1], ['ashford', 'kaldan', 'sunder'],
    1.98, 15, 11, [9, 4, 7], 1.35, 0.15, 5.5, 15,
    'Terraced highland: the castle sits behind two stronghold gates and nothing flanks it.'),
  T('greywater', 'Greywater Fen', 2, [2, 1],
    ['saltmere', 'kaldan', 'thornmoor', 'karrowmere', 'duskfell', 'vaelstrand'],
    2.00, 15, 11, [10, 5, 7], 1.5, 0.20, 6.6, 15.5,
    'Marsh crossings everywhere and walls nowhere — the widest front line in the campaign.'),
  T('thornmoor', 'Thornmoor', 2, [1, 2],
    ['saltmere', 'greywater', 'emberholt', 'karrowmere', 'gallowmoor'],
    2.02, 15, 12, [11, 5, 7], 1.62, 0.25, 7.9, 16,
    'Bramble country: five neutral farms make the opening land grab the whole battle.'),
  T('emberholt', 'Emberholt', 2, [0, 2], ['ironwood', 'saltmere', 'thornmoor', 'gallowmoor'],
    2.04, 16, 12, [11, 5, 7], 1.72, 0.30, 9.5, 16.5,
    'Ash plains where the enemy trains raiders first. Bring spears or lose your farms by 2:00.'),

  // --- Tier 3 (5) -- ~16x12, ~7-8.5 min. Sieges are the whole conversation now. ---
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
    2.06, 16, 12, [11, 5, 9], 1.75, 0.55, 11.4, 7,
    'A dead-end moor: one approach, three strongholds stacked along it, no way around.'),
  T('sunder', 'The Sunder', 3, [3, -1], ['highmarch', 'kaldan', 'vaelstrand', 'blackspire'],
    2.08, 16, 12, [12, 5, 9], 1.9, 0.58, 13.7, 7,
    'A canyon rift halves the map; both castles are reachable only through the two bridges.'),
  T('vaelstrand', 'Vaelstrand', 3, [3, 0],
    ['kaldan', 'greywater', 'sunder', 'duskfell', 'ironcrown', 'blackspire'],
    2.10, 16, 12, [13, 5, 9], 2.05, 0.60, 16.4, 7,
    'Coastal sprawl with the richest farm belt in the game — starve it and the castle falls itself.'),
  T('duskfell', 'Duskfell', 3, [3, 1],
    ['greywater', 'karrowmere', 'vaelstrand', 'thanescar', 'ironcrown', 'obsidian'],
    2.12, 17, 12, [13, 5, 9], 2.2, 0.62, 19.7, 8.5,
    'The enemy counter-trains here for the first time. Whatever you spam, it answers within a minute.'),
  T('karrowmere', 'Karrowmere', 3, [2, 2], ['thornmoor', 'greywater', 'duskfell', 'thanescar'],
    2.14, 17, 12, [14, 6, 9], 2.35, 0.65, 23.6, 8.5,
    'Ringed hill fort: every enemy stronghold is upgraded, so token forces bounce off the walls.'),

  // --- Tier 4 (4) -- 17x13, 33-36 sites, ~6.5-8.5 min, develop 2.35-2.95.
  // The endgame: the enemy's country is built, its throne is a capital with an
  // army in it, it fields rams, a marshal and three concurrent attacks, AND its
  // castle is gated behind the deepest territory requirement in the campaign
  // (0.65-0.72). A player who reaches the throne early sees it stay sealed
  // (screens/battle-panel.js says so) until enough of the endgame map has
  // actually changed hands. ---
  T('thanescar', 'Thanescar', 4, [3, 2], ['karrowmere', 'duskfell', 'obsidian'],
    2.16, 17, 13, [14, 6, 10], 2.35, 0.65, 28.4, 6.5,
    'Sixteen enemy sites and two concurrent attacks. You will lose ground somewhere; choose where.'),
  T('blackspire', 'Blackspire', 4, [4, -1], ['sunder', 'vaelstrand', 'ironcrown'],
    2.30, 17, 13, [15, 6, 11], 2.45, 0.68, 34.0, 7.5,
    'A vertical fortress region: rams are not optional, and the enemy brings its own.'),
  T('ironcrown', 'Ironcrown', 4, [4, 0], ['vaelstrand', 'duskfell', 'blackspire', 'obsidian'],
    2.32, 17, 13, [16, 6, 11], 2.7, 0.70, 40.8, 7.5,
    'The enemy fields a Marshal. Its whole army hits 20% harder until you kill it.'),
  T('obsidian', 'The Obsidian Throne', 4, [4, 1], ['ironcrown', 'duskfell', 'thanescar'],
    2.42, 17, 13, [17, 6, 13], 2.95, 0.72, 49.0, 8.5,
    'Nineteen sites, three fronts, and a castle that retreats rather than feeds you. The last one.'),
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

/** Income at 100% conquest, for balance sanity checks. ~276/s by design — the
 *  tail was re-spread onto a smooth x1.2-a-region ramp (the old table stepped
 *  1.8 -> 4.0 -> 13.0 -> 38.0 at the tier boundaries, and the first region of
 *  every tier was therefore the hardest in the campaign, because it met a new
 *  AI tier before the income that pays for the answer to it) but the total is
 *  deliberately unchanged. */
export const fullConquestIncome = () =>
  REGIONS.reduce((a, r) => a + r.rewardPerSec, 0);
