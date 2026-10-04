// The dependency-free half of Phase 7 (docs/PLAN-PHASE7.md): the Boon and Relic records, their sanitizers, and THE one modifier source
// of Boons and Relics, `boonMods(state)`. A LEAF (config only), so economy.js, progression.js, frontier.js, intel.js, grudges.js and
// the rest can read it without an import cycle (mirrors meta/edicts.js edictMods). Pure: no DOM, no Date.now, no Math.random.
//
//   state.boons2 = { v:1, owned: [boonId], pending: { choices: [boonId x<=3], source, missed? } | null, draws, champEyeUsed, conquests }
//     PER DYNASTY. `conquests` counts conquests for Tithe (an addition to the contract). `state.boons` (Dragonscale) is a different record.
//   state.relics = { v:1, seed, placed: { [regionId]: relicId }, owned: [relicId] }
//     PER DYNASTY. `seed` is the world seed the Relics were placed for (an addition: an old save places them lazily, once).
//   state.generals.reliquary = { v:1, found: [relicId] }   LIFETIME (rides with the Generals roster, like the Deeds)
import { BOON_NEUTRAL, BOON_MAX_KEYS, BOON_MINPOS_KEYS, BOON_SIM_KEYS, BOON_LIST, DUO_LIST, BOONS } from '../config/boons.js';
import { RELIC_LIST } from '../config/relics.js';

export const BOON_BY_ID = new Map(BOON_LIST.map((b) => [b.id, b]));
export const RELIC_BY_ID = new Map(RELIC_LIST.map((r) => [r.id, r]));
const MAX = new Set(BOON_MAX_KEYS);
const MINPOS = new Set(BOON_MINPOS_KEYS);
const NEUTRAL = Object.freeze({ ...BOON_NEUTRAL });

export function defaultBoons2() {
  return { v: 1, owned: [], pending: null, draws: 0, champEyeUsed: false, conquests: 0 };
}

export function defaultRelics() {
  return { v: 1, seed: null, placed: {}, owned: [] };
}

export function defaultReliquary() {
  return { v: 1, found: [] };
}

/** Creates (or repairs) `state.boons2` and returns it. */
export function ensureBoons2(state) {
  if (!state.boons2 || typeof state.boons2 !== 'object' || state.boons2.v !== 1) state.boons2 = defaultBoons2();
  const b = state.boons2;
  if (!Array.isArray(b.owned)) b.owned = [];
  if (!Number.isFinite(b.draws)) b.draws = 0;
  if (!Number.isFinite(b.conquests)) b.conquests = 0;
  if (b.pending !== null && (typeof b.pending !== 'object' || !Array.isArray(b.pending.choices))) b.pending = null;
  return b;
}

/** Creates (or repairs) `state.relics` and returns it. */
export function ensureRelics(state) {
  if (!state.relics || typeof state.relics !== 'object' || state.relics.v !== 1) state.relics = defaultRelics();
  const r = state.relics;
  if (!r.placed || typeof r.placed !== 'object' || Array.isArray(r.placed)) r.placed = {};
  if (!Array.isArray(r.owned)) r.owned = [];
  return r;
}

/** Creates (or repairs) `state.generals.reliquary` and returns it. */
export function ensureReliquary(state) {
  if (!state.generals || typeof state.generals !== 'object') state.generals = { seq: 1, roster: [] };
  const g = state.generals;
  if (!g.reliquary || typeof g.reliquary !== 'object' || g.reliquary.v !== 1 || !Array.isArray(g.reliquary.found)) g.reliquary = defaultReliquary();
  return g.reliquary;
}

const uniqueKnown = (list, known, max) => {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const id of list) if (typeof id === 'string' && known.has(id) && !out.includes(id) && out.length < max) out.push(id);
  return out;
};

/** A save's `boons2`, made valid: known Boons only, no repeats, a pending offer of 1-3 known unowned Boons or null. Never throws. */
export function sanitizeBoons2(raw) {
  const out = defaultBoons2();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  out.owned = uniqueKnown(raw.owned, BOON_BY_ID, BOON_LIST.length);
  const p = raw.pending;
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    const choices = uniqueKnown(p.choices, BOON_BY_ID, BOONS.choices).filter((id) => !out.owned.includes(id));
    if (choices.length) {
      out.pending = { choices, source: ['battle', 'champion'].includes(p.source) ? p.source : 'battle' };
      if (p.missed === true) out.pending.missed = true;
    }
  }
  const n = (v, max) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(max, Math.floor(Number(v)))) : 0);
  out.draws = n(raw.draws, 1e6);
  out.conquests = n(raw.conquests, 1e6);
  out.champEyeUsed = raw.champEyeUsed === true;
  return out;
}

