// Ascension (PLAN-PHASE13 §13C): the lasting difficulty ladder after the ending. A LEAF (config only), so meta/edicts.js can fold the
// mods into edictMods and meta/legacy.js can read the Legacy multiplier without a cycle. Pure: no DOM, no Date.now, no Math.random.
//
//   state.ascension = 0..10                                          PER DYNASTY (the level this dynasty is played at; set by foundDynasty)
//   state.generals.ascension = { v:1, highest }                      LIFETIME (rides with the Generals: the highest level ever cleared)
//   state.generals.crowned = { v:1, year, dynasty, t, times } | null LIFETIME (the first crowning; times = Thrones toppled; meta/crown.js)
//
//   ascensionMods(level)            -> the cumulative mods of levels 1..level (EDICT_NEUTRAL keys only), frozen
//   ascensionLevel(state)           -> this dynasty's level (0 = none)
//   ascensionHighest(state)         -> the highest level cleared (0 = none)
//   isCrowned(state)                -> true once the Throne of Ages has fallen (Ascension unlocks)
//   maxAscensionChoice(state)       -> the highest level a founding may pick now (0 while locked)
//   ascensionLegacyMult(state)      -> the Legacy multiplier the founding that ends this dynasty pays (1 + 0.25 x level)
import { ASCENSION } from '../config/ascension.js';
import { EDICT_NEUTRAL, EDICT_LIST } from '../config/edicts.js';

const EDICT_IDS = new Set(EDICT_LIST.map((e) => e.id));

const clampLevel = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(ASCENSION.maxLevel, Math.floor(Number(v)))) : 0);

const memo = new Map();

/** The cumulative mods of Ascension 1..level (keys of EDICT_NEUTRAL; Mult keys multiply, booleans OR, the rest add). */
export function ascensionMods(level) {
  const n = clampLevel(level);
  if (memo.has(n)) return memo.get(n);
  const out = {};
  for (const step of ASCENSION.ladder) {
    if (step.level > n) break;
    for (const [k, v] of Object.entries(step.mods)) {
      if (!(k in EDICT_NEUTRAL)) continue;
      if (typeof v === 'boolean') out[k] = (out[k] || false) || v;
      else if (k.endsWith('Mult')) out[k] = (out[k] ?? 1) * v;
      else out[k] = (out[k] || 0) + v;
    }
  }
  const frozen = Object.freeze(out);
  memo.set(n, frozen);
  return frozen;
}

export function ascensionLevel(state) {
  return clampLevel(state && state.ascension);
}

function record(state) {
  const r = state && state.generals && state.generals.ascension;
  return r && typeof r === 'object' ? r : null;
}

export function ascensionHighest(state) {
  const r = record(state);
  return r ? clampLevel(r.highest) : 0;
}

export function isCrowned(state) {
  const c = state && state.generals && state.generals.crowned;
  return !!(c && typeof c === 'object' && Number.isFinite(c.dynasty));
}

export function maxAscensionChoice(state) {
  if (!isCrowned(state)) return 0;
  return Math.min(ASCENSION.maxLevel, ascensionHighest(state) + ASCENSION.aboveCleared);
}

/** A founding's `{ ascension }` choice made valid: 0..maxAscensionChoice(state) (0 while locked). */
export function cleanAscensionChoice(state, level) {
  return Math.min(clampLevel(level), maxAscensionChoice(state));
}

export function ascensionLegacyMult(state) {
  return 1 + ASCENSION.legacyPerLevel * ascensionLevel(state);
}

/** Creates (or repairs) `state.generals.ascension` and returns it. */
export function ensureAscension(state) {
  if (!state.generals || typeof state.generals !== 'object') state.generals = { seq: 1, roster: [] };
  const g = state.generals;
  if (!g.ascension || typeof g.ascension !== 'object' || g.ascension.v !== 1) g.ascension = { v: 1, highest: 0 };
  g.ascension.highest = clampLevel(g.ascension.highest);
  return g.ascension;
}

// --- Save --------------------------------------------------------------------------------------------------------------------------

export function sanitizeAscensionLevel(raw) {
  return clampLevel(raw);
}

/** A save's `generals.ascension` made valid (null when absent or junk). Never throws. */
export function sanitizeAscensionRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return { v: 1, highest: clampLevel(raw.highest) };
}

/** A save's `generals.crowned` made valid (null when absent or junk). Never throws. */
export function sanitizeCrowned(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const int = (v, lo, hi) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.floor(Number(v)))) : lo);
  if (!Number.isFinite(Number(raw.dynasty))) return null;
  return {
    v: 1, year: int(raw.year, 1, 1e6), dynasty: int(raw.dynasty, 1, 99), t: Number.isFinite(Number(raw.t)) ? Number(raw.t) : 0,
    times: int(raw.times, 1, 1e6),
  };
}

/** A save's `generals.reign` (the lasting record of every dynasty's Edict, meta/crown.js noteReign) made valid; null when absent. */
export function sanitizeReignRecord(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.edicts)) return null;
  const edicts = [];
  for (const e of raw.edicts) {
    if (!e || !Number.isInteger(e.d) || e.d < 1 || e.d > 99 || !EDICT_IDS.has(e.id) || edicts.some((x) => x.d === e.d)) continue;
    edicts.push({ d: e.d, id: e.id });
  }
  return { v: 1, edicts: edicts.sort((a, b) => a.d - b.d).slice(-99) };
}
