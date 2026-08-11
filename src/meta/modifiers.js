// ===========================================================================
// buildBattleConfig - the meta layer's half of the seam.
//
// THE MULTIPLIER STACKING ORDER IS FIXED HERE AND NOWHERE ELSE:
//
//   final = base x (1 + SUM additive) x PROD multiplicative x PROD boosters x tier
//
//   base           content baseline PLUS flat upgrade additions (War Chest gold,
//                  Standing Army troops, Bigger Camp slots). Flats join the base;
//                  they are NEVER applied after a multiplier.
//   additive       upgrade bonuses that SUM before multiplying, so two levels of
//                  +8% is +16%, not +16.64%.
//   multiplicative independent multipliers that compound (AI tier knobs).
//   boosters       consumables, applied after everything permanent.
//   tier           the region difficulty scalar, applied LAST, so an advertised
//                  "x2.6" means x2.6 of the fully-modified value.
//
// Two engineers who each pick a plausible order produce numbers that disagree
// forever and neither is "wrong". So: one function, one order, asserted in
// tests/modifiers.test.js. Do not compute a modifier without calling stack().
//
// meta/** imports NOTHING from battle/** except contract.js, and mapGen is
// INJECTED, so this file is never blocked on battle/mapgen.js existing.
// PURE: no clock reads, no Math.random, no DOM.
// ===========================================================================

import {
  CONTRACT_VERSION, makeMods, assertBattleConfig, hashBattleConfig,
} from '../battle/contract.js';
import { EXPEDITION, SITES, SITE_LEVELS, RALLY_KEEP } from '../content/balance.js';
import {
  REGION_BY_ID, ENEMY_SCALING, BASE_GARRISON, NEUTRAL_GARRISON,
  PLAYER_SITE_GARRISON, BATTLE_START, ENEMY_UNITS_BY_TIER,
  ENEMY_MARSHALS_BY_TIER, FALLBACK_MAP,
} from '../content/regions.data.js';
import {
  zeroComposition, distributeExpedition, fitComposition, carryComposition,
  compositionSlots, compositionTotal, overBudget, slotCost, typeCount, canAddType,
  battleRoster,
} from './composition.js';
import { metaOf } from '../core/store.js';
import { createRng, deriveSeed } from '../core/rng.js';
import {
  offsetToAxial, fallbackMapGen, callMapGen, normalizeSites,
} from './fallbackMap.js';
import {
  upgradeEffects, addBonus, multBonus, flatBonus, unitMults,
} from './upgrades.js';
import { regionsConquered, effectiveEnemyMult, record, isConquered } from './world.js';
import { toConfigBoosters } from './boosters.js';
import { withFreeMarshal, withEnemyMarshal } from './marshals.js';
import {
  planFor, incursionRegionInputs, incursionMods, incursionRules,
} from './incursion.js';

export { hashBattleConfig };
// The composition math lives in ./composition.js; re-exported so the seam has
// one front door and callers never have to know which file split from which.
export {
  distributeExpedition, fitComposition, carryComposition,
  compositionSlots, compositionTotal, overBudget, slotCost, typeCount, canAddType,
};

/** The one true order. Asserted in tests; never reorder without a test change. */
export const STACKING_ORDER = Object.freeze([
  'base', 'additive', 'multiplicative', 'boosters', 'tier',
]);

/**
 * @param {number} base  content baseline + flat upgrade additions
 * @param {{additive?:number, multiplicative?:number, boosters?:number, tier?:number}} [s]
 */
export function stack(base, s = {}) {
  const additive = s.additive ?? 0;
  const multiplicative = s.multiplicative ?? 1;
  const boosters = s.boosters ?? 1;
  const tier = s.tier ?? 1;
  return base * (1 + additive) * multiplicative * boosters * tier;
}

const zeroComp = zeroComposition;

// --- The expeditionary force: the direct answer to the enemy always starting
// --- with more land. You arrive with an army sized by what you already hold.

