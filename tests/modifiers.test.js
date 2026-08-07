// The seam. If anything in this file breaks, meta and battle have drifted apart
// and every number in the game is suspect.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTRACT_VERSION, assertBattleConfig, assertBattleOutcome, hashBattleConfig,
} from '../src/battle/contract.js';
import { EXPEDITION, UNIT_IDS, AI_TIERS } from '../src/content/balance.js';
import { REGIONS, REGION_BY_ID, ENEMY_SCALING } from '../src/content/regions.data.js';
import { createState } from '../src/core/store.js';
import {
  STACKING_ORDER, stack, buildBattleConfig, expeditionSize, distributeExpedition,
  fitComposition, playerMods, enemyMods, fallbackMapGen,
} from '../src/meta/modifiers.js';
import { refreshUnlocks } from '../src/meta/world.js';
import { recalcIncome } from '../src/meta/idle.js';

const world = (conquered = [], upgrades = {}, crowns = 0) => {
  const s = createState({ seed: 4242, now: 0 });
  for (const id of conquered) s.meta.regions[id].status = 'conquered';
  Object.assign(s.meta.upgrades, upgrades);
  s.meta.crowns = crowns;
  refreshUnlocks(s.meta);
  recalcIncome(s.meta);
  return s;
};
const total = (c) => UNIT_IDS.reduce((a, u) => a + (c[u] || 0), 0);

// ===========================================================================
// THE STACKING ORDER. Two engineers who each pick a plausible order produce
// numbers that disagree forever and neither is "wrong". So it is asserted.
// ===========================================================================

test('the fixed stacking order is base -> additive -> multiplicative -> boosters -> tier', () => {
  assert.deepEqual([...STACKING_ORDER],
    ['base', 'additive', 'multiplicative', 'boosters', 'tier']);
});

test('stack() computes exactly base x (1 + SUM add) x PROD mult x boosters x tier', () => {
  const args = { additive: 0.3, multiplicative: 1.15, boosters: 1.5, tier: 2.6 };
  assert.equal(stack(100, args), 100 * (1 + 0.3) * 1.15 * 1.5 * 2.6);
  assert.equal(stack(7), 7, 'no stages supplied == identity');
  assert.equal(stack(0, args), 0);
});

test('additive bonuses SUM before multiplying; they never compound', () => {
  // Two +8% upgrades are +16%, not +16.64%. This is the single most commonly
  // mis-implemented rule in the whole design.
  assert.ok(Math.abs(stack(1, { additive: 0.08 + 0.08 }) - 1.16) < 1e-12);
  assert.notEqual(stack(1, { additive: 0.16 }), 1.08 * 1.08);
});

test('order matters: the fixed order differs from every plausible alternative', () => {
  const base = 100; const add = 0.3; const mult = 1.2; const boost = 1.5; const tier = 2.6;
  const fixed = stack(base, { additive: add, multiplicative: mult, boosters: boost, tier });
  // Wrong #1: folding the tier into the additive bucket.
  assert.notEqual(fixed, base * (1 + add + tier) * mult * boost);
  // Wrong #2: folding boosters into the additive bucket.
  assert.notEqual(fixed, base * (1 + add + boost) * mult * tier);
  // Wrong #3: applying the tier to the base before anything else and treating
  //           the additive sum as a multiplier of its own.
  assert.notEqual(fixed, base * tier * add * mult * boost);
  // Multiplication is commutative, so the ONLY thing the order fixes is which
  // bucket a bonus lands in. That is exactly the drift this guards against.
  assert.equal(fixed, base * tier * boost * mult * (1 + add));
});

test('flat upgrade bonuses join the BASE, they are never applied after a multiplier', () => {
  const p = playerMods(world([], { warChest: 2 }).meta, {});
  assert.equal(p.startGold, 300 + 2 * 150, 'War Chest adds to base gold');
  const q = playerMods(world([], { biggerCamp: 3 }).meta, {});
  assert.equal(q.garrisonCapBonus, 75);
});

