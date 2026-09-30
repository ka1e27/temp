#!/usr/bin/env node
// Difficulty-label calibration harness. Sweeps the player's strength across every region of
// several generated worlds (so across tiers, factions/personalities, site mixes) and plays the
// REAL bot (bot.js) against the REAL enemy AI (ai.js) to the end, then reports how the meta
// heuristic's `difficulty().ratio` / label predicts the bot's win rate (DESIGN §5.3).
//
// It goes through the same code path the game uses: a GameState with upgrade levels ->
// playerBattleStats / enemyBattleStats -> difficulty() (the label the card shows) ->
// buildArena -> createBattle -> think()/decide()/step(). Nothing here re-implements game math.
//
// Usage:
//   node tools/balance.mjs --tutorial [--seeds=1,2,...]   (first ring at game start: ratios, and
//                          how long the optimiser bot and a first-timer take to win it)
//   --varypowers  cycle which powers are owned (needed to fit what each power is worth)
//   node tools/balance.mjs [--seeds=1,2,3,4,5,6] [--own=below|chain] [--tier=N]
//                          [--ladder=0,2,4,...] [--dump=rows.json] [--json]
//   --own=half   (default) one region per tier on the way to the target plus a deterministic
//                half of the other lower-tier regions: what a mid-campaign realm looks like
//   --own=below  the player holds every region of a lower tier than the target (fat support)
//   --own=chain  the player holds only one region per tier on the way to the target (the
//                thinnest realistic footprint: least friendly garrison support)
//   --dump       write every raw battle row (features + outcome) for offline fitting
//
// Exported for game/tests/balance.labels.test.js: sweepRows, summarize, LABELS, fitLogistic.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { generateWorld } from '../game/world/generate.js';
import { createGame } from '../game/meta/state.js';
import { playerBattleStats, enemyBattleStats, difficulty } from '../game/meta/progression.js';
import { buildArena } from '../game/battle/arena.js';
import { createBattle, step, issue } from '../game/battle/sim.js';
import { think } from '../game/battle/ai.js';
import { decide } from '../game/battle/bot.js';
import { pathBetweenSites } from '../game/battle/runtime.js';
import { TICK_SEC } from '../game/config/battle.js';

export const LABELS = ['Easy', 'Fair', 'Hard', 'Deadly'];
/** Win-rate band each label promises (DESIGN §5.3 as briefed by the lead). */
export const LABEL_BANDS = {
  Easy: [0.85, 1.01], Fair: [0.6, 0.85], Hard: [0.35, 0.6], Deadly: [0, 0.35],
};
// Negative rungs are handicaps (levels below zero: a weaker camp, softer blades) so the soft end of
// the curve - tier 1-2 regions a fresh player beats at 100% - still gets some losses to fit.
export const DEFAULT_LADDER = [-8, -6, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 17, 20, 24, 28, 33, 38, 44, 50, 58, 66, 76];
export const BATTLE_CAP_SEC = 8 * 60; // same cap as the campaign: a timeout is a loss

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const kv = a.match(/^--([\w-]+)=(.*)$/);
    if (kv) { out[kv[1]] = kv[2]; continue; }
    const flag = a.match(/^--([\w-]+)$/);
    if (flag) out[flag[1]] = true;
  }
  return out;
}

/** Owner array for "the player holds the ground behind the target". */
function ownersFor(world, region, own) {
  const owners = world.regions.map((r) => r.faction);
  if (own === 'chain' || own === 'half') {
    let cur = region;
    while (cur.tier > 0) {
      const parent = cur.neighbors.map((n) => world.regions[n]).filter((n) => n.tier === cur.tier - 1)
        .sort((a, b) => a.id - b.id)[0];
      if (!parent) break;
      owners[parent.id] = 0;
      cur = parent;
    }
    if (own === 'half') {
      for (const r of world.regions) {
        const h = Math.imul(r.id + 1, 2654435761) ^ Math.imul(region.id + 7, 40503);
        if (r.tier < region.tier && ((h >>> 0) % 100) < 50) owners[r.id] = 0;
      }
    }
    return owners;
  }
  return world.regions.map((r) => (r.tier < region.tier ? 0 : r.faction));
}

