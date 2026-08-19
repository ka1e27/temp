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
import { siteControlFraction } from '../battle/siteinfo.js';

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

/**
 * THE OBJECTIVE LINE, WHICH WAS WALLPAPER.
 *
 * It read `Take the Castle. Don't lose the Camp.` and never changed, so the
 * one sentence permanently on screen said nothing about the battle it was
 * sitting over. Meanwhile `castleGateFrac` — the share of the countryside you
 * must hold before a siege of the throne can COMPLETE, i.e. the actual win
 * condition on nineteen of the twenty-four regions — appears in battle only
 * inside the castle's own site panel, and only once a siege is already
 * running. A player who has forgotten the pre-battle number over a 10-20
 * minute fight has nowhere to re-check whether the throne is even takeable
 * without knowing to click that one building.
 *
 * NOTHING NEW IS COMPUTED. `siteControlFraction` is the sim's own answer, the
 * same one `castleSealed` gates on and the same one the castle panel shows, so
 * this line cannot drift from the rule it is describing.
 *
 * A REGION WITH NO GATE SAYS NOTHING EXTRA, and that is a rule rather than a
 * tidiness: five regions ship `castleGateFrac: 0`, including the campaign
 * opener, and this project has already shipped a coach line that described the
 * gate in a region that has none. `0% of 0%` would be worse than the silence.
 *
 * @returns {{text:string, open:boolean}} `open` is for the caller to style —
 *   the moment the gate clears is the moment the win becomes available, and
 *   nothing in the game announced it.
 */
export function objectiveLine(state) {
  const base = 'Take the Castle. Don’t lose the Camp.';
  const need = state?.rules?.castleGateFrac ?? 0;
  if (!need) return { text: base, open: false };
  const have = siteControlFraction(state, 'player');
  // Rounded the way the castle panel rounds it, so the two never disagree by a
  // point at the moment the player is checking one against the other.
  const pct = Math.round(have * 100);
  const goal = Math.round(need * 100);
  return have >= need
    ? { text: `Take the Castle · THE GATE IS OPEN`, open: true }
    : { text: `Take the Castle · hold ${pct}% of ${goal}%`, open: false };
}
