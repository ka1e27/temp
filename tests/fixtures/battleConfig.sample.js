// GOLDEN FIXTURE for the battle<->meta seam.
//
// The battle engine codes against this before the meta layer exists, and the
// meta layer asserts its own producer output matches this shape. If the two
// sides ever drift, one of them fails against this file rather than silently
// disagreeing at runtime.
//
// FROZEN — extend by adding fields, never by changing existing ones.
import { CONTRACT_VERSION, makeMods } from '../../src/battle/contract.js';

/** A small, fully-connected 7-site map. Deliberately hand-written, not generated. */
export function sampleBattleConfig(overrides = {}) {
  return {
    contractVersion: CONTRACT_VERSION,
    battleId: 'sample-001',
    seed: 12345,
    region: { id: 'riverfen', name: 'Riverfen', tier: 1 },
    grid: { cols: 11, rows: 9, blocked: [[4, 3], [4, 4], [5, 3]] },
    sites: [
      { id: 'camp',  kind: 'camp',       hex: [1, 7], owner: 'player',  garrison: { militia: 6 },  hp: 600, hpMax: 600 },
      { id: 'f1',    kind: 'farm',       hex: [2, 6], owner: 'player',  garrison: { militia: 3 },  hp: 100, hpMax: 100 },
      { id: 'f2',    kind: 'farm',       hex: [4, 6], owner: 'neutral', garrison: { militia: 6 },  hp: 100, hpMax: 100 },
      { id: 's1',    kind: 'stronghold', hex: [5, 4], owner: 'enemy',   garrison: { militia: 6, spearmen: 2 }, hp: 250, hpMax: 250 },
      { id: 'f3',    kind: 'farm',       hex: [7, 3], owner: 'enemy',   garrison: { militia: 5 },  hp: 100, hpMax: 100 },
      { id: 's2',    kind: 'stronghold', hex: [8, 2], owner: 'enemy',   garrison: { militia: 6, spearmen: 2 }, hp: 250, hpMax: 250 },
      { id: 'castle', kind: 'castle',    hex: [9, 1], owner: 'enemy',   garrison: { militia: 12, spearmen: 4 }, hp: 600, hpMax: 600 },
    ],
    adjacency: [
      ['camp', 'f1'], ['f1', 'f2'], ['f2', 's1'],
      ['s1', 'f3'], ['f3', 's2'], ['s2', 'castle'], ['s1', 'castle'],
    ],
    player: makeMods({ startGold: 300, expedition: { militia: 8 } }),
    enemy: makeMods({
      startGold: 200,
      expedition: { militia: 0 },
      goldRateMult: 0.85,
      unlockedUnits: ['militia', 'spearmen'],
    }),
    boosters: { rally: 2, march: 3 },
    rules: { victory: 'capture-castle', hardCapMs: 8 * 60 * 1000, aiTier: 1 },
    ...overrides,
  };
}

/** A minimal outcome matching the fixture, for validator tests. */
export function sampleOutcome(configHash, overrides = {}) {
  return {
    contractVersion: CONTRACT_VERSION,
    battleId: 'sample-001',
    configHash,
    regionId: 'riverfen',
    result: 'win',
    durationMs: 300000,
    ticks: 3000,
    stats: {
      sitesHeld: 7, sitesTotal: 7, unitsLost: 40, unitsKilled: 55,
      goldEarned: 1200, peakArmy: 60,
    },
    boostersConsumed: [{ id: 'rally', count: 1 }],
    ...overrides,
  };
}
