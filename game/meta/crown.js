// The Crown of Ages (PLAN-PHASE13 §13A-§13C): when it is offered, the Throne on the card, the ending's record, the lasting crowned marker
// and Ascension's clearing rules. Pure: no DOM, no Date.now, no Math.random, no storage. Time (ms) is always passed in.
//
//   crownOfAgesAvailable(state)            -> boolean   the founding that leaves `state` may Seek the Crown (it makes dynasty 7+)
//   isThrone(world, regionId)              -> boolean   the Throne of Ages (the Usurper's capital on a Crown continent)
//   throneLines(state, world, regionId)    -> string[]  the region card's lines for a Usurper region (the Throne's first)
//   usurperOnFrontier(state, world)        -> regionId|null   a frontier region held by the Usurper (the tutorial hint's trigger)
//   onThroneToppled(state, world, now)     -> { first, crowned, deeds, ascension }   conquer() calls it (MUTATES the lasting record)
//   clearAscension(state)                  -> { level, highest, deeds } | null       this dynasty's Ascension level is cleared
//   ascensionInfo(state)                   -> the Realm panel's ladder and the ceremony's picker
//   endingRecord(state, opts)              -> the Chronicle-of-your-reign scroll's data
//   crownLine(state)                       -> 'Crowned in Year N' | null (the title screen)
//   noteReign(state)                       -> records this dynasty's Edict in the lasting reign record (foundDynasty calls it)
import { CROWN, ENDING, USURPER_FACTION } from '../config/crown.js';
import { ASCENSION } from '../config/ascension.js';
import { CHRONICLE } from '../config/chronicle.js';
import { UNREST } from '../config/unrest.js';
import { GRUDGES } from '../config/grudges.js';
import { GENERALS } from '../config/generals.js';
import { RELIC_LIST } from '../config/relics.js';
import { recordDeed } from './deeds.js';
import { edictInfo, fillTemplate } from './edicts.js';
import { lifetimeHighlights } from './chronicleState.js';
import {
  ascensionLevel, ascensionHighest, ascensionMods, isCrowned, maxAscensionChoice, ascensionLegacyMult, ensureAscension,
} from './ascension.js';

const PLAYER = 0;

/** True when the founding that leaves this dynasty may Seek the Crown of Ages (PLAN 13A: dynasty 7 or later). Never in a challenge. */
export function crownOfAgesAvailable(state) {
  if (!state || state.challenge) return false;
  const level = (state.dynasty && state.dynasty.level) || 1;
  return level + 1 >= CROWN.fromDynasty;
}

export function isThrone(world, regionId) {
  return !!(world && world.crown && world.crown.throne === regionId);
}

function holder(state, regionId) {
  const occ = state.occupation && state.occupation[regionId];
  return occ && Number.isInteger(occ.by) ? occ.by : state.owner[regionId];
}

/** The card's lines for a region held by the Usurper (empty otherwise, or for your own region). */
export function throneLines(state, world, regionId) {
  if (!world || !world.regions[regionId] || state.owner[regionId] === PLAYER || holder(state, regionId) !== USURPER_FACTION) return [];
  const out = [];
  if (isThrone(world, regionId)) out.push(CROWN.copy.cardThrone);
  out.push(CROWN.copy.cardUsurper);
  return out;
}

/** A frontier region (not yours, bordering yours) held by the Usurper, lowest id; null when none. */
export function usurperOnFrontier(state, world) {
  if (!world || !world.crown) return null;
  for (const region of world.regions) {
    if (state.owner[region.id] === PLAYER || holder(state, region.id) !== USURPER_FACTION) continue;
    if (region.neighbors.some((n) => state.owner[n] === PLAYER)) return region.id;
  }
  return null;
}

function yearAt(state, t) {
  const c = state && state.chronicle;
  const start = c && Number.isFinite(c.startedAt) ? c.startedAt : t;
  return Math.max(1, Math.floor((t - start) / CHRONICLE.dayMs) + 1);
}

/**
 * This dynasty's Ascension level is cleared (its continent whole, or its Throne toppled): the lasting record and the deed tiers. Returns
 * `{ level, highest, newHighest: true, deeds }` the first time a level above the highest is cleared, else null (conquer() reports it once).
 */
export function clearAscension(state) {
  const level = ascensionLevel(state);
  if (level <= 0) return null;
  const rec = ensureAscension(state);
  const before = rec.highest;
  if (level <= before) return null; // already cleared (this dynasty or an earlier one): nothing new to report
  rec.highest = level;
  const deeds = recordDeed(state, 'ascension', rec.highest);
  return { level, highest: rec.highest, newHighest: rec.highest > before, deeds };
}

