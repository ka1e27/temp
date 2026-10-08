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
//   --works=KIND:LEVEL  every owned neighbour of the target carries that Work (barracks|stables|shrine|watchtower|all) at that level
//   --supply      the bot also sets up supply lines (rear settlements feed the nearest front settlement)
//   --varypowers  cycle which powers are owned (needed to fit what each power is worth)
//   node tools/balance.mjs [--seeds=1,2,3,4,5,6] [--own=below|chain] [--tier=N]
//                          [--ladder=0,2,4,...] [--dump=rows.json] [--json]
//   --own=half   (default) one region per tier on the way to the target plus a deterministic
//                half of the other lower-tier regions: what a mid-campaign realm looks like
//   --own=below  the player holds every region of a lower tier than the target (fat support)
//   --own=chain  the player holds only one region per tier on the way to the target (the
//                thinnest realistic footprint: least friendly garrison support)
//   --dump       write every raw battle row (features + outcome) for offline fitting
//   node tools/balance.mjs --defense [--seeds=1,..,8] [--mults=0.6,1,1.6] [--forts=none,walls:1+tower:1,...]
//                          [--who=inPerson,captain,stalwart] [--every=2] [--dump=rows.json]
//                (the Living Frontier, DESIGN §10.1: raids on the border regions of real campaign states, the realm's state after
//                 every `every`-th conquest from 4 on, one raid per bordering rival; each raid is fought by each commander, at each
//                 war-band strength multiplier and fortification set; reports the hold rate per commander, by raid depth, and how
//                 estimateDefense's win chance matches it, with a logistic fit per commander for FRONTIER.estimate.fit)
//
// Exported for game/tests/balance.labels.test.js: sweepRows, summarize, LABELS, fitLogistic.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { generateWorld } from '../game/world/generate.js';
import { createGame } from '../game/meta/state.js';
import { playerBattleStats, enemyBattleStats, difficulty } from '../game/meta/progression.js';
import { buildArena } from '../game/battle/arena.js';
import { createBattle, step, issue, canRoute, routeFor } from '../game/battle/sim.js';
import { think } from '../game/battle/ai.js';
import { decide, decideDefense } from '../game/battle/bot.js';
import { stewardDecide } from '../game/battle/steward.js';
import { canBuildDefenseArena } from '../game/battle/defenseArena.js';
import * as Frontier from '../game/meta/frontier.js';
import { runCampaign, hooks as campaignHooks } from './campaign.mjs';
import { ensureGenerals, recruitChampion, addMercenary, commanderStyle } from '../game/meta/generals.js';
import { GENERALS, CHAMPION_OF_FACTION } from '../game/config/generals.js';
import { TICK_SEC, patienceFor } from '../game/config/battle.js';
import { ECONOMY } from '../game/config/meta.js';

export const LABELS = ['Easy', 'Fair', 'Hard', 'Deadly'];
/** Win-rate band each label promises (DESIGN §5.3 as briefed by the lead). */
export const LABEL_BANDS = {
  Easy: [0.85, 1.01], Fair: [0.6, 0.85], Hard: [0.35, 0.6], Deadly: [0, 0.35],
};
// Negative rungs are handicaps (levels below zero: a weaker camp, softer blades) so the soft end of
// the curve - tier 1-2 regions a fresh player beats at 100% - still gets some losses to fit.
export const DEFAULT_LADDER = [-8, -6, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 17, 20, 24, 28, 33, 38, 44, 50, 58, 66, 76];
export const BATTLE_CAP_SEC = 8 * 60; // the old cap; battles now stop at the band's patience (config/battle.js PATIENCE_SEC): a timeout is a loss

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

/**
 * Region Works next to the target (DESIGN §5.8): every owned neighbour of `region` carries `kind` (barracks / stables / shrine /
 * watchtower, or 'all' for the four at once) at `level`. Writes `state.works` directly (slots are a meta rule, not a battle one).
 */
