// Save/load (ARCHITECTURE §5, DESIGN §8). Pure: no DOM, no Date.now, no
// Math.random, no storage or `btoa`/`atob` globals — storage is injected
// (`saveTo`/`loadFrom` take anything with getItem/setItem), and the base64
// codec below is hand-rolled so export/import work identically in Node
// (tests) and the browser without reaching for a global.

import { PLAYER_FACTION, defaultStats, defaultSettings } from './state.js';
import { sanitizeIntel } from './intelState.js';
import { sanitizeUnrest } from './unrestState.js';
import { sanitizeWorks } from './worksEffects.js';
import { sanitizeFrontier, sanitizeOccupation } from './frontierState.js';
import { sanitizeForts } from './fortsEffects.js';
import { sanitizeMilitia } from './militia.js';
import { sanitizeGenerals } from './generalsState.js';
import { sanitizeRenown } from './renownState.js';
import { sanitizeBoons } from './featuresState.js';
import { sanitizeWorldEvents } from './eventsState.js';
import { sanitizeChronicle } from './chronicleState.js';
import { sanitizeBounties } from './bountiesState.js';
import { sanitizeStreak } from './streak.js';
import { sanitizeGrudges, sanitizeTrophies } from './grudges.js';
import { sanitizeEdict } from './edicts.js';
import { sanitizeRivals } from './rivals.js';
import { sanitizeLegacy } from './legacy.js';
import { sanitizeBoons2, sanitizeRelics } from './boonsState.js';
import { UPGRADES } from './upgrades.js';
import { FACTIONS } from '../config/world.js';

export const SAVE_KEY = 'hexdominion.v2';
const CURRENT_VERSION = 1;

// --- Shape validation / migration -------------------------------------------

