// THE INCURSION LADDER — planning and application. The numbers are all in
// content/incursion.data.js and every crown is in ./rewards.js.
//
// One rung is one battle: a region you have already taken, its own dial grown by
// the depth, and one to three MUTATORS that change which answer is correct. Win
// and the ladder advances; lose and nothing at all happens except the boosters
// you fired. Nothing here is stored per rung — a depth is a pure function of a
// number, which is what makes "the same rung, retried" mean the same fight.
//
// PURE: no clock, no storage, no DOM, no Math.random. The mutator draw is seeded
// off the DEPTH and nothing else, deliberately: two players at depth 12 are
// fighting the same battle, a retry is the same battle, and a plan can be shown
// on the world map before it is fought without being stored anywhere.
//
// WHY THE TRANSFORMS LIVE HERE AND NOT IN ./modifiers.js: every mutator is
// applied through a field that already crosses the seam, so this file is a set of
// small pure functions over FactionMods, generation inputs and rules — and
// modifiers.js calls them at four places when there is a plan and never
// otherwise. That keeps "what a mutator does" in one file with the table, and
// keeps a battle with no incursion on exactly the code path it was measured on.

import { INCURSION, MUTATORS, MUTATOR_BY_ID } from '../content/incursion.data.js';
import { REGIONS, REGION_BY_ID, DEVELOP_CLAMP, GATE_CLAMP } from '../content/regions.data.js';
import { AI_TIERS } from '../content/balance.js';
import { metaOf } from '../core/store.js';
import { createRng, deriveSeed } from '../core/rng.js';
import { isConquered } from './world.js';

export { INCURSION, MUTATORS, MUTATOR_BY_ID };

/**
 * The player's place on the ladder, healed rather than trusted.
 *
 * `cleared` is the ONE source of truth: the deepest rung actually won. The next
 * rung is `cleared + 1` and is never stored, so the two can never disagree —
 * which is the bug shape a separate `depth` field would have invited.
 */
export function incursionRecord(metaState) {
  const meta = metaOf(metaState);
  if (!meta.incursion || typeof meta.incursion !== 'object') {
    meta.incursion = { cleared: 0, attempts: 0 };
  }
  const rec = meta.incursion;
  rec.cleared = Math.max(0, Math.floor(Number(rec.cleared) || 0));
  rec.attempts = Math.max(0, Math.floor(Number(rec.attempts) || 0));
  return rec;
}

/** The rung the player is standing in front of. Always >= 1. */
export const nextDepth = (metaState) => incursionRecord(metaState).cleared + 1;

/**
 * The arena. One region, named in content, and resolved rather than assumed: a
 * content edit that pointed at a region that does not exist would otherwise
 * produce a plan with an undefined region and fail somewhere in mapgen.
 */
export function arena() {
  const region = REGION_BY_ID[INCURSION.regionId];
  if (!region) {
    throw new RangeError(`INCURSION.regionId "${INCURSION.regionId}" is not a shipped region`);
  }
  return region;
}

/**
 * Is the ladder open? Every region taken.
 *
 * Gated on the WHOLE campaign on purpose, and it is the reason no balance number
 * in content/regions.data.js can move because of this feature: the harness plays
 * region N with N-1 conquests, so the gate is shut for every measured battle in
 * the game (tests/incursion.test.js pins that as a negative control). A player who
 * has abdicated keeps the ladder — see ./legacy.js `endgameOpen`.
 */
export function campaignComplete(metaState) {
  const meta = metaOf(metaState);
  return REGIONS.every((r) => isConquered(meta, r.id));
}

/**
 * The mutators in play at `depth`, as ids.
 *
 * Weighted draw WITHOUT REPLACEMENT off a seed derived from the depth alone. The
 * count comes from `mutatorsAt`, so the opening rungs are the plain ladder and
 * the hand fills in as it deepens.
 */
export function mutatorsFor(depth) {
  const d = Math.max(1, Math.floor(depth));
  const count = INCURSION.mutatorsAt.filter((at) => d >= at).length;
  if (count <= 0) return [];
  const rng = createRng(deriveSeed(0x1c5a1d, `incursion:${d}`));
  const pool = MUTATORS.map((m) => ({ id: m.id, weight: m.weight }));
  const out = [];
  for (let i = 0; i < count && pool.length; i++) {
    let roll = rng.next() * pool.reduce((a, m) => a + m.weight, 0);
    let k = 0;
    while (k < pool.length - 1 && (roll -= pool[k].weight) > 0) k++;
    out.push(pool[k].id);
    pool.splice(k, 1);
  }
  // Sorted into TABLE order rather than draw order, so a plan reads the same way
  // every time it is rendered and a test can compare two plans for equality.
  return MUTATORS.filter((m) => out.includes(m.id)).map((m) => m.id);
}

/**
 * Everything one rung is, derived from its depth. No state is read except to
 * find the depth, so this is safe to call from a screen, a test or the harness.
 *
 * @param {number} depth 1-based rung
 * @returns {{depth:number, regionId:string, regionName:string, tier:number,
 *   enemyMult:number, mutators:string[], aiTier:number, difficulty:number}}
 */
