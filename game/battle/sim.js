// Public battle simulation API (ARCHITECTURE §6): createBattle, step, issue, squadPosition,
// previewSend. Pure: no DOM, no Math.random, no Date.now — see docs/ARCHITECTURE.md §1.
//
// step() is deliberately agnostic to who is "playing": it only applies whatever commands are
// queued via issue(). The enemy AI (ai.js) and the harness's player bot (bot.js) are peers
// that read battle state and call issue() themselves (see their files) — step() never calls
// either one. This keeps mechanics fully testable in isolation (a test can construct a
// battle and step() it without any AI ever deciding to do something unplanned) and keeps
// ai.js/bot.js symmetric.
import { BATTLE, SITE_TYPES, POWERS, SUPPLY } from '../config/battle.js';
import {
  effectiveCap, effectiveGrowth, squadPerTroopStrength, garrisonPerTroopStrength,
  ownerStats, resolveTowerVolleys, resolveEngagements, PLAYER_OWNER,
} from './combat.js';
import { applyPower, processPending } from './powers.js';
import { applyAbility, abilityState, abilityAdvice } from './abilities.js';
import { marchSpeedMult } from './features.js';
import { processDragon, initialDragon } from './dragon.js';
import { initialChampion, championSquadRef, processChampion } from './champion.js';
import { processRising } from './fallen.js';
import { processBoons } from './boons.js';
import { FEATURES } from '../config/features.js';
import { sendFromSite } from './squads.js';
import { advanceMovement, mergeSquads } from './movement.js';
import { resolveCombat, applyGrowth, checkEndConditions } from './resolve.js';
import { getRuntime } from './runtime.js';
import { canRoute, routeFor, routeCost } from './routing.js';
import { computeTerritory, tileOwner, territoryVersion } from './territory.js';
import { squadPosition } from './position.js';

export { squadPosition, canRoute, routeFor, routeCost, computeTerritory, tileOwner, territoryVersion, abilityState, abilityAdvice };

/** @returns {object} a fresh BattleState (ARCHITECTURE §6) for an arena + stat blocks. */
export function createBattle(arena, player, enemy, opts = {}) {
  const arenaCopy = {
    ...arena,
    tiles: arena.tiles.map((t) => ({ ...t })),
    sites: arena.sites.map((s) => ({ ...s })),
    focus: { ...arena.focus },
  };
  const playerCopy = { ...player, powers: { ...player.powers } };
  if (player.ability) playerCopy.ability = { ...player.ability };
  // A Beacon in a defended region (DESIGN §10.3): the player's squads march faster in this battle
  if (arenaCopy.playerSpeedMult) playerCopy.speed = (playerCopy.speed ?? 1) * arenaCopy.playerSpeedMult;
  const enemyCopy = { ...enemy };

  const sites = arenaCopy.sites.map((s) => {
    const site = {
      id: s.id,
      tile: s.tile,
      type: s.type,
      owner: s.owner,
      troops: s.troops,
      cap: effectiveCap(s.type, s.owner, playerCopy, s.capMult, s.pCapMult),
      capMult: s.capMult ?? 1,
      growth: effectiveGrowth(s.type, s.owner, playerCopy, arenaCopy.enemyFaction, enemyCopy),
      def: SITE_TYPES[s.type].def * (s.defMult ?? 1),
      bulwarkUntil: 0,
      assault: null,
    };
    // Fortifications (DESIGN §10.3), only on defense arenas: Walls, an Arrow Tower's range and rate, the militia cap scale
    if (s.pCapMult != null) site.pCapMult = s.pCapMult;
    if (s.defMult != null) site.defMult = s.defMult;
    if (s.range != null) site.range = s.range;
    if (s.volleySec != null) site.volleySec = s.volleySec;
    if (s.volleyKills != null) site.volleyKills = s.volleyKills;
    if (s.fort) site.fort = s.fort;
    if (s.feature) site.feature = s.feature;
    if (s.squadPower != null) site.squadPower = s.squadPower;
    if (s.type === 'tower') site.nextVolley = 0;
    return site;
  });

  // Defense mode (ARCHITECTURE §10.3): the arena says so; opts may override the siege timer.
  if (arenaCopy.dragon) arenaCopy.dragon = { ...arenaCopy.dragon };
  const mode = opts.mode ?? arenaCopy.mode ?? 'attack';
  const modeFields = mode === 'defense'
    ? { mode, siegeSec: opts.siegeSec ?? arenaCopy.siegeSec ?? 120 }
    : {};

  const battle = {
    version: 1,
    t: 0,
    tick: 0,
    speed: 1,
    arena: arenaCopy,
    player: playerCopy,
    enemy: enemyCopy,
    sites,
    squads: [],
    supply: [],
    cooldowns: { rally: 0, firestorm: 0, bulwark: 0, march: 0, levy: 0 },
    effects: { marchUntil: 0 },
    pending: [],
    ai: { nextThink: 0, memo: {} },
    commands: [],
    events: [],
    result: null,
    stats: { sent: 0, lost: 0, killed: 0, captured: 0, durationSec: 0 },
    nextId: 0,
    ...opts,
    ...modeFields,
    ...(arenaCopy.dragon ? { dragon: initialDragon(arenaCopy) } : {}),
    ...(arenaCopy.champion ? { champion: initialChampion(arenaCopy) } : {}), // a Vendetta's Champion (PLAN-PHASE4 §4D, battle/champion.js)
  };
  if (battle.dragon && battle.dragon.perch >= 0) battle.sites[battle.dragon.perch].dragonDef = FEATURES.dragon.perchDef;
  return battle;
}

