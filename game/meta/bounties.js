// The Bounty Board (PLAN-PHASE4 §4A): three optional contracts, seeded per dynasty, only possible ones drawn, never two of a kind,
// rewards priced from the realm's income. Pure: no DOM, no Date.now, no Math.random, no storage. Times are active seconds.
//
// Integration (docs/briefs/phase4-hookup.md has the wiring):
//   ensureBounties(state, world)                          when the board may show (each frontier tick is fine): opens it, fills
//                                                         empty slots, re-prices the gold
//   onBattleEnd(state, world, run, result, summary)       every finished battle (summary: crowns.js battleSummaryFor)
//   onConquest(state, world, regionId, conquerResult)     after every conquer() (battles and surrenders)
//   onProsperity(state, world, levelUps)                  after updateProsperity() returns level-ups (and after a Festival)
//   onFortBuilt(state, world, regionId, type)             after buildFort / upgradeFort / a Merchant fortification
//   onScout(state, world, regionId)                       after a paid scout
//   claimCompleted(state, world, completed, nowMs)        right after any on* returned completions: pays and redraws
//   rerollBounty(state, world, slotIndex)                 the Reroll button
//   bountyText(contract, world, state), bountyProgress(state, world, contract), rerollInfo(state)   for the board
import { BOUNTIES } from '../config/bounties.js';
import { hash32 } from '../core/rng.js';
import { PLAYER_FACTION } from './state.js';
import { defaultBounties } from './bountiesState.js';
import { incomePerSec } from './economy.js';
import { attackableFrontier, difficulty } from './progression.js';
import { borderingRivals } from './frontier.js';
import { isScoutedOrFree } from './intel.js';
import { fortsOf, fortSlots } from './fortsEffects.js';
import { fortMaxLevel } from './forts.js';
import { generalById, ensureGenerals, addRawXp, recordGeneralLevels } from './generalsState.js';
import { earnRenown, renownPoints, spendRenown } from './renownState.js';
import { recordDeed, deedBonuses } from './deeds.js';
import { edictMods } from './edicts.js'; // the leaf (PLAN-PHASE5): Bounty Hunters' slots and pay, the Scribes node

export * from './bountiesState.js';

const KIND_IDS = Object.keys(BOUNTIES.kinds);

function nowSec(state) {
  const f = state.frontier;
  return f && Number.isFinite(f.activeSec) ? f.activeSec : 0;
}

/** Creates (or repairs) `state.bounties` and returns it. Does not draw (ensureBounties does). */
export function bountyState(state) {
  if (!state.bounties || typeof state.bounties !== 'object' || state.bounties.v !== 1 || !Array.isArray(state.bounties.slots)) state.bounties = defaultBounties();
  const b = state.bounties;
  while (b.slots.length < bountySlots(state)) b.slots.push(null);
  return b;
}

/** Slots on the board this dynasty: BOUNTIES.slots, 4 under Bounty Hunters, +1 with the Scribes node (PLAN-PHASE5). */
export function bountySlots(state) {
  return edictMods(state).bountySlots;
}

function ownedCount(state) {
  let n = 0;
  for (const o of state.owner) if (o === PLAYER_FACTION) n += 1;
  return n;
}

/** Regions not yet the player's on the attackable frontier or within BOUNTIES.reachSteps steps of it. */
function reachable(state, world) {
  const front = attackableFrontier(state, world);
  const seen = new Set(front);
  let ring = front;
  for (let d = 0; d < BOUNTIES.reachSteps; d++) {
    const next = [];
    for (const id of ring) {
      for (const n of world.regions[id].neighbors) {
        if (seen.has(n) || state.owner[n] === PLAYER_FACTION) continue;
        seen.add(n);
        next.push(n);
      }
    }
    ring = next;
  }
  return { front, reach: [...seen].sort((a, b) => a - b) };
}

/** Fort and tower sites a battle for this region could offer (its own settlements; Ruins add the Ancient Tower). */
function fortSiteCount(world, region) {
  let n = 0;
  for (const sid of region.settlements) {
    const t = world.settlements[sid].type;
    if (t === 'fort' || t === 'tower') n += 1;
  }
  if (region.type === 'ruins') n += 1;
  return n;
}

