// The tick. 10 Hz, fixed step, decoupled from rendering.
//
// THE PHASE ORDER IS LOAD-BEARING AND MUST NEVER BE REORDERED:
//   tick++ -> drain orders -> economy -> training -> siege damage & HP regen
//   -> rally auto-send -> arrivals -> timers -> AI -> attrition -> win/lose
//
// Siege resolves BEFORE arrivals so a relieving force always gets one chance to
// break a siege before that tick's damage would have breached the wall —
// defence is never robbed by ordering. Same-tick arrivals are MERGED into one
// force, which deliberately rewards synchronized strikes.
// PURE.
import { TICK_HZ } from '../core/loop.js';
import {
  UNIT_IDS, UNITS, BOOSTERS, ATTRITION, ATTRITION_BLEED_SEC, ATTRITION_CHECK_TICKS, RALLY_KEEP,
} from '../content/balance.js';
import {
  resolveField, siegeDps, siteRegen, siteMaxHp, emptyComp, addComp, total, repairMult,
} from './combat.js';
import {
  createBattleState, siteById, effectiveLevel, armySize, sitesOwned, castleSealed,
  clampRallyKeep,
} from './state.js';
import { rallyPhase } from './rally.js';
import { arrivalsPhase } from './arrivals.js';
import { recomputeInfluence, territoryScore } from './influence.js';
import { recomputeOccupancy } from './occupancy.js';
import { groundOf, siteDefMultOf } from './terrain.js';
import { spawnSquad, retreatTarget, clearPathCache } from './movement.js';
import { drainCommands } from './commands.js';
import { runEconomy, attritionMods } from './economy.js';
import { runTraining, garrisonCap } from './training.js';
import { pushEvent, EVENTS } from './events.js';
import { think } from './ai.js';

const FACTIONS = ['player', 'enemy'];

/**
 * Build a live battle from a validated config and paint the opening front.
 *
 * The river layer is attached HERE, in the same `"q,r"` string form as blocked,
 * so it serialises into a resume blob with everything else. A config without
 * rivers (a hand-built test fixture) simply has none.
 */
export function startBattle(config) {
  clearPathCache();
  const state = createBattleState(config);
  state.grid.rivers = (config.grid?.rivers ?? []).map(([q, r]) => `${q},${r}`);
  // Both per-hex maps, together, because they are invalidated by exactly the
  // same event: a site changing hands or coming into existence.
  recomputeInfluence(state);
  recomputeOccupancy(state);
  return state;
}

const modOf = (state, faction, key, fallback = 1) => state.mods[faction]?.[key] ?? fallback;
/** Per-troop levels (contract v7). Sparse and usually absent. */
const vetOf = (state, faction) => state.mods[faction]?.unitMult;

// --- phase 5: siege damage & HP regen --------------------------------------

function capture(state, site) {
  const from = site.owner;
  const to = site.siege.owner;
  site.owner = to;
  site.garrison = addComp(emptyComp(), site.siege.comp);
  site.siege = null;
  // HP carries over at its current value — the site is briefly fragile, so a
  // fast counterattack can retake it. It is NOT reset to max.
  site.hp = Math.max(0, site.hp);
  site.level = 1;                        // in-battle upgrades are lost on capture
  site.hpMax = siteMaxHp(site.kind, 1);
  site.hp = Math.min(site.hp, site.hpMax);
  site.upgradeTicksLeft = 0;
  site.trainProgress = 0;
  site.rallyTargets = [];                // the standing order died with the wall
  site.rallyCursor = 0;
  site.rallyKeep = clampRallyKeep(state.rules?.rallyKeepDefault ?? RALLY_KEEP.default);
  site.shieldTicks = 0;
  pushEvent(state, EVENTS.SITE_CAPTURED, { siteId: site.id, kind: site.kind, from, to });
  state.meta.lastFlipTick = state.tick;
}

function siegePhase(state) {
  const att = attritionMods(state);
  let flipped = false;
  for (const site of state.sites) {
    if (site.siege && total(site.siege.comp) === 0) site.siege = null;
    const shielded = site.shieldTicks > 0;
    const regenMult = modOf(state, site.owner, 'structureRegenMult')
      * att.regenMult * (shielded ? BOOSTERS.fortify.regenMult : 1);
    // Sappers repair what they garrison (combat.js `repairMult`), on the same
    // term `structureRegenMult` already uses — so `breachSeconds`, which the AI
    // and the preview both call, sees it without learning about the unit.
    const regen = siteRegen(site.kind, effectiveLevel(site),
      regenMult * repairMult(site.garrison)) / TICK_HZ;

    if (site.siege && site.siege.owner !== site.owner) {
      // Terrain is part of the siege, not just the field battle: rams work at a
      // fraction of their rate against a fort up in the rocks.
      const dps = siegeDps(site.siege.comp, modOf(state, site.siege.owner, 'siegeDmgMult'),
        groundOf(state, site)) / TICK_HZ;
      // Ceiling is hpMax, or the current HP when Emergency Fortify has pushed a
      // site above it: an overheal may drain away, but repair never restores it.
      const ceiling = Math.max(site.hpMax, site.hp);
      // The castle gate: below the region's territory threshold, a sealed
      // castle's HP has a FLOOR instead of a ceiling of zero — the siege grinds
      // but can never complete, the same shape breachSeconds() already gives an
      // under-strength siege against a stronghold. One extra hp keeps it out of
      // the capture check without inventing a second state field.
      const sealed = castleSealed(state, site);
      const floor = sealed ? 1 : 0;
      site.hp = Math.min(ceiling, Math.max(floor, site.hp - dps + regen));
      if (!sealed && site.hp <= 0) { capture(state, site); flipped = true; }
    } else if (site.hp < site.hpMax) {
      site.hp = Math.min(site.hpMax, site.hp + regen);
    }
  }
  if (flipped) { recomputeInfluence(state); recomputeOccupancy(state); }
}

