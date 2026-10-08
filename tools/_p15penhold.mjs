// PLAN-PHASE15 follow-up scratch: trace the Penhold fight (seed 11, D3, t4 Gold Mine + Holy Ground). --at=k: the k-th D3 conquest snapshot.
import { runDynasties, hooks } from './campaign.mjs';
import { difficulty, attackableFrontier, playerBattleStats, enemyBattleStats } from '../game/meta/progression.js';
import { attackArenaOpts } from '../game/meta/frontier.js';
import { buildArena } from '../game/battle/arena.js';
import { createBattle, step, issue, canRoute } from '../game/battle/sim.js';
import { think } from '../game/battle/ai.js';
import { decide } from '../game/battle/bot.js';
import { TICK_SEC, patienceFor } from '../game/config/battle.js';
import { computeTerritory } from '../game/battle/territory.js';
import { findPath, buildTileIndex } from '../game/battle/geom.js';
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const want = args.region || 'Penhold';
const at = Number(args.at || 9);
let k = 0; let done = false;
hooks.onConquest = (live, world) => {
  if (process.env.DBG) console.log('hook', live.dynasty.level, attackableFrontier(live, world).map((i) => world.regions[i].name).join(','));
  if (done || live.dynasty.level !== Number(args.d || 3)) return;
  const id = attackableFrontier(live, world).find((i) => world.regions[i].name === want);
  if (id == null) return;
  if (++k < at) return;
  done = !args.all;
  const state = structuredClone(live);
  const d = difficulty(state, world, id);
  const player = playerBattleStats(state, world, id); const enemy = enemyBattleStats(world, state, id);
  console.log('raw', d.rawRatio.toFixed(2), d.label, 'player', JSON.stringify({ atk: player.atk, def: player.def, growth: player.growth, camp: player.campTroops, speed: player.speed }));
  console.log('enemy', JSON.stringify({ atk: enemy.atk, troopMult: enemy.troopMult, capMult: enemy.capMult, growth: enemy.growth, personality: enemy.personality, startCap: enemy.startCapCredit }));
  const arena = buildArena(world, state.owner, id, player, enemy, attackArenaOpts(state, world, id));
  console.log('sites', arena.sites.map((s) => `${s.id}:${s.type}:o${s.owner}:${Math.round(s.troops)}@${s.tile}`).join(' '), 'marches', arena.marches.length, (arena.marches || []).map((m) => `${m.approach ? 'A' : ''}${m.tiles.length}`).join(','));
  { // the strip the village would need from the tower (taken) and from the camp: foreign tiles on the cheapest path, unbounded
    const byKey = buildTileIndex(arena.tiles); const ti = new Map(arena.tiles.map((t) => [t.i, t]));
    const terr = computeTerritory({ arena, sites: arena.sites });
    for (const target of arena.sites.filter((x) => x.owner !== 0 && x.type !== 'keep')) for (const src of [0, 3]) {
      const blocked = (tile) => !tile.link && terr.cell.get(tile.i) !== target.id && terr.owners.get(tile.i) === arena.enemyFaction;
      const path = findPath(byKey, ti.get(arena.sites[src].tile), ti.get(target.tile), null, (t) => (blocked(t) ? 20 : 0));
      console.log('strip', src, '->', target.id, target.type, path ? `${path.filter(blocked).length} foreign of ${path.length}` : 'no path', 'keep cells', path ? path.filter((t) => terr.cell.get(t.i) === 1).length : '-');
    }
  }
  const b = createBattle(arena, player, enemy); const memo = {};
  console.log('routes from camp', b.sites.map((x) => `${x.id}:${canRoute(b, 0, 0, x.id)}`).join(' '), '| from tower', b.sites.map((x) => `${x.id}:${canRoute(b, 0, 3, x.id)}`).join(' ')); const cap = patienceFor(world.regions[id], 3);
  let last = -5;
  const issued = { me: [], ai: [] };
  while (!b.result && b.t < cap) {
    for (const c of think(b, b.t)) { issue(b, c); issued.ai.push(`${b.t.toFixed(0)}:${JSON.stringify(c)}`); }
    if (b.t >= Number(args.wait || 0)) for (const c of decide(b, b.t, memo)) { issue(b, c); issued.me.push(`${b.t.toFixed(0)}:${JSON.stringify(c)}`); }
    step(b, TICK_SEC);
    if (b.t - last >= Number(args.every || 5)) { last = b.t; console.log(`t${b.t.toFixed(0)} ` + b.sites.map((s) => `${s.type}:o${s.owner}:${Math.round(s.troops)}`).join(' ') + ` squads ${b.squads ? b.squads.length : '?'}`); }
  }
  console.log('result', b.result, b.t.toFixed(0), 'raw', d.rawRatio.toFixed(2));
  console.log('my orders', issued.me.slice(0, Number(args.n || 12)).join(' | '));
  console.log('ai orders', issued.ai.slice(0, Number(args.n || 12)).join(' | '));
};
runDynasties(Number(args.seed || 11), Number(args.d || 3), args.policy === 'human' ? { policy: 'human' } : {});