/**
 * The Throne of Ages fell (conquer calls this once per conquest of the Throne). The first time ever: the lasting crowned marker
 * (`state.generals.crowned = { v, year, dynasty, t, times }`) and the Crown of Ages deed; every time: `times` + 1, and this dynasty's
 * Ascension level is cleared. MUTATES.
 */
export function onThroneToppled(state, world, now) {
  const g = state.generals || (state.generals = { seq: 1, roster: [] });
  const first = !isCrowned(state);
  if (first) g.crowned = { v: 1, year: yearAt(state, now), dynasty: (state.dynasty && state.dynasty.level) || 1, t: now, times: 1 };
  else g.crowned.times = (g.crowned.times || 1) + 1;
  const deeds = recordDeed(state, 'crownOfAges', 1);
  const ascension = clearAscension(state);
  void world;
  return { first, crowned: { ...g.crowned }, deeds, ascension };
}

/** 'Crowned in Year N' for the title screen, or null before the ending. */
export function crownLine(state) {
  if (!isCrowned(state)) return null;
  const c = state.generals.crowned;
  return ENDING.crownLine.replace('{year}', String(c.year)).replace('{dynasty}', String(c.dynasty));
}

/** Records this dynasty's Edict in `state.generals.reign` (lasting: the ending scroll lists every Edict chosen). MUTATES. */
export function noteReign(state) {
  const g = state.generals || (state.generals = { seq: 1, roster: [] });
  if (!g.reign || typeof g.reign !== 'object' || !Array.isArray(g.reign.edicts)) g.reign = { v: 1, edicts: [] };
  const d = (state.dynasty && state.dynasty.level) || 1;
  const id = state.edict && state.edict.id ? state.edict.id : null;
  g.reign.edicts = g.reign.edicts.filter((e) => e.d !== d);
  if (id) g.reign.edicts.push({ d, id });
  g.reign.edicts.sort((a, b) => a.d - b.d);
  if (g.reign.edicts.length > 99) g.reign.edicts.splice(0, g.reign.edicts.length - 99);
  return g.reign;
}

export { sanitizeReignRecord as sanitizeReign } from './ascension.js';

// --- Ascension (PLAN 13C) --------------------------------------------------------------------------------------------------------

function stepText(step) {
  const m = { ...step.mods, vendettaAt: Math.round(GRUDGES.max * (step.mods.vendettaGrudgeMult ?? 1)) };
  return fillTemplate(step.text, m).replace('{sec}', String(UNREST.idleSec + (step.mods.unrestIdleAdd || 0)));
}

/**
 * The ladder for the Realm panel and the ceremony's picker:
 *   { unlocked, level (this dynasty), highest (cleared), maxChoice (a founding may pick 0..maxChoice), legacyMult (the next founding's
 *     multiplier for this dynasty's level), ladder: [{ level, name, icon, text, cleared, current, open }], copy }
 * `open`: pickable at the next founding. `cleared`: level <= highest.
 */
export function ascensionInfo(state) {
  const level = ascensionLevel(state);
  const highest = ascensionHighest(state);
  const maxChoice = maxAscensionChoice(state);
  return {
    unlocked: isCrowned(state),
    level,
    highest,
    maxChoice,
    legacyMult: ascensionLegacyMult(state),
    mods: ascensionMods(level),
    ladder: ASCENSION.ladder.map((s) => ({
      level: s.level, name: s.name, icon: s.icon, text: stepText(s), cleared: s.level <= highest, current: s.level === level, open: s.level <= maxChoice,
    })),
    copy: ASCENSION.copy,
  };
}

// --- The ending (PLAN 13B) -------------------------------------------------------------------------------------------------------

function bestDaily(record) {
  const daily = record && record.daily && typeof record.daily === 'object' ? record.daily : null;
  if (!daily) return null;
  let best = null;
  for (const [date, r] of Object.entries(daily)) {
    const s = r && r.best;
    if (!s || !s.met || !Number.isFinite(s.sec)) continue;
    if (!best || s.sec < best.sec || (s.sec === best.sec && (s.crowns || 0) > best.crowns)) best = { date: Number(date), sec: s.sec, crowns: s.crowns || 0 };
  }
  return best;
}

