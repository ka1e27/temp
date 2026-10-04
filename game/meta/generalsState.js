// The dependency-free half of Generals (DESIGN §10.8, §10.11): the roster's shape, recruiting, XP and levels, skill picks,
// wounds, what a commander adds to a battle, and the steward style object. Pure: no DOM, no Date.now, no Math.random, no storage.
//
// A LEAF: progression.js (playerBattleStats, conquer's champion recruit) and renown spends import it; generals.js (assignment,
// panel data) re-exports it.
//
//   state.generals = { seq, roster: [General], deeds? }   PERSISTS across dynasties (foundDynasty carries it; resetRegions must not touch it)
//     deeds: the lifetime Deeds (meta/deeds.js), kept here so they travel with the roster through a new dynasty and New Realm
//   General = { id, kind, name, style, level, xp, skills: (0|1)[], woundedUntil: ms|null, regionId: number|null, passive?: {stat, value} }
//     id: 'marshal' | 'champion:<factionId>' | 'merc:<n>';  skills[i] is the option picked at GENERALS.skillLevels[i];
//     regionId: where it last fought (nearestFreeGeneral); passive: a mercenary's own rolled passive.
import { GENERALS, CHAMPION_OF_FACTION } from '../config/generals.js';
import { hash32 } from '../core/rng.js';
import { recordDeed, sanitizeDeeds } from './deeds.js'; // a leaf: the Deeds live inside this record (state.generals.deeds)
import { sanitizeLegacy } from './legacy.js'; // a leaf: so does the Legacy (state.generals.legacy)

const KINDS = new Set(Object.keys(GENERALS.kinds));
const STYLES = new Set(GENERALS.mercenaryStyles);

function pick(list, seed, ...parts) {
  return list[hash32(seed >>> 0, ...parts) % list.length];
}

/** A fresh roster: the starting Marshal with a seeded name. */
export function defaultGenerals(seed = 0) {
  return { seq: 1, roster: [makeGeneral('marshal', 'marshal', seed)] };
}

function makeGeneral(id, kind, seed, extra = {}) {
  const k = GENERALS.kinds[kind];
  const name = pick(GENERALS.names[kind], seed, 'general', id);
  return {
    id, kind, name: kind === 'marshal' ? `${k.title} ${name}` : name, style: k.style, level: 1, xp: 0, skills: [],
    woundedUntil: null, regionId: null, ...extra,
  };
}

/** Creates (or repairs) `state.generals` and returns it. The Marshal is always there. */
export function ensureGenerals(state) {
  if (!state.generals || typeof state.generals !== 'object' || !Array.isArray(state.generals.roster)) {
    state.generals = defaultGenerals(state.seed ?? 0);
  }
  if (!state.generals.roster.some((g) => g.id === 'marshal')) state.generals.roster.unshift(makeGeneral('marshal', 'marshal', state.seed ?? 0));
  return state.generals;
}

/** The General with this id, or null. Accepts a General object too (returned as is). */
export function generalById(state, id) {
  if (id && typeof id === 'object') return id;
  if (!id || !state.generals || !Array.isArray(state.generals.roster)) return null;
  return state.generals.roster.find((g) => g.id === id) || null;
}

/**
 * Recruits the champion of a toppled rival capital's faction (DESIGN §10.11): once per faction, ever. Returns the new General, or
 * null when the faction has no champion or it already serves.
 */
export function recruitChampion(state, factionId) {
  const kind = CHAMPION_OF_FACTION[factionId];
  if (!kind) return null;
  const g = ensureGenerals(state);
  const id = `champion:${factionId}`;
  if (g.roster.some((x) => x.id === id)) return null;
  const general = makeGeneral(id, kind, state.seed ?? 0);
  g.roster.push(general);
  return general;
}

