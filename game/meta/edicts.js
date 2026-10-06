// Edicts and Challenges (PLAN-PHASE5 §5A, §5C) and the ONE modifier source of Phase 5: `edictMods(state)` folds this dynasty's
// Edict, its Challenges and the lifetime Legacy nodes into a flat object every existing code path reads. A LEAF (config, core/rng and
// the legacy leaf only), so economy.js, progression.js, frontier.js, renownState.js and the rest can read it without a cycle.
// Pure: no DOM, no Date.now, no Math.random, no storage.
//
//   state.edict = { v:1, id: string|null, challenges: string[], scoutsUsed }      PER DYNASTY (set by foundDynasty)
//     scoutsUsed: free scouts taken this dynasty (the Spymaster node)
import { EDICT_NEUTRAL, EDICT_MAX_KEYS, EDICT_LIST, EDICTS, CHALLENGE_LIST, CHALLENGES } from '../config/edicts.js';
import { BOUNTIES } from '../config/bounties.js';
import { hash32 } from '../core/rng.js';
import { rivalsOf, classicRivals } from './rivals.js';
import { legacyNodes, legacyNode, legacyTree, cleanChallenges } from './legacy.js';

const BY_ID = new Map(EDICT_LIST.map((e) => [e.id, e]));
const CH_BY_ID = new Map(CHALLENGE_LIST.map((c) => [c.id, c]));
const MAX = new Set(EDICT_MAX_KEYS);
const NEUTRAL = Object.freeze({ ...EDICT_NEUTRAL, bountySlots: BOUNTIES.slots });

export function defaultEdict() {
  return { v: 1, id: null, challenges: [], scoutsUsed: 0 };
}

/** Creates (or repairs) `state.edict` and returns it. */
export function ensureEdict(state) {
  if (!state.edict || typeof state.edict !== 'object' || state.edict.v !== 1) state.edict = defaultEdict();
  const e = state.edict;
  if (!Array.isArray(e.challenges)) e.challenges = [];
  if (!Number.isFinite(e.scoutsUsed)) e.scoutsUsed = 0;
  return e;
}

export function isEdictId(id) {
  return BY_ID.has(id);
}

function fold(out, mods) {
  for (const [k, v] of Object.entries(mods)) {
    if (!(k in out)) continue;
    if (typeof v === 'boolean') out[k] = NEUTRAL[k] === true ? out[k] && v : out[k] || v;
    else if (k.endsWith('Mult')) out[k] *= v;
    else if (MAX.has(k)) out[k] = Math.max(out[k], v);
    else out[k] += v;
  }
}

let memoKey = null;
let memoVal = null;

/**
 * Every Phase 5 modifier for this state, neutral when there is no Edict, no Challenge and no Legacy (EDICT_NEUTRAL in
 * config/edicts.js documents each key). `bountySlots` already includes Scribes; `edictChoices` is the number of Edicts offered.
 * Integration does no maths: the meta functions read this themselves.
 * @returns {object} frozen
 */
export function edictMods(state) {
  const e = state && state.edict;
  const id = e && BY_ID.has(e.id) ? e.id : null;
  const ch = e && Array.isArray(e.challenges) ? e.challenges : [];
  const nodes = legacyNodes(state);
  const cm = state && state.challenge && state.challenge.mods && typeof state.challenge.mods === 'object' ? state.challenge.mods : null; // PLAN-PHASE9: a challenge sandbox's own mods
  const key = `${id}|${ch.join(',')}|${Object.keys(nodes).join(',')}|${cm ? JSON.stringify(cm) : ''}`;
  if (key === memoKey) return memoVal;
  const out = { ...NEUTRAL };
  if (id) fold(out, BY_ID.get(id).mods);
  if (cm) fold(out, cm);
  for (const c of cleanChallenges(ch)) fold(out, CH_BY_ID.get(c).mods);
  for (const n of Object.keys(nodes)) { const d = nodes[n] === true ? legacyNode(n) : null; if (d) fold(out, d.mods); }
  out.bountySlots += out.bountySlotsAdd;
  out.edictChoices = EDICTS.choices + out.edictChoicesAdd;
  memoKey = key;
  memoVal = Object.freeze(out);
  return memoVal;
}

/** The mods an Edict id alone brings (for world generation and previews), neutral for none. */
export function modsOfEdict(id) {
  const out = { ...NEUTRAL };
  if (BY_ID.has(id)) fold(out, BY_ID.get(id).mods);
  return out;
}

/** The options for `generateWorld(seed, opts)` for this state: `{ dynasty, edict }` (edict omitted when none). Use it EVERYWHERE a world is (re)generated for a state. */
export function worldOptsFor(state) {
  const opts = { dynasty: (state && state.dynasty && state.dynasty.level) || 1 };
  const id = state && state.edict && BY_ID.has(state.edict.id) ? state.edict.id : null;
  if (id) opts.edict = id;
  const rivals = rivalsOf(state); // PLAN-PHASE6 §6A: the dynasty's rival line-up (stored at founding); omitted when classic (byte-identical)
  if (!classicRivals(rivals)) opts.rivals = rivals;
  if (state && state.archipelago === true) opts.archipelago = true; // PLAN-PHASE12: islands, fords, harbours and sea lanes (omitted on land: byte-identical)
  return opts;
}

