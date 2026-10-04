// The dependency-free half of the Bounty Board (PLAN-PHASE4 §4A): the record's shape and save sanitising. A LEAF, so state.js,
// progression.js (foundDynasty) and save.js can reset and repair it without importing the board's logic. Pure.
//
//   state.bounties = { v:1, slots: [Contract|null x3], draws, freeRerollAt, completed, unlocked, extraFree }    PER DYNASTY
//     Contract = { id, kind, params, progress, goal, reward: { gold, renown, xp }, done }
//     draws: contracts drawn so far this dynasty (the seed of the next draw); freeRerollAt: active seconds from which the next free
//     reroll is available; completed: contracts paid this dynasty; unlocked: the board has opened (it stays open);
//     extraFree: free rerolls left from the Contractor deed (null until the board first opens this dynasty).
import { BOUNTIES } from '../config/bounties.js';

export function defaultBounties() {
  return { v: 1, slots: Array.from({ length: BOUNTIES.slots }, () => null), draws: 0, freeRerollAt: 0, completed: 0, unlocked: false, extraFree: null };
}

const KINDS = new Set(Object.keys(BOUNTIES.kinds));
const MAX_SLOTS = 8; // a save may hold more than BOUNTIES.slots (PLAN-PHASE5: Bounty Hunters 4, + Scribes 5); bountyState pads to the live count
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

function sanitizeParams(kind, raw) {
  const p = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  if (kind === 'typed' && BOUNTIES.types.includes(p.type)) out.type = p.type;
  if (kind === 'twist' && BOUNTIES.twists.includes(p.twist)) out.twist = p.twist;
  if ((kind === 'general' || kind === 'ability') && typeof p.generalId === 'string' && p.generalId.length <= 40) out.generalId = p.generalId;
  if (kind === 'prosper' && (p.level === 2 || p.level === 3)) out.level = p.level;
  if (kind === 'chain') out.lastAt = p.lastAt != null && Number.isFinite(Number(p.lastAt)) ? Number(p.lastAt) : null;
  if (kind === 'scout' && Array.isArray(p.marked)) out.marked = p.marked.filter((x) => Number.isInteger(x) && x >= 0).slice(-8);
  if (kind === 'typed' && !out.type) return null;
  if (kind === 'twist' && !out.twist) return null;
  if ((kind === 'general' || kind === 'ability') && !out.generalId) return null;
  if (kind === 'prosper' && !out.level) return null;
  if (kind === 'scout' && !out.marked) out.marked = [];
  return out;
}

/** A save's `bounties`, made valid (unknown kinds and broken contracts dropped, a duplicate kind dropped). Never throws. */
export function sanitizeBounties(raw) {
  const out = defaultBounties();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  out.draws = Math.max(0, Math.floor(num(raw.draws)));
  out.freeRerollAt = Math.max(0, num(raw.freeRerollAt));
  out.completed = Math.max(0, Math.floor(num(raw.completed)));
  out.unlocked = raw.unlocked === true;
  out.extraFree = raw.extraFree == null ? null : Math.max(0, Math.min(9, Math.floor(num(raw.extraFree))));
  const seen = new Set();
  if (Array.isArray(raw.slots)) {
    for (let i = 0; i < Math.min(raw.slots.length, MAX_SLOTS); i++) {
      const c = raw.slots[i];
      if (!c || typeof c !== 'object' || !KINDS.has(c.kind) || seen.has(c.kind)) continue;
      const params = sanitizeParams(c.kind, c.params);
      if (!params) continue;
      const goal = Math.max(1, Math.min(10, Math.floor(num(c.goal, 1))));
      const r = c.reward && typeof c.reward === 'object' ? c.reward : {};
      seen.add(c.kind);
      out.slots[i] = {
        id: Math.max(0, Math.floor(num(c.id))), kind: c.kind, params,
        progress: Math.max(0, Math.min(goal, Math.floor(num(c.progress)))), goal,
        reward: { gold: Math.max(0, num(r.gold)), renown: Math.max(0, Math.floor(num(r.renown))), xp: Math.max(0, Math.floor(num(r.xp))) },
        done: c.done === true,
      };
    }
  }
  for (let i = 0; i < out.slots.length; i++) if (out.slots[i] === undefined) out.slots[i] = null;
  return out;
}