export function withWorks(state, region, kind, level) {
  if (!kind || kind === 'none') return state;
  const single = kind.endsWith('1'); // 'watchtower1': only ONE owned neighbour has it, so the camp volley level is exactly `level`
  const base = single ? kind.slice(0, -1) : kind;
  const types = base === 'all' ? ['barracks', 'stables', 'shrine', 'watchtower'] : [base];
  state.works = {};
  for (const n of region.neighbors) {
    if (state.owner[n] !== 0) continue;
    state.works[n] = types.map((type) => ({ type, level }));
    if (single) break;
  }
  return state;
}

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

/**
 * A General of `spec` ({ kind: 'marshal'|'crimson'|'violet'|'amber'|'mercenary', level, skills: 0|1 (the option picked at every
 * tier the level reaches), passive? }) in the state's roster: the commander of a sweep (Phase 2, DESIGN §10.11).
 */
export function withCommander(state, spec) {
  const roster = ensureGenerals(state).roster;
  let g = null;
  if (spec.kind === 'marshal') g = roster[0];
  else if (spec.kind === 'mercenary') g = addMercenary(state);
  else g = recruitChampion(state, Number(Object.entries(CHAMPION_OF_FACTION).find(([, k]) => k === spec.kind)[0])) || roster.find((x) => x.kind === spec.kind);
  g.level = spec.level || 1;
  g.skills = GENERALS.skillLevels.filter((l) => g.level >= l).map(() => spec.skills ?? 0);
  if (spec.kind === 'mercenary' && spec.passive) g.passive = { ...GENERALS.mercenaryPassives.find((p) => p.stat === spec.passive) };
  return g;
}

/** Plays one full bot-vs-AI battle; returns { result, sec, timedOut }. `human` swaps in decideHuman. */
export function runBattle(arena, player, enemy, capSec = BATTLE_CAP_SEC, human = false, supply = false) {
  const battle = createBattle(arena, player, enemy);
  const memo = { supply };
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
 * nearest enemy settlement the drag will let them reach" (front lines: unreachable targets do not glow; keep last),
 * a second squad from a captured site once they own one,
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
  const reachable = enemies.filter((x) => canRoute(battle, 0, camp.id, x.id));
  if (reachable.length === 0) return [];
  const nonKeep = reachable.filter((x) => x.type !== 'keep');
  const pool = nonKeep.length ? nonKeep : reachable;
  const cost = (a, b) => { const route = routeFor(battle, 0, a.id, b.id); return route ? route.tiles.length : Infinity; };
  const target = pool.slice().sort((a, b) => cost(camp, a) - cost(camp, b) || a.id - b.id)[0];
  const commands = [];
  if (t >= 25 && !memo.rallied && battle.player.powers.rally > 0 && t >= battle.cooldowns.rally) {
    const keep = enemies.find((x) => x.type === 'keep');
    if (keep && battle.sites.some((x) => x.owner === 0 && canRoute(battle, 0, x.id, keep.id))) { commands.push({ type: 'power', owner: 0, power: 'rally', target: keep.id }); memo.rallied = true; return commands; }
  }
  const from = [camp.id];
  const captured = battle.sites.filter((x) => x.owner === 0 && x.id !== camp.id && x.troops >= 8 && canRoute(battle, 0, x.id, target.id));
  if (captured.length && memo.n % 2 === 0) from.push(captured[0].id);
  if (camp.troops >= 4) commands.push({ type: 'send', owner: 0, from, to: target.id, fraction: 0.5 });
  return commands;
}