function num(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function plainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** A finite number clamped to [min, max] and truncated to an integer when `int`; anything else is `fallback`. */
function clampNum(value, fallback, min, max, int = false) {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const c = Math.min(max, Math.max(min, n));
  return int ? Math.trunc(c) : c;
}

const FREE_FOLK = 1;

/** Owner per region: faction ids that exist (below the number of factions); junk becomes Free Folk, never the player's. */
function numArray(value) {
  return Array.isArray(value) ? value.map((v) => (Number.isInteger(v) && v >= 0 && v < FACTIONS.length ? v : FREE_FOLK)) : [];
}

function nullableNumArray(value) {
  return Array.isArray(value) ? value.map((v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)) : [];
}

/** Upgrade levels: only upgrades that exist, integer levels within their maximum (200 when they have none). The free Rally power is always at least level 1. */
function sanitizeUpgrades(raw) {
  const src = plainObject(raw);
  const out = { rally: 1 };
  for (const id of Object.keys(UPGRADES)) {
    if (!(id in src)) continue;
    const max = UPGRADES[id].max ?? 200;
    out[id] = clampNum(src[id], 0, 0, max, true);
  }
  if (!(out.rally >= 1)) out.rally = 1;
  return out;
}

/** Lifetime stats: the known counters only, each a finite non-negative number (`bestBattleSec` null or one). A string in `playSec` used to grow forever. */
function sanitizeStats(raw) {
  const d = defaultStats();
  const src = plainObject(raw);
  const out = {};
  for (const k of Object.keys(d)) {
    if (k === 'bestBattleSec') out[k] = typeof src[k] === 'number' && Number.isFinite(src[k]) && src[k] >= 0 ? src[k] : null;
    else out[k] = clampNum(src[k], d[k], 0, 1e15);
  }
  return out;
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

/** The sim's battle format (battle/sim.js `createBattle` writes `version: 1`). A saved battle of another version is dropped on load, never resumed. */
export const BATTLE_SAVE_VERSION = 1;

/**
 * Is `b` a battle the game can resume? The right version, the arrays the sim and the scene index into, an arena naming a real region and real tiles. Cheap shape
 * checks only (no sim is run): a save from another build, a hand-edited or half-written one, or `{}` is refused here instead of crashing the scene later.
 * @param {unknown} b
 * @param {number} [regionCount] when given, the arena's region id must be below it
 * @returns {boolean}
 */
export function plausibleBattle(b, regionCount = Infinity) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return false;
  if (b.version !== BATTLE_SAVE_VERSION) return false;
  if (!Array.isArray(b.sites) || b.sites.length < 2 || !Array.isArray(b.squads)) return false;
  const a = b.arena;
  if (!a || typeof a !== 'object' || !Number.isInteger(a.regionId) || a.regionId < 0 || a.regionId >= regionCount) return false;
  if (!Array.isArray(a.tiles) || a.tiles.length === 0 || !Array.isArray(a.sites) || a.sites.length !== b.sites.length) return false;
  if (!Number.isFinite(b.t) || !b.player || typeof b.player !== 'object' || !b.enemy || typeof b.enemy !== 'object') return false;
  return b.sites.every((s) => s && Number.isInteger(s.id) && Number.isInteger(s.tile) && Number.isFinite(s.troops) && Number.isInteger(s.owner));
}

/**
 * The player's settings, whitelisted and clamped: only known keys, booleans where booleans belong, `speed` one of the real speeds, volumes finite and within
 * 0..1. An old save that stored `reduceMotion: true` counts as the player's own choice (`reduceMotionSet`), so the OS preference never overrides it.
 * @param {unknown} raw
 * @returns {import('./state.js').GameSettings}
 */
export function sanitizeSettings(raw) {
  const d = defaultSettings();
  const src = plainObject(raw);
  const bool = (k) => (typeof src[k] === 'boolean' ? src[k] : d[k]);
  const unit = (k) => (typeof src[k] === 'number' && Number.isFinite(src[k]) ? Math.min(1, Math.max(0, src[k])) : d[k]);
  return {
    sound: bool('sound'),
    reduceMotion: bool('reduceMotion'),
    reduceMotionSet: typeof src.reduceMotionSet === 'boolean' ? src.reduceMotionSet : src.reduceMotion === true,
    hints: bool('hints'),
    speed: [0.5, 1, 2, 3].includes(src.speed) ? src.speed : d.speed,
    // an older save that was left on the 0.5x assist speed keeps it available
    slowBattles: typeof src.slowBattles === 'boolean' ? src.slowBattles : src.speed === 0.5,
    leaderVoices: bool('leaderVoices'),
    music: bool('music'),
    musicVolume: unit('musicVolume'),
    sfxVolume: unit('sfxVolume'),
  };
}

/**
 * Per-region small counters (prosperity levels): non-negative integers capped at 99, junk
 * becomes 0 so region ids keep their slot. The living-map module clamps to its own maximum on read.
 */
function smallIntList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (Number.isInteger(v) && v > 0 ? Math.min(v, SMALL_INT_MAX) : 0));
}

/**
 * The old tutorial was a linear counter ({ step, done }, steps 0 to 6: gold, region, Attack, War Camp drag, keep, Rally, council). The new one is a
 * set of seen step ids. A save in the old shape keeps what it had seen; a player who finished the old tutorial is marked as having seen the steps
 * it covered (W0 to W3, B1, B3, B5, M1) and will meet the new ones (send size, selecting several, supply lines, pause and speed, powers, scouting,
 * works, the dynasty) when they become relevant.
 * @param {unknown} raw
 * @returns {{ seen: Object<string, boolean>, done: boolean }}
 */
