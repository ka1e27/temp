// Rival leader voices (DESIGN §3.6). Pure: no DOM, no Date.now, no Math.random, no storage.
// Time is always passed in (real-time seconds from one monotonic clock), randomness is seeded.
//
// The pieces
//   leaderFor(seed, dynasty, faction)      the seeded leader: title + name (new per dynasty)
//   pickLine(faction, trigger, rngState)   a seeded line, no immediate repeats, {name}/{region} filled
//   createVoiceGate(config)                when may a line be shown (tutorial, gap, once per trigger, setting)
//   createLeaderVoice({ getState })        the three above wired together: say(trigger, ctx) -> line | null
//   newContacts / markMet / seedContacts   "first contact" bookkeeping stored in state.metFactions
//
// See docs/briefs/crowns-leaders-hookup.md for every trigger point.

import { createRng, hash32 } from '../core/rng.js';
import { LEADERS, LEADER_LINES, LEADER_FACTIONS, LEADER_TRIGGERS, VOICE } from '../config/leaders.js';
import { PLAYER_FACTION } from './state.js';
import { frontier } from './progression.js';

/**
 * @typedef {Object} Leader
 * @property {number} faction   faction id (1 Free Folk, 2 Crimson, 3 Violet, 4 Amber)
 * @property {string} title     'Reeve' | 'Warlord' | 'High Seer' | 'Khan'
 * @property {string} name      e.g. 'Korash'
 * @property {string} fullName  title + name, e.g. 'Warlord Korash'
 *
 * @typedef {Object} VoiceRng   plain JSON; pickLine mutates it
 * @property {number} seed
 * @property {number} draws
 * @property {Object<string, number>} last  last line index per `${faction}:${trigger}`
 *
 * @typedef {Object} SpokenLine
 * @property {string} trigger
 * @property {number} faction
 * @property {string} name
 * @property {string} title
 * @property {string} fullName
 * @property {string} line
 */

// --- Leaders ------------------------------------------------------------------------

