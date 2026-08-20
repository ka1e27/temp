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
import { UNIT_IDS } from '../content/balance.js';
import { refundRetired } from './refund.js';
import {
  RETIRED_UPGRADES, UPGRADE_BY_ID, BOOSTER_SHOP, SAFE_MAX_LEVEL,
} from '../content/upgrades.data.js';

/** The ids a save is allowed to carry a level for. Anything else is dropped on
 *  load — see `sanitizeLevels`. Retired ids are included because
 *  `refundRetired` still has to find them in order to pay them back. */
const KNOWN_UPGRADES = new Set([
  ...Object.keys(UPGRADE_BY_ID), ...Object.keys(RETIRED_UPGRADES),
]);
const KNOWN_BOOSTERS = new Set(Object.keys(BOOSTER_SHOP));

/** Ceilings for the two counters that feed exponentials. Both are far past
 *  anything reachable: a raid is unwinnable long before 500 clears, and the
 *  incursion ladder walls out in the tens. */
const MAX_CLEARS = 500;
const MAX_DEPTH = 100000;
/** ...and for a saved loadout, which is a slot budget the screen re-fits anyway.
 *  Uncapped, `carryComposition` had to walk a count down one body at a time. */
const MAX_LOADOUT = 100000;

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
    /** Rungs of the endless ladder cleared, ever — including across abdications,
     *  which is why it lives in stats rather than in `incursion` below. */
    incursions: 0,
    unitsLost: 0,
    unitsKilled: 0,
    crownsEarned: 0,
    crownsSpent: 0,
    relicsEarned: 0,
    relicsSpent: 0,
    offlineMsClaimed: 0,
    playMs: 0,
  };
}

/**
 * PLAYER PREFERENCES, as opposed to progress.
 *
 * Settings were dropped from the persisted slice at v3 as "session state,
 * rebuilt, never loaded" — which was right for the transient flags that lived
 * there then, and wrong for these. A default rally hold-back is not session
 * state: forgetting it means re-setting the same number on every site of every
 * region, forever, which is the papercut it exists to remove.
 *
 * They live INSIDE `meta` rather than at the root deliberately. `fromPersisted`
 * heals missing meta fields from these defaults, so this needed no migration and
 * no SAVE_VERSION bump — and a save written before settings existed simply picks
 * up the defaults, which are the values the game already behaved as.
 */
export function createSettings() {
  return {
    /** Troops every site holds back when rallying, unless changed in battle.
     *  RALLY_KEEP.default is 8; content owns the number, this owns the choice. */
    rallyKeepDefault: null,
    /** Battle speed a new battle opens at. null means 1x. */
    defaultSpeed: null,
    /** Sound. `null` reads as on; `false` is a deliberate mute. Lives in meta
     *  with the other preferences, so `fromPersisted` heals it and no migration
     *  was needed — and it survives a new campaign, because it is the player's
     *  and not the save's. */
    sound: null,
    volume: null,
  };
}

