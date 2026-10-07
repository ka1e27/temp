// Grudges and Trophies (PLAN-PHASE4 §4D): every rival leader's Grudge against the player, and the Trophies won from beaten
// Vendettas. A LEAF (config and state.js only), so progression.js (conquer), intel.js (sabotage), events.js (Duels) and frontier.js
// (raids, the Vendetta) can raise and settle Grudges without an import cycle. The Vendetta itself is a frontier raid: frontier.js
// swears and schedules it (tickFrontier), defenseRunFor builds it, defenseReward settles it. Pure: no DOM, no Date.now, no Math.random.
//
//   state.grudges = { v:1, at, news: News[], [faction]: { value, warnedAt, vendettaAt, orphanSince } }     PER DYNASTY
//     value 0..GRUDGES.max (a float; show Math.floor); warnedAt: active seconds of the 50-warning (null until it is due again);
//     vendettaAt: active seconds when a Vendetta was sworn and its war band set out (null when none is pending); at: the decay clock.
//     News = { kind: 'warn', faction, value }   the `grudge` voice trigger (drainGrudgeNews)
//   state.trophies = { v:1, [faction]: n }      PER DYNASTY; each Trophy is +GRUDGES.vendetta.trophyAtk attack against that faction
import { GRUDGES } from '../config/grudges.js';
import { boonMods } from './boonsState.js'; // the leaf (PLAN-PHASE7): Oathkeeper
import { edictMods } from './edicts.js'; // the leaf (PLAN-PHASE13): Long Memories (Ascension 6)
import { PLAYER_FACTION } from './state.js';

const FREE_FOLK = 1;

export function defaultGrudges() {
  return { v: 1, at: 0, news: [] };
}

export function defaultTrophies() {
  return { v: 1 };
}

function nowSec(state) {
  const f = state.frontier;
  return f && Number.isFinite(f.activeSec) ? f.activeSec : 0;
}

export function ensureGrudges(state) {
  if (!state.grudges || typeof state.grudges !== 'object' || state.grudges.v !== 1) state.grudges = defaultGrudges();
  const g = state.grudges;
  if (!Array.isArray(g.news)) g.news = [];
  if (!Number.isFinite(g.at)) g.at = nowSec(state);
  return g;
}

/** The Grudge record of a rival faction (created at 0). */
export function grudgeOf(state, faction) {
  const g = ensureGrudges(state);
  const key = String(faction);
  if (!g[key] || typeof g[key] !== 'object') g[key] = { value: 0, warnedAt: null, vendettaAt: null, orphanSince: null };
  return g[key];
}

function isRival(faction) {
  return Number.isInteger(faction) && faction > FREE_FOLK;
}

/** True once the player holds the faction's capital: its leader is broken and swears no Vendetta (PLAN §4D). */
export function isBroken(state, world, faction) {
  const fac = world && world.factions && world.factions[faction];
  return !!fac && fac.capitalRegion != null && fac.capitalRegion >= 0 && state.owner[fac.capitalRegion] === PLAYER_FACTION;
}

/**
 * Raises a rival leader's Grudge. MUTATES. A sworn Vendetta holds it at the maximum (no change). Free Folk keep no Grudge.
 * @param {'region'|'capital'|'raidBeaten'|'sabotage'|'duelDeclined'|'duelWon'|number} reason a GRUDGES.gains key, or an amount
 * @returns {{ value:number, crossed:'warn'|'vendetta'|null }|null} null for a faction without a leader's Grudge.
 *   'warn' (the value just passed GRUDGES.warnAt: also queued for drainGrudgeNews); 'vendetta' (it reached the maximum:
 *   the frontier scheduler swears the Vendetta at its next check).
 */
