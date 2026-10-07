// Boons (docs/PLAN-PHASE7.md §7A): after every conquest won in battle the player picks 1 of 3 Boons that change how they fight, for the
// rest of the dynasty. The draft is seeded (seed, dynasty, draws); one offer can wait as "pending" (a new one replaces it). The
// modifiers themselves live in the leaf meta/boonsState.js (`boonMods`, re-exported here) and are read by the meta and sim paths.
// Pure: no DOM, no Date.now, no Math.random, no storage.
import { BOON_LIST, DUO_LIST, BOONS } from '../config/boons.js';
import { ASHEN_FACTION } from '../config/ashen.js';
import { hash32 } from '../core/rng.js';
import {
  BOON_BY_ID, ensureBoons2, boonMods, boonSimStats, duosOf, fillBoonText,
} from './boonsState.js';
import { edictMods } from './edicts.js';
import { renownPoints, spendRenown, earnRenown } from './renownState.js';
import { rivalsInWorld } from './rivals.js';
import { incomePerSec } from './economy.js';

export { boonMods, boonSimStats, fillBoonText };

const PLAYER = 0;

/** `{ id, name, rarity, cursed, icon, text, frame }` for a Boon (text built from config numbers); null for an unknown id. */
export function boonInfo(id) {
  const b = BOON_BY_ID.get(id);
  if (!b) return null;
  return {
    id: b.id, name: b.name, rarity: b.rarity, cursed: b.cursed, icon: b.icon, text: fillBoonText(b.text, b.mods),
    frame: b.cursed ? BOONS.frames.cursed : BOONS.frames[b.rarity],
  };
}

/** Every Boon's info, in config order (a codex). */
export function allBoons() {
  return BOON_LIST.map((b) => boonInfo(b.id));
}

function duoText(d) {
  return { id: d.id, name: d.name, icon: d.icon, parts: d.parts.slice(), text: fillBoonText(d.text, d.mods) };
}

/** The Boons owned this dynasty, as boonInfo objects, in pick order. */
export function ownedBoons(state) {
  const b = state && state.boons2;
  return b && Array.isArray(b.owned) ? b.owned.map(boonInfo).filter(Boolean) : [];
}

/** Every Duo with its state: `{ id, name, icon, parts, text, active, have: [part ids owned] }`. */
export function duoInfo(state) {
  const owned = state && state.boons2 && Array.isArray(state.boons2.owned) ? state.boons2.owned : [];
  return DUO_LIST.map((d) => ({ ...duoText(d), active: d.parts.every((p) => owned.includes(p)), have: d.parts.filter((p) => owned.includes(p)) }));
}

/** The pending offer as `{ choices: boonInfo[], source, missed }`, or null. */
export function pendingBoons(state) {
  const p = state && state.boons2 && state.boons2.pending;
  if (!p || !Array.isArray(p.choices) || !p.choices.length) return null;
  return { choices: p.choices.map(boonInfo).filter(Boolean), source: p.source || 'battle', missed: !!p.missed };
}

function ownedCount(state) {
  let n = 0;
  for (const o of state.owner || []) if (o === PLAYER) n += 1;
  return n;
}

/**
 * True once drafts happen: from the win after the first conquest (BOONS.unlockOwned regions held, the Bounty Board's moment; never the
 * tutorial fight), and from the first win in any later dynasty. conquer() asks BEFORE the region flips.
 */
export function boonsUnlocked(state) {
  if (state && state.challenge) return false; // PLAN-PHASE9: a challenge's Boons are fixed by its spec (no drafts)
  return !!state && (((state.dynasty && state.dynasty.level) || 1) > 1 || ownedCount(state) >= BOONS.unlockOwned);
}

/**
 * Does a battle win over `region` draft (BOONS.draftLabels / draftTyped / draftCapitals)? `label`: the card's label at attack time
 * (BattleRun.labelAtAttack). Pure: the unlock is boonsUnlocked's.
 */
export function winDrafts(region, label, hardOnly = false) {
  if (!region) return false;
  if (hardOnly) return label === 'Hard' || label === 'Deadly'; // Lean Fortunes (PLAN-PHASE13 Ascension 5): only Hard or Deadly wins draft
  if (BOONS.draftCapitals && region.isCapital) return true;
  if (BOONS.draftTyped && region.type) return true;
  return BOONS.draftLabels.includes(label);
}

