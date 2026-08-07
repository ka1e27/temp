// battle -> meta. FACTS ONLY.
//
// Battle reports observations; meta/rewards.js turns them into crowns. The
// contract validator actively REJECTS an outcome that sets `rewards`, which
// keeps economy math in exactly one place. Do not add one here.
// PURE.
import { CONTRACT_VERSION, hashBattleConfig } from './contract.js';
import { TICK_MS } from '../core/loop.js';
import { CENTIGOLD } from '../content/balance.js';
import { sitesOwned } from './state.js';

const RESULTS = ['win', 'loss', 'timeout', 'retreat'];

/**
 * @param {object} state a battle state, normally already finished
 * @param {object} config the BattleConfig it was built from
 * @returns {object} BattleOutcome
 */
export function toOutcome(state, config) {
  const player = state.factions.player;
  // A still-running battle can only be reported as a timeout: 'running' is not
  // a legal result and inventing a winner here would be a lie.
  const result = RESULTS.includes(state.status) ? state.status : 'timeout';

  const boostersConsumed = Object.keys(state.boosters).sort()
    .filter((id) => (state.boosters[id].used ?? 0) > 0)
    .map((id) => ({ id, count: state.boosters[id].used }));

  return {
    contractVersion: CONTRACT_VERSION,
    battleId: state.battleId,
    configHash: hashBattleConfig(config),
    regionId: state.regionId ?? config.region?.id ?? null,
    result,
    durationMs: Math.round(state.tick * TICK_MS),
    ticks: state.tick,
    stats: {
      sitesHeld: sitesOwned(state, 'player').length,
      sitesTotal: state.sites.length,
      unitsLost: Math.max(0, Math.round(player.unitsLost)),
      unitsKilled: Math.max(0, Math.round(player.unitsKilled)),
      goldEarned: Math.round(player.goldEarnedCg / CENTIGOLD),
      peakArmy: player.peakArmy,
    },
    boostersConsumed,
  };
}
