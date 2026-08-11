// The enemy commander's primitives: reading the board, costing an assault, and
// issuing one synchronized wave.
//
// Split out of ai.js so the phase list and the home-defence planner can share
// them without either file growing past the budget. Nothing here decides
// anything — every function is a measurement or an order-emitter.
// PURE.
import { TICK_HZ } from '../core/loop.js';
import { AI_TIERS, AI, RALLY_MIN_GARRISON } from '../content/balance.js';
import {
  power, total, emptyComp, addComp, scaleComp, breachSeconds, siegeDps, siteRegen,
} from './combat.js';
import { siteById, effectiveLevel } from './state.js';
import { distance } from '../core/hex.js';
import { asHex } from './influence.js';
import { groundOf, siteDefMultOf, garrisonMultOf } from './terrain.js';
import { travelTicks } from './movement.js';
import { attritionMods } from './economy.js';

export const ME = 'enemy';
export const FOE = 'player';
export const STEPS = 20; // fraction search resolution: 5% increments

export const knobsFor = (state) => AI_TIERS[
  Math.max(0, Math.min(AI_TIERS.length - 1, (state.rules?.aiTier ?? 1) - 1))
];

/**
 * How far through its warm-up the enemy is: 0 on tick 0, 1 once `rampSec` has
 * elapsed. PURE, and a function of the TICK — so it is part of the simulation
 * and replays identically, unlike anything read off a clock.
 */
export function warmupProgress(state) {
  // Per TIER, falling back to the campaign-wide value. A tier-5 landing owns a
  // raider's share of a 48-site map and has to convert the neutral pool before
  // it has an economy; the warm-up is the window that happens in, so it scales
  // with how much there is to take. Still a pure function of `state.tick`, so
  // it replays identically.
  const ramp = (knobsFor(state).warmupSec ?? AI.warmup?.rampSec ?? 0) * TICK_HZ;
  if (!(ramp > 0)) return 1;
  return Math.min(1, Math.max(0, (state.tick ?? 0) / ramp));
}

/**
 * The tier's knobs, softened by how early in the battle it is.
 *
 * Interpolates each multiplier from its opening value toward 1 as the warm-up
 * completes, so there is no step change anywhere — an enemy that suddenly
 * doubled its appetite at second 90 would read as a scripted event rather than
 * as a war getting going.
 */
export function rampFor(state, knobs) {
  const t = warmupProgress(state);
  if (t >= 1) return knobs;
  const w = AI.warmup;
  const ease = (mult) => mult + (1 - mult) * t;
  return {
    ...knobs,
    safetyMargin: knobs.safetyMargin * ease(w.safetyMult),
    commitRatio: knobs.commitRatio * ease(w.commitMult),
    concurrent: Math.max(1, knobs.concurrent - Math.round(w.holdConcurrent * (1 - t))),
  };
}

export const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Never strip the castle down to nothing — losing it loses the battle. */
export const floorFor = (site) => (site.kind === 'castle'
  ? Math.max(AI.garrisonFloor, RALLY_MIN_GARRISON) : AI.garrisonFloor);

// Reads the SAME terrain the player does: an AI blind to the ground marches
// its rams up a mountain and never learns why the wall holds.
export function defenceOf(state, site, attComp) {
  return power(site.garrison, attComp, {
    defending: true,
    onOwnSite: true,
    siteDefMult: siteDefMultOf(state, site),
    garrisonMult: garrisonMultOf(state, site),
    statMult: state.mods[site.owner]?.unitDefMult ?? 1,
    unitMult: state.mods[site.owner]?.unitMult, ground: groundOf(state, site),
  });
}

export const attackPower = (state, comp, foe, ground = null) =>
  power(comp, foe, {
    statMult: state.mods[ME]?.unitAtkMult ?? 1, unitMult: state.mods[ME]?.unitMult, ground,
  });

/** What a site can spare: capped by the tier's commit ratio and the floor. */
export function sourceFrom(state, site, cap) {
  const n = total(site.garrison);
  const floor = floorFor(site);
  if (n <= floor) return null;
  const availFrac = Math.min(cap, (n - floor) / n);
  const avail = scaleComp(site.garrison, availFrac);
  if (total(avail) === 0) return null;
  return { site, availFrac, avail };
}

export const poolOf = (sources, frac = 1) => sources
  .reduce((c, s) => addComp(c, scaleComp(s.avail, frac)), emptyComp());

