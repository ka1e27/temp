// PLAN-PHASE15 follow-up: the Penhold wall. Seed 11's third continent has a tier-4 Gold Mine on Holy Ground whose village sat behind the
// keep's land, out of reach of a War Camp no border garrison joined: the keep was fed from behind and the camp was taken, so the fight
// was lost at any strength (0 of 21 probes, up to a 2.7 raw ratio). arena.js now opens a longer last-resort strip to such a settlement
// (BATTLE.corridorMaxTilesLastResort).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runDynasties, hooks } from '../../tools/campaign.mjs';
import { difficulty, attackableFrontier, playerBattleStats, enemyBattleStats } from '../meta/progression.js';
import { attackArenaOpts } from '../meta/frontier.js';
import { buildArena } from '../battle/arena.js';
import { createBattle, step, issue, canRoute } from '../battle/sim.js';
import { think } from '../battle/ai.js';
import { decide } from '../battle/bot.js';
import { TICK_SEC, patienceFor } from '../config/battle.js';
import { PLAYER_FACTION } from '../meta/state.js';

test('Penhold (seed 11, D3): every settlement is reachable before the keep, and a strong army wins it', () => {
  const snaps = [];
  hooks.onConquest = (live, world) => {
    if (live.dynasty.level !== 3) return;
    const id = attackableFrontier(live, world).find((i) => world.regions[i].name === 'Penhold');
    if (id == null) return;
    const d = difficulty(live, world, id);
    if (d.rawRatio >= 2.1) snaps.push({ state: structuredClone(live), world, id, raw: d.rawRatio });
  };
  try { runDynasties(11, 3, { policy: 'human' }); } finally { hooks.onConquest = null; }
  assert.ok(snaps.length >= 3, `Penhold was offered at a raw ratio of 2.1+ only ${snaps.length} times`);
  let won = 0;
  for (const { state, world, id } of snaps.slice(0, 6)) {
    const player = playerBattleStats(state, world, id);
    const enemy = enemyBattleStats(world, state, id);
    const arena = buildArena(world, state.owner, id, player, enemy, attackArenaOpts(state, world, id));
    assert.equal(arena.sites.filter((s) => s.owner === 0).length, 1, 'only the War Camp fights here (the case under test)');
    const b = createBattle(arena, player, enemy);
    // capture closure: taking whatever the player can reach, again and again, reaches every settlement but the keep
    const sim = { ...b, sites: b.sites.map((s) => ({ ...s })) };
    for (let progress = true; progress;) {
      progress = false;
      for (const s of sim.sites) {
        if (s.owner === 0 || s.type === 'keep') continue;
        if (sim.sites.some((m) => m.owner === 0 && canRoute(b, 0, m.id, s.id))) { s.owner = 0; b.sites[s.id].owner = 0; progress = true; }
      }
    }
    assert.ok(b.sites.every((s) => s.owner === 0 || s.type === 'keep'), 'a settlement is walled in behind the keep');
    const fight = createBattle(buildArena(world, state.owner, id, player, enemy, attackArenaOpts(state, world, id)), player, enemy);
    const memo = {};
    const cap = patienceFor(world.regions[id], 3) * 2;
    while (!fight.result && fight.t < cap) {
      for (const c of think(fight, fight.t)) issue(fight, c);
      for (const c of decide(fight, fight.t, memo)) issue(fight, c);
      step(fight, TICK_SEC);
    }
    if (fight.result === 'win') won += 1;
  }
  void PLAYER_FACTION;
  assert.ok(won >= Math.min(snaps.length, 6) - 1, `a 2.1+ army won Penhold only ${won} of ${Math.min(snaps.length, 6)} times`);
});
