// Idle income ticker (DESIGN §5.1, always wall-clock even mid-battle) plus the
// periodic "+gold" flavour pop scheduling (PLAYFEEL §2). The pop's amount is
// cosmetic (a few seconds of that region's OWN base income) — real income
// already accrues continuously via `tickIncome`; this never grants extra gold.
import { tickIncome, regionIncome } from '../meta/economy.js';
import { PLAYER_FACTION } from '../meta/state.js';
import { WORLD_SCENE } from '../scenes/timing.js';

const POP_SECONDS_OF_INCOME = 3;

function randRange(a, b, rng) {
  return a + (rng ? rng() : Math.random()) * (b - a);
}

/**
 * @param {{ getState: () => object, getWorld: () => object, rng?: () => number }} deps
 */
export function createIdleTicker({ getState, getWorld, rng }) {
  let nextPopInSec = randRange(WORLD_SCENE.idlePopMinSec, WORLD_SCENE.idlePopMaxSec, rng);
  let acc = 0;

  /**
   * @param {number} dtSec real elapsed seconds (never scaled by battle speed)
   * @returns {{ regionId: number, gold: number } | null} a pop to show this frame, if one is due
   */
  function tick(dtSec) {
    const state = getState();
    const world = getWorld();
    tickIncome(state, world, dtSec);

    acc += dtSec;
    if (acc < nextPopInSec) return null;
    acc = 0;
    nextPopInSec = randRange(WORLD_SCENE.idlePopMinSec, WORLD_SCENE.idlePopMaxSec, rng);

    const owned = world.regions.filter((r) => state.owner[r.id] === PLAYER_FACTION);
    if (owned.length === 0) return null;
    const region = owned[Math.floor(randRange(0, owned.length, rng))] || owned[0];
    return { regionId: region.id, gold: regionIncome(region) * POP_SECONDS_OF_INCOME };
  }

  return { tick };
}
