#!/usr/bin/env node
// PLAN-PHASE15 §15A: is the difficulty card honest? Real battles from real campaign states, bot and human policy, every dynasty, the
// Crown, Ascension 0/5/10, every rival personality, twist, region type, capitals, the Gate and the Throne. For each label band: the win
// rate the card promised (its mean winChance) against the win rate the bot achieved, per slice, with sample sizes.
//
// Two kinds of rows:
//   probe:  at every `probeEvery`-th conquest of a campaign, EVERY attackable frontier region (no surrender offered) is fought once by the
//           bot from a copy of that state, commanded as the campaign commands (the best free General). The card's promise for any
//           region a player might see, whatever the policy would have picked. The calibration set.
//   chosen: the battles the policy really fought (tools/campaign.mjs battleDurations): what a player of that kind experiences.
//
//   node tools/labelAudit.mjs --seeds=1-12 [--jobs=12] [--probeEvery=2] [--out=rows.json]   plays dyn (D1-D6, D7, the Crown) and asc (D3-D4
//        at A0/A5/A10 forked after D2) for both policies, in parallel worker processes, then prints the report
//   node tools/labelAudit.mjs --report rows.json [more.json] [--src=probe|chosen|all] [--min=30]
//   node tools/labelAudit.mjs --worker --seed=S --plan=dyn|asc --policy=bot|human --out=f.json        (one job; used by the parent)
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runDynasties, foundNext, hooks } from './campaign.mjs';
import { difficulty, attackableFrontier, playerBattleStats, enemyBattleStats } from '../game/meta/progression.js';
import { freeGenerals, bestFreeGeneral } from '../game/meta/generals.js';
import { attackArenaOpts } from '../game/meta/frontier.js';
import { buildArena } from '../game/battle/arena.js';
import { createBattle, step, issue } from '../game/battle/sim.js';
import { think } from '../game/battle/ai.js';
import { decide } from '../game/battle/bot.js';
import { TICK_SEC, patienceFor } from '../game/config/battle.js';
import { PLAYER_FACTION } from '../game/meta/state.js';
import { DIFFICULTY } from '../game/config/meta.js';

export const BANDS = Object.freeze([ // [label, promised lo, promised hi]
  ['Easy', DIFFICULTY.winAtLabelEdge.Easy, 1],
  ['Fair', DIFFICULTY.winAtLabelEdge.Fair, DIFFICULTY.winAtLabelEdge.Easy],
  ['Hard', DIFFICULTY.winAtLabelEdge.Hard, DIFFICULTY.winAtLabelEdge.Fair],
  ['Deadly', 0, DIFFICULTY.winAtLabelEdge.Hard],
]);
export const BAND_SLACK = 0.05; // the plan's tolerance at a band's edges
export const CHANCE_SLACK = 0.12; // and on the card's winChance

const HUMAN_AHEAD_PATIENCE = 2; // tools/campaign.mjs HUMAN.aheadPatience: a person fights on while holding most of the sites

/** The commander the campaign sends (campaign.mjs pickCommander): the best free General, else the first free one, else none. */
function commanderFor(state, world, regionId, nowMs) {
  const free = freeGenerals(state, nowMs);
  if (!free.length) return null;
  return bestFreeGeneral(state, world, regionId, 'attack', nowMs) || free[0];
}

/** One bot battle for `regionId` from `state` (not mutated), exactly as campaign.mjs attemptConquest fights it. True when won. */
export function probeFight(state, world, regionId, general, human) {
  const opts = general ? { commander: general } : {};
  const player = playerBattleStats(state, world, regionId, opts);
  const enemy = enemyBattleStats(world, state, regionId);
  const arena = buildArena(world, state.owner, regionId, player, enemy, attackArenaOpts(state, world, regionId));
  const battle = createBattle(arena, player, enemy);
  const memo = {};
  if (state.boons2 && state.boons2.owned.includes('supplyWagons')) memo.supply = 'overflow';
  const patience = patienceFor(world.regions[regionId], state.dynasty.level);
  const longest = human ? patience * HUMAN_AHEAD_PATIENCE : patience;
  const ahead = () => { let mine = 0; for (const x of battle.sites) if (x.owner === PLAYER_FACTION) mine += 1; return mine * 2 > battle.sites.length; };
  while (!battle.result && (battle.t < patience || (battle.t < longest && ahead()))) {
    for (const c of think(battle, battle.t)) issue(battle, c);
    for (const c of decide(battle, battle.t, memo)) issue(battle, c);
    step(battle, TICK_SEC);
  }
  return battle.result === 'win';
}

