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
    unlockedUnits: fx.units,
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

// --- Fallback map generation. battle/mapgen.js owns the real thing; this
// --- exists so meta and its tests never wait on that file being written.

/** odd-r offset -> axial. Exported so an injected mapGen can match it exactly. */
export const offsetToAxial = (col, row) => [col - ((row - (row & 1)) / 2), row];

const scaleGarrison = (comp, mult) => Object.fromEntries(
  Object.entries(comp).map(([u, n]) => [u, Math.max(1, Math.round(n * mult))]),
);

/** @returns {{blocked:Array<[number,number]>, sites:object[], adjacency:Array<[string,string]>}} */
export function fallbackMapGen({ grid, siteCounts, seed }) {
  const rng = createRng(seed >>> 0);
  const { cols, rows } = grid;
  const slots = [];
  for (let row = 1; row < rows - 1; row += 2) {
    for (let col = 1; col < cols - 1; col += 2) slots.push({ col, row });
  }
  const need = siteCounts.player + siteCounts.enemy + siteCounts.neutral;
  for (let row = 2; slots.length < need && row < rows - 1; row += 2) {
    for (let col = 2; col < cols - 1; col += 2) slots.push({ col, row });
  }
  slots.sort((a, b) => a.col - b.col || a.row - b.row);

  const playerSlots = slots.slice(0, siteCounts.player);
  const enemySlots = slots.slice(slots.length - siteCounts.enemy);
  const mid = (cols - 1) / 2;
  const neutralSlots = slots
    .slice(siteCounts.player, slots.length - siteCounts.enemy)
    .sort((a, b) => Math.abs(a.col - mid) - Math.abs(b.col - mid) || a.row - b.row)
    .slice(0, siteCounts.neutral);

  const sites = [];
  const campAt = Math.floor(playerSlots.length / 2);
  playerSlots.forEach((s, i) => sites.push({
    id: `p${i}`, kind: i === campAt ? 'camp' : 'farm', owner: 'player',
    hex: offsetToAxial(s.col, s.row),
  }));
  const castleAt = enemySlots.length - 1 - Math.floor(enemySlots.length / 6);
  enemySlots.forEach((s, i) => sites.push({
    id: `e${i}`, kind: i === castleAt ? 'castle' : (i % 3 === 1 ? 'stronghold' : 'farm'),
    owner: 'enemy', hex: offsetToAxial(s.col, s.row),
  }));
  neutralSlots.forEach((s, i) => sites.push({
    id: `n${i}`, kind: 'farm', owner: 'neutral', hex: offsetToAxial(s.col, s.row),
  }));

  return { blocked: pickBlocked(rng, cols, rows, sites), sites, adjacency: nearestGraph(sites) };
}

const hexDist = (a, b) =>
  (Math.abs(a[0] - b[0]) + Math.abs(a[0] + a[1] - b[0] - b[1]) + Math.abs(a[1] - b[1])) / 2;

/** Chokepoints: a sparse scatter that never touches a site or its ring, so the
 *  site graph stays reachable no matter what the seed rolls. */
