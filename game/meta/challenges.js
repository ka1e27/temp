// Phase 9 (docs/PLAN-PHASE9.md §9A, §9B): the sandboxed challenge game. A challenge is an ordinary GameState on its own small World,
// plus `state.challenge` (below), so every system the realm uses (battles, raids, crowns, Boons, the General) runs unchanged on it.
// It NEVER touches the main realm: it is created fresh from a spec, has its own Generals, Deeds and stats, and is stored by the app
// under CHALLENGE_MODE.saveKey (serializeChallenge / deserializeChallenge here). Pure: no DOM, no Date, no Math.random, no storage.
//
//   state.challenge = { v:1, kind:'daily'|'scenario', id, date|null, practice, activeSec, done: null|{ met, atSec },
//                       resolved: { owned:number[], target:number|null, targets:number[] }, sent, dissolved, log:[Entry], risen, startGold, mods }
//     Entry = { k:'a'|'d', r:'w'|'l', c:0..3 crowns, u:boolean unbroken, t:activeSec, region }
//   The spec is never saved: it is rebuilt from (kind, id/date) by challengeSpecOf (dailySpec / scenarioSpec are deterministic).
import { generateWorld } from '../world/generate.js';
import { hash32 } from '../core/rng.js';
import { createGame, PLAYER_FACTION } from './state.js';
import { migrate } from './save.js';
import { ensureFrontier } from './frontierState.js';
import { borderingRivals, raidDepth, raidEnemyStats, busyFromState } from './frontier.js';
import { GENERALS, CHAMPION_OF_FACTION } from '../config/generals.js';
import { CHALLENGE_MODE } from '../config/challenges.js';
import { dailySpec } from './daily.js';
import { scenarioSpec } from './scenarios.js';
import { resolveSetup, sanitizeChallengeMeta, cleanMods } from './challengeSetup.js';
import { goalMet, goalFailed } from './challengeGoals.js';
import { crownCount } from './crowns.js';

/** The spec of a challenge state (rebuilt, never stored). Null for a state that is not a challenge. */
export function challengeSpecOf(state) {
  const c = state && state.challenge;
  if (!c) return null;
  return c.kind === 'daily' ? dailySpec(c.date) : scenarioSpec(c.id);
}

/** The World of a spec (deterministic): its seed, the small-continent size, its Edict (world-shaping ones) and rival line-up. */
export function challengeWorld(spec) {
  const w = spec.world || {};
  const opts = { cols: w.cols ?? CHALLENGE_MODE.world.cols, rows: w.rows ?? CHALLENGE_MODE.world.rows, regionCount: w.regionCount ?? CHALLENGE_MODE.world.regionCount };
  if (spec.edict) opts.edict = spec.edict;
  if (Array.isArray(w.rivals)) opts.rivals = w.rivals;
  const world = generateWorld(spec.seed >>> 0, opts);
  // a small continent's difficulty ladder (progression.js enemyDepth reads world.ladderSpan): depth 1..1+span instead of the realm's 1..7
  const span = w.ladderSpan ?? CHALLENGE_MODE.world.ladderSpan;
  if (Number.isFinite(span)) world.ladderSpan = span;
  return world;
}

function presetGeneral(state, g) {
  if (!g || !GENERALS.kinds[g.kind]) return;
  const roster = state.generals.roster;
  const marshal = roster.find((x) => x.id === 'marshal');
  let general = marshal;
  if (g.kind !== 'marshal') {
    const fid = Number(Object.keys(CHAMPION_OF_FACTION).find((f) => CHAMPION_OF_FACTION[f] === g.kind));
    if (!Number.isInteger(fid)) return; // only the Marshal or a faction champion can be preset
    const names = GENERALS.names[g.kind] || GENERALS.names.marshal;
    const name = names[hash32(state.seed >>> 0, 'challenge-general', g.kind) % names.length]; // a champion's own name pool (config/generals.js)
    general = { ...marshal, id: `champion:${fid}`, kind: g.kind, style: GENERALS.kinds[g.kind].style, name };
    roster.push(general);
  }
  general.level = Math.max(1, Math.min(GENERALS.maxLevel, g.level | 0 || 1));
  const picks = GENERALS.skillLevels.filter((l) => l <= general.level).length;
  general.skills = Array.from({ length: picks }, (_, i) => ((g.skills && g.skills[i]) ? 1 : 0));
}

