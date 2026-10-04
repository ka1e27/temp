// The Steward (DESIGN §10.6, ARCHITECTURE §10.3): the player's side when nobody watches. Reinforces early, keeps the keep's
// garrison home in a defense, retakes only with clear odds, uses Bulwark when the bulk of an attack lands and Levy when ready,
// holds in an attack unless the odds are overwhelming, never retreats; deterministic and cheap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, step, issue } from '../battle/sim.js';
import { stewardDecide, stewardThink, stewardStyle } from '../battle/steward.js';
import { think } from '../battle/ai.js';
import { buildDefenseArena } from '../battle/defenseArena.js';
import { generateWorld } from '../world/generate.js';
import { createGame } from '../meta/state.js';
import { playerBattleStats } from '../meta/progression.js';
import { raidEnemyStats, raidDepth, borderingRivals } from '../meta/frontier.js';
import { canBuildDefenseArena } from '../battle/defenseArena.js';
import { STEWARD } from '../config/frontier.js';
import { TICK_SEC } from '../config/battle.js';

const SQ3 = Math.sqrt(3);
const POWERLESS = Object.freeze({ rally: 0, firestorm: 0, bulwark: 0, march: 0, levy: 0 });
const PLAYER = Object.freeze({
  atk: 1, def: 1, growth: 0, speed: 1, campTroops: 30, garrisonShare: 0.35, capBonus: 0, cooldownMult: 1, powers: POWERLESS,
});
const RAIDER = Object.freeze({
  atk: 1, def: 1, growth: 0, speed: 1, troopMult: 1, thinkSec: 1, graceSec: 0, personality: 'aggressive', factionId: 3,
});

function line({ length = 12, haloTiles = 2, sites, mode = 'defense', siegeSec = 120 }) {
  const tiles = [];
  for (let q = 0; q < length; q++) {
    const tile = { i: q, q, r: 0, x: q * SQ3, y: 0, cost: 1, terrain: 'grass', region: q < haloTiles ? 1 : 0 };
    if (q < haloTiles) tile.own = mode === 'defense' ? 3 : 0;
    tiles.push(tile);
  }
  const list = sites.map(([tile, type, owner, troops], id) => ({ id, settlement: id - 1, tile, type, owner, troops }));
  const arena = { regionId: 0, enemyFaction: 3, tiles, sites: list, focus: { minX: 0, maxX: (length - 1) * SQ3, minY: 0, maxY: 0 }, marches: [] };
  if (mode === 'defense') Object.assign(arena, { mode, siegeSec, campSite: 0, keepSite: list.findIndex((s) => s.type === 'keep') });
  return arena;
}

const sends = (cmds) => cmds.filter((c) => c.type === 'send');

test('styles: captain and stalwart exist, Phase-2 styles fall back to their tables, unknown names get the strong default', () => {
  for (const s of ['captain', 'stalwart', 'bold', 'cunning', 'swift']) assert.equal(stewardStyle(s), STEWARD[s]);
  assert.equal(stewardStyle('nonsense'), STEWARD.stalwart);
  assert.ok(STEWARD.captain.thinkSec > STEWARD.stalwart.thinkSec, 'the Militia Captain is slower');
  assert.ok(STEWARD.captain.lookahead < STEWARD.stalwart.lookahead, 'and sees less far ahead');
});

test('thinks on its own cadence, keeps its memo in battle.steward by default, never retreats', () => {
  const battle = createBattle(line({ sites: [[0, 'camp', 3, 10], [6, 'village', 0, 30], [11, 'keep', 0, 50]] }), PLAYER, RAIDER);
  const first = stewardDecide(battle, 0, undefined, 'stalwart');
  assert.ok(battle.steward && battle.steward.nextThink === STEWARD.stalwart.thinkSec, 'memo lives in the battle (saved with it)');
  assert.deepEqual(stewardDecide(battle, 0.5, undefined, 'stalwart'), [], 'nothing between looks');
  void first;
  for (let t = 0; t < 200; t += 0.5) for (const c of stewardDecide(battle, t, battle.steward, 'captain')) assert.notEqual(c.type, 'retreat');
});

test('reinforces a threatened site from the others, keep first, before the attack lands', () => {
  // the raid marches on the village (tile 4); the town (tile 7) can help in time
  const battle = createBattle(line({ sites: [[0, 'camp', 3, 80], [4, 'village', 0, 20], [7, 'town', 0, 60], [11, 'keep', 0, 40]] }), PLAYER, RAIDER);
  issue(battle, { type: 'send', owner: 3, from: [0], to: 1, fraction: 0.5 }); // 40 troops vs 20
  step(battle, TICK_SEC);
  const cmds = sends(stewardDecide(battle, battle.t, {}, 'stalwart'));
  assert.ok(cmds.some((c) => c.to === 1 && c.from[0] === 2), 'the town sends help to the village');
  assert.ok(!cmds.some((c) => c.from[0] === 3), 'the keep stays home in a defense');
});