/** Hires a mercenary (seeded name, passive and style). No cost or limit check here: renown.js hireMercenary does that. */
export function addMercenary(state) {
  const g = ensureGenerals(state);
  const n = g.seq++;
  const id = `merc:${n}`;
  const seed = state.seed ?? 0;
  const passive = { ...pick(GENERALS.mercenaryPassives, seed, 'merc-passive', n) };
  const style = pick(GENERALS.mercenaryStyles, seed, 'merc-style', n);
  const general = makeGeneral(id, 'mercenary', seed, { passive, style });
  g.roster.push(general);
  return general;
}

export function mercenaryCount(state) {
  return ensureGenerals(state).roster.filter((x) => x.kind === 'mercenary').length;
}

// --- XP, levels, skills, wounds -------------------------------------------------------------------------------------------

/** XP needed to go from `level` to the next (Infinity at the top). */
export function xpToNext(level) {
  return level >= GENERALS.maxLevel ? Infinity : GENERALS.xpPerLevel * level;
}

/**
 * Adds XP for a battle commanded (DESIGN §10.11: 100 a win, 80 a defense won, 40 a loss) and levels up. MUTATES the General.
 * @param {'win'|'defenseWon'|'loss'} outcome
 * @returns {{ xp:number, levels:number, level:number }} what was gained
 */
export function addXp(general, outcome, mult = 1) {
  const gain = Math.round((GENERALS.xp[outcome] ?? 0) * (Number.isFinite(mult) && mult > 0 ? mult : 1)); // mult: the Mentor deed
  const before = general.level;
  general.xp += gain;
  while (general.level < GENERALS.maxLevel && general.xp >= xpToNext(general.level)) {
    general.xp -= xpToNext(general.level);
    general.level += 1;
  }
  if (general.level >= GENERALS.maxLevel) general.xp = 0;
  return { xp: gain, levels: general.level - before, level: general.level };
}

/** Adds a flat amount of XP (the Bounty Board's XP bundle) and levels up. MUTATES. Returns what was gained like addXp. */
export function addRawXp(general, amount) {
  const gain = Math.max(0, Math.floor(Number(amount) || 0));
  const before = general.level;
  general.xp += gain;
  while (general.level < GENERALS.maxLevel && general.xp >= xpToNext(general.level)) {
    general.xp -= xpToNext(general.level);
    general.level += 1;
  }
  if (general.level >= GENERALS.maxLevel) general.xp = 0;
  return { xp: gain, levels: general.level - before, level: general.level };
}

/** Records the Mentor deed from the roster's highest level (call after any XP or Training). */
export function recordGeneralLevels(state) {
  const roster = state.generals && Array.isArray(state.generals.roster) ? state.generals.roster : [];
  const top = roster.reduce((m, g) => Math.max(m, Number.isInteger(g.level) ? g.level : 1), 1);
  return recordDeed(state, 'generalLevel', top);
}

/** One level now (Training). MUTATES. False at the top. */
export function levelUp(general) {
  if (general.level >= GENERALS.maxLevel) return false;
  general.level += 1;
  general.xp = 0;
  return true;
}

/** How many skill picks the General is owed (levels reached in GENERALS.skillLevels minus picks made). */
export function pendingPicks(general) {
  return GENERALS.skillLevels.filter((l) => general.level >= l).length - general.skills.length;
}

/** The two options of the next pick, or null when none is owed. */
export function nextPickOptions(general) {
  if (pendingPicks(general) <= 0) return null;
  return GENERALS.kinds[general.kind].skills[general.skills.length];
}

/** Picks option 0 or 1 at the next tier. Permanent (a respec clears all). MUTATES. False when no pick is owed. */
export function pickSkill(general, choice) {
  if (pendingPicks(general) <= 0 || (choice !== 0 && choice !== 1)) return false;
  general.skills.push(choice);
  return true;
}

/** Clears every pick (Respec). MUTATES. */
export function clearSkills(general) {
  general.skills = [];
}

/** The skill ids the General has picked, in tier order. */
export function skillIds(general) {
  const tiers = GENERALS.kinds[general.kind]?.skills || [];
  return general.skills.map((c, i) => tiers[i] && tiers[i][c]).filter(Boolean);
}

