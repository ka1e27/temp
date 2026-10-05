// Phase 9 (PLAN-PHASE9 §9A): the Daily Challenge's spec, deterministic from the date (yyyymmdd, the player's local date, passed in by
// the app: this module never reads a clock). Everyone playing the same date gets the same continent, Edict, Boons, Relic, General and
// goal. Every pick is a seeded hash of (date, purpose); every number is in config/challenges.js DAILY. Pure.
import { hash32 } from '../core/rng.js';
import { generateWorld } from '../world/generate.js';
import { DAILY, CHALLENGE_MODE } from '../config/challenges.js';
import { isDate, daysBetween } from './dates.js';
import { dailyWorldOk } from './challengeSetup.js';

const memo = new Map(); // date -> frozen spec (a spec costs a few world generations; tickChallenge asks for it every frame)
const MEMO_MAX = 8;

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
}

/** The Daily's number in the share text ("Hex Dominion Daily #N"): DAILY.epoch is #1. */
export function dailyNumber(date) {
  return daysBetween(DAILY.epoch, date) + 1;
}

function weighted(list, roll) {
  const total = list.reduce((a, x) => a + x.weight, 0);
  let r = roll * total;
  for (const x of list) { r -= x.weight; if (r < 0) return x; }
  return list[list.length - 1];
}

/** The scripted raids of a goal (holdout: its n raids; wins: a few raids, defenses count as battles). */
function raidScript(goal) {
  if (goal.kind === 'holdout') {
    const h = DAILY.holdout;
    return Array.from({ length: goal.n }, (_, i) => ({ atSec: h.firstSec + i * h.everySec, mult: h.mult }));
  }
  if (goal.kind === 'wins') {
    const w = DAILY.wins;
    return Array.from({ length: w.raids }, (_, i) => ({ atSec: w.firstRaidSec + i * w.everySec, mult: 1 }));
  }
  return [];
}

/**
 * The Daily of `date` (yyyymmdd). Frozen; the same object for the same date (memoised). Throws on a date that is not a real yyyymmdd.
 * @returns {object} spec { kind:'daily', id, date, number, name, seed, world, edict, boons, relic, general, start, setup, mods, goal, raids, stars:null }
 */
export function dailySpec(date) {
  if (!isDate(date)) throw new Error(`dailySpec: not a yyyymmdd date: ${date}`);
  if (memo.has(date)) return memo.get(date);
  const h = (...p) => hash32(date >>> 0, 'daily', ...p);
  const u = (...p) => h(...p) / 4294967296;
  const g = weighted(DAILY.goals, u('goal'));
  const goal = { kind: g.kind };
  if (g.kind === 'capital') goal.target = 'nearestCapital';
  if (g.kind === 'wins') { goal.n = g.n; goal.max = g.max; }
  if (g.kind === 'holdout') goal.n = g.n;
  const e = DAILY.edicts[h('edict') % DAILY.edicts.length];
  const edict = e === 'none' ? null : e;
  const boonN = DAILY.boonCount[h('boonN') % DAILY.boonCount.length];
  const boons = DAILY.boons.map((id) => ({ id, k: h('boon', id) })).sort((a, b) => a.k - b.k || (a.id < b.id ? -1 : 1)).slice(0, boonN).map((x) => x.id);
  const relic = u('relic') < DAILY.relicChance ? DAILY.relics[h('relicId') % DAILY.relics.length] : null;
  const general = { kind: DAILY.generals[h('general') % DAILY.generals.length], level: DAILY.generalLevel, skills: [h('skill', 0) & 1, h('skill', 1) & 1] };
  const opts = { ...CHALLENGE_MODE.world };
  if (edict) opts.edict = edict;
  let seed = 0;
  for (let k = 0; k < CHALLENGE_MODE.seedTries; k++) {
    seed = h('world', k);
    if (dailyWorldOk(generateWorld(seed, opts), goal)) break;
  }
  const setup = { own: g.kind === 'holdout' ? 'nonRival' : 'start' };
  const spec = deepFreeze({
    kind: 'daily', id: `daily:${date}`, date, number: dailyNumber(date), name: `Daily #${dailyNumber(date)}`,
    seed, world: { ...CHALLENGE_MODE.world }, edict, boons, relic, general,
    start: { gold: DAILY.start.gold, upgrades: { ...DAILY.start.upgrades } }, setup, mods: { ...CHALLENGE_MODE.baseMods, ...(g.kind === 'conquer' ? DAILY.conquerMods : {}) },
    goal, raids: raidScript(goal), stars: null,
  });
  if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value);
  memo.set(date, spec);
  return spec;
}