/** Queues a command; applied at the start of the next step() call. */
export function issue(battle, command) {
  battle.commands.push(command);
  return battle;
}

function applyCommand(battle, cmd, t) {
  if (!cmd) return;
  if (cmd.type === 'send') {
    // Front lines (DESIGN §4.4): sources with no legal route are dropped; if that leaves nothing, the send is refused.
    const froms = Array.isArray(cmd.from) ? cmd.from : [cmd.from];
    let dropped = 0;
    let routable = 0;
    for (const fromId of froms) {
      const site = battle.sites[fromId];
      if (!site || site.owner !== cmd.owner || fromId === cmd.to) continue;
      if (!canRoute(battle, cmd.owner, fromId, cmd.to)) { dropped += 1; continue; }
      routable += 1;
      sendFromSite(battle, fromId, cmd.to, cmd.fraction);
    }
    if (dropped > 0 && routable === 0) {
      battle.events.push({ type: 'refused', reason: 'noRoute', owner: cmd.owner, to: cmd.to });
    }
  } else if (cmd.type === 'supply') {
    applySupply(battle, cmd, t);
  } else if (cmd.type === 'unsupply') {
    applyUnsupply(battle, cmd);
  } else if (cmd.type === 'power') {
    applyPower(battle, cmd, t);
  } else if (cmd.type === 'ability') {
    applyAbility(battle, cmd, t); // a General's once-per-battle active (DESIGN §10.11)
  } else if (cmd.type === 'retreat') {
    battle.result = 'retreat';
    battle.stats.durationSec = t;
    battle.events.push({ type: 'end', result: 'retreat' });
  }
}

// --- Supply lines (DESIGN §4.3) --------------------------------------------------------------------------------
// battle.supply = [{ owner, from, to, nextAt }]: a standing order, at most one per source. Plain JSON, saved with the battle.
function supplyLines(battle) {
  if (!Array.isArray(battle.supply)) battle.supply = []; // a save from before supply lines
  return battle.supply;
}

function asList(v) {
  return Array.isArray(v) ? v : [v];
}

/** `{type:'supply', owner, from, to}` (from may be a list): creates or replaces each source's line. The first send
 * happens on this very tick (if the source holds enough), then every `SUPPLY.intervalSec`. A source with no route to
 * the target gets no line; if none of them can, a `refused` event says so. Repeating the same order changes nothing. */