/**
 * A fresh challenge game for `spec` (dailySpec / scenarioSpec). Returns `{ state, world }`; the main realm is never read or written.
 * @param {'daily'|'scenario'} kind
 * @param {object} spec
 * @param {{ nowMs?: number, practice?: boolean }} [opts] nowMs: the wall clock (conqueredAt stamps); practice: a past Daily replayed
 */
export function createChallengeGame(kind, spec, opts = {}) {
  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : 0;
  const world = challengeWorld(spec);
  const state = createGame(spec.seed >>> 0, world, nowMs);
  state.edict = { v: 1, id: spec.edict || null, challenges: [], scoutsUsed: 0 };
  if (Array.isArray(world.rivals)) state.rivals = world.rivals.slice();
  const resolved = resolveSetup(spec, world);
  for (const id of resolved.owned) { state.owner[id] = PLAYER_FACTION; state.conqueredAt[id] = nowMs; }
  const start = spec.start || {};
  state.gold = Math.max(0, start.gold || 0);
  state.upgrades = { rally: 1, ...(start.upgrades || {}) };
  state.boons2.owned = (spec.boons || []).slice();
  state.relics.owned = spec.relic ? [spec.relic] : [];
  if (!(spec.setup && spec.setup.relicsOnMap)) state.relics.placed = {}; // only a scenario that is about a Relic region keeps one
  state.relics.seed = world.seed >>> 0; // never re-placed by syncRelics
  presetGeneral(state, spec.general);
  state.tutorial = { seen: {}, done: true }; // no tutorial hints inside a challenge
  state.challenge = {
    v: 1, kind, id: spec.id, date: kind === 'daily' ? spec.date : null, practice: !!opts.practice,
    activeSec: 0, done: null, resolved, sent: 0, dissolved: 0, log: [], risen: 0, startGold: state.gold,
    mods: cleanMods(spec.mods), // folded by edictMods (the sandbox's calm: no random raids; a scenario's no-economy)
  };
  return { state, world };
}

function pickPair(state, world, raidSpec, i) {
  const f = ensureFrontier(state);
  const busy = busyFromState(state, world);
  const targeted = new Set(f.incoming.map((r) => r.toRegionId));
  let rivals = borderingRivals(state, world);
  if (Number.isInteger(raidSpec.faction)) rivals = rivals.filter((r) => r.faction === raidSpec.faction);
  const pairs = [];
  for (const r of rivals) for (const p of r.pairs) if (!targeted.has(p.to) && !busy.regions.has(p.to)) pairs.push({ faction: r.faction, ...p });
  if (!pairs.length) return null;
  pairs.sort((a, b) => a.to - b.to || a.from - b.from || a.faction - b.faction);
  return pairs[hash32(state.seed >>> 0, 'scripted-raid', i) % pairs.length];
}

/** Sends the scripted raids that are due (into state.frontier.incoming, where tickFrontier delivers them). Returns those sent. */
function sendScripted(state, world, spec) {
  const c = state.challenge;
  const script = Array.isArray(spec.raids) ? spec.raids : [];
  const f = ensureFrontier(state);
  const out = [];
  while (c.sent < script.length && script[c.sent].atSec <= c.activeSec + 1e-9) {
    const rs = script[c.sent];
    const pair = pickPair(state, world, rs, c.sent);
    if (!pair) {
      // no rival land touches the realm any more (the player took it): the war band never comes and counts as held off; otherwise
      // every border is targeted or fought over right now, and it marches at a later tick
      if (borderingRivals(state, world).length) break;
      c.sent += 1;
      c.dissolved = (c.dissolved || 0) + 1;
      continue;
    }
    const t = f.activeSec;
    const raid = { id: f.seq++, faction: pair.faction, fromRegionId: pair.from, toRegionId: pair.to, announcedAt: t,
      arriveAt: t + (rs.telegraphSec ?? CHALLENGE_MODE.telegraphSec), strength: 0, depth: raidDepth(state, world, pair.to), first: false,
      mult: Number.isFinite(rs.mult) ? rs.mult : 1, scripted: true };
    raid.strength = Math.round(raidEnemyStats(state, world, raid).campTroops);
    f.incoming.push(raid);
    c.sent += 1;
    out.push(raid);
  }
  return out;
}