/** Can this Boon do anything on this continent, under this dynasty's rules? (config/boons.js `requires`) */
export function boonRelevant(state, world, b) {
  const req = b.requires;
  if (!req) return true;
  const em = edictMods(state);
  if (req === 'powers') return !em.noPowers;
  if (req === 'ability') return !em.forceCaptain && !em.noAbility;
  if (req === 'raids') return em.raids !== false;
  if (req === 'streak') return em.streak !== false; // Rearguard: not under Bounty Hunters
  if (req === 'quick') return !!em.quickConquest; // Cartographer: only once the Quick Conquest Legacy is bought
  if (!world || !Array.isArray(world.regions)) return true;
  const open = (r) => state.owner[r.id] !== PLAYER;
  if (req === 'ashen') return rivalsInWorld(world).includes(ASHEN_FACTION);
  if (req === 'archipelago') return !!world.archipelago; // PLAN-PHASE12: Navigator, Privateers, Harbour Chain
  if (req === 'night') return world.regions.some((r) => r.twist === 'night' && open(r));
  if (req === 'siege') return world.regions.some((r) => r.twist === 'siege' && open(r));
  if (req === 'dragon') return world.regions.some((r) => r.type === 'dragon' && open(r));
  return true;
}

const unit = (...parts) => hash32(...parts) / 4294967296;

/** Draws up to BOONS.choices Boons (no repeats, none owned, only relevant ones), seeded (seed, dynasty, draws). Advances `draws`. */
function draft(state, world, source) {
  const b = ensureBoons2(state);
  const seed = (state.seed >>> 0) || 0;
  const level = (state.dynasty && state.dynasty.level) || 1;
  const n = b.draws;
  const weights = source === 'champion' ? BOONS.champEyeWeights : BOONS.rarityWeights;
  const pool = BOON_LIST.filter((x) => !b.owned.includes(x.id) && boonRelevant(state, world, x));
  const out = [];
  for (let k = 0; k < BOONS.choices; k++) {
    const avail = pool.filter((x) => !out.includes(x.id));
    if (!avail.length) break;
    const rars = Object.keys(weights).filter((r) => weights[r] > 0 && avail.some((x) => x.rarity === r));
    let cands = avail;
    if (rars.length) {
      const total = rars.reduce((s, r) => s + weights[r], 0);
      let roll = unit(seed, 'boonRarity', level, n, k) * total;
      let pick = rars[rars.length - 1];
      for (const r of rars) { if (roll < weights[r]) { pick = r; break; } roll -= weights[r]; }
      cands = avail.filter((x) => x.rarity === pick);
    }
    const best = cands.map((x) => ({ id: x.id, h: hash32(seed, 'boon', level, n, k, x.id) })).sort((a, c) => a.h - c.h || (a.id < c.id ? -1 : 1))[0];
    out.push(best.id);
  }
  b.draws = n + 1;
  return out;
}

/**
 * A new draft (PLAN §7A): sets `state.boons2.pending` and returns the choices (boon ids), or null when nothing is left to offer.
 * `source`: 'battle' (conquer() calls it for a conquest won in battle once boonsUnlocked) or 'champion' (the Champion's eye: Rare or
 * better). A pending offer is replaced (pending.missed = true: the UI says "you missed a pick"). MUTATES.
 */
export function offerBoons(state, world, source = 'battle') {
  const src = source === 'champion' ? 'champion' : 'battle';
  const b = ensureBoons2(state);
  const had = !!(b.pending && b.pending.choices && b.pending.choices.length);
  const choices = draft(state, world, src);
  if (!choices.length) return null;
  b.pending = { choices, source: src };
  if (had) b.pending.missed = true;
  return choices.slice();
}

/** The Champion's eye: once per dynasty, after a Vendetta win, a Rare-or-better draft (frontier.defenseReward calls it). MUTATES. */
export function offerChampionEye(state, world) {
  const b = ensureBoons2(state);
  if (b.champEyeUsed || !boonsUnlocked(state)) return null;
  const choices = offerBoons(state, world, 'champion');
  if (choices) b.champEyeUsed = true;
  return choices;
}

/**
 * Takes a Boon from the pending offer. Returns `{ ok: true, boon: boonInfo, duo?: { id, name, icon, parts, text } }` (duo: a Duo this
 * pick completed, for the reveal), or `{ ok: false, reason: 'none'|'notOffered' }`. MUTATES.
 */