/**
 * A GameState whose upgrade levels mimic the campaign's buying policy at "level" L: the four
 * core army lines level, powers unlocked as the target gets deeper (the virtual player
 * unlocks Firestorm at its 3rd conquest and Levy/Bulwark/March at its 6th) and levelled to
 * roughly `powerRatio` x L (0.6 by default, measured from campaign runs: powers sit a little
 * behind the core four; the sweep also varies it so the label can price power levels).
 */
/** Which of Firestorm/Bulwark/March/Levy are owned, cycled across the sweep: the campaign's price
 * ladder unlocks them one at a time in arbitrary order, so the label must price each one. */
export const UNLOCK_PATTERNS = [[0, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0, 1], [1, 1, 0, 0], [1, 1, 1, 0], [1, 1, 1, 1], [0, 0, 0, 1], [0, 1, 0, 0]];

export function stateAt(world, seed, region, level, own = 'half', powerRatio = 0.6, unlock = null) {
  const state = createGame(seed, world, 0);
  state.stats.battlesWon = 5; // a seasoned player (surrender offers are unlocked)
  state.owner = ownersFor(world, region, own);
  const powerLvl = Math.max(1, Math.round(powerRatio * level));
  state.upgrades = {
    rally: powerLvl,
    recruitment: level, steel: level, armour: level, muster: level,
    firestorm: unlock ? (unlock[0] ? powerLvl : 0) : (region.tier >= 2 ? powerLvl : 0),
    bulwark: unlock ? (unlock[1] ? powerLvl : 0) : (region.tier >= 3 ? powerLvl : 0),
    march: unlock ? (unlock[2] ? powerLvl : 0) : (region.tier >= 3 ? powerLvl : 0),
    levy: unlock ? (unlock[3] ? powerLvl : 0) : (region.tier >= 3 ? powerLvl : 0),
  };
  return state;
}

/** Plays one full bot-vs-AI battle; returns { result, sec, timedOut }. `human` swaps in decideHuman. */
export function runBattle(arena, player, enemy, capSec = BATTLE_CAP_SEC, human = false) {
  const battle = createBattle(arena, player, enemy);
  const memo = {};
  while (!battle.result && battle.t < capSec) {
    for (const cmd of think(battle, battle.t)) issue(battle, cmd);
    for (const cmd of (human ? decideHuman : decide)(battle, battle.t, memo)) issue(battle, cmd);
    step(battle, TICK_SEC);
  }
  const timedOut = !battle.result;
  return { result: battle.result, sec: timedOut ? capSec : battle.stats.durationSec, timedOut, battle };
}

/**
 * A first-timer, not the optimiser: one order every 3.5-5 s, always "drag from the War Camp at the
 * nearest enemy settlement" (keep last), a second squad from a captured site once they own one,
 * Rally once after ~25 s when the hint tells them. Used to time the tutorial fight honestly.
 */
export function decideHuman(battle, t, memo = {}) {
  if (t < (memo.next ?? 3)) return [];
  memo.n = (memo.n ?? 0) + 1;
  memo.next = t + 3.5 + (memo.n % 3) * 0.75;
  const camp = battle.sites.find((x) => x.type === 'camp' && x.owner === 0) || battle.sites.find((x) => x.owner === 0);
  if (!camp) return [];
  const enemies = battle.sites.filter((x) => x.owner !== 0);
  if (enemies.length === 0) return [];
  const nonKeep = enemies.filter((x) => x.type !== 'keep');
  const pool = nonKeep.length ? nonKeep : enemies;
  const cost = (a, b) => { const path = pathBetweenSites(battle, a.id, b.id); return path ? path.length : Infinity; };
  const target = pool.slice().sort((a, b) => cost(camp, a) - cost(camp, b) || a.id - b.id)[0];
  const commands = [];
  if (t >= 25 && !memo.rallied && battle.player.powers.rally > 0 && t >= battle.cooldowns.rally) {
    const keep = enemies.find((x) => x.type === 'keep');
    if (keep) { commands.push({ type: 'power', owner: 0, power: 'rally', target: keep.id }); memo.rallied = true; return commands; }
  }
  const from = [camp.id];
  const captured = battle.sites.filter((x) => x.owner === 0 && x.id !== camp.id && x.troops >= 8);
  if (captured.length && memo.n % 2 === 0) from.push(captured[0].id);
  if (camp.troops >= 4) commands.push({ type: 'send', owner: 0, from, to: target.id, fraction: 0.5 });
  return commands;
}

