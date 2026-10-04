#!/usr/bin/env node
// Quick Conquest calibration (PLAN-PHASE5 §5D pacing guard): from real campaign states (every 3rd conquest of each seed's
// dynasties), every region that canQuickConquer allows is resolved by the Steward with the best free General (and, separately,
// with no General). Prints the win rate (the guard wants >= 95%).
// Usage: node tools/quickcheck.mjs [--seeds=1,..,12] [--dynasties=2] [--every=3]
import { runDynasties, hooks } from './campaign.mjs';
import { canQuickConquer, createQuickConquest, stepQuickConquest } from '../game/meta/quick.js';
import { frontier } from '../game/meta/progression.js';
import { bestFreeGeneral } from '../game/meta/generals.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const seeds = (args.seeds || '1,2,3,4,5,6,7,8,9,10,11,12').split(',').map(Number);
const every = Number(args.every || 3);
const driver = args.driver || undefined; const capSec = args.cap ? Number(args.cap) : undefined;
const tally = { general: { n: 0, won: 0 }, none: { n: 0, won: 0 } };
const losses = [];
let snaps = [];
hooks.onConquest = (state, world, row) => { if (row.n % every === 0) snaps.push({ state: structuredClone(state), world }); };
for (const seed of seeds) {
  snaps = [];
  runDynasties(seed, Number(args.dynasties || 2), {});
  for (const { state, world } of snaps) {
    state.generals.legacy = { v: 1, points: 5, spent: 5, nodes: { oldRoads: true, masons: true, royalTreasury: true, quickConquest: true }, pendingBonus: 0 };
    for (const id of frontier(state, world)) {
      if (!canQuickConquer(state, world, id).ok) continue;
      const g = bestFreeGeneral(state, world, id, 'attack', 0);
      for (const [key, cmd] of [['general', g ? g.id : null], ['none', null]]) {
        let job;
        try { job = createQuickConquest(state, world, id, { commander: cmd, driver, capSec }); } catch { continue; }
        while (!stepQuickConquest(job, 2000).done);
        tally[key].n += 1;
        if (job.battle.result === 'win') tally[key].won += 1;
        else losses.push({ seed, d: state.dynasty.level, region: id, key, result: job.battle.result, t: Math.round(job.battle.t), twist: world.regions[id].twist, type: world.regions[id].type });
      }
    }
  }
}
for (const [k, v] of Object.entries(tally)) console.log(`${k}: won ${v.won}/${v.n} (${(100 * v.won / Math.max(1, v.n)).toFixed(1)}%)`);
console.log('losses:', JSON.stringify(losses.slice(0, 30)));
