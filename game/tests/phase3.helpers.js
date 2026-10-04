// Helpers for integration.phase3.test.js: a Duel event built the way meta/events.js builds one (without waiting 25 active minutes).
import { duelRunFor } from '../meta/events.js';
import { borderingRivals } from '../meta/frontier.js';
import { canBuildDefenseArena } from '../battle/defenseArena.js';

export { duelRunFor };

/** A Duel event on the first border a rival can attack across, or null. */
export function borderingRivalsForTest(state, world) {
  for (const r of borderingRivals(state, world)) {
    for (const p of r.pairs) {
      if (canBuildDefenseArena(world, state.owner, p.to, r.faction)) {
        return { id: 1, kind: 'duel', offeredAt: 0, expiresAt: 90, faction: r.faction, regionId: p.to, fromRegionId: p.from, leader: 'A champion', text: '' };
      }
    }
  }
  return null;
}