function clock(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The Chronicle-of-your-reign scroll (PLAN 13B), read from the lasting record and the Chronicle:
 *   { title, crowned: { year, dynasty, times } | null, dynasties, stars, edicts: [{ dynasty, id, name, icon }],
 *     generals: [{ id, name, kind, title, level }], relics: { found, total }, vendettasWon, dragonsSlain, capitalsToppled,
 *     bestDaily: { date, sec, crowns } | null, regionsConquered, battlesWon, crownsEarned, ascension: { level, highest },
 *     highlights: ChronicleEntry[] (the latest lifetime highlights; render with chronicleText), lines: string[], credits }
 * `opts.challengeRecord`: the app's challenge record (CHALLENGE_MODE.recordKey) for the best Daily; without it bestDaily is null.
 */
export function endingRecord(state, opts = {}) {
  const g = (state && state.generals) || {};
  const deeds = (g.deeds && g.deeds.progress) || {};
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const reign = g.reign && Array.isArray(g.reign.edicts) ? g.reign.edicts.slice() : [];
  const d = (state.dynasty && state.dynasty.level) || 1;
  if (state.edict && state.edict.id && !reign.some((e) => e.d === d)) reign.push({ d, id: state.edict.id });
  const edicts = reign.sort((a, b) => a.d - b.d).map((e) => { const i = edictInfo(e.id); return i ? { dynasty: e.d, id: e.id, name: i.name, icon: i.icon } : null; }).filter(Boolean);
  const generals = (Array.isArray(g.roster) ? g.roster : []).map((x) => ({
    id: x.id, name: x.name, kind: x.kind, title: (GENERALS.kinds[x.kind] && GENERALS.kinds[x.kind].title) || '', level: x.level || 1,
  })).sort((a, b) => b.level - a.level || (a.id < b.id ? -1 : 1));
  const relicsFound = g.reliquary && Array.isArray(g.reliquary.found) ? g.reliquary.found.length : 0;
  const capitals = Object.keys(deeds).filter((k) => /^capital:\d+$/.test(k) && deeds[k] >= 1).length;
  const stats = state.stats || {};
  const out = {
    title: ENDING.scrollTitle,
    crowned: isCrowned(state) ? { year: g.crowned.year, dynasty: g.crowned.dynasty, times: g.crowned.times || 1 } : null,
    dynasties: d,
    stars: num(state.dynasty && state.dynasty.stars),
    edicts,
    generals,
    relics: { found: relicsFound, total: RELIC_LIST.length },
    vendettasWon: num(deeds.vendetta),
    dragonsSlain: num(deeds.dragon),
    capitalsToppled: capitals,
    bestDaily: bestDaily(opts && opts.challengeRecord),
    regionsConquered: Math.max(num(stats.regionsConquered), num(deeds.conquer)),
    battlesWon: num(stats.battlesWon),
    crownsEarned: num(stats.crownsEarned),
    ascension: { level: ascensionLevel(state), highest: ascensionHighest(state) },
    highlights: lifetimeHighlights(state).slice(-ENDING.highlights),
    credits: ENDING.credits,
  };
  const L = ENDING.lines;
  const lines = [L.dynasties.replace('{n}', String(out.dynasties))];
  if (edicts.length) lines.push(L.edicts.replace('{list}', edicts.map((e) => e.name).join(', ')));
  if (generals.length) lines.push(L.generals.replace('{list}', generals.slice(0, 4).map((x) => `${x.name} (${x.level})`).join(', ')));
  if (relicsFound) lines.push(L.relics.replace('{n}', String(relicsFound)).replace('{total}', String(RELIC_LIST.length)));
  if (out.vendettasWon) lines.push(out.vendettasWon === 1 ? L.vendetta1 : L.vendettas.replace('{n}', String(out.vendettasWon)));
  if (out.dragonsSlain) lines.push(out.dragonsSlain === 1 ? L.dragon1 : L.dragons.replace('{n}', String(out.dragonsSlain)));
  if (capitals) lines.push(L.capitals.replace('{n}', String(capitals)));
  if (out.bestDaily) lines.push(L.daily.replace('{time}', clock(out.bestDaily.sec)).replace('{crowns}', String(out.bestDaily.crowns)));
  if (out.regionsConquered) lines.push(L.regions.replace('{n}', String(out.regionsConquered)));
  if (out.battlesWon) lines.push(L.battles.replace('{n}', String(out.battlesWon)));
  if (out.ascension.highest) lines.push(L.ascension.replace('{n}', String(out.ascension.highest)));
  out.lines = lines;
  return out;
}
