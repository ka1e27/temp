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

// id, name, tier, hex, adjacentTo, enemyMult, cols, rows, [enemy,neutral,player],
// develop, rewardPerSec, targetLengthMin, flavour
const T = (id, name, tier, hex, adjacentTo, enemyMult, cols, rows, siteCounts,
  develop, rewardPerSec, targetLengthMin, flavour) => ({
  id, name, tier, hex, adjacentTo, enemyMult,
  grid: { cols, rows },
  siteCounts: { enemy: siteCounts[0], neutral: siteCounts[1], player: siteCounts[2] },
  develop: DEVELOP_CLAMP(develop),
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
    1.00, 11, 9, [5, 3, 3], 1, 1.0, 8,
    'Flooded lowlands: two neutral farms sit in the open and the enemy is slow to claim them.'),
  T('ashford', 'Ashford Downs', 1, [1, 0], ['riverfen', 'ironwood', 'saltmere', 'kaldan', 'highmarch'],
    1.15, 12, 9, [6, 3, 3], 1, 1.2, 10,
    'Open chalk downs with almost no cover — a fast raid arrives before the wall does.'),
  T('ironwood', 'Ironwood', 1, [0, 1], ['riverfen', 'ashford', 'saltmere', 'emberholt'],
    1.30, 13, 10, [7, 3, 4], 1, 1.5, 12,
    'Dense timber and single-file passes: chokepoints turn every push into a committed one.'),
  T('saltmere', 'Saltmere', 1, [1, 1],
    ['ashford', 'ironwood', 'kaldan', 'greywater', 'thornmoor', 'emberholt'],
    1.45, 13, 10, [8, 4, 4], 1, 1.8, 13,
    'A salt lagoon splits the field; whoever holds the causeway strongholds holds the region.'),

  // --- Tier 2 (5) -- the first real wall. Kaldan proves the upgrade layer matters. ---
  T('kaldan', 'Kaldan Reach', 2, [2, 0],
    ['ashford', 'saltmere', 'highmarch', 'greywater', 'vaelstrand', 'sunder'],
    1.85, 15, 11, [9, 4, 5], 1, 4.0, 14,
    'The enemy opens with twelve sites and a real economy. Come with an army or come back later.'),
  T('highmarch', 'Highmarch', 2, [2, -1], ['ashford', 'kaldan', 'sunder'],
    1.98, 15, 11, [9, 4, 7], 1.35, 5.5, 15,
    'Terraced highland: the castle sits behind two stronghold gates and nothing flanks it.'),
  T('greywater', 'Greywater Fen', 2, [2, 1],
    ['saltmere', 'kaldan', 'thornmoor', 'karrowmere', 'duskfell', 'vaelstrand'],
    2.00, 15, 11, [10, 5, 7], 1.5, 6.6, 15.5,
    'Marsh crossings everywhere and walls nowhere — the widest front line in the campaign.'),
  T('thornmoor', 'Thornmoor', 2, [1, 2],
    ['saltmere', 'greywater', 'emberholt', 'karrowmere', 'gallowmoor'],
    2.02, 15, 12, [11, 5, 7], 1.62, 7.9, 16,
    'Bramble country: five neutral farms make the opening land grab the whole battle.'),
  T('emberholt', 'Emberholt', 2, [0, 2], ['ironwood', 'saltmere', 'thornmoor', 'gallowmoor'],
    2.04, 16, 12, [11, 5, 7], 1.72, 9.5, 16.5,
    'Ash plains where the enemy trains raiders first. Bring spears or lose your farms by 2:00.'),

  // --- Tier 3 (5) -- ~16x12, ~8 min. Sieges are the whole conversation now. ---
  //
  // The advertised length DROPS here, from tier 2's 14-16.5 minutes, and it is
  // the honest number rather than the one the column used to carry. Victory is
  // capture-castle: by tier 3 the player lands with rams, a siege line and an
  // army the size of the garrison, and a clean win takes six to nine minutes
  // whatever else is done to the region. Measured at n=240 with the enemy dial
  // re-curved, the country developed, the throne garrisoned, the expedition
  // tapered and the map grown to 26 enemy sites on a 21x15 grid — none of it
  // moved a clean win past ten minutes, because sites off the path to the
  // throne are never fought over. These numbers now say what the regions do.
  T('gallowmoor', 'Gallowmoor', 3, [0, 3], ['emberholt', 'thornmoor'],
    2.06, 16, 12, [11, 5, 9], 1.75, 11.4, 10.5,
    'A dead-end moor: one approach, three strongholds stacked along it, no way around.'),
  T('sunder', 'The Sunder', 3, [3, -1], ['highmarch', 'kaldan', 'vaelstrand', 'blackspire'],
    2.08, 16, 12, [12, 5, 9], 1.9, 13.7, 11,
    'A canyon rift halves the map; both castles are reachable only through the two bridges.'),
  T('vaelstrand', 'Vaelstrand', 3, [3, 0],
    ['kaldan', 'greywater', 'sunder', 'duskfell', 'ironcrown', 'blackspire'],
    2.10, 16, 12, [13, 5, 9], 2.05, 16.4, 11,
    'Coastal sprawl with the richest farm belt in the game — starve it and the castle falls itself.'),
  T('duskfell', 'Duskfell', 3, [3, 1],
    ['greywater', 'karrowmere', 'vaelstrand', 'thanescar', 'ironcrown', 'obsidian'],
    2.12, 17, 12, [13, 5, 9], 2.2, 19.7, 11,
    'The enemy counter-trains here for the first time. Whatever you spam, it answers within a minute.'),
  T('karrowmere', 'Karrowmere', 3, [2, 2], ['thornmoor', 'greywater', 'duskfell', 'thanescar'],
    2.14, 17, 12, [14, 6, 9], 2.35, 23.6, 11,
    'Ringed hill fort: every enemy stronghold is upgraded, so token forces bounce off the walls.'),

  // --- Tier 4 (4) -- 17x13, 33-36 sites, ~6-8 min, develop 2.35-2.95.
  // The endgame: the enemy's country is built, its throne is a capital with an
  // army in it, and it fields rams, a marshal and three concurrent attacks. ---
  T('thanescar', 'Thanescar', 4, [3, 2], ['karrowmere', 'duskfell', 'obsidian'],
    2.16, 17, 13, [14, 6, 10], 2.35, 28.4, 11,
    'Sixteen enemy sites and two concurrent attacks. You will lose ground somewhere; choose where.'),
  T('blackspire', 'Blackspire', 4, [4, -1], ['sunder', 'vaelstrand', 'ironcrown'],
    2.30, 17, 13, [15, 6, 11], 2.45, 34.0, 11,
    'A vertical fortress region: rams are not optional, and the enemy brings its own.'),
  T('ironcrown', 'Ironcrown', 4, [4, 0], ['vaelstrand', 'duskfell', 'blackspire', 'obsidian'],
    2.32, 17, 13, [16, 6, 11], 2.7, 40.8, 11,
    'The enemy fields a Marshal. Its whole army hits 20% harder until you kill it.'),
  T('obsidian', 'The Obsidian Throne', 4, [4, 1], ['ironcrown', 'duskfell', 'thanescar'],
    2.42, 17, 13, [17, 6, 13], 2.95, 49.0, 11,
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
