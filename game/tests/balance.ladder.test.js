// The enemy difficulty ladder (game/meta/progression.js enemyDepth): every region but the start gets an
// evenly spaced depth from 1 (the tutorial fight) to the deepest rung of ENEMY_SCALING.atkDefByTier, in
// order of tier, so one conquest is one small step up and worlds of any size end equally hard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/generate.js';
import { createGame, PLAYER_FACTION } from '../meta/state.js';
import { enemyDepth, enemyBattleStats, frontier, difficulty } from '../meta/progression.js';
import { ENEMY_SCALING } from '../config/battle.js';

const DEEPEST = ENEMY_SCALING.atkDefByTier.length - 1;

test('ladder: the start region is depth 0, the rest spread evenly over 1..deepest in tier order', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const world = generateWorld(seed);
    const rest = world.regions.filter((r) => r.tier >= 1);
    for (const r of world.regions.filter((x) => x.tier <= 0)) assert.equal(enemyDepth(world, r), 0);
    const depths = rest.map((r) => ({ tier: r.tier, d: enemyDepth(world, r) }));
    for (const { d } of depths) assert.ok(d >= 1 - 1e-9 && d <= DEEPEST + 1e-9, `seed ${seed}: depth ${d}`);
    assert.ok(Math.min(...depths.map((x) => x.d)) < 1 + 1e-9, 'the ladder starts at 1');
    assert.ok(Math.max(...depths.map((x) => x.d)) > DEEPEST - 1e-9, 'the ladder reaches the deepest rung');
    const byTier = [...depths].sort((a, b) => a.tier - b.tier || a.d - b.d);
    for (let i = 1; i < byTier.length; i++) {
      assert.ok(byTier[i].d >= byTier[i - 1].d - 1e-9, `seed ${seed}: a deeper tier is never shallower`);
    }
    // evenly spaced ladder positions: neighbouring rungs are one step apart once ENEMY_SCALING.ladderCurve is undone (PLAN-PHASE11: 1.15)
    const pos = (d) => (DEEPEST - 1) * Math.pow((d - 1) / (DEEPEST - 1), 1 / ENEMY_SCALING.ladderCurve);
    const sorted = depths.map((x) => pos(x.d)).sort((a, b) => a - b);
    const step = (DEEPEST - 1) / (sorted.length - 1);
    for (let i = 1; i < sorted.length; i++) assert.ok(Math.abs(sorted[i] - sorted[i - 1] - step) < 1e-6);
  }
});

test('ladder: the easiest first-ring region is depth 1 on every seed (the tutorial fight reads the same)', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const world = generateWorld(seed);
    const state = createGame(seed, world, 0);
    const first = Math.min(...frontier(state, world).map((id) => enemyDepth(world, world.regions[id])));
    assert.ok(Math.abs(first - 1) < 1e-9, `seed ${seed}: easiest neighbour at depth ${first}`);
  }
});

test('ladder: deterministic and JSON-safe', () => {
  const a = generateWorld(3);
  const b = generateWorld(3);
  const state = createGame(3, a, 0);
  for (const r of a.regions) assert.equal(enemyDepth(a, r), enemyDepth(b, b.regions[r.id]));
  const stats = enemyBattleStats(a, state, a.regions.find((r) => r.tier >= 3).id);
  assert.deepEqual(JSON.parse(JSON.stringify(stats)), stats);
});

test('ladder: after the first win a frontier region is Easy or Fair on most seeds (no Deadly wall)', () => {
  // A player who has won the tutorial fight must see a target, not a screen of Deadly cards.
  let withTarget = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const world = generateWorld(seed);
    const state = createGame(seed, world, 0);
    const first = frontier(state, world).sort((a, b) => enemyDepth(world, world.regions[a]) - enemyDepth(world, world.regions[b]))[0];
    state.owner[first] = PLAYER_FACTION;
    state.stats.battlesWon = 1;
    const labels = frontier(state, world).map((id) => difficulty(state, world, id).label);
    if (labels.some((l) => l === 'Easy' || l === 'Fair')) withTarget++;
  }
  assert.ok(withTarget >= 10, `only ${withTarget}/12 seeds show an Easy or Fair region after the first win`);
});
