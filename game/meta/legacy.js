// Legacy (PLAN-PHASE5 §5B): a tree of permanent unlocks bought with Legacy points earned at each founding. A LEAF (config only), so
// meta/edicts.js (edictMods folds the nodes in), progression.js (foundDynasty pays the points) and save.js can use it without a cycle.
// Pure: no DOM, no Date.now, no Math.random, no storage.
//
//   state.generals.legacy = { v:1, points, spent, nodes: { [nodeId]: true }, pendingBonus }      LIFETIME (rides with the Deeds)
//     points: every Legacy point ever earned; spent: points spent on nodes; available = points - spent
//     pendingBonus: the Challenge bonus the dynasty in progress will add at the next founding (CHALLENGES.legacyBonus x Challenges ticked)
import { LEGACY_BRANCHES } from '../config/legacy.js';
import { CHALLENGES, CHALLENGE_LIST } from '../config/edicts.js';
import { DYNASTY } from '../config/meta.js';
import { ascensionLegacyMult } from './ascension.js'; // a leaf (PLAN-PHASE13)

const NODES = new Map();
for (const b of LEGACY_BRANCHES) {
  b.nodes.forEach((n, i) => NODES.set(n.id, { ...n, branch: b.id, requires: i > 0 ? b.nodes[i - 1].id : null }));
}
const CHALLENGE_IDS = new Set(CHALLENGE_LIST.map((c) => c.id));

export function defaultLegacy() {
  return { v: 1, points: 0, spent: 0, nodes: {}, pendingBonus: 0 };
}

/** Creates (or repairs) `state.generals.legacy` and returns it. */
export function ensureLegacy(state) {
  if (!state.generals || typeof state.generals !== 'object') state.generals = { seq: 1, roster: [] }; // ensureGenerals adds the Marshal
  const g = state.generals;
  if (!g.legacy || typeof g.legacy !== 'object' || g.legacy.v !== 1) g.legacy = defaultLegacy();
  if (!g.legacy.nodes || typeof g.legacy.nodes !== 'object') g.legacy.nodes = {};
  return g.legacy;
}

/** The node ids owned (read only; never creates the record). */
export function legacyNodes(state) {
  const l = state && state.generals && state.generals.legacy;
  return l && l.nodes && typeof l.nodes === 'object' ? l.nodes : {};
}

export function hasLegacy(state, nodeId) {
  return legacyNodes(state)[nodeId] === true;
}

/** The node's definition `{ id, name, cost, mods, effect, branch, requires }`, or null. */
export function legacyNode(nodeId) {
  return NODES.get(nodeId) || null;
}

/** The tree for the UI: branches with their nodes `{ id, name, cost, effectText, requires }` (effectText is filled by edicts.js legacyTreeText). */
export function legacyTree() {
  return LEGACY_BRANCHES.map((b) => ({
    id: b.id, name: b.name, icon: b.icon,
    nodes: b.nodes.map((n) => { const d = NODES.get(n.id); return { id: d.id, name: d.name, cost: d.cost, effect: d.effect, mods: d.mods, requires: d.requires }; }),
  }));
}

/** `{ points, spent, available, pendingBonus, nodes: { [id]: 'owned'|'buyable'|'locked'|'poor' } }`. */
export function legacyInfo(state) {
  const l = (state && state.generals && state.generals.legacy) || defaultLegacy();
  const available = Math.max(0, (l.points || 0) - (l.spent || 0));
  const nodes = {};
  for (const [id, n] of NODES) {
    if (l.nodes && l.nodes[id]) nodes[id] = 'owned';
    else if (n.requires && !(l.nodes && l.nodes[n.requires])) nodes[id] = 'locked';
    else nodes[id] = available >= n.cost ? 'buyable' : 'poor';
  }
  return { points: l.points || 0, spent: l.spent || 0, available, pendingBonus: l.pendingBonus || 0, nodes };
}

/** Why a node cannot be bought now, or null: 'unknown' | 'owned' | 'locked' | 'points'. */
export function legacyRefusal(state, nodeId) {
  const n = NODES.get(nodeId);
  if (!n) return 'unknown';
  const st = legacyInfo(state).nodes[nodeId];
  if (st === 'owned') return 'owned';
  if (st === 'locked') return 'locked';
  if (st === 'poor') return 'points';
  return null;
}

/** Buys a node. MUTATES. Nodes are permanent. @returns {{ ok: boolean, reason?: string, node?: string }} */
export function buyLegacy(state, nodeId) {
  const reason = legacyRefusal(state, nodeId);
  if (reason) return { ok: false, reason };
  const l = ensureLegacy(state);
  l.nodes[nodeId] = true;
  l.spent += NODES.get(nodeId).cost;
  return { ok: true, node: nodeId };
}

/** The valid Challenge ids in a list (unique, known, in config order). */
export function cleanChallenges(list) {
  if (!Array.isArray(list)) return [];
  return CHALLENGE_LIST.map((c) => c.id).filter((id) => list.includes(id) && CHALLENGE_IDS.has(id));
}

/**
 * The Legacy points founding now pays: the stars it earns (DYNASTY.starBase + the level completed) x (1 + CHALLENGES.legacyBonus x
 * the Challenges this dynasty was played with), rounded. `foundDynasty` adds it.
 */
export function legacyPointsForFounding(state) {
  const stars = DYNASTY.starBase + ((state && state.dynasty && state.dynasty.level) || 1);
  const ch = cleanChallenges(state && state.edict ? state.edict.challenges : []).length;
  return Math.round(stars * (1 + CHALLENGES.legacyBonus * ch) * ascensionLegacyMult(state)); // PLAN-PHASE13: +25% per Ascension level
}

/** A save's legacy, made valid: known nodes only (and only with their prerequisite), spent never above points. Never throws. */
export function sanitizeLegacy(raw) {
  const out = defaultLegacy();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const int = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(1e6, Math.floor(Number(v)))) : 0);
  out.points = int(raw.points);
  out.pendingBonus = Number.isFinite(Number(raw.pendingBonus)) ? Math.max(0, Math.min(10, Number(raw.pendingBonus))) : 0;
  let cost = 0;
  if (raw.nodes && typeof raw.nodes === 'object') {
    for (const b of LEGACY_BRANCHES) {
      for (const n of b.nodes) { // in branch order: a node without its prerequisite is dropped (and every node after it)
        if (raw.nodes[n.id] !== true) break;
        out.nodes[n.id] = true;
        cost += n.cost;
      }
    }
  }
  out.spent = Math.max(int(raw.spent), cost);
  out.points = Math.max(out.points, out.spent);
  return out;
}