/**
 * Advances the challenge by `activeDt` seconds of ACTIVE play (call it beside tickFrontier, with the same dt; skip while paused or
 * hidden). Sends the scripted raids that are due and settles the goal: once met or failed, `state.challenge.done` is set and the timer
 * stops. Returns `{ announced: Raid[], done: null|{ met, atSec } , justDone: boolean }`.
 */
export function tickChallenge(state, world, activeDt) {
  const c = state && state.challenge;
  if (!c) return { announced: [], done: null, justDone: false };
  if (c.done) return { announced: [], done: c.done, justDone: false };
  c.activeSec += Math.max(0, Number.isFinite(activeDt) ? activeDt : 0);
  const spec = challengeSpecOf(state);
  const announced = sendScripted(state, world, spec);
  return { announced, ...settle(state, world, spec) };
}

function settle(state, world, spec) {
  const c = state.challenge;
  const met = goalMet(state, world, spec);
  const failed = !met && (goalFailed(state, world, spec) || c.activeSec >= CHALLENGE_MODE.maxActiveSec);
  if (met || failed) c.done = { met, atSec: Math.round(c.activeSec * 100) / 100 };
  return { done: c.done, justDone: !!c.done };
}

/**
 * Notes a finished battle in the challenge log (call it on the manager's 'ended', AFTER finish(): an attack's crowns are read from
 * state.crowns). Settles the goal at once (a conquest or a loss can end the challenge between ticks). Returns tickChallenge's shape.
 */
export function recordChallengeBattle(state, world, run, result) {
  const c = state && state.challenge;
  if (!c || c.done || !run) return { announced: [], done: c ? c.done : null, justDone: false };
  const b = run.battle;
  const won = result === 'win';
  const unbroken = !!b && b.arena.sites.every((s) => s.owner !== PLAYER_FACTION || b.sites[s.id].owner === PLAYER_FACTION);
  const crowns = won && run.kind === 'attack' && state.crowns ? crownCount(state.crowns[run.regionId]) : 0;
  c.log.push({ k: run.kind === 'attack' ? 'a' : 'd', r: won ? 'w' : 'l', c: crowns, u: unbroken, t: Math.round(c.activeSec), region: run.regionId });
  if (c.log.length > CHALLENGE_MODE.logMax) c.log.splice(0, c.log.length - CHALLENGE_MODE.logMax);
  return { announced: [], ...settle(state, world, challengeSpecOf(state)) };
}

/** Counts the Ashen risen (The Fallen Rise) from a step's battle events: forward every 'events' batch of the manager here. */
export function noteChallengeEvents(state, events) {
  const c = state && state.challenge;
  if (!c || c.done || !Array.isArray(events)) return;
  for (const e of events) if (e && e.type === 'fallenRose' && e.owner !== PLAYER_FACTION && Number.isFinite(e.count)) c.risen += e.count;
}

// --- Save (the app stores the string under CHALLENGE_MODE.saveKey) ---------------------------------------------------------------

export function serializeChallenge(state) {
  return JSON.stringify(state);
}

/** Parses a stored challenge; null (never throws) for junk, for a non-challenge, or for a spec that no longer resolves. */
export function deserializeChallenge(str) {
  let raw;
  try { raw = JSON.parse(str); } catch { return null; }
  if (!raw || typeof raw !== 'object' || !raw.challenge) return null;
  const meta = sanitizeChallengeMeta(raw.challenge);
  if (!meta) return null;
  let spec;
  try { spec = meta.kind === 'daily' ? dailySpec(meta.date) : scenarioSpec(meta.id); } catch { return null; }
  if (!spec) return null;
  const world = challengeWorld(spec);
  if (!Array.isArray(raw.owner) || raw.owner.length !== world.regions.length) return null;
  const state = migrate(raw);
  state.challenge = meta;
  // scripted raids keep their own fields (sanitizeFrontier keeps only the realm's)
  const rawIn = raw.frontier && Array.isArray(raw.frontier.incoming) ? raw.frontier.incoming : [];
  for (const r of state.frontier.incoming) {
    const src = rawIn.find((x) => x && x.id === r.id);
    if (src && src.scripted === true) { r.scripted = true; r.mult = Number.isFinite(src.mult) ? Math.max(0.1, Math.min(10, src.mult)) : 1; }
  }
  return { state, world };
}
