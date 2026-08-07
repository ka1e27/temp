// Turning gold into soldiers.
//
// GOLD BROWNOUT, NEVER A STALL. If a faction cannot afford full training this
// tick, every one of its sites slows proportionally and records the scaling
// factor, so the HUD can ring the progress arc in amber. Overextending visibly
// runs your strongholds at 60% instead of silently stopping — the failure is
// legible, which is the whole point.
//
// Switching trainType KEEPS trainProgress, so reacting to the enemy's
// composition is never punished.
// PURE.
import { SITES, SITE_LEVELS, UNITS, BOOSTERS, CENTIGOLD } from '../content/balance.js';
import { TICK_HZ } from '../core/loop.js';
import { effectiveLevel } from './state.js';
import { total } from './combat.js';
import { attritionMods, applyGold, goldOf } from './economy.js';
import { pushEvent, EVENTS } from './events.js';

/** Units a site may hold before training stops. Arrivals are never destroyed
 *  by the cap — an over-stuffed garrison simply stops producing (and bleeds
 *  once the attrition ladder bites). */
export function garrisonCap(state, site) {
  const mods = state.mods[site.owner];
  return SITES[site.kind].cap
    + SITE_LEVELS[effectiveLevel(site) - 1].cap
    + (mods?.garrisonCapBonus ?? 0);
}

/** The site's chosen unit, falling back to the faction's first unlock if the
 *  pick is no longer legal (a captured site can inherit an alien trainType). */
export function trainableUnit(site, mods) {
  const unlocked = mods?.unlockedUnits ?? [];
  if (!unlocked.length) return null;
  return unlocked.includes(site.trainType) ? site.trainType : unlocked[0];
}

/** Cycles-per-second multiplier: site kind x level x upgrades x marshal x
 *  War Tithe x the attrition ladder. */
export function trainMultiplier(state, site) {
  const mods = state.mods[site.owner];
  let m = SITES[site.kind].train
    * SITE_LEVELS[effectiveLevel(site) - 1].train
    * (mods?.trainSpeedMult ?? 1)
    * attritionMods(state).trainMult;
  if ((site.garrison.marshal || 0) > 0) m *= 1 + UNITS.marshal.trainBuff;
  if ((state.factions[site.owner]?.trainBoostTicks ?? 0) > 0) m *= BOOSTERS.tithe.trainMult;
  return m;
}

function blockedFor(state, site, unit) {
  if (unit === 'marshal') {
    return (site.garrison.marshal || 0) >= (UNITS.marshal.maxPerSite ?? 1);
  }
  return total(site.garrison) >= garrisonCap(state, site);
}

function completeCycles(state, site, unit) {
  let guard = 0;
  while (site.trainProgress >= 1 && guard++ < 16) {
    if (blockedFor(state, site, unit)) {
      site.trainProgress = 1; // a finished cycle waits for room; nothing is lost
      site.trainBlocked = true;
      return;
    }
    site.trainProgress -= 1;
    const n = UNITS[unit].batch;
    site.garrison[unit] = (site.garrison[unit] || 0) + n;
    pushEvent(state, EVENTS.UNITS_TRAINED, { siteId: site.id, owner: site.owner, unit, count: n });
  }
}

/** Phase 4. One tick of training for every producing site. */
export function runTraining(state) {
  const att = attritionMods(state);
  const jobs = [];
  const demand = { player: 0, enemy: 0 };

  for (const site of state.sites) {
    site.brownout = 1;
    site.trainBlocked = false;
    if (site.owner !== 'player' && site.owner !== 'enemy') continue;
    if (!SITES[site.kind].train) continue;

    const mods = state.mods[site.owner];
    const unit = trainableUnit(site, mods);
    if (!unit) continue;
    site.trainType = unit;
    if (blockedFor(state, site, unit)) { site.trainBlocked = true; continue; }

    const progress = trainMultiplier(state, site) / (UNITS[unit].trainSec * TICK_HZ);
    const cost = UNITS[unit].gold * UNITS[unit].batch * CENTIGOLD * progress
      * (mods.trainCostMult ?? 1) * att.trainCostMult;
    jobs.push({ site, unit, progress, cost });
    demand[site.owner] += cost;
  }

  const scale = { player: 1, enemy: 1 };
  for (const f of ['player', 'enemy']) {
    const purse = goldOf(state.factions[f]);
    if (demand[f] > purse) scale[f] = demand[f] > 0 ? Math.max(0, purse / demand[f]) : 1;
  }

  for (const job of jobs) {
    const s = scale[job.site.owner];
    job.site.brownout = s;
    if (!(s > 0)) continue;
    applyGold(state.factions[job.site.owner], -job.cost * s);
    job.site.trainProgress += job.progress * s;
    completeCycles(state, job.site, job.unit);
  }
}
