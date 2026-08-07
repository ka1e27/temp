// Persistence: versioned bytes, a migration chain, and the refusal rules.
//
// THE RULE THAT MATTERS: a corrupt or FUTURE-VERSION save REFUSES TO LOAD and
// LEAVES THE FILE ALONE. Nothing here ever deletes or overwrites a save it
// could not understand. A player who opens the game in an older tab must find
// their progress intact when they go back to the newer one — silently wiping
// is the single worst bug an idle game can ship.
//
// Storage is INJECTED. This module never touches a browser global, so every
// path including quota-exceeded is testable with a plain object. main.js passes
// the browser's own storage object into createStorageAdapter() at the call site;
// the key it writes under is SAVE_KEY below.
//
// Autosave exposes HOOKS. No listener is attached at module scope — main.js
// wires visibilitychange/beforeunload to autosaver.flush().
//
// PURE: `now` is injected. No Date.now, no DOM, no direct storage reference.

import {
  SAVE_VERSION, toPersisted, fromPersisted, createStats, createState,
} from '../core/store.js';
import { refreshUnlocks } from './world.js';
import { recalcIncome, applyOfflineProgress } from './idle.js';
import { META_EVENTS, emit } from './events.js';

export { SAVE_VERSION };
export const SAVE_KEY = 'hexdominion.save';
export const BACKUP_KEY = 'hexdominion.save.bak';
export const AUTOSAVE_MS = 5000;

// ---------------------------------------------------------------------------
// Storage adapters
// ---------------------------------------------------------------------------

/** Wrap any localStorage-alike so a throwing/absent backing degrades to a
 *  no-op instead of taking the game down. Never called at module scope. */
export function createStorageAdapter(backing) {
  return {
    getItem(k) { try { return backing?.getItem(k) ?? null; } catch { return null; } },
    setItem(k, v) { try { backing.setItem(k, v); return true; } catch { return false; } },
    removeItem(k) { try { backing.removeItem(k); return true; } catch { return false; } },
  };
}

/** In-memory storage for tests and for a browser with storage blocked. */
export function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); return true; },
    removeItem: (k) => { map.delete(k); return true; },
    get size() { return map.size; },
    keys: () => [...map.keys()],
  };
}

// ---------------------------------------------------------------------------
// Migrations: a version -> version function chain, one entry per bump.
// Each fixture in tests/fixtures/ is FROZEN and must never be edited — that is
// the only thing that proves a migration still works a year from now.
// ---------------------------------------------------------------------------

/** v1 -> v2: flat envelope becomes {seed, createdAt, lastSeenAt, meta}. */
function v1to2(d) {
  return {
    saveVersion: 2,
    seed: d.seed ?? 1,
    createdAt: d.savedAt ?? 0,
    lastSeenAt: d.savedAt ?? 0,
    settings: d.settings ?? {},
    meta: {
      crowns: d.treasury ?? 0,
      regions: d.regions ?? {},          // still status STRINGS at v2
      upgrades: d.upgrades ?? {},
      boosters: d.boosters ?? {},
      legacy: d.legacy ?? { points: 0, resets: 0 },
    },
  };
}

/** v2 -> v3: region statuses become records; stats appear; settings drop out
 *  of the persisted slice entirely (session state is rebuilt, never loaded). */
function v2to3(d) {
  const regions = {};
  for (const [id, val] of Object.entries(d.meta?.regions ?? {})) {
    regions[id] = typeof val === 'string'
      ? { status: val, clears: val === 'conquered' ? 1 : 0, bestMs: 0, raidReadyAt: 0 }
      : { status: 'locked', clears: 0, bestMs: 0, raidReadyAt: 0, ...val };
  }
  return {
    saveVersion: 3,
    seed: d.seed ?? 1,
    createdAt: d.createdAt ?? 0,
    lastSeenAt: d.lastSeenAt ?? d.createdAt ?? 0,
    meta: {
      crowns: d.meta?.crowns ?? 0,
      incomePerSec: 0,                   // recomputed on load; never trusted
      regions,
      upgrades: d.meta?.upgrades ?? {},
      boosters: d.meta?.boosters ?? {},
      stats: { ...createStats(), ...(d.meta?.stats ?? {}) },
      legacy: { points: 0, resets: 0, ...(d.meta?.legacy ?? {}) },
    },
  };
}

/** version -> migrate-to-next. Bump SAVE_VERSION and add an entry, together. */
export const MIGRATIONS = Object.freeze({ 1: v1to2, 2: v2to3 });