/** Can this force actually out-pace the walls, or would it just sit there? A
 *  stack that wins the field but cannot breach is an army thrown away. */
export function breachable(state, comp, site) {
  const regenMult = (state.mods[site.owner]?.structureRegenMult ?? 1)
    * attritionMods(state).regenMult;
  return siegeDps(comp, state.mods[ME]?.siegeDmgMult ?? 1, groundOf(state, site))
    > siteRegen(site.kind, effectiveLevel(site), regenMult);
}

/** Smallest uniform fraction of the pooled force that beats the garrison AND
 *  breaks the walls. Null when even everything available is not enough. */
export function minFraction(state, sources, need, target) {
  const g = groundOf(state, target);
  for (let i = 1; i <= STEPS; i++) {
    const f = i / STEPS;
    const comp = poolOf(sources, f);
    if (total(comp) === 0) continue;
    if (attackPower(state, comp, target.garrison, g) >= need
      && breachable(state, comp, target)) return f;
  }
  return null;
}

/** Issue one synchronized wave: every squad gets the SAME arriveTick, held
 *  back to the slowest contributor. Orders execute next tick, hence the +1. */
export function launch(state, out, sources, target, frac, busy) {
  const parts = [];
  let common = 0;
  for (const s of sources) {
    const comp = scaleComp(s.avail, frac);
    if (total(comp) === 0) continue;
    const eta = state.tick + 1 + travelTicks(state, s.site, target, comp, ME);
    if (eta > common) common = eta;
    parts.push({ from: s.site.id, fraction: Math.min(1, s.availFrac * frac) });
  }
  for (const p of parts) {
    out.push({
      t: 'SEND', by: ME, from: p.from, to: target.id, fraction: p.fraction, arriveTick: common,
    });
    busy.add(p.from);
  }
  return parts.length > 0;
}

/**
 * The sites that can feed one attack, NEAREST FIRST and capped.
 *
 * The cap is the whole of this function's new job, and it is not tuning fussiness
 * — it is the thing that stopped existing. Under the authored site graph this
 * was bounded at `targetAvgDegree` 2.8 BY ACCIDENT: `site.adj` was a planar
 * graph, so "every neighbour that can spare troops" was about three sites, and
 * every AI knob calibrated against that number without anybody writing it down.
 *
 * Hex reach removed the accident. `adj` is now 4.7 sites on the smallest map and
 * 8.8 on the biggest, so one attack drew from three times the ground it used to
 * and the enemy concentrated overwhelming force on every target at once.
 * Measured at n=16: riverfen fell 88% -> 81%, kaldan 82% -> 56% and gallowmoor
 * 67% -> ZERO. A cliff rather than a slope, and the shape of it is the tell —
 * the bigger and denser the map, the more sources the AI gained.
 *
 * So the bound is explicit and it is a knob. Nearest first, because a relief
 * force that has to cross the map is not relief.
 */
export function adjacentSources(state, site, cap, busy) {
  const here = asHex(site.hex);
  return site.adj
    .map((id) => siteById(state, id))
    .filter((s) => s && s.owner === ME && !busy.has(s.id))
    .sort((a, b) => distance(here, asHex(a.hex)) - distance(here, asHex(b.hex)) || byId(a, b))
    .slice(0, AI.maxSources)
    .map((s) => sourceFrom(state, s, cap))
    .filter(Boolean);
}

/** Everything the player has pointed at this site RIGHT NOW: a live siege plus
 *  any squad that lands inside the reaction horizon. */
export function threatOn(state, site) {
  let comp = emptyComp();
  if (site.siege && site.siege.owner === FOE) comp = addComp(comp, site.siege.comp);
  for (const sq of state.squads) {
    if (sq.owner !== FOE || sq.to !== site.id || sq.retreating) continue;
    if (sq.arriveTick - state.tick > AI.threatHorizonTicks) continue;
    comp = addComp(comp, sq.comp);
  }
  return comp;
}

/** Hops from every site the AI holds to the nearest site it does not. */
export function frontDistance(state) {
  const dist = {};
  const queue = [];
  for (const s of state.sites) if (s.owner !== ME) { dist[s.id] = 0; queue.push(s); }
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    for (const id of cur.adj) {
      if (dist[id] !== undefined) continue;
      const next = siteById(state, id);
      if (!next) continue;
      dist[id] = dist[cur.id] + 1;
      queue.push(next);
    }
  }
  return dist;
}
