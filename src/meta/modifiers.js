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
import { EXPEDITION, SITES, SITE_LEVELS, AI_TIERS } from '../content/balance.js';
import {
  REGION_BY_ID, ENEMY_SCALING, BASE_GARRISON, NEUTRAL_GARRISON,
  PLAYER_SITE_GARRISON, BATTLE_START, ENEMY_UNITS_BY_TIER, FALLBACK_MAP,
} from '../content/regions.data.js';
import {
  zeroComposition, distributeExpedition, fitComposition, carryComposition,
  compositionSlots, compositionTotal, overBudget, slotCost,
} from './composition.js';
import { metaOf } from '../core/store.js';
import { createRng, deriveSeed } from '../core/rng.js';
import {
  offsetToAxial, fallbackMapGen, callMapGen, normalizeSites,
} from './fallbackMap.js';
import { upgradeEffects, addBonus, multBonus, flatBonus } from './upgrades.js';
import { regionsConquered, effectiveEnemyMult, record, isConquered } from './world.js';
import { toConfigBoosters } from './boosters.js';

export { hashBattleConfig };
// The composition math lives in ./composition.js; re-exported so the seam has
// one front door and callers never have to know which file split from which.
export {
  distributeExpedition, fitComposition, carryComposition,
  compositionSlots, compositionTotal, overBudget, slotCost,
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
 *   19 + 9 x regionsConquered + 4 x Standing Army level.
 *
 * Every unit spends a different number of them (content/balance.js UNIT_SLOTS),
 * which is what stops "all marshals" from being the only sane loadout.
 */
export function expeditionSlots(metaState) {
  const meta = metaOf(metaState);
  const fx = upgradeEffects(meta);
  const base = EXPEDITION.base
    + EXPEDITION.perRegion * regionsConquered(meta)
    + flatBonus(fx, 'expedition');
  return Math.max(0, Math.round(stack(base)));
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
    unlockedUnits: fx.units,
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
  const ai = AI_TIERS[Math.min(AI_TIERS.length, Math.max(1, region.tier)) - 1];
  const t = (exp) => mult ** exp;
  return makeMods({
    startGold: stack(BATTLE_START.enemyGold, { tier: t(ENEMY_SCALING.gold) }),
    expedition: zeroComp(), // the enemy's head start is LAND, not a free army
    goldRateMult: stack(1, { multiplicative: ai.economyMult, tier: t(ENEMY_SCALING.gold) }),
    trainSpeedMult: stack(1, { tier: t(ENEMY_SCALING.train) }),
    trainCostMult: stack(1),
    unitAtkMult: stack(1, { tier: t(ENEMY_SCALING.atk) }),
    unitDefMult: stack(1, { tier: t(ENEMY_SCALING.def) }),
    marchSpeedMult: stack(1),
    farmYieldMult: stack(1, { multiplicative: ai.economyMult, tier: t(ENEMY_SCALING.gold) }),
    garrisonCapBonus: stack(0),
    siegeDmgMult: stack(1, { tier: t(ENEMY_SCALING.atk) }),
    structureRegenMult: stack(1, { tier: t(ENEMY_SCALING.def) }),
    unlockedUnits: [...ENEMY_UNITS_BY_TIER[Math.min(4, Math.max(1, region.tier)) - 1]],
  });
}

// --- The entry point -------------------------------------------------------

/**
 * @param {object} metaState  root state or the meta slice
 * @param {string} regionId
 * @param {Array<string|{id:string,charges:number}>} [selectedBoosters]
 * @param {null|((ctx:object)=>object)} [mapGen] injected battle/mapgen.js
 * @param {{seed?:number, attempt?:number, composition?:object}} [options]
 * @returns {object} a BattleConfig that has passed assertBattleConfig
 */
export function buildBattleConfig(metaState, regionId, selectedBoosters, mapGen, options = {}) {
  const meta = metaOf(metaState);
  const region = REGION_BY_ID[regionId];
  if (!region) throw new RangeError(`buildBattleConfig: unknown region "${regionId}"`);

  const rec = record(meta, regionId);
  const isRaid = isConquered(meta, regionId);
  const worldSeed = (options.seed ?? metaState?.seed ?? 1) >>> 0;
  const attempt = options.attempt ?? 0;
  const seed = deriveSeed(worldSeed, `${regionId}:${rec.clears}:${attempt}`);
  const mult = effectiveEnemyMult(meta, regionId);

  const fx = upgradeEffects(meta);
  // The screen hands over a composition that already fits; re-fitting it is an
  // identity in that case and a hard clamp in every other, so a hand-edited
  // params object still cannot buy itself a bigger army.
  const slots = expeditionSlots(meta);
  const expedition = options.composition
    ? fitComposition(slots, fx.units, options.composition)
    : distributeExpedition(slots, fx.units);

  const gen = callMapGen(mapGen, { region, seed, mult, isRaid });
  const sites = normalizeSites(gen.sites, mult);
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
    player: playerMods(meta, expedition),
    enemy: enemyMods(region, mult),
    boosters: toConfigBoosters(meta, selectedBoosters),
    rules: {
      victory: 'capture-castle',
      hardCapMs: region.hardCapMs,
      aiTier: region.tier,          // 1-based: index AI_TIERS with tier - 1
      isRaid,
      targetLengthMs: Math.round(region.targetLengthMin * 60 * 1000),
    },
  };

  // NOTE: `configHash` is deliberately NOT a field on the config. hashBattleConfig
  // hashes the whole object, so storing the hash inside it would change the hash
  // and assertBattleOutcome could never match. Battle should compute
  // hashBattleConfig(config) itself and put THAT on the outcome.
  return assertBattleConfig(config);
}

export { offsetToAxial, fallbackMapGen };