const versionOf = (d) => (Number.isInteger(d?.saveVersion) ? d.saveVersion
  : Number.isInteger(d?.version) ? d.version : null);

/**
 * Run the chain. Refuses rather than guessing.
 * @returns {{ok:boolean, data?:object, reason?:string, detail?:any, from?:number}}
 */
export function migrate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'not-an-object' };
  }
  let v = versionOf(input);
  if (v === null) return { ok: false, reason: 'no-version' };
  const from = v;
  // A save written by a NEWER build. We cannot know what it means, so we do not
  // touch it — the player's newer tab still has it.
  if (v > SAVE_VERSION) return { ok: false, reason: 'future-version', detail: v, from };
  if (v < 1) return { ok: false, reason: 'unknown-version', detail: v, from };

  let data = input;
  let guard = 0;
  while (v < SAVE_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) return { ok: false, reason: 'unknown-version', detail: v, from };
    let next;
    try { next = step(data); } catch (err) {
      return { ok: false, reason: 'migration-failed', detail: `${v}: ${err.message}`, from };
    }
    const nv = versionOf(next);
    if (!Number.isInteger(nv) || nv <= v) {
      return { ok: false, reason: 'migration-failed', detail: `${v} did not advance`, from };
    }
    data = next; v = nv;
    if (++guard > 64) return { ok: false, reason: 'migration-failed', detail: 'loop', from };
  }
  return { ok: true, data, from };
}

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

export const hasSave = (storage) => storage.getItem(SAVE_KEY) !== null;

/**
 * Write the persisted slice. Copies the current file to the backup slot FIRST,
 * so a half-written or rejected main slot is always recoverable.
 * Refuses to overwrite a save from a newer build.
 * @returns {{ok:boolean, reason:string, bytes?:number}}
 */
export function save(state, storage, { now = state?.lastSeenAt ?? 0, bus } = {}) {
  const existing = storage.getItem(SAVE_KEY);
  if (existing !== null) {
    const parsed = tryParse(existing);
    const v = parsed.ok ? versionOf(parsed.data) : null;
    if (Number.isInteger(v) && v > SAVE_VERSION) {
      emit(bus, META_EVENTS.SAVE_REFUSED, { reason: 'future-version', detail: v });
      return { ok: false, reason: 'future-version' };
    }
  }

  const payload = toPersisted(state);
  payload.saveVersion = SAVE_VERSION;
  payload.savedAt = now;
  const text = JSON.stringify(payload);

  if (existing !== null) storage.setItem(BACKUP_KEY, existing);
  if (!storage.setItem(SAVE_KEY, text)) {
    emit(bus, META_EVENTS.SAVE_REFUSED, { reason: 'write-failed' });
    return { ok: false, reason: 'write-failed' };
  }
  if (state?.session) state.session.dirty = false;
  emit(bus, META_EVENTS.SAVE_WRITTEN, { key: SAVE_KEY, bytes: text.length, backup: existing !== null });
  return { ok: true, reason: 'ok', bytes: text.length };
}

function tryParse(text) {
  try { return { ok: true, data: JSON.parse(text) }; } catch (err) {
    return { ok: false, error: err };
  }
}

/**
 * Read + migrate + hydrate. NEVER writes, NEVER deletes — a refusal leaves the
 * bytes exactly where they were and hands them back as `raw` so the UI can
 * offer "export my broken save" instead of "your progress is gone".
 * @returns {{ok:boolean, reason:string, state?:object, raw?:string, detail?:any, from?:number}}
 */
export function load(storage, { now = 0, bus, key = SAVE_KEY } = {}) {
  const raw = storage.getItem(key);
  if (raw === null || raw === '') return { ok: false, reason: 'empty' };

  const parsed = tryParse(raw);
  if (!parsed.ok) {
    emit(bus, META_EVENTS.SAVE_REFUSED, { reason: 'corrupt', detail: parsed.error.message });
    return { ok: false, reason: 'corrupt', raw, detail: parsed.error.message };
  }
  const migrated = migrate(parsed.data);
  if (!migrated.ok) {
    emit(bus, META_EVENTS.SAVE_REFUSED, { reason: migrated.reason, detail: migrated.detail });
    return { ...migrated, raw };
  }
  return {
    ok: true, reason: 'ok', raw, from: migrated.from,
    state: fromPersisted(migrated.data, { now }),
    migrated: migrated.from !== SAVE_VERSION,
  };
}

