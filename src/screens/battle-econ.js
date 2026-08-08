// What a site — and the whole battle — is actually WORTH, as pure functions.
//
// The player's question is a tradeoff: "what does this fort pay me, and what is
// training costing me?" Answering it honestly means every number here comes
// from the SIMULATION's own functions. siteGoldPerSec() is exactly what
// runEconomy() credits; siteTrainCostPerSec() is exactly what runTraining()
// debits. Nothing in this file re-derives an economic formula, and nothing here
// may: a readout that can disagree with the treasury is worse than no readout,
// because the player will believe it.
//
// (battle-preview.js grew its own `income()` that re-derived the farm rate and
// silently ignored the attrition ladder, the AI economy handicap and in-progress
// upgrades. That is the drift this file exists to prevent — the HUD now reads
// factionGoldPerSec() instead.)
//
// Split out of battle-panel.js so it can be read and tested without a DOM.
// PURE: no DOM, no clock.
import { SITES, UNITS, RALLY_KEEP, TERRAIN } from '../content/balance.js';
import { siteGoldPerSec, factionGoldPerSec } from '../battle/economy.js';
import { groundOf, siteDefMultOf, terrainName, isOpen } from '../battle/terrain.js';
import {
  trainJob, siteTrainRate, siteTrainCostPerSec, factionTrainCostPerSec, garrisonCap,
} from '../battle/training.js';
import { clampRallyKeep, rallyKeepOf } from '../battle/state.js';
import { total, groundMult } from '../battle/combat.js';
import { TICK_HZ } from '../core/loop.js';
import { fixed, duration, rate } from '../ui/format.js';

/**
 * Everything the site panel says about one site's economy.
 *
 * `spend` and `trainRate` already carry the brownout factor, because a
 * gold-starved stronghold really is running at 60% and the panel should say the
 * number it is spending, not the one it wishes it could.
 *
 * @returns {{gold:number, spend:number, net:number, trains:boolean,
 *            unit:?string, trainRate:number, cycleSec:number, batch:number,
 *            blocked:boolean, held:number, cap:number,
 *            ground:object, defMult:number, riverFarm:boolean}}
 */
export function siteIntel(state, site) {
  const gold = siteGoldPerSec(state, site);
  const ground = groundOf(state, site);
  const spend = siteTrainCostPerSec(state, site);
  const job = trainJob(state, site);
  const trainRate = siteTrainRate(state, site);
  const out = {
    gold,
    spend,
    net: gold - spend,
    trains: !!SITES[site.kind].train,
    unit: job ? job.unit : null,
    trainRate,
    cycleSec: trainRate > 0 ? 1 / (job.progress * TICK_HZ * (site.brownout ?? 1)) : Infinity,
    batch: job ? UNITS[job.unit].batch : 1,
    blocked: !!job && job.blocked,
    held: total(site.garrison),
    cap: 0,
    // Terrain, straight from battle/terrain.js — the same two functions the
    // simulation resolves the fight with, so the panel cannot claim a defence
    // bonus the attacker will not actually meet.
    ground,
    defMult: siteDefMultOf(state, site),
    riverFarm: site.kind === 'farm' && ground.river,
  };
  if (out.trains && (site.owner === 'player' || site.owner === 'enemy')) {
    out.cap = garrisonCap(state, site);
  }
  return out;
}

/** `+4.0/s gold · -3.0/s training · net +1.0/s`. Empty for a site that neither
 *  earns nor spends, so a neutral farm costs no line at all. */
export function goldLine(intel) {
  const parts = [];
  if (intel.gold > 0) parts.push(`${rate(intel.gold)} gold`);
  if (intel.spend > 0) parts.push(`${rate(-intel.spend)} training`);
  if (parts.length === 2) parts.push(`net ${rate(intel.net)}`);
  return parts.join(' · ');
}

/** `militia x2 every 8.0s · 0.25/s` — which unit, and how fast. */
export function trainLine(intel) {
  if (!intel.trains || !intel.unit) return '';
  if (intel.blocked) return `${intel.unit} · FULL ${intel.held}/${intel.cap}`;
  if (!(intel.trainRate > 0)) return `${intel.unit} · halted`;
  const batch = intel.batch > 1 ? ` x${intel.batch}` : '';
  return `${intel.unit}${batch} every ${duration(intel.cycleSec)} · ${fixed(intel.trainRate, 2)}/s`;
}

/**
 * `HIGHLAND · defence 1.20x · rams 0.65x` — WHY this site is hard.
 *
 * Terrain that cannot be read off the board is just an invisible difficulty
 * dial, and the one question this line exists to answer is "why did that
 * assault fail?". So it names the ground, states the defence multiplier the
 * fight will actually use, and calls out the unit whose day the ground most
 * changes. Empty on open ground, the same way goldLine() is empty for a site
 * that neither earns nor spends.
 */
export function terrainLine(intel) {
  const g = intel.ground;
  if (isOpen(g)) return '';
  const parts = [terrainName(g).toUpperCase(), `defence ${fixed(intel.defMult, 2)}x`];
  if (intel.riverFarm) parts.push(`gold +${Math.round((TERRAIN.riverFarmGold - 1) * 100)}%`);
  const worst = tellingUnit(g);
  if (worst) parts.push(worst);
  return parts.join(' · ');
}

/**
 * The one unit whose multiplier this ground changes most — the actionable half
 * of the terrain line. "Bring militia" is the lesson; naming all four would
 * bury it.
 *
 * The number comes from combat.js `groundMult`, the SAME function that resolves
 * the fight. Re-deriving `1 + (spec.ground.highland - 1) * g.highland` here is
 * three lines and would be wrong the first time anyone changes how highland is
 * graded — which is the whole reason this file exists.
 */
function tellingUnit(g) {
  let best = null;
  for (const [id, spec] of Object.entries(UNITS)) {
    if (!spec.ground) continue;
    const m = groundMult(spec, g);
    if (!best || Math.abs(m - 1) > Math.abs(best.m - 1)) best = { id, m };
  }
  return best && Math.abs(best.m - 1) >= 0.05 ? `${best.id} ${fixed(best.m, 2)}x` : '';
}

/**
 * Income, training spend and the difference, for one faction. `net` is the
 * number the player asked for: what the treasury is really doing per second
 * once the strongholds have taken their cut.
 */
export function goldFlow(state, faction) {
  const income = factionGoldPerSec(state, faction);
  const spend = factionTrainCostPerSec(state, faction);
  return { income, spend, net: income - spend };
}

/** The breakdown under the headline net: `+7.0/s income · -3.0/s training`. */
export function flowLine(flow) {
  return `${rate(flow.income)} income · ${rate(-flow.spend)} training`;
}

/**
 * Where a hold-back stepper lands. Pure, so the button's arithmetic is testable
 * and shares the sim's clamp rather than re-implementing the bounds.
 * @param {object} site @param {number} dir -1 or +1
 */
export function stepRallyKeep(site, dir) {
  return clampRallyKeep(rallyKeepOf(site) + dir * RALLY_KEEP.step);
}

/** Rally hold-back readout: `keeps 8` — or `sends everything` at zero. */
export function keepLabel(site) {
  const n = rallyKeepOf(site);
  return n === 0 ? 'sends everything' : `keeps ${n}`;
}
