// The campaign: 18 region hexes in 4 tiers (4 / 5 / 5 / 4), adjacency-gated.
// PURE DATA. No logic reads a number that is not defined here or in balance.js.
//
// The load-bearing rule of this table: MAP SIZE, SITE COUNT, AND BATTLE LENGTH
// SCALE TOGETHER. A tier-4 region is a bigger war (17x13, 27 sites, ~11 min),
// not a tier-1 fight with inflated numbers. If you raise `enemyMult` without
// also raising `grid` and `siteCounts`, you have made the game worse.
//
// `hex` places the region on the world map; `adjacentTo` must be exactly its
// true hex neighbours among the shipped set (tests/modifiers asserts this).

/** Battle hard cap per tier, in minutes. A backstop, not a timer you play
 *  against — each sits well above its tier's targetLengthMin. */
export const HARD_CAP_MIN_BY_TIER = [8, 10, 12.5, 15];

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

// id, name, tier, hex, adjacentTo, enemyMult, cols, rows, [enemy,neutral,player],
// rewardPerSec, targetLengthMin, flavour
const T = (id, name, tier, hex, adjacentTo, enemyMult, cols, rows, siteCounts,
  rewardPerSec, targetLengthMin, flavour) => ({
  id, name, tier, hex, adjacentTo, enemyMult,
  grid: { cols, rows },
  siteCounts: { enemy: siteCounts[0], neutral: siteCounts[1], player: siteCounts[2] },
  rewardPerSec, targetLengthMin, flavour,
  hardCapMs: Math.round(HARD_CAP_MIN_BY_TIER[tier - 1] * 60 * 1000),
  startsUnlocked: false,
});

