// The dependency-free half of the Living Frontier (DESIGN §10.1, §10.2): the shapes of `state.frontier` and `state.occupation`,
// occupying and retaking a region, and save sanitising. Pure: no DOM, no Date.now, no Math.random, no storage.
//
// A LEAF on purpose: progression.js calls `retake` from `conquer`, and frontier.js (the scheduler, defense runs, the away
// resolver) imports progression.js, so everything conquer needs lives here. frontier.js re-exports it all.
//
//   state.frontier = { seq, rng, activeSec, nextCheckAt, cooldown: { [regionId]: untilActiveSec }, incoming: [Raid],
//                      lastAwayReport, provoked: { [factionId]: activeSec }, stats: { raids, defensesWon, defensesLost, retakes } }
//   state.occupation = { [regionId]: { by, at, prosperity, tenureMs, forts, works, militia } }
//     by: the occupier's faction id; at: ms; prosperity: the stored level when it fell (0..3); tenureMs: how long the player had
//     held it (its prosperity clock, frozen); forts / works: the lists that now fight for the occupier; militia: the fill then.
//   While occupied, state.owner[regionId] is the occupier's faction id and state.conqueredAt[regionId] is null.
import { FRONTIER } from '../config/frontier.js';
import { PLAYER_FACTION } from './state.js';
import { sanitizeFortList, ensureForts } from './fortsEffects.js';
import { sanitizeWorks } from './worksEffects.js';
import { earnRenown } from './renownState.js';
import { RENOWN } from '../config/renown.js';

/**
 * @typedef {Object} Raid  a war band on its way (ARCHITECTURE §10.2 `state.frontier.incoming`)
 * @property {number} id
 * @property {number} faction        the raiding faction
 * @property {number} fromRegionId   the region it marches from
 * @property {number} toRegionId     your region it marches on
 * @property {number} announcedAt    active seconds (state.frontier.activeSec) when it was announced
 * @property {number} arriveAt       active seconds when it arrives (the toast's countdown is arriveAt - activeSec)
 * @property {number} strength       war-band troops at its camp (for the toast and the card)
 * @property {number} depth          the ladder depth its strength comes from
 * @property {boolean} first         the realm's first raid (weak and forgiving, the tutorial's first defense)
 */

/** A fresh frontier record. */
export function defaultFrontier() {
  return {
    seq: 1, rng: 0, activeSec: 0, nextCheckAt: 0, cooldown: {}, incoming: [], lastAwayReport: null,
    provoked: {}, stats: { raids: 0, defensesWon: 0, defensesLost: 0, retakes: 0 }, // (+ vendettas, counted live by frontier.js)
  };
}

/** Creates (or repairs) `state.frontier` and returns it. */
export function ensureFrontier(state) {
  const f = state.frontier && typeof state.frontier === 'object' ? state.frontier : (state.frontier = defaultFrontier());
  const d = defaultFrontier();
  for (const k of Object.keys(d)) if (f[k] === undefined || (f[k] === null && k !== 'lastAwayReport')) f[k] = d[k];
  if (!Array.isArray(f.incoming)) f.incoming = [];
  return f;
}

/** Creates `state.occupation` if it is missing and returns it. */
export function ensureOccupation(state) {
  if (!state.occupation || typeof state.occupation !== 'object' || Array.isArray(state.occupation)) state.occupation = {};
  return state.occupation;
}

/** The occupation record of a region, or null. */
export function occupationOf(state, regionId) {
  const occ = state.occupation && state.occupation[regionId];
  return occ && typeof occ === 'object' ? occ : null;
}

/** The faction occupying a region (one the player once held), or null. */
export function occupiedBy(state, regionId) {
  const occ = occupationOf(state, regionId);
  return occ ? occ.by : null;
}

/**
 * The region falls (DESIGN §10.2): its income stops (the owner changes), its prosperity freezes (level and tenure kept), its
 * fortifications and Works move into the occupation record and fight for the occupier, its militia record goes with them, and
 * any raid still marching on it is called off. MUTATES state. Returns the occupation record, or null when the player did not
 * hold the region.
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @param {number} regionId
 * @param {number} faction the occupier
 * @param {number} nowMs
 */
export function occupy(state, world, regionId, faction, nowMs) {
  if (!world.regions[regionId] || state.owner[regionId] !== PLAYER_FACTION || !(faction > PLAYER_FACTION)) return null;
  const f = ensureFrontier(state);
  const at = state.conqueredAt ? state.conqueredAt[regionId] : null;
  const level = Array.isArray(state.prosperity) && Number.isInteger(state.prosperity[regionId]) ? state.prosperity[regionId] : 0;
  const militia = state.militia && state.militia[regionId];
  const occ = {
    by: faction,
    at: nowMs,
    prosperity: level,
    tenureMs: at != null && Number.isFinite(at) ? Math.max(0, nowMs - at) : 0,
    forts: sanitizeFortList(state.forts && state.forts[regionId]),
    works: Array.isArray(state.works && state.works[regionId]) ? state.works[regionId].map((w) => ({ type: w.type, level: w.level })) : [],
    militia: militia && Number.isFinite(militia.fill) ? militia.fill : 1,
  };
  ensureOccupation(state)[regionId] = occ;
  if (state.forts) delete state.forts[regionId];
  if (state.works) delete state.works[regionId];
  if (state.militia) delete state.militia[regionId];
  state.owner[regionId] = faction;
  if (state.conqueredAt) state.conqueredAt[regionId] = null;
  if (Array.isArray(state.prosperity)) state.prosperity[regionId] = 0;
  f.incoming = f.incoming.filter((r) => r.toRegionId !== regionId);
  f.cooldown[regionId] = f.activeSec + FRONTIER.regionCooldownSec;
  f.stats.defensesLost += 1;
  return occ;
}

