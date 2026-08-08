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
  UNITS, BOOSTERS, ATTRITION, ATTRITION_BLEED_SEC, ATTRITION_CHECK_TICKS, RALLY_KEEP,
} from '../content/balance.js';
import {
  resolveField, siegeDps, siteRegen, siteMaxHp, emptyComp, addComp, scaleComp, total,
} from './combat.js';
import {
  createBattleState, siteById, effectiveLevel, armySize, sitesOwned, rallyKeepOf,
} from './state.js';
import { recomputeInfluence, territoryScore } from './influence.js';
import { groundOf, siteDefMultOf } from './terrain.js';
import { spawnSquad, retreatTarget, clearPathCache } from './movement.js';
import { drainCommands, subComp } from './commands.js';
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
  recomputeInfluence(state);
  return state;
}

function recordCasualties(state, loser, killer, before, after) {
  const lost = total(before) - total(after);
  if (lost <= 0) return;
  if (state.factions[loser]) state.factions[loser].unitsLost += lost;
  if (state.factions[killer]) state.factions[killer].unitsKilled += lost;
}

const modOf = (state, faction, key, fallback = 1) => state.mods[faction]?.[key] ?? fallback;

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
  site.rallyTarget = null;
  site.rallyKeep = RALLY_KEEP.default;   // the standing order died with the wall
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
    const regen = siteRegen(site.kind, effectiveLevel(site), regenMult) / TICK_HZ;

    if (site.siege && site.siege.owner !== site.owner) {
      // Terrain is part of the siege, not just the field battle: rams work at a
      // fraction of their rate against a fort up in the rocks.
      const dps = siegeDps(site.siege.comp, modOf(state, site.siege.owner, 'siegeDmgMult'),
        groundOf(state, site)) / TICK_HZ;
      // Ceiling is hpMax, or the current HP when Emergency Fortify has pushed a
      // site above it: an overheal may drain away, but repair never restores it.
      const ceiling = Math.max(site.hpMax, site.hp);
      site.hp = Math.min(ceiling, site.hp - dps + regen);
      if (site.hp <= 0) { capture(state, site); flipped = true; }
    } else if (site.hp < site.hpMax) {
      site.hp = Math.min(site.hpMax, site.hp + regen);
    }
  }
  if (flipped) recomputeInfluence(state);
}

// --- phase 6: rally auto-send ----------------------------------------------

function rallyPhase(state) {
  for (const site of state.sites) {
    if (!site.rallyTarget || !FACTIONS.includes(site.owner)) continue;
    const target = siteById(state, site.rallyTarget);
    if (!target || !site.adj.includes(target.id)) { site.rallyTarget = null; continue; }
    const n = total(site.garrison);
    // Per-site, not one global: a back-line farm keeps almost nothing, a front
    // stronghold feeding a siege holds enough to survive the counter-attack.
    const keep = rallyKeepOf(site);
    if (n <= keep) continue;
    const send = scaleComp(site.garrison, (n - keep) / n);
    if (total(send) === 0) continue;
    site.garrison = subComp(site.garrison, send);
    const squad = spawnSquad(state, {
      owner: site.owner, from: site.id, to: target.id, comp: send,
    });
    pushEvent(state, EVENTS.SQUAD_SENT, {
      squadId: squad.id, owner: site.owner, from: site.id, to: target.id, rally: true,
    });
  }
}

// --- phase 7: arrivals ------------------------------------------------------

/** A failed attack sends half of each raider contingent home. This is why a
 *  first-timer's bad probe costs 50%, not 100%. */
function skirmishHome(state, site, group) {
  for (const sq of group.squads) {
    const back = Math.floor((sq.comp.raiders || 0) * (UNITS.raiders.skirmish ?? 0));
    if (back <= 0) continue;
    const home = siteById(state, sq.from);
    const target = home && home.owner === group.owner
      ? home : retreatTarget(state, site, group.owner);
    if (!target) continue;
    const comp = { ...emptyComp(), raiders: back };
    spawnSquad(state, {
      owner: group.owner, from: site.id, to: target.id, comp, retreating: true,
    });
    state.factions[group.owner].unitsLost -= back;   // they got away after all
    const foe = group.owner === 'player' ? 'enemy' : 'player';
    if (state.factions[foe]) state.factions[foe].unitsKilled -= back;
    pushEvent(state, EVENTS.SKIRMISH_ESCAPE, {
      siteId: site.id, owner: group.owner, raiders: back, to: target.id,
    });
  }
}