test('the keep never leaves its walls in a defense, even with troops to spare', () => {
  const battle = createBattle(line({ sites: [[0, 'camp', 3, 5], [4, 'village', 0, 2], [11, 'keep', 0, 400]] }), PLAYER, RAIDER);
  for (let t = 0; t < 60; t += 0.5) for (const c of sends(stewardDecide(battle, t, battle.steward ??= {}, 'bold'))) assert.notEqual(c.from[0], 2);
});

test('retakes only with clear odds (>= style.retake x what the site will hold)', () => {
  // the raider holds a village at 30; the player's town has 40 spare (odds 1.33 < 1.5) and then 80 (2.7)
  const make = (townTroops) => createBattle(line({ sites: [[0, 'camp', 3, 0], [4, 'village', 3, 30], [6, 'town', 0, townTroops], [11, 'keep', 0, 50]] }), PLAYER, RAIDER);
  const weak = make(50);
  assert.deepEqual(sends(stewardThink(weak, 0, {}, { ...STEWARD.stalwart, consolidate: false })).filter((c) => c.to === 1), [], 'no attack at poor odds');
  const strong = make(120);
  const cmds = sends(stewardThink(strong, 0, {}, { ...STEWARD.stalwart, consolidate: false }));
  assert.ok(cmds.some((c) => c.to === 1 || c.to === 0), 'attacks with clear odds');
});

test('attack battles: holds what it has and attacks only with overwhelming odds (2x)', () => {
  const make = (camp) => createBattle(line({ mode: 'attack', sites: [[0, 'camp', 0, camp], [4, 'village', 3, 30], [11, 'keep', 3, 60]] }), PLAYER, RAIDER);
  assert.deepEqual(sends(stewardDecide(make(50), 0, {}, 'stalwart')), [], '50 against 30 is not overwhelming');
  const big = sends(stewardDecide(make(100), 0, {}, 'stalwart'));
  assert.ok(big.some((c) => c.to === 1), '100 against 30 is');
});

test('powers: Bulwark when the bulk of an attack lands on a site that would fall, Levy when ready', () => {
  const powers = { rally: 0, firestorm: 0, bulwark: 1, march: 0, levy: 1 };
  const battle = createBattle(line({ sites: [[0, 'camp', 3, 60], [3, 'keep', 0, 30], [9, 'village', 0, 10]] }), { ...PLAYER, powers }, RAIDER);
  issue(battle, { type: 'send', owner: 3, from: [0], to: 1, fraction: 1 }); // 60 vs 30 x 1.6 = 48: falls without Bulwark
  let bulwarkAt = null;
  let levyAt = null;
  const memo = {};
  while (!battle.result && battle.t < 20) {
    for (const c of stewardThink(battle, battle.t, memo, { ...STEWARD.stalwart, thinkSec: 0.25 })) {
      if (c.type === 'power' && c.power === 'bulwark' && bulwarkAt === null) { bulwarkAt = battle.t; assert.equal(c.target, 1); }
      if (c.type === 'power' && c.power === 'levy' && levyAt === null) levyAt = battle.t;
      issue(battle, c);
    }
    step(battle, TICK_SEC);
  }
  assert.ok(bulwarkAt !== null && bulwarkAt > 0.5, 'Bulwark waited for the attack to arrive');
  assert.ok(levyAt !== null, 'Levy was used');
  assert.equal(battle.sites[1].owner, 0, 'and the keep held');
});

test('evacuates a small site it cannot save into the keep (stalwart), the captain does not', () => {
  const make = () => createBattle(line({ length: 14, sites: [[0, 'camp', 3, 200], [4, 'village', 0, 20], [13, 'keep', 0, 50]] }), PLAYER, RAIDER);
  const a = make();
  issue(a, { type: 'send', owner: 3, from: [0], to: 1, fraction: 0.5 });
  step(a, TICK_SEC);
  const out = sends(stewardDecide(a, a.t, {}, 'stalwart'));
  assert.ok(out.some((c) => c.from[0] === 1 && c.to === 2), 'the village falls back to the keep');
  const b = make();
  issue(b, { type: 'send', owner: 3, from: [0], to: 1, fraction: 0.5 });
  step(b, TICK_SEC);
  assert.ok(!sends(stewardDecide(b, b.t, {}, 'captain')).some((c) => c.from[0] === 1), 'the Militia Captain just stands');
});

function realRaid(seed) {
  const world = generateWorld(seed);
  const state = createGame(seed, world, 0);
  for (const r of world.regions) if (r.tier <= 2) state.owner[r.id] = 0;
  state.upgrades = { rally: 2, firestorm: 1, bulwark: 1, levy: 1, steel: 4, armour: 4, recruitment: 4, muster: 4 };
  for (const { faction, pairs } of borderingRivals(state, world)) {
    for (const p of pairs) {
      if (!canBuildDefenseArena(world, state.owner, p.to, faction)) continue;
      const raid = { id: 1, faction, fromRegionId: p.from, toRegionId: p.to, depth: raidDepth(state, world, p.to), first: false };
      const player = playerBattleStats(state, world, p.to);
      const enemy = raidEnemyStats(state, world, raid);
      return { arena: buildDefenseArena(world, state.owner, p.to, { attackerFaction: faction, fromRegionId: p.from, player, enemy }), player, enemy };
    }
  }
  return null;
}