/**
 * Retaking an occupied region (DESIGN §10.2): restores the frozen prosperity (level and tenure), every fortification and Work,
 * and a thin militia that refills from now. Called by progression.js `conquer` after it has made the region the player's again.
 * MUTATES state. Returns `{ renown, forts, works, prosperity }` or null when the region was not occupied.
 */
export function retake(state, world, regionId, nowMs) {
  const occ = occupationOf(state, regionId);
  if (!occ || !world.regions[regionId]) return null;
  const f = ensureFrontier(state);
  if (state.conqueredAt) state.conqueredAt[regionId] = nowMs - (Number.isFinite(occ.tenureMs) ? occ.tenureMs : 0);
  if (!Array.isArray(state.prosperity)) state.prosperity = [];
  state.prosperity[regionId] = Number.isInteger(occ.prosperity) ? occ.prosperity : 0;
  const forts = sanitizeFortList(occ.forts);
  if (forts.length) ensureForts(state)[regionId] = forts;
  if (Array.isArray(occ.works) && occ.works.length) {
    if (!state.works || typeof state.works !== 'object') state.works = {};
    state.works[regionId] = occ.works.map((w) => ({ type: w.type, level: w.level }));
  }
  if (!state.militia || typeof state.militia !== 'object') state.militia = {};
  state.militia[regionId] = { fill: FRONTIER.retakeMilitiaFill, at: nowMs };
  delete state.occupation[regionId];
  f.cooldown[regionId] = f.activeSec + FRONTIER.regionCooldownSec;
  f.stats.retakes += 1;
  const renown = earnRenown(state, RENOWN.earn.retake, 'retake'); // DESIGN §10.12
  return {
    renown,
    forts, works: state.works ? state.works[regionId] || [] : [], prosperity: state.prosperity[regionId],
  };
}

/** Forgets the frontier and every occupation (a new dynasty or realm, next to resetRegions). Mutates and returns `state`. */
export function resetFrontier(state) {
  state.frontier = defaultFrontier();
  state.occupation = {};
  return state;
}

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const int = (v) => Number.isInteger(v) && v >= 0;

/** A save's `frontier`, made valid (unknown keys dropped, junk replaced by defaults). Never throws. For save.js withDefaults. */
export function sanitizeFrontier(raw) {
  const d = defaultFrontier();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return d;
  const out = {
    seq: Math.max(1, Math.floor(num(raw.seq, 1))),
    rng: Math.max(0, Math.floor(num(raw.rng, 0))),
    activeSec: Math.max(0, num(raw.activeSec, 0)),
    nextCheckAt: Math.max(0, num(raw.nextCheckAt, 0)),
    cooldown: {},
    incoming: [],
    lastAwayReport: raw.lastAwayReport && typeof raw.lastAwayReport === 'object' ? raw.lastAwayReport : null,
    provoked: {},
    stats: { ...d.stats },
  };
  if (raw.cooldown && typeof raw.cooldown === 'object') {
    for (const [k, v] of Object.entries(raw.cooldown)) if (/^\d+$/.test(k) && Number.isFinite(Number(v))) out.cooldown[k] = Number(v);
  }
  if (raw.provoked && typeof raw.provoked === 'object') {
    for (const [k, v] of Object.entries(raw.provoked)) if (/^\d+$/.test(k) && Number.isFinite(Number(v))) out.provoked[k] = Number(v);
  }
  if (raw.stats && typeof raw.stats === 'object') {
    for (const k of Object.keys(d.stats)) out.stats[k] = Math.max(0, Math.floor(num(raw.stats[k], 0)));
  }
  if (Array.isArray(raw.incoming)) {
    for (const r of raw.incoming) {
      if (!r || typeof r !== 'object' || !int(r.id) || !int(r.faction) || r.faction < 2 || !int(r.fromRegionId) || !int(r.toRegionId)) continue;
      const raid = {
        id: r.id, faction: r.faction, fromRegionId: r.fromRegionId, toRegionId: r.toRegionId,
        announcedAt: num(r.announcedAt, out.activeSec), arriveAt: num(r.arriveAt, out.activeSec),
        strength: Math.max(0, num(r.strength, 0)), depth: Math.max(0, num(r.depth, 1)), first: r.first === true,
      };
      if (r.deserted === true) raid.deserted = true; // Phase 8: the Deserters event weakened this raid
      // a Vendetta (PLAN-PHASE4 §4D) keeps its flag: { faction, leader }
      if (r.vendetta && typeof r.vendetta === 'object' && r.vendetta.faction === r.faction) {
        raid.vendetta = { faction: r.faction, leader: typeof r.vendetta.leader === 'string' ? r.vendetta.leader.slice(0, 60) : '' };
      }
      out.incoming.push(raid);
    }
    out.incoming = out.incoming.slice(0, FRONTIER.maxDefenses + 2);
  }
  return out;
}

/** A save's `occupation`, made valid. Never throws. For save.js withDefaults. */
export function sanitizeOccupation(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!/^\d+$/.test(k) || !v || typeof v !== 'object' || !int(v.by) || v.by < 1) continue;
    out[k] = {
      by: v.by,
      at: num(v.at, 0),
      prosperity: Number.isInteger(v.prosperity) ? Math.max(0, Math.min(3, v.prosperity)) : 0,
      tenureMs: Math.max(0, num(v.tenureMs, 0)),
      forts: sanitizeFortList(v.forts),
      works: sanitizeWorks({ 0: v.works })['0'] || [],
      militia: Math.max(0, Math.min(1, num(v.militia, 1))),
    };
  }
  return out;
}