/** A save's `relics`, made valid. Never throws. An old save (none) gets an empty record; relics.js places them lazily. */
export function sanitizeRelics(raw) {
  const out = defaultRelics();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  out.seed = Number.isInteger(raw.seed) && raw.seed >= 0 && raw.seed <= 4294967295 ? raw.seed : null;
  out.owned = uniqueKnown(raw.owned, RELIC_BY_ID, RELIC_LIST.length);
  const placed = raw.placed && typeof raw.placed === 'object' && !Array.isArray(raw.placed) ? raw.placed : {};
  const used = new Set();
  for (const [k, v] of Object.entries(placed)) {
    if (!/^\d{1,4}$/.test(k) || !RELIC_BY_ID.has(v) || used.has(v)) continue;
    used.add(v);
    out.placed[k] = v;
  }
  return out;
}

/** A save's lifetime Reliquary, made valid. Never throws. */
export function sanitizeReliquary(raw) {
  const out = defaultReliquary();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  out.found = uniqueKnown(raw.found, RELIC_BY_ID, RELIC_LIST.length);
  return out;
}

/** The Duo Boons whose both parts are in `owned`. */
export function duosOf(owned) {
  return DUO_LIST.filter((d) => d.parts.every((p) => owned.includes(p)));
}

/** Folds one source's mods into `out` (the rules in config/boons.js). */
export function foldBoonMods(out, mods) {
  for (const [k, v] of Object.entries(mods)) {
    if (!(k in out)) continue;
    if (typeof v === 'boolean') out[k] = out[k] || v;
    else if (k.endsWith('Mult')) out[k] *= v;
    else if (MINPOS.has(k)) out[k] = out[k] > 0 ? Math.min(out[k], v) : v;
    else if (MAX.has(k)) out[k] = Math.max(out[k], v);
    else out[k] += v;
  }
  return out;
}

let memoKey = null;
let memoVal = null;

/**
 * Every Boon and Relic modifier for this state (BOON_NEUTRAL in config/boons.js documents each key), neutral with none. Owned Boons,
 * the Duos they complete and the Relics held this dynasty fold into ONE flat object the meta and sim paths read themselves.
 * @returns {object} frozen
 */
export function boonMods(state) {
  const owned = state && state.boons2 && Array.isArray(state.boons2.owned) ? state.boons2.owned : [];
  const relics = state && state.relics && Array.isArray(state.relics.owned) ? state.relics.owned : [];
  const key = `${owned.join(',')}|${relics.join(',')}`;
  if (key === memoKey) return memoVal;
  const out = { ...NEUTRAL };
  for (const id of owned) { const b = BOON_BY_ID.get(id); if (b) foldBoonMods(out, b.mods); }
  for (const d of duosOf(owned)) foldBoonMods(out, d.mods);
  for (const id of relics) { const r = RELIC_BY_ID.get(id); if (r) foldBoonMods(out, r.mods); }
  memoKey = key;
  memoVal = Object.freeze(out);
  return memoVal;
}

/**
 * The sim's part of boonMods: only the keys of BOON_SIM_KEYS that differ from neutral, or null with none (PlayerStats.boons; plain
 * JSON, saved with the battle). game/battle/* reads it through battle.player.boons.
 */
export function boonSimStats(state) {
  const m = boonMods(state);
  let out = null;
  for (const k of BOON_SIM_KEYS) if (m[k] !== NEUTRAL[k]) (out || (out = {}))[k] = m[k];
  return out;
}

/** Fills `{key}` / `{pct:key}` from a mods object (config/boons.js header); a key the object lacks reads its neutral value. */
export function fillBoonText(text, mods) {
  return String(text).replace(/\{(?:(pct):)?(\w+)\}/g, (_, pct, k) => {
    const v = mods[k] !== undefined ? mods[k] : NEUTRAL[k];
    if (typeof v !== 'number') return '';
    if (pct) return `${Math.round(Math.abs(k.endsWith('Mult') ? v - 1 : v) * 100)}%`;
    return String(+v.toFixed(2));
  });
}