export function addGrudge(state, faction, reason, now) {
  void now; // the Grudge clock is the frontier's active seconds
  if (!isRival(faction)) return null;
  const gain = typeof reason === 'number' ? reason : GRUDGES.gains[reason];
  if (!Number.isFinite(gain) || gain <= 0) return null;
  const e = grudgeOf(state, faction);
  if (e.vendettaAt != null) return { value: e.value, crossed: null };
  const before = e.value;
  e.value = Math.min(GRUDGES.max, e.value + gain);
  // Long Memories (PLAN-PHASE13 Ascension 6): a Vendetta is sworn at GRUDGES.max x vendettaGrudgeMult; reaching it fills the Grudge
  if (e.value >= GRUDGES.max * edictMods(state).vendettaGrudgeMult - 1e-9) e.value = GRUDGES.max;
  let crossed = null;
  if (e.warnedAt == null && e.value >= GRUDGES.warnAt) {
    e.warnedAt = nowSec(state);
    crossed = 'warn';
    const g = ensureGrudges(state);
    g.news.push({ kind: 'warn', faction, value: Math.floor(e.value) });
    if (g.news.length > GRUDGES.newsMax) g.news.splice(0, g.news.length - GRUDGES.newsMax);
  }
  if (e.value >= GRUDGES.max && before < GRUDGES.max) crossed = 'vendetta';
  return { value: e.value, crossed };
}

/** Is a Vendetta of `faction` still marching (state.frontier.incoming) or being fought (state.battles)? */
function vendettaLive(state, faction) {
  const inc = state.frontier && Array.isArray(state.frontier.incoming) ? state.frontier.incoming : [];
  if (inc.some((r) => r && r.vendetta && r.vendetta.faction === faction)) return true;
  const runs = Array.isArray(state.battles) ? state.battles : [];
  return runs.some((r) => r && r.vendetta && r.vendetta.faction === faction && !(r.battle && r.battle.result));
}

/**
 * Cools every Grudge by the active time since the last call (GRUDGES.decayPerSec; never while away, because only active time
 * moves the clock), and calls off a sworn Vendetta whose war band has vanished (its target fell to someone else) after
 * GRUDGES.calledOffAfterSec. MUTATES. Safe to call often: it reads the clock, `activeDt` is ignored. tickFrontier calls it.
 */
export function tickGrudges(state, world, activeDt) {
  void world; void activeDt;
  const g = ensureGrudges(state);
  const t = nowSec(state);
  const dt = Math.max(0, t - g.at);
  g.at = t;
  for (const key of Object.keys(g)) {
    if (!/^\d+$/.test(key)) continue;
    const e = g[key];
    if (!e || typeof e !== 'object') continue;
    if (e.vendettaAt != null) {
      if (vendettaLive(state, Number(key))) { e.orphanSince = null; continue; }
      if (e.orphanSince == null) e.orphanSince = t;
      if (t - e.orphanSince >= GRUDGES.calledOffAfterSec) {
        e.vendettaAt = null;
        e.orphanSince = null;
        e.value = Math.min(e.value, GRUDGES.afterLoss);
      }
      continue;
    }
    // a Grudge at the maximum holds there until the Vendetta is sworn (it may wait for a free defense slot or a target)
    if (dt > 0 && e.value < GRUDGES.max) e.value = Math.max(0, e.value - dt * GRUDGES.decayPerSec);
    if (e.warnedAt != null && e.value < GRUDGES.warnResetBelow) e.warnedAt = null;
  }
}

/** For the grudge meter: `{ value (floor), max, warned, broken, sworn }`. Pass `world` for `broken`. */
export function grudgeInfo(state, faction, world) {
  const e = state.grudges && state.grudges[String(faction)];
  const value = e && Number.isFinite(e.value) ? e.value : 0;
  return {
    value: Math.floor(value), max: GRUDGES.max, warned: !!(e && e.warnedAt != null), broken: world ? isBroken(state, world, faction) : false,
    sworn: !!(e && e.vendettaAt != null),
  };
}

/** The Grudge news since the last call (the 50-warnings: the `grudge` voice trigger), and clears the queue. MUTATES. */
export function drainGrudgeNews(state) {
  const g = state.grudges;
  if (!g || !Array.isArray(g.news) || !g.news.length) return [];
  const out = g.news.slice();
  g.news.length = 0;
  return out;
}

