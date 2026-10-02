// The Chronicle's saved shape (DESIGN §5.9): create, repair and read `state.chronicle`. A LEAF module on purpose: it imports only
// config/chronicle.js, so meta/state.js and meta/save.js can import it without a cycle (meta/chronicle.js imports state.js for
// PLAYER_FACTION and leaders.js, and re-exports everything here). Same split as intelState.js / worksEffects.js.
// Pure: no DOM, no clock, no randomness, no storage.
import { CHRONICLE } from '../config/chronicle.js';

/**
 * @typedef {Object} ChronicleEntry
 * @property {string} kind
 * @property {number} t      ms timestamp
 * @property {number} y      Year within its dynasty (1-based)
 * @property {number} d      dynasty number (1-based)
 * @property {boolean} hl    also kept as a lifetime highlight
 * @property {Object<string, string|number|boolean>} data  flat, JSON-safe
 *
 * @typedef {Object} Chronicle
 * @property {1} v
 * @property {number|null} startedAt
 * @property {ChronicleEntry[]} entries
 * @property {ChronicleEntry[]} lifetime
 * @property {Object<string, true>} seen
 * @property {Object<string, true>} firsts
 * @property {number|null} bestSec
 * @property {number} streak
 * @property {number} conquests
 */

// --- shape ----------------------------------------------------------------------------------------

/** @returns {Chronicle} */
export function createChronicle() {
  return { v: 1, startedAt: null, entries: [], lifetime: [], seen: {}, firsts: {}, bestSec: null, streak: 0, conquests: 0 };
}

export const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** Flat, JSON-safe `data` (strings, booleans, finite numbers). Internal: used by recordChronicle. */
export function cleanData(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string' || typeof v === 'boolean' || finite(v)) out[k] = v;
  }
  return out;
}

function cleanEntry(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.kind !== 'string' || !raw.kind || !finite(raw.t)) return null;
  return {
    kind: raw.kind,
    t: raw.t,
    y: Number.isInteger(raw.y) && raw.y >= 1 ? raw.y : 1,
    d: Number.isInteger(raw.d) && raw.d >= 1 ? raw.d : 1,
    hl: !!raw.hl,
    data: cleanData(raw.data),
  };
}

function cleanFlags(raw) {
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const [k, v] of Object.entries(raw)) if (v) out[k] = true;
  return out;
}

/**
 * Turns whatever a save contained into a valid chronicle: only well-formed entries survive, lists are capped, flags are
 * booleans. For meta/save.js's `withDefaults` (`chronicle: sanitizeChronicle(src.chronicle)`); never throws.
 * @param {unknown} raw
 * @returns {Chronicle}
 */
export function sanitizeChronicle(raw) {
  const c = createChronicle();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return c;
  c.startedAt = finite(raw.startedAt) ? raw.startedAt : null;
  const list = (v, cap) => (Array.isArray(v) ? v.map(cleanEntry).filter(Boolean).slice(-cap) : []);
  c.entries = list(raw.entries, CHRONICLE.maxEntries);
  c.lifetime = list(raw.lifetime, CHRONICLE.maxHighlights);
  c.seen = cleanFlags(raw.seen);
  c.firsts = cleanFlags(raw.firsts);
  c.bestSec = finite(raw.bestSec) && raw.bestSec > 0 ? raw.bestSec : null;
  c.streak = Number.isInteger(raw.streak) && raw.streak > 0 ? raw.streak : 0;
  c.conquests = Number.isInteger(raw.conquests) && raw.conquests > 0 ? raw.conquests : 0;
  return c;
}

/**
 * `state.chronicle`, created (or repaired) on demand, so an old save or a test fixture works untouched.
 * @param {{ chronicle?: unknown }} state
 * @returns {Chronicle}
 */
export function ensureChronicle(state) {
  const c = state.chronicle;
  const ok = c && typeof c === 'object' && c.v === 1 && Array.isArray(c.entries) && Array.isArray(c.lifetime)
    && c.seen && c.firsts;
  if (!ok) state.chronicle = sanitizeChronicle(c);
  return state.chronicle;
}

/** This dynasty's entries, oldest first (read-only). @returns {readonly ChronicleEntry[]} */
export function chronicleEntries(state) {
  return state.chronicle && Array.isArray(state.chronicle.entries) ? state.chronicle.entries : [];
}

/** Highlights across every dynasty, oldest first (read-only). @returns {readonly ChronicleEntry[]} */
export function lifetimeHighlights(state) {
  return state.chronicle && Array.isArray(state.chronicle.lifetime) ? state.chronicle.lifetime : [];
}