/** Every way `kind` could be drawn now: [{ params, goal }], empty when it is not possible. */
function options(state, world, kind, ctx) {
  const k = BOUNTIES.kinds[kind];
  switch (kind) {
    case 'noPowers':
    case 'chain':
      return [{ params: kind === 'chain' ? { lastAt: null } : {}, goal: kind === 'chain' ? 2 : 1 }];
    case 'forts': {
      const best = Math.max(0, ...ctx.front.map((id) => fortSiteCount(world, world.regions[id])));
      const out = [];
      for (let n = k.n[0]; n <= k.n[1]; n++) if (best >= n) out.push({ params: {}, goal: n });
      return out;
    }
    case 'swiftHard':
      return ctx.front.some((id) => { const l = difficulty(state, world, id).label; return l === 'Hard' || l === 'Deadly'; })
        ? [{ params: {}, goal: 1 }] : [];
    case 'cleanDefense':
      return borderingRivals(state, world).length ? [{ params: {}, goal: 1 }] : [];
    case 'typed': {
      const types = new Set(ctx.reach.map((id) => world.regions[id].type).filter((t) => BOUNTIES.types.includes(t)));
      return BOUNTIES.types.filter((t) => types.has(t)).map((type) => ({ params: { type }, goal: 1 }));
    }
    case 'twist': {
      const twists = new Set(ctx.reach.map((id) => world.regions[id].twist).filter((t) => BOUNTIES.twists.includes(t)));
      return BOUNTIES.twists.filter((t) => twists.has(t)).map((twist) => ({ params: { twist }, goal: 1 }));
    }
    case 'general':
    case 'ability':
      return ensureGenerals(state).roster.map((g) => ({ params: { generalId: g.id }, goal: 1 }));
    case 'prosper': {
      const levels = [];
      for (const r of world.regions) {
        if (state.owner[r.id] !== PLAYER_FACTION) continue;
        const l = Array.isArray(state.prosperity) && Number.isInteger(state.prosperity[r.id]) ? state.prosperity[r.id] : 0;
        levels.push(l);
      }
      const out = [];
      if (levels.some((l) => l < 2)) out.push({ params: { level: 2 }, goal: 1 });
      if (levels.some((l) => l === 2)) out.push({ params: { level: 3 }, goal: 1 });
      return out;
    }
    case 'fortify': {
      let room = 0;
      for (const r of world.regions) {
        if (state.owner[r.id] !== PLAYER_FACTION) continue;
        const built = fortsOf(state, r.id);
        room += Math.max(0, fortSlots(state, r.id) - built.length) * 2;
        for (const f of built) room += Math.max(0, fortMaxLevel(f.type) - f.level);
      }
      const out = [];
      for (let n = k.n[0]; n <= k.n[1]; n++) if (room >= n) out.push({ params: {}, goal: n });
      return out;
    }
    case 'retake':
      return state.occupation && Object.keys(state.occupation).length ? [{ params: {}, goal: 1 }] : [];
    case 'scout':
      return ctx.front.some((id) => !isScoutedOrFree(state, world, id)) ? [{ params: { marked: [] }, goal: 1 }] : [];
    default:
      return [];
  }
}

/** The gold a contract pays now: the realm's income x its minutes x 60 (rounded). */
function goldFor(state, world, contract) {
  const k = BOUNTIES.kinds[contract.kind];
  let minutes = k.minutes;
  if (k.perN) minutes *= contract.goal;
  if (contract.kind === 'prosper' && k.levelMinutes) minutes = k.levelMinutes[contract.params.level] ?? minutes;
  return Math.round(incomePerSec(state, world) * minutes * 60);
}

function price(state, world, contract) {
  const k = BOUNTIES.kinds[contract.kind];
  const m = edictMods(state).bountyRewardMult; // Bounty Hunters: contracts pay x2 (gold and Renown)
  contract.reward = { gold: Math.round(goldFor(state, world, contract) * m), renown: Math.round((k.renown || 0) * m), xp: k.xp ? BOUNTIES.xpBundle : 0 };
  return contract;
}

