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
import { EXPEDITION, UNIT_IDS, SITES, SITE_LEVELS, AI_TIERS } from '../content/balance.js';
import {
  REGION_BY_ID, ENEMY_SCALING, BASE_GARRISON, NEUTRAL_GARRISON,
  PLAYER_SITE_GARRISON, BATTLE_START, ENEMY_UNITS_BY_TIER, FALLBACK_MAP,
} from '../content/regions.data.js';
import { DEFAULT_COMPOSITION_WEIGHTS } from '../content/upgrades.data.js';
import { metaOf } from '../core/store.js';
import { createRng, deriveSeed } from '../core/rng.js';
import {
  offsetToAxial, fallbackMapGen, callMapGen, normalizeSites,
} from './fallbackMap.js';
import { upgradeEffects, addBonus, flatBonus } from './upgrades.js';
import { regionsConquered, effectiveEnemyMult, record, isConquered } from './world.js';
import { toConfigBoosters } from './boosters.js';

export { hashBattleConfig };

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

const zeroComp = () => Object.fromEntries(UNIT_IDS.map((u) => [u, 0]));

// --- The expeditionary force: the direct answer to the enemy always starting
// --- with more land. You arrive with an army sized by what you already hold.

/** 8 + 4 x regionsConquered + 4 x Standing Army level. */
export function expeditionSize(metaState) {
  const meta = metaOf(metaState);
  const fx = upgradeEffects(meta);
  const base = EXPEDITION.base
    + EXPEDITION.perRegion * regionsConquered(meta)
    + flatBonus(fx, 'expedition');
  return Math.max(0, Math.round(stack(base)));
}

/**
 * Split `total` troops across the unlocked units by weight, exactly.
 * Largest-remainder so the counts always sum to `total` — an off-by-one here is
 * a free or stolen soldier, and players notice.
 * A Marshal is granted as exactly one (max 1 per site) before the split.
 */
export function distributeExpedition(total, unlocked, weights = DEFAULT_COMPOSITION_WEIGHTS) {
  const out = zeroComp();
  let left = Math.max(0, Math.floor(total));
  if (left === 0) return out;

  if (unlocked.includes('marshal') && left > 0) { out.marshal = 1; left -= 1; }

  const pool = UNIT_IDS.filter(
    (u) => u !== 'marshal' && unlocked.includes(u) && (weights[u] ?? 0) > 0,
  );
  if (pool.length === 0) { out.militia += left; return out; }

  const sum = pool.reduce((a, u) => a + weights[u], 0);
  const exact = pool.map((u) => ({ u, want: (left * weights[u]) / sum }));
  for (const e of exact) { e.floor = Math.floor(e.want); out[e.u] += e.floor; }

  let remainder = left - exact.reduce((a, e) => a + e.floor, 0);
  exact.sort((a, b) =>
    (b.want - b.floor) - (a.want - a.floor)
    || (weights[b.u] - weights[a.u])
    || UNIT_IDS.indexOf(a.u) - UNIT_IDS.indexOf(b.u));
  for (let i = 0; remainder > 0; i = (i + 1) % exact.length, remainder--) out[exact[i].u] += 1;
  return out;
}

/** Treat a player-chosen composition as RATIOS and re-fit it to the size the
 *  empire actually grants, so the pre-battle screen can never mint troops. */
export function fitComposition(total, unlocked, chosen) {
  const weights = {};
  for (const u of UNIT_IDS) {
    weights[u] = unlocked.includes(u) ? Math.max(0, Number(chosen?.[u]) || 0) : 0;
  }
  const any = UNIT_IDS.reduce((a, u) => a + weights[u], 0);
  return distributeExpedition(total, unlocked, any > 0 ? weights : undefined);
}

// --- FactionMods -----------------------------------------------------------

export function playerMods(metaState, expedition) {
  const meta = metaOf(metaState);
  const fx = upgradeEffects(meta);
  return makeMods({
    startGold: stack(BATTLE_START.playerGold + flatBonus(fx, 'startGold')),
    expedition,
    goldRateMult: stack(1),
    trainSpeedMult: stack(1, { additive: addBonus(fx, 'trainSpeed') }),
    trainCostMult: stack(1),
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
  const total = expeditionSize(meta);
  const expedition = options.composition
    ? fitComposition(total, fx.units, options.composition)
    : distributeExpedition(total, fx.units);

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
