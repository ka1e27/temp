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
// and the surplus maths live in ./aihome.js. This file is the phase list.
// PURE.
import { AI, UNIT_IDS, SITES, MAPGEN } from '../content/balance.js';
import { createRng } from '../core/rng.js';
import { TICK_HZ } from '../core/loop.js';
import {
  power, total, emptyComp, addComp, breachSeconds,
} from './combat.js';
import { siteById, effectiveLevel } from './state.js';
import { groundOf } from './terrain.js';
import { attritionMods } from './economy.js';
import { garrisonCap } from './training.js';
import {
  ME, FOE, STEPS, knobsFor, byId, defenceOf, attackPower, sourceFrom, poolOf,
  minFraction, launch, adjacentSources, threatOn, frontDistance,
} from './aicore.js';
import { homeGuard, pressure, commitFor, stagingFor, concurrentFor } from './aihome.js';

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
    const need = power(threat, site.garrison, { statMult: state.mods[FOE]?.unitAtkMult ?? 1 })
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
    const tp = power(threat, site.garrison, { statMult: atk, ground: groundOf(state, site) });
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

/**
 * Move `want` of `pool` onto `unit`, counting what is already there. Sites past
 * the share go back to the kind's default, so the mix CONVERGES on the share
 * instead of drifting toward whatever was picked last.
 */
function retrain(out, pool, unit, want) {
  const n = Math.max(0, Math.min(pool.length, Math.round(want)));
  const on = pool.filter((s) => s.trainType === unit);
  const off = pool.filter((s) => s.trainType !== unit);
  for (let i = on.length; i < n && off.length; i++) {
    const site = off.shift();
    out.push({ t: 'TRAIN', by: ME, site: site.id, unit });
  }
  for (let i = n; i < on.length; i++) {
    const site = on[i];
    const back = MAPGEN.trainType[site.kind];
    if (back && back !== unit) out.push({ t: 'TRAIN', by: ME, site: site.id, unit: back });
  }
}

/**
 * What the enemy builds. TWO SHARES OF PRODUCTION, NOT TWO COIN FLIPS.
 *
 * `ramTrainShare` and the counter-train share both used to be rolled per think
 * against every eligible site, which RATCHETS — a stronghold that flipped never
 * flipped back — so a few minutes in, every wall in the region was held by
 * def-2 rams or def-4 raiders instead of def-8 spearmen behind a 1.75 bulwark.
 * Only tiers 3 and 4 counter-train at all, so the effect landed exactly on the
 * regions that are supposed to be the hardest: measured at n=48 with the tail
 * dial already re-curved, obsidian won 83% in 5.0m against a 23-minute target
 * while tier-2 highmarch — which cannot adapt and therefore kept its spearwall —
 * won 8%. The enemy was disarming itself, and it looked like a difficulty curve.
 *
 * `adaptComposition: boolean` is now `counterShare: number`, for the same reason
 * `staging: boolean` became `stagingRatio`/`stagingKeep` (see content/ai.data.js):
 * a boolean is a CLIFF. Measured at n=96, turning it off was worth 17 points of
 * win rate on gallowmoor and 32 on karrowmere — the largest difficulty step in
 * the campaign, and an unadvertised flag flipping at a tier boundary.
 *
 * Now the AI answers what you field with a PORTION of its production and keeps a
 * spear backbone behind it, which is what makes "the enemy counter-trains here"
 * (duskfell) a threat rather than a gift.
 */
function adapt(state, knobs, out) {
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
  // They are also worthless on defence, so the appetite only applies while there
  // is a wall to knock down — when the siege ends, the yards go back to spears.
  const sieging = state.sites.some((s) => s.siege?.owner === ME);
  const strongholds = trainers.filter((s) => s.kind === 'stronghold');
  // THE SPEAR BACKBONE IS RESERVED BEFORE EITHER PASS SPENDS ANYTHING. Rams and
  // the counter-pick are two independent shares of the same strongholds, and
  // nothing used to add them up: measured on obsidian, a 50% ram appetite over
  // seven walls took four, the counter share took the fifth, and two captured
  // neutral forts were already on the counter unit — seven walls, not one of
  // them a wall. Reserving one first is a cap on the SUM, which is the only
  // place the guarantee can live; `retrain` walks the surplus back to spearmen
  // on its own, so this also un-does a backbone an earlier think spent.
  const spendable = Math.max(0, strongholds.length - (strongholds.length >= 2 ? 1 : 0));
  let rams = 0;
  if (unlocked.includes('rams')) {
    // A share, but never a share that rounds to nothing: on a small map two
    // strongholds times 0.4 is zero engines, and "the enemy brings its own
    // rams" would silently be false for exactly the maps you can see it on.
    const want = sieging
      ? Math.max(1, strongholds.length * AI.ramTrainShare * knobs.ramAppetite) : 0;
    rams = Math.min(Math.round(want), spendable);
    retrain(out, strongholds, 'rams', rams);
  }

  if (!(knobs.counterShare > 0)) return;
  const dominant = UNIT_IDS
    .filter((u) => sample[u] > 0)
    .sort((a, b) => sample[b] - sample[a] || (a < b ? -1 : 1))[0];
  if (!dominant) return;
  const pick = AI.counterPick[dominant];
  if (!pick || !unlocked.includes(pick)) return;
  // STRONGHOLDS adapt; the castle does not. The throne is the win condition, so
  // it builds the kind's default and keeps building it — chasing the player's
  // composition with the one garrison that cannot be allowed to lose is how an
  // AI talks itself into holding its capital with siege engines.
  // A stronghold ALREADY building rams is off the table too, not just one that
  // was ordered this think: filtering only on `out` let the two passes consume
  // the same wall between them. The ram pass frees them again when the siege
  // ends, by ordering them back to spearmen.
  const pool = strongholds.filter((s) => s.trainType !== 'rams'
    && !out.some((c) => c.t === 'TRAIN' && c.site === s.id));
  // Same floor as the ram appetite, and for the same reason — but it does not
  // get to spend the wall the ram appetite left standing.
  const want = Math.max(1, pool.length * knobs.counterShare);
  retrain(out, pool, pick, Math.min(Math.round(want), Math.max(0, spendable - rams)));

  // Finally, anything still building an OLD pick. `retrain` only walks back the
  // one unit it was asked about, so when the player switches army the previous
  // answer is ORPHANED and that yard builds it forever. Measured on obsidian:
  // two captured forts sat on militia long after the spearmen they answered
  // were gone, which is how seven strongholds ended up with no spearwall.
  for (const s of strongholds) {
    const ordered = out.find((c) => c.t === 'TRAIN' && c.site === s.id);
    const unit = ordered ? ordered.unit : s.trainType;
    const back = MAPGEN.trainType[s.kind];
    if (unit === back || unit === pick || unit === 'rams') continue;
    if (ordered) ordered.unit = back;
    else out.push({ t: 'TRAIN', by: ME, site: s.id, unit: back });
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

  const tier = knobsFor(state);
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
