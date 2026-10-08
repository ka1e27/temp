// PLAN-PHASE15 follow-up scratch: how many attack arenas get a last-resort strip (a non-approach march longer than corridorMaxTiles).
import { runDynasties, hooks } from './campaign.mjs';
import { attackableFrontier, playerBattleStats, enemyBattleStats } from '../game/meta/progression.js';
import { attackArenaOpts } from '../game/meta/frontier.js';
import { buildArena } from '../game/battle/arena.js';
import { BATTLE } from '../game/config/battle.js';
let n = 0; let long = 0; const names = new Set();
hooks.onConquest = (live, world) => {
  for (const id of attackableFrontier(live, world)) {
    let a; try { a = buildArena(world, live.owner, id, playerBattleStats(live, world, id), enemyBattleStats(world, live, id), attackArenaOpts(live, world, id)); } catch { continue; }
    n += 1;
    if (a.marches.some((m) => !m.approach && m.tiles.length > BATTLE.corridorMaxTiles)) { long += 1; names.add(`${live.dynasty.level}:${world.regions[id].name}`); }
  }
};
for (const seed of [1, 2, 3, 4, 5, 6, 11]) runDynasties(seed, 4, {});
console.log(`arenas ${n}, with a last-resort strip ${long} (${(100 * long / n).toFixed(2)}%): ${[...names].join(', ')}`);