function applySupply(battle, cmd, t) {
  const to = battle.sites[cmd.to];
  if (!to) return;
  const lines = supplyLines(battle);
  let made = 0;
  let dropped = 0;
  for (const fromId of asList(cmd.from)) {
    const site = battle.sites[fromId];
    if (!site || site.owner !== cmd.owner || fromId === cmd.to) continue;
    if (!canRoute(battle, cmd.owner, fromId, cmd.to)) { dropped += 1; continue; }
    made += 1;
    const at = lines.findIndex((l) => l.from === fromId);
    if (at >= 0 && lines[at].to === cmd.to && lines[at].owner === cmd.owner) continue;
    const line = { owner: cmd.owner, from: fromId, to: cmd.to, nextAt: t };
    if (at >= 0) lines[at] = line;
    else lines.push(line);
    battle.events.push({ type: 'supply', owner: cmd.owner, from: fromId, to: cmd.to });
  }
  if (dropped > 0 && made === 0) {
    battle.events.push({ type: 'refused', reason: 'noRoute', owner: cmd.owner, to: cmd.to });
  }
}

/** `{type:'unsupply', owner, from}` (from may be a list): removes those sources' lines. */
function applyUnsupply(battle, cmd) {
  const lines = supplyLines(battle);
  for (const fromId of asList(cmd.from)) {
    const at = lines.findIndex((l) => l.from === fromId && l.owner === cmd.owner);
    if (at < 0) continue;
    lines.splice(at, 1);
    battle.events.push({ type: 'unsupply', owner: cmd.owner, from: fromId, reason: 'removed' });
  }
}

const SUPPLY_EPS = 1e-9;

/** Runs every standing line: each one checks in every `SUPPLY.intervalSec` and, if its source still belongs to the
 * line's owner, holds at least `SUPPLY.minTroops` and has a route, sends `SUPPLY.fraction` of its troops as an
 * ordinary squad (its `send` event carries `auto: true`). A line whose source changed hands ends; one whose target
 * was captured goes on (it now reinforces). */
function processSupply(battle, t) {
  const lines = supplyLines(battle);
  if (lines.length === 0) return;
  const keep = [];
  for (const line of lines) {
    const from = battle.sites[line.from];
    if (!from || !battle.sites[line.to] || from.owner !== line.owner) {
      battle.events.push({ type: 'unsupply', owner: line.owner, from: line.from, reason: 'lost' });
      continue;
    }
    if (t + SUPPLY_EPS >= line.nextAt) {
      if (from.troops >= SUPPLY.minTroops && canRoute(battle, line.owner, line.from, line.to)) {
        sendFromSite(battle, line.from, line.to, SUPPLY.fraction, { auto: true });
      }
      // Stables next door (DESIGN §5.8): the player's lines check in sooner
      const interval = SUPPLY.intervalSec * (line.owner === PLAYER_OWNER ? (battle.player.supplyIntervalMult ?? 1) : 1);
      line.nextAt += interval;
      if (line.nextAt <= t) line.nextAt = t + interval;
    }
    keep.push(line);
  }
  battle.supply = keep;
}

/** Advances the battle by `dt` seconds. Clears then fills `battle.events`. */
export function step(battle, dt) {
  battle.events = [];
  if (battle.result) return battle;

  const startT = battle.t;
  const commands = battle.commands;
  battle.commands = [];
  for (const cmd of commands) {
    applyCommand(battle, cmd, startT);
    if (battle.result) return battle; // a retreat command ends the battle immediately
  }

  battle.t += dt;
  battle.tick += 1;
  const t = battle.t;
  const champion = battle.champion ? championSquadRef(battle) : null; // the Champion's squad before this step (did it die, or settle?)

  processSupply(battle, t);
  const blocked = resolveEngagements(battle);
  advanceMovement(battle, dt, t, blocked);
  mergeSquads(battle);
  processPending(battle, t);
  processDragon(battle, t); // a Dragon's Lair (DESIGN §10.13): flights, telegraphed breath
  processRising(battle, t); // a Barrow Keep (PLAN-PHASE6): its dead rise every 20 s, telegraphed
  resolveCombat(battle, dt, t);
  resolveTowerVolleys(battle, getRuntime(battle), t);
  processBoons(battle, dt, t); // Boons and Relics (PLAN-PHASE7, battle/boons.js): scorched ground, fire arrows, Martyr's Crown
  applyGrowth(battle, dt);
  checkEndConditions(battle, t);
  if (battle.champion) processChampion(battle, t, champion); // launches it on time; its fall cuts the war band's attack

  return battle;
}