/** Factions whose Grudge is at the maximum with no Vendetta pending and whose leader is not broken (frontier.js swears these). */
export function vendettaReady(state, world) {
  const g = state.grudges;
  if (!g) return [];
  const out = [];
  for (const key of Object.keys(g)) {
    if (!/^\d+$/.test(key)) continue;
    const e = g[key];
    const f = Number(key);
    if (e && e.value >= GRUDGES.max && e.vendettaAt == null && isRival(f) && !isBroken(state, world, f)) out.push(f);
  }
  return out.sort((a, b) => a - b);
}

/** Marks a Vendetta sworn (its war band set out). MUTATES. */
export function markSworn(state, faction) {
  const e = grudgeOf(state, faction);
  e.vendettaAt = nowSec(state);
  e.orphanSince = null;
  e.value = GRUDGES.max;
}

/**
 * Settles a Vendetta: won -> the Grudge resets to GRUDGES.afterWin and a Trophy is hung (up to trophyMax); lost -> afterLoss.
 * MUTATES. Returns `{ won, faction, trophy }` (trophy: the faction's Trophy count now).
 */
export function settleVendetta(state, faction, won) {
  const e = grudgeOf(state, faction);
  e.vendettaAt = null;
  e.orphanSince = null;
  e.value = won ? GRUDGES.afterWin : GRUDGES.afterLoss;
  if (e.value < GRUDGES.warnResetBelow) e.warnedAt = null;
  let trophy = trophyCount(state, faction);
  if (won) {
    if (!state.trophies || typeof state.trophies !== 'object' || state.trophies.v !== 1) state.trophies = defaultTrophies();
    trophy = Math.min(GRUDGES.vendetta.trophyMax, trophy + 1);
    state.trophies[String(faction)] = trophy;
  }
  return { won: !!won, faction, trophy };
}

/** Trophies won from `faction` this dynasty. */
export function trophyCount(state, faction) {
  const t = state.trophies && state.trophies[String(faction)];
  return Number.isInteger(t) && t > 0 ? Math.min(GRUDGES.vendetta.trophyMax, t) : 0;
}

/** The attack multiplier the Trophies give against `faction`'s regions (1 with none). playerBattleStats folds it in. */
export function trophyBonus(state, faction) {
  return 1 + GRUDGES.vendetta.trophyAtk * trophyCount(state, faction) * boonMods(state).trophyMult; // Oathkeeper doubles it (PLAN-PHASE7)
}

/** A save's `grudges`, made valid. Never throws. */
export function sanitizeGrudges(raw) {
  const out = defaultGrudges();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  out.at = Math.max(0, n(raw.at) ?? 0);
  for (const [k, e] of Object.entries(raw)) {
    if (!/^\d{1,2}$/.test(k) || Number(k) <= FREE_FOLK || !e || typeof e !== 'object') continue;
    const value = Math.max(0, Math.min(GRUDGES.max, n(e.value) ?? 0));
    const at = (v) => (v != null && n(v) != null && n(v) >= 0 ? n(v) : null);
    out[k] = { value, warnedAt: at(e.warnedAt), vendettaAt: at(e.vendettaAt), orphanSince: at(e.orphanSince) };
  }
  if (Array.isArray(raw.news)) {
    for (const item of raw.news.slice(-GRUDGES.newsMax)) {
      if (item && item.kind === 'warn' && isRival(item.faction)) out.news.push({ kind: 'warn', faction: item.faction, value: Math.floor(n(item.value) ?? 0) });
    }
  }
  return out;
}

/** A save's `trophies`, made valid. Never throws. */
export function sanitizeTrophies(raw) {
  const out = defaultTrophies();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!/^\d{1,2}$/.test(k) || Number(k) <= FREE_FOLK) continue;
    const c = Math.floor(Number(v));
    if (Number.isFinite(c) && c > 0) out[k] = Math.min(GRUDGES.vendetta.trophyMax, c);
  }
  return out;
}