test('the enemy difficulty dial rides the TIER bucket, AI knobs ride multiplicative', () => {
  const region = REGION_BY_ID.kaldan;
  const e = enemyMods(region, region.enemyMult);
  const ai = AI_TIERS[region.tier - 1];
  assert.ok(Math.abs(e.unitAtkMult - region.enemyMult ** ENEMY_SCALING.atk) < 1e-12);
  assert.ok(Math.abs(e.unitDefMult - region.enemyMult ** ENEMY_SCALING.def) < 1e-12);
  assert.ok(Math.abs(e.goldRateMult - ai.economyMult * region.enemyMult ** ENEMY_SCALING.gold) < 1e-12);
  // x1.00 at Riverfen must leave the enemy at literal baseline.
  const r1 = enemyMods(REGION_BY_ID.riverfen, 1);
  for (const k of ['unitAtkMult', 'unitDefMult', 'trainSpeedMult', 'siegeDmgMult']) {
    assert.equal(r1[k], 1, `${k} must be baseline at enemyMult 1.0`);
  }
});

// ===========================================================================
// Expedition
// ===========================================================================

test('expedition = 8 + 4 x regionsConquered + 4 x Standing Army level', () => {
  assert.equal(expeditionSize(world([])), EXPEDITION.base);
  assert.equal(expeditionSize(world(['riverfen'])), 12);
  assert.equal(expeditionSize(world(['riverfen', 'ashford'])), 16);
  assert.equal(expeditionSize(world(['riverfen', 'ashford', 'ironwood'])), 20);
  assert.equal(expeditionSize(world(['riverfen', 'ashford', 'ironwood', 'saltmere'])), 24);
  // ...which is exactly the plan's per-region expedition column: 8/12/16/20/24.
  assert.equal(expeditionSize(world([], { standingArmy: 1 })), 12);
  assert.equal(expeditionSize(world([], { standingArmy: 6 })), 8 + 24);
  assert.equal(expeditionSize(world(['riverfen', 'ashford'], { standingArmy: 3 })), 16 + 12);
});

test('distribution is exact for every size and unlock set', () => {
  const sets = [
    ['militia', 'spearmen'],
    ['militia', 'spearmen', 'raiders'],
    ['militia', 'spearmen', 'raiders', 'rams'],
    ['militia', 'spearmen', 'raiders', 'rams', 'marshal'],
  ];
  for (const unlocked of sets) {
    for (let n = 0; n <= 60; n++) {
      const comp = distributeExpedition(n, unlocked);
      assert.equal(total(comp), n, `size ${n} for ${unlocked.join('+')}`);
      for (const u of UNIT_IDS) {
        assert.ok(Number.isInteger(comp[u]) && comp[u] >= 0, `${u} must be a non-negative integer`);
        if (!unlocked.includes(u)) assert.equal(comp[u], 0, `${u} is locked but was deployed`);
      }
      assert.ok(comp.marshal <= 1, 'at most one Marshal');
    }
  }
});

test('a player composition is treated as ratios and re-fitted to the granted size', () => {
  const unlocked = ['militia', 'spearmen', 'raiders'];
  const fitted = fitComposition(20, unlocked, { militia: 1, raiders: 1 });
  assert.equal(total(fitted), 20);
  assert.equal(fitted.spearmen, 0);
  assert.equal(fitted.militia, 10);
  assert.equal(fitted.raiders, 10);
  // You cannot mint troops by asking for 500.
  assert.equal(total(fitComposition(12, unlocked, { militia: 500 })), 12);
  // You cannot deploy what you have not unlocked.
  assert.equal(fitComposition(12, unlocked, { rams: 9 }).rams, 0);
  // An empty ask falls back to the default spread rather than an empty army.
  assert.equal(total(fitComposition(12, unlocked, {})), 12);
});

// ===========================================================================
// buildBattleConfig
// ===========================================================================

