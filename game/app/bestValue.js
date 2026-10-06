// "Best value" in the War Council (DESIGN §5.2): the ONE Army or Powers card that raises Army Power the most per gold right now. PLAN-PHASE11b:
// it rates the Powers cards too (a power level grows 1.12x a level against the Army lines' 1.4x, so powers are often the cheaper Army Power;
// pinned to the Army tab, the tag steered a player who follows it away from them, tools/campaign.mjs --policy=human --shop=bot3).
// Army Power here is exactly the "Your power" number the region card shows: `difficulty(state, world, regionId).power`, which is built
// from `playerBattleStats` (game/meta/progression.js). For each Army or Powers card we take that estimate again one level
// higher and divide the gain by the gold it costs. The power depends on the target (support troops, terrain), so it is averaged over
// the regions the player can attack next (the frontier), which is what they are shopping for.
//
// Pure (reads state and world, never mutates them). The scene computes it (throttled) and hands the council a `bestValue` flag per
// card as plain data, so game/ui/council.js stays free of game logic.
import { UPGRADES, levelOf, upgradeCost } from '../meta/upgrades.js';
import { difficulty, frontier } from '../meta/progression.js';
import { incomePerSec } from '../meta/economy.js';
import { BEST_VALUE } from '../config/meta.js';

/** Mean Army Power (the region card's "Your power") over the given regions. */
export function meanArmyPower(state, world, regionIds) {
  if (!regionIds.length) return 0;
  let sum = 0;
  for (const id of regionIds) sum += difficulty(state, world, id).power;
  return sum / regionIds.length;
}

/**
 * @param {import('../meta/state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @returns {{ id: string, gain: number, cost: number, perGold: number } | null}  the best Army or Powers card by Army Power per gold, or null
 *   when nothing in the Army or Powers tabs raises the power (everything maxed, or no region left to fight).
 */
export function bestValueUpgrade(state, world) {
  const ids = frontier(state, world);
  if (!ids.length) return null;
  const base = meanArmyPower(state, world, ids);
  // PLAN-PHASE11b: only cards affordable now or within BEST_VALUE.horizonSec of current income; none in reach -> the cheapest that raises power
  const reach = (Number(state.gold) || 0) + incomePerSec(state, world) * BEST_VALUE.horizonSec;
  let best = null;
  let cheapest = null;
  for (const def of Object.values(UPGRADES)) {
    if (def.tab !== 'army' && def.tab !== 'powers') continue; // Realm cards (Taxes, Treasury, Plunder) raise no Army Power
    const level = levelOf(state, def.id);
    if (def.max != null && level >= def.max) continue;
    const cost = upgradeCost(def.id, level);
    if (!(cost > 0)) continue;
    const next = { ...state, upgrades: { ...state.upgrades, [def.id]: level + 1 } };
    const gain = meanArmyPower(next, world, ids) - base;
    if (!(gain > 0)) continue;
    const perGold = gain / cost;
    if (!cheapest || cost < cheapest.cost || (cost === cheapest.cost && perGold > cheapest.perGold)) cheapest = { id: def.id, gain, cost, perGold };
    if (cost > reach) continue;
    if (!best || perGold > best.perGold) best = { id: def.id, gain, cost, perGold };
  }
  return best || cheapest;
}
