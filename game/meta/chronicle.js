// The Chronicle (DESIGN §5.9): a running history of the realm, kept as short dated entries and rendered as story lines.
// Pure: no DOM, no Date.now, no Math.random, no storage. Time is always passed in (ms timestamps), so a dated line is
// reproducible. Balance-neutral: nothing here reads or changes gold, battles or upgrades.
//
//   state.chronicle = {
//     v: 1,
//     startedAt: ms|null,         // when the CURRENT dynasty began: the origin of its "Year"
//     entries: Entry[],           // this dynasty's chapter, oldest first, at most CHRONICLE.maxEntries
//     lifetime: Entry[],          // highlights carried across dynasties, oldest first, at most CHRONICLE.maxHighlights
//     seen: { [kind]: true },     // kinds that ever happened (lifetime): makes "the first ever" a highlight
//     firsts: { [flag]: true },   // what already happened THIS dynasty (first conquest, first triple crown, ...)
//     bestSec: number|null,       // fastest battle ever (lifetime): the "new fastest battle" record
//     streak: number,             // consecutive triple-crown victories this dynasty
//     conquests: number,          // regions taken this dynasty (for the closing summary)
//   }
//   Entry = { kind, t, y, d, hl, data }   t ms; y = the dynasty-relative Year; d = the dynasty number; hl = also a lifetime highlight
//
// The "Year" of an entry is real days since its dynasty began, starting at Year 1 (see config/chronicle.js `dayMs`). Names are
// stored IN the entry (`data.region`, `data.leader`, `data.faction`) when it is recorded, so a highlight from a dynasty long
// gone still names the right rival even though the leaders are re-seeded every dynasty.
//
// The integration layer calls three helpers at the right moments (docs/briefs/keepsakes-hookup.md):
//   chronicleOnConquest(state, world, regionId, { crowns, battleSec, surrender, decapitated, t })   right after conquer()
//   chronicleOnProsperity(state, world, levelUps, { t })                                           with updateProsperity's result
//   chronicleOnDynasty(state, world, { t })                                                        right after the new dynasty exists
import { CHRONICLE } from '../config/chronicle.js';
import { PROSPERITY } from '../config/prosperity.js';
import { hash32 } from '../core/rng.js';
import { PLAYER_FACTION } from './state.js';
import { leaderFor, hasLeader } from './leaders.js';

import { finite, cleanData } from './chronicleState.js';

export { createChronicle, sanitizeChronicle, ensureChronicle, chronicleEntries, lifetimeHighlights } from './chronicleState.js';
import { ensureChronicle, chronicleEntries, lifetimeHighlights } from './chronicleState.js';


// --- recording ----------------------------------------------------------------------------------

function yearOf(c, t) {
  if (c.startedAt == null) c.startedAt = t;
  return Math.max(1, Math.floor((t - c.startedAt) / CHRONICLE.dayMs) + 1);
}

function isMinor(kind) {
  const k = CHRONICLE.kinds[kind];
  return !!(k && k.minor);
}

/** Drops the oldest minor entry that is not a highlight, else the oldest plain one, else the oldest. */
function evictChapter(list, cap) {
  while (list.length > cap) {
    let idx = list.findIndex((e) => isMinor(e.kind) && !e.hl);
    if (idx < 0) idx = list.findIndex((e) => !e.hl);
    if (idx < 0) idx = 0;
    list.splice(idx, 1);
  }
}

function evictLifetime(list, cap) {
  while (list.length > cap) {
    let idx = list.findIndex((e) => isMinor(e.kind));
    if (idx < 0) idx = 0;
    list.splice(idx, 1);
  }
}

/** Oldest first. An entry dated earlier than the last one (a level reached while the game was closed) slots into place; equal times keep their order. */
function insertByTime(list, entry) {
  let i = list.length;
  while (i > 0 && list[i - 1].t > entry.t) i -= 1;
  list.splice(i, 0, entry);
}