/** The slice fields of a region in a state (shared by probe and chosen rows). */
function sliceOf(state, world, region, personality) {
  return {
    d: state.dynasty.level, crown: !!state.crownOfAges, asc: state.ascension || 0, arch: !!world.archipelago,
    personality, twist: region.twist || null, type: region.type || null, capital: !!region.isCapital, throne: !!region.throne,
    tier: region.tier,
  };
}

/** Probe rows from one state: every attackable frontier region without a surrender, fought once. */
export function probeState(liveState, world, nowMs, human, meta = {}) {
  const state = structuredClone(liveState);
  const rows = [];
  for (const id of attackableFrontier(state, world)) {
    const g = commanderFor(state, world, id, nowMs);
    const d = difficulty(state, world, id, g ? { commander: g } : {});
    if (d.surrender) continue;
    let won;
    try { won = probeFight(state, world, id, g, human); } catch { continue; } // a border the arena cannot build (campaign.mjs does the same)
    const enemy = enemyBattleStats(world, state, id);
    rows.push({ src: 'probe', ...meta, ...sliceOf(state, world, world.regions[id], enemy.personality), label: d.label, ratio: d.ratio, rawRatio: d.rawRatio, promised: d.winChance, won });
  }
  return rows;
}

/** The chosen-fight rows of a dynasty run (campaign.mjs battleDurations). */
function chosenRows(r, meta) {
  return (r.battleDurations || []).filter((b) => b.promised != null).map((b) => ({
    src: 'chosen', ...meta, d: b.dynasty, crown: !!b.crown, asc: b.ascension || 0, arch: !!b.archipelago, personality: b.personality,
    twist: b.twist, type: b.type, capital: !!b.capital, throne: !!b.throne, tier: b.tier, label: b.label, ratio: b.ratio, rawRatio: b.rawRatio ?? b.ratio, promised: b.promised,
    won: !!b.won && !b.timedOut,
  }));
}

/**
 * One audit job: `plan` 'dyn' plays D1..`maxD` (6) then D7 and the Crown forked from the same D6 realm (tools/_p14pace.mjs); 'asc' plays
 * D1-D2, then D3..`ascTo` (4) at each Ascension level in `levels` (forced, crowned or not). `policy` 'bot' or 'human'. Probes every
 * `probeEvery`-th conquest (0: none). Returns the rows.
 */
export function auditJob({ seed, plan = 'dyn', policy = 'bot', probeEvery = 2, maxD = 6, levels = [0, 5, 10], ascTo = 4, flags = {} }) {
  const human = policy === 'human';
  const f = { ...flags, ...(human ? { policy: 'human' } : {}) };
  const rows = [];
  let tag = '';
  let k = 0;
  hooks.onConquest = probeEvery > 0 ? (state, world, row) => {
    k += 1;
    if (k % probeEvery) return;
    rows.push(...probeState(state, world, (row.wallSec || 0) * 1000, human, { seed, policy, tag }));
  } : null;
  const take = (rs, t) => { for (const r of rs) rows.push(...chosenRows(r, { seed, policy, tag: t })); };
  try {
    if (plan === 'dyn') {
      tag = 'base';
      const base = runDynasties(seed, maxD, f);
      take(base, 'base');
      const last = base[maxD - 1];
      if (last && !last.stallReason && maxD === 6) {
        for (const [t, ff] of [['D7', f], ['Crown', { ...f, crown: 7 }]]) {
          tag = t;
          const carry = foundNext(last, seed, 6, ff, structuredClone(last.endState));
          take(runDynasties(seed, 7, ff, { carry, level: 7 }), t);
        }
      }
    } else {
      hooks.onConquest = null; // D1-D2 are the dyn plan's
      const base = runDynasties(seed, 2, f);
      for (const L of levels) {
        tag = `A${L}`;
        k = 0;
        hooks.onConquest = probeEvery > 0 ? (state, world, row) => {
          k += 1;
          if (k % probeEvery) return;
          rows.push(...probeState(state, world, (row.wallSec || 0) * 1000, human, { seed, policy, tag: `A${L}` }));
        } : null;
        const ff = { ...f, ascensionForce: L };
        const carry = foundNext(base[1], seed, 2, ff, structuredClone(base[1].endState));
        take(runDynasties(seed, ascTo, ff, { carry, level: 3 }), `A${L}`);
      }
    }
  } finally { hooks.onConquest = null; }
  return rows;
}

