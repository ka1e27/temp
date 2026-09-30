// Public battle simulation API (ARCHITECTURE §6): createBattle, step, issue, squadPosition,
// previewSend. Pure: no DOM, no Math.random, no Date.now — see docs/ARCHITECTURE.md §1.
//
// step() is deliberately agnostic to who is "playing": it only applies whatever commands are
// queued via issue(). The enemy AI (ai.js) and the harness's player bot (bot.js) are peers
// that read battle state and call issue() themselves (see their files) — step() never calls
// either one. This keeps mechanics fully testable in isolation (a test can construct a
// battle and step() it without any AI ever deciding to do something unplanned) and keeps
// ai.js/bot.js symmetric.
import { BATTLE, SITE_TYPES, POWERS } from '../config/battle.js';
import {
  effectiveCap, effectiveGrowth, squadPerTroopStrength, garrisonPerTroopStrength,
  ownerStats, resolveTowerVolleys, resolveEngagements, PLAYER_OWNER,
} from './combat.js';
import { applyPower, processPending } from './powers.js';
import { sendFromSite } from './squads.js';
import { advanceMovement, mergeSquads } from './movement.js';
import { resolveCombat, applyGrowth, checkEndConditions } from './resolve.js';
import { getRuntime, pathBetweenSites } from './runtime.js';
import { squadPosition } from './position.js';

export { squadPosition };

/** @returns {object} a fresh BattleState (ARCHITECTURE §6) for an arena + stat blocks. */
export function createBattle(arena, player, enemy, opts = {}) {
  const arenaCopy = {
    ...arena,
    tiles: arena.tiles.map((t) => ({ ...t })),
    sites: arena.sites.map((s) => ({ ...s })),
    focus: { ...arena.focus },
  };
  const playerCopy = { ...player, powers: { ...player.powers } };
  const enemyCopy = { ...enemy };

  const sites = arenaCopy.sites.map((s) => {
    const site = {
      id: s.id,
      tile: s.tile,
      type: s.type,
      owner: s.owner,
      troops: s.troops,
      cap: effectiveCap(s.type, s.owner, playerCopy, s.capMult),
      capMult: s.capMult ?? 1,
      growth: effectiveGrowth(s.type, s.owner, playerCopy, arenaCopy.enemyFaction, enemyCopy),
      def: SITE_TYPES[s.type].def,
      bulwarkUntil: 0,
      assault: null,
    };
    if (s.type === 'tower') site.nextVolley = 0;
    return site;
  });

  return {
    version: 1,
    t: 0,
    tick: 0,
    speed: 1,
    arena: arenaCopy,
    player: playerCopy,
    enemy: enemyCopy,
    sites,
    squads: [],
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
  };
}

/** Queues a command; applied at the start of the next step() call. */
export function issue(battle, command) {
  battle.commands.push(command);
  return battle;
}

function applyCommand(battle, cmd, t) {
  if (!cmd) return;
  if (cmd.type === 'send') {
    const froms = Array.isArray(cmd.from) ? cmd.from : [cmd.from];
    for (const fromId of froms) {
      const site = battle.sites[fromId];
      if (!site || site.owner !== cmd.owner) continue;
      sendFromSite(battle, fromId, cmd.to, cmd.fraction);
    }
  } else if (cmd.type === 'power') {
    applyPower(battle, cmd, t);
  } else if (cmd.type === 'retreat') {
    battle.result = 'retreat';
    battle.stats.durationSec = t;
    battle.events.push({ type: 'end', result: 'retreat' });
  }
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

  const blocked = resolveEngagements(battle);
  advanceMovement(battle, dt, t, blocked);
  mergeSquads(battle);
  processPending(battle, t);
  resolveCombat(battle, dt, t);
  resolveTowerVolleys(battle, getRuntime(battle), t);
  applyGrowth(battle, dt);
  checkEndConditions(battle, t);

  return battle;
}

/**
 * Predicts the outcome of a send assuming nothing else changes (ARCHITECTURE §6): used for
 * the drag tooltip. Read-only — never mutates `battle`.
 */
export function previewSend(battle, from, to, fraction) {
  const froms = Array.isArray(from) ? from : [from];
  const toSite = battle.sites[to];
  const contributions = [];

  for (const fromId of froms) {
    const site = battle.sites[fromId];
    if (!site) continue;
    const count = Math.floor(site.troops * fraction);
    if (count < 1) continue;
    const path = pathBetweenSites(battle, fromId, to);
    if (!path) continue;
    contributions.push({ count, owner: site.owner, seconds: pathDurationSec(battle, site.owner, path) });
  }

  const sending = contributions.reduce((sum, c) => sum + c.count, 0);
  if (sending === 0 || !toSite) {
    return {
      sending: 0, arriveSec: 0, defenderAtArrival: toSite ? toSite.troops : 0, outcome: 'fail', remaining: toSite ? toSite.troops : 0,
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

  return { sending, arriveSec, defenderAtArrival, outcome, remaining };
}

function pathDurationSec(battle, owner, path) {
  const runtime = getRuntime(battle);
  const stats = ownerStats(owner, battle.player, battle.arena.enemyFaction, battle.enemy);
  const marchActive = owner === PLAYER_OWNER && battle.t < battle.effects.marchUntil;
  const speed = BATTLE.baseSpeed * stats.speed * (marchActive ? POWERS.march.mult : 1);
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