/**
 * Predicts the outcome of a send assuming nothing else changes (ARCHITECTURE §6): used for
 * the drag tooltip. Read-only — never mutates `battle`.
 *
 * Front lines (DESIGN §4.4): the march times use the real route. `routable` is true when at least one source has a
 * legal route; `unroutable` lists the source site ids that have none (a real send drops them). When no source can
 * route, `outcome` is `'noRoute'` and nothing is sent.
 */
export function previewSend(battle, from, to, fraction) {
  const froms = Array.isArray(from) ? from : [from];
  const toSite = battle.sites[to];
  const contributions = [];
  const unroutable = [];
  let routable = false;

  for (const fromId of froms) {
    const site = battle.sites[fromId];
    if (!site || !toSite || fromId === to) continue;
    const route = routeFor(battle, site.owner, fromId, to);
    if (!route) { unroutable.push(fromId); continue; }
    routable = true;
    const count = Math.floor(site.troops * fraction);
    if (count < 1) continue;
    contributions.push({ count, owner: site.owner, seconds: pathDurationSec(battle, site.owner, route.tiles) });
  }

  const sending = contributions.reduce((sum, c) => sum + c.count, 0);
  if (sending === 0 || !toSite) {
    return {
      sending: 0,
      arriveSec: 0,
      defenderAtArrival: toSite ? toSite.troops : 0,
      outcome: toSite && !routable && unroutable.length > 0 ? 'noRoute' : 'fail',
      remaining: toSite ? toSite.troops : 0,
      routable,
      unroutable,
    };
  }

  const arriveSec = Math.max(...contributions.map((c) => c.seconds));
  const firstArriveSec = Math.min(...contributions.map((c) => c.seconds));
  const defenderAtArrival = projectTroops(toSite, firstArriveSec);
  const attackerOwner = contributions[0].owner;
  const atkPerTroop = squadPerTroopStrength(attackerOwner, battle.player, battle.arena.enemyFaction, battle.enemy);

  let outcome;
  let remaining;
  if (toSite.owner === attackerOwner) {
    outcome = 'reinforce';
    remaining = defenderAtArrival + sending;
  } else {
    const defPerTroop = garrisonPerTroopStrength(
      toSite, toSite.owner, battle.player, battle.arena.enemyFaction, battle.enemy, battle.t + arriveSec,
    );
    const atkStrength = sending * atkPerTroop;
    const defStrength = defenderAtArrival * defPerTroop;
    if (atkStrength > defStrength) {
      outcome = 'capture';
      remaining = (atkStrength - defStrength) / atkPerTroop;
    } else {
      outcome = 'fail';
      remaining = (defStrength - atkStrength) / defPerTroop;
    }
  }

  return { sending, arriveSec, defenderAtArrival, outcome, remaining, routable, unroutable };
}

function pathDurationSec(battle, owner, path) {
  const runtime = getRuntime(battle);
  const stats = ownerStats(owner, battle.player, battle.arena.enemyFaction, battle.enemy);
  const marchActive = owner === PLAYER_OWNER && battle.t < battle.effects.marchUntil;
  const speed = BATTLE.baseSpeed * stats.speed * (marchActive ? POWERS.march.mult : 1) * marchSpeedMult(battle);
  let seconds = 0;
  for (const tileIndex of path) {
    const tile = runtime.byIndex.get(tileIndex);
    seconds += tile.cost / speed;
  }
  return seconds;
}

function projectTroops(site, seconds) {
  if (site.troops < site.cap) return Math.min(site.cap, site.troops + site.growth * seconds);
  if (site.troops > site.cap) {
    const excess = site.troops - site.cap;
    const bleed = Math.max(BATTLE.minBleed, BATTLE.overCapBleed * excess);
    return Math.max(site.cap, site.troops - bleed * seconds);
  }
  return site.troops;
}
