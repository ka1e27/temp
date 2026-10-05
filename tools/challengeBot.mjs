#!/usr/bin/env node
// Phase 9: a headless player for challenge games (the Daily, Scenarios), against the real systems: the challenge sandbox
// (meta/challenges.js), world generation, the meta progression and the full battle sim, enemy AI and player bot. It proves a challenge
// can be completed and measures how long it takes. Deterministic: no Math.random, no Date; the only clock is the active-play seconds
// this file advances itself (battles at 1x, the speed a careful player watches at; idle stretches in IDLE_SEC chunks).
//
// Policy: buy the cheapest core upgrade whenever affordable; attack the goal's best target that reads Easy or Fair (the goal regions
// first, then the region one step closer to the goal, then the richest), every attack watched in person by the battle bot; raids
// that land while idle are defended in person (decideDefense), raids that land during an attack by the Steward. `concurrent: n`
// starts up to n attacks at once (Many Fronts), the extra ones run by the Steward (stewardDecide), as the game's battle manager does.
//
// Usage: node tools/challengeBot.mjs --daily=20261004 [--days=30]   |   --scenario=gatekeeper|all [--concurrent=3]
import { pathToFileURL } from 'node:url';
import { createChallengeGame, challengeSpecOf, tickChallenge, recordChallengeBattle, noteChallengeEvents } from '../game/meta/challenges.js';
import { challengeResult, goalProgress } from '../game/meta/challengeGoals.js';
import { dailySpec } from '../game/meta/daily.js';
import { scenarioSpec, SCENARIO_IDS } from '../game/meta/scenarios.js';
import { addDays } from '../game/meta/dates.js';
import { tickIncome } from '../game/meta/economy.js';
import { playerBattleStats, enemyBattleStats, frontier, difficulty, conquer } from '../game/meta/progression.js';
import { updateProsperity } from '../game/meta/prosperity.js';
import { trackerOf, trackBattle, evaluateBattle, awardCrowns } from '../game/meta/crowns.js';
import { UPGRADES, levelOf, upgradeCost, canBuy, buy } from '../game/meta/upgrades.js';
import { buildArena } from '../game/battle/arena.js';
import { createBattle, step, issue } from '../game/battle/sim.js';
import { think } from '../game/battle/ai.js';
import { decide, decideDefense } from '../game/battle/bot.js';
import { stewardDecide } from '../game/battle/steward.js';
import { TICK_SEC, patienceFor } from '../game/config/battle.js';
import * as Frontier from '../game/meta/frontier.js';
import { pickBoon } from '../game/meta/boons.js';
import { PLAYER_FACTION } from '../game/meta/state.js';

const POOL = ['recruitment', 'steel', 'armour', 'muster', 'rally', 'firestorm', 'bulwark'];
const IDLE_SEC = 2;          // an idle stretch (nothing readable): the clock moves this much, income and raids run
const BATTLE_CAP_SEC = 480;  // a battle longer than this is abandoned (a retreat): the player gives up on it
const OK_LABELS = new Set(['Easy', 'Fair']);
const RETRY_MARGIN = 1.15; // after a loss, a region is retried only once its card ratio is this much better (tools/campaign.mjs uses 1.25)

function buyPass(state) {
  for (let guard = 0; guard < 200; guard++) {
    let best = null;
    for (const id of POOL) {
      const def = UPGRADES[id];
      const lv = levelOf(state, id);
      if (def.max != null && lv >= def.max) continue;
      const cost = upgradeCost(id, lv) * (id === 'rally' || id === 'firestorm' || id === 'bulwark' ? 2.2 : 1);
      if (!best || cost < best.cost) best = { id, cost };
    }
    if (!best || !canBuy(state, best.id)) return;
    buy(state, best.id);
  }
}

function commander(state) {
  const g = state.generals.roster.find((x) => x.id !== 'marshal') || state.generals.roster[0];
  return g ? g.id : null;
}

/** Steps a set of runs together until all are decided: the first undecided one is watched in person, the rest held by the Steward. */
function fight(state, runs, watched) {
  const memos = runs.map(() => ({}));
  const trackers = runs.map((r) => trackerOf(r.battle));
  for (let guard = 0; guard < BATTLE_CAP_SEC / TICK_SEC + 10; guard++) {
    let live = 0;
    const focus = runs.findIndex((r) => !r.battle.result); // the player watches one battle, then switches to the next undecided one
    runs.forEach((run, i) => {
      const b = run.battle;
      if (b.result) return;
      if (b.t >= run.cap) { issue(b, { type: 'retreat' }); }
      live += 1;
      for (const cmd of think(b, b.t)) issue(b, cmd);
      const mine = i === focus && watched ? (run.kind === 'attack' ? decide(b, b.t, memos[i]) : decideDefense(b, b.t, memos[i]))
        : stewardDecide(b, b.t, memos[i], 'captain');
      for (const cmd of mine) issue(b, cmd);
      step(b, TICK_SEC);
      trackBattle(trackers[i], b);
      noteChallengeEvents(state, b.events);
    });
    if (!live) break;
  }
  return trackers;
}

