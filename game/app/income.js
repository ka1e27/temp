// Display-side income number shared by the world scene (region card) and the battle scene (victory
// card): what one region pays per second once every income multiplier the player holds is applied.
import { regionIncome } from '../meta/economy.js';
import { perkMultipliers } from '../meta/perks.js';
import { UPGRADES, levelOf } from '../meta/upgrades.js';
import { DYNASTY, ECONOMY } from '../config/meta.js';
import { prosperityIncomeMult } from '../meta/prosperity.js';

/**
 * @param {import('../meta/state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @param {import('../world/generate.js').Region} region
 * @returns {number} gold per second
 */
export function effectiveRegionIncome(state, world, region) {
  const taxMult = 1 + levelOf(state, 'taxes') * UPGRADES.taxes.magnitude;
  const perks = perkMultipliers(state, world);
  const starMult = 1 + state.dynasty.stars * DYNASTY.incomePerStar;
  // Prosperity pays +5% income per level on a region the player holds (the STORED level, like economy.js's own line).
  return regionIncome(region) * prosperityIncomeMult(state, region.id) * taxMult * perks.income * starMult;
}

/**
 * Hours of income the game pays for an absence (ECONOMY.offlineCapHours + one per Treasury level): the number the welcome-back card
 * and the War Council quote. Mirrors game/meta/economy.js's offlineEarnings (game/tests/ui.bonuscopy.test.js holds them together).
 * @param {import('../meta/state.js').GameState} state
 */
export function offlineCapHours(state) {
  return ECONOMY.offlineCapHours + levelOf(state, 'treasury') * UPGRADES.treasury.magnitude;
}