export function tierBand(region) {
  if (region.isCapital) return 'capital';
  return region.tier <= 2 ? 'tier1-2' : 'mid';
}

/**
 * The raw sweep. For every non-start region of every seed, climbs the level ladder (stopping
 * once the heuristic says the region is far past surrender territory) and plays each rung.
 * @returns {object[]} one row per battle
 */
export function sweepRows({
  seeds = [1, 2, 3, 4, 5, 6], own = 'half', tier = null, ladder = DEFAULT_LADDER, maxRatio = 6, regionStride = 1,
  powerRatios = [0.6], varyPowers = false,
} = {}) {
  const rows = [];
  for (const seed of seeds) {
    const world = generateWorld(seed);
    const regions = world.regions.filter((r) => r.tier > 0 && (tier == null || r.tier === tier));
    regions.forEach((region, idx) => {
      if (idx % regionStride !== 0) return;
      let past = 0;
      for (const level of ladder) for (const powerRatio of powerRatios) {
        const unlock = varyPowers ? UNLOCK_PATTERNS[(region.id + Math.round(level * 3) + Math.round(powerRatio * 10) + seed) % UNLOCK_PATTERNS.length] : null;
        const state = stateAt(world, seed, region, level, own, powerRatio, unlock);
        const d = difficulty(state, world, region.id);
        const player = playerBattleStats(state, world);
        const enemy = enemyBattleStats(world, state, region.id);
        let arena;
        try { arena = buildArena(world, state.owner, region.id, player, enemy); } catch { break; }
        const { result, sec, timedOut } = runBattle(arena, player, enemy);
        rows.push({
          seed, region: region.id, tier: region.tier, capital: region.isCapital,
          band: tierBand(region), personality: enemy.personality, level, powerRatio,
          ratio: d.ratio, label: d.label, power: d.power, strength: d.strength,
          win: result === 'win', sec, timedOut,
          enemySites: arena.sites.filter((s) => s.owner !== 0).map((s) => [s.type, s.troops, s.owner, s.capMult ?? 1]),
          friendSites: arena.sites.filter((s) => s.owner === 0).map((s) => [s.type, s.troops]),
          enemy: { troopMult: enemy.troopMult, growth: enemy.growth, thinkSec: enemy.thinkSec, atk: enemy.atk, def: enemy.def },
          player: {
            atk: player.atk, def: player.def, growth: player.growth, camp: player.campTroops,
            powers: Object.values(player.powers).filter((v) => v > 0).length,
            powerLvls: Object.values(player.powers).filter((v) => v > 0),
            pw: { ...player.powers },
          },
        });
        if (d.ratio > maxRatio && ++past >= 2 * powerRatios.length) break;
      }
    });
  }
  return rows;
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * One-feature logistic regression P(win) = sigmoid(a + b*ln(ratio)), Newton iterations with a
 * touch of ridge so a perfectly separable sample still converges. Returns null for < 8 rows.
 */
export function fitLogistic(rows) {
  const pts = rows.filter((r) => Number.isFinite(r.ratio) && r.ratio > 0).map((r) => [Math.log(r.ratio), r.win ? 1 : 0]);
  if (pts.length < 8) return null;
  let a = 0;
  let b = 1;
  for (let it = 0; it < 60; it++) {
    let g0 = 0; let g1 = 0; let h00 = 1e-3; let h01 = 0; let h11 = 1e-3;
    for (const [x, y] of pts) {
      const p = 1 / (1 + Math.exp(-(a + b * x)));
      const w = p * (1 - p) + 1e-9;
      g0 += y - p; g1 += (y - p) * x;
      h00 += w; h01 += w * x; h11 += w * x * x;
    }
    const det = h00 * h11 - h01 * h01;
    if (Math.abs(det) < 1e-12) break;
    a += (h11 * g0 - h01 * g1) / det;
    b += (-h01 * g0 + h00 * g1) / det;
  }
  const ratioAt = (p) => Math.exp((Math.log(p / (1 - p)) - a) / b);
  return { a, b, ratioAt };
}

const BINS = [0, 0.5, 0.7, 0.85, 1.0, 1.1, 1.3, 1.5, 2, 3, Infinity];

function cell(rows) {
  const n = rows.length;
  const wins = rows.filter((r) => r.win).length;
  const durs = rows.filter((r) => r.win && !r.timedOut).map((r) => r.sec);
  return { n, win: n ? wins / n : null, medSec: median(durs) };
}

/** Aggregates rows into the tables the report needs. */
export function summarize(rows) {
  const byBin = BINS.slice(0, -1).map((lo, i) => {
    const hi = BINS[i + 1];
    return { lo, hi, ...cell(rows.filter((r) => r.ratio >= lo && r.ratio < hi)) };
  });
  const byLabel = LABELS.map((label) => ({ label, ...cell(rows.filter((r) => r.label === label)) }));
  const groups = {};
  for (const r of rows) {
    for (const key of [`${r.label}|band:${r.band}`, `${r.label}|${r.personality}`, `${r.label}|tier:${r.tier}`]) {
      (groups[key] = groups[key] || []).push(r);
    }
  }
  const byGroup = Object.entries(groups).map(([key, rs]) => ({ key, ...cell(rs) }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const fit = fitLogistic(rows);
  return { total: rows.length, byBin, byLabel, byGroup, fit };
}

const pct = (x) => (x == null ? '   n/a' : `${(x * 100).toFixed(0).padStart(4)}%`);
const secs = (x) => (x == null ? '   n/a' : `${x.toFixed(0).padStart(4)}s`);

export function printSummary(s) {
  console.log(`\n${s.total} battles\n`);
  console.log('ratio bin          n   winRate  medWinSec');
  for (const b of s.byBin) {
    const hi = b.hi === Infinity ? '  inf' : b.hi.toFixed(2);
    console.log(`  [${b.lo.toFixed(2)}, ${hi})  ${String(b.n).padStart(5)}  ${pct(b.win)}   ${secs(b.medSec)}`);
  }
  console.log('\nlabel     n   winRate (promise)   medWinSec');
  for (const l of s.byLabel) {
    const [lo, hi] = LABEL_BANDS[l.label];
    const ok = l.win == null ? '' : (l.win >= lo - 0.02 && l.win <= hi + 0.02 ? 'ok' : 'OFF');
    console.log(`  ${l.label.padEnd(7)} ${String(l.n).padStart(5)}  ${pct(l.win)}   (${(lo * 100).toFixed(0)}-${Math.min(100, hi * 100).toFixed(0)}%)  ${ok.padEnd(3)}  ${secs(l.medSec)}`);
  }
  console.log('\nlabel x group                       n   winRate  medWinSec');
  for (const g of s.byGroup) {
    if (g.n < 3) continue;
    console.log(`  ${g.key.padEnd(30)} ${String(g.n).padStart(5)}  ${pct(g.win)}   ${secs(g.medSec)}`);
  }
  if (s.fit) {
    const f = s.fit;
    console.log(`\nlogistic fit: logit(P) = ${f.a.toFixed(2)} + ${f.b.toFixed(2)} ln(ratio); `
      + `ratio for 85% = ${f.ratioAt(0.85).toFixed(2)}, 60% = ${f.ratioAt(0.6).toFixed(2)}, 35% = ${f.ratioAt(0.35).toFixed(2)}`);
  }
}

/** The first ring at game start, fought by the optimiser bot and by the first-timer. */
export function tutorialRows(seeds) {
  const rows = [];
  for (const seed of seeds) {
    const world = generateWorld(seed);
    const state = createGame(seed, world, 0);
    const player = playerBattleStats(state, world);
    const ring = world.regions.filter((r) => r.tier === 1);
    for (const region of ring) {
      const d = difficulty(state, world, region.id);
      const enemy = enemyBattleStats(world, state, region.id);
      let arena;
      try { arena = buildArena(world, state.owner, region.id, player, enemy); } catch { continue; }
      const bot = runBattle(arena, player, enemy);
      const human = runBattle(arena, player, enemy, BATTLE_CAP_SEC, true);
      rows.push({
        seed, region: region.name, sites: region.settlements.length, ratio: d.ratio, label: d.label,
        botWin: bot.result === 'win', botSec: bot.sec, humanWin: human.result === 'win', humanSec: human.sec,
      });
    }
  }
  return rows;
}

function printTutorial(rows) {
  const med = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
  console.log('seed  region                sites  ratio  label   bot(s)  first-timer(s)');
  for (const r of rows) {
    console.log(`${String(r.seed).padStart(4)}  ${r.region.padEnd(20)} ${String(r.sites).padStart(5)}  ${r.ratio.toFixed(2).padStart(5)}  ${r.label.padEnd(6)} ${(r.botWin ? '' : 'L ') + r.botSec.toFixed(0).padStart(5)}  ${(r.humanWin ? '' : 'L ') + r.humanSec.toFixed(0).padStart(5)}`);
  }
  const easiest = [];
  for (const seed of new Set(rows.map((r) => r.seed))) easiest.push(rows.filter((r) => r.seed === seed).sort((a, b) => b.ratio - a.ratio)[0]);
  console.log(`
first ring: ${rows.length} regions; ratio range ${Math.min(...rows.map((r) => r.ratio)).toFixed(2)}..${Math.max(...rows.map((r) => r.ratio)).toFixed(2)}`);
  console.log(`easiest region per seed (the tutorial pick): ratio ${Math.min(...easiest.map((r) => r.ratio)).toFixed(2)}..${Math.max(...easiest.map((r) => r.ratio)).toFixed(2)}; labels ${[...new Set(easiest.map((r) => r.label))].join('/')}`);
  console.log(`first-timer: win ${(100 * rows.filter((r) => r.humanWin).length / rows.length).toFixed(0)}%, median ${med(rows.filter((r) => r.humanWin).map((r) => r.humanSec))}s; tutorial pick median ${med(easiest.filter((r) => r.humanWin).map((r) => r.humanSec))}s`);
  console.log(`optimiser bot: win ${(100 * rows.filter((r) => r.botWin).length / rows.length).toFixed(0)}%, median ${med(rows.filter((r) => r.botWin).map((r) => r.botSec))}s`);
}

async function main() {
  const t0 = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const seeds = (args.seeds ? String(args.seeds).split(',') : [1, 2, 3, 4, 5, 6]).map(Number);
  const opts = {
    seeds,
    own: ['chain', 'below', 'half'].includes(args.own) ? args.own : 'half',
    tier: args.tier !== undefined ? Number(args.tier) : null,
    ladder: args.ladder ? String(args.ladder).split(',').map(Number) : DEFAULT_LADDER,
    powerRatios: args.powers ? String(args.powers).split(',').map(Number) : [0.6],
    varyPowers: !!args.varypowers,
  };
  if (args.tutorial) {
    printTutorial(tutorialRows(seeds));
    return;
  }
  const rows = sweepRows(opts);
  if (args.dump) fs.writeFileSync(String(args.dump), JSON.stringify(rows));
  const s = summarize(rows);
  if (args.json) console.log(JSON.stringify(s, null, 2));
  else printSummary(s);
  console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)}s, own=${opts.own}, seeds ${seeds.join(',')})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