/**
 * The expedition budget in SLOTS, not bodies:
 *   19 + 12 x (first 4 conquests) + 6 x (every one after that)
 *      + 4 x Standing Army level + 6 x Muster Field level.
 *
 * Every unit spends a different number of them (content/balance.js UNIT_SLOTS),
 * which is what stops "all marshals" from being the only sane loadout.
 *
 * The two rates are a PACING knob and the reasoning is in content/balance.js
 * EXPEDITION. The taper starts after the fourth conquest, so every region the
 * frozen opening covers (0-4 conquests) is spent at exactly the old rate.
 */
export function expeditionSlots(metaState) {
  const meta = metaOf(metaState);
  const fx = upgradeEffects(meta);
  const conquered = regionsConquered(meta);
  // THREE SEGMENTS, not two, and the breakpoints are where the WAR changes
  // shape rather than round numbers. `taperAfter` (4) is the frozen opening:
  // regions 1-5 are attacked with 0-4 conquests, so nothing past it can touch
  // them. `surgeAfter` (8) is the tier-2/tier-3 boundary, where the map roughly
  // doubles — 22 sites to 28, and on to 48 by the last region.
  //
  // The third segment is what pays for the player's starting footprint being cut
  // to a raider's share (see content/balance.js EXPEDITION and regions.data.js).
  // A single late rate could not: the campaign needs +3 slots a region at tier 2
  // and +23 at tier 5, and one number for both either starves the endgame or
  // hands tier 2 a walkover. Measured at n=48 on one uniform rate, raising it
  // until thanescar cleared its band (14% -> 46%) pushed emberholt to 85%,
  // one point past its ceiling.
  //
  // The FOURTH segment is tier 6 and starts at `finalAfter` (20), which region 21
  // is attacked with — so the twenty-one regions measured before it cannot feel it
  // at all. See content/balance.js EXPEDITION for why raising `perRegionSurge` was
  // not available as the answer instead.
  const taperAfter = EXPEDITION.taperAfter ?? Infinity;
  const surgeAfter = EXPEDITION.surgeAfter ?? Infinity;
  const finalAfter = EXPEDITION.finalAfter ?? Infinity;
  const early = Math.min(conquered, taperAfter);
  const mid = Math.max(0, Math.min(conquered, surgeAfter) - taperAfter);
  const late = Math.max(0, Math.min(conquered, finalAfter) - surgeAfter);
  const last = Math.max(0, conquered - finalAfter);
  // `surgeBonus` is a ONE-TIME step at the boundary, not a rate, and separating
  // it from `perRegionSurge` is what makes the late campaign tunable at all.
  // The two things a landing force needs are a LEVEL (enough to contest a map
  // the player barely starts on) and a SLOPE (how fast it grows region to
  // region), and one number cannot set both: carrying the level on the rate
  // alone meant +52 slots a region, which outgrew `enemyMult` faster than the
  // dial could legally climb — every column in regions.data.js is required
  // non-decreasing, so steepening tier 3 to keep up forces tier 4's opener up
  // with it. Measured at n=48 on the rate-only version, every tier sloped
  // UPWARD inside itself: tier 3 ran 42 / 67 / 81 / 77 / 79 against a 22-point
  // band. The step buys the level once; the rate stays gentle enough to tune.
  const surgeRate = EXPEDITION.perRegionSurge ?? EXPEDITION.perRegionLate ?? EXPEDITION.perRegion;
  const base = EXPEDITION.base
    + EXPEDITION.perRegion * early
    + (EXPEDITION.perRegionLate ?? EXPEDITION.perRegion) * mid
    + surgeRate * late
    + (EXPEDITION.perRegionFinal ?? surgeRate) * last
    + (late > 0 || last > 0 ? (EXPEDITION.surgeBonus ?? 0) : 0)
    + (last > 0 ? (EXPEDITION.finalBonus ?? 0) : 0)
    + flatBonus(fx, 'expedition');
  // `expeditionMult` is the additive SHARE bucket, and only meta/legacy.js writes
  // it. A prestige grant has to be a proportion rather than a slot count: the
  // budget runs 12 slots at region 1 and 862 at region 24, so one flat number
  // cannot be right at both ends — measured, +3 slots a point was +675% on the
  // opening and +9% on the finale. Shop lines stay FLAT (`grandArmy` adds 18),
  // because they are bought late and priced for where they are bought.
  return Math.max(0, Math.round(stack(base, { additive: addBonus(fx, 'expeditionMult') })));
}

