// Save/load (ARCHITECTURE §5, DESIGN §8). Pure: no DOM, no Date.now, no
// Math.random, no storage or `btoa`/`atob` globals — storage is injected
// (`saveTo`/`loadFrom` take anything with getItem/setItem), and the base64
// codec below is hand-rolled so export/import work identically in Node
// (tests) and the browser without reaching for a global.

import { PLAYER_FACTION, defaultStats, defaultSettings } from './state.js';
import { sanitizeIntel } from './intelState.js';

export const SAVE_KEY = 'hexdominion.v2';
const CURRENT_VERSION = 1;

// --- Shape validation / migration -------------------------------------------

function num(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function plainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function numArray(value) {
  return Array.isArray(value) ? value.map((v) => (typeof v === 'number' ? v : PLAYER_FACTION)) : [];
}

function nullableNumArray(value) {
  return Array.isArray(value) ? value.map((v) => (typeof v === 'number' ? v : null)) : [];
}

/**
 * Per-region crowns (meta/crowns.js): null, or {victory, swift, unbroken} booleans. A save from before
 * crowns existed has none: [].
 */
function crownList(value) {
  return Array.isArray(value)
    ? value.map((c) => (c && typeof c === 'object' && !Array.isArray(c)
      ? { victory: !!c.victory, swift: !!c.swift, unbroken: !!c.unbroken }
      : null))
    : [];
}

/** Faction ids whose leader has already made first contact: unique non-negative integers, in order. */
function factionIdList(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const v of value) if (Number.isInteger(v) && v >= 0 && !out.includes(v)) out.push(v);
  return out;
}

const SMALL_INT_MAX = 99;

/**
 * Per-region small counters (prosperity levels): non-negative integers capped at 99, junk
 * becomes 0 so region ids keep their slot. The living-map module clamps to its own maximum on read.
 */
function smallIntList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (Number.isInteger(v) && v > 0 ? Math.min(v, SMALL_INT_MAX) : 0));
}

/**
 * Fills in any missing field with a sane default and drops anything that
 * doesn't look like the shape it claims to be. Tolerant by design: a
 * corrupted or hand-edited save should degrade gracefully, never throw.
 * @param {unknown} raw
 * @returns {import('./state.js').GameState}
 */
function withDefaults(raw) {
  const src = plainObject(raw);
  const dynastySrc = plainObject(src.dynasty);
  const tutorialSrc = plainObject(src.tutorial);

  return {
    version: CURRENT_VERSION,
    seed: num(src.seed, 1),
    dynasty: {
      level: num(dynastySrc.level, 1),
      stars: num(dynastySrc.stars, 0),
    },
    gold: num(src.gold, 0),
    owner: numArray(src.owner),
    conqueredAt: nullableNumArray(src.conqueredAt),
    crowns: crownList(src.crowns),
    metFactions: factionIdList(src.metFactions),
    intel: sanitizeIntel(src.intel),
    prosperity: smallIntList(src.prosperity),
    upgrades: { rally: 1, ...plainObject(src.upgrades) },
    stats: { ...defaultStats(), ...plainObject(src.stats) },
    settings: { ...defaultSettings(), ...plainObject(src.settings) },
    tutorial: { step: num(tutorialSrc.step, 0), done: !!tutorialSrc.done },
    lastSeen: num(src.lastSeen, 0),
    battle: src.battle ?? null,
  };
}

/**
 * Migrates a raw parsed save (any prior `version`, or none) up to the
 * current shape. There is only one version today; a future bump adds a
 * branch here, not a rewrite of withDefaults.
 * @param {unknown} raw
 * @returns {import('./state.js').GameState}
 */
export function migrate(raw) {
  return withDefaults(raw);
}

/** @param {import('./state.js').GameState} state @returns {string} */
export function serialize(state) {
  return JSON.stringify(state);
}

/**
 * True when `raw` is a plain object carrying a real owner table (a non-empty array of
 * non-negative integer faction ids). Every genuine save has one; garbage, hand-mangled
 * JSON and blank defaults do not — and must never masquerade as a save.
 * @param {unknown} raw
 */
export function hasValidOwnerTable(raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const owner = raw.owner;
  return Array.isArray(owner) && owner.length > 0 && owner.every((v) => Number.isInteger(v) && v >= 0);
}

/**
 * Parses a serialised save. Tolerant of missing OPTIONAL fields (they are migrated to
 * defaults) but returns `null` — never a blank default state — for anything that is not
 * JSON, not an object, or has no valid owner table (see hasValidOwnerTable).
 * @param {string} str
 * @returns {import('./state.js').GameState|null}
 */
export function deserialize(str) {
  let parsed = null;
  try {
    parsed = JSON.parse(str);
  } catch {
    return null;
  }
  if (!hasValidOwnerTable(parsed)) return null;
  return migrate(parsed);
}

// --- Pure base64 (no btoa/atob/Buffer — see file header) --------------------

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function utf8Encode(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.codePointAt(i);
    if (code > 0xffff) i++; // consumed a surrogate pair
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

function utf8Decode(bytes) {
  let str = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++];
    if (b0 < 0x80) {
      str += String.fromCodePoint(b0);
    } else if (b0 >= 0xf0) {
      const cp = ((b0 & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      str += String.fromCodePoint(cp);
    } else if (b0 >= 0xe0) {
      const cp = ((b0 & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      str += String.fromCodePoint(cp);
    } else {
      const cp = ((b0 & 0x1f) << 6) | (bytes[i++] & 0x3f);
      str += String.fromCodePoint(cp);
    }
  }
  return str;
}

function bytesToBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const triple = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);
    out += B64_CHARS[(triple >> 18) & 63];
    out += B64_CHARS[(triple >> 12) & 63];
    out += b1 === undefined ? '=' : B64_CHARS[(triple >> 6) & 63];
    out += b2 === undefined ? '=' : B64_CHARS[triple & 63];
  }
  return out;
}

function base64ToBytes(b64) {
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of b64) {
    if (ch === '=') break;
    const val = B64_CHARS.indexOf(ch);
    if (val === -1) continue; // tolerant of stray whitespace/newlines
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return bytes;
}

/** @param {import('./state.js').GameState} state @returns {string} */
export function exportCode(state) {
  return bytesToBase64(utf8Encode(serialize(state)));
}

/**
 * Tolerant of whitespace/newlines a user might introduce copy-pasting the
 * code. Returns null (never throws) on anything unrecoverable, including a
 * decodable string that is not a save (no valid owner table).
 * @param {string} code
 * @returns {import('./state.js').GameState|null}
 */
export function importCode(code) {
  try {
    const cleaned = String(code).replace(/\s+/g, '');
    const json = utf8Decode(base64ToBytes(cleaned));
    return deserialize(json);
  } catch {
    return null;
  }
}

// --- Injected storage --------------------------------------------------------

/**
 * @param {{ getItem(key: string): string|null, setItem(key: string, value: string): void }} storage
 * @param {import('./state.js').GameState} state
 */
export function saveTo(storage, state) {
  storage.setItem(SAVE_KEY, serialize(state));
}

/**
 * @param {{ getItem(key: string): string|null }} storage
 * @returns {import('./state.js').GameState|null} null when nothing (valid) is stored
 */
export function loadFrom(storage) {
  const raw = storage.getItem(SAVE_KEY);
  if (raw == null) return null;
  return deserialize(raw);
}