function pickBlocked(rng, cols, rows, sites) {
  const near = new Set();
  for (const s of sites) {
    for (let dq = -1; dq <= 1; dq++) {
      for (let dr = -1; dr <= 1; dr++) near.add(`${s.hex[0] + dq},${s.hex[1] + dr}`);
    }
  }
  const open = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const h = offsetToAxial(col, row);
      if (!near.has(`${h[0]},${h[1]}`)) open.push(h);
    }
  }
  const want = Math.min(open.length, Math.floor(cols * rows * FALLBACK_MAP.blockedFrac));
  const taken = new Set();
  for (let g = 0; taken.size < want && g < want * 8; g++) taken.add(rng.int(0, open.length));
  return [...taken].map((i) => open[i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** Nearest-N graph, then a union-find pass that stitches any stranded component
 *  to its closest neighbour. Sends go to adjacent sites only, so a disconnected
 *  site graph is an unwinnable battle: this makes that impossible. */
function nearestGraph(sites) {
  const edges = new Set();
  const parent = new Map(sites.map((s) => [s.id, s.id]));
  const find = (x) => { while (parent.get(x) !== x) x = parent.get(x); return x; };
  const link = (a, b) => {
    edges.add(a < b ? `${a} ${b}` : `${b} ${a}`);
    const ra = find(a); const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const a of sites) {
    sites.filter((b) => b.id !== a.id)
      .sort((x, y) => hexDist(a.hex, x.hex) - hexDist(a.hex, y.hex) || (x.id < y.id ? -1 : 1))
      .slice(0, FALLBACK_MAP.degree)
      .forEach((b) => link(a.id, b.id));
  }
  for (let guard = 0; guard < sites.length; guard++) {
    if (new Set(sites.map((s) => find(s.id))).size <= 1) break;
    let best = null;
    for (const a of sites) {
      for (const b of sites) {
        if (find(a.id) === find(b.id)) continue;
        const d = hexDist(a.hex, b.hex);
        const tie = best && d === best.d && `${a.id}${b.id}` < `${best.a}${best.b}`;
        if (!best || d < best.d || tie) best = { d, a: a.id, b: b.id };
      }
    }
    if (!best) break;
    link(best.a, best.b);
  }
  return [...edges].sort().map((e) => e.split(' '));
}

/** Fill in every field the contract requires, whoever generated the layout.
 *  An injected mapGen may set hp/garrison itself; anything it omits lands here. */
function normalizeSites(raw, mult) {
  return raw.map((s, i) => {
    const level = Math.max(1, Math.min(SITE_LEVELS.length, s.level ?? 1));
    const spec = SITES[s.kind] ?? SITES.farm;
    const lv = SITE_LEVELS[level - 1];
    const hpMax = s.hpMax ?? spec.hp * lv.hp;
    const base = s.owner === 'enemy' ? BASE_GARRISON[s.kind] ?? {}
      : s.owner === 'neutral' ? NEUTRAL_GARRISON
        : (s.kind === 'camp' ? BASE_GARRISON.camp : PLAYER_SITE_GARRISON);
    const garrison = s.garrison ?? (s.owner === 'enemy'
      ? scaleGarrison(base, mult ** ENEMY_SCALING.garrison)
      : { ...base });
    return {
      id: s.id ?? `s${i}`,
      kind: s.kind,
      owner: s.owner,
      hex: [s.hex[0], s.hex[1]],
      level,
      garrison,
      hp: s.hp ?? hpMax,
      hpMax,
      hpRegen: s.hpRegen ?? spec.hpRegen * lv.regen,
      trainType: s.trainType ?? (s.owner === 'enemy' ? 'spearmen' : 'militia'),
    };
  });
}

/**
 * Call the injected generator. The context carries the same facts under BOTH
 * naming conventions ({grid, siteCounts} and flat {cols, rows, *Sites}) and is
 * passed with `seed` as a second argument, so battle/mapgen.js's
 * `generateBattleMap(regionSpec, seed)` is a drop-in with no adapter, and so is
 * anything preferring a single ctx. The return normalises the same way:
 * `blocked` may sit at the top level or inside `grid`.
 */
function callMapGen(mapGen, { region, seed, mult, isRaid }) {
  const { grid, siteCounts } = region;
  const ctx = {
    region, grid, siteCounts, seed, isRaid, enemyMult: mult, tier: region.tier,
    cols: grid.cols, rows: grid.rows, playerSites: siteCounts.player,
    enemySites: siteCounts.enemy, neutralSites: siteCounts.neutral,
    rng: createRng(seed),
  };
  const gen = (typeof mapGen === 'function' ? mapGen : fallbackMapGen)(ctx, seed);
  if (!gen || !Array.isArray(gen.sites)) {
    throw new TypeError('mapGen must return { sites, adjacency, blocked | grid.blocked }');
  }
  return {
    sites: gen.sites,
    adjacency: gen.adjacency ?? [],
    blocked: gen.blocked ?? gen.grid?.blocked ?? [],
  };
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
