// Battle crowns (DESIGN §4.8). Pure: no DOM, no Date.now, no Math.random, no storage.
// Works headlessly, so the campaign simulator can use the very same tracker as the game.
//
// Lifecycle
//   battle start      const tracker = trackerOf(battle)            // records the settlements you START with (Unbroken protects those)
//   after EVERY step  trackEvents(tracker, battle.events, battle.t) // (or trackBattle(tracker, battle))
//   battle end        const { summary, crowns } = evaluateBattle(tracker, battle, world, regionId)
//   right after conquer(): awardCrowns(state, world, regionId, crowns, conquerResult.bounty)
//   surrender         awardCrowns(state, world, regionId, crownsForSurrender(), conquerResult.bounty)
//
// The tracker is plain JSON. Attach it to the battle (`trackerOf`) and it is saved with the
// in-progress battle, so a reload mid-fight keeps an unbroken run unbroken.

import { CROWN_KEYS, PAR, BOUNTY_FRACTION_PER_CROWN, SURRENDER_CROWNS } from '../config/crowns.js';
import { earnRenown } from './renownState.js';
import { RENOWN } from '../config/renown.js';
import { PLAYER_FACTION } from './state.js';
import { bounty } from './economy.js';
import { recordDeed } from './deeds.js';
import { boonMods } from './boonsState.js';
import { PROSPERITY } from '../config/prosperity.js';
import { edictMods } from './edicts.js';

/**
 * @typedef {import('./state.js').RegionCrowns} RegionCrowns
 *
 * @typedef {Object} CrownTracker  plain JSON, safe to save inside the battle
 * @property {1} v
 * @property {number} playerSitesLost  captures of a site the player held when the battle began (Unbroken breaks at 1)
 * @property {number[]|null} held      arena site ids the player held at t=0 (DESIGN §4.8); null on trackers saved before
 *                                     this existed, which keep the old rule (any player-held site counts)
 * @property {'win'|'lose'|'retreat'|null} result  from the `end` event, null while running
 * @property {number|null} endT        battle seconds when `end` was seen
 * @property {number} lastT            battle seconds at the most recent trackEvents call
 * @property {number} powersUsed       powers the player cast (Phase 4: the Bounty Board's noPowers contract)
 * @property {Object<string, number>} capturesByType  sites the player captured, by site type ('fort', 'tower', 'keep', ...)
 * @property {boolean} abilityUsed     the commander's ability was used
 * @property {string[]|null} types     site type per arena site id at the start (to name a capture's type); null on old trackers
 *
 * @typedef {Object} BattleSummary
 * @property {boolean} won
 * @property {number} durationSec      battle seconds (independent of 1x/2x/3x speed)
 * @property {number} playerSitesLost
 */

// --- Par ----------------------------------------------------------------------

/**
 * Which par band a region falls in: 'capital', or one of PAR.bands' ids (tier1/tier2/mid/deep).
 * @param {import('../world/generate.js').World} world
 * @param {number} regionId
 * @returns {string}
 */
export function parBandOf(world, regionId) {
  const region = world.regions[regionId];
  if (region.isCapital) return 'capital';
  const tier = Math.max(0, region.tier);
  const band = PAR.bands.find((b) => tier >= b.minTier && tier <= b.maxTier) || PAR.bands[PAR.bands.length - 1];
  return band.id;
}

/**
 * Par time in battle seconds: win within this to earn Swift.
 * @param {import('../world/generate.js').World} world
 * @param {number} regionId
 * @param {import('./state.js').GameState} [state]  only read for the dynasty level (PAR.perDynastySec)
 * @returns {number}
 */
export function parFor(world, regionId, state) {
  const id = parBandOf(world, regionId);
  const base = id === 'capital' ? PAR.capitalSec : PAR.bands.find((b) => b.id === id).parSec;
  const dynasty = state && state.dynasty ? Math.max(1, state.dynasty.level) : 1;
  return base + PAR.perDynastySec * (dynasty - 1) + (state ? boonMods(state).swiftParAdd : 0); // Twin Crowns (PLAN-PHASE8)
}

/**
 * The battle second by which a win still earns Swift (par plus the tolerance): the timer in battle counts down to it (DESIGN 4.8).
 * @param {import('../world/generate.js').World} world
 * @param {number} regionId
 * @param {import('./state.js').GameState} [state]
 * @returns {number}
 */
