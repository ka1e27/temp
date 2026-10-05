// Phase 9: resolving a challenge spec's setup rules against its World (which regions the player starts with, which region is the
// goal), checking that a daily world is fit to play, and sanitising `state.challenge`. A leaf of meta/challenges.js. Pure.
import { CHALLENGE_MODE } from '../config/challenges.js';
import { EDICT_NEUTRAL } from '../config/edicts.js';
import { enemyDepth } from './progression.js';

/** A challenge's edictMods overrides: only known EDICT_NEUTRAL keys, of the neutral value's type, numbers within 0..10. */
export function cleanMods(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!(k in EDICT_NEUTRAL)) continue;
    if (typeof EDICT_NEUTRAL[k] === 'boolean' && typeof v === 'boolean') out[k] = v;
    else if (typeof EDICT_NEUTRAL[k] === 'number' && Number.isFinite(v)) out[k] = Math.max(0, Math.min(10, v));
  }
  return out;
}

const FREE_FOLK = 1;
const ASHEN = 5;

const rivalOf = (world, r) => r.faction > FREE_FOLK;
const lairs = (world) => world.regions.filter((r) => r.type === 'dragon').map((r) => r.id);

/** The easiest rival capital (lowest ladder depth, then tier, then id); null when none. */
function nearestCapital(world, faction = null) {
  const caps = world.regions.filter((r) => r.isCapital && rivalOf(world, r) && (faction == null || r.faction === faction));
  caps.sort((a, b) => enemyDepth(world, a) - enemyDepth(world, b) || a.tier - b.tier || a.id - b.id);
  return caps.length ? caps[0].id : null;
}

/** Rival regions bordering `owned`, easiest first (tier, then id), capitals and Lairs last. */
function frontierOf(world, owned) {
  const set = new Set(owned);
  const out = new Set();
  for (const id of owned) for (const n of world.regions[id].neighbors) if (!set.has(n) && rivalOf(world, world.regions[n])) out.add(n);
  return [...out].map((id) => world.regions[id])
    .sort((a, b) => (a.isCapital || a.type === 'dragon') - (b.isCapital || b.type === 'dragon') || a.tier - b.tier || a.id - b.id)
    .map((r) => r.id);
}

function resolveTarget(rule, world) {
  if (rule == null) return null;
  if (Number.isInteger(rule)) return world.regions[rule] ? rule : null;
  if (rule === 'nearestCapital') return nearestCapital(world);
  if (rule === 'ashenCapital') return nearestCapital(world, ASHEN);
  if (rule === 'dragon') return lairs(world)[0] ?? null;
  return null;
}

/** The non-rival regions that border rival land, those touching the most distinct rival factions first. */
function borderRegions(world) {
  return world.regions.filter((r) => !rivalOf(world, r) && r.type !== 'dragon')
    .map((r) => ({ id: r.id, f: new Set(r.neighbors.map((n) => world.regions[n]).filter((x) => rivalOf(world, x)).map((x) => x.faction)) }))
    .filter((x) => x.f.size > 0)
    .sort((a, b) => b.f.size - a.f.size || a.id - b.id);
}

/**
 * `{ owned, target, targets }` for a spec on its world. `spec.setup.own`: 'start' (default) | 'nonRival' (the start and all Free Folk
 * land) | 'allBut' (every region but the goal and the Lairs) | 'border' (spec.setup.count non-rival regions on rival borders, the
 * start's ring first). `spec.goal.target`: a rule (nearestCapital, ashenCapital, dragon) or a region id; `spec.goal.kind` 'regions'
 * takes `count` rival regions on the starting frontier.
 */
