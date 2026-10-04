#!/usr/bin/env node
// Swarm label calibration (PLAN-PHASE5 §5E): campaign Easy/Fair win rates per rival personality on seeds 1-12 (the numbers the
// balance.labels test judges). Usage: node tools/swarmcheck.mjs [--seeds=1,..,12]
import { runCampaign } from './campaign.mjs';
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const flags = Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'seeds'));
const seeds = (args.seeds || '1,2,3,4,5,6,7,8,9,10,11,12').split(',').map(Number);
const rows = [];
for (const seed of seeds) rows.push(...runCampaign(seed, flags).battleDurations);
for (const p of ['passive', 'defensive', 'aggressive', 'swarm']) {
  const line = ['Easy', 'Fair', 'Hard'].map((l) => {
    const xs = rows.filter((r) => r.personality === p && r.label === l);
    return `${l} ${xs.filter((r) => r.won).length}/${xs.length}`;
  });
  console.log(p.padEnd(10), line.join('  '));
}

// --probe: card honesty independent of the campaign's choices. From every 2nd conquest of each seed, every frontier region of the
// given personality (--personality=swarm) is fought by the bot with the best free General, as the campaign fights; rows are grouped by
// the commander-credited label the card shows.
if (args.probe) {
  const { hooks } = await import('./campaign.mjs');
  const { difficulty, frontier, playerBattleStats, enemyBattleStats } = await import('../game/meta/progression.js');
  const { bestFreeGeneral } = await import('../game/meta/generals.js');
  const { attackArenaOpts } = await import('../game/meta/frontier.js');
  const { buildArena } = await import('../game/battle/arena.js');
  const { createBattle, step, issue } = await import('../game/battle/sim.js');
  const { think } = await import('../game/battle/ai.js');
  const { decide } = await import('../game/battle/bot.js');
  const { TICK_SEC, patienceFor } = await import('../game/config/battle.js');
  const want = args.personality || 'swarm';
  const tally = {};
  let snaps = [];
  hooks.onConquest = (state, world, row) => { if (row.n % 2 === 0) snaps.push({ state: structuredClone(state), world }); };
  for (const seed of seeds) {
    snaps = [];
    runCampaign(seed, flags);
    for (const { state, world } of snaps) {
      for (const id of frontier(state, world)) {
        const region = world.regions[id];
        if (world.factions[region.faction].personality !== want) continue;
        const g = bestFreeGeneral(state, world, id, 'attack', 0);
        const d = difficulty(state, world, id, g ? { commander: g } : {});
        if (d.label === 'Deadly' || d.surrender) continue;
        const player = playerBattleStats(state, world, id, g ? { commander: g } : {});
        const enemy = enemyBattleStats(world, state, id);
        let arena; try { arena = buildArena(world, state.owner, id, player, enemy, attackArenaOpts(state, world, id)); } catch { continue; }
        const b = createBattle(arena, player, enemy); const memo = {}; const cap = patienceFor(region, state.dynasty.level);
        while (!b.result && b.t < cap) { for (const c of think(b, b.t)) issue(b, c); for (const c of decide(b, b.t, memo)) issue(b, c); step(b, TICK_SEC); }
        const t = (tally[d.label] = tally[d.label] || [0, 0]); t[1] += 1; if (b.result === 'win') t[0] += 1;
      }
    }
  }
  console.log(`probe ${want}:`, Object.entries(tally).map(([l, [w, n]]) => `${l} ${w}/${n} (${Math.round(100 * w / n)}%)`).join('  '));
}