/** The persistent half of the game. This is the only thing the shop can spend. */
export function createMeta() {
  return {
    crowns: 0,
    /**
     * RELICS — the hard currency, and the only one that does not tick.
     *
     * Crowns accrue per second, which is the idle half of this game and also
     * why they cannot price anything that must stay scarce: waiting is always an
     * answer. Relics are paid only for ground you have BEATEN — a region's first
     * clear pays its tier, a rung pays with depth, a raid pays nothing (see
     * meta/rewards.js) — and they buy booster charges and the per-troop lines.
     * They survive abdication, for the reason the ladder does.
     */
    relics: 0,
    /** Cached derived value; meta/idle.js is the only writer. */
    incomePerSec: 0,
    regions: createRegionTable(),
    /** upgradeId -> level (absent === level 0). */
    upgrades: {},
    /** boosterId -> charges owned. */
    boosters: {},
    /**
     * The expedition the player last launched with, carried into the next
     * pre-battle screen. `null` until they have chosen once, which is what makes
     * a first-time player get the default spread instead of an empty army.
     * A standing preference, so it belongs to meta and NOT to battle state.
     */
    loadout: null,
    stats: createStats(),
    /** Coach marks run once, in region 1 only, and never replay after this. */
    tutorialSeen: false,
    /** Preferences, not progress. See createSettings above. */
    settings: createSettings(),
    /**
     * PRESTIGE. This was reserved here, unread, "so prestige can land later with
     * no migration" — and that is exactly what happened: meta/legacy.js writes
     * both fields and nothing about the persisted shape had to change.
     *
     * `points` are permanent and are never spent (they are a multiplier, not a
     * currency — see meta/legacy.js); `resets` is how many runs have been ended.
     */
    legacy: { points: 0, resets: 0 },
    /**
     * THE ENDLESS LADDER. `cleared` is the deepest rung won and the only source
     * of truth — the rung in front of the player is `cleared + 1`, derived rather
     * than stored, so the two can never disagree (meta/incursion.js).
     *
     * SURVIVES ABDICATION, deliberately: the ladder is a record of what the
     * player has beaten, not a possession of one run. It is also what makes a
     * second run worth starting, because `legacy.points` are paid partly for it.
     */
    incursion: { cleared: 0, attempts: 0 },
    /** THE FRONTIER (endless mode) — a RECORD, not a board. Nothing about the
     *  map is stored: it is a pure function of its seed, the way a rung is of
     *  its depth. `bestRing` is the one number that pays, since relics are
     *  granted only for beating it — which is what makes the hard currency
     *  non-farmable here by construction rather than by a cooldown. */
    frontier: { bestRing: 0, runs: 0 },
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
  // Absent in every save written before relics existed, which is exactly what
  // `num`'s default is for — an old save opens with none and earns them from
  // the next battle, rather than needing a migration.
  meta.relics = Math.max(0, Math.floor(num(m.relics, 0)));
  // NOT RESTORED — healed to 0, which is what makes "meta.incomePerSec has
  // exactly one writer: meta/idle.js recalcIncome" a true sentence rather than a
  // comment three files repeat while a fourth quietly contradicts it (see also
  // meta/save.js's own `incomePerSec: 0, // recomputed on load; never trusted`
  // in the v2->v3 migration, which already does exactly this).
  //
  // It is a CACHE of a pure function of `regions` and `upgrades`, so the value on
  // disk carries no information the rest of this function has not already
  // rebuilt — and trusting it means a save hand-edited (or written by an older
  // build with a different upgrade table) displays a rate the game will never pay.
  // No money is at stake either way: every route that loads a save recalculates
  // immediately — `bootstrapGame` before it grants offline income, and
  // `adoptCampaign` before the menu redraws — so the only exposure was display,
  // for the few milliseconds in between. Zero is the honest reading of "unknown
  // until somebody computes it".
  meta.incomePerSec = 0;
  meta.upgrades = sanitizeLevels(m.upgrades, KNOWN_UPGRADES);
  // ...and hand back the crowns for anything that no longer exists.
  meta.crowns += refundRetired(meta.upgrades);
  meta.boosters = sanitizeLevels(m.boosters, KNOWN_BOOSTERS);
  meta.loadout = sanitizeComposition(m.loadout);
  // STATS WERE THE ONE FIELD WITH NO HEALING — a bare spread. `{"playMs":"0"}`
  // turned `stats.playMs += dtMs` into string concatenation at 10 Hz, growing the
  // save without bound until the write failed (silently, see meta/save.js). Every
  // counter is a number or it is the default.
  meta.stats = createStats();
  for (const [k, v] of Object.entries(m.stats ?? {})) {
    if (k in meta.stats) meta.stats[k] = Math.max(0, num(v, 0));
  }
  // Absent on saves written before onboarding existed: those players have
  // already learned the game, so defaulting to "seen" would be wrong only for
  // a brand-new save, which gets this from createMeta() instead.
  meta.tutorialSeen = m.tutorialSeen === true;
  meta.settings = sanitizeSettings(m.settings, createSettings());
  // Both healed rather than trusted, and both non-negative integers: they are
  // multipliers and ladder rungs, and a hand-edited save that made either
  // fractional or negative would produce a permanent negative bonus.
  meta.legacy = {
    points: counter(m.legacy?.points, MAX_DEPTH),
    resets: counter(m.legacy?.resets, MAX_DEPTH),
  };
  meta.incursion = {
    cleared: counter(m.incursion?.cleared, MAX_DEPTH),
    attempts: counter(m.incursion?.attempts, MAX_DEPTH),
  };
  // Same reason: `bestRing` is what relics are paid against.
  meta.frontier = {
    bestRing: counter(m.frontier?.bestRing, MAX_DEPTH),
    runs: counter(m.frontier?.runs, MAX_DEPTH),
  };

  for (const [id, rec] of Object.entries(m.regions ?? {})) {
    // `Object.hasOwn`, NOT truthiness. `meta.regions` is a plain object, so
    // `meta.regions.constructor` is `Object` — truthy — and eleven
    // Object.prototype names therefore walked straight past this guard and became
    // real, fully-validated region records. Nothing downstream crashed, but
    // `abdicationValue` counts `Object.values(meta.regions)` while
    // `regionsConquered` counts REGION_IDS, so a save carrying
    // `{"constructor":{"status":"conquered"}}` paid legacy for regions that do
    // not exist — permanently, because legacy is never spent.
    if (!Object.hasOwn(meta.regions, id)) continue;
    meta.regions[id] = {
      status: ['locked', 'available', 'conquered'].includes(rec?.status) ? rec.status : 'locked',
      clears: counter(rec?.clears, MAX_CLEARS),
      bestMs: Math.max(0, num(rec?.bestMs, 0)),
      raidReadyAt: Math.max(0, num(rec?.raidReadyAt, 0)),
    };
  }
  return base;
}

// Split to ./refund.js for the line budget; re-exported so `fromPersisted`
// above still reads as one story and every existing import keeps working.
export { refundRetired };
// The healing rules moved to ./sanitize.js at the 400-line cap and are
// re-exported here, the same arrangement ./refund.js has, so every existing
// `import { ... } from '../core/store.js'` keeps resolving.
import {
  num, counter, sanitizeComposition, sanitizeSettings, sanitizeLevels,
} from './sanitize.js';

export { num, counter, sanitizeComposition, sanitizeSettings, sanitizeLevels };

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