export function swiftDeadlineSec(world, regionId, state) {
  return parFor(world, regionId, state) + PAR.toleranceSec;
}

// --- Tracking a battle ---------------------------------------------------------

/**
 * @param {object} [battle]  the BattleState at its start: the sites the player holds NOW are the ones Unbroken protects
 *   (DESIGN §4.8: a settlement you take mid-fight and lose again does not break it). Omit it for the old rule.
 * @returns {CrownTracker}
 */
export function createCrownTracker(battle) {
  const held = battle && Array.isArray(battle.sites)
    ? battle.sites.filter((s) => s.owner === PLAYER_FACTION).map((s) => s.id)
    : null;
  const types = battle && Array.isArray(battle.sites) ? battle.sites.map((s) => s.type) : null;
  return {
    v: 1, playerSitesLost: 0, result: null, endT: null, lastT: 0, held, powersUsed: 0, capturesByType: {}, abilityUsed: false, types,
  };
}

/** Adds the Phase 4 fields to a tracker saved before they existed (in place). */
function upgradeTracker(tracker, battle) {
  if (!Number.isFinite(tracker.powersUsed)) tracker.powersUsed = 0;
  if (!tracker.capturesByType || typeof tracker.capturesByType !== 'object') tracker.capturesByType = {};
  if (typeof tracker.abilityUsed !== 'boolean') tracker.abilityUsed = !!(battle && battle.abilityUsed);
  if (tracker.types === undefined) tracker.types = battle && Array.isArray(battle.sites) ? battle.sites.map((s) => s.type) : null;
  return tracker;
}

/**
 * The battle's own tracker, created on first use and stored as `battle.crownTracker` so it is
 * saved and restored with the in-progress battle (BattleState is plain JSON).
 * @param {object} battle
 * @returns {CrownTracker}
 */
export function trackerOf(battle) {
  if (!battle.crownTracker || battle.crownTracker.v !== 1) battle.crownTracker = createCrownTracker(battle);
  return upgradeTracker(battle.crownTracker, battle);
}

/**
 * Feeds one step's events to the tracker. Call it after EVERY `step()` (`battle.events` is
 * cleared by the next step, so several steps per frame means several calls per frame).
 * "Unbroken" breaks on any `capture` of a site the player held when the battle began (tracker.held; a tracker saved
 * without it counts every player-held site), however it is later retaken. Sites taken mid-battle never count.
 * @param {CrownTracker} tracker
 * @param {Array<{type: string}>} events  battle.events after the step
 * @param {number} t  battle.t after the step
 * @returns {CrownTracker} the same tracker
 */
export function trackEvents(tracker, events, t, battle) {
  if (!tracker) return tracker;
  if (Number.isFinite(t)) tracker.lastT = t;
  for (const ev of events || []) {
    if (ev.type === 'capture') {
      if (ev.from === PLAYER_FACTION && ev.to !== PLAYER_FACTION
        && (!Array.isArray(tracker.held) || tracker.held.includes(ev.site))) tracker.playerSitesLost += 1;
      if (ev.to === PLAYER_FACTION) {
        // Phase 4: what the player took, by site type (the Bounty Board's `forts` contract)
        const type = (Array.isArray(tracker.types) && tracker.types[ev.site]) || (battle && battle.sites && battle.sites[ev.site] && battle.sites[ev.site].type) || 'site';
        if (!tracker.capturesByType || typeof tracker.capturesByType !== 'object') tracker.capturesByType = {};
        tracker.capturesByType[type] = (tracker.capturesByType[type] || 0) + 1;
      }
    } else if (ev.type === 'power') {
      if (ev.owner === PLAYER_FACTION) tracker.powersUsed = (tracker.powersUsed || 0) + 1;
    } else if (ev.type === 'ability') {
      if (ev.owner == null || ev.owner === PLAYER_FACTION) tracker.abilityUsed = true;
    } else if (ev.type === 'end') {
      tracker.result = ev.result;
      tracker.endT = Number.isFinite(t) ? t : tracker.lastT;
    }
  }
  return tracker;
}

/** `trackEvents(tracker, battle.events, battle.t)` for callers that hold the battle. */
export function trackBattle(tracker, battle) {
  return trackEvents(tracker, battle.events, battle.t, battle);
}