export function resolveSetup(spec, world) {
  const setup = spec.setup || {};
  const goal = spec.goal || {};
  const target = resolveTarget(goal.target, world);
  const lairIds = lairs(world);
  let owned = [world.startRegion];
  if (setup.own === 'nonRival') owned = world.regions.filter((r) => !rivalOf(world, r) && r.type !== 'dragon').map((r) => r.id);
  else if (setup.own === 'allBut') owned = world.regions.filter((r) => r.id !== target && !lairIds.includes(r.id)).map((r) => r.id);
  else if (setup.own === 'border') owned = borderRegions(world).slice(0, setup.count || 3).map((x) => x.id);
  owned = owned.filter((id) => id !== target).sort((a, b) => a - b);
  let targets = target != null ? [target] : [];
  if (goal.kind === 'regions') targets = frontierOf(world, owned).slice(0, goal.count || 3).sort((a, b) => a - b);
  return { owned, target, targets };
}

/** Rival factions bordering a set of owned regions (for the Hold the Line check). */
export function rivalsBordering(world, owned) {
  const s = new Set();
  for (const id of owned) for (const n of world.regions[id].neighbors) if (!owned.includes(n) && rivalOf(world, world.regions[n])) s.add(world.regions[n].faction);
  return [...s].sort((a, b) => a - b);
}

/** Is this small world fit for a Daily with this goal? (size, rivals, the goal's target present). */
export function dailyWorldOk(world, goal) {
  const n = world.regions.length;
  if (n < CHALLENGE_MODE.minRegions || n > CHALLENGE_MODE.maxRegions) return false;
  const rivals = world.regions.filter((r) => rivalOf(world, r));
  if (rivals.length < CHALLENGE_MODE.minRivalRegions) return false;
  if (!world.regions.some((r) => r.isCapital && rivalOf(world, r))) return false;
  if (world.regions[world.startRegion].neighbors.length < 2) return false;
  if (goal && goal.target && resolveTarget(goal.target, world) == null) return false;
  // a conquer day must not be a wall of gated capitals (all-capital rival land made 40+ minute days): enough ordinary rival regions
  if (goal && goal.kind === 'conquer' && rivals.filter((r) => !r.isCapital).length < CHALLENGE_MODE.conquerMinPlainRivals) return false;
  return true;
}

const int = (v) => Number.isInteger(v);
const idList = (a, max = 64) => (Array.isArray(a) ? a.filter((x) => int(x) && x >= 0 && x < 1000).slice(0, max) : []);

/** `state.challenge` made valid; null when it cannot be (unknown kind, no id/date). Never throws. */
export function sanitizeChallengeMeta(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return null;
  if (raw.kind !== 'daily' && raw.kind !== 'scenario') return null;
  if (raw.kind === 'daily' && !int(raw.date)) return null;
  if (typeof raw.id !== 'string' || raw.id.length > 40) return null;
  const num = (v, max) => (Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : 0);
  const r = raw.resolved && typeof raw.resolved === 'object' ? raw.resolved : {};
  const done = raw.done && typeof raw.done === 'object' ? { met: raw.done.met === true, atSec: num(raw.done.atSec, 1e7) } : null;
  const log = (Array.isArray(raw.log) ? raw.log : []).filter((e) => e && typeof e === 'object').slice(-CHALLENGE_MODE.logMax)
    .map((e) => ({ k: e.k === 'd' ? 'd' : 'a', r: e.r === 'w' ? 'w' : 'l', c: Math.floor(num(e.c, 3)), u: e.u === true, t: num(e.t, 1e7), region: int(e.region) ? e.region : -1 }));
  return {
    v: 1, kind: raw.kind, id: raw.id, date: raw.kind === 'daily' ? raw.date : null, practice: raw.practice === true,
    activeSec: num(raw.activeSec, 1e7), done,
    resolved: { owned: idList(r.owned), target: int(r.target) ? r.target : null, targets: idList(r.targets, 8) },
    sent: Math.floor(num(raw.sent, 99)), dissolved: Math.floor(num(raw.dissolved, 99)), log, mods: cleanMods(raw.mods), risen: Math.floor(num(raw.risen, 1e6)), startGold: num(raw.startGold, 1e12),
  };
}

