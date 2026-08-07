// The enemy commander.
//
// It reads only battle state and emits the SAME orders a player can — it cannot
// cheat, it cannot see the future, and it never mutates state directly (except
// its own scratchpad under state.ai). Only its knobs change per tier, and they
// come exclusively from AI_TIERS.
//
// The single thing that makes it feel like an opponent rather than a spawner:
// every squad in a wave shares ONE arriveTick. It always strikes synchronized.
// PURE.
import { AI_TIERS, AI, UNIT_IDS, SITES, RALLY_MIN_GARRISON } from '../content/balance.js';
import { createRng } from '../core/rng.js';
import { TICK_HZ } from '../core/loop.js';
import {
  power, total, emptyComp, addComp, scaleComp, breachSeconds, siegeDps, siteRegen,
} from './combat.js';
import { siteById, effectiveLevel } from './state.js';
import { travelTicks } from './movement.js';
import { attritionMods } from './economy.js';
import { garrisonCap } from './training.js';

const ME = 'enemy';
const FOE = 'player';
const STEPS = 20; // fraction search resolution: 5% increments

const knobsFor = (state) => AI_TIERS[
  Math.max(0, Math.min(AI_TIERS.length - 1, (state.rules?.aiTier ?? 1) - 1))
];

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Never strip the castle down to nothing — losing it loses the battle. */
const floorFor = (site) => (site.kind === 'castle'
  ? Math.max(AI.garrisonFloor, RALLY_MIN_GARRISON) : AI.garrisonFloor);

function defenceOf(state, site, attComp) {
  return power(site.garrison, attComp, {
    defending: true,
    onOwnSite: true,
    siteDefMult: SITES[site.kind].defMult,
    statMult: state.mods[site.owner]?.unitDefMult ?? 1,
  });
}

const attackPower = (state, comp, foe) =>
  power(comp, foe, { statMult: state.mods[ME]?.unitAtkMult ?? 1 });

/** What a site can spare: capped by the tier's commit ratio and the floor. */
function sourceFrom(state, site, cap) {
  const n = total(site.garrison);
  const floor = floorFor(site);
  if (n <= floor) return null;
  const availFrac = Math.min(cap, (n - floor) / n);
  const avail = scaleComp(site.garrison, availFrac);
  if (total(avail) === 0) return null;
  return { site, availFrac, avail };
}

const poolOf = (sources, frac = 1) => sources
  .reduce((c, s) => addComp(c, scaleComp(s.avail, frac)), emptyComp());

/** Can this force actually out-pace the walls, or would it just sit there? A
 *  stack that wins the field but cannot breach is an army thrown away. */
function breachable(state, comp, site) {
  const regenMult = (state.mods[site.owner]?.structureRegenMult ?? 1)
    * attritionMods(state).regenMult;
  return siegeDps(comp, state.mods[ME]?.siegeDmgMult ?? 1)
    > siteRegen(site.kind, effectiveLevel(site), regenMult);
}

/** Smallest uniform fraction of the pooled force that beats the garrison AND
 *  breaks the walls. Null when even everything available is not enough. */
function minFraction(state, sources, need, target) {
  for (let i = 1; i <= STEPS; i++) {
    const f = i / STEPS;
    const comp = poolOf(sources, f);
    if (total(comp) === 0) continue;
    if (attackPower(state, comp, target.garrison) >= need && breachable(state, comp, target)) {
      return f;
    }
  }
  return null;
}

/** Issue one synchronized wave: every squad gets the SAME arriveTick, held
 *  back to the slowest contributor. Orders execute next tick, hence the +1. */