function settleRun(state, world, run, tracker, nowMs, log) {
  const b = run.battle;
  const result = b.result || 'retreat';
  if (run.kind === 'attack') {
    if (result === 'win') {
      conquer(state, world, run.regionId, nowMs, { viaBattle: true, labelAtAttack: run.labelAtAttack });
      const { crowns } = evaluateBattle(tracker, b, world, run.regionId, state);
      awardCrowns(state, world, run.regionId, crowns, 0);
      state.stats.battlesWon += 1;
      if (state.boons2 && state.boons2.pending) pickBoon(state, state.boons2.pending.choices[0]);
    } else {
      state.stats.battlesLost += 1;
      const lr = state.challenge.lossRatio || (state.challenge.lossRatio = {});
      lr[run.regionId] = difficulty(state, world, run.regionId, run.commander ? { commander: run.commander } : {}).ratio;
    }
  } else {
    const reward = Frontier.defenseReward(state, world, run, result === 'win' ? 'win' : 'lose', nowMs);
    if (result !== 'win') Frontier.occupy(state, world, run.regionId, run.attackerFaction, nowMs);
    if (reward && reward.boonOffer && state.boons2.pending) pickBoon(state, state.boons2.pending.choices[0]);
  }
  log.push({ t: Math.round(state.challenge.activeSec), kind: run.kind, region: run.regionId, result, sec: Math.round(b.t), label: run.labelAtAttack });
  return recordChallengeBattle(state, world, run, result === 'win' ? 'win' : 'lose');
}

/** Advances the active clock: income, prosperity, the frontier clock (scripted raids march and arrive), the challenge timer. */
function advance(state, world, sec, mode, log) {
  const spec = challengeSpecOf(state);
  let left = sec;
  while (left > 1e-9 && !state.challenge.done) {
    const dt = Math.min(1, left);
    if (!(spec.mods && spec.mods.incomeMult === 0)) tickIncome(state, world, dt); // (edictMods folds it too, once hooked)
    const f = state.frontier;
    f.activeSec += dt;
    tickChallenge(state, world, dt);
    updateProsperity(state, world, state.challenge.activeSec * 1000);
    left -= dt;
    const due = f.incoming.filter((r) => r.arriveAt <= f.activeSec + 1e-9).sort((a, b) => a.arriveAt - b.arriveAt || a.id - b.id);
    for (const raid of due) {
      f.incoming = f.incoming.filter((r) => r !== raid);
      if (state.owner[raid.toRegionId] !== PLAYER_FACTION) continue;
      const nowMs = state.challenge.activeSec * 1000;
      let run;
      try { run = Frontier.defenseRunFor(state, world, raid, null, { nowMs }); } catch { continue; }
      run.cap = 600;
      const [tracker] = fight(state, [run], mode === 'idle');
      settleRun(state, world, run, tracker, nowMs, log);
      if (state.challenge.done) return;
      if (mode === 'idle') left += run.battle.t; // a defense fought in person takes the player's time
    }
  }
}

/** Hops from the player's land to `target` (BFS over region neighbours); Infinity when unreachable. */
function hopsTo(world, from, target) {
  const seen = new Set([from]);
  let layer = [from];
  for (let d = 0; layer.length; d++) {
    if (layer.includes(target)) return d;
    const next = [];
    for (const id of layer) for (const n of world.regions[id].neighbors) if (!seen.has(n)) { seen.add(n); next.push(n); }
    layer = next;
  }
  return Infinity;
}

/** The attack candidates this moment, best first: goal regions, then a step toward the goal, then the rest (by ratio). */
function candidates(state, world, spec) {
  const r = state.challenge.resolved;
  const goalIds = new Set(r.targets.length ? r.targets : (r.target != null ? [r.target] : []));
  const cmd = commander(state);
  const out = [];
  for (const id of frontier(state, world)) {
    const d = difficulty(state, world, id, cmd ? { commander: cmd } : {});
    const isGoal = goalIds.has(id);
    // the goal's own region is attacked whatever its card says once nothing else is readable (a scenario has nothing to wait for)
    if (!(OK_LABELS.has(d.label) || (isGoal && state.challenge.stuck > 2))) continue;
    if (world.regions[id].type === 'dragon' && !isGoal) continue; // the Lair only when it is the goal
    const lostAt = state.challenge.lossRatio && state.challenge.lossRatio[id];
    if (lostAt != null && d.ratio < lostAt * RETRY_MARGIN) continue; // it beat us: wait until the card reads clearly better
    const toward = r.target != null ? hopsTo(world, id, r.target) : 0;
    out.push({ id, label: d.label, ratio: d.ratio, score: (isGoal ? 1000 : 0) - toward * 10 + d.ratio });
  }
  return out.sort((a, b) => b.score - a.score || a.id - b.id);
}