// --- FactionMods -----------------------------------------------------------

export function playerMods(metaState, expedition) {
  const meta = metaOf(metaState);
  const fx = upgradeEffects(meta);
  return makeMods({
    startGold: stack(BATTLE_START.playerGold + flatBonus(fx, 'startGold')),
    expedition,
    // Quartermaster and Levy Reform. Both of these FactionMods fields were
    // declared in the contract, validated at the seam, and read every tick by
    // battle/economy.js and battle/training.js — and no upgrade produced them,
    // so both were permanently 1.0. They are channels, not new fields: nothing
    // downstream changes, which is why the endgame shop could be extended
    // without touching CONTRACT_VERSION.
    goldRateMult: stack(1, { additive: addBonus(fx, 'goldRate') }),
    trainSpeedMult: stack(1, { additive: addBonus(fx, 'trainSpeed') }),
    trainCostMult: stack(1, { multiplicative: multBonus(fx, 'trainCost') }),
    unitAtkMult: stack(1, { additive: addBonus(fx, 'atk') }),
    unitDefMult: stack(1, { additive: addBonus(fx, 'def') }),
    marchSpeedMult: stack(1, { additive: addBonus(fx, 'march') }),
    farmYieldMult: stack(1, { additive: addBonus(fx, 'farmYield') }),
    garrisonCapBonus: stack(flatBonus(fx, 'garrisonCap')),
    siegeDmgMult: stack(1, { additive: addBonus(fx, 'siegeDmg') }),
    structureRegenMult: stack(1, { additive: addBonus(fx, 'structureRegen') }),
    ramImpactHp: flatBonus(fx, 'ramImpactHp'),
    // Per-troop levels, bought with relics (contract v7). Sparse: `{}` for
    // every battle content/regions.data.js was measured with, because the
    // harness earns no relics at all.
    unitMult: unitMults(fx),
    // THE LOADOUT IS THE ROSTER. Narrowed to what this expedition actually
    // carries, not everything the shop has sold — see composition.js
    // `battleRoster`. `cmdTrain` already gates on this field, so the five types
    // you picked at the briefing are the five a stronghold can be set to build,
    // and the cap stops being something you shrug off by capturing a yard.
    unlockedUnits: battleRoster(fx.units, expedition),
    // Shop unlocks that change battle or HUD behaviour. Without this the
    // player could buy Tactician, Field Manual, Scout Report and Standing
    // Orders and none of them would cross the seam or do anything at all.
    features: Object.keys(fx.features).sort(),
  });
}

/**
 * The enemy's single difficulty dial, `enemyMult`, spread across its mods by
 * the ENEMY_SCALING exponents. Per-AI-tier knobs ride the `multiplicative`
 * bucket; the region's dial rides `tier`, which is applied last.
 */