// --- the report ------------------------------------------------------------------------------------------------------------------

const DYN_TAGS = new Set(['base', 'D7']); // dynasty slices read the plain dyn plan only (the Crown and the Ascension forks have their own)
/** The slices: [name, predicate]. */
export const INFO_SLICES = new Set(['bot', 'human']);
export function slices(rows) {
  // bot and human are the two populations the card serves (the bot retreats at its patience, the human fights on while ahead): shown, not
  // judged (INFO); the plan's slices are judged
  const out = [['all', () => true], ['bot', (r) => r.policy === 'bot'], ['human', (r) => r.policy === 'human']];
  for (let d = 1; d <= 7; d++) out.push([`D${d}`, (r) => DYN_TAGS.has(r.tag) && !r.crown && r.d === d]);
  out.push(['Crown', (r) => r.crown]);
  for (const a of [0, 5, 10]) out.push([`A${a}`, (r) => r.tag === `A${a}`]);
  for (const p of ['passive', 'aggressive', 'defensive', 'swarm', 'undying', 'raider', 'usurper']) out.push([p, (r) => r.personality === p]);
  const seen = (k) => [...new Set(rows.map((r) => r[k]).filter(Boolean))].sort();
  for (const t of seen('twist')) out.push([`twist:${t}`, (r) => r.twist === t]);
  out.push(['twist:none', (r) => !r.twist]);
  for (const t of seen('type')) out.push([`type:${t}`, (r) => r.type === t]);
  out.push(['capital', (r) => r.capital && !r.throne], ['Gate', (r) => r.twist === 'siege'], ['Throne', (r) => r.throne]);
  out.push(['archipelago', (r) => r.arch]);
  for (const t of [1, 2, 3, 4, 5]) out.push([`tier${t}${t === 5 ? '+' : ''}`, (r) => (t === 5 ? r.tier >= 5 : r.tier === t)]);
  return out;
}

/** Per slice and band: { slice, label, n, achieved, promised, judged, ok, why }. A cell is judged when it has at least `min` fights. */
export function auditTable(rows, { min = 30 } = {}) {
  const cells = [];
  for (const [slice, pred] of slices(rows)) {
    const mine = rows.filter(pred);
    for (const [label, lo, hi] of BANDS) {
      const xs = mine.filter((r) => r.label === label);
      const n = xs.length;
      const achieved = n ? xs.filter((r) => r.won).length / n : null;
      const promised = n ? xs.reduce((s, r) => s + r.promised, 0) / n : null;
      const judged = n >= min && !INFO_SLICES.has(slice);
      let why = '';
      if (judged && (achieved < lo - BAND_SLACK || achieved > hi + BAND_SLACK)) why += `band ${Math.round(lo * 100)}-${Math.round(hi * 100)}`;
      if (judged && Math.abs(achieved - promised) > CHANCE_SLACK) why += `${why ? ', ' : ''}chance off ${Math.round(100 * (achieved - promised))}`;
      cells.push({ slice, label, n, achieved, promised, judged, ok: !why, why });
    }
  }
  return cells;
}

