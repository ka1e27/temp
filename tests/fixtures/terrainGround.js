// Shared ground for the terrain suites.
//
// Both terrain test files need to measure the SAME fort on two different
// grounds, which means placing sites by hand rather than trusting a generated
// map to hand them a control. Kept here so tests/terrain.test.js and
// tests/terrainmap.test.js cannot drift into two subtly different fixtures.
import { startBattle } from '../../src/battle/sim.js';
import { assertBattleConfig, CONTRACT_VERSION } from '../../src/battle/contract.js';
import { emptyComp } from '../../src/battle/combat.js';
import { distance } from '../../src/core/hex.js';

export const comp = (o) => ({ ...emptyComp(), ...o });
export const kOf = ([q, r]) => `${q},${r}`;

/** FactionMods with every dial at baseline, so a measured difference can only
 *  have come from the ground. */
export function basicMods() {
  return {
    startGold: 200,
    expedition: emptyComp(),
    goldRateMult: 1,
    trainSpeedMult: 1,
    trainCostMult: 1,
    unitAtkMult: 1,
    unitDefMult: 1,
    marchSpeedMult: 1,
    farmYieldMult: 1,
    garrisonCapBonus: 0,
    siegeDmgMult: 1,
    structureRegenMult: 1,
    ramImpactHp: 0,
    unlockedUnits: ['militia', 'spearmen'],
    features: [],
  };
}

/** The fort under test sits at (3,4); the camp and the castle are 5+ hexes
 *  away, so nothing placed in the fort's ring leaks onto them. */
export const FORT_HEX = { q: 3, r: 4 };

/** A battle state whose grid is exactly the terrain the test asks for. */
export function ground(over = {}) {
  return startBattle(assertBattleConfig({
    contractVersion: CONTRACT_VERSION,
    battleId: 'terrain-fixture',
    seed: 5,
    grid: { cols: 9, rows: 9, blocked: [], rivers: [], ...(over.grid ?? {}) },
    sites: [
      { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 4 }, hp: 480, hpMax: 480 },
      { id: 'fort', kind: 'stronghold', hex: [3, 4], owner: 'enemy', garrison: { spearmen: 6 }, hp: 250, hpMax: 250 },
      { id: 'castle', kind: 'castle', hex: [4, 8], owner: 'enemy', garrison: { militia: 4 }, hp: 480, hpMax: 480 },
    ],
    adjacency: [['camp', 'fort'], ['fort', 'castle']],
    player: basicMods(),
    enemy: basicMods(),
    rules: { victory: 'capture-castle', hardCapMs: 600000, aiTier: 1 },
    ...(over.top ?? {}),
  }));
}

/** `n` hexes at distance exactly 2 from the fort — the ring mapgen is allowed
 *  to put mountains in, since distance 1 is always kept clear. */
export function ringTwo(n) {
  const out = [];
  for (let dq = -2; dq <= 2 && out.length < n; dq++) {
    for (let dr = -2; dr <= 2 && out.length < n; dr++) {
      const h = { q: FORT_HEX.q + dq, r: FORT_HEX.r + dr };
      if (distance(FORT_HEX, h) === 2) out.push([h.q, h.r]);
    }
  }
  return out;
}