/** The backup slot, for a "restore previous save" button. */
export const loadBackup = (storage, io = {}) => load(storage, { ...io, key: BACKUP_KEY });

/**
 * The one call main.js needs on startup: load (or start fresh), heal derived
 * state, and grant capped offline income. On a REFUSAL it returns a fresh state
 * with `blocked: true` — the caller must then call autosaver.disable() so the
 * unreadable file is preserved rather than stamped on by an empty game.
 * @returns {{state:object, loaded:boolean, blocked:boolean, reason:string,
 *            offline:object|null, raw?:string, from?:number}}
 */
export function bootstrapGame(storage, { now = 0, seed = 1, bus, capMs } = {}) {
  const result = load(storage, { now, bus });
  if (!result.ok) {
    return {
      state: createState({ seed, now }),
      loaded: false,
      blocked: result.reason !== 'empty',
      reason: result.reason,
      raw: result.raw,
      offline: null,
    };
  }
  const state = result.state;
  refreshUnlocks(state.meta, bus);
  recalcIncome(state.meta, bus);
  const offline = applyOfflineProgress(state, now, capMs, bus);
  return { state, loaded: true, blocked: false, reason: 'ok', from: result.from, offline };
}

/** Explicit user action only. Nothing in the automatic path ever calls this. */
export function clearSave(storage, { bus, keepBackup = true } = {}) {
  const existing = storage.getItem(SAVE_KEY);
  if (existing !== null && keepBackup) storage.setItem(BACKUP_KEY, existing);
  storage.removeItem(SAVE_KEY);
  emit(bus, META_EVENTS.SAVE_CLEARED, { key: SAVE_KEY });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Export / import as base64
// ---------------------------------------------------------------------------

const toB64 = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const fromB64 = (b64) => {
  const bin = atob(String(b64).replace(/\s+/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

export function exportSave(state, { now = state?.lastSeenAt ?? 0 } = {}) {
  const payload = toPersisted(state);
  payload.saveVersion = SAVE_VERSION;
  payload.savedAt = now;
  return toB64(JSON.stringify(payload));
}

/** Import applies the same refusal rules as load(). It returns a state; it does
 *  NOT write, so the caller can show a confirmation before committing. */
export function importSave(b64, { now = 0 } = {}) {
  let text;
  try { text = fromB64(b64); } catch (err) {
    return { ok: false, reason: 'corrupt', detail: err.message };
  }
  const parsed = tryParse(text);
  if (!parsed.ok) return { ok: false, reason: 'corrupt', detail: parsed.error.message };
  const migrated = migrate(parsed.data);
  if (!migrated.ok) return migrated;
  return { ok: true, reason: 'ok', state: fromPersisted(migrated.data, { now }), from: migrated.from };
}

// ---------------------------------------------------------------------------
// Autosave
// ---------------------------------------------------------------------------

/**
 * Every 5s while dirty, plus flush() on hide / unload.
 *
 * NO LISTENER IS SUBSCRIBED HERE, and no browser global is named in this file
 * at all — that is a mechanical guarantee, asserted in tests/save.test.js.
 * main.js owns the wiring: subscribe to the visibilitychange and beforeunload
 * events and call `autosaver.flush(state, clock())` from both.
 *
 * `disable()` exists so a refused load can lock writes and guarantee the
 * unreadable file on disk is never stamped on by a fresh empty game.
 */
export function createAutosaver({ storage, intervalMs = AUTOSAVE_MS, bus } = {}) {
  let nextAt = null;
  let enabled = true;
  let disabledReason = '';

  return {
    get enabled() { return enabled; },
    get reason() { return disabledReason; },
    disable(reason = 'locked') { enabled = false; disabledReason = reason; },
    enable() { enabled = true; disabledReason = ''; },

    /** Call from the frame loop with wall-clock ms. Writes at most every 5s,
     *  and only when something actually changed. */
    update(state, now) {
      if (!enabled) return { ok: false, reason: disabledReason };
      if (nextAt === null) { nextAt = now + intervalMs; return { ok: false, reason: 'scheduled' }; }
      if (now < nextAt) return { ok: false, reason: 'waiting' };
      nextAt = now + intervalMs;
      if (!state?.session?.dirty) return { ok: false, reason: 'clean' };
      return save(state, storage, { now, bus });
    },

    /** Unconditional write. Used on hide/unload, where "clean" is not worth the risk. */
    flush(state, now) {
      if (!enabled) return { ok: false, reason: disabledReason };
      nextAt = now + intervalMs;
      return save(state, storage, { now, bus });
    },
  };
}