/**
 * Adds one entry to this dynasty's chapter (and to the lifetime highlights when it qualifies). MUTATES `state.chronicle`.
 * `entry.data` is kept flat (strings, numbers, booleans). A caller may add its own line with `data.text`. Returns the stored
 * entry, or null when `entry` has no kind or no finite `t`.
 * @param {{ dynasty?: { level: number }, chronicle?: unknown }} state
 * @param {{ kind: string, t: number, data?: object, hl?: boolean }} entry
 * @returns {ChronicleEntry|null}
 */
export function recordChronicle(state, entry) {
  if (!entry || typeof entry.kind !== 'string' || !entry.kind || !finite(entry.t)) return null;
  const c = ensureChronicle(state);
  const rule = CHRONICLE.kinds[entry.kind] ? CHRONICLE.kinds[entry.kind].highlight : false;
  const hl = entry.hl != null ? !!entry.hl : rule === 'always' || (rule === 'first' && !c.seen[entry.kind]);
  const stored = {
    kind: entry.kind,
    t: entry.t,
    y: yearOf(c, entry.t),
    d: state.dynasty && Number.isInteger(state.dynasty.level) ? Math.max(1, state.dynasty.level) : 1,
    hl,
    data: cleanData(entry.data),
  };
  c.seen[entry.kind] = true;
  insertByTime(c.entries, stored);
  evictChapter(c.entries, CHRONICLE.maxEntries);
  if (hl) {
    insertByTime(c.lifetime, { ...stored, data: { ...stored.data } });
    evictLifetime(c.lifetime, CHRONICLE.maxHighlights);
  }
  return stored;
}

// --- event detection -----------------------------------------------------------------------------

function namesFor(state, world, region) {
  const factionId = region.faction;
  const faction = world.factions[factionId];
  const leader = hasLeader(factionId) ? leaderFor(state.seed, state.dynasty ? state.dynasty.level : 1, factionId) : null;
  const names = { region: region.name, regionId: region.id, factionId };
  if (faction) names.faction = faction.name;
  if (leader) names.leader = leader.fullName;
  return names;
}

function ownedCount(state, world) {
  let n = 0;
  for (const r of world.regions) if (state.owner[r.id] === PLAYER_FACTION) n += 1;
  return n;
}

function begin(c, state, world, t) {
  if (c.startedAt == null) {
    const home = state.conqueredAt && world.startRegion != null ? state.conqueredAt[world.startRegion] : null;
    c.startedAt = finite(home) && home <= t ? home : t;
  }
}

/**
 * Decides what a conquest makes notable and records it. Call it RIGHT AFTER `conquer()` (and `awardCrowns()`), once per region
 * taken, by battle or by surrender. Returns the entries recorded, in story order (possibly none: most conquests are routine).
 *
 *   firstConquest  the first region taken this dynasty
 *   capital        a rival capital toppled (this is also the decapitation: `data.decapitated`)
 *   surrender      a surrender accepted (when nothing bigger happened)
 *   tripleCrown    all three crowns: the dynasty's first, then on streak milestones (config `streakMilestones`)
 *   fastest        a new fastest battle, beating the old record by `fastestMarginSec`
 *   factionFalls   the last region of a rival faction taken
 *   halfway        half the continent held (once)
 *   continent      all of it (once)
 *
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @param {number} regionId
 * @param {{ crowns?: {victory:boolean,swift:boolean,unbroken:boolean}|null, battleSec?: number, surrender?: boolean,
 *           decapitated?: boolean, t?: number }} [opts]
 *   `t` ms timestamp (default: `state.conqueredAt[regionId]`, which `conquer()` just set); `decapitated` is
 *   `conquer()`'s result flag (default: true for a capital).
 * @returns {ChronicleEntry[]}
 */
