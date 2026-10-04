// The Champion of a Vendetta (PLAN-PHASE4 §4D): the rival leader's own squad, flagged `champion: true`. Pure: no DOM, no
// Math.random, no Date.now. Numbers in config/grudges.js (GRUDGES.vendetta.champion).
//
// A defense arena built with `opts.vendetta` (buildDefenseArena) carries `arena.champion = { troops, power }`; createBattle turns it
// into `battle.champion` (plain JSON, saved with the battle):
//   { owner, troops, power, from, to, launchAt, launched, squad: squadId|null, site: siteId|null, fellAt: battleSec|null }
// At `launchAt` the Champion marches from the war-band camp on your keep as one squad (`squad.champion = true`, `power` x a war-band
// troop; it never merges with other squads). If it takes a site (or reaches one of its own side's) it holds that site
// (`site.champion = true`). It FALLS when its squad dies or the site it holds is taken: the war band's attack drops by
// GRUDGES.vendetta.champion.attackDrop for the rest of the battle and a `championFell` event fires:
//   { type: 'championFell', owner, x, y, leader }      (leader: the Vendetta's leader name, for "{Leader}'s champion has fallen!")
import { GRUDGES } from '../config/grudges.js';
import { routeFor } from './routing.js';
import { isDead } from './combat.js';
import { tileAt } from './runtime.js';
import { squadPosition } from './position.js';

/** The battle's champion record for an arena that has one (createBattle calls this). */
export function initialChampion(arena) {
  const cfg = GRUDGES.vendetta.champion;
  return {
    owner: arena.enemyFaction,
    troops: arena.champion.troops,
    power: arena.champion.power ?? cfg.power,
    from: Number.isInteger(arena.campSite) ? arena.campSite : 0,
    to: arena.keepSite,
    launchAt: arena.champion.launchSec ?? cfg.launchSec,
    launched: false,
    squad: null,
    site: null,
    fellAt: null,
  };
}

/** The Champion's squad object before a step (so the step can tell, afterwards, whether it died or settled at a site). */
export function championSquadRef(battle) {
  const c = battle.champion;
  if (!c || c.squad == null) return null;
  return battle.squads.find((s) => s.id === c.squad) || null;
}

/** True while the Champion still stands (not launched yet, marching, or holding a site). */
export function championAlive(battle) {
  return !!battle.champion && battle.champion.fellAt == null;
}

function launch(battle, c) {
  c.launched = true;
  const camp = battle.sites[c.from];
  if (!camp || camp.owner !== c.owner) { fall(battle, c, battle.t, camp ? tileAt(battle, camp.tile) : null); return; }
  const route = c.to >= 0 && battle.sites[c.to] ? routeFor(battle, c.owner, c.from, c.to) : null;
  if (!route) { c.site = c.from; camp.champion = true; return; } // no way in: the Champion holds the camp
  const squad = {
    id: battle.nextId++, owner: c.owner, count: c.troops, from: c.from, to: c.to, path: route.tiles.slice(), seg: 0, prog: 0,
    state: 'march', foe: null, power: c.power, champion: true,
  };
  battle.squads.push(squad);
  c.squad = squad.id;
  battle.events.push({ type: 'send', owner: c.owner, from: c.from, to: c.to, count: c.troops, squad: squad.id, champion: true });
}

function fall(battle, c, t, pos) {
  c.fellAt = t;
  c.squad = null;
  c.site = null;
  const drop = GRUDGES.vendetta.champion.attackDrop;
  if (battle.enemy && Number.isFinite(battle.enemy.atk)) battle.enemy.atk *= 1 - drop;
  const leader = battle.arena && battle.arena.vendetta ? battle.arena.vendetta.leader || '' : '';
  battle.events.push({ type: 'championFell', owner: c.owner, x: pos ? pos.x : 0, y: pos ? pos.y : 0, leader });
}

/**
 * Runs the Champion for one step (sim.js step calls it last, with the squad object taken before the step): launches it on time,
 * and detects its fall. MUTATES the battle.
 */
export function processChampion(battle, t, ref) {
  const c = battle.champion;
  if (!c || c.fellAt != null) return;
  if (!c.launched) {
    if (t + 1e-9 >= c.launchAt) launch(battle, c);
    return;
  }
  if (c.squad != null) {
    if (battle.squads.some((s) => s.id === c.squad)) return;
    // the squad is gone this step: it settled at a site of its own side (took it, or reinforced it) or it died
    const site = ref ? battle.sites[ref.to] : null;
    if (ref && !isDead(ref.count) && site && site.owner === c.owner) {
      c.squad = null;
      c.site = site.id;
      site.champion = true;
      return;
    }
    let pos = null;
    try { pos = ref ? squadPosition(battle, ref) : null; } catch { pos = null; }
    fall(battle, c, t, pos);
    return;
  }
  if (c.site != null) {
    const site = battle.sites[c.site];
    if (site && site.owner === c.owner) return;
    if (site) delete site.champion;
    fall(battle, c, t, site ? tileAt(battle, site.tile) : null);
  }
}
