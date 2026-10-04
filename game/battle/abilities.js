// A General's active ability (DESIGN §10.11): once per battle, issued as a command `{ type: 'ability', owner, ability, target? }`
// and applied by sim.js at the start of the next step, so a command log replays it exactly. The ability's numbers ride in
// `battle.player.ability` (meta/generalsState.js abilityOf, folded into PlayerStats by playerBattleStats), whether it was used in
// `battle.abilityUsed`. Pure: no DOM, no Math.random, no Date.now.
//
//   shieldWall  Bulwark on every settlement you hold for `duration` s (+ heal a share of every garrison, + a levy, by skill)
//   charge      your next `squads` squads march x(1 + speed) and hit x(1 + strength)          (squads.js marks them)
//   foresight   every enemy squad marches x(1 - slow) for `duration` s; their targets are revealed (effects.revealUntil, for the UI)
//   raid        `squads` free squads of `share` x the camp's starting troops ride from your strongest site that can reach `target`
//   bonus       your camp (the keep in a defense) gains `share` of its troops
//   raiseFallen the troops you lost in the last `windowSec` s join your strongest site, at most `cap` x the camp's starting troops
// Events: `ability { owner, ability, x, y, target, sites? }` for fx, and the ordinary `send` events of a Raid's squads.
import { PLAYER_OWNER } from './owner.js';
import { tileAt } from './runtime.js';
import { routeFor, canRoute } from './routing.js';
import { recentLosses } from './fallen.js';


/** `{ id, ready, used }` for the HUD button, or null when nobody with an ability commands. */
export function abilityState(battle) {
  const a = battle.player && battle.player.ability;
  if (!a || !a.id) return null;
  const uses = abilityUses(battle);
  const left = Math.max(0, uses - usedCount(battle));
  return { id: a.id, used: !!battle.abilityUsed, ready: left > 0 && !battle.result, needsTarget: a.id === 'raid', uses, left };
}

/** Uses per battle: 1, or `ability.uses` (the Warrior Kings Edict, PLAN-PHASE5). */
function abilityUses(battle) {
  const u = battle.player && battle.player.ability ? battle.player.ability.uses : 1;
  return Number.isInteger(u) && u > 1 ? u : 1;
}

/** Uses spent: `battle.abilityCount`, or 1 for a battle saved before it existed that has `abilityUsed`. */
function usedCount(battle) {
  return Number.isInteger(battle.abilityCount) ? battle.abilityCount : battle.abilityUsed ? 1 : 0;
}

function anchor(battle) {
  const camp = battle.sites.find((s) => s.owner === PLAYER_OWNER && s.type === 'camp');
  const keep = battle.arena.keepSite != null ? battle.sites[battle.arena.keepSite] : null;
  const site = camp || (keep && keep.owner === PLAYER_OWNER ? keep : null) || battle.sites.find((s) => s.owner === PLAYER_OWNER);
  if (site) return tileAt(battle, site.tile);
  const f = battle.arena.focus;
  return { x: (f.minX + f.maxX) / 2, y: (f.minY + f.maxY) / 2 };
}

/** The player's site holding the most troops (lowest id on a tie), or null. */
function strongestSite(battle) {
  let best = null;
  for (const s of battle.sites) if (s.owner === PLAYER_OWNER && (!best || s.troops > best.troops)) best = s;
  return best;
}

/** The player's site a Raid rides from: the strongest one that has a route to `targetId` (lowest id on a tie), or null. */
function raidSource(battle, targetId) {
  let best = null;
  for (const s of battle.sites) {
    if (s.owner !== PLAYER_OWNER || s.id === targetId) continue;
    if (!canRoute(battle, PLAYER_OWNER, s.id, targetId)) continue;
    if (!best || s.troops > best.troops) best = s;
  }
  return best;
}

/**
 * Applies an `ability` command at time `t` (sim.js applyCommand). A command that cannot apply (no ability, the wrong one, already
 * used, a Raid with no reachable target) does nothing and costs nothing, so replay stays deterministic.
 */
