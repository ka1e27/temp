// The dependency-free half of world events (DESIGN §10.13): the record and the Plague's effect on a faction's strength. A LEAF,
// so progression.js (enemyBattleStats) can read the Plague without importing the scheduler. Pure.
//
//   state.worldEvents = { seq, rng, activeSec, nextAt, pending: Event|null, plague: { faction, until }|null, log: { merchant, plague, duel } }
//   Event = { id, kind: 'merchant'|'plague'|'duel', offeredAt, expiresAt, ...kind fields }   (times in the events clock's active seconds)
import { EVENTS } from '../config/events.js';

export function defaultWorldEvents() {
  return { seq: 1, rng: 0, activeSec: 0, nextAt: EVENTS.graceSec, pending: null, plague: null, log: { merchant: 0, plague: 0, duel: 0 } };
}

export function ensureWorldEvents(state) {
  if (!state.worldEvents || typeof state.worldEvents !== 'object') state.worldEvents = defaultWorldEvents();
  const e = state.worldEvents;
  const d = defaultWorldEvents();
  for (const k of Object.keys(d)) if (e[k] === undefined) e[k] = d[k];
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
  if (p && typeof p === 'object' && ['merchant', 'plague', 'duel'].includes(p.kind) && Number.isFinite(p.expiresAt)) out.pending = { ...p };
  if (raw.log && typeof raw.log === 'object') for (const k of Object.keys(out.log)) out.log[k] = Math.max(0, Math.floor(n(raw.log[k])));
  return out;
}