function launch(state, out, sources, target, frac, busy) {
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

function adjacentSources(state, site, cap, busy) {
  return site.adj
    .map((id) => siteById(state, id))
    .filter((s) => s && s.owner === ME && !busy.has(s.id))
    .sort(byId)
    .map((s) => sourceFrom(state, s, cap))
    .filter(Boolean);
}

// --- 1. free lunch ---------------------------------------------------------
// Runs first, at EVERY tier. Leave a farm on 3 militia and it will be taken.

function freeLunch(state, knobs, out, busy, taken) {
  const targets = {};
  for (const s of state.sites) {
    if (s.owner !== ME) continue;
    for (const id of s.adj) {
      const t = siteById(state, id);
      if (t && t.owner !== ME) targets[t.id] = true;
    }
  }
  for (const id of Object.keys(targets).sort()) {
    const target = siteById(state, id);
    if (taken[target.id]) continue;
    const sources = adjacentSources(state, target, 1, busy);
    if (!sources.length) continue;
    const pooled = poolOf(sources);
    const def = defenceOf(state, target, pooled);
    if (def > AI.freeLunchDefence) continue;
    const need = Math.max(def * knobs.safetyMargin, 1);
    const frac = minFraction(state, sources, need, target);
    if (frac == null) continue;
    if (launch(state, out, sources, target, frac, busy)) taken[target.id] = true;
  }
}

// --- 2. defend -------------------------------------------------------------

function threatOn(state, site) {
  let comp = emptyComp();
  if (site.siege && site.siege.owner === FOE) comp = addComp(comp, site.siege.comp);
  for (const sq of state.squads) {
    if (sq.owner !== FOE || sq.to !== site.id || sq.retreating) continue;
    if (sq.arriveTick - state.tick > AI.threatHorizonTicks) continue;
    comp = addComp(comp, sq.comp);
  }
  return comp;
}

function defend(state, knobs, out, busy) {
  const mine = state.sites.filter((s) => s.owner === ME)
    .sort((a, b) => (b.kind === 'castle' ? 1 : 0) - (a.kind === 'castle' ? 1 : 0) || byId(a, b));

  for (const site of mine) {
    const threat = threatOn(state, site);
    if (total(threat) === 0) continue;
    const need = power(threat, site.garrison, { statMult: state.mods[FOE]?.unitAtkMult ?? 1 })
      * AI.defendMargin;
    if (defenceOf(state, site, threat) >= need) continue;

    const cap = site.kind === 'castle' ? 1 : knobs.commitRatio;
    const sources = adjacentSources(state, site, cap, busy);
    if (!sources.length) continue;
    for (let i = 1; i <= STEPS; i++) {
      const f = i / STEPS;
      const help = poolOf(sources, f);
      if (total(help) === 0) continue;
      const bolstered = { ...site, garrison: addComp(site.garrison, help) };
      if (defenceOf(state, bolstered, threat) >= need || i === STEPS) {
        launch(state, out, sources, site, f, busy);
        break;
      }
    }
  }
}

// --- 3 & 4. score attacks, commit the minimum ------------------------------

function activeAttacks(state) {
  const targets = {};
  for (const s of state.sites) if (s.siege?.owner === ME) targets[s.id] = true;
  for (const sq of state.squads) {
    if (sq.owner !== ME || sq.retreating) continue;
    const t = siteById(state, sq.to);
    if (t && t.owner !== ME) targets[t.id] = true;
  }
  return Object.keys(targets);
}

function attack(state, knobs, out, busy, taken, rng) {
  let slots = knobs.concurrent - activeAttacks(state).length;
  if (slots <= 0) return;

  const cands = [];
  for (const site of state.sites) {
    if (site.owner === ME || taken[site.id]) continue;
    const sources = adjacentSources(state, site, knobs.commitRatio, busy);
    if (!sources.length) continue;
    const pooled = poolOf(sources);
    if (total(pooled) === 0) continue;
    const need = Math.max(defenceOf(state, site, pooled) * knobs.safetyMargin, 1);
    if (attackPower(state, pooled, site.garrison) < need) continue;

    const held = site.adj.filter((id) => siteById(state, id)?.owner === ME).length;
    const value = (AI.siteValue[site.kind] ?? 100) * (1 + 0.25 * (site.level - 1))
      * (1 + AI.consolidationBonus * held);
    const score = (value * 100) / need * knobs.aggression * rng.jitter(0.1);
    cands.push({ site, sources, need, score });
  }

  cands.sort((a, b) => b.score - a.score || byId(a.site, b.site));
  for (const c of cands) {
    if (slots <= 0) break;
    if (c.sources.some((s) => busy.has(s.site.id))) continue;
    const frac = minFraction(state, c.sources, c.need, c.site);
    if (frac == null) continue;
    if (launch(state, out, c.sources, c.site, frac, busy)) {
      taken[c.site.id] = true;
      slots--;
    }
  }
}

// --- 4b. consolidate -------------------------------------------------------
// Sends are adjacent-only, so a stronghold two hops behind the line can never
// join an attack on its own. Without this the AI banks a huge rear army and
// feels like a punching bag; with it, the army streams to the front.

/** Hops from every site the AI holds to the nearest site it does not. */
function frontDistance(state) {
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

function consolidate(state, knobs, out, busy) {
  const dist = frontDistance(state);
  for (const site of state.sites.filter((s) => s.owner === ME).sort(byId)) {
    const d = dist[site.id];
    if (d === undefined || d < 2 || busy.has(site.id)) continue; // already on the line
    if (total(threatOn(state, site)) > 0) continue;              // needed where it stands
    const src = sourceFrom(state, site, knobs.commitRatio);
    if (!src) continue;
    // Mass, but not without limit: a front site takes up to stagingCapMult of
    // its garrison cap, which is enough to strike with and still legible.
    const forward = site.adj
      .map((id) => siteById(state, id))
      .filter((n) => n && n.owner === ME && dist[n.id] < d
        && total(n.garrison) < garrisonCap(state, n) * AI.stagingCapMult)
      .sort(byId)[0];
    if (!forward) continue;
    out.push({ t: 'SEND', by: ME, from: site.id, to: forward.id, fraction: src.availFrac });
    busy.add(site.id);
  }
}

// --- 5. retreat ------------------------------------------------------------
// The same order the player has. T1 almost never uses it (it feeds you its
// army, which is part of why it is beatable); T4 pulls out and re-commits.

function reliefSeconds(state, site) {
  let best = Infinity;
  for (const sq of state.squads) {
    if (sq.owner !== FOE || sq.to !== site.id || sq.retreating) continue;
    best = Math.min(best, (sq.arriveTick - state.tick) / TICK_HZ);
  }
  return best;
}

function retreat(state, knobs, out, rng) {
  const att = attritionMods(state);
  for (const site of state.sites) {
    const disciplined = () => rng.next() < knobs.retreatDiscipline;

    if (site.siege?.owner === ME && total(site.siege.comp) > 0) {
      const regenMult = (state.mods[site.owner]?.structureRegenMult ?? 1) * att.regenMult;
      const secs = breachSeconds(
        site.siege.comp, site.hp, site.kind, effectiveLevel(site),
        state.mods[ME]?.siegeDmgMult ?? 1, regenMult,
      );
      const relief = reliefSeconds(state, site);
      const doomed = !Number.isFinite(secs)
        || (Number.isFinite(relief) && secs > relief + AI.reliefMarginSec);
      if (doomed && disciplined()) out.push({ t: 'RETREAT', by: ME, site: site.id });
      continue;
    }

    if (site.owner !== ME || site.kind === 'castle' || total(site.garrison) === 0) continue;
    const threat = threatOn(state, site);
    if (total(threat) === 0) continue;
    const tp = power(threat, site.garrison, { statMult: state.mods[FOE]?.unitAtkMult ?? 1 });
    if (tp > defenceOf(state, site, threat) * 2 && disciplined()) {
      out.push({ t: 'RETREAT', by: ME, site: site.id });
    }
  }
}

// --- 6. adapt composition (tier 3+ only) -----------------------------------

function playerArmy(state) {
  let comp = emptyComp();
  for (const s of state.sites) {
    if (s.owner === FOE) comp = addComp(comp, s.garrison);
    if (s.siege?.owner === FOE) comp = addComp(comp, s.siege.comp);
  }
  for (const sq of state.squads) if (sq.owner === FOE) comp = addComp(comp, sq.comp);
  return comp;
}

function adapt(state, knobs, out, rng) {
  const seen = state.ai.seenPlayerComp ?? emptyComp();
  const now = playerArmy(state);
  const sample = emptyComp();
  const d = AI.sampleDecay;
  for (const u of UNIT_IDS) sample[u] = (seen[u] || 0) * d + (now[u] || 0) * (1 - d);
  state.ai.seenPlayerComp = sample;

  const unlocked = state.mods[ME]?.unlockedUnits ?? [];
  const trainers = state.sites
    .filter((s) => s.owner === ME && SITES[s.kind].train > 0).sort(byId);

  // Rams are a tier knob, not an adaptation: even T1 brings one occasionally.
  const sieging = state.sites.some((s) => s.siege?.owner === ME);
  if (sieging && unlocked.includes('rams')) {
    for (const site of trainers) {
      if (site.kind !== 'stronghold' || site.trainType === 'rams') continue;
      if (rng.next() < knobs.ramAppetite * AI.ramTrainShare) {
        out.push({ t: 'TRAIN', by: ME, site: site.id, unit: 'rams' });
      }
    }
  }

  if (!knobs.adaptComposition) return;
  const dominant = UNIT_IDS
    .filter((u) => sample[u] > 0)
    .sort((a, b) => sample[b] - sample[a] || (a < b ? -1 : 1))[0];
  if (!dominant) return;
  const pick = AI.counterPick[dominant];
  if (!pick || !unlocked.includes(pick)) return;
  for (const site of trainers) {
    if (site.trainType === pick || site.trainType === 'rams') continue;
    out.push({ t: 'TRAIN', by: ME, site: site.id, unit: pick });
  }
}

// --- entry point -----------------------------------------------------------

/**
 * Phase 9. Pushes commands onto state.commands for the NEXT tick to drain.
 * Think time jitters +/-20% off the seeded RNG so it never feels metronomic;
 * the rng state is written back so the whole battle stays deterministic.
 */
export function think(state) {
  if (state.status !== 'running') return;
  if (state.tick < (state.ai.nextThinkTick ?? 0)) return;

  const knobs = knobsFor(state);
  const rng = createRng(state.rngState >>> 0);
  const out = [];
  const busy = new Set();   // sources committed this think — local, never stored
  const taken = {};         // targets committed this think

  freeLunch(state, knobs, out, busy, taken);
  defend(state, knobs, out, busy);
  attack(state, knobs, out, busy, taken, rng);
  consolidate(state, knobs, out, busy);
  retreat(state, knobs, out, rng);
  adapt(state, knobs, out, rng);

  for (const cmd of out) state.commands.push(cmd);
  state.ai.activeAttacks = activeAttacks(state);
  state.ai.nextThinkTick = state.tick
    + Math.max(1, Math.round(knobs.reactionTicks * rng.jitter(AI.thinkJitter)));
  state.rngState = rng.state;
}