export function pickBoon(state, id) {
  const b = ensureBoons2(state);
  if (!b.pending || !Array.isArray(b.pending.choices)) return { ok: false, reason: 'none' };
  if (!b.pending.choices.includes(id) || !BOON_BY_ID.has(id) || b.owned.includes(id)) return { ok: false, reason: 'notOffered' };
  const before = new Set(duosOf(b.owned).map((d) => d.id));
  b.owned.push(id);
  b.pending = null;
  const out = { ok: true, boon: boonInfo(id) };
  const fresh = duosOf(b.owned).find((d) => !before.has(d.id));
  if (fresh) out.duo = duoText(fresh);
  return out;
}

/** The reroll's price and whether it can be paid now: `{ cost, can }`. */
export function rerollBoonsInfo(state) {
  const p = state && state.boons2 && state.boons2.pending;
  return { cost: BOONS.rerollRenown, can: !!(p && p.choices && p.choices.length) && renownPoints(state) >= BOONS.rerollRenown };
}

/**
 * Rerolls the pending offer for BOONS.rerollRenown Renown (same source: a Champion's-eye draft stays Rare or better). Returns
 * `{ ok: true, cost, choices }` or `{ ok: false, cost, reason: 'none'|'renown'|'empty' }`. `world` keeps irrelevant Boons out (an
 * addition to the contract's `rerollBoons(state)`; without it only the dynasty-rule requirements are checked). MUTATES.
 */
export function rerollBoons(state, world = null) {
  const cost = BOONS.rerollRenown;
  const b = ensureBoons2(state);
  if (!b.pending || !b.pending.choices || !b.pending.choices.length) return { ok: false, cost, reason: 'none' };
  if (renownPoints(state) < cost) return { ok: false, cost, reason: 'renown' };
  const choices = draft(state, world, b.pending.source);
  if (!choices.length) return { ok: false, cost, reason: 'empty' };
  spendRenown(state, cost);
  b.pending = { choices, source: b.pending.source };
  return { ok: true, cost, choices: choices.slice() };
}

/** Tithe (conquer calls it for every conquest that is not a retake): Renown every BOONS-configured number of conquests. MUTATES. */
export function titheOnConquest(state) {
  const m = boonMods(state);
  if (!(m.titheEvery > 0)) return 0;
  const b = ensureBoons2(state);
  b.conquests += 1;
  return b.conquests % m.titheEvery === 0 ? earnRenown(state, m.titheRenown, 'feature') : 0;
}

/**
 * The Boons' end-of-battle bookkeeping, for EVERY battle that ends (attack or defense, won, lost or retreated): Plunderers pay
 * plunderSec of income per settlement the player captured (battle.stats.captured), and Fortune Favours takes lossGoldShare of the
 * gold in hand after a loss or retreat. Returns `{ plunder, goldLost }` (both gold, 0 when nothing applied). MUTATES gold.
 */
export function boonBattleEnd(state, world, battle, result) {
  const m = boonMods(state);
  const out = { plunder: 0, goldLost: 0 };
  const captured = battle && battle.stats && Number.isFinite(battle.stats.captured) ? battle.stats.captured : 0;
  if (m.plunderSec > 0 && captured > 0) {
    out.plunder = m.plunderSec * incomePerSec(state, world) * captured;
    state.gold += out.plunder;
    if (state.stats) state.stats.goldEarned += out.plunder;
  }
  // Privateers (PLAN-PHASE12): each enemy harbour (a port site that was not the player's when the battle began) the player holds at the end
  const ports = m.privateerSec > 0 && battle && Array.isArray(battle.sites) && battle.arena && Array.isArray(battle.arena.sites)
    ? battle.sites.filter((s) => s.port && s.owner === PLAYER && battle.arena.sites[s.id] && battle.arena.sites[s.id].owner !== PLAYER).length : 0;
  if (ports > 0) {
    out.privateers = m.privateerSec * incomePerSec(state, world) * ports;
    state.gold += out.privateers;
    if (state.stats) state.stats.goldEarned += out.privateers;
  }
  if (m.lossGoldShare > 0 && result !== 'win') {
    out.goldLost = Math.max(0, state.gold) * m.lossGoldShare;
    state.gold -= out.goldLost;
  }
  return out;
}
