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
import { canRoute } from './routing.js';
import { powersBlocked, firestormMult } from './features.js';
import { onFirestormLanded } from './fallen.js';
import { boonsOf, onFirestorm, firestormBoonMult, powerCooldownBoonMult } from './boons.js';

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
  if (stats.powersBlocked) { // the Iron Will Challenge (PLAN-PHASE5 §5C): the player's powers are refused all dynasty
    battle.events.push({ type: 'refused', reason: stats.powersBlocked, owner, power });
    return;
  }
  if (powersBlocked(battle)) { // Holy Ground (DESIGN §10.13): no powers, General abilities still work
    battle.events.push({ type: 'refused', reason: 'holy', owner, power });
    return;
  }
  const level = stats.powers ? stats.powers[power] : 0;
  if (!level || level < 1) return;
  if (t < battle.cooldowns[power]) return;

  let pos = null;
  let appliedTarget = null;

  if (power === 'rally') {
    if (typeof target !== 'number' || !battle.sites[target]) return;
    appliedTarget = target;
    pos = tileAt(battle, battle.sites[target].tile);
    // Front lines (DESIGN §4.4): only settlements with a legal route send. If there are other settlements of ours but
    // none can reach the target, the power is refused and costs nothing.
    let others = 0;
    let routable = 0;
    for (const site of battle.sites) {
      if (site.owner !== owner || site.id === target) continue;
      others += 1;
      if (canRoute(battle, owner, site.id, target)) routable += 1;
    }
    if (others > 0 && routable === 0) {
      battle.events.push({ type: 'refused', reason: 'noRoute', owner, to: target });
      return;
    }
    const horns = owner === PLAYER_OWNER ? boonsOf(battle).rallyPowerMult || 1 : 1; // Rally Horns (PLAN-PHASE7): Rally's squads hit harder
    for (const site of battle.sites) {
      if (site.owner !== owner || site.id === target) continue;
      const sq = sendFromSite(battle, site.id, target, cfg.share);
      if (sq && horns !== 1) sq.power = (sq.power ?? 1) * horns;
    }
  } else if (power === 'firestorm') {
    const tile = resolveTargetTile(battle, target);
    if (!tile) return;
    pos = tile;
    appliedTarget = target;
    const damage = (cfg.damage + cfg.damagePerLevel * (level - 1)) * firestormMult(battle) * firestormBoonMult(battle); // Blizzard +50%; the Ember Heart (PLAN-PHASE7)
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

  battle.cooldowns[power] = t + cooldownSeconds(power, level, stats.cooldownMult) * powerCooldownBoonMult(battle, power); // the Horn of Ages (PLAN-PHASE7)
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
      onFirestormLanded(battle, p, t); // PLAN-PHASE6: the ground burns (no Fallen rise there) and a Barrow Keep's next Rising is cancelled
      onFirestorm(battle, p, t); // Scorched Earth (PLAN-PHASE7): the burning ground also burns enemy squads
    }
  }
  battle.pending = remaining;
}
