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
import {
  SITES, SITE_LEVELS, UNIT_IDS, UNITS, BOOSTERS, CENTIGOLD,
} from '../content/balance.js';
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

/**
 * The site's chosen unit, falling back to the faction's first BUILDABLE unit
 * when the pick is not legal for it.
 *
 * The fallback is what makes a captured yard safe — mapgen hands every site a
 * `trainType` and the enemy's is routinely a type the taker did not bring,
 * which is now the common case rather than the rare one: `unlockedUnits` is the
 * player's LOADOUT (meta/composition.js `battleRoster`), so capturing a
 * spearmen yard with a militia army is an ordinary Tuesday.
 *
 * It filters on `isTrainable` rather than taking `unlocked[0]` on trust,
 * because the roster can contain the marshal — he rides free with every
 * landing — and a site parked on a unit it may only ever hold one of would sit
 * there producing nothing at all.
 */
export function trainableUnit(site, mods) {
  const unlocked = mods?.unlockedUnits ?? [];
  if (unlocked.includes(site.trainType) && isTrainable(site.trainType)) return site.trainType;
  return unlocked.find(isTrainable) ?? null;
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

/**
 * Units a stronghold may be SET TO BUILD.
 *
 * Derived from `maxPerSite`, not listed, because the two halves of that rule are
 * the same rule: a unit you may only ever have one of is commissioned with
 * `RECRUIT` — paid for in gold and delivered at once — and a unit you may have
 * any number of is trained. The marshal is the only one with a cap today.
 *
 * Offering him as a train type was a trap dressed as a choice. It cost the whole
 * site's output for forty seconds to produce a body you are already given free
 * on every landing, left the stronghold building marshals afterwards until you
 * noticed, and the RECRUIT verb exists precisely so that wanting a second one
 * costs gold instead of a wall's production. `cmdTrain` enforces this rather
 * than trusting the picker, so a stale keybinding or a replayed command log
 * cannot set a site to a type the UI no longer offers.
 */
export const TRAINABLE_UNITS = Object.freeze(
  UNIT_IDS.filter((u) => (UNITS[u].maxPerSite ?? Infinity) === Infinity),
);

/** @param {string} unit @returns {boolean} */
export const isTrainable = (unit) => TRAINABLE_UNITS.includes(unit);

function blockedFor(state, site, unit) {
  if (!isTrainable(unit)) {
    return (site.garrison[unit] || 0) >= (UNITS[unit].maxPerSite ?? 1);
  }
  return total(site.garrison) >= garrisonCap(state, site);
}

/**
 * The training job a site would run THIS tick: which unit, how much cycle
 * progress, and what that progress costs in CENTIGOLD. `blocked` means the
 * garrison (or the one-marshal rule) is full, so the site produces and spends
 * nothing. Returns null for a site that cannot train at all.
 *
 * This is the ONE place the cost formula lives: runTraining() builds its job
 * list from it and the site panel reads it, so a readout that disagrees with
 * what the treasury actually pays is not expressible.
 * READ-ONLY — it mutates nothing, which is why the panel may call it.
 */
export function trainJob(state, site) {
  if (site.owner !== 'player' && site.owner !== 'enemy') return null;
  if (!SITES[site.kind].train) return null;
  // Scaffolding builds nothing. `buildTicksLeft` is only ever set on a site
  // battle/construct.js raised, so this is a no-op for every generated map —
  // but a yard that trained while it was still going up would make the timer
  // decorative and the purchase instant.
  if (site.buildTicksLeft > 0) return null;
  const mods = state.mods[site.owner];
  const unit = trainableUnit(site, mods);
  if (!unit) return null;
  if (blockedFor(state, site, unit)) return { unit, progress: 0, cost: 0, blocked: true };

  const progress = trainMultiplier(state, site) / (UNITS[unit].trainSec * TICK_HZ);
  const cost = UNITS[unit].gold * UNITS[unit].batch * CENTIGOLD * progress
    * (mods.trainCostMult ?? 1) * attritionMods(state).trainCostMult;
  return { unit, progress, cost, blocked: false };
}

/** How hard a site is really running: 1 normally, less mid-brownout. It is
 *  last tick's figure, which is precisely what that site last spent. */
const brownoutOf = (site) => (typeof site.brownout === 'number' ? site.brownout : 1);

/** Units per second a site is producing right now — batch size and brownout
 *  included. 0 when it is full, unowned, or cannot train. */
export function siteTrainRate(state, site) {
  const job = trainJob(state, site);
  if (!job || job.blocked) return 0;
  return job.progress * TICK_HZ * UNITS[job.unit].batch * brownoutOf(site);
}

/** Gold per second a site is SPENDING on training right now: the same number
 *  runTraining() takes out of the treasury, in gold rather than centigold. */
export function siteTrainCostPerSec(state, site) {
  const job = trainJob(state, site);
  if (!job || job.blocked) return 0;
  return (job.cost * TICK_HZ * brownoutOf(site)) / CENTIGOLD;
}

/** What a faction is spending on training across every site it holds. */
export function factionTrainCostPerSec(state, faction) {
  let g = 0;
  for (const site of state.sites) {
    if (site.owner === faction) g += siteTrainCostPerSec(state, site);
  }
  return g;
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
  const jobs = [];
  const demand = { player: 0, enemy: 0 };

  for (const site of state.sites) {
    site.brownout = 1;
    site.trainBlocked = false;
    const job = trainJob(state, site);
    if (!job) continue;
    // Recorded even when blocked: a captured site inherits an alien trainType
    // and has to be normalised whether or not it has room to build today.
    site.trainType = job.unit;
    if (job.blocked) { site.trainBlocked = true; continue; }
    jobs.push({ site, unit: job.unit, progress: job.progress, cost: job.cost });
    demand[site.owner] += job.cost;
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