export function enemyMods(region, mult) {
  const t = (exp) => mult ** exp;
  return makeMods({
    startGold: stack(BATTLE_START.enemyGold, { tier: t(ENEMY_SCALING.gold) }),
    expedition: zeroComp(), // the enemy's head start is LAND, not a free army
    // `AI_TIERS[].economyMult` is DELIBERATELY ABSENT from these two.
    //
    // battle/economy.js `siteGoldPerSec` already multiplies every enemy site by
    // `economyMultFor(state, faction)`, which is the same AI_TIERS number. It
    // used to ride here as well — on goldRateMult AND on farmYieldMult — so an
    // enemy farm, which is multiplied by both, felt the handicap THREE times and
    // an enemy castle twice. At tier 4 that turned an advertised x1.35 into
    // x2.46 and the endgame enemy earned eighteen times what the player did
    // (obsidian, measured: 537 gold/s against 30). Two files each thought they
    // owned the knob. economy.js applies it; this file does not.
    goldRateMult: stack(1, { tier: t(ENEMY_SCALING.gold) }),
    trainSpeedMult: stack(1, { tier: t(ENEMY_SCALING.train) }),
    trainCostMult: stack(1),
    unitAtkMult: stack(1, { tier: t(ENEMY_SCALING.atk) }),
    unitDefMult: stack(1, { tier: t(ENEMY_SCALING.def) }),
    marchSpeedMult: stack(1),
    farmYieldMult: stack(1, { tier: t(ENEMY_SCALING.gold) }),
    garrisonCapBonus: stack(0),
    siegeDmgMult: stack(1, { tier: t(ENEMY_SCALING.atk) }),
    structureRegenMult: stack(1, { tier: t(ENEMY_SCALING.def) }),
    // Clamped to the LENGTH of the table, not to a literal 4. The hardcoded
    // number silently capped tier 5 at the tier-4 roster the moment a fifth
    // tier shipped — the same class of bug as `knobsFor` in battle/aicore.js,
    // which clamps to `AI_TIERS.length - 1` and is why that one was fine.
    unlockedUnits: [...ENEMY_UNITS_BY_TIER[
      Math.min(ENEMY_UNITS_BY_TIER.length, Math.max(1, region.tier)) - 1]],
  });
}

// The two free commanders — the player's and the enemy's — live in ./marshals.js
// and are re-exported here, so the seam keeps one front door.
export { withFreeMarshal, withEnemyMarshal };

// --- The entry point -------------------------------------------------------

/**
 * @param {object} metaState  root state or the meta slice
 * @param {string} regionId
 * @param {Array<string|{id:string,charges:number}>} [selectedBoosters]
 * @param {null|((ctx:object)=>object)} [mapGen] injected battle/mapgen.js
 * `options.incursion` is a DEPTH on the endless ladder (meta/incursion.js). It
 * replaces the region's dial with the rung's, mutates the generation inputs, the
 * two FactionMods and the rules, and stamps `rules.incursion` so rewards.js can
 * tell one from a raid on the same ground. A rung is a pure function of its
 * depth, so the region is CHECKED rather than trusted: a hand-edited params
 * object cannot fight depth 40 on a tier-4 map.
 *
 * @param {{seed?:number, attempt?:number, composition?:object, incursion?:number}} [options]
 * @returns {object} a BattleConfig that has passed assertBattleConfig
 */