function attackRun(state, world, id, label, busy) {
  const cmd = commander(state);
  const player = playerBattleStats(state, world, id, cmd ? { commander: cmd } : {});
  const enemy = enemyBattleStats(world, state, id);
  const arena = buildArena(world, state.owner, id, player, enemy, Frontier.attackArenaOpts(state, world, id, busy));
  const battle = createBattle(arena, player, enemy);
  return { id: 0, kind: 'attack', regionId: id, battle, commander: cmd, labelAtAttack: label, cap: Math.min(BATTLE_CAP_SEC, patienceFor(world.regions[id], 1)) };
}

/**
 * Plays a challenge game to its end. Returns `{ result, log, sec, progress }` (result: challengeResult).
 * @param {{ state, world }} game createChallengeGame's
 * @param {{ concurrent?: number, maxSec?: number }} [opts]
 */
export function playChallenge(game, opts = {}) {
  const { state, world } = game;
  const spec = challengeSpecOf(state);
  const log = [];
  const maxSec = opts.maxSec ?? 3600;
  state.challenge.stuck = 0;
  for (let guard = 0; guard < 5000 && !state.challenge.done && state.challenge.activeSec < maxSec; guard++) {
    buyPass(state);
    // holding out for a time is pure defense: the player does not open new fronts (every attack weakens the line it must hold)
    const cands = spec.goal.kind === 'survive' ? [] : candidates(state, world, spec);
    if (!cands.length) { state.challenge.stuck += 1; advance(state, world, IDLE_SEC, 'idle', log); continue; } // (survive: just the clock and the raids)
    const runs = [];
    for (const c of cands.slice(0, opts.concurrent || 1)) {
      try {
        const busy = Frontier.busyFromState({ battles: runs }, world); // the attacks already started this round
        runs.push(attackRun(state, world, c.id, c.label, busy));
      } catch { /* not buildable (a mountain edge, or busy): skip it */ }
    }
    if (!runs.length) { state.challenge.stuck += 1; advance(state, world, IDLE_SEC, 'idle', log); continue; }
    state.challenge.stuck = 0;
    state.battles = runs;
    const trackers = fight(state, runs, true);
    state.battles = [];
    const longest = Math.max(...runs.map((r) => r.battle.t));
    advance(state, world, longest, 'playing', log);
    runs.forEach((run, i) => { if (!state.challenge.done) settleRun(state, world, run, trackers[i], state.challenge.activeSec * 1000, log); });
  }
  delete state.challenge.stuck;
  delete state.challenge.lossRatio;
  return { result: challengeResult(state, world, spec), log, sec: state.challenge.activeSec, progress: goalProgress(state, world, spec) };
}

function fmt(s) { return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([\w-]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
  const rows = [];
  if (args.daily) {
    const days = Number(args.days || 1);
    for (let i = 0; i < days; i++) {
      const date = addDays(Number(args.daily), i);
      const spec = dailySpec(date);
      const out = playChallenge(createChallengeGame('daily', spec));
      rows.push({ id: date, goal: spec.goal.kind, edict: spec.edict || '-', met: out.result.met, sec: out.sec, crowns: out.result.crowns, w: out.result.wins, l: out.result.losses, line: out.progress.line });
      if (args.verbose) for (const e of out.log) console.log('   ', fmt(e.t), e.kind, e.region, e.result, `${e.sec}s`, e.label || '');
    }
  }
  if (args.scenario) {
    const ids = args.scenario === 'all' ? SCENARIO_IDS : String(args.scenario).split(',');
    for (const id of ids) {
      const spec = scenarioSpec(id);
      const out = playChallenge(createChallengeGame('scenario', spec), { concurrent: Number(args.concurrent || spec.botConcurrent || 1) });
      rows.push({ id, goal: spec.goal.kind, met: out.result.met, stars: out.result.stars, sec: out.sec, crowns: out.result.crowns, gold: out.result.gold, risen: out.result.risen, w: out.result.wins, l: out.result.losses, line: out.progress.line });
      if (args.verbose) for (const e of out.log) console.log('   ', fmt(e.t), e.kind, e.region, e.result, `${e.sec}s`, e.label || '');
    }
  }
  for (const r of rows) console.log(Object.entries(r).map(([k, v]) => `${k}=${k === 'sec' ? fmt(v) : v}`).join('  '));
  if (rows.length > 1) {
    const met = rows.filter((r) => r.met);
    const secs = met.map((r) => r.sec).sort((a, b) => a - b);
    console.log(`met ${met.length}/${rows.length}  median ${secs.length ? fmt(secs[secs.length >> 1]) : '-'}  max ${secs.length ? fmt(secs[secs.length - 1]) : '-'}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