/** PLAN-PHASE15: the label a raw (uncalibrated) ratio would read: the synthetic ladder judges the fitted estimate itself. */
export function rawLabelOf(ratio) {
  return (ECONOMY.difficultyLabels.find((l) => ratio >= l.min) || ECONOMY.difficultyLabels[ECONOMY.difficultyLabels.length - 1]).label;
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
  powerRatios = [0.6], varyPowers = false, supply = false, works = null, commander = null, feature = null,
} = {}) {
  const rows = [];
  for (const seed of seeds) {
    const world = generateWorld(seed);
    // --feature=<twist|type|plain>: only regions with that twist or type (DESIGN §10.13), or 'plain' for neither
    const hasFeature = (r) => feature == null || (feature === 'plain' ? !r.type && !r.twist : r.type === feature || r.twist === feature);
    const regions = world.regions.filter((r) => r.tier > 0 && (tier == null || r.tier === tier) && hasFeature(r));
    regions.forEach((region, idx) => {
      if (idx % regionStride !== 0) return;
      let past = 0;
      for (const level of ladder) for (const powerRatio of powerRatios) {
        const unlock = varyPowers ? UNLOCK_PATTERNS[(region.id + Math.round(level * 3) + Math.round(powerRatio * 10) + seed) % UNLOCK_PATTERNS.length] : null;
        const state = stateAt(world, seed, region, level, own, powerRatio, unlock);
        if (works) withWorks(state, region, works.kind, works.level);
        const d = difficulty(state, world, region.id);
        const general = commander ? withCommander(state, commander) : null;
        const player = playerBattleStats(state, world, region.id, general ? { commander: general } : {});
        const enemy = enemyBattleStats(world, state, region.id);
        let arena;
        try { arena = buildArena(world, state.owner, region.id, player, enemy); } catch { break; }
        const { result, sec, timedOut } = runBattle(arena, player, enemy, patienceFor(region), false, supply);
        rows.push({
          seed, region: region.id, tier: region.tier, capital: region.isCapital, worksKind: works ? works.kind : 'none',
          band: tierBand(region), personality: enemy.personality, level, powerRatio,
          ratio: d.ratio, label: d.label, power: d.power, strength: d.strength,
          rawRatio: d.rawRatio, rawLabel: rawLabelOf(d.rawRatio), // PLAN-PHASE15: the fitted estimate before the card's calibration
          win: result === 'win', sec, timedOut, approach: arena.marches.filter((m) => m.approach).reduce((n, m) => n + m.tiles.length, 0), // tiles of the approach strip (a mountain border) in this arena, 0 for none
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
    const ring = world.regions.filter((r) => r.tier === 1);
    for (const region of ring) {
      const player = playerBattleStats(state, world, region.id);
      const d = difficulty(state, world, region.id);
      const enemy = enemyBattleStats(world, state, region.id);
      let arena;
      try { arena = buildArena(world, state.owner, region.id, player, enemy); } catch { continue; }
      const bot = runBattle(arena, player, enemy);
      const human = runBattle(arena, player, enemy, BATTLE_CAP_SEC, true); // timed, not capped: the tutorial budget is measured on the clock
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

// --- Defense sweeps (DESIGN §10.1, the Living Frontier) -----------------------------------------------------------------

const DEFENDERS = {
  inPerson: (b, t, m) => decideDefense(b, t, m),
  captain: (b, t, m) => stewardDecide(b, t, m, 'captain'),
  stalwart: (b, t, m) => stewardDecide(b, t, m, 'stalwart'),
  general: (b, t, m, g) => stewardDecide(b, t, m, commanderStyle(g)), // the commander's own steward (Phase 2)
};

function parseForts(spec) {
  if (!spec || spec === 'none') return [];
  return spec.split('+').map((x) => ({ type: x.split(':')[0], level: Number(x.split(':')[1] || 1) }));
}

/**
 * One defense battle played to the end by the war band's AI and `who` (inPerson | captain | stalwart).
 * @returns {{ result: string, sec: number }}
 */
export function playDefense(run, who, general = null) {
  const b = run.battle;
  const memo = {};
  const decide = DEFENDERS[who];
  while (!b.result && b.t < 600) {
    for (const cmd of think(b, b.t)) issue(b, cmd);
    for (const cmd of decide(b, b.t, memo, general)) issue(b, cmd);
    step(b, TICK_SEC);
  }
  return { result: b.result, sec: b.t };
}

/** Raw strength features of a fresh defense battle, for fitting the odds offline (--dump). */
function defenseFeatures(b) {
  const pu = b.player.atk * b.player.def;
  const eu = b.enemy.atk * b.enemy.def;
  const keep = b.sites[b.arena.keepSite];
  const mine = b.sites.filter((x) => x.owner === 0);
  const foe = b.sites.filter((x) => x.owner === b.arena.enemyFaction);
  return {
    keepStr: keep.troops * keep.def * pu, keepGrowth: keep.growth * keep.def * pu,
    milStr: mine.reduce((a, x) => a + x.troops * x.def * pu, 0), milGrowth: mine.reduce((a, x) => a + x.growth * x.def * pu, 0),
    campStr: foe.filter((x) => x.type === 'camp').reduce((a, x) => a + x.troops * eu, 0),
    haloStr: foe.filter((x) => x.type !== 'camp').reduce((a, x) => a + x.troops * eu, 0),
    foeGrowth: foe.reduce((a, x) => a + x.growth * eu, 0), siege: b.siegeSec, sites: mine.length,
    keepDirect: canRoute(b, b.arena.enemyFaction, 0, b.arena.keepSite) ? 1 : 0,
    keepAdjacent: mine.filter((x) => x.id !== keep.id && canRoute(b, b.arena.enemyFaction, 0, x.id)).length,
    towers: mine.filter((x) => x.type === 'tower').reduce((a, x) => a + 1 / (x.volleySec ?? 0.5), 0) * b.player.atk * eu,
    levy: b.player.powers.levy || 0, bulwark: b.player.powers.bulwark || 0, firestorm: b.player.powers.firestorm || 0,
  };
}

/** Raids on real campaign states (see the usage): one row per battle with the card's odds and the outcome. */
export function defenseRows({ seeds = [1, 2, 3, 4, 5, 6, 7, 8], mults = [1], forts = ['none'], who = ['inPerson', 'captain', 'stalwart'], every = 2, commander = null } = {}) {
  const snaps = [];
  const prev = campaignHooks.onConquest;
  for (const seed of seeds) {
    campaignHooks.onConquest = (state, world, row) => { if (row.n >= 4 && row.n % every === 0) snaps.push({ seed, n: row.n, state: structuredClone(state), world }); };
    runCampaign(seed, { maxRegions: 30, raids: 'off' });
  }
  campaignHooks.onConquest = prev;
  const rows = [];
  for (const snap of snaps) {
    for (const { faction, pairs } of Frontier.borderingRivals(snap.state, snap.world)) {
      const pair = pairs.find((p) => canBuildDefenseArena(snap.world, snap.state.owner, p.to, faction));
      if (!pair) continue;
      for (const mult of mults) {
        for (const fortSpec of forts) {
          const state = structuredClone(snap.state);
          state.frontier = undefined;
          state.forts = { [pair.to]: parseForts(fortSpec) };
          const raid = { id: 1, faction, fromRegionId: pair.from, toRegionId: pair.to, depth: Frontier.raidDepth(state, snap.world, pair.to), first: false, mult };
          const general = commander ? withCommander(state, commander) : null;
          const stats = general ? playerBattleStats(state, snap.world, pair.to, { commander: general }) : null;
          for (const w of who) {
            if (w === 'general' && !general) continue;
            const est = Frontier.estimateDefense(state, snap.world, pair.to, raid, w === 'general' ? { nowMs: 0, general } : { nowMs: 0, commander: w, stats });
            const run = Frontier.defenseRunFor(state, snap.world, raid, w === 'captain' ? null : stats, { nowMs: 0 });
            const feat = defenseFeatures(run.battle);
            const { result, sec } = playDefense(run, w, general);
            rows.push({
              seed: snap.seed, n: snap.n, region: pair.to, faction, personality: snap.world.factions[faction].personality,
              depth: raid.depth, mult, forts: fortSpec, who: w, ratio: est.ratio, winChance: est.winChance, win: result === 'win', sec, ...feat,
            });
          }
        }
      }
    }
  }
  return rows;
}

export function printDefense(rows) {
  const pctOf = (rs) => (rs.length ? `${((100 * rs.filter((r) => r.win).length) / rs.length).toFixed(0).padStart(3)}% (${rs.length})` : '   -    ');
  const whos = [...new Set(rows.map((r) => r.who))];
  const mults = [...new Set(rows.map((r) => r.mult))];
  const forts = [...new Set(rows.map((r) => r.forts))];
  console.log(`\n${rows.length} defense battles\n`);
  console.log('hold rate by commander x war-band multiplier x fortifications (all depths)');
  for (const f of forts) for (const m of mults) console.log(`  mult ${String(m).padEnd(4)} forts ${f.padEnd(18)} ` + whos.map((w) => `${w} ${pctOf(rows.filter((r) => r.who === w && r.mult === m && r.forts === f))}`).join('  '));
  console.log('\nhold rate by raid depth (multiplier 1, no fortifications)');
  for (let d = 1; d <= 6; d++) {
    const rs = rows.filter((r) => r.mult === 1 && r.forts === 'none' && Math.min(6, Math.floor(r.depth)) === d);
    console.log(`  depth ${d}${d === 6 ? '+' : ' '} ` + whos.map((w) => `${w} ${pctOf(rs.filter((r) => r.who === w))}`).join('  '));
  }
  console.log('\nlabels: estimateDefense win chance against the hold rate, by predicted band');
  const bins = [0, 0.35, 0.6, 0.85, 1.01];
  for (const w of whos) {
    const line = [];
    for (let i = 0; i < bins.length - 1; i++) {
      const rs = rows.filter((r) => r.who === w && r.winChance >= bins[i] && r.winChance < bins[i + 1]);
      if (!rs.length) continue;
      const pred = rs.reduce((a, r) => a + r.winChance, 0) / rs.length;
      line.push(`[${bins[i]}-${Math.min(1, bins[i + 1])}) pred ${(100 * pred).toFixed(0)}% held ${pctOf(rs)}`);
    }
    console.log(`  ${w.padEnd(9)} ${line.join('  ')}`);
    const fit = fitLogistic(rows.filter((r) => r.who === w));
    if (fit) console.log(`  ${''.padEnd(9)} fit: logit(P) = ${fit.a.toFixed(2)} + ${fit.b.toFixed(2)} ln(ratio)`);
  }
}

async function main() {
  const t0 = Date.now();
  const args = parseArgs(process.argv.slice(2));
  if (args.defense) {
    const list = (v, d) => (v ? String(v).split(',') : d);
    const rows = defenseRows({
      seeds: list(args.seeds, ['1', '2', '3', '4', '5', '6', '7', '8']).map(Number),
      mults: list(args.mults, ['1']).map(Number),
      forts: list(args.forts, ['none']),
      who: list(args.who, ['inPerson', 'captain', 'stalwart']),
      every: Number(args.every || 2),
      commander: args.commander ? { kind: String(args.commander).split(':')[0], level: Number(String(args.commander).split(':')[1] || 1), skills: Number(String(args.commander).split(':')[2] || 0) } : null,
    });
    if (args.dump) fs.writeFileSync(String(args.dump), JSON.stringify(rows));
    printDefense(rows);
    console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    return;
  }
  const seeds = (args.seeds ? String(args.seeds).split(',') : [1, 2, 3, 4, 5, 6]).map(Number);
  const opts = {
    seeds,
    own: ['chain', 'below', 'half'].includes(args.own) ? args.own : 'half',
    tier: args.tier !== undefined ? Number(args.tier) : null,
    ladder: args.ladder ? String(args.ladder).split(',').map(Number) : DEFAULT_LADDER,
    powerRatios: args.powers ? String(args.powers).split(',').map(Number) : [0.6],
    varyPowers: !!args.varypowers,
    supply: args.supply === 'overflow' ? 'overflow' : !!args.supply,
    works: args.works ? { kind: String(args.works).split(':')[0], level: Number(String(args.works).split(':')[1] || 1) } : null,
    commander: args.commander ? { kind: String(args.commander).split(':')[0], level: Number(String(args.commander).split(':')[1] || 1), skills: Number(String(args.commander).split(':')[2] || 0) } : null,
    regionStride: Number(args.stride || 1),
    feature: args.feature ? String(args.feature) : null,
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