export function chronicleOnConquest(state, world, regionId, opts = {}) {
  const region = world.regions[regionId];
  if (!region) return [];
  const c = ensureChronicle(state);
  const t = [opts.t, state.conqueredAt ? state.conqueredAt[regionId] : null, c.startedAt].find(finite);
  if (!finite(t)) return [];
  begin(c, state, world, t);

  const out = [];
  const surrender = !!opts.surrender;
  const names = namesFor(state, world, region);
  const rec = (kind, extra = {}) => { const e = recordChronicle(state, { kind, t, data: { ...names, ...extra } }); if (e) out.push(e); };

  c.conquests += 1;
  const isFirst = !c.firsts.conquest;
  c.firsts.conquest = true;

  // the headline of this conquest
  if (region.isCapital) rec('capital', { surrender, decapitated: opts.decapitated != null ? !!opts.decapitated : true });
  else if (isFirst) rec('firstConquest', { surrender });
  else if (surrender) rec('surrender');

  // how it was won (a surrender has no battle to speak of)
  const crowns = !surrender ? opts.crowns : null;
  if (crowns && crowns.victory) {
    const triple = !!(crowns.swift && crowns.unbroken);
    c.streak = triple ? c.streak + 1 : 0;
    if (triple) {
      const first = !c.firsts.triple;
      c.firsts.triple = true;
      const milestone = CHRONICLE.streakMilestones.includes(c.streak);
      if (!region.isCapital && (first || milestone)) rec('tripleCrown', { streak: c.streak });
    }
  }
  if (!surrender && finite(opts.battleSec) && opts.battleSec > 0) {
    const prev = c.bestSec;
    if (prev == null) c.bestSec = opts.battleSec;
    else if (opts.battleSec < prev) {
      c.bestSec = opts.battleSec;
      if (prev - opts.battleSec >= CHRONICLE.fastestMarginSec) rec('fastest', { sec: Math.round(opts.battleSec * 10) / 10, prev: Math.round(prev * 10) / 10 });
    }
  }

  // what it means for the continent
  const f = region.faction;
  if (hasLeader(f) && !c.firsts[`fall${f}`] && world.regions.every((r) => r.faction !== f || state.owner[r.id] === PLAYER_FACTION)) {
    c.firsts[`fall${f}`] = true;
    rec('factionFalls');
  }
  const total = world.regions.length;
  const owned = ownedCount(state, world);
  if (owned >= total) {
    if (!c.firsts.continent) { c.firsts.continent = true; rec('continent'); }
  } else if (owned * 2 >= total && !c.firsts.halfway) {
    c.firsts.halfway = true;
    rec('halfway', { n: owned });
  }
  return out;
}

/**
 * Records the first region to reach Prosperity III this dynasty. Pass `updateProsperity`'s level-ups. The entry is dated
 * when the level was really reached (the region's `conqueredAt` plus the level's tenure), never later than `opts.t`, so
 * a level won while the game was closed reads "6h ago" and not "just now". Among several level-ups the earliest wins.
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @param {{ regionId: number, level: number }[]} levelUps
 * @param {{ t: number }} opts  ms timestamp of the update (required: the module never reads a clock)
 * @returns {ChronicleEntry[]}
 */
export function chronicleOnProsperity(state, world, levelUps, opts = {}) {
  if (!finite(opts.t) || !Array.isArray(levelUps)) return [];
  const c = ensureChronicle(state);
  if (c.firsts.prosperity3) return [];
  const needed = PROSPERITY.thresholdsMs[PROSPERITY.maxLevel - 1];
  let best = null;
  for (const up of levelUps) {
    if (!up || up.level < PROSPERITY.maxLevel) continue;
    const region = world.regions[up.regionId];
    if (!region) continue;
    const at = state.conqueredAt ? state.conqueredAt[up.regionId] : null;
    const reached = finite(at) && finite(needed) ? Math.min(opts.t, at + needed) : opts.t;
    if (!best || reached < best.t) best = { region, t: reached };
  }
  if (!best) return [];
  c.firsts.prosperity3 = true;
  begin(c, state, world, best.t);
  const e = recordChronicle(state, { kind: 'prosperity3', t: best.t, data: { region: best.region.name, regionId: best.region.id } });
  return e ? [e] : [];
}

