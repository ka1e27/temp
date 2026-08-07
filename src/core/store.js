// The single root GameState.
//
// ONE root object, domain-partitioned, with strict write ownership:
//
//   root.meta      <- meta/*   (crowns, regions, upgrades, boosters, stats)
//   root.battle    <- battle/* (the live sim; meta NEVER reads or writes it)
//   root.session   <- screens/ + main.js (which scene is up, transient UI flags)
//   root.seed / createdAt / lastSeenAt / saveVersion  <- meta/save.js
//
// Only the PERSISTED slice is written to disk. `battle` is a mid-battle
// snapshot concern (owned elsewhere) and `session` is pure UI state — both are
// rebuilt from scratch on load, so no migration ever has to understand them.
//
// PURE: no Date.now, no localStorage, no DOM. `now` is injected everywhere.

import { REGIONS } from '../content/regions.data.js';

/**
 * Version of the PERSISTED SHAPE. It lives here rather than in meta/save.js
 * because the store owns the shape and save.js only owns the bytes — and
 * because importing it the other way would make store <-> save a cycle.
 * Bump this ONLY together with a new entry in save.js MIGRATIONS.
 */
export const SAVE_VERSION = 3;

/** Root fields that are written to the save file. Everything else is ephemeral. */
export const PERSISTED_KEYS = Object.freeze([
  'saveVersion', 'seed', 'createdAt', 'lastSeenAt', 'meta',
]);

/** Region progress record. `status` is owned by meta/world.js. */
export function createRegionRecord(status = 'locked') {
  return { status, clears: 0, bestMs: 0, raidReadyAt: 0 };
}

/** Every region present from the start keeps the save shape stable as content grows. */
export function createRegionTable() {
  const out = {};
  for (const r of REGIONS) out[r.id] = createRegionRecord(r.startsUnlocked ? 'available' : 'locked');
  return out;
}

export function createStats() {
  return {
    battles: 0,
    wins: 0,
    losses: 0,
    raids: 0,
    unitsLost: 0,
    unitsKilled: 0,
    crownsEarned: 0,
    crownsSpent: 0,
    offlineMsClaimed: 0,
    playMs: 0,
  };
}

/** The persistent half of the game. This is the only thing the shop can spend. */
export function createMeta() {
  return {
    crowns: 0,
    /** Cached derived value; meta/idle.js is the only writer. */
    incomePerSec: 0,
    regions: createRegionTable(),
    /** upgradeId -> level (absent === level 0). */
    upgrades: {},
    /** boosterId -> charges owned. */
    boosters: {},
    stats: createStats(),
    /** Coach marks run once, in region 1 only, and never replay after this. */
    tutorialSeen: false,
    /** Reserved so prestige can land later with no migration. */
    legacy: { points: 0, resets: 0 },
  };
}

/** Ephemeral shell state. Never saved — rebuilt on every load. */
export function createSession() {
  return {
    sceneId: null,
    /** BattleConfig handed to battle/ by screens/battle.js, then cleared. */
    pendingConfig: null,
    /** Last BattleOutcome, kept for the results screen. */
    lastOutcome: null,
    speed: 1,
    dev: false,
    /** The boot decision (menu, or straight into region 1) is taken exactly
     *  once per session, by whichever of mainmenu/worldmap main.js opens with. */
    booted: false,
    /** Set by any meta mutation; meta/save.js clears it after a successful write. */
    dirty: false,
  };
}

/**
 * @param {object} io
 * @param {number} io.seed   integer world seed (injected; use core/rng.js)
 * @param {number} io.now    epoch ms (injected; the clock is never read here)
 */
export function createState({ seed = 1, now = 0 } = {}) {
  return {
    saveVersion: SAVE_VERSION,
    seed: seed >>> 0,
    createdAt: now,
    lastSeenAt: now,
    meta: createMeta(),
    battle: null,
    session: createSession(),
  };
}

/** Extract exactly the persisted slice. Deep-cloned so a later mutation of the
 *  live state can never retroactively change bytes we already wrote. */
export function toPersisted(state) {
  const out = {};
  for (const k of PERSISTED_KEYS) out[k] = state[k];
  return JSON.parse(JSON.stringify(out));
}

/**
 * Rebuild a live root state from a persisted slice. Missing fields are healed
 * from defaults, so adding a field to `meta` never needs a migration — only a
 * change in MEANING does.
 */
export function fromPersisted(data, { now = 0 } = {}) {
  const base = createState({ seed: data?.seed ?? 1, now });
  if (!data || typeof data !== 'object') return base;

  base.saveVersion = data.saveVersion ?? base.saveVersion;
  base.createdAt = num(data.createdAt, now);
  base.lastSeenAt = num(data.lastSeenAt, now);

  const m = data.meta ?? {};
  const meta = base.meta;
  meta.crowns = Math.max(0, num(m.crowns, 0));
  meta.incomePerSec = Math.max(0, num(m.incomePerSec, 0));
  meta.upgrades = sanitizeLevels(m.upgrades);
  meta.boosters = sanitizeLevels(m.boosters);
  meta.stats = { ...createStats(), ...(m.stats ?? {}) };
  // Absent on saves written before onboarding existed: those players have
  // already learned the game, so defaulting to "seen" would be wrong only for
  // a brand-new save, which gets this from createMeta() instead.
  meta.tutorialSeen = m.tutorialSeen === true;
  meta.legacy = { points: 0, resets: 0, ...(m.legacy ?? {}) };

  for (const [id, rec] of Object.entries(m.regions ?? {})) {
    if (!meta.regions[id]) continue; // region deleted from content: drop, don't crash
    meta.regions[id] = {
      status: ['locked', 'available', 'conquered'].includes(rec?.status) ? rec.status : 'locked',
      clears: Math.max(0, Math.floor(num(rec?.clears, 0))),
      bestMs: Math.max(0, num(rec?.bestMs, 0)),
      raidReadyAt: Math.max(0, num(rec?.raidReadyAt, 0)),
    };
  }
  return base;
}

const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function sanitizeLevels(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    const n = Math.floor(num(v, 0));
    if (n > 0) out[k] = n;
  }
  return out;
}

/**
 * Accept either the root state or the `meta` slice. Every meta/** entry point
 * runs its argument through this, so passing the wrong one is impossible rather
 * than silently returning zeros.
 */
export function metaOf(x) {
  if (x && x.meta && typeof x.meta === 'object' && x.meta.regions) return x.meta;
  return x;
}

/** Mark the persistent half changed. Every meta mutation funnels through here
 *  so autosave never has to diff the tree. */
export function markDirty(state) {
  if (state?.session) state.session.dirty = true;
  return state;
}
