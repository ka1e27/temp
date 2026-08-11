// The enemy commander.
//
// It reads only battle state and emits the SAME orders a player can — it cannot
// cheat, it cannot see the future, and it never mutates state directly (except
// its own scratchpad under state.ai). Only its knobs change per tier, and they
// come exclusively from AI_TIERS.
//
// The single thing that makes it feel like an opponent rather than a spawner:
// every squad in a wave shares ONE arriveTick. It always strikes synchronized.
//
// Measurements and order-emitters live in ./aicore.js; the home-defence planner
// and the surplus maths live in ./aihome.js; the composition-adaptation phase
// lives in ./aiadapt.js. This file is the phase list.
// PURE.
import { AI } from '../content/balance.js';
import { createRng } from '../core/rng.js';
import { TICK_HZ } from '../core/loop.js';
import {
  power, total, addComp, breachSeconds,
} from './combat.js';
import { siteById, effectiveLevel } from './state.js';
import { distance } from '../core/hex.js';
import { asHex } from './influence.js';
import { groundOf } from './terrain.js';
import { attritionMods } from './economy.js';
import { garrisonCap } from './training.js';
import {
  ME, FOE, STEPS, knobsFor, rampFor, byId, defenceOf, attackPower, sourceFrom, poolOf,
  minFraction, launch, adjacentSources, threatOn, frontDistance,
} from './aicore.js';
import { homeGuard, pressure, commitFor, stagingFor, concurrentFor } from './aihome.js';
import { adapt } from './aiadapt.js';