export function buildBattleConfig(metaState, regionId, selectedBoosters, mapGen, options = {}) {
  const meta = metaOf(metaState);
  const region = REGION_BY_ID[regionId];
  if (!region) throw new RangeError(`buildBattleConfig: unknown region "${regionId}"`);

  const plan = options.incursion != null ? planFor(options.incursion) : null;
  if (plan && plan.regionId !== regionId) {
    throw new RangeError(`buildBattleConfig: incursion depth ${plan.depth} is fought on`
      + ` "${plan.regionId}", not "${regionId}"`);
  }

  const rec = record(meta, regionId);
  const isRaid = isConquered(meta, regionId);
  const worldSeed = (options.seed ?? metaState?.seed ?? 1) >>> 0;
  const attempt = options.attempt ?? 0;
  // The depth is part of the seed for an incursion: the same rung retried is the
  // same battle, and the rung after it is a different map on the same ground.
  const seed = deriveSeed(worldSeed,
    `${regionId}:${rec.clears}:${attempt}${plan ? `:i${plan.depth}` : ''}`);
  const mult = plan ? plan.enemyMult : effectiveEnemyMult(meta, regionId);
  const genRegion = plan ? incursionRegionInputs(region, plan) : region;

  const fx = upgradeEffects(meta);
  // The screen hands over a composition that already fits; re-fitting it is an
  // identity in that case and a hard clamp in every other, so a hand-edited
  // params object still cannot buy itself a bigger army.
  const slots = expeditionSlots(meta);
  // The budget never buys a marshal — `maxOf('marshal')` is 0 in
  // meta/composition.js — so a loadout carried over from before the change has
  // its 8 slots handed back as troops rather than spent on a body the player is
  // about to be given anyway.
  const expedition = withFreeMarshal(fx, options.composition
    ? fitComposition(slots, fx.units, options.composition)
    : distributeExpedition(slots, fx.units));

  // Hoisted above the map because the enemy's roster decides what stands on it:
  // `withEnemyMarshal` reads `unlockedUnits`, the same field the AI's training
  // reads, so the commander and the units he commands can never disagree.
  const enemy = plan
    ? incursionMods(enemyMods(genRegion, mult), plan, 'enemy')
    : enemyMods(region, mult);
  const gen = callMapGen(mapGen, { region: genRegion, seed, mult, isRaid });
  const sites = withEnemyMarshal(normalizeSites(gen.sites, mult), enemy.unlockedUnits,
    ENEMY_MARSHALS_BY_TIER[Math.max(1, region.tier) - 1] ?? 1);
  const ids = new Set(sites.map((s) => s.id));
  const blockedOnSites = new Set(sites.map((s) => `${s.hex[0]},${s.hex[1]}`));

  const config = {
    contractVersion: CONTRACT_VERSION,
    // Deterministic, and deliberately NOT clock-based: the same region at the
    // same clear count always produces the same id, which makes instant retry
    // and replay comparison trivial.
    battleId: `${regionId}#${rec.clears}#${attempt}#${seed.toString(16)}`,
    seed,
    region: { id: region.id, name: region.name, tier: region.tier },
    grid: {
      cols: region.grid.cols,
      rows: region.grid.rows,
      layout: 'odd-r',
      blocked: (gen.blocked ?? []).filter(([q, r]) => !blockedOnSites.has(`${q},${r}`)),
      // Rivers are PASSABLE, so unlike mountains they are NOT filtered off site
      // hexes: a farm standing on a watercourse is the whole point of them.
      rivers: gen.rivers ?? [],
    },
    sites,
    adjacency: (gen.adjacency ?? []).filter(([a, b]) => a !== b && ids.has(a) && ids.has(b)),
    player: plan
      ? incursionMods(playerMods(meta, expedition), plan, 'player')
      : playerMods(meta, expedition),
    enemy,
    boosters: toConfigBoosters(meta, selectedBoosters),
    rules: {
      victory: 'capture-castle',
      hardCapMs: region.hardCapMs,
      aiTier: region.tier,          // 1-based: index AI_TIERS with tier - 1
      isRaid,
      targetLengthMs: Math.round(region.targetLengthMin * 60 * 1000),
      castleGateFrac: region.castleGateFrac,
      // The player's standing hold-back preference. Meta owns the preference,
      // battle owns the per-site field it seeds — so it crosses here rather
      // than being read from meta inside the sim, which meta may not touch.
      rallyKeepDefault: meta.settings?.rallyKeepDefault ?? RALLY_KEEP.default,
    },
  };
  if (plan) config.rules = incursionRules(config.rules, plan);

  // NOTE: `configHash` is deliberately NOT a field on the config. hashBattleConfig
  // hashes the whole object, so storing the hash inside it would change the hash
  // and assertBattleOutcome could never match. Battle should compute
  // hashBattleConfig(config) itself and put THAT on the outcome.
  return assertBattleConfig(config);
}

export { offsetToAxial, fallbackMapGen };
