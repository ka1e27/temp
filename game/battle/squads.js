// Creating a marching squad by sending a share of a site's garrison. Shared by sim.js's
// `send` command and powers.js's Rally (which fans a send out from every owned site).
import { routeFor } from './routing.js';
import { PLAYER_OWNER } from './owner.js';
import { onPlayerSend } from './boons.js';


/**
 * Sends `floor(troops * fraction)` troops (min 1, no-op if < 1) from one site toward
 * another as a new marching squad, per DESIGN §4.3 / ARCHITECTURE §6. No-ops if the source
 * and target are the same site or there is no legal route under the front-line rule
 * (routing.js, DESIGN §4.4); the route is fixed here and the squad never reroutes. Mutates
 * `battle` in place and pushes a `send` event on success (`auto: true` when a supply line sent it).
 * @returns {object|null} the created squad, or null if nothing was sent.
 */
export function sendFromSite(battle, fromSiteId, toSiteId, fraction, opts = null) {
  if (fromSiteId === toSiteId) return null;
  const from = battle.sites[fromSiteId];
  const to = battle.sites[toSiteId];
  if (!from || !to) return null;
  const count = Math.floor(from.troops * fraction);
  if (count < 1) return null;
  const route = routeFor(battle, from.owner, fromSiteId, toSiteId);
  if (!route) return null;
  const path = route.tiles.slice();

  from.troops -= count;
  const squad = {
    id: battle.nextId++,
    owner: from.owner,
    count,
    from: fromSiteId,
    to: toSiteId,
    path,
    seg: 0,
    prog: 0,
    state: 'march',
    foe: null,
  };
  // Charge (DESIGN §10.11): the player's next squads march faster and hit harder
  const fx = battle.effects;
  if (from.squadPower) squad.power = from.squadPower; // a Bandit Camp's veterans hit harder wherever they march (DESIGN §10.13)
  if (squad.owner === PLAYER_OWNER && fx && fx.chargeLeft > 0) {
    squad.power = fx.chargePower;
    squad.speedMult = fx.chargeSpeed;
    fx.chargeLeft -= 1;
  }
  if (opts && opts.auto) squad.auto = true; // PLAN-PHASE14: a supply line sent it (the bot does not count these as squads it manages)
  if (route.lane) squad.lane = true; // PLAN-PHASE12: sails a sea lane (battle/sea.js): no clashes at sea, towers on the coast still shoot
  battle.squads.push(squad);
  if (squad.owner === PLAYER_OWNER) battle.stats.sent += count;
  onPlayerSend(battle, squad, opts); // Warlord's Mark (PLAN-PHASE7); Vanguard, Supply Wagons, Siege Train, Thunder Charge (PLAN-PHASE8)
  const event = {
    type: 'send', owner: squad.owner, from: fromSiteId, to: toSiteId, count, squad: squad.id,
  };
  if (opts && opts.auto) event.auto = true;
  if (squad.lane) event.lane = true;
  battle.events.push(event);
  return squad;
}