/** Field battle against whoever is holding the ground, not against the walls. */
function fightStack(state, group, site, holders, holderFaction) {
  // No walls and no bulwark — but the ground is still the ground, so terrain
  // applies here too. Only the FORTIFICATION bonus is absent.
  const r = resolveField(group.comp, holders, {
    siteDefMult: 1, defenderOwnsSite: false,
    attMult: modOf(state, group.owner, 'unitAtkMult'),
    defMult: modOf(state, holderFaction, 'unitDefMult'),
    ground: groundOf(state, site),
  });
  recordCasualties(state, group.owner, holderFaction, group.comp, r.attSurvivors);
  recordCasualties(state, holderFaction, group.owner, holders, r.defSurvivors);
  pushEvent(state, EVENTS.FIELD_BATTLE, {
    siteId: site.id, attacker: group.owner, win: r.win,
    attPower: r.attPower, defPower: r.defPower,
  });
  return r;
}

function resolveArrival(state, group) {
  const site = siteById(state, group.to);
  if (!site) return;
  const owner = group.owner;

  if (site.owner === owner) {
    const besieged = site.siege && site.siege.owner !== owner;
    if (group.mode === 'return' || !besieged) {
      site.garrison = addComp(site.garrison, group.comp);
      pushEvent(state, EVENTS.SQUAD_ARRIVED, {
        siteId: site.id, owner, count: total(group.comp), retreating: group.mode === 'return',
      });
      return;
    }
    // Relief: the besiegers are camped in the open, so no walls and no bulwark.
    const besieger = site.siege.owner;
    const r = fightStack(state, group, site, site.siege.comp, besieger);
    if (r.win) {
      site.siege = null;
      site.garrison = addComp(site.garrison, r.attSurvivors);
      pushEvent(state, EVENTS.SIEGE_LIFTED, { siteId: site.id, by: owner });
    } else {
      site.siege.comp = r.defSurvivors;
    }
    return;
  }

  if (site.siege && site.siege.owner === owner) {
    site.siege.comp = addComp(site.siege.comp, group.comp);
    pushEvent(state, EVENTS.SIEGE_REINFORCED, { siteId: site.id, owner });
    return;
  }
  if (site.siege && total(site.siege.comp) > 0) {
    // Three-way: whoever holds the field outside the walls owns the siege.
    const holder = site.siege.owner;
    const r = fightStack(state, group, site, site.siege.comp, holder);
    if (r.win) site.siege = { owner, comp: r.attSurvivors };
    else site.siege.comp = r.defSurvivors;
    return;
  }

  const r = resolveField(group.comp, site.garrison, {
    // siteDefMultOf, not SITES[kind].defMult: the mountains around a fort are
    // part of how hard it is to take, and sim/preview/AI/harness all read the
    // same function rather than each drifting their own way.
    siteDefMult: siteDefMultOf(state, site),
    defenderOwnsSite: true,
    attMult: modOf(state, owner, 'unitAtkMult'),
    defMult: modOf(state, site.owner, 'unitDefMult'),
    shielded: site.shieldTicks > 0,
    ground: groundOf(state, site),
  });
  recordCasualties(state, owner, site.owner, group.comp, r.attSurvivors);
  recordCasualties(state, site.owner, owner, site.garrison, r.defSurvivors);
  pushEvent(state, EVENTS.FIELD_BATTLE, {
    siteId: site.id, attacker: owner, win: r.win,
    attPower: r.attPower, defPower: r.defPower,
  });

  if (r.win) {
    // Beating the garrison does NOT capture: the siege begins.
    site.garrison = emptyComp();
    site.siege = { owner, comp: r.attSurvivors };
    pushEvent(state, EVENTS.SIEGE_BEGUN, { siteId: site.id, owner, hp: site.hp });
  } else {
    site.garrison = r.defSurvivors;
    skirmishHome(state, site, group);
  }
}

function arrivalsPhase(state) {
  if (!state.squads.length) return;
  const landed = state.squads.filter((sq) => sq.arriveTick <= state.tick);
  if (!landed.length) return;
  state.squads = state.squads.filter((sq) => sq.arriveTick > state.tick);

  const groups = {};
  for (const sq of landed) {
    const site = siteById(state, sq.to);
    // A retreat is a clean escape only into friendly ground. If the haven fell
    // while they were in the air they have to fight for it after all.
    const mode = sq.retreating && site && site.owner === sq.owner ? 'return' : 'engage';
    const key = `${sq.to}|${sq.owner}|${mode}`;
    const g = groups[key] ?? (groups[key] = {
      to: sq.to, owner: sq.owner, mode, comp: emptyComp(), squads: [],
    });
    g.comp = addComp(g.comp, sq.comp);
    g.squads.push(sq);
  }
  // Sorted keys: deterministic, and 'engage' resolves before 'return' so a
  // retreating stack never gets dragged into someone else's relief battle.
  for (const key of Object.keys(groups).sort()) resolveArrival(state, groups[key]);
}

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
