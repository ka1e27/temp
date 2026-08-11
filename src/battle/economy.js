// Battle-local gold. Held in integer CENTIGOLD (1g = 100cg) so income is
// exactly reproducible; the sub-centigold remainder is carried in a companion
// float, which keeps a 0.85x economy multiplier from silently rounding away.
//
// Economy is the real battlefield: starving the enemy's farms beats grinding
// their army, so a farm captured is worth more than the fight it cost.
// PURE.
import { SITES, SITE_LEVELS, CENTIGOLD, ATTRITION, AI_TIERS } from '../content/balance.js';
import { TICK_HZ } from '../core/loop.js';
import { effectiveLevel } from './state.js';
import { terrainGoldMult } from './terrain.js';

const NO_ATTRITION = Object.freeze({
  afterSec: 0, farmMult: 1, regenMult: 1, garrisonBleed: 0, trainMult: 1, trainCostMult: 1,
});

/** The active rung of the anti-stalemate ladder. Stage 0 == a healthy battle. */
export function attritionMods(state) {
  const stage = state.meta?.attritionStage ?? 0;
  return stage > 0 ? ATTRITION[Math.min(stage, ATTRITION.length) - 1] : NO_ATTRITION;
}

/** The enemy's tier-scaled economy handicap. The player is always 1.0. */
export function economyMultFor(state, faction) {
  if (faction !== 'enemy') return 1;
  const i = Math.max(0, Math.min(AI_TIERS.length - 1, (state.rules?.aiTier ?? 1) - 1));
  return AI_TIERS[i].economyMult;
}

/** Move gold, keeping goldCg an integer >= 0 and the remainder on goldFracCg. */
export function applyGold(faction, deltaCg) {
  const t = Math.max(0, faction.goldCg + (faction.goldFracCg ?? 0) + deltaCg);
  faction.goldCg = Math.floor(t);
  faction.goldFracCg = t - faction.goldCg;
}

/** Spendable centigold, remainder included. */
export const goldOf = (faction) => faction.goldCg + (faction.goldFracCg ?? 0);

/**
 * Gold per second a single site pays its owner right now. Exported because the
 * HUD needs the same number the sim uses, and because the AI reads it to value
 * a target. An upgrade in progress still produces at the OLD level.
 *
 * THE ONLY PLACE farm income is computed — terrain included. A farm on a
 * watercourse is worth TERRAIN.riverFarmGold, and it is worth that here and
 * nowhere else, so the site panel, the HUD income line, the AI's valuation of a
 * target and the treasury cannot disagree about which farms are the rich ones.
 */
export function siteGoldPerSec(state, site) {
  const base = SITES[site.kind].gold;
  if (!base || (site.owner !== 'player' && site.owner !== 'enemy')) return 0;
  // A farm that paid for itself while it was still being dug would make the
  // build timer decorative. Only ever set on a site battle/construct.js raised,
  // so every generated map is untouched by this line.
  if (site.buildTicksLeft > 0) return 0;
  const mods = state.mods[site.owner];
  const lvl = SITE_LEVELS[effectiveLevel(site) - 1];
  const farm = site.kind === 'farm' ? (mods.farmYieldMult ?? 1) * attritionMods(state).farmMult : 1;
  return base * lvl.gold * (mods.goldRateMult ?? 1) * farm
    * terrainGoldMult(state, site) * economyMultFor(state, site.owner);
}

/**
 * Gold per second a faction earns from everything it holds. Summed from the
 * same per-site function runEconomy() credits with, so the HUD's income line
 * and the treasury cannot drift apart the way a re-derived rate does.
 */
export function factionGoldPerSec(state, faction) {
  let g = 0;
  for (const site of state.sites) {
    if (site.owner === faction) g += siteGoldPerSec(state, site);
  }
  return g;
}

/** Phase 3. Credit one tick of income to both factions. */
export function runEconomy(state) {
  const perTick = { player: 0, enemy: 0 };
  for (const site of state.sites) {
    const rate = siteGoldPerSec(state, site);
    if (rate) perTick[site.owner] += (rate * CENTIGOLD) / TICK_HZ;
  }
  for (const f of ['player', 'enemy']) {
    if (!perTick[f]) continue;
    applyGold(state.factions[f], perTick[f]);
    state.factions[f].goldEarnedCg += perTick[f];
  }
}