// --- 1. free lunch ---------------------------------------------------------
// Runs first, at EVERY tier. Leave a farm on 3 militia and it will be taken.
//
// THIS PHASE HAS NO SLOT BUDGET, and that is deliberate — undefended ground is
// free, so refusing it to stay under a concurrency cap would be the AI declining
// a gift. What bounded it instead was the DOORSTEP, and the doorstep used to be
// `site.adj`: an authored planar graph at `targetAvgDegree` 2.8.
//
// Hex reach removed that bound and nothing replaced it. `adj` is 4.7 sites on
// the smallest map and 8.8 on the biggest, so "adjacent and weakly held" became
// most of the board: measured on gallowmoor, tier 3 — `concurrent` 2, and ONE
// during the warm-up — the opening think launched at FIVE distinct targets and
// the player was down from ten sites to five by minute two. The concurrency
// ladder in AI_TIERS was not being disobeyed so much as bypassed.
//
// So the doorstep is explicit and it is a knob, in hexes, exactly as
// `homeRadiusHexes` is. `MOVEMENT.reachHexes` stays the AI's ATTACK horizon —
// what it will march on when it has decided to spend an army. This is the much
// smaller radius inside which it does not have to decide anything.
function freeLunch(state, knobs, out, busy, taken) {
  const targets = {};
  for (const s of state.sites) {
    if (s.owner !== ME) continue;
    const here = asHex(s.hex);
    for (const id of s.adj) {
      const t = siteById(state, id);
      if (!t || t.owner === ME) continue;
      if (distance(here, asHex(t.hex)) > AI.freeLunchHexes) continue;
      targets[t.id] = true;
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

function defend(state, knobs, out, busy, guarded) {
  const mine = state.sites.filter((s) => s.owner === ME)
    .sort((a, b) => (b.kind === 'castle' ? 1 : 0) - (a.kind === 'castle' ? 1 : 0) || byId(a, b));

  for (const site of mine) {
    // The castle was assessed by homeGuard(), which reads a wider radius and can
    // reinforce from further away. Re-running the narrow check here would pull a
    // second wave for a gap that is already closed and in the air.
    if (guarded && site.kind === 'castle') continue;
    const threat = threatOn(state, site);
    if (total(threat) === 0) continue;
    const need = power(threat, site.garrison,
      { statMult: state.mods[FOE]?.unitAtkMult ?? 1, unitMult: state.mods[FOE]?.unitMult })
      * AI.defendMargin;
    if (defenceOf(state, site, threat) >= need) continue;

    const cap = site.kind === 'castle' ? 1 : knobs.commit;
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
  let slots = knobs.concurrentNow - activeAttacks(state).length;
  if (slots <= 0) return;

  const cands = [];
  for (const site of state.sites) {
    if (site.owner === ME || taken[site.id]) continue;
    const sources = adjacentSources(state, site, knobs.commit, busy);
    if (!sources.length) continue;
    const pooled = poolOf(sources);
    if (total(pooled) === 0) continue;
    const need = Math.max(defenceOf(state, site, pooled) * knobs.safetyMargin, 1);
    if (attackPower(state, pooled, site.garrison, groundOf(state, site)) < need) continue;

    const held = site.adj.filter((id) => siteById(state, id)?.owner === ME).length;
    const value = (AI.siteValue[site.kind] ?? 100) * (1 + 0.25 * (site.level - 1))
      * (1 + AI.consolidationBonus * held);
    const score = ((value * 100) / need) * rng.jitter(0.1);
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

function consolidate(state, knobs, out, busy) {
  // stagingRatio 0 keeps a tier out of this entirely. Tier 1 does not mass its
  // rear army forward: staging is what turns a scattered garrison into a rolling
  // offensive, and a first-time player needs room to make the opening mistakes
  // the region is meant to teach.
  if (!(knobs.staging > 0)) return;
  const dist = frontDistance(state);
  for (const site of state.sites.filter((s) => s.owner === ME).sort(byId)) {
    const d = dist[site.id];
    if (d === undefined || d < 2 || busy.has(site.id)) continue; // already on the line
    if (total(threatOn(state, site)) > 0) continue;              // needed where it stands
    // Forward the BANKED army, not the garrison. A rear site holds its keep
    // share of capacity and moves the overflow — which is precisely the
    // production that was being wasted, because a site at cap trains nothing.
    // Draining rear sites to the floor instead is what turned tier 2 from a
    // 60% region into a 9% one: it is not "spend the surplus", it is "commit
    // everything, forever".
    const n = total(site.garrison);
    const keep = knobs.stagingKeep * garrisonCap(state, site);
    if (n <= keep) continue;
    const src = sourceFrom(state, site, Math.min(knobs.staging, (n - keep) / n));
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

function retreat(state, knobs, out, rng, busy) {
  const att = attritionMods(state);
  for (const site of state.sites) {
    if (busy.has(site.id)) continue;  // homeGuard already gave this force orders
    const disciplined = () => rng.next() < knobs.retreatDiscipline;

    if (site.siege?.owner === ME && total(site.siege.comp) > 0) {
      const regenMult = (state.mods[site.owner]?.structureRegenMult ?? 1) * att.regenMult;
      const secs = breachSeconds(
        site.siege.comp, site.hp, site.kind, effectiveLevel(site),
        state.mods[ME]?.siegeDmgMult ?? 1, regenMult, groundOf(state, site),
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
    const atk = state.mods[FOE]?.unitAtkMult ?? 1;
    const tp = power(threat, site.garrison,
      { statMult: atk, unitMult: state.mods[FOE]?.unitMult, ground: groundOf(state, site) });
    if (tp > defenceOf(state, site, threat) * 2 && disciplined()) {
      out.push({ t: 'RETREAT', by: ME, site: site.id });
    }
  }
}

// --- 6. adapt composition lives in ./aiadapt.js -----------------------------

// --- entry point -----------------------------------------------------------

/**
 * Phase 9. Pushes commands onto state.commands for the NEXT tick to drain.
 * Think time jitters +/-20% off the seeded RNG so it never feels metronomic;
 * the rng state is written back so the whole battle stays deterministic.
 */
export function think(state) {
  if (state.status !== 'running') return;
  if (state.tick < (state.ai.nextThinkTick ?? 0)) return;

  // The tier's numbers, softened while the enemy is still getting going. You
  // are raiding country it already owns; the first ninety seconds are the only
  // window a small landing force has to become an army.
  const tier = rampFor(state, knobsFor(state));
  const rng = createRng(state.rngState >>> 0);
  const out = [];
  const busy = new Set();   // sources committed this think — local, never stored
  const taken = {};         // targets committed this think

  // Everything downstream spends army, so measure the surplus before any of it
  // has been promised, then hand the phases the ratios it buys.
  const p = pressure(state);
  const knobs = {
    ...tier,
    commit: commitFor(tier, p),
    staging: stagingFor(tier, p),
    concurrentNow: concurrentFor(tier, p),
  };
  state.ai.pressure = p;

  const guarded = homeGuard(state, out, busy);
  freeLunch(state, knobs, out, busy, taken);
  defend(state, knobs, out, busy, guarded);
  attack(state, knobs, out, busy, taken, rng);
  consolidate(state, knobs, out, busy);
  retreat(state, knobs, out, rng, busy);
  adapt(state, knobs, out);

  for (const cmd of out) state.commands.push(cmd);
  state.ai.activeAttacks = activeAttacks(state);
  state.ai.nextThinkTick = state.tick
    + Math.max(1, Math.round(tier.reactionTicks * rng.jitter(AI.thinkJitter)));
  state.rngState = rng.state;
}
