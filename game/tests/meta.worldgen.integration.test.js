// Sanity-checks the meta layer against the REAL world generator, once the
// world engineer has landed game/world/generate.js. Guarded: skipped rather
// than failed while that module doesn't exist yet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../meta/state.js';
import { incomePerSec } from '../meta/economy.js';
import { frontier, difficulty, playerBattleStats, enemyBattleStats } from '../meta/progression.js';

test('integration: meta works end to end against a real generated world', async (t) => {
  let generateWorld;
  try {
    ({ generateWorld } = await import('../world/generate.js'));
  } catch {
    t.skip('game/world/generate.js does not exist yet');
    return;
  }

  const world = generateWorld(1);
  const state = createGame(1, world, 0);

  assert.ok(incomePerSec(state, world) > 0, 'the start region always earns something');

  const front = frontier(state, world);
  assert.ok(front.length > 0, 'the start region always has at least one frontier neighbour');

  const player = playerBattleStats(state, world);
  assert.ok(Number.isFinite(player.atk) && player.atk > 0);

  for (const regionId of front) {
    const enemy = enemyBattleStats(world, state, regionId);
    assert.ok(Number.isFinite(enemy.troopMult) && enemy.troopMult > 0);

    const d = difficulty(state, world, regionId);
    assert.ok(Number.isFinite(d.power) && Number.isFinite(d.strength));
    assert.ok(['Easy', 'Fair', 'Hard', 'Deadly'].includes(d.label));
  }
});