/**
 * Closes the old dynasty's chapter and opens the new one. Call it right after the new dynasty exists (after `foundDynasty`
 * and `resetRegions`, so `state.dynasty` (level and stars) and `state.seed` are the NEW ones). The chapter is cleared, the lifetime
 * highlights and the speed record stay, and the first entry of the new chapter is "Dynasty II is founded" (also a highlight).
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @param {{ t: number }} opts  ms timestamp the dynasty was founded
 * @returns {ChronicleEntry[]}
 */
export function chronicleOnDynasty(state, world, opts = {}) {
  const c = ensureChronicle(state);
  const t = [opts.t, state.lastSeen].find(finite);
  if (!finite(t)) return [];
  if (c.startedAt == null) c.startedAt = t;
  const years = yearOf(c, t);
  const closed = { years, conquests: c.conquests };
  c.entries = [];
  c.firsts = {};
  c.streak = 0;
  c.conquests = 0;
  c.startedAt = t;
  void world;
  const e = recordChronicle(state, {
    kind: 'dynasty',
    t,
    data: {
      dynasty: state.dynasty ? state.dynasty.level : 1,
      stars: state.dynasty ? state.dynasty.stars : 0,
      years: closed.years,
      conquests: closed.conquests,
      seed: state.seed,
    },
  });
  return e ? [e] : [];
}

// --- text ----------------------------------------------------------------------------------------

function roman(n) {
  const table = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let v = Math.max(1, Math.round(n));
  let out = '';
  for (const [val, sym] of table) while (v >= val) { out += sym; v -= val; }
  return out || 'I';
}

function ordinal(n) {
  const v = Math.abs(Math.round(n));
  const tens = v % 100;
  if (tens >= 11 && tens <= 13) return `${v}th`;
  return `${v}${({ 1: 'st', 2: 'nd', 3: 'rd' })[v % 10] || 'th'}`;
}

