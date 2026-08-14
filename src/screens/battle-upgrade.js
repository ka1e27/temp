// The Upgrade action and the player-facing words for a rejected order.
//
// Split out of battle-panel.js purely for the line budget — both halves here
// are pure data/functions with no DOM, same spirit as battle-econ.js, and
// battle-panel.js re-exports them so nothing downstream has to care they moved.
import { SITE_UPGRADE, CENTIGOLD } from '../content/balance.js';
import { goldOf } from '../battle/economy.js';

/**
 * Player-facing text for every reason battle/commands.js can reject an order
 * with. A rejection the player cannot see is the same as no feedback at all —
 * that is how three boosters shipped unreachable and nobody noticed.
 * PURE DATA.
 */
export const REJECTIONS = Object.freeze({
  'unknown-site': 'That site is gone.',
  'not-your-site': 'You do not hold that site.',
  // Adjacency is gone; a base in the way is what refuses a march now.
  'no-route': 'No way through — an enemy base blocks every route.',
  'occupied-hex': 'A base is standing there. March beside it, or attack it.',
  'same-site': 'That is where they already are.',
  'not-adjacent': 'That is out of reach.',
  'bad-fraction': 'Nothing selected to send.',
  'empty-send': 'That garrison is empty — nothing to send.',
  'site-cannot-train': 'Farms cannot train troops.',
  'not-commissionable': 'That unit cannot be commissioned.',
  'already-commissioned': 'That site already has one.',
  'recruit-cooling': 'No one to commission yet — the last one only just rode out.',
  'unknown-unit': 'No such unit.',
  'unit-locked': 'That unit is not unlocked yet.',
  'already-upgrading': 'That site is already building.',
  'max-level': 'Already fully upgraded.',
  'insufficient-gold': 'Not enough gold.',
  // Raising a new building: buildBlocker's five refusals, plus cmdBuild's own
  // two. A rejection the player cannot read is the same as no feedback at
  // all — see the boosters this table already exists to fix.
  'not-buildable': 'That cannot be raised — only a farm, a yard or a wall may be built.',
  'already-building': 'Already raising as much as you can at once.',
  'off-map': 'That is off the map.',
  'blocked-ground': 'You cannot build on that ground.',
  occupied: 'Something already stands there.',
  'too-close': 'Too close to another site.',
  'no-ground': 'That is not your ground — build nearer a site you hold.',
  'unknown-target': 'No such rally target.',
  'bad-keep': 'A rally hold-back is a whole number of troops.',
  'nowhere-to-retreat': 'Nowhere to retreat to.',
  'nothing-to-retreat': 'Nothing there to retreat.',
  'unknown-squad': 'That squad has already arrived.',
  'not-your-squad': 'That is not your squad.',
  'already-retreating': 'That squad is already retreating.',
  'not-your-battle': 'Only you can withdraw.',
  'boosters-are-the-players': 'Boosters are yours alone.',
  'booster-unavailable': 'You did not bring that booster.',
  'no-charges': 'No charges left.',
  'unknown-booster': 'No such booster.',
  'needs-target': 'Pick a site for that booster.',
  'no-sources': 'No nearby garrison to rally.',
  'nothing-in-flight': 'No squads are marching.',
  'not-a-target': 'Bombard an enemy or neutral site.',
  malformed: 'That order made no sense.',
  'unknown-command': 'That order made no sense.',
});

/** @param {{reason?:string, cmd?:object}} ev @returns {string} */
export function rejectionText(ev) {
  const reason = ev?.reason ?? '';
  const said = REJECTIONS[reason] || `Order refused (${reason || 'unknown'}).`;
  const id = ev?.cmd?.id;
  return id && reason !== 'needs-target' ? `${id.toUpperCase()}: ${said}` : said;
}

/**
 * What the Upgrade action can offer for one site right now.
 * PURE — the whole affordability gate is testable without a DOM.
 * @returns {{level:number, cost:number, sec:number, can:boolean, why:string}}
 */
export function upgradeOffer(state, site) {
  const out = { level: site.level, cost: 0, sec: 0, can: false, why: '' };
  const spec = SITE_UPGRADE[site.level - 1];
  if (!spec) { out.why = 'max-level'; return out; }
  out.cost = spec.gold;
  out.sec = spec.sec;
  if (site.owner !== 'player') { out.why = 'not-your-site'; return out; }
  if (site.upgradeTicksLeft > 0) { out.why = 'already-upgrading'; return out; }
  if (goldOf(state.factions.player) < spec.gold * CENTIGOLD) {
    out.why = 'insufficient-gold';
    return out;
  }
  out.can = true;
  return out;
}

/** The button's label for an offer, so the wording is testable too. The top
 *  level is READ OFF the tuning table rather than written into the string: the
 *  ladder has already been extended once, and a button that says "max" at a
 *  level you can still buy past is worse than no label. */
export function upgradeLabel(o) {
  if (o.why === 'max-level') return `Level ${SITE_UPGRADE.length + 1} · max`;
  return `Upgrade → L${o.level + 1} · ${o.cost}g · ${o.sec}s`;
}