// --- Copy ------------------------------------------------------------------------------------------------------------------------

const SHARES = [[0.5, 'half'], [1 / 3, 'a third of'], [0.25, 'a quarter of']];

/** Fills a template (`{pct:k}`, `{x:k}`, `{n:k}`, `{share:k}`) from a mods object. */
export function fillTemplate(text, mods) {
  return String(text).replace(/\{(pct|x|n|share):(\w+)\}/g, (_, kind, k) => {
    const v = mods[k];
    if (typeof v !== 'number') return '';
    if (kind === 'pct') return `${Math.round(Math.abs(k.endsWith('Mult') ? v - 1 : v) * 100)}%`;
    if (kind === 'x') return `×${+v.toFixed(2)}`;
    if (kind === 'share') { const s = SHARES.find(([x]) => Math.abs(x - v) < 1e-6); return s ? s[1] : `${Math.round(v * 100)}% of`; }
    return String(+v.toFixed(2));
  });
}

/** `{ id, name, icon, upside, cost }` with the lines built from config numbers; null for an unknown id. */
export function edictInfo(id) {
  const e = BY_ID.get(id);
  if (!e) return null;
  const m = modsOfEdict(id);
  return { id: e.id, name: e.name, icon: e.icon, upside: fillTemplate(e.upside, m), cost: fillTemplate(e.cost, m) };
}

/** Every Edict's info, in config order (a codex). */
export function allEdicts() {
  return EDICT_LIST.map((e) => edictInfo(e.id));
}

/** `{ id, name, icon, text, bonus }` for a Challenge (bonus: the Legacy share it adds, e.g. 0.5); null for an unknown id. */
export function challengeInfo(id) {
  const c = CH_BY_ID.get(id);
  if (!c) return null;
  const m = { ...NEUTRAL };
  fold(m, c.mods);
  return { id: c.id, name: c.name, icon: c.icon, text: fillTemplate(c.text, m), bonus: CHALLENGES.legacyBonus };
}

export function allChallenges() {
  return CHALLENGE_LIST.map((c) => challengeInfo(c.id));
}

/** The Legacy tree with each node's `effectText` filled from its numbers (legacy.js legacyTree + copy). */
export function legacyTreeText() {
  return legacyTree().map((b) => ({
    ...b,
    nodes: b.nodes.map((n) => { const m = { ...NEUTRAL }; fold(m, n.mods); return { id: n.id, name: n.name, cost: n.cost, requires: n.requires, effectText: fillTemplate(n.effect, m) }; }),
  }));
}

/**
 * The Edicts offered at the founding that leaves this dynasty for `nextSeed`: EDICTS.choices of them (one more with Heralds), drawn
 * without repeats, seeded from (nextSeed, the NEW dynasty level). Deterministic. Returns edictInfo objects.
 */
export function edictChoices(state, nextSeed, opts = {}) {
  const level = ((state && state.dynasty && state.dynasty.level) || 1) + 1;
  // opts.legacyNodes: a PREVIEW Legacy record's nodes ({ [id]: true }, e.g. Heralds bought in the ceremony but not yet applied)
  const nodes = opts && opts.legacyNodes && typeof opts.legacyNodes === 'object' ? opts.legacyNodes : legacyNodes(state);
  const n = Math.min(EDICT_LIST.length, edictMods({ edict: null, generals: { legacy: { nodes } } }).edictChoices);
  const ranked = EDICT_LIST.map((e) => ({ id: e.id, h: hash32((nextSeed >>> 0), 'edict', level, e.id) }))
    .sort((a, b) => a.h - b.h || (a.id < b.id ? -1 : 1));
  return ranked.slice(0, n).map((x) => edictInfo(x.id));
}

/** The current dynasty's Edict info (null under standard rules) and Challenges, for the Realm panel. */
export function currentEdict(state) {
  const e = state && state.edict;
  return {
    edict: e && BY_ID.has(e.id) ? edictInfo(e.id) : null,
    challenges: cleanChallenges(e ? e.challenges : []).map(challengeInfo),
  };
}

/** Free scouts left this dynasty (the Spymaster node). */
export function freeScoutsLeft(state) {
  const m = edictMods(state);
  const used = state && state.edict && Number.isFinite(state.edict.scoutsUsed) ? state.edict.scoutsUsed : 0;
  return Math.max(0, m.freeScouts - used);
}

/** A save's `edict`, made valid. An old save (none) plays by the standard rules. Never throws. */
export function sanitizeEdict(raw) {
  const out = defaultEdict();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  out.id = BY_ID.has(raw.id) ? raw.id : null;
  out.challenges = cleanChallenges(raw.challenges);
  out.scoutsUsed = Number.isFinite(Number(raw.scoutsUsed)) ? Math.max(0, Math.min(99, Math.floor(Number(raw.scoutsUsed)))) : 0;
  return out;
}

/** The commander a run may have: null under Lone Banner (the Militia Captain commands every battle), else `generalId` as given. */
export function commanderFor(state, generalId) {
  return edictMods(state).forceCaptain ? null : generalId ?? null;
}