// --- phase 6: rally auto-send lives in ./rally.js ---------------------------

// --- phase 7: arrivals lives in ./arrivals.js -------------------------------
// Re-exported so the phase list at the top of this file stays findable.
export { arrivalsPhase, fightStack, resolveArrival } from './arrivals.js';

// --- phase 8: timers --------------------------------------------------------

function timersPhase(state) {
  for (const site of state.sites) {
    if (site.shieldTicks > 0) site.shieldTicks--;
    if (site.upgradeTicksLeft > 0) {
      site.upgradeTicksLeft--;
      if (site.upgradeTicksLeft === 0) {
        const grown = siteMaxHp(site.kind, site.level);
        site.hp += grown - site.hpMax;
        site.hpMax = grown;
        pushEvent(state, EVENTS.SITE_UPGRADED, { siteId: site.id, level: site.level });
      }
    }
  }
  for (const f of FACTIONS) {
    if (state.factions[f].trainBoostTicks > 0) state.factions[f].trainBoostTicks--;
  }
  for (const id of Object.keys(state.boosters).sort()) {
    const b = state.boosters[id];
    if (b.cdTicks <= 0) continue;
    b.cdTicks--;
    if (b.cdTicks === 0) {
      if (b.charges < b.max) b.charges++;
      if (b.charges < b.max) b.cdTicks = b.cdMax;
    }
  }
}

// --- phase 10: the attrition ladder ----------------------------------------

function bleedGarrisons(state, count) {
  for (const site of state.sites) {
    if (!FACTIONS.includes(site.owner)) continue;
    if (total(site.garrison) <= garrisonCap(state, site)) continue;
    for (let i = 0; i < count; i++) {
      const cheapest = Object.keys(UNITS)
        .filter((u) => (site.garrison[u] || 0) > 0)
        .sort((a, b) => UNITS[a].gold - UNITS[b].gold)[0];
      if (!cheapest) break;
      site.garrison[cheapest]--;
      state.factions[site.owner].unitsLost++;
    }
  }
}

function attritionPhase(state) {
  if (state.tick % ATTRITION_CHECK_TICKS === 0) {
    const sinceSec = (state.tick - state.meta.lastFlipTick) / TICK_HZ;
    let stage = 0;
    for (let i = 0; i < ATTRITION.length; i++) if (sinceSec >= ATTRITION[i].afterSec) stage = i + 1;
    if (stage !== state.meta.attritionStage) {
      state.meta.attritionStage = stage;
      pushEvent(state, EVENTS.ATTRITION_STAGE, { stage });
    }
  }
  const att = attritionMods(state);
  if (att.garrisonBleed > 0 && state.tick % (ATTRITION_BLEED_SEC * TICK_HZ) === 0) {
    bleedGarrisons(state, att.garrisonBleed);
  }
}

// --- phase 11: win, lose, hard cap -----------------------------------------

function endPhase(state) {
  const camp = state.sites.find((s) => s.kind === 'camp');
  const castle = state.sites.find((s) => s.kind === 'castle');
  const inFlight = (f) => state.squads.some((sq) => sq.owner === f)
    || state.sites.some((s) => s.siege?.owner === f);

  let result = null;
  if (castle && castle.owner === 'player') result = 'win';
  else if (!state.sites.some((s) => s.owner !== 'player')) result = 'win';
  else if (camp && camp.owner !== 'player') result = 'loss';
  else if (!sitesOwned(state, 'player').length && !inFlight('player')) result = 'loss';
  else if (!sitesOwned(state, 'enemy').length && !inFlight('enemy')) result = 'win';
  else if (state.tick >= state.rules.hardCapTicks) {
    result = 'timeout';
    const p = territoryScore(state, 'player') + sitesOwned(state, 'player').length;
    const e = territoryScore(state, 'enemy') + sitesOwned(state, 'enemy').length;
    state.meta.timeoutWinner = p > e ? 'player' : e > p ? 'enemy' : 'draw';
  }
  if (!result) return;
  state.status = result;
  pushEvent(state, EVENTS.BATTLE_ENDED, { result, winner: state.meta.timeoutWinner ?? null });
}

// --- the tick ---------------------------------------------------------------

/** Advance one 10 Hz tick. Returns the same (mutated) state for chaining. */
export function step(state) {
  if (state.status !== 'running') return state;

  state.tick++;
  // main.js drains events after every tick; anything still here is stale, and
  // clearing now is what keeps the array bounded in a headless run.
  state.events = [];

  drainCommands(state);
  runEconomy(state);
  runTraining(state);
  siegePhase(state);
  rallyPhase(state);
  arrivalsPhase(state);
  timersPhase(state);
  think(state);
  attritionPhase(state);
  endPhase(state);

  for (const f of FACTIONS) {
    const n = armySize(state, f);
    if (n > state.factions[f].peakArmy) state.factions[f].peakArmy = n;
  }
  return state;
}

/** Headless convenience: run until the battle ends or `maxTicks` elapse. */
export function runToEnd(state, maxTicks = 100000) {
  let n = 0;
  while (state.status === 'running' && n < maxTicks) { step(state); n++; }
  return state;
}