/** Draws a contract for a slot, avoiding the kinds in `exclude`. Seeded by (seed, dynasty, draws). Null when nothing is possible. */
function draw(state, world, exclude) {
  const b = bountyState(state);
  const ctx = reachable(state, world);
  const pool = [];
  for (const kind of KIND_IDS) {
    if (exclude.has(kind)) continue;
    const opts = options(state, world, kind, ctx);
    if (opts.length) pool.push({ kind, opts, w: BOUNTIES.kinds[kind].weight });
  }
  if (!pool.length) return null;
  const seed = state.seed ?? 0;
  const dyn = state.dynasty ? state.dynasty.level : 1;
  const n = b.draws++;
  const total = pool.reduce((a, p) => a + p.w, 0);
  let x = (hash32(seed, dyn, 'bounty', n) / 4294967296) * total;
  let pick = pool[pool.length - 1];
  for (const p of pool) { x -= p.w; if (x < 0) { pick = p; break; } }
  const opt = pick.opts[hash32(seed, dyn, 'bounty-opt', n) % pick.opts.length];
  return price(state, world, { id: n, kind: pick.kind, params: structuredClone(opt.params), progress: 0, goal: opt.goal, reward: null, done: false });
}

function kindsExcept(b, slotIndex) {
  const s = new Set();
  b.slots.forEach((c, i) => { if (c && i !== slotIndex) s.add(c.kind); });
  return s;
}

/**
 * Opens the board once the player holds BOUNTIES.unlockOwned regions (after the first conquest; never in the tutorial), fills every
 * empty slot with a possible contract and re-prices every contract's gold. Idempotent apart from the draws it makes. MUTATES.
 * @returns {object} state.bounties
 */
export function ensureBounties(state, world) {
  const b = bountyState(state);
  if (!b.unlocked && ownedCount(state) >= BOUNTIES.unlockOwned) b.unlocked = true;
  if (!b.unlocked) return b;
  if (b.extraFree == null) b.extraFree = deedBonuses(state).freeRerolls;
  for (let i = 0; i < bountySlots(state); i++) {
    if (!b.slots[i]) b.slots[i] = draw(state, world, kindsExcept(b, i));
  }
  for (const c of b.slots) if (c && !c.done) price(state, world, c);
  return b;
}

/** True while the board is open. */
export function bountiesUnlocked(state) {
  return !!(state.bounties && state.bounties.unlocked);
}

/** The contract's text, e.g. "Conquer a Gold Mine", "Win a battle commanded by Marshal Edric". */
export function bountyText(contract, world, state) {
  void world;
  if (!contract) return '';
  const c = BOUNTIES.copy;
  const p = contract.params || {};
  const general = p.generalId && state ? generalById(state, p.generalId) : null;
  return (c.text[contract.kind] || '')
    .replace('{n}', String(contract.goal))
    .replace('{type}', c.typeNames[p.type] || '')
    .replace('{twist}', c.twistNames[p.twist] || '')
    .replace('{general}', general ? general.name : 'your General')
    .replace('{level}', c.levels[p.level] || '');
}

/** `{ progress, goal }` for the board's "1/2". */
export function bountyProgress(state, world, contract) {
  void state; void world;
  if (!contract) return { progress: 0, goal: 1 };
  return { progress: contract.done ? contract.goal : Math.min(contract.goal, contract.progress || 0), goal: contract.goal };
}

function complete(b, i, extra = {}) {
  const c = b.slots[i];
  c.progress = c.goal;
  c.done = true;
  return { slot: i, contract: c, ...extra };
}

function active(state) {
  const b = state.bounties;
  if (!b || !b.unlocked || !Array.isArray(b.slots)) return null;
  return b;
}

/**
 * A finished battle. `summary` from crowns.js battleSummaryFor: { kind, won, powersUsed, capturesByType, twist, labelAtAttack,
 * commander, abilityUsed, crowns, playerSitesLost }. Duels count for nothing. MUTATES the contracts' progress.
 * @returns {{ slot:number, contract:object, commander:string|null }[]} completions: pass them to claimCompleted
 */
