// Phase 9 (PLAN-PHASE9 §9A, §9B): a challenge's goal, its progress, its stars and its score. Reads `state.challenge` (meta/challenges.js)
// and the ordinary game state (owners, crowns, stats). A leaf: it never imports meta/challenges.js. Pure.
import { PLAYER_FACTION } from './state.js';
import { GOAL_TEXT, GOAL_PROGRESS_TEXT, CHALLENGE_MODE } from '../config/challenges.js';
import { crownCount } from './crowns.js';
import { resolveSetup } from './challengeSetup.js';

const c = (state) => state.challenge;
const owns = (state, id) => state.owner[id] === PLAYER_FACTION;
const lost = (log) => log.filter((e) => e.r === 'l');
const defenses = (log) => log.filter((e) => e.k === 'd');
/**
 * Scripted raids held off: every one sent that is no longer marching or being fought and was not lost. That is the defenses won, plus
 * war bands that never came (no rival land touched the realm any more, or their camp region was taken before they arrived).
 */
function held(state) {
  const ch = c(state);
  const marching = (state.frontier && Array.isArray(state.frontier.incoming) ? state.frontier.incoming : []).filter((r) => r.scripted).length;
  const fighting = (Array.isArray(state.battles) ? state.battles : []).filter((r) => r && r.kind === 'defense').length;
  return Math.max(0, ch.sent - marching - fighting - lost(defenses(ch.log)).length);
}

/** Regions the goal counts (conquer: every region but the Lairs). */
function conquerSet(world) {
  return world.regions.filter((r) => r.type !== 'dragon').map((r) => r.id);
}

/** Gold earned inside the challenge (income and bounties; the start gold is not earned). */
export function goldEarned(state) {
  return Math.max(0, Math.round((state.stats && state.stats.goldEarned) || 0));
}

/** Crowns earned inside the challenge (every region's stored crowns). */
export function crownsEarned(state) {
  return (Array.isArray(state.crowns) ? state.crowns : []).reduce((n, x) => n + crownCount(x), 0);
}

/**
 * `{ kind, text, value, total, met, failed, line }` for the HUD tracker. `line` is a short ready string ("4/9 regions", "3:12 / 8:00").
 * @param {object} state a challenge state
 * @param {object} world
 * @param {object} [spec] challengeSpecOf(state) (pass it when you have it)
 */
export function goalProgress(state, world, spec) {
  const g = spec.goal;
  const ch = c(state);
  const r = ch.resolved;
  let value = 0;
  let total = 1;
  let unit = '';
  if (g.kind === 'conquer') { const s = conquerSet(world); value = s.filter((id) => owns(state, id)).length; total = s.length; unit = 'regions'; }
  else if (g.kind === 'capital' || g.kind === 'region') { value = r.target != null && owns(state, r.target) ? 1 : 0; unit = 'taken'; }
  else if (g.kind === 'regions') { value = r.targets.filter((id) => owns(state, id)).length; total = r.targets.length; unit = 'taken'; }
  else if (g.kind === 'wins') { value = ch.log.filter((e) => e.r === 'w').length; total = g.n; unit = `wins, ${lost(ch.log).length}/${g.max} lost`; }
  else if (g.kind === 'holdout') { value = Math.min(g.n, held(state)); total = g.n; unit = 'raids held'; }
  else if (g.kind === 'survive' || g.kind === 'gold') { value = Math.min(g.sec, Math.floor(ch.activeSec)); total = g.sec; }
  const met = goalMet(state, world, spec);
  const failed = !met && goalFailed(state, world, spec);
  const line = g.kind === 'survive' || g.kind === 'gold'
    ? `${clock(value)} / ${clock(total)}${g.kind === 'gold' ? ` · ${goldEarned(state)} gold` : ''}`
    : GOAL_PROGRESS_TEXT[g.kind] ? GOAL_PROGRESS_TEXT[g.kind][value >= total ? 'done' : 'open']
    : `${value}/${total} ${unit}`;
  return { kind: g.kind, text: goalText(spec, world, state), value, total, met, failed, line };
}

/** True once the goal is reached. */
export function goalMet(state, world, spec) {
  const g = spec.goal;
  const ch = c(state);
  const r = ch.resolved;
  if (g.kind === 'conquer') return conquerSet(world).every((id) => owns(state, id));
  if (g.kind === 'capital' || g.kind === 'region') return r.target != null && owns(state, r.target);
  if (g.kind === 'regions') return r.targets.length > 0 && r.targets.every((id) => owns(state, id));
  if (g.kind === 'wins') return ch.log.filter((e) => e.r === 'w').length >= g.n && lost(ch.log).length <= g.max;
  if (g.kind === 'holdout') return held(state) >= g.n && !defenses(ch.log).some((e) => e.r === 'l');
  if (g.kind === 'survive') return ch.activeSec >= g.sec && !defenses(ch.log).some((e) => e.r === 'l');
  if (g.kind === 'gold') return ch.activeSec >= g.sec;
  return false;
}

