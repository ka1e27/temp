// What the site panel is allowed to KNOW, and what it says about it.
//
// Split out of battle-panel.js at the 400-line cap, along the seam rather than
// at a line number: everything here is a pure derivation over a site — no DOM,
// no element, no listener — where that file is the element tree and its
// bindings. Kept as plain imports rather than re-exported from the panel,
// because none of it is API: the panel is the only caller and these are its
// vocabulary, not its surface.
import { rallyTargetsOf } from '../battle/state.js';
import { perceivedSquads } from '../battle/vision.js';
import { gateLine } from './battle-econ.js';
import { REJECTIONS } from './battle-upgrade.js';

export function squadById(state, id) {
  // FOG. A squad carries no ghost (battle/vision.js) — `perceivedSquads`
  // drops one the instant it leaves vision, on the board (battle-orders.js
  // `squadAt`) and here. Scanning `state.squads` directly, as this used to,
  // kept the panel reporting an enemy column's live strength and route long
  // after its glyph had faded from the canvas — the same leak decision 13
  // closes, found one surface later. `view.selectedSquad` itself is left
  // alone: if the same column marches back into a watchtower's ring it
  // should reappear, not stay gone forever.
  const squads = perceivedSquads(state, 'player');
  for (let i = 0; i < squads.length; i++) {
    if (squads[i].id === id) return squads[i];
  }
  return null;
}

/**
 * The HP bar's fill colour: the owning faction's own hue at full health — the
 * same signal `p.owner[site.owner]` gives the on-canvas HP ring (siteGlyphs.js
 * `drawHpRing`) — and, under an active siege, the SAME danger/warn split that
 * ring already uses (`frac < 0.35 ? danger : warn`), so a wall reads as
 * draining identically on the board and in the panel.
 */
export function hpColor(site, frac) {
  if (site.siege) return frac < 0.35 ? 'var(--c-danger)' : 'var(--c-warn)';
  return `var(--c-${site.owner})`;
}

export function statusLine(site, intel) {
  if (intel?.gate?.sealed) return `UNDER SIEGE · ${gateLine(intel)}`;
  if (site.siege) return 'UNDER SIEGE';
  // Above the shield and the rally for the reason UNDER SIEGE is: a fight
  // happening now outranks a standing arrangement. One string for both sides.
  if (site.melee) return 'FIELD BATTLE';
  if (site.shieldTicks > 0) return 'fortified';
  // One site may feed several neighbours in turn, so the status names all of
  // them — "rallying → a" when a two-way split is live would be a lie.
  const rally = rallyTargetsOf(site);
  if (rally.length) return `rallying → ${rally.join(' · ')}`;
  return '';
}

export function offerTitle(o) {
  if (o.can) return `Spend ${o.cost} gold · ${o.sec}s to build`;
  return REJECTIONS[o.why] || 'Cannot upgrade';
}
