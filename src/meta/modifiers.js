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
  const taperAfter = EXPEDITION.taperAfter ?? Infinity;
  const surgeAfter = EXPEDITION.surgeAfter ?? Infinity;
  const early = Math.min(conquered, taperAfter);
  const mid = Math.max(0, Math.min(conquered, surgeAfter) - taperAfter);
  const late = Math.max(0, conquered - surgeAfter);
  const base = EXPEDITION.base
    + EXPEDITION.perRegion * early
    + (EXPEDITION.perRegionLate ?? EXPEDITION.perRegion) * mid
    + (EXPEDITION.perRegionSurge ?? EXPEDITION.perRegionLate ?? EXPEDITION.perRegion) * late
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

/**
 * THE MARSHAL YOU BOUGHT TURNS UP, and it does not cost you eight militia.
 *
 * Unlocking the marshal used to buy the RIGHT to spend 8 of your expedition
 * slots on one body — 42% of a region-1 budget, 11% of a region-6 one — or to
 * retask a stronghold for forty seconds mid-battle. Both are a bill rather than
 * a reward, which is how a 4,000-crown purchase ended up being something players
 * simply never fielded.
 *
 * So the unlock grants exactly one, OUTSIDE the slot budget, on every landing.
 * `maxPerSite` still binds, so this cannot stack: it is one commander, free,
 * because that is what the price already paid for. More than one is still a
 * decision — buy it in the loadout, or commission it in battle (RECRUIT).
 *
 * Deliberately applied AFTER the budget is fitted, so the free one never
 * displaces a paid unit and never makes the loadout screen's arithmetic wrong.
 */
export function withFreeMarshal(fx, expedition) {
  if (!fx.units.includes('marshal')) return expedition;
  // EXACTLY one, not one more. `banner` is presence-based, so a second marshal
  // in the same camp buys literally nothing, and the loadout screen no longer
  // sells them at all (screens/prebattle-army.js) — which means the 8 slots stay
  // available for troops instead of being a trap for the player who paid 4,000
  // crowns and then paid again.
  return { ...expedition, marshal: Math.max(expedition.marshal ?? 0, 1) };
}

/**
 * ...AND SO DOES THEIRS. The mirror of `withFreeMarshal`, and the fix for a
 * unit that was in the enemy's roster for this project's whole life without
 * ever existing.
 *
 * `ENEMY_UNITS_BY_TIER` has listed `marshal` at tier 4 since tier 4 shipped,
 * and it did nothing: no `MAPGEN.trainType` produces one, `AI.counterPick` maps
 * marshal -> spearmen (what to build AGAINST one, not one to build), and
 * `BASE_GARRISON` never held one. Removing marshal from the tier-4 roster
 * changed thanescar's win rate by exactly 0 points, which is how the gap was
 * found. Ironcrown's flavour text has advertised an enemy Marshal the whole
 * time and it was simply false.
 *
 * Granted the same way the player's is — one commander, free, at the start —
 * because the alternative is worse in both directions. Training one costs a
 * yard forty seconds for a single body, so an AI that bought one would be
 * making the same solver's purchase `tools/simplayer.js` deliberately declines;
 * and a marshal that arrives at minute six is a difficulty spike nobody can
 * see coming.
 *
 * IT STANDS IN THE THRONE, which is the whole design of it:
 *   - `banner` is stack-local (battle/combat.js), so it buys +25% to whatever
 *     comp he is IN. In the castle that is the garrison defending the win
 *     condition — the fight the region is actually about.
 *   - `trainBuff` (battle/training.js) makes the throne produce 40% faster, so
 *     a siege that stalls is refilling the wall it is hitting.
 *   - "until you kill it" is then literally true: the marshal dies with the
 *     garrison, and battle/ai.js never sources an attack from the castle
 *     (`kind === 'castle'` is filtered out of the launch pool), so he cannot
 *     wander off and be picked up cheaply in a field.
 *
 * EXACTLY ONE, and deliberately applied AFTER `normalizeSites` rather than
 * through `MAPGEN.garrison`: that table is multiplied by `enemyMult ^
 * ENEMY_SCALING.garrison` and by the throne bonus, so a marshal placed there
 * would be scaled into two or three of them on the late regions. `maxPerSite`
 * is enforced in battle/training.js, which never sees a garrison mapgen wrote.
 * `banner` is presence-based, so a second is worth nothing anyway — it would
 * only be an invisible difficulty step that rides the difficulty dial.
 */
export function withEnemyMarshal(sites, unlockedUnits) {
  if (!unlockedUnits.includes('marshal')) return sites;
  const throne = sites.find((s) => s.owner === 'enemy' && s.kind === 'castle');
  if (!throne || (throne.garrison.marshal ?? 0) > 0) return sites;
  return sites.map((s) => (s === throne
    ? { ...s, garrison: { ...s.garrison, marshal: 1 } }
    : s));
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
  const enemy = enemyMods(region, mult);
  const gen = callMapGen(mapGen, { region, seed, mult, isRaid });
  const sites = withEnemyMarshal(normalizeSites(gen.sites, mult), enemy.unlockedUnits);
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

  // NOTE: `configHash` is deliberately NOT a field on the config. hashBattleConfig
  // hashes the whole object, so storing the hash inside it would change the hash
  // and assertBattleOutcome could never match. Battle should compute
  // hashBattleConfig(config) itself and put THAT on the outcome.
  return assertBattleConfig(config);
}

export { offsetToAxial, fallbackMapGen };