/** True once the goal can no longer be reached (a loss too many, a region lost while holding out). */
export function goalFailed(state, world, spec) {
  const g = spec.goal;
  const ch = c(state);
  if (g.kind === 'wins') return lost(ch.log).length > g.max;
  if (g.kind === 'holdout' || g.kind === 'survive') return defenses(ch.log).some((e) => e.r === 'l');
  if ((g.kind === 'capital' || g.kind === 'region' || g.kind === 'conquer') && !state.owner.some((o) => o === PLAYER_FACTION)) return true;
  return false;
}

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** The goal line, built from GOAL_TEXT (config) and the world's names. Without a state (the hub's card) the targets are resolved from the spec. */
export function goalText(spec, world, state = null) {
  const g = spec.goal;
  const t = GOAL_TEXT[g.kind] || '';
  const r = state && state.challenge ? state.challenge.resolved : resolveSetup(spec, world);
  const target = r && r.target != null ? world.regions[r.target] : null;
  const names = r ? r.targets.map((id) => world.regions[id].name) : [];
  return t.replace('{n}', String(g.n ?? g.count ?? 0)).replace('{max}', String(g.max ?? 0))
    .replace('{min}', String(Math.round((g.sec || 0) / 60))).replace('{region}', target ? target.name : 'the goal')
    .replace('{faction}', target ? world.factions[target.faction].name : 'the enemy').replace('{list}', names.join(', '));
}

/** Does one star condition hold? (conditions: met, time, risen, unbroken, gold, crowns, losses, crown) */
function starHolds(cond, state, world) {
  const ch = c(state);
  const sec = ch.done ? ch.done.atSec : ch.activeSec;
  if (cond.kind === 'met') return true;
  if (cond.kind === 'time') return sec <= cond.sec + 1e-9;
  if (cond.kind === 'risen') return ch.risen < cond.max;
  if (cond.kind === 'unbroken') return defenses(ch.log).every((e) => e.u) && (cond.min == null || defenses(ch.log).length >= cond.min);
  if (cond.kind === 'unbrokenShare') { const d = defenses(ch.log); return d.length > 0 && d.filter((e) => e.u).length / d.length >= cond.share - 1e-9; }
  if (cond.kind === 'gold') return goldEarned(state) >= cond.n;
  if (cond.kind === 'crowns') return crownsEarned(state) >= cond.n;
  if (cond.kind === 'losses') return lost(ch.log).length <= cond.max;
  if (cond.kind === 'crown') { const id = ch.resolved.target; const cr = id != null && state.crowns ? state.crowns[id] : null; return !!(cr && cr[cond.crown]); }
  return false;
}

/** Stars earned (0..spec.stars.length): star i needs the goal met and its condition; a Daily has no stars (0). */
export function starsFor(state, world, spec) {
  if (!Array.isArray(spec.stars) || !c(state).done || !c(state).done.met) return 0;
  return spec.stars.filter((cond) => starHolds(cond, state, world)).length;
}

/**
 * The score of a challenge state: `{ met, sec, crowns, gold, stars, risen }`. A Daily ranks by sec (lower is better), crowns the
 * tiebreak; a scenario by stars, then its own measure (gold for a gold goal, else sec). Compare two with compareScores.
 */
export function scoreFor(state, world, spec) {
  const ch = c(state);
  const met = !!(ch.done && ch.done.met);
  const sec = Math.round((ch.done ? ch.done.atSec : ch.activeSec) * 10) / 10;
  return { met, sec, crowns: crownsEarned(state), gold: goldEarned(state), stars: starsFor(state, world, spec), risen: ch.risen, goal: spec.goal.kind };
}

/** < 0 when score `a` is better than `b` (met first; scenarios: stars, then gold or time; dailies: time, then crowns). */
export function compareScores(a, b) {
  if (!a) return b ? 1 : 0;
  if (!b) return -1;
  if (a.met !== b.met) return a.met ? -1 : 1;
  if ((a.stars || 0) !== (b.stars || 0)) return (b.stars || 0) - (a.stars || 0);
  if (a.goal === 'gold' && a.gold !== b.gold) return b.gold - a.gold;
  if (a.sec !== b.sec) return a.sec - b.sec;
  return (b.crowns || 0) - (a.crowns || 0);
}

/** The result of a finished (or abandoned) challenge, for the result screen and the record (challengesState.js). */
export function challengeResult(state, world, spec) {
  const ch = c(state);
  const score = scoreFor(state, world, spec);
  return {
    kind: ch.kind, id: ch.id, date: ch.date, practice: ch.practice, ...score,
    battles: ch.log.slice(-CHALLENGE_MODE.shareMax).map((e) => ({ kind: e.k === 'a' ? 'attack' : 'defense', won: e.r === 'w', crowns: e.c, unbroken: e.u })),
    wins: ch.log.filter((e) => e.r === 'w').length, losses: lost(ch.log).length,
  };
}