/** True while wounded at `nowMs`. */
export function isWounded(general, nowMs) {
  return general.woundedUntil != null && Number.isFinite(nowMs) && nowMs < general.woundedUntil;
}

/** Wounds the General for GENERALS.woundMs (DESIGN §10.8). MUTATES. */
export function wound(general, nowMs) {
  general.woundedUntil = nowMs + GENERALS.woundMs;
}

// --- What a commander brings to a battle -------------------------------------------------------------------------------------

const NEUTRAL = Object.freeze({ garrisonMult: 1, assaultMult: 1, cooldownMult: 1, speedMult: 1, campTroopsMult: 1, reclaim: 0 });

/** The General's passive value now: base x (1 + passivePerLevel x (level - 1)) + its passive skills. null for none. */
export function passiveOf(general) {
  const base = general.kind === 'mercenary' ? general.passive : GENERALS.kinds[general.kind].passive;
  if (!base) return null;
  const sv = GENERALS.skillValues;
  let value = base.value * (1 + GENERALS.passivePerLevel * (general.level - 1));
  for (const s of skillIds(general)) {
    if (s === 'passivePlus') value += sv.passivePlus;
    if (s === 'passivePlus2') value += sv.passivePlus2;
  }
  return { stat: base.stat, value };
}

/**
 * The ability a General brings (once per battle, DESIGN §10.11) with its skills folded in: the object the sim reads from
 * `battle.player.ability` (game/battle/abilities.js).
 */
export function abilityOf(general) {
  const kind = GENERALS.kinds[general.kind];
  const a = GENERALS.abilities;
  const sv = GENERALS.skillValues;
  const skills = skillIds(general);
  const count = (id) => skills.filter((s) => s === id).length;
  switch (kind.ability) {
    case 'shieldWall':
      return { id: 'shieldWall', duration: a.shieldWall.duration + sv.wallLong * count('wallLong') + sv.wallLong2 * count('wallLong2'),
        heal: sv.wallHeal * count('wallHeal'), levy: sv.wallLevy * count('wallLevy') };
    case 'charge':
      return { id: 'charge', squads: a.charge.squads + sv.chargeMore * count('chargeMore'),
        speed: a.charge.speed + sv.chargeFaster * count('chargeFaster'), strength: a.charge.strength + sv.chargeHarder * count('chargeHarder') };
    case 'foresight':
      return { id: 'foresight', duration: a.foresight.duration + sv.foresightLong * count('foresightLong'),
        slow: Math.min(0.6, a.foresight.slow + sv.foresightSlow * count('foresightSlow')) };
    case 'raid':
      return { id: 'raid', share: a.raid.share + sv.raidBigger * count('raidBigger'), squads: count('raidTwo') ? sv.raidTwo : a.raid.squads,
        noArrows: count('raidNoArrows') > 0 };
    case 'bonus':
      return { id: 'bonus', share: a.bonus.share + sv.bonusMore * count('bonusMore') };
    case 'raiseFallen': // the Gravewarden (PLAN-PHASE6)
      return { id: 'raiseFallen', windowSec: a.raiseFallen.windowSec + sv.raiseLong * count('raiseLong'), cap: a.raiseFallen.cap + sv.raiseBigger * count('raiseBigger') };
    default:
      return null;
  }
}

/**
 * Everything a commander adds to a battle's PlayerStats (DESIGN §10.11; folded in by progression.js playerBattleStats):
 * multipliers (1 = none) and the ability. A missing commander (the Militia Captain) adds nothing.
 * @returns {{ garrisonMult:number, assaultMult:number, cooldownMult:number, speedMult:number, campTroopsMult:number, ability:object|null }}
 */