export function onBattleEnd(state, world, run, result, summary) {
  void world;
  const b = active(state);
  if (!b || !summary) return [];
  const kind = summary.kind || (run && run.kind) || 'attack';
  if (kind !== 'attack' && kind !== 'defense') return [];
  const won = summary.won ?? result === 'win';
  const commander = summary.commander ?? (run && run.commander) ?? null;
  const out = [];
  b.slots.forEach((c, i) => {
    if (!c || c.done) return;
    const p = c.params || {};
    switch (c.kind) {
      case 'noPowers':
        if (won && (summary.powersUsed || 0) === 0 && summary.twist !== 'holy') out.push(complete(b, i, { commander }));
        break;
      case 'forts': {
        const caps = summary.capturesByType || {};
        const n = (caps.fort || 0) + (caps.tower || 0);
        c.progress = Math.max(c.progress || 0, Math.min(c.goal, n));
        if (n >= c.goal) out.push(complete(b, i, { commander }));
        break;
      }
      case 'swiftHard':
        if (won && kind === 'attack' && summary.crowns && summary.crowns.swift && (summary.labelAtAttack === 'Hard' || summary.labelAtAttack === 'Deadly')) out.push(complete(b, i, { commander }));
        break;
      case 'cleanDefense':
        if (won && kind === 'defense' && (summary.playerSitesLost || 0) === 0) out.push(complete(b, i, { commander }));
        break;
      case 'twist':
        if (won && summary.twist === p.twist) out.push(complete(b, i, { commander }));
        break;
      case 'general':
        if (won && commander && commander === p.generalId) out.push(complete(b, i, { commander }));
        break;
      case 'ability':
        // a Quick Conquest (PLAN-PHASE5 §5D) is not watched: its ability use does not count
        if (won && summary.abilityUsed && !summary.quick && commander && commander === p.generalId) out.push(complete(b, i, { commander }));
        break;
      default:
    }
  });
  return out;
}

/** After every conquer() (a battle won or a surrender): typed, chain, retake, scout. MUTATES. @returns completions */
export function onConquest(state, world, regionId, conquerResult) {
  const b = active(state);
  if (!b) return [];
  const region = world.regions[regionId];
  const retaken = !!(conquerResult && conquerResult.retaken);
  const t = nowSec(state);
  const out = [];
  b.slots.forEach((c, i) => {
    if (!c || c.done) return;
    const p = c.params || (c.params = {});
    if (c.kind === 'typed' && region && region.type === p.type && !retaken) out.push(complete(b, i));
    else if (c.kind === 'retake' && retaken) out.push(complete(b, i));
    else if (c.kind === 'scout' && Array.isArray(p.marked) && p.marked.includes(regionId)) out.push(complete(b, i));
    else if (c.kind === 'chain') {
      if (p.lastAt != null && t - p.lastAt <= BOUNTIES.chainWindowSec + 1e-9) out.push(complete(b, i));
      else { p.lastAt = t; c.progress = 1; }
    }
  });
  return out;
}

/** After prosperity level-ups ([{ regionId, level, from }], as updateProsperity returns them; a Festival too). @returns completions */
export function onProsperity(state, world, levelUps) {
  void world;
  const b = active(state);
  if (!b || !Array.isArray(levelUps) || !levelUps.length) return [];
  const out = [];
  b.slots.forEach((c, i) => {
    if (!c || c.done || c.kind !== 'prosper') return;
    const L = c.params && c.params.level;
    if (levelUps.some((u) => u && u.level >= L && (u.from ?? 0) < L)) out.push(complete(b, i));
  });
  return out;
}

/** After a fortification level is built (a build or an upgrade is one level). @returns completions */
export function onFortBuilt(state, world, regionId, type) {
  void world; void regionId; void type;
  const b = active(state);
  if (!b) return [];
  const out = [];
  b.slots.forEach((c, i) => {
    if (!c || c.done || c.kind !== 'fortify') return;
    c.progress = (c.progress || 0) + 1;
    if (c.progress >= c.goal) out.push(complete(b, i));
  });
  return out;
}