/** True for factions that have a leader (everyone but the player). */
export function hasLeader(faction) {
  return LEADER_FACTIONS.includes(faction);
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const VOWELS = 'aeiouy';
const isVowel = (ch) => VOWELS.includes(ch.toLowerCase());

/** True when two syllable parts meet cleanly: never vowel+vowel (Seliiah, Branooth). */
function seamOk(left, right) {
  return !(isVowel(left.charAt(left.length - 1)) && isVowel(right.charAt(0)));
}

/** Rejects names that read badly (repeated syllables, aaa) or come out too short/long. */
function nameLooksFine(name, onset, coda) {
  if (name.length < 4 || name.length > 9) return false;
  if (/(.)\1\1/.test(name)) return false;
  return !onset.toLowerCase().includes(coda.slice(0, 3).toLowerCase());
}

/** One seeded attempt at a name, or null when its syllables meet badly. */
function rawName(cfg, seed, dynasty, faction, attempt) {
  const rng = createRng(hash32('leader-name', seed, dynasty, faction, attempt));
  const onset = rng.pick(cfg.onset);
  const mid = rng.chance(1 / 3) ? rng.pick(cfg.mid) : '';
  const coda = rng.pick(cfg.coda);
  const parts = mid ? [onset, mid, coda] : [onset, coda];
  for (let i = 1; i < parts.length; i++) if (!seamOk(parts[i - 1], parts[i])) return null;
  const name = capitalize(parts.join(''));
  return nameLooksFine(name, onset, coda) ? name : null;
}

function seededName(cfg, seed, dynasty, faction, avoid) {
  for (let attempt = 0; attempt < 256; attempt++) {
    const name = rawName(cfg, seed, dynasty, faction, attempt);
    if (name && name !== avoid) return name;
  }
  return capitalize(cfg.onset[0] + cfg.coda[0]);
}

/**
 * The leader of a faction for this continent and dynasty. Title is fixed per faction; the name is
 * seeded from the faction's syllable tables and differs from the previous dynasty's name for the
 * same seed. There is no leader for the player realm (faction 0): returns null.
 * @param {number} seed     world seed of the current dynasty (state.seed)
 * @param {number} dynasty  dynasty level, 1-based (state.dynasty.level)
 * @param {number} faction  faction id
 * @returns {Leader|null}
 */
export function leaderFor(seed, dynasty, faction) {
  if (!hasLeader(faction)) return null;
  const cfg = LEADERS[faction];
  const level = Math.max(1, Math.floor(dynasty) || 1);
  const previous = level > 1 ? seededName(cfg, seed, level - 1, faction, null) : null;
  const name = seededName(cfg, seed, level, faction, previous);
  return { faction, title: cfg.title, name, fullName: `${cfg.title} ${name}` };
}

// --- Lines ----------------------------------------------------------------------------

/** @returns {VoiceRng} */
export function createVoiceRng(seed = 1) {
  return { seed: seed >>> 0, draws: 0, last: {} };
}

const PLACEHOLDER = /\{(\w+)\}/g;

/** The `{placeholders}` a template uses. */
function placeholdersOf(template) {
  return [...template.matchAll(PLACEHOLDER)].map((m) => m[1]);
}

/**
 * @param {string} template
 * @param {{ name?: string, region?: string }} vars
 */
export function renderLine(template, vars = {}) {
  return template.replace(PLACEHOLDER, (whole, key) => (vars[key] != null ? String(vars[key]) : whole));
}

/**
 * A line for this faction and trigger. Seeded (`rngState.seed`, plus how many lines were drawn so
 * far), never the same line twice in a row for a given faction+trigger, and only from lines whose
 * placeholders the caller supplied.
 * MUTATES `rngState` (draw counter, last-picked index).
 * @param {number} faction
 * @param {string} trigger  one of LEADER_TRIGGERS
 * @param {VoiceRng} rngState
 * @param {{ name?: string, region?: string }} [vars]  `{name}` = the speaker's own name, `{region}` = the region in play
 * @returns {string|null} null when the faction has no line for it
 */
export function pickLine(faction, trigger, rngState, vars = {}) {
  const pool = LEADER_LINES[faction] && LEADER_LINES[faction][trigger];
  if (!pool || pool.length === 0) return null;
  const eligible = [];
  pool.forEach((tpl, i) => {
    if (placeholdersOf(tpl).every((key) => vars[key] != null && vars[key] !== '')) eligible.push(i);
  });
  if (eligible.length === 0) return null;

  const memoKey = `${faction}:${trigger}`;
  const last = rngState.last[memoKey];
  const candidates = eligible.length > 1 ? eligible.filter((i) => i !== last) : eligible;
  const rng = createRng(hash32('leader-line', rngState.seed, faction, trigger, rngState.draws));
  const index = candidates[Math.floor(rng.next() * candidates.length)];
  rngState.draws += 1;
  rngState.last[memoKey] = index;
  return renderLine(pool[index], vars);
}

// --- The gate ----------------------------------------------------------------------------

/**
 * @typedef {Object} GateContext
 * @property {number} nowSec               monotonic REAL-time seconds (not battle time: it must run
 *                                         on the world map too and ignore 2x/3x/pause)
 * @property {boolean} [enabled=true]      settings.leaderVoices
 * @property {boolean} [tutorialVisible=false]  a coach hint is on screen
 * @property {string|number} [scope='']    finer dedupe key: one line per (trigger, scope) per battle
 *
 * @typedef {'disabled'|'tutorial'|'repeat'|'gap'} GateReason
 */

/**
 * A pure gate deciding whether a leader line may be shown now. Rules, checked in this order:
 * setting off -> 'disabled'; a tutorial hint visible -> 'tutorial'; this trigger (and scope)
 * already spoke this battle -> 'repeat'; a line spoke less than `minGapSec` ago -> 'gap'.
 * The gap clock survives `resetBattle()` (so back-to-back battles cannot spam); the per-trigger
 * memory does not.
 * @param {{ minGapSec?: number, gapExempt?: string[] }} [config]  `gapExempt`: triggers that skip the
 *   gap check (default VOICE.gapExempt, empty)
 */
export function createVoiceGate(config = {}) {
  const minGapSec = config.minGapSec != null ? config.minGapSec : VOICE.minGapSec;
  const gapExempt = new Set(config.gapExempt || VOICE.gapExempt || []);
  /** @type {{ lastAt: number|null, spoken: Object<string, number> }} plain JSON */
  const state = { lastAt: null, spoken: {} };
  const keyOf = (trigger, scope) => (scope === '' || scope == null ? trigger : `${trigger}|${scope}`);

  /**
   * Pure query.
   * @param {string} trigger
   * @param {GateContext} ctx
   * @returns {{ ok: boolean, reason: GateReason|null }}
   */
  function check(trigger, ctx) {
    const { nowSec, enabled = true, tutorialVisible = false, scope = '' } = ctx;
    if (!enabled) return { ok: false, reason: 'disabled' };
    if (tutorialVisible) return { ok: false, reason: 'tutorial' };
    if (state.spoken[keyOf(trigger, scope)] !== undefined) return { ok: false, reason: 'repeat' };
    // A clock that jumped backwards (page restored from the cache) counts as "long ago".
    if (!gapExempt.has(trigger) && state.lastAt !== null && nowSec >= state.lastAt && nowSec - state.lastAt < minGapSec) {
      return { ok: false, reason: 'gap' };
    }
    return { ok: true, reason: null };
  }

  /** Records that a line for `trigger` was shown at `nowSec`. */
  function commit(trigger, nowSec, scope = '') {
    state.spoken[keyOf(trigger, scope)] = nowSec;
    state.lastAt = nowSec;
  }

  /** check + commit. @returns {boolean} true when the line may be shown (and is now recorded) */
  function request(trigger, ctx) {
    const verdict = check(trigger, ctx);
    if (verdict.ok) commit(trigger, ctx.nowSec, ctx.scope);
    return verdict.ok;
  }

  /** New battle: every trigger may speak again. Keeps the gap clock. */
  function resetBattle() {
    state.spoken = {};
  }

  /** Forget everything, gap clock included (new dynasty, tests). */
  function reset() {
    state.spoken = {};
    state.lastAt = null;
  }

  return { check, commit, request, resetBattle, reset, state, minGapSec };
}

// --- Gate + leader + line in one object -----------------------------------------------------

/**
 * The convenience the game actually uses: pass the state getter once, then `say(trigger, ctx)`
 * returns the finished line (and records it) or null when the gate says no.
 * @param {{ getState: () => import('./state.js').GameState, minGapSec?: number, gapExempt?: string[] }} deps
 */
export function createLeaderVoice({ getState, minGapSec, gapExempt }) {
  const gate = createVoiceGate({ minGapSec, gapExempt });
  const rng = createVoiceRng(0);
  let rngKey = '';

  function syncRng(state) {
    const key = `${state.seed}:${state.dynasty.level}`;
    if (key === rngKey) return;
    rngKey = key;
    rng.seed = hash32('voice', state.seed, state.dynasty.level);
  }

  /**
   * @param {string} trigger  one of LEADER_TRIGGERS
   * @param {{ faction: number, region?: string, nowSec: number, tutorialVisible?: boolean,
   *           scope?: string|number }} ctx  `faction` = the speaker's faction (see the speaker table
   *           in config/leaders.js); `region` = name of the region in play, for `{region}`
   * @returns {SpokenLine|null}
   */
  function say(trigger, ctx) {
    if (!hasLeader(ctx.faction)) return null;
    const state = getState();
    const verdict = gate.check(trigger, {
      nowSec: ctx.nowSec,
      enabled: state.settings.leaderVoices !== false,
      tutorialVisible: !!ctx.tutorialVisible,
      scope: ctx.scope,
    });
    if (!verdict.ok) return null;
    syncRng(state);
    const leader = leaderFor(state.seed, state.dynasty.level, ctx.faction);
    const line = pickLine(ctx.faction, trigger, rng, { name: leader.name, region: ctx.region });
    if (!line) return null;
    gate.commit(trigger, ctx.nowSec, ctx.scope);
    return { trigger, faction: ctx.faction, name: leader.name, title: leader.title, fullName: leader.fullName, line };
  }

  /**
   * Would `say` speak right now? No side effects (for "should I even compute this?" checks).
   * @returns {{ ok: boolean, reason: GateReason|null }}
   */
  function canSay(trigger, ctx) {
    const state = getState();
    return gate.check(trigger, {
      nowSec: ctx.nowSec,
      enabled: state.settings.leaderVoices !== false,
      tutorialVisible: !!ctx.tutorialVisible,
      scope: ctx.scope,
    });
  }

  return { say, canSay, gate, resetBattle: gate.resetBattle, reset: gate.reset };
}

// --- First contact -----------------------------------------------------------------------------

/**
 * Factions with a leader that own a region on your current frontier and have not made first
 * contact yet this dynasty. One entry per faction, naming its lowest-tier frontier region. Pure.
 * Call `markMet` only once the line was actually shown, so a contact blocked by the gate (tutorial
 * hint, 15 s gap) stays pending and is offered again next time.
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @returns {Array<{ faction: number, regionId: number }>}
 */
export function newContacts(state, world) {
  const met = new Set(state.metFactions || []);
  const best = new Map();
  for (const id of frontier(state, world)) {
    const region = world.regions[id];
    const f = state.owner[id];
    if (f === PLAYER_FACTION || !hasLeader(f) || met.has(f)) continue;
    const cur = best.get(f);
    if (!cur || region.tier < world.regions[cur].tier || (region.tier === world.regions[cur].tier && id < cur)) best.set(f, id);
  }
  return [...best.entries()]
    .map(([faction, regionId]) => ({ faction, regionId }))
    .sort((a, b) => world.regions[a.regionId].tier - world.regions[b.regionId].tier || a.faction - b.faction);
}

/**
 * MUTATES state.metFactions.
 * @param {import('./state.js').GameState} state
 * @param {number} faction
 * @returns {boolean} true if this faction was newly marked
 */
export function markMet(state, faction) {
  if (!Array.isArray(state.metFactions)) state.metFactions = [];
  if (state.metFactions.includes(faction)) return false;
  state.metFactions.push(faction);
  return true;
}

/**
 * Silently marks every current contact as already met (your starting neighbours are not a
 * "first contact"). Call right after createGame / a new dynasty's resetRegions.
 * @returns {number[]} the faction ids marked
 */
export function seedContacts(state, world) {
  const marked = [];
  for (const { faction } of newContacts(state, world)) {
    markMet(state, faction);
    marked.push(faction);
  }
  return marked;
}

export { LEADER_TRIGGERS, LEADER_FACTIONS };
