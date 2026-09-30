// Creating a marching squad by sending a share of a site's garrison. Shared by sim.js's
// `send` command and powers.js's Rally (which fans a send out from every owned site).
import { pathBetweenSites } from './runtime.js';
import { PLAYER_OWNER } from './owner.js';


/**
 * Sends `floor(troops * fraction)` troops (min 1, no-op if < 1) from one site toward
 * another as a new marching squad, per DESIGN §4.3 / ARCHITECTURE §6. No-ops if the source
 * and target are the same site or no path exists. Mutates `battle` in place and pushes a
 * `send` event on success.
 * @returns {object|null} the created squad, or null if nothing was sent.
 */
export function sendFromSite(battle, fromSiteId, toSiteId, fraction) {
  if (fromSiteId === toSiteId) return null;
  const from = battle.sites[fromSiteId];
  const to = battle.sites[toSiteId];
  if (!from || !to) return null;
  const count = Math.floor(from.troops * fraction);
  if (count < 1) return null;
  const path = pathBetweenSites(battle, fromSiteId, toSiteId);
  if (!path || path.length === 0) return null;

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
  battle.squads.push(squad);
  if (squad.owner === PLAYER_OWNER) battle.stats.sent += count;
  battle.events.push({
    type: 'send', owner: squad.owner, from: fromSiteId, to: toSiteId, count, squad: squad.id,
  });
  return squad;
}