/**
 * Everything the Bounty Board's onBattleEnd needs about a finished battle (PLAN-PHASE4 §4A), from the crown tracker (fed after
 * every step, saved with the battle, so a reload mid-battle keeps it) and the run.
 * @param {CrownTracker} tracker  trackerOf(run.battle)
 * @param {object} battle         run.battle
 * @param {object} run            the BattleRun: kind, regionId, commander, labelAtAttack (set it at attack start: difficulty().label)
 * @param {import('../world/generate.js').World} world
 * @param {import('./state.js').GameState} state
 * @returns {{ kind:string, won:boolean, regionId:number|null, powersUsed:number, capturesByType:Object<string,number>,
 *   twist:string|null, labelAtAttack:string|null, commander:string|null, abilityUsed:boolean, crowns:RegionCrowns,
 *   playerSitesLost:number, durationSec:number, vendetta:boolean }}
 */
export function battleSummaryFor(tracker, battle, run, world, state) {
  const t = tracker ? upgradeTracker(tracker, battle) : createCrownTracker(battle);
  const summary = summarize(t, battle);
  const kind = (run && run.kind) || (battle && battle.mode === 'defense' ? 'defense' : 'attack');
  const regionId = run && Number.isInteger(run.regionId) ? run.regionId : (battle && battle.arena ? battle.arena.regionId : null);
  const crowns = kind === 'attack' && summary.won && regionId != null && world ? crownsFor(summary, world, regionId, state) : emptyCrowns();
  return {
    kind,
    won: summary.won,
    regionId,
    powersUsed: t.powersUsed || 0,
    capturesByType: { ...(t.capturesByType || {}) },
    twist: (battle && battle.arena && battle.arena.twist) || null,
    labelAtAttack: (run && run.labelAtAttack) || t.labelAtAttack || null,
    commander: (run && run.commander) || (battle && battle.player && battle.player.commander) || null,
    abilityUsed: !!(t.abilityUsed || (battle && battle.abilityUsed)),
    crowns,
    playerSitesLost: summary.playerSitesLost,
    durationSec: summary.durationSec,
    vendetta: !!(run && run.vendetta),
  };
}

/**
 * Reads the finished (or running) battle into the three facts the crowns depend on.
 * @param {CrownTracker} tracker
 * @param {object} [battle]  the BattleState; only `result`, `t` and `stats.durationSec` are read
 * @returns {BattleSummary}
 */
export function summarize(tracker, battle) {
  const result = tracker.result ?? (battle ? battle.result : null) ?? null;
  let durationSec;
  if (tracker.endT != null) durationSec = tracker.endT;
  else if (battle && battle.result && battle.stats && battle.stats.durationSec > 0) durationSec = battle.stats.durationSec;
  else durationSec = battle ? battle.t : tracker.lastT;
  return { won: result === 'win', durationSec, playerSitesLost: tracker.playerSitesLost };
}

// --- Which crowns ---------------------------------------------------------------

/** @returns {RegionCrowns} */
export function emptyCrowns() {
  return { victory: false, swift: false, unbroken: false };
}

/**
 * @param {BattleSummary} summary
 * @param {import('../world/generate.js').World} world
 * @param {number} regionId
 * @param {import('./state.js').GameState} [state]  optional, only for the dynasty par lever
 * @returns {RegionCrowns}
 */
export function crownsFor(summary, world, regionId, state) {
  if (!summary || !summary.won) return emptyCrowns();
  const par = parFor(world, regionId, state);
  return {
    victory: true,
    swift: summary.durationSec <= par + PAR.toleranceSec,
    unbroken: summary.playerSitesLost === 0,
  };
}

/** Accepting a surrender earns Victory only (DESIGN §4.8). @returns {RegionCrowns} */
export function crownsForSurrender() {
  const crowns = emptyCrowns();
  for (const key of SURRENDER_CROWNS) crowns[key] = true;
  return crowns;
}

/**
 * One call for the battle scene / campaign simulator: summary + crowns.
 * @param {CrownTracker} tracker
 * @param {object} battle
 * @param {import('../world/generate.js').World} world
 * @param {number} regionId
 * @param {import('./state.js').GameState} [state]
 * @returns {{ summary: BattleSummary, crowns: RegionCrowns, parSec: number }}
 */
export function evaluateBattle(tracker, battle, world, regionId, state) {
  const summary = summarize(tracker, battle);
  return { summary, crowns: crownsFor(summary, world, regionId, state), parSec: parFor(world, regionId, state) };
}

/** Number of crowns set in a RegionCrowns (null/undefined = 0). */
export function crownCount(crowns) {
  if (!crowns) return 0;
  let n = 0;
  for (const key of CROWN_KEYS) if (crowns[key]) n += 1;
  return n;
}

