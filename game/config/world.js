// World generation tuning. Owned by the world-generation module.
export const WORLD = Object.freeze({
  cols: 48,
  rows: 36,
  landFraction: 0.5,
  regionCount: 28,
  // Region size grows with distance from the start region.
  nearRegionTiles: [18, 25],
  farRegionTiles: [35, 50],
  nearSettlements: [3, 4],
  farSettlements: [6, 8],
  minSettlementSpacing: 3,
  freeFolkTiers: 2, // tiers 1..N around the start belong to the Free Folk (mostly)
  rivalFactions: 3,
});

export const FACTIONS = Object.freeze([
  { id: 0, name: 'Your Realm', color: '#3d7ef0', colorDark: '#1f4fb0', colorLight: '#9cc0ff', emblem: 'star', personality: 'player' },
  { id: 1, name: 'Free Folk', color: '#9a927f', colorDark: '#5f5847', colorLight: '#d8d0bb', emblem: 'wheat', personality: 'passive' },
  { id: 2, name: 'Crimson Legion', color: '#d8433f', colorDark: '#8f1f1c', colorLight: '#ff9c93', emblem: 'sword', personality: 'aggressive' },
  { id: 3, name: 'Violet Covenant', color: '#9b5de5', colorDark: '#5b2c99', colorLight: '#d3b5ff', emblem: 'eye', personality: 'defensive' },
  { id: 4, name: 'Amber Horde', color: '#f29e38', colorDark: '#a85f10', colorLight: '#ffd29a', emblem: 'sun', personality: 'swarm' },
]);

// Movement cost per terrain (Infinity = impassable). Roads replace the base cost.
export const TERRAIN_COST = Object.freeze({
  deep: Infinity, ocean: Infinity, shallows: Infinity,
  beach: 1.1, grass: 1.0, meadow: 1.0, forest: 1.6, pine: 1.6, hills: 1.5,
  mountain: Infinity, snow: 1.4, savanna: 1.1, desert: 1.2, marsh: 1.8,
});
export const ROAD_COST = 0.55;
export const RIVER_PENALTY = 0.8;

// Beaches are a thin coastal fringe, not a biome (round 3): only LOW, EXPOSED coastal tiles of open
// ground, and not every one of them. `regionCap` bounds the share of any region; `isletCap` the
// share of a decorative islet. Terrain-level rules live in world/terrain.js, the per-region cap in
// world/beaches.js.
export const BEACH = Object.freeze({
  maxRelElev: 0.32, // lowland rank (0 lowest .. 1): only the low-lying coastal tiles qualify (was 0.45)
  keep: 0.72, // share of qualifying tiles that actually become beach (hash thinned: not every coastal tile)
  singleSideKeep: 0.28, // tiles touching the sea on ONE side only (sheltered bays, river mouths) keep at this rate
  regionCap: 0.35, // a region never has more than this share of beach tiles
  isletCap: 0.5, // nor does a decorative islet (4+ tiles)
});

// Islands that are not the main landmass are decorative. Anything under `minTiles` land tiles is
// erased (it read as a stray tile next to the coast); bigger ones keep some green.
export const ISLET = Object.freeze({ minTiles: 4 });

// The start region is the first thing a player sees: it must look lush. `minGreen` is the share of
// its land that is grass, meadow, forest or pine; candidates for the start tile are ranked by the
// lushness of their neighbourhood, and generate.js retries with the next candidate when the region
// that actually forms is not lush enough.
export const START = Object.freeze({
  lushRadius: 3, // hex radius of the neighbourhood sampled around a candidate start tile
  lushWeight: 0.75, // score bonus per unit of lushness (capped at lushCap), against the south-west bias
  lushCap: 0.6,
  minGreen: 0.5, // accepted start region: at least this green share ...
  maxSectorGap: 2, // ... and the three rival sectors within this many regions of each other ...
  minSector: 3, // ... none smaller than this (a start that splits the map 7/9/1 is rejected)
  gapPenalty: 0.25, // quality lost per region of sector gap beyond maxSectorGap, when no candidate is perfect
  candidates: 8, // how many ranked start tiles generate.js will try
});