/** @type {ReadonlyArray<object>} */
export const REGIONS = Object.freeze([
  // --- Tier 1 (4) -- the vertical slice. These five rows are balance-frozen. ---
  T('riverfen', 'Riverfen', 1, [0, 0], ['ashford', 'ironwood'],
    1.00, 11, 9, [7, 2, 2], 1.0, 5.0,
    'Flooded lowlands: two neutral farms sit in the open and the enemy is slow to claim them.'),
  T('ashford', 'Ashford Downs', 1, [1, 0], ['riverfen', 'ironwood', 'saltmere', 'kaldan', 'highmarch'],
    1.25, 12, 9, [8, 3, 2], 1.2, 5.5,
    'Open chalk downs with almost no cover — a fast raid arrives before the wall does.'),
  T('ironwood', 'Ironwood', 1, [0, 1], ['riverfen', 'ashford', 'saltmere', 'emberholt'],
    1.55, 13, 10, [9, 3, 2], 1.5, 6.0,
    'Dense timber and single-file passes: chokepoints turn every push into a committed one.'),
  T('saltmere', 'Saltmere', 1, [1, 1],
    ['ashford', 'ironwood', 'kaldan', 'greywater', 'thornmoor', 'emberholt'],
    1.90, 13, 10, [10, 4, 2], 1.8, 6.5,
    'A salt lagoon splits the field; whoever holds the causeway strongholds holds the region.'),

  // --- Tier 2 (5) -- the first real wall. Kaldan proves the upgrade layer matters. ---
  T('kaldan', 'Kaldan Reach', 2, [2, 0],
    ['ashford', 'saltmere', 'highmarch', 'greywater', 'vaelstrand', 'sunder'],
    2.60, 15, 11, [12, 4, 2], 4.0, 7.5,
    'The enemy opens with twelve sites and a real economy. Come with an army or come back later.'),
  T('highmarch', 'Highmarch', 2, [2, -1], ['ashford', 'kaldan', 'sunder'],
    3.00, 15, 11, [12, 4, 2], 4.4, 7.5,
    'Terraced highland: the castle sits behind two stronghold gates and nothing flanks it.'),
  T('greywater', 'Greywater Fen', 2, [2, 1],
    ['saltmere', 'kaldan', 'thornmoor', 'karrowmere', 'duskfell', 'vaelstrand'],
    3.35, 15, 11, [12, 5, 2], 4.8, 8.0,
    'Marsh crossings everywhere and walls nowhere — the widest front line in the campaign.'),
  T('thornmoor', 'Thornmoor', 2, [1, 2],
    ['saltmere', 'greywater', 'emberholt', 'karrowmere', 'gallowmoor'],
    3.70, 15, 12, [13, 5, 2], 5.2, 8.0,
    'Bramble country: five neutral farms make the opening land grab the whole battle.'),
  T('emberholt', 'Emberholt', 2, [0, 2], ['ironwood', 'saltmere', 'thornmoor', 'gallowmoor'],
    4.05, 16, 12, [13, 5, 2], 5.6, 8.0,
    'Ash plains where the enemy trains raiders first. Bring spears or lose your farms by 2:00.'),

  // --- Tier 3 (5) -- ~16x12, ~9 min. Sieges are the whole conversation now. ---
  T('gallowmoor', 'Gallowmoor', 3, [0, 3], ['emberholt', 'thornmoor'],
    5.00, 16, 12, [14, 5, 2], 13.0, 9.0,
    'A dead-end moor: one approach, three strongholds stacked along it, no way around.'),
  T('sunder', 'The Sunder', 3, [3, -1], ['highmarch', 'kaldan', 'vaelstrand', 'blackspire'],
    5.50, 16, 12, [14, 5, 2], 14.5, 9.0,
    'A canyon rift halves the map; both castles are reachable only through the two bridges.'),
  T('vaelstrand', 'Vaelstrand', 3, [3, 0],
    ['kaldan', 'greywater', 'sunder', 'duskfell', 'ironcrown', 'blackspire'],
    6.00, 16, 12, [15, 5, 2], 16.0, 9.0,
    'Coastal sprawl with the richest farm belt in the game — starve it and the castle falls itself.'),
  T('duskfell', 'Duskfell', 3, [3, 1],
    ['greywater', 'karrowmere', 'vaelstrand', 'thanescar', 'ironcrown', 'obsidian'],
    6.50, 17, 12, [15, 5, 2], 16.5, 9.5,
    'The enemy counter-trains here for the first time. Whatever you spam, it answers within a minute.'),
  T('karrowmere', 'Karrowmere', 3, [2, 2], ['thornmoor', 'greywater', 'duskfell', 'thanescar'],
    7.00, 17, 12, [15, 6, 2], 17.0, 9.5,
    'Ringed hill fort: every enemy stronghold is upgraded, so token forces bounce off the walls.'),

  // --- Tier 4 (4) -- 17x13, 22+ sites, ~10-11 min. The endgame. ---
  T('thanescar', 'Thanescar', 4, [3, 2], ['karrowmere', 'duskfell', 'obsidian'],
    9.00, 17, 13, [16, 6, 2], 38.0, 10.0,
    'Sixteen enemy sites and two concurrent attacks. You will lose ground somewhere; choose where.'),
  T('blackspire', 'Blackspire', 4, [4, -1], ['sunder', 'vaelstrand', 'ironcrown'],
    10.00, 17, 13, [17, 6, 2], 41.0, 10.0,
    'A vertical fortress region: rams are not optional, and the enemy brings its own.'),
  T('ironcrown', 'Ironcrown', 4, [4, 0], ['vaelstrand', 'duskfell', 'blackspire', 'obsidian'],
    11.00, 17, 13, [18, 6, 2], 44.0, 10.5,
    'The enemy fields a Marshal. Its whole army hits 20% harder until you kill it.'),
  T('obsidian', 'The Obsidian Throne', 4, [4, 1], ['ironcrown', 'duskfell', 'thanescar'],
    12.50, 17, 13, [19, 6, 2], 47.0, 11.0,
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

/** Income at 100% conquest, for balance sanity checks. ~274/s by design. */
export const fullConquestIncome = () =>
  REGIONS.reduce((a, r) => a + r.rewardPerSec, 0);