/** After a paid scout: a `scout` contract remembers the region (conquering it then completes the contract). MUTATES. */
export function onScout(state, world, regionId) {
  void world;
  const b = active(state);
  if (!b) return [];
  for (const c of b.slots) {
    if (!c || c.done || c.kind !== 'scout') continue;
    const p = c.params || (c.params = {});
    if (!Array.isArray(p.marked)) p.marked = [];
    if (!p.marked.includes(regionId)) p.marked.push(regionId);
    if (p.marked.length > 8) p.marked.splice(0, p.marked.length - 8);
  }
  return [];
}

/**
 * Pays completed contracts (gold at today's price, Renown, the XP bundle to the commander of the win) and draws replacements into
 * their slots. Records the Contractor deed. MUTATES. Completions already paid (their slot holds another contract) are skipped.
 * @param {{ slot:number, contract:object, commander?:string|null }[]} completed what an on* function returned
 * @returns {{ gold:number, renown:number, xp:number, replaced:number[], claimed:object[], general:string|null }}
 */
export function claimCompleted(state, world, completed, nowMs) {
  void nowMs;
  const out = { gold: 0, renown: 0, xp: 0, replaced: [], claimed: [], general: null };
  const b = active(state);
  if (!b || !Array.isArray(completed)) return out;
  for (const item of completed) {
    if (!item || !item.contract) continue;
    const i = b.slots.findIndex((c) => c && c.id === item.contract.id && c.done);
    if (i < 0) continue;
    const c = b.slots[i];
    price(state, world, c);
    const gold = c.reward.gold;
    state.gold += gold;
    if (state.stats) state.stats.goldEarned += gold;
    out.gold += gold;
    out.renown += earnRenown(state, c.reward.renown, 'bounty');
    if (c.reward.xp > 0) {
      const g = generalById(state, item.commander);
      if (g) {
        addRawXp(g, c.reward.xp);
        out.xp += c.reward.xp;
        out.general = g.id;
        recordGeneralLevels(state);
      }
    }
    b.completed += 1;
    recordDeed(state, 'bounty', 1);
    out.claimed.push(c);
    b.slots[i] = null;
    b.slots[i] = draw(state, world, kindsExcept(b, i));
    out.replaced.push(i);
  }
  return out;
}

/** What the next reroll costs now: `{ free:boolean, cost:'free'|number, freeInSec:number, extraFree:number }`. */
export function rerollInfo(state) {
  const b = state.bounties || defaultBounties();
  const t = nowSec(state);
  const timerFree = t >= (b.freeRerollAt || 0);
  const extra = b.extraFree || 0;
  const free = timerFree || extra > 0;
  return { free, cost: free ? 'free' : BOUNTIES.rerollRenown, freeInSec: Math.max(0, (b.freeRerollAt || 0) - t), extraFree: extra };
}

/**
 * Replaces the contract in `slotIndex` with a different possible one: free once per BOUNTIES.freeRerollSec active seconds (then a
 * Contractor deed's spare reroll), otherwise BOUNTIES.rerollRenown Renown. Nothing is charged when it fails. MUTATES.
 * @returns {{ ok:boolean, cost?:'free'|number, reason?:'locked'|'empty'|'renown'|'none', contract?:object }}
 */
export function rerollBounty(state, world, slotIndex) {
  const b = active(state);
  if (!b) return { ok: false, reason: 'locked' };
  const old = b.slots[slotIndex];
  if (!old || old.done) return { ok: false, reason: 'empty' };
  const info = rerollInfo(state);
  if (!info.free && renownPoints(state) < BOUNTIES.rerollRenown) return { ok: false, reason: 'renown' };
  const exclude = kindsExcept(b, slotIndex);
  exclude.add(old.kind);
  const next = draw(state, world, exclude);
  if (!next) return { ok: false, reason: 'none' };
  b.slots[slotIndex] = next;
  const t = nowSec(state);
  let cost;
  if (t >= (b.freeRerollAt || 0)) { b.freeRerollAt = t + BOUNTIES.freeRerollSec; cost = 'free'; }
  else if ((b.extraFree || 0) > 0) { b.extraFree -= 1; cost = 'free'; }
  else { spendRenown(state, BOUNTIES.rerollRenown); cost = BOUNTIES.rerollRenown; }
  return { ok: true, cost, contract: next };
}