export function applyAbility(battle, cmd, t) {
  const a = battle.player && battle.player.ability;
  if (!a || usedCount(battle) >= abilityUses(battle) || cmd.owner !== PLAYER_OWNER || (cmd.ability && cmd.ability !== a.id)) return false;
  const ev = { type: 'ability', owner: PLAYER_OWNER, ability: a.id, target: null };
  let pos = anchor(battle);
  if (a.id === 'shieldWall') {
    const sites = [];
    for (const s of battle.sites) {
      if (s.owner !== PLAYER_OWNER) continue;
      s.bulwarkUntil = Math.max(s.bulwarkUntil || 0, t + a.duration);
      if (a.heal) s.troops += s.troops * a.heal;
      if (a.levy) s.troops += a.levy;
      sites.push(s.id);
    }
    ev.sites = sites;
  } else if (a.id === 'charge') {
    battle.effects.chargeLeft = a.squads;
    battle.effects.chargePower = 1 + a.strength;
    battle.effects.chargeSpeed = 1 + a.speed;
  } else if (a.id === 'foresight') {
    battle.effects.slowUntil = t + a.duration;
    battle.effects.slow = a.slow;
    battle.effects.revealUntil = t + a.duration;
  } else if (a.id === 'raid') {
    const target = battle.sites[cmd.target];
    if (!target || target.owner === PLAYER_OWNER) return false;
    const from = raidSource(battle, target.id);
    if (!from) {
      battle.events.push({ type: 'refused', reason: 'noRoute', owner: PLAYER_OWNER, to: target.id });
      return false;
    }
    const route = routeFor(battle, PLAYER_OWNER, from.id, target.id);
    const count = Math.max(1, Math.round(a.share * (battle.player.campTroops || 0)));
    for (let k = 0; k < (a.squads || 1); k++) {
      const squad = {
        id: battle.nextId++, owner: PLAYER_OWNER, count, from: from.id, to: target.id, path: route.tiles.slice(),
        seg: 0, prog: k * 0.3, state: 'march', foe: null,
      };
      if (a.noArrows) squad.noArrows = true;
      battle.squads.push(squad);
      battle.events.push({ type: 'send', owner: PLAYER_OWNER, from: from.id, to: target.id, count, squad: squad.id, raid: true });
    }
    ev.target = target.id;
    pos = tileAt(battle, target.tile);
  } else if (a.id === 'bonus') {
    const camp = battle.sites.find((s) => s.owner === PLAYER_OWNER && s.type === 'camp')
      || (battle.arena.keepSite != null && battle.sites[battle.arena.keepSite]?.owner === PLAYER_OWNER ? battle.sites[battle.arena.keepSite] : null);
    if (!camp) return false;
    camp.troops += camp.troops * a.share;
    ev.target = camp.id;
    pos = tileAt(battle, camp.tile);
  } else if (a.id === 'raiseFallen') { // the Gravewarden (PLAN-PHASE6): the losses log is kept by battle/fallen.js
    const count = Math.floor(Math.min(recentLosses(battle, t, a.windowSec), a.cap * (battle.player.campTroops || 0)));
    const site = strongestSite(battle);
    if (!site || count < 1) return false;
    site.troops += count;
    ev.target = site.id;
    ev.count = count;
    pos = tileAt(battle, site.tile);
  } else {
    return false;
  }
  battle.abilityCount = usedCount(battle) + 1;
  battle.abilityUsed = true; // used at least once (the crown tracker and the Bounty Board read it)
  battle.abilityAt = t;
  ev.x = pos.x;
  ev.y = pos.y;
  battle.events.push(ev);
  return true;
}

/**
 * When a sensible commander would use the ability now, as a command, or null (the Steward and the tools' bots use it; the player
 * presses the button). Shield Wall when a big attack lands on a site that would fall, Charge with a big send of ours on the way to a
 * target, Foresight when a large enemy force marches on us, Raid at the weakest enemy site we can reach (once the opening is over),
 * the Bonus at once.
 */
export function abilityAdvice(battle, t) {
  const st = abilityState(battle);
  if (!st || !st.ready) return null;
  const a = battle.player.ability;
  const mine = battle.sites.filter((s) => s.owner === PLAYER_OWNER);
  const foes = battle.squads.filter((q) => q.owner !== PLAYER_OWNER);
  const cmd = (target = null) => ({ type: 'ability', owner: PLAYER_OWNER, ability: a.id, target });
  if (a.id === 'bonus') return cmd();
  if (a.id === 'raiseFallen') { // once the losses would fill most of the cap (or late in the fight with anything to raise)
    const cap = a.cap * (battle.player.campTroops || 0);
    const lost = recentLosses(battle, t, a.windowSec);
    return lost >= 0.8 * cap || (t > 60 && lost >= 0.3 * cap) ? cmd() : null;
  }
  if (a.id === 'shieldWall') {
    for (const s of mine) {
      if (!s.assault || s.assault.owner === PLAYER_OWNER) continue;
      const atk = s.assault.squads.reduce((n, id) => n + (battle.squads.find((q) => q.id === id)?.count || 0), 0);
      if (atk > s.troops * 0.8 && t >= s.bulwarkUntil) return cmd();
    }
    return null;
  }
  if (a.id === 'foresight') {
    const marching = foes.filter((q) => q.state === 'march' && battle.sites[q.to]?.owner === PLAYER_OWNER);
    const total = marching.reduce((n, q) => n + q.count, 0);
    const held = mine.reduce((n, s) => n + s.troops, 0);
    return total > 0.5 * Math.max(1, held) ? cmd() : null;
  }
  if (a.id === 'charge') {
    // just before a big wave of ours sets out: the caller issues it, then its next sends carry the charge; we fire when a site is
    // full enough to make one
    const big = mine.find((s) => s.troops >= 0.6 * s.cap && s.troops >= 20);
    return big && t > 3 ? cmd() : null;
  }
  if (a.id === 'raid') {
    if (t < 10) return null;
    let best = null;
    for (const s of battle.sites) {
      if (s.owner === PLAYER_OWNER || s.assault) continue;
      if (!raidSource(battle, s.id)) continue;
      if (!best || s.troops < best.troops) best = s;
    }
    if (!best) return null;
    const count = a.share * (battle.player.campTroops || 0) * (a.squads || 1);
    return count > best.troops * 1.2 || t > 40 ? cmd(best.id) : null;
  }

  return null;
}