export function migrateTutorial(raw) {
  const src = plainObject(raw);
  const seen = {};
  if (src.seen && typeof src.seen === 'object' && !Array.isArray(src.seen)) {
    for (const [id, v] of Object.entries(src.seen)) if (v && /^[A-Z]\d{1,2}$/.test(id)) seen[id] = true;
    return { seen, done: !!src.done };
  }
  const OLD_ORDER = [['W0', 'W1'], ['W2'], ['W3'], ['B1'], ['B3'], ['B5'], ['M1']];
  const reached = src.done ? OLD_ORDER.length : Math.max(0, Math.min(OLD_ORDER.length, num(src.step, 0)));
  for (let i = 0; i < reached; i++) for (const id of OLD_ORDER[i]) seen[id] = true;
  return { seen, done: false };
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
  const owner = numArray(src.owner);
  // every in-progress battle (ARCHITECTURE 10.2: state.battles, a legacy state.battle migrates into a one-element list) survives only if it can really be resumed
  const battles = sanitizeBattles(src, owner);

  return {
    version: CURRENT_VERSION,
    seed: clampNum(src.seed, 1, 0, 4294967295, true),
    dynasty: {
      level: clampNum(dynastySrc.level, 1, 1, 99, true), // a runaway level would make a continent nobody can generate
      stars: clampNum(dynastySrc.stars, 0, 0, 1e6, true),
    },
    gold: clampNum(src.gold, 0, 0, 1e30),
    owner,
    conqueredAt: nullableNumArray(src.conqueredAt),
    crowns: crownList(src.crowns),
    metFactions: factionIdList(src.metFactions),
    intel: sanitizeIntel(src.intel),
    unrest: sanitizeUnrest(src.unrest), // PLAN-PHASE11b
    prosperity: smallIntList(src.prosperity),
    works: sanitizeWorks(src.works),
    upgrades: sanitizeUpgrades(src.upgrades),
    stats: sanitizeStats(src.stats),
    chronicle: sanitizeChronicle(src.chronicle), // never throws: junk becomes an empty story, the lists are capped (meta/chronicleState.js)
    settings: sanitizeSettings(src.settings),
    tutorial: migrateTutorial(src.tutorial),
    saveSeq: clampNum(src.saveSeq, 0, 0, 1e12, true),
    lastSeen: clampNum(src.lastSeen, 0, 0, 1e14), // 0 = unknown: the shell treats it as "now" (no welcome-back for a clock that never ran)
    battles,
    // the Living Frontier (ARCHITECTURE 10.2): the raid clock, occupied regions, fortifications and militia, each sanitised by its own module
    frontier: sanitizeFrontier(src.frontier),
    occupation: sanitizeOccupation(src.occupation),
    forts: sanitizeForts(src.forts),
    militia: sanitizeMilitia(src.militia),
    // Phase 2: the Generals (lifetime, seeded names) and this dynasty's Renown
    generals: sanitizeGenerals(src.generals, clampNum(src.seed, 1, 0, 4294967295, true)),
    renown: sanitizeRenown(src.renown),
    boons: sanitizeBoons(src.boons),
    worldEvents: sanitizeWorldEvents(src.worldEvents),
    // Phase 4 (PLAN-PHASE4): this dynasty's Bounty Board, Conquest Streak, Grudges and Trophies (the lifetime Deeds ride inside
    // `generals`, sanitised by sanitizeGenerals). A save from before Phase 4 gets fresh, empty records.
    bounties: sanitizeBounties(src.bounties),
    streak: sanitizeStreak(src.streak),
    grudges: sanitizeGrudges(src.grudges),
    trophies: sanitizeTrophies(src.trophies),
    // Phase 5 (PLAN-PHASE5): this dynasty's Edict and Challenges (an old save plays by the standard rules); the lifetime Legacy rides
    // inside `generals` (below)
    edict: sanitizeEdict(src.edict),
    rivals: sanitizeRivals(src.rivals), // PLAN-PHASE6: a save from before rotation keeps the classic three
    archipelago: src.archipelago === true, // PLAN-PHASE12: this dynasty's continent is an archipelago (the world is regenerated from it)
    // Phase 7 (PLAN-PHASE7): this dynasty's Boons and Relics (an old save: none owned; relics.syncRelics places the Relics on load).
    // The lifetime Reliquary rides inside `generals` (sanitizeGenerals)
    boons2: sanitizeBoons2(src.boons2),
    relics: sanitizeRelics(src.relics),
  };
}

/** The most battles that may run at once (DESIGN 10.5; FRONTIER.maxBattles once config/frontier.js exists). */
export const MAX_SAVED_BATTLES = 3;

/**
 * The running battles of a save, as `BattleRun`s (ARCHITECTURE 10.2). A legacy single `battle` becomes a one-element list (an attack, id 1). Each run is kept only
 * if its battle can really be resumed (`plausibleBattle`), its region is real, an ATTACK's region is still the enemy's (a save of a won region would resume a ghost
 * fight), and no other kept run fights over the same region. Ids are positive integers, unique. At most MAX_SAVED_BATTLES.
 * @param {object} src the raw save
 * @param {number[]} owner the sanitised owners
 * @returns {object[]}
 */