export function planFor(depth) {
  const d = Math.max(1, Math.floor(depth));
  const region = arena();
  const mutators = mutatorsFor(d);
  // The ladder's own curve, not the region's row: `baseDial` is flat and the
  // growth compounds on it. See INCURSION for why the arena's shipped `enemyMult`
  // is deliberately not the base.
  const dial = INCURSION.baseDial * (1 + INCURSION.perDepth) ** (d - 1);
  return {
    depth: d,
    regionId: region.id,
    regionName: region.name,
    tier: region.tier,
    enemyMult: dial,
    mutators,
    aiTier: region.tier,
    // What the rung is WORTH, which is what it costs the player to answer: the
    // dial, plus a premium per mutator. rewards.js multiplies empire income by
    // this, so reward-per-difficulty is constant by construction exactly as it is
    // for raids — there is no second per-depth dial that can fall behind.
    difficulty: dial * (1 + INCURSION.mutatorPay * mutators.length),
  };
}

/** The rung the player would fight now. */
export const incursionPlan = (metaState) => planFor(nextDepth(metaState));

const specs = (plan) => (plan?.mutators ?? []).map((id) => MUTATOR_BY_ID[id]).filter(Boolean);

/** Does this plan carry a given mutator? Exposed for screens and tests. */
export const hasMutator = (plan, id) => (plan?.mutators ?? []).includes(id);

/**
 * The GENERATION inputs. `develop` is the only region column a mutator touches,
 * and it goes through DEVELOP_CLAMP like every authored value does — a region
 * table row and a mutated one are the same kind of object, or mapgen would be
 * the second place that knows what a legal develop is.
 */
export function incursionRegionInputs(region, plan) {
  const bump = specs(plan).filter((m) => m.kind === 'develop')
    .reduce((a, m) => a + m.value, 0);
  if (!bump) return region;
  return { ...region, develop: DEVELOP_CLAMP(region.develop + bump) };
}

/**
 * FactionMods, mutated. `side` is 'player' or 'enemy'; a mutator only ever
 * touches the side it names, and the multiplier rides the field it names — so
 * nothing downstream of the seam has to know incursions exist.
 */
export function incursionMods(mods, plan, side) {
  const list = specs(plan);
  if (!list.length) return mods;
  const want = side === 'enemy' ? 'enemyMult' : 'playerMult';
  let out = mods;
  for (const m of list) {
    if (m.kind === want) out = { ...out, [m.field]: (out[m.field] ?? 1) * m.value };
    // `thinned` is the one mutator that changes the ARMY rather than a
    // multiplier on it. Floored per unit and never below zero, and applied to
    // the already-fitted expedition, so it can only ever take bodies away — it
    // is not a budget the loadout screen could spend around.
    if (side === 'player' && m.kind === 'expedition') {
      const exp = {};
      for (const [unit, n] of Object.entries(out.expedition ?? {})) {
        exp[unit] = Math.max(0, Math.floor((n || 0) * m.value));
      }
      out = { ...out, expedition: exp };
    }
  }
  return out;
}

/**
 * Rules, mutated: the castle gate, and the commander.
 *
 * `aiTier` is NOT raised by a mutator and that is a decision rather than an
 * omission. battle/aicore.js `knobsFor` clamps to the table, so past tier 6 a
 * "better commander" mutator would silently do nothing at all — the exact class
 * of inert content this project has shipped three times. The commander a rung
 * gets is the one its region ships with.
 */
export function incursionRules(rules, plan) {
  const gate = specs(plan).filter((m) => m.kind === 'gate')
    .reduce((a, m) => Math.max(a, m.value), 0);
  // The LADDER's ceiling, not the campaign's — see INCURSION.gateCeiling for
  // why the two are different numbers. Using `GATE_CLAMP` here would clamp a
  // rung to the campaign's 0.60, which is the arena's own base gate, which
  // would make every gate mutator a no-op. That is not hypothetical: `sealed`
  // was exactly that for its whole life, because the arena's gate already
  // equalled its value and the max of the two was always the region's own.
  const ceiling = Math.max(0, Math.min(1, INCURSION.gateCeiling ?? 0.75));
  return {
    ...rules,
    castleGateFrac: Math.min(ceiling, Math.max(rules.castleGateFrac ?? 0, gate)),
    aiTier: Math.min(AI_TIERS.length, plan.aiTier),
    // What crosses the seam: the identity of the rung. The mutators' EFFECTS are
    // already baked into the mods, the sites and the gate — this is so the HUD,
    // the results screen and meta/rewards.js can all name the fight, and so
    // rewards.js can tell an incursion from a raid on the same region without
    // being told separately.
    incursion: { depth: plan.depth, mutators: [...plan.mutators] },
  };
}

/**
 * Bookkeeping for a finished rung. ./rewards.js owns paying for it, exactly as
 * ./world.js `completeRaid` does for a raid.
 *
 * Advancing is `max`, not `+1`: the depth fought is passed in, so a stale screen
 * that launches an already-cleared rung can never walk the ladder backwards.
 */
export function completeIncursion(metaState, depth, { won = false } = {}) {
  const rec = incursionRecord(metaState);
  rec.attempts += 1;
  if (won) rec.cleared = Math.max(rec.cleared, Math.max(1, Math.floor(depth)));
  return rec;
}

/** Everything a screen needs to describe the rung in front of the player. */
export function incursionView(metaState) {
  const meta = metaOf(metaState);
  const rec = incursionRecord(meta);
  const plan = incursionPlan(meta);
  return {
    open: campaignComplete(meta),
    cleared: rec.cleared,
    attempts: rec.attempts,
    depth: plan.depth,
    regionId: plan.regionId,
    regionName: plan.regionName,
    enemyMult: plan.enemyMult,
    difficulty: plan.difficulty,
    mutators: plan.mutators.map((id) => ({
      id, name: MUTATOR_BY_ID[id].name, note: MUTATOR_BY_ID[id].note,
    })),
    region: REGION_BY_ID[plan.regionId] ?? null,
  };
}