test('every one of the 18 regions produces a config that passes assertBattleConfig', () => {
  const s = createState({ seed: 99, now: 0 });
  for (const r of REGIONS) {
    const cfg = buildBattleConfig(s, r.id, [], null);
    assert.doesNotThrow(() => assertBattleConfig(cfg), `${r.id} config invalid`);
    assert.equal(cfg.contractVersion, CONTRACT_VERSION);
    assert.equal(cfg.region.id, r.id);
    assert.equal(cfg.grid.cols, r.grid.cols);
    assert.equal(cfg.grid.rows, r.grid.rows);
    assert.equal(cfg.sites.length,
      r.siteCounts.enemy + r.siteCounts.neutral + r.siteCounts.player, `${r.id} site count`);
    assert.equal(cfg.rules.hardCapMs, r.hardCapMs);
    assert.equal(cfg.rules.aiTier, r.tier);
    assert.ok(cfg.sites.every((x) => x.hp > 0 && x.hpMax > 0 && x.hpRegen > 0));
    assert.equal(JSON.parse(JSON.stringify(cfg)).battleId, cfg.battleId, 'must be JSON-clean');
  }
});

test('a config is fully JSON-serialisable: no functions, no undefined', () => {
  const cfg = buildBattleConfig(createState({ seed: 5 }), 'riverfen', [], null);
  const walk = (v, path) => {
    assert.notEqual(typeof v, 'function', `${path} is a function`);
    assert.notEqual(v, undefined, `${path} is undefined`);
    if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], `${path}.${k}`);
  };
  walk(cfg, 'config');
  assert.deepEqual(JSON.parse(JSON.stringify(cfg)), cfg);
});

test('config generation is deterministic for the same meta state', () => {
  const a = buildBattleConfig(world(['riverfen']), 'ashford', [], null);
  const b = buildBattleConfig(world(['riverfen']), 'ashford', [], null);
  assert.deepEqual(a, b);
  assert.equal(hashBattleConfig(a), hashBattleConfig(b));
  // ...and a different world seed genuinely diverges.
  const c = buildBattleConfig({ ...world(['riverfen']), seed: 777 }, 'ashford', [], null);
  assert.notEqual(hashBattleConfig(a), hashBattleConfig(c));
});

test('configHash is NOT stored inside the config (it could never match itself)', () => {
  const cfg = buildBattleConfig(createState({ seed: 5 }), 'riverfen', [], null);
  assert.equal(cfg.configHash, undefined);
  const outcome = {
    contractVersion: CONTRACT_VERSION, battleId: cfg.battleId,
    configHash: hashBattleConfig(cfg), regionId: 'riverfen',
    result: 'win', durationMs: 1000, ticks: 10, stats: {}, boostersConsumed: [],
  };
  assert.doesNotThrow(() => assertBattleOutcome(outcome, cfg));
});

test('the expedition really lands in the player mods and grows with the empire', () => {
  const early = buildBattleConfig(world([]), 'riverfen', [], null);
  assert.equal(total(early.player.expedition), 8);
  const late = buildBattleConfig(
    world(['riverfen', 'ashford', 'ironwood', 'saltmere'], { standingArmy: 2 }), 'kaldan', [], null,
  );
  assert.equal(total(late.player.expedition), 24 + 8);
  assert.equal(total(late.enemy.expedition), 0, 'the enemy head start is land, not a free army');
});

test('unlocked units gate what can be deployed and what the enemy fields', () => {
  const cfg = buildBattleConfig(world([], { unlockRaiders: 1 }), 'riverfen', [], null);
  assert.deepEqual(cfg.player.unlockedUnits, ['militia', 'spearmen', 'raiders']);
  assert.equal(cfg.player.expedition.rams, 0);
  assert.deepEqual(enemyMods(REGION_BY_ID.riverfen, 1).unlockedUnits, ['militia', 'spearmen']);
  assert.ok(enemyMods(REGION_BY_ID.obsidian, 12.5).unlockedUnits.includes('marshal'));
});