function clock(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function variantKey(entry) {
  const d = entry.data || {};
  if (d.surrender && CHRONICLE.templates[`${entry.kind}.surrender`]) return `${entry.kind}.surrender`;
  if (entry.kind === 'tripleCrown' && d.streak >= 3 && CHRONICLE.templates['tripleCrown.streak']) return 'tripleCrown.streak';
  return entry.kind;
}

/**
 * The story line for an entry, without its date: "Khan Gashrok's Amber Horde yields Dunspire". Names come from the entry
 * itself (stored when it was recorded); an entry without them falls back to `ctx.world` (and `ctx.state` for the leader's name
 * through `leaderFor`). Deterministic: the same entry always reads the same.
 * @param {ChronicleEntry} entry
 * @param {{ world?: import('../world/generate.js').World, state?: import('./state.js').GameState }} [ctx]
 * @returns {string}
 */
export function chronicleText(entry, ctx = {}) {
  const d = entry.data || {};
  if (typeof d.text === 'string' && d.text) return d.text;
  const list = CHRONICLE.templates[variantKey(entry)] || CHRONICLE.templates[entry.kind];
  if (!list || list.length === 0) return d.region ? `${entry.kind}: ${d.region}` : entry.kind;
  const tpl = list[hash32('chronicle', entry.kind, entry.t, d.regionId != null ? d.regionId : 0, d.dynasty != null ? d.dynasty : 0) % list.length];

  const { world, state } = ctx;
  const regionRec = world && d.regionId != null ? world.regions[d.regionId] : null;
  const factionId = d.factionId != null ? d.factionId : regionRec ? regionRec.faction : null;
  const region = d.region != null ? d.region : regionRec ? regionRec.name : 'a region';
  const faction = d.faction != null ? d.faction : world && world.factions[factionId] ? world.factions[factionId].name : 'the rivals';
  let leader = d.leader != null ? d.leader : null;
  if (leader == null && state && state.dynasty && factionId != null && hasLeader(factionId)) {
    const l = leaderFor(state.seed, state.dynasty.level, factionId);
    leader = l ? l.fullName : null;
  }
  const rival = leader ? `${leader}’s ${faction}` : faction;
  const n = d.n != null ? d.n : d.streak != null ? d.streak : 0;
  const vars = {
    region,
    faction,
    leader: leader || faction,
    rival,
    yields: CHRONICLE.pluralFactions.includes(factionId) ? 'yield' : 'yields',
    time: d.sec != null ? clock(d.sec) : '',
    prev: d.prev != null ? clock(d.prev) : '',
    n: String(n),
    ordinal: ordinal(n),
    dynasty: roman(d.dynasty != null ? d.dynasty : entry.d || 1),
    stars: String(d.stars != null ? d.stars : 0),
    years: String(d.years != null ? d.years : 0),
  };
  return tpl.replace(/\{(\w+)\}/g, (whole, key) => (vars[key] != null ? vars[key] : whole));
}

/** "Year 2": the entry's Year within its dynasty. */
export function chronicleYear(entry) {
  return CHRONICLE.labels.year.replace('{n}', String(entry.y || 1));
}

/** "just now", "5m ago", "3h ago", "2d ago". */
export function chronicleAgo(entry, now) {
  const ms = Math.max(0, now - entry.t);
  const a = CHRONICLE.ago;
  if (ms < 60 * 1000) return a.now;
  if (ms < 60 * 60 * 1000) return a.minute.replace('{n}', String(Math.floor(ms / 60000)));
  if (ms < CHRONICLE.dayMs) return a.hour.replace('{n}', String(Math.floor(ms / 3600000)));
  return a.day.replace('{n}', String(Math.floor(ms / CHRONICLE.dayMs)));
}

// --- panel data ------------------------------------------------------------------------------------

/**
 * @typedef {Object} ChronicleRow  one line of the Chronicle panel (game/ui/chroniclePanel.js)
 * @property {string} kind
 * @property {string} icon       a name from game/ui/icons.js
 * @property {string} text       the story line
 * @property {string} year       "Year 2"
 * @property {string} ago        "3h ago"
 * @property {boolean} highlight
 * @property {number} dynasty    the dynasty number
 * @property {string} chapter    "Dynasty II" (the panel's divider in the all-time list)
 *
 * @typedef {Object} ChroniclePanelData
 * @property {ChronicleRow[]} dynasty  this dynasty, newest first
 * @property {ChronicleRow[]} all      lifetime highlights, newest first
 * @property {{ title: string, thisDynasty: string, allTime: string }} labels
 * @property {{ dynasty: string, all: string }} empty
 */

function rowOf(entry, state, world, now) {
  const kind = CHRONICLE.kinds[entry.kind];
  return {
    kind: entry.kind,
    icon: kind ? kind.icon : 'scroll',
    text: chronicleText(entry, { state, world }),
    year: chronicleYear(entry),
    ago: chronicleAgo(entry, now),
    highlight: !!entry.hl,
    dynasty: entry.d,
    chapter: CHRONICLE.labels.chapter.replace('{dynasty}', roman(entry.d)),
  };
}

/**
 * Everything the Chronicle panel needs in one call: both lists (newest first), the labels and the empty texts. Cheap enough
 * to call whenever the Realm panel opens.
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @param {number} now ms timestamp
 * @returns {ChroniclePanelData}
 */
export function chroniclePanelData(state, world, now) {
  const dyn = [...chronicleEntries(state)].reverse().map((e) => rowOf(e, state, world, now));
  const all = [...lifetimeHighlights(state)].reverse().map((e) => rowOf(e, state, world, now));
  return {
    dynasty: dyn,
    all,
    labels: { title: CHRONICLE.labels.title, thisDynasty: CHRONICLE.labels.thisDynasty, allTime: CHRONICLE.labels.allTime },
    empty: { ...CHRONICLE.empty },
  };
}
