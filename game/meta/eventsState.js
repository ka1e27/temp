// The dependency-free half of world events (DESIGN §10.13): the record and the Plague's effect on a faction's strength. A LEAF,
// so progression.js (enemyBattleStats) can read the Plague without importing the scheduler. Pure.
//
//   state.worldEvents = { seq, rng, activeSec, nextAt, pending: Event|null, plague: { faction, until }|null, log: { [kind]: n },
//     deserters: { faction }|null,               Phase 8: the rival whose next raid is weakened (frontier.announce consumes it)
//     harvests: [{ from, until, mult }] }         Phase 8: Harvest Festivals, in WALL-CLOCK ms (prosperity's tenure is wall clock)
//   Event = { id, kind: EVENT_KINDS, offeredAt, expiresAt, ...kind fields }   (times in the events clock's active seconds)
import { EVENTS } from '../config/events.js';

export const EVENT_KINDS = Object.freeze(['merchant', 'plague', 'duel', 'deserters', 'harvest', 'shipwreck']); // shipwreck: PLAN-PHASE12, archipelagos only

export function defaultWorldEvents() {
  return { seq: 1, rng: 0, activeSec: 0, nextAt: EVENTS.graceSec, pending: null, plague: null,
    log: Object.fromEntries(EVENT_KINDS.map((k) => [k, 0])), deserters: null, harvests: [] };
}

export function ensureWorldEvents(state) {
  if (!state.worldEvents || typeof state.worldEvents !== 'object') state.worldEvents = defaultWorldEvents();
  const e = state.worldEvents;
  const d = defaultWorldEvents();
  for (const k of Object.keys(d)) if (e[k] === undefined) e[k] = d[k];
  if (!e.log || typeof e.log !== 'object') e.log = d.log;
  for (const k of EVENT_KINDS) if (!Number.isFinite(e.log[k])) e.log[k] = 0;
  if (!Array.isArray(e.harvests)) e.harvests = [];
  return e;
}

/** Garrison multiplier the Plague puts on a faction now (1 when it is not plagued). */
export function plagueMult(state, factionId) {
  const e = state && state.worldEvents;
  if (!e || !e.plague || e.plague.faction !== factionId) return 1;
  return e.activeSec < e.plague.until ? EVENTS.plague.strength : 1;
}

/** A save's `worldEvents`, made valid. Never throws. */
export function sanitizeWorldEvents(raw) {
  const out = defaultWorldEvents();
  if (!raw || typeof raw !== 'object') return out;
  const n = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  out.seq = Math.max(1, Math.floor(n(raw.seq, 1)));
  out.rng = Math.max(0, Math.floor(n(raw.rng)));
  out.activeSec = Math.max(0, n(raw.activeSec));
  out.nextAt = Math.max(0, n(raw.nextAt, out.nextAt));
  if (raw.plague && Number.isInteger(raw.plague.faction) && raw.plague.faction > 1) out.plague = { faction: raw.plague.faction, until: n(raw.plague.until) };
  const p = raw.pending;
  if (p && typeof p === 'object' && EVENT_KINDS.includes(p.kind) && Number.isFinite(p.expiresAt)) out.pending = { ...p };
  if (raw.deserters && Number.isInteger(raw.deserters.faction) && raw.deserters.faction > 1) out.deserters = { faction: raw.deserters.faction };
  if (Array.isArray(raw.harvests)) {
    out.harvests = raw.harvests.filter((h) => h && Number.isFinite(h.from) && Number.isFinite(h.until) && h.until > h.from && Number.isFinite(h.mult) && h.mult >= 1)
      .map((h) => ({ from: h.from, until: h.until, mult: Math.min(h.mult, 10) })).sort((a, b) => a.from - b.from).slice(-EVENTS.harvest.keep);
  }
  if (raw.log && typeof raw.log === 'object') for (const k of Object.keys(out.log)) out.log[k] = Math.max(0, Math.floor(n(raw.log[k])));
  return out;
}

// --- Harvest Festival (Phase 8): extra prosperity tenure ------------------------------------------------------------------------

function windows(state) {
  const e = state && state.worldEvents;
  return e && Array.isArray(e.harvests) ? e.harvests : [];
}

/** Extra tenure (ms) the Harvest Festivals add between `at` and `now`: (mult - 1) x the overlap with each festival. */
export function harvestBonusMs(state, at, now) {
  let extra = 0;
  for (const h of windows(state)) {
    const len = Math.min(now, h.until) - Math.max(at, h.from);
    if (len > 0) extra += (h.mult - 1) * len;
  }
  return extra;
}

/** The earliest time T at which (T - at) + harvestBonusMs(at, T) reaches `target` ms (the inverse, for "next level at"). */
export function harvestReachAt(state, at, target) {
  let cursor = at;
  let left = target;
  const list = windows(state).filter((h) => h.until > at).sort((a, b) => a.from - b.from);
  for (const h of list) {
    const from = Math.max(h.from, cursor);
    if (from > cursor) {
      if (left <= from - cursor) return cursor + left;
      left -= from - cursor;
      cursor = from;
    }
    if (h.until <= cursor) continue;
    const gain = (h.until - cursor) * h.mult;
    if (left <= gain) return cursor + left / h.mult;
    left -= gain;
    cursor = h.until;
  }
  return cursor + left;
}

/** The Harvest Festival running at `now` (ms), or null. */
export function activeHarvest(state, now) {
  return windows(state).find((h) => now >= h.from && now < h.until) || null;
}
