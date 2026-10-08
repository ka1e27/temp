// PLAN-PHASE15 scratch: why does one region lose at a high card ratio? Plays `--seed` dynasties to `--d` (bot), and at every conquest of
// dynasty d fights every frontier region matching --type/--twist once, printing the result, the time and who holds what at the end.
import { runDynasties, hooks } from './campaign.mjs';
import { difficulty, attackableFrontier, playerBattleStats, enemyBattleStats } from '../game/meta/progression.js';
import { attackArenaOpts } from '../game/meta/frontier.js';
import { buildArena } from '../game/battle/arena.js';
import { createBattle, step, issue } from '../game/battle/sim.js';
import { think } from '../game/battle/ai.js';
import { decide } from '../game/battle/bot.js';
import { TICK_SEC, patienceFor } from '../game/config/battle.js';
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const D = Number(args.d || 3);
let shown = 0;
hooks.onConquest = (live, world) => {
  if (live.dynasty.level !== D || shown > 12) return;
  const state = structuredClone(live);
  for (const id of attackableFrontier(state, world)) {
    const r = world.regions[id];
    if ((args.type && r.type !== args.type) || (args.twist && r.twist !== args.twist)) continue;
    const d = difficulty(state, world, id);
    const player = playerBattleStats(state, world, id); const enemy = enemyBattleStats(world, state, id);
    const b = createBattle(buildArena(world, state.owner, id, player, enemy, attackArenaOpts(state, world, id)), player, enemy);
    const memo = {}; const cap = patienceFor(r, D);
    while (!b.result && b.t < cap) { for (const c of think(b, b.t)) issue(b, c); for (const c of decide(b, b.t, memo)) issue(b, c); step(b, TICK_SEC); }
    const own = {}; for (const s of b.sites) own[s.owner] = (own[s.owner] || 0) + 1;
    console.log(`${r.name} t${r.tier} ${r.type || ''}/${r.twist || ''} sites ${r.settlements.length} raw ${d.rawRatio.toFixed(2)} ${d.label} -> ${b.result || 'timeout'} at ${b.t.toFixed(0)}s/${cap}; owners ${JSON.stringify(own)}; types ${b.sites.map((s) => s.type + ':' + s.owner + ':' + Math.round(s.troops)).join(' ')}`);
    shown += 1;
  }
};
runDynasties(Number(args.seed || 11), D, {});
