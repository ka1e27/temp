// PLAN-PHASE15 follow-up scratch: how often an attack arena gives the player only its War Camp, and how those probes fare.
import { runDynasties, hooks } from './campaign.mjs';
import { difficulty, attackableFrontier, playerBattleStats, enemyBattleStats } from '../game/meta/progression.js';
import { attackArenaOpts } from '../game/meta/frontier.js';
import { buildArena } from '../game/battle/arena.js';
import { createBattle, step, issue } from '../game/battle/sim.js';
import { think } from '../game/battle/ai.js';
import { decide } from '../game/battle/bot.js';
import { TICK_SEC, patienceFor } from '../game/config/battle.js';
const outcomes = { solo: {}, soloOld: {}, multi: {} };
function fight(state, world, id, arena, p, e, guard = true) {
  arena = structuredClone(arena);
  const b = createBattle(arena, p, e); const memo = guard ? {} : { loneGuard: false }; const cap = patienceFor(world.regions[id], state.dynasty.level);
  while (!b.result && b.t < cap) { for (const c of think(b, b.t)) issue(b, c); for (const c of decide(b, b.t, memo)) issue(b, c); step(b, TICK_SEC); }
  return b.result || 'timeout';
}
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const t = { solo: [0, 0, 0], multi: [0, 0, 0] };
let k = 0;
hooks.onConquest = (live, world) => {
  if (++k % 2) return;
  const state = structuredClone(live);
  for (const id of attackableFrontier(state, world)) {
    const d = difficulty(state, world, id);
    if (d.surrender) continue;
    const p = playerBattleStats(state, world, id); const e = enemyBattleStats(world, state, id);
    let a; try { a = buildArena(world, state.owner, id, p, e, attackArenaOpts(state, world, id)); } catch { continue; }
    const solo = a.sites.filter((s) => s.owner === 0).length === 1;
    const row = t[solo ? 'solo' : 'multi'];
    row[0] += 1;
    if (args.fight && d.label !== 'Deadly') { row[2] += 1; const r = fight(state, world, id, a, p, e); if (r === 'win') row[1] += 1; if (solo) { const r0 = fight(state, world, id, a, p, e, false); const o0 = outcomes.soloOld; o0[r0] = (o0[r0] || 0) + 1; } const o = outcomes[solo ? 'solo' : 'multi']; o[r] = (o[r] || 0) + 1; if (solo && args.list) console.log(`  solo ${state.dynasty.level} ${world.regions[id].name} t${world.regions[id].tier} ${world.regions[id].twist || '-'}/${world.regions[id].type || '-'} ${e.personality} ${d.label} raw ${d.rawRatio.toFixed(2)} approach ${d.approach} marches ${a.marches.map((m) => (m.approach ? 'A' : '') + m.tiles.length).join(',')} -> ${r}`); }
  }
};
for (const seed of (args.seeds || '1,2,3').split(',').map(Number)) runDynasties(seed, Number(args.d || 3), {});
console.log(JSON.stringify(t), `solo share ${(t.solo[0] / (t.solo[0] + t.multi[0]) * 100).toFixed(1)}%`, args.fight ? `won non-Deadly: solo ${t.solo[1]}/${t.solo[2]}, multi ${t.multi[1]}/${t.multi[2]}` : '', JSON.stringify(outcomes));