test('performance: stewardDecide and the war band\'s think() each stay under 0.5 ms a call on real defense battles', () => {
  let stewardMs = 0;
  let stewardCalls = 0;
  let thinkMs = 0;
  let thinkCalls = 0;
  let worst = 0;
  for (const seed of [1, 2, 3, 4]) {
    const r = realRaid(seed);
    if (!r) continue;
    for (const style of ['captain', 'stalwart']) {
      const battle = createBattle(r.arena, r.player, r.enemy, { mode: 'defense', siegeSec: r.arena.siegeSec });
      const memo = {};
      while (!battle.result) {
        let t0 = performance.now();
        for (const c of think(battle, battle.t)) issue(battle, c);
        const dt = performance.now() - t0;
        thinkMs += dt; thinkCalls += 1;
        t0 = performance.now();
        for (const c of stewardDecide(battle, battle.t, memo, style)) issue(battle, c);
        const ds = performance.now() - t0;
        stewardMs += ds; stewardCalls += 1;
        worst = Math.max(worst, ds);
        step(battle, TICK_SEC);
      }
    }
  }
  assert.ok(stewardCalls > 1000);
  assert.ok(stewardMs / stewardCalls < 0.5, `steward ${(stewardMs / stewardCalls).toFixed(4)} ms a call`);
  assert.ok(thinkMs / thinkCalls < 0.5, `think ${(thinkMs / thinkCalls).toFixed(4)} ms a call`);
});

test('performance: three concurrent defense battles step well inside a 60 fps frame', () => {
  const runs = [1, 2, 3].map((seed) => realRaid(seed)).filter(Boolean).map((r) => ({
    battle: createBattle(r.arena, r.player, r.enemy, { mode: 'defense', siegeSec: r.arena.siegeSec }), memo: {},
  }));
  assert.equal(runs.length, 3);
  let frames = 0;
  const t0 = performance.now();
  // 3x speed: three 0.05 s steps per battle per frame
  for (let f = 0; f < 600; f++) {
    for (const r of runs) {
      for (let k = 0; k < 3 && !r.battle.result; k++) {
        for (const c of think(r.battle, r.battle.t)) issue(r.battle, c);
        for (const c of stewardDecide(r.battle, r.battle.t, r.memo, 'stalwart')) issue(r.battle, c);
        step(r.battle, TICK_SEC);
      }
    }
    frames += 1;
  }
  const perFrame = (performance.now() - t0) / frames;
  assert.ok(perFrame < 4, `${perFrame.toFixed(3)} ms of sim per frame for 3 battles at 3x`);
});

test('a level-1 General\'s steward holds real raids at least as well as the Militia Captain (and better on the whole)', async () => {
  const { ensureGenerals } = await import('../meta/generals.js');
  const { commanderStyle } = await import('../meta/generalsState.js');
  let cap = 0;
  let gen = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const world = generateWorld(seed);
    const state = createGame(seed, world, 0);
    for (const r of world.regions) if (r.tier <= 2) state.owner[r.id] = 0;
    state.upgrades = { rally: 2, firestorm: 1, bulwark: 1, levy: 1, steel: 4, armour: 4, recruitment: 4, muster: 4 };
    const marshal = ensureGenerals(state).roster[0];
    for (const { faction, pairs } of borderingRivals(state, world)) {
      const p = pairs.find((x) => canBuildDefenseArena(world, state.owner, x.to, faction));
      if (!p) continue;
      for (const mult of [0.3, 0.5, 0.8]) {
        const raid = { id: 1, faction, fromRegionId: p.from, toRegionId: p.to, depth: raidDepth(state, world, p.to), first: false, mult };
        for (const who of ['captain', 'general']) {
          const player = playerBattleStats(state, world, p.to, who === 'general' ? { commander: marshal } : {});
          const enemy = raidEnemyStats(state, world, raid);
          const arena = buildDefenseArena(world, state.owner, p.to, { attackerFaction: faction, fromRegionId: p.from, player, enemy });
          const b = createBattle(arena, player, enemy, { mode: 'defense', siegeSec: arena.siegeSec });
          const memo = {};
          const style = who === 'general' ? commanderStyle(marshal) : 'captain';
          while (!b.result) {
            for (const c of think(b, b.t)) issue(b, c);
            for (const c of stewardDecide(b, b.t, memo, style)) issue(b, c);
            step(b, TICK_SEC);
          }
          if (b.result === 'win') { if (who === 'general') gen += 1; else cap += 1; }
        }
      }
    }
  }
  assert.ok(gen > cap, `the Marshal held ${gen}, the Captain ${cap}`);
});
