// Shared test fixtures for game/tests/meta.*.test.js. NOT a test file itself
// (doesn't match game/tests/**/*.test.js, so `npm test` never picks it up).
//
// This is a small, hand-built World-shaped object standing in for the real
// game/world/generate.js output (built in parallel by another engineer). It
// deliberately covers: a tier-0 start region, two tier-1 Free Folk regions,
// a rival capital plus one of its non-capital regions (for decapitation),
// and a second rival's capital — enough surface for every meta.* function.
// See game/tests/meta.progression.integration.test.js for a test against the
// real generator, once it exists.
//
// The returned world is deep-frozen: any meta code that accidentally tried
// to mutate it (forbidden — world is regenerated from its seed, never saved)
// would throw immediately in these tests.

import { createGame, PLAYER_FACTION } from '../meta/state.js';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/** @returns {import('../world/generate.js').World} */
export function makeWorld() {
  const factions = [
    { id: 0, name: 'Your Realm', color: '#3d7ef0', colorDark: '#1f4fb0', colorLight: '#9cc0ff', emblem: 'star', personality: 'player', capitalRegion: -1 },
    { id: 1, name: 'Free Folk', color: '#9a927f', colorDark: '#5f5847', colorLight: '#d8d0bb', emblem: 'wheat', personality: 'passive', capitalRegion: -1 },
    { id: 2, name: 'Crimson Legion', color: '#d8433f', colorDark: '#8f1f1c', colorLight: '#ff9c93', emblem: 'sword', personality: 'aggressive', capitalRegion: 3 },
    { id: 3, name: 'Violet Covenant', color: '#9b5de5', colorDark: '#5b2c99', colorLight: '#d3b5ff', emblem: 'eye', personality: 'defensive', capitalRegion: 5 },
    { id: 4, name: 'Amber Horde', color: '#f29e38', colorDark: '#a85f10', colorLight: '#ffd29a', emblem: 'sun', personality: 'swarm', capitalRegion: -1 },
  ];

  const settlements = [
    { id: 0, tile: 0, region: 0, type: 'keep', name: 'Home Keep' },
    { id: 1, tile: 1, region: 1, type: 'keep', name: 'Millbrook Keep' },
    { id: 2, tile: 2, region: 1, type: 'village', name: 'Millbrook Village' },
    { id: 3, tile: 3, region: 2, type: 'keep', name: 'Stonefield Keep' },
    { id: 4, tile: 4, region: 3, type: 'keep', name: 'Crimson Keep' },
    { id: 5, tile: 5, region: 3, type: 'town', name: 'Crimson Town' },
    { id: 6, tile: 6, region: 4, type: 'keep', name: 'Ashport Keep' },
    { id: 7, tile: 7, region: 4, type: 'fort', name: 'Ashport Fort' },
    { id: 8, tile: 8, region: 5, type: 'keep', name: 'Violet Keep' },
  ];

  const bbox = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const regions = [
    { id: 0, name: 'Home Shore', tiles: [0], neighbors: [1, 2], centroid: { x: 0, y: 0 }, bbox, keep: 0, settlements: [0], tier: 0, faction: 0, isCapital: false, biome: 'grass', perk: 'fertile', coastal: true },
    { id: 1, name: 'Millbrook', tiles: [1, 2], neighbors: [0, 3], centroid: { x: 1, y: 0 }, bbox, keep: 1, settlements: [1, 2], tier: 1, faction: 1, isCapital: false, biome: 'forest', perk: 'timber', coastal: false },
    { id: 2, name: 'Stonefield', tiles: [3], neighbors: [0, 4], centroid: { x: 0, y: 1 }, bbox, keep: 3, settlements: [3], tier: 1, faction: 1, isCapital: false, biome: 'savanna', perk: 'horses', coastal: false },
    { id: 3, name: 'Crimson Keep', tiles: [4, 5], neighbors: [1, 4], centroid: { x: 2, y: 0 }, bbox, keep: 4, settlements: [4, 5], tier: 2, faction: 2, isCapital: true, biome: 'grass', perk: 'throne', coastal: false },
    { id: 4, name: 'Ashport', tiles: [6, 7], neighbors: [2, 3, 5], centroid: { x: 1, y: 1 }, bbox, keep: 6, settlements: [6, 7], tier: 2, faction: 2, isCapital: false, biome: 'hills', perk: 'iron', coastal: true },
    { id: 5, name: 'Violet Spire', tiles: [8], neighbors: [4], centroid: { x: 2, y: 1 }, bbox, keep: 8, settlements: [8], tier: 3, faction: 3, isCapital: true, biome: 'marsh', perk: 'throne', coastal: false },
  ];

  // meta never reads tiles/cols/rows/bounds/startRegion beyond region.tier ===
  // 0 — these are included only so the object documents the full World shape.
  const world = {
    seed: 1,
    cols: 3,
    rows: 3,
    tiles: [],
    regions,
    settlements,
    factions,
    startRegion: 0,
    bounds: { minX: 0, minY: 0, maxX: 3, maxY: 3 },
  };

  return deepFreeze(world);
}

/**
 * A fresh createGame() state over `world`, at `now` (default 0), with any of
 * GameState's nested objects (dynasty/upgrades/stats/settings) shallow-patched
 * — e.g. `makeGame(world, { gold: 500, upgrades: { taxes: 2 } })`.
 * @param {import('../world/generate.js').World} world
 * @param {Partial<import('../meta/state.js').GameState>} [overrides]
 * @param {number} [now]
 */
export function makeGame(world, overrides = {}, now = 0) {
  const state = createGame(1, world, now);
  const { dynasty, upgrades, stats, settings, tutorial, ...rest } = overrides;
  Object.assign(state, rest);
  if (dynasty) Object.assign(state.dynasty, dynasty);
  if (upgrades) Object.assign(state.upgrades, upgrades);
  if (stats) Object.assign(state.stats, stats);
  if (settings) Object.assign(state.settings, settings);
  if (tutorial) Object.assign(state.tutorial, tutorial);
  return state;
}

/** Sets every region's owner to the player, for canFoundDynasty-style tests. */
export function ownEverything(state, world) {
  state.owner = world.regions.map(() => PLAYER_FACTION);
  return state;
}