export function printTable(rows, { min = 30, title = '' } = {}) {
  const cells = auditTable(rows, { min });
  const pct = (x) => (x == null ? '   -' : `${Math.round(100 * x)}`.padStart(4));
  console.log(`\n=== label audit ${title} (${rows.length} fights; cells with n >= ${min} judged: band +-${BAND_SLACK * 100}, chance +-${CHANCE_SLACK * 100}) ===`);
  console.log(`${'slice'.padEnd(16)} ${BANDS.map(([l]) => `${l.padEnd(6)}  n  won said`).join(' | ')}`);
  const names = [...new Set(cells.map((c) => c.slice))];
  let bad = 0;
  for (const s of names) {
    const cs = cells.filter((c) => c.slice === s);
    if (!cs.some((c) => c.n)) continue;
    const txt = cs.map((c) => `${(c.judged ? (c.ok ? 'ok' : 'XX') : INFO_SLICES.has(s) && c.n ? 'info' : '').padEnd(6)}${String(c.n).padStart(4)} ${pct(c.achieved)} ${pct(c.promised)}`).join(' | ');
    console.log(`${s.padEnd(16)} ${txt}`);
    bad += cs.filter((c) => c.judged && !c.ok).length;
  }
  const fails = cells.filter((c) => c.judged && !c.ok);
  console.log(`judged ${cells.filter((c) => c.judged).length} cells, ${bad} off target${fails.length ? ': ' + fails.map((c) => `${c.slice}/${c.label} ${Math.round(100 * c.achieved)}% vs ${Math.round(100 * c.promised)}% (n ${c.n}; ${c.why})`).join('; ') : ''}`);
  return cells;
}

// --- CLI ---------------------------------------------------------------------------------------------------------------------------

const range = (s) => String(s).split(',').flatMap((p) => (p.includes('-') ? (([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i))(p.split('-').map(Number)) : [Number(p)]));

/**
 * Runs audit jobs ({ seed, policy, plan, maxD?, probeEvery? }) in parallel worker processes (at most `jobs` at once) and resolves with every
 * row. `log` gets one line per finished job. Used by the CLI and by the fast audit test (game/tests/_labelAuditFast.js).
 */
export function runJobs(list, { jobs = 12, probeEvery = 2, log = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'labelaudit-'));
  const self = fileURLToPath(import.meta.url);
  const all = [];
  let next = 0;
  const t0 = Date.now();
  const runOne = () => {
    if (next >= list.length) return Promise.resolve();
    const j = list[next++];
    const out = join(dir, `${j.plan}-${j.policy}-${j.seed}-${next}.json`);
    const argv = [self, '--worker', `--seed=${j.seed}`, `--plan=${j.plan}`, `--policy=${j.policy}`, `--probeEvery=${j.probeEvery ?? probeEvery}`, `--out=${out}`];
    if (j.maxD) argv.push(`--maxD=${j.maxD}`);
    return new Promise((res) => {
      const p = spawn(process.execPath, argv, { stdio: ['ignore', 'ignore', 'inherit'] });
      p.on('exit', (code) => {
        try {
          const rows = JSON.parse(readFileSync(out, 'utf8'));
          all.push(...rows);
          if (log) log(`${j.plan} ${j.policy} seed ${j.seed}: ${rows.length} rows (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
        } catch { if (log) log(`${j.plan} ${j.policy} seed ${j.seed}: FAILED (exit ${code})`); }
        res();
      });
    }).then(runOne);
  };
  return Promise.all(Array.from({ length: Math.min(jobs, list.length) }, runOne)).then(() => all);
}

async function main() {
  const argv = process.argv.slice(2);
  const args = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
  const min = Number(args.min || 30);
  const pick = (rows) => (args.src === 'all' ? rows : rows.filter((r) => r.src === (args.src || 'probe')));
  if (args.worker) {
    const rows = auditJob({ seed: Number(args.seed), plan: args.plan, policy: args.policy, probeEvery: Number(args.probeEvery ?? 2), maxD: Number(args.maxD || 6) });
    writeFileSync(args.out, JSON.stringify(rows));
    return;
  }
  if (args.report) {
    const rows = argv.filter((a) => !a.startsWith('--')).flatMap((f) => JSON.parse(readFileSync(f, 'utf8')));
    printTable(pick(rows), { min, title: `(${args.src || 'probe'})` });
    return;
  }
  const seeds = range(args.seeds || '1-4');
  const list = [];
  for (const seed of seeds) for (const policy of ['bot', 'human']) for (const plan of String(args.plans || 'dyn,asc').split(',')) list.push({ seed, policy, plan });
  const all = await runJobs(list, { jobs: Number(args.jobs || 12), probeEvery: Number(args.probeEvery ?? 2), log: (l) => console.log(l) });
  if (args.out) writeFileSync(args.out, JSON.stringify(all));
  printTable(pick(all), { min, title: `(${args.src || 'probe'})` });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
