// WHAT ONE SIDE ACTUALLY KNOWS — the perceived view, split out of ./vision.js
// at the 400-line cap along the seam that was already there.
//
// ./vision.js owns SIGHT: the per-hex map, who can see which tile, and what a
// column writes down as it passes. This file owns the answer callers want from
// that — the ghost a site resolves to when nobody is looking, the squads a
// faction is actually handed, and the one predicate that decides whether a
// building is on your screen at all.
//
// The split matters because the two are asked by different people.
// `perceivedSite` is "what do I know about this site" and the AI and the
// harness bot need it over the WHOLE map (their planners are pure whole-map
// geometry — see battle/belief.js). `siteKnown` is "is it on my screen", which
// is a rendering question. Wiring them together would fog site EXISTENCE from
// the commander, which is a different feature with a balance pass attached.
//
// vision.js re-exports all of it, so no import path changes.
// PURE.
import { COUNTER_INTEL_RADIUS } from '../content/balance.towers.js';
import { distance } from '../core/hex.js';
import { canSee } from './vision.js';
import { squadHexOf } from './movement.js';
import { asHex } from './influence.js';
import { siteById } from './siteinfo.js';

/**
 * HAS `faction` EVER LAID EYES ON THIS SITE? Owns it, sees it now, or `seen`
 * carries a last-known owner for it.
 *
 * The ONE predicate every player-facing surface asks, so that hiding a
 * building on the board and hiding it in the panel can never come apart — the
 * same reason `perceivedSite` is one resolver rather than three. It is
 * deliberately NOT folded into `perceivedSite`: that function answers "what do
 * I know about this site", which the AI and the harness bot both need over the
 * WHOLE map (their planners are pure whole-map geometry — see battle/belief.js),
 * and this one answers "is it on my screen at all", which is a rendering
 * question. Wiring the two together would fog site EXISTENCE from the
 * commander as well, and a planner reasoning about a map with holes in it is a
 * different feature with a balance pass attached.
 */
export function siteKnown(state, faction, site) {
  if (site.owner === faction) return true;
  const [q, r] = site.hex;
  if (canSee(state, faction, q, r)) return true;
  return state.seen?.[faction]?.[site.id] !== undefined;
}

/**
 * The site `faction` actually gets to know about right now.
 *
 * Position, kind and `adj` are common knowledge from tick 0 (see the file
 * header) — what fog hides is the live half. Owning the site, or currently
 * seeing its hex, returns the real, live object; otherwise a GHOST carrying
 * only what is common knowledge plus the last-known owner, and nothing that
 * CHANGES (garrison, HP, siege, level, trainType) — a ghost that carried any
 * of those would be fog leaking the one number that matters.
 *
 * @returns {object} the real site, or `{id, hex, kind, adj, owner, ghost:true}`
 */
export function perceivedSite(state, faction, site) {
  const [q, r] = site.hex;
  if (site.owner === faction || canSee(state, faction, q, r)) return site;
  return {
    id: site.id,
    hex: site.hex,
    kind: site.kind,
    adj: site.adj,
    owner: state.seen?.[faction]?.[site.id] ?? null,
    ghost: true,
  };
}

/**
 * COUNTER-INTELLIGENCE: is `sq`, standing at `hex`, currently under the cover
 * of one of ITS OWNER'S OWN watchtowers? See the file header for why this is
 * squads-only and lives here rather than in `canSee`.
 *
 * O(sites), same shape as `towers.js gunsOf` and for the same reason: the
 * armed/covering kinds are a handful of buildings on the biggest board, so a
 * scan per squad costs nothing next to `canSee`'s own per-squad scan above.
 * Gated on `buildTicksLeft` for the same reason `recomputeVision` gates a
 * tower's own sight on it — SCAFFOLDING IS BLIND, so it cannot cover anyone
 * either; presence is not production.
 */
function hiddenByOwnTower(state, sq, hex) {
  for (const site of state.sites) {
    if (site.owner !== sq.owner) continue;
    const radius = COUNTER_INTEL_RADIUS[site.kind];
    if (!radius) continue;
    if (site.buildTicksLeft > 0) continue;
    if (distance(asHex(site.hex), hex) <= radius) return true;
  }
  return false;
}

/**
 * Every squad `faction` gets to know about right now: its own, unconditionally
 * (an army always knows where it is), plus any of the enemy's currently
 * standing on a hex it can see AND not currently covered by one of ITS OWN
 * watchtowers (`hiddenByOwnTower` above) — counter-intelligence, not just
 * sight, and it is why a squad can be on ground `faction` can plainly see and
 * still not be handed to them.
 *
 * A squad that leaves vision (or comes under cover) drops out immediately and
 * without a trace — no ghost, deliberately: a remembered army is worse than
 * no information, because the player would act on a position that is
 * certainly stale.
 *
 * @returns {object[]}
 */
export function perceivedSquads(state, faction) {
  const out = [];
  for (const sq of state.squads) {
    if (sq.owner === faction) { out.push(sq); continue; }
    const hex = squadHexOf(state, sq);
    if (!hex || !canSee(state, faction, hex.q, hex.r)) continue;
    if (hiddenByOwnTower(state, sq, hex)) continue;
    out.push(sq);
  }
  return out;
}