export function sanitizeBattles(src, owner) {
  const raw = Array.isArray(src.battles) && (src.battles.length || !src.battle) ? src.battles
    : (src.battle ? [{ id: 1, kind: 'attack', regionId: src.battle && src.battle.arena ? src.battle.arena.regionId : -1, battle: src.battle, commander: null, auto: false, startedAt: 0 }] : []);
  const out = [];
  const regions = new Set();
  const ids = new Set();
  for (const r of raw) {
    if (out.length >= MAX_SAVED_BATTLES) break;
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    const kind = r.kind === 'defense' || r.kind === 'duel' ? r.kind : r.kind === 'attack' || r.kind == null ? 'attack' : null; // a Duel (DESIGN 10.13) is a defense-like run
    if (!kind) continue;
    if (!plausibleBattle(r.battle, owner.length)) continue;
    const regionId = r.battle.arena.regionId;
    if (Number.isInteger(r.regionId) && r.regionId !== regionId) continue; // the run and its arena must agree
    if (kind === 'attack' && owner[regionId] === PLAYER_FACTION) continue;
    if ((kind === 'defense' || kind === 'duel') && owner[regionId] !== PLAYER_FACTION) continue; // a defense (or a Duel) is fought in a region that is still yours
    if (regions.has(regionId)) continue;
    let id = Number.isInteger(r.id) && r.id > 0 && r.id < 1e9 ? r.id : 0;
    if (!id || ids.has(id)) { id = 1; while (ids.has(id)) id += 1; }
    ids.add(id);
    regions.add(regionId);
    const run = {
      id,
      kind,
      regionId,
      battle: r.battle,
      commander: typeof r.commander === 'string' && r.commander.length <= 64 ? r.commander : null,
      auto: r.auto === true,
      startedAt: clampNum(r.startedAt, 0, 0, 1e14),
    };
    if (kind === 'defense') {
      run.fromRegionId = Number.isInteger(r.fromRegionId) && r.fromRegionId >= 0 && r.fromRegionId < owner.length ? r.fromRegionId : null;
      run.attackerFaction = Number.isInteger(r.attackerFaction) && r.attackerFaction > 0 && r.attackerFaction < 16 ? r.attackerFaction : null;
      if (Number.isInteger(r.raidId) && r.raidId >= 0) run.raidId = r.raidId;
      run.first = r.first === true;
      // a Vendetta (PLAN-PHASE4 §4D): defenseReward settles the Grudge and the Trophy from this flag
      if (r.vendetta && typeof r.vendetta === 'object' && Number.isInteger(r.vendetta.faction) && r.vendetta.faction > 1 && r.vendetta.faction < 16) {
        run.vendetta = { faction: r.vendetta.faction, leader: typeof r.vendetta.leader === 'string' ? r.vendetta.leader.slice(0, 60) : '' };
      }
    }
    // the label the card showed when an attack began (the Bounty Board's swiftHard contract reads it at the end)
    if (kind === 'attack' && ['Easy', 'Fair', 'Hard', 'Deadly'].includes(r.labelAtAttack)) run.labelAtAttack = r.labelAtAttack;
    if (kind === 'duel') {
      run.fromRegionId = Number.isInteger(r.fromRegionId) && r.fromRegionId >= 0 && r.fromRegionId < owner.length ? r.fromRegionId : null;
      run.attackerFaction = Number.isInteger(r.attackerFaction) && r.attackerFaction > 0 && r.attackerFaction < 16 ? r.attackerFaction : null;
      if (Number.isInteger(r.eventId) && r.eventId >= 0) run.eventId = r.eventId;
      if (typeof r.champion === 'string' && r.champion.length <= 80) run.champion = r.champion;
    }
    out.push(run);
  }
  return out;
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

/** Longest import string accepted (characters, whitespace included): many times a realistic late-game save code. */
export const MAX_IMPORT_CHARS = 262144;

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
    // a real save code is a few KB; a pasted novel (or a hostile megabyte) is refused before it is decoded
    if (String(code).length > MAX_IMPORT_CHARS) return null;
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