export function commanderEffects(general) {
  if (!general) return { ...NEUTRAL, ability: null };
  const out = { ...NEUTRAL, ability: abilityOf(general) };
  const p = passiveOf(general);
  if (p) {
    if (p.stat === 'garrisonMult') out.garrisonMult = 1 + p.value;
    else if (p.stat === 'assaultMult') out.assaultMult = 1 + p.value;
    else if (p.stat === 'cooldown') out.cooldownMult = Math.max(0.3, 1 - p.value);
    else if (p.stat === 'speed') out.speedMult = 1 + p.value;
    else if (p.stat === 'campTroops') out.campTroopsMult = 1 + p.value;
    else if (p.stat === 'reclaim') out.reclaim = p.value; // the Gravewarden: share of attackers' dead joining your settlement
  }
  if (skillIds(general).includes('garrisonPlus')) out.garrisonMult += GENERALS.skillValues.garrisonPlus;
  return out;
}

/**
 * The steward this General makes (DESIGN §10.11), as the style object `stewardDecide(battle, t, memo, style)` takes:
 * `{ style, level, skills }`. null for no General (pass 'captain').
 */
export function commanderStyle(general) {
  if (!general) return null;
  return { style: general.style || 'stalwart', level: general.level, skills: skillIds(general) };
}

// --- Save ---------------------------------------------------------------------------------------------------------------------

/** A save's `generals`, made valid (the Marshal always present, junk entries dropped, numbers clamped). Never throws. */
export function sanitizeGenerals(raw, seed = 0) {
  const out = defaultGenerals(seed);
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.roster)) return out;
  out.seq = Number.isInteger(raw.seq) && raw.seq >= 1 ? raw.seq : 1;
  const roster = [];
  const seen = new Set();
  for (const g of raw.roster) {
    if (!g || typeof g !== 'object' || typeof g.id !== 'string' || seen.has(g.id) || !KINDS.has(g.kind)) continue;
    if (!/^(marshal|champion:\d+|merc:\d+)$/.test(g.id)) continue;
    seen.add(g.id);
    const level = Number.isInteger(g.level) ? Math.max(1, Math.min(GENERALS.maxLevel, g.level)) : 1;
    const maxPicks = GENERALS.skillLevels.filter((l) => level >= l).length;
    const clean = {
      id: g.id, kind: g.kind, name: typeof g.name === 'string' ? g.name.slice(0, 40) : GENERALS.kinds[g.kind].title,
      style: STYLES.has(g.style) ? g.style : (GENERALS.kinds[g.kind].style || 'stalwart'), level,
      xp: Number.isFinite(g.xp) ? Math.max(0, Math.min(xpToNext(level) === Infinity ? 0 : xpToNext(level) - 1, Math.floor(g.xp))) : 0,
      skills: Array.isArray(g.skills) ? g.skills.filter((c) => c === 0 || c === 1).slice(0, maxPicks) : [],
      woundedUntil: Number.isFinite(g.woundedUntil) ? g.woundedUntil : null,
      regionId: Number.isInteger(g.regionId) && g.regionId >= 0 ? g.regionId : null,
    };
    if (g.kind === 'mercenary') {
      const p = g.passive;
      clean.passive = p && GENERALS.mercenaryPassives.some((x) => x.stat === p.stat) ? { stat: p.stat, value: GENERALS.mercenaryPassives.find((x) => x.stat === p.stat).value } : { ...GENERALS.mercenaryPassives[0] };
    }
    roster.push(clean);
  }
  if (!roster.some((g) => g.id === 'marshal')) roster.unshift(out.roster[0]);
  const mercs = roster.filter((g) => g.kind === 'mercenary');
  out.roster = roster.filter((g) => g.kind !== 'mercenary' || mercs.indexOf(g) < GENERALS.maxMercenaries);
  if (raw.deeds && typeof raw.deeds === 'object') out.deeds = sanitizeDeeds(raw.deeds); // the lifetime Deeds ride with the roster
  if (raw.legacy && typeof raw.legacy === 'object') out.legacy = sanitizeLegacy(raw.legacy); // and so does the Legacy (PLAN-PHASE5)
  return out;
}