test('an injected mapGen is used, and its output is normalised into a valid config', () => {
  let seenCtx = null;
  const mapGen = (ctx) => {
    seenCtx = ctx;
    return {
      blocked: [[0, 0]],
      sites: [
        { id: 'home', kind: 'camp', owner: 'player', hex: [1, 1] },
        { id: 'keep', kind: 'castle', owner: 'enemy', hex: [6, 1] },
        { id: 'mid', kind: 'farm', owner: 'neutral', hex: [3, 1] },
      ],
      adjacency: [['home', 'mid'], ['mid', 'keep'], ['mid', 'ghost']],
    };
  };
  const cfg = buildBattleConfig(createState({ seed: 3 }), 'riverfen', [], mapGen);
  assert.equal(seenCtx.region.id, 'riverfen');
  assert.deepEqual(seenCtx.siteCounts, REGION_BY_ID.riverfen.siteCounts);
  assert.ok(typeof seenCtx.rng.next === 'function', 'mapGen gets a seeded rng');
  assert.equal(cfg.sites.length, 3);
  assert.ok(cfg.sites.every((s) => s.hp > 0 && s.garrison));
  assert.deepEqual(cfg.adjacency, [['home', 'mid'], ['mid', 'keep']], 'dangling edge dropped');
  assert.doesNotThrow(() => assertBattleConfig(cfg));
});

test('the fallback layout is connected, unblocked, and has one camp and one castle', () => {
  for (const r of REGIONS) {
    const gen = fallbackMapGen({ grid: r.grid, siteCounts: r.siteCounts, seed: 12345 });
    assert.equal(gen.sites.filter((s) => s.kind === 'camp' && s.owner === 'player').length, 1);
    assert.equal(gen.sites.filter((s) => s.kind === 'castle' && s.owner === 'enemy').length, 1);

    const blocked = new Set(gen.blocked.map(([q, x]) => `${q},${x}`));
    for (const s of gen.sites) assert.ok(!blocked.has(`${s.hex[0]},${s.hex[1]}`), 'site on a wall');

    // Sends go to adjacent sites only, so a disconnected graph is unwinnable.
    const adj = new Map(gen.sites.map((s) => [s.id, []]));
    for (const [a, b] of gen.adjacency) { adj.get(a).push(b); adj.get(b).push(a); }
    const seen = new Set([gen.sites[0].id]);
    const queue = [gen.sites[0].id];
    while (queue.length) {
      for (const n of adj.get(queue.pop())) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
    assert.equal(seen.size, gen.sites.length, `${r.id} site graph is disconnected`);
  }
});

test('battle/mapgen.js is a drop-in when it exists (skipped if it does not)', async (t) => {
  // Deliberately a dynamic, optional import: meta must never be BLOCKED on the
  // battle engineer's file, but when it does exist the seam must actually fit.
  let generateBattleMap;
  try { ({ generateBattleMap } = await import('../src/battle/mapgen.js')); } catch {
    return t.skip('battle/mapgen.js not written yet');
  }
  const s = createState({ seed: 999, now: 0 });
  for (const r of REGIONS) {
    const cfg = buildBattleConfig(s, r.id, [], generateBattleMap);
    assert.doesNotThrow(() => assertBattleConfig(cfg), `${r.id} with the real mapgen`);
    assert.equal(cfg.sites.length,
      r.siteCounts.enemy + r.siteCounts.neutral + r.siteCounts.player);
    assert.ok(cfg.grid.blocked.length > 0, 'blocked hexes survive the normalisation');
  }
});

test('the fallback layout is deterministic per seed and diverges across seeds', () => {
  const r = REGION_BY_ID.saltmere;
  const a = fallbackMapGen({ grid: r.grid, siteCounts: r.siteCounts, seed: 11 });
  const b = fallbackMapGen({ grid: r.grid, siteCounts: r.siteCounts, seed: 11 });
  const c = fallbackMapGen({ grid: r.grid, siteCounts: r.siteCounts, seed: 12 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.blocked, c.blocked);
});