// --- Rewards ----------------------------------------------------------------------

/**
 * The bounty `conquer()` pays for this region, even when called AFTER conquer(): a conquered
 * region's own perk (Harbour +20% bounty, Throne) joins perkMultipliers the moment the region is
 * owned, so a plain `bounty()` afterwards would not equal what was paid. We recompute against
 * the region's original owner.
 */
function baseBountyFor(state, world, regionId) {
  if (state.owner[regionId] !== PLAYER_FACTION) return bounty(state, world, regionId);
  const owner = state.owner.slice();
  owner[regionId] = world.regions[regionId].faction;
  return bounty({ ...state, owner }, world, regionId);
}

/**
 * Gold the given crowns add on top of the base bounty. Pure preview for the victory card.
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @param {number} regionId
 * @param {RegionCrowns} crowns
 * @param {number} [baseBounty]  what conquer() paid; recomputed if omitted
 * @returns {number}
 */
export function crownBonus(state, world, regionId, crowns, baseBounty) {
  const base = baseBounty != null ? baseBounty : baseBountyFor(state, world, regionId);
  return crownCount(crowns) * BOUNTY_FRACTION_PER_CROWN * base;
}

/** Crowns stored for a region this dynasty, or null. Safe on old saves without `crowns`. */
export function getCrowns(state, regionId) {
  const list = state.crowns;
  return Array.isArray(list) && list[regionId] ? list[regionId] : null;
}

/**
 * MUTATES: stores the crowns for the region, pays the crown bonus, counts them. Call it right
 * after `conquer()` (it does not pay the base bounty, so nothing is paid twice). Crowns are fixed
 * once stored: a region that already has crowns, or a call with no Victory, changes nothing.
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @param {number} regionId
 * @param {RegionCrowns} crowns
 * @param {number} [baseBounty]  `conquer()`'s returned bounty; recomputed if omitted
 * @returns {{ bonusGold: number, count: number }}
 */
export function awardCrowns(state, world, regionId, crowns, baseBounty) {
  if (!crowns || !crowns.victory || getCrowns(state, regionId)) return { bonusGold: 0, count: 0, renown: 0 };
  const stored = { victory: !!crowns.victory, swift: !!crowns.swift, unbroken: !!crowns.unbroken };
  const count = crownCount(stored);
  const bonusGold = crownBonus(state, world, regionId, stored, baseBounty);

  if (!Array.isArray(state.crowns)) state.crowns = [];
  while (state.crowns.length < world.regions.length) state.crowns.push(null);
  state.crowns[regionId] = stored;

  state.gold += bonusGold;
  state.stats.goldEarned += bonusGold;
  state.stats.crownsEarned = (state.stats.crownsEarned || 0) + count;
  const renown = earnRenown(state, count * RENOWN.earn.crown, 'crown'); // each crown pays Renown (DESIGN §10.12)
  recordDeed(state, 'crowns', count); // the Crowned deed (PLAN-PHASE4 §4C)
  const out = { bonusGold, count, renown };
  // Spoils of War (PLAN-PHASE8): a three-crown win starts the region at Prosperity crownProsperity (its tenure clock jumps there, as a
  // Festival's does); updateProsperity then reports the level-up as usual. `out.spoils` = the level granted.
  const lvl = Math.min(PROSPERITY.maxLevel, boonMods(state).crownProsperity);
  if (lvl > 0 && count === CROWN_KEYS.length && state.conqueredAt && Number.isFinite(state.conqueredAt[regionId])) {
    const back = PROSPERITY.thresholdsMs[lvl - 1] / edictMods(state).prosperityRateMult;
    state.conqueredAt[regionId] = Math.min(state.conqueredAt[regionId], state.conqueredAt[regionId] - back);
    out.spoils = lvl;
  }
  return out;
}

/**
 * This dynasty's crowns against what the continent offers (3 per conquerable region, i.e. every
 * region the player did not start with). Lifetime crowns are `state.stats.crownsEarned`.
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @returns {{ earned: number, possible: number }}
 */
export function crownTotals(state, world) {
  let earned = 0;
  let possible = 0;
  for (const region of world.regions) {
    if (region.faction === PLAYER_FACTION) continue;
    possible += CROWN_KEYS.length;
    earned += crownCount(getCrowns(state, region.id));
  }
  return { earned, possible };
}
