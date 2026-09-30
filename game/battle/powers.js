// Active battle powers (DESIGN §4.5, ARCHITECTURE §6). Only the player has the stats
// (`player.powers`, `player.cooldownMult`) needed to use them today — EnemyStats carries no
// `powers`/`cooldownMult` fields (see docs/ARCHITECTURE.md §6). Effects below still take an
// explicit `owner` throughout (rather than assuming PLAYER_OWNER inside each effect) so that
// hooking up enemy powers later is just: add `powers`/`cooldownMult` to EnemyStats, resolve
// them in `statsFor`, and let ai.js issue the same `power` command — see the final report.
import { POWERS } from '../config/battle.js';
import { PLAYER_OWNER } from './owner.js';
import { isDead } from './combat.js';
import { squadPosition } from './position.js';
import { tileAt } from './runtime.js';
import { worldDist, hexRadiusToWorld } from './geom.js';
import { sendFromSite } from './squads.js';

/** Only the player can act as a caster today (see file header). */
function statsFor(battle, owner) {
  return owner === PLAYER_OWNER ? battle.player : null;
}

function cooldownSeconds(power, level, cooldownMult) {
  const cfg = POWERS[power];
  return cfg.cooldown * POWERS.cooldownPerLevel ** (level - 1) * cooldownMult;
}

/** Resolves a power target (siteId, or a free {q,r} hex) to an arena tile, or null. */
function resolveTargetTile(battle, target) {
  if (typeof target === 'number') {
    const site = battle.sites[target];
    return site ? tileAt(battle, site.tile) : null;
  }
  if (target && typeof target.q === 'number' && typeof target.r === 'number') {
    return battle.arena.tiles.find((t) => t.q === target.q && t.r === target.r) || null;
  }
  return null;
}

/** Anchor point for a global power's event (no single natural target): the caster's War
 * Camp, else their first surviving site, else the arena's focus centre. */
function anchorPosition(battle, owner) {
  const camp = battle.sites.find((s) => s.owner === owner && s.type === 'camp');
  const site = camp || battle.sites.find((s) => s.owner === owner);
  if (site) return tileAt(battle, site.tile);
  const f = battle.arena.focus;
  return { x: (f.minX + f.maxX) / 2, y: (f.minY + f.maxY) / 2 };
}

/**
 * Applies a `{type:'power', owner, power, target}` command at time `t`. No-ops silently
 * (locked power, on cooldown, invalid target, or an owner with no power stats) — a rejected
 * power command is not an error, it just does nothing, so replay stays deterministic
 * whether or not the UI double-checked eligibility first.
 */
export function applyPower(battle, command, t) {
  const { owner, power, target } = command;
  const stats = statsFor(battle, owner);
  const cfg = POWERS[power];
  if (!stats || !cfg) return;
  const level = stats.powers ? stats.powers[power] : 0;
  if (!level || level < 1) return;
  if (t < battle.cooldowns[power]) return;

  let pos = null;
  let appliedTarget = null;

  if (power === 'rally') {
    if (typeof target !== 'number' || !battle.sites[target]) return;
    appliedTarget = target;
    pos = tileAt(battle, battle.sites[target].tile);
    for (const site of battle.sites) {
      if (site.owner !== owner || site.id === target) continue;
      sendFromSite(battle, site.id, target, cfg.share);
    }
  } else if (power === 'firestorm') {
    const tile = resolveTargetTile(battle, target);
    if (!tile) return;
    pos = tile;
    appliedTarget = target;
    const damage = cfg.damage + cfg.damagePerLevel * (level - 1);
    battle.pending.push({
      at: t + cfg.delay, x: tile.x, y: tile.y, owner, power: 'firestorm', damage, radius: cfg.radius,
    });
  } else if (power === 'bulwark') {
    if (typeof target !== 'number') return;
    const site = battle.sites[target];
    if (!site || site.owner !== owner) return;
    const duration = cfg.duration + cfg.durationPerLevel * (level - 1);
    site.bulwarkUntil = t + duration;
    appliedTarget = target;
    pos = tileAt(battle, site.tile);
  } else if (power === 'march') {
    const duration = cfg.duration + cfg.durationPerLevel * (level - 1);
    battle.effects.marchUntil = t + duration;
    pos = anchorPosition(battle, owner);
  } else if (power === 'levy') {
    const amount = cfg.troops + cfg.troopsPerLevel * (level - 1);
    for (const site of battle.sites) {
      if (site.owner === owner) site.troops += amount;
    }
    pos = anchorPosition(battle, owner);
  } else {
    return;
  }

  battle.cooldowns[power] = t + cooldownSeconds(power, level, stats.cooldownMult);
  battle.events.push({ type: 'power', owner, power, x: pos.x, y: pos.y, target: appliedTarget });
}

/**
 * Applies any delayed effects (currently: firestorm impacts) whose time has come, removing
 * them from `battle.pending`. Firestorm only damages (per DESIGN §4.5); it never flips
 * ownership — a site emptied by fire sits at 0 troops for its existing owner until an actual
 * assault (or its own regrowth) changes that, exactly like combat trades do.
 */
export function processPending(battle, t) {
  const remaining = [];
  for (const p of battle.pending) {
    if (t < p.at) {
      remaining.push(p);
      continue;
    }
    if (p.power === 'firestorm') {
      const radius = hexRadiusToWorld(p.radius);
      for (const squad of battle.squads) {
        if (squad.owner === p.owner || isDead(squad.count)) continue;
        if (worldDist(squadPosition(battle, squad), p) <= radius) {
          squad.count = Math.max(0, squad.count - p.damage);
        }
      }
      for (const site of battle.sites) {
        if (site.owner === p.owner) continue;
        const tile = tileAt(battle, site.tile);
        if (tile && worldDist(tile, p) <= radius) {
          site.troops = Math.max(0, site.troops - p.damage);
        }
      }
      battle.events.push({ type: 'firestorm', x: p.x, y: p.y, radius: p.radius });
    }
  }
  battle.pending = remaining;
}
