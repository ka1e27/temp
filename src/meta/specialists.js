// THE FOUR SPECIALISTS ARE OPT-IN AND EASY TO FORGET — this is the fix that
// ROADMAP.md asked for: turn a region's own authored table into advice at the
// moment a loadout is actually chosen, instead of leaving the player to notice
// on their own that a particular map wanted halberds.
//
// PURE, like every file in this directory. It reads `siteCounts.enemyMix` and
// `develop` off a REGIONS row (content/regions.data.js) and the unit tables in
// content/balance.js; the only other thing it asks anything of is
// `unlockedUnits`, which is meta/upgrades.js's own aggregation and already
// obeys the same rule. No DOM, no clock, no random draws — see CLAUDE.md's
// first invariant.
//
// DERIVED, NOT AUTHORED. Nothing here is a new column on the region table:
// `develop` and `enemyMix` are read by mapgen and the combat engine already, so
// a balance pass that moves either one moves this without anyone remembering a
// second table of hints to keep in step. A screen that derived its own advice
// would be the second implementation of the rule this project keeps finding.
//
// TWO CALLOUTS, THREE UNITS, AND ARCHERS ARE DELIBERATELY NEVER ONE OF THEM.
// Their whole value is WHERE a squad is standing mid-fight — a tile back from
// a melee they are not in — and there is no column on a region's table that
// says how often that comes up. Inventing a proxy for it would be exactly the
// "a callout that fires on every region is noise" failure this file exists to
// avoid, so the honest answer is that this pair says nothing about archers,
// ever.
//
// GATED ON THE UNLOCK, BUT NOT SUPPRESSED BY IT — a judgment call, and this is
// the reasoning for it. A player who has not bought a unit still gets told the
// region rewards it, worded as a nudge at the shop rather than an order to
// bring something they cannot: the moment a wall-heavy region is in front of
// them is the moment the unlock is worth its crowns, and suppressing the line
// entirely would hide the one piece of information that would make a new
// player buy it. The alternative — say nothing until it is owned — was
// considered and rejected on that basis.
import { SITES, UNITS } from '../content/balance.js';
import { totalSites } from '../content/regions.data.js';
import { unlockedUnits } from './upgrades.js';

/**
 * Average defended-site LEVEL (content/balance.js SITE_LEVELS) the enemy
 * starts at. A judgment call rather than a constant read off another table —
 * chosen because it is the point past which CLAUDE.md's own tier-3 finding
 * says a fort stops merely standing there: one whole castle level (2.05 ->
 * 2.15 `develop`) was the entire gap between vaelstrand's 82% and duskfell's
 * 56% at otherwise-matched settings.
 */
export const WALL_DEVELOP_MIN = 2;
/** However built up the ground is, the castle alone (present on every region)
 *  is not "wall country" — this asks for at least one more fort standing
 *  behind it. */
export const WALL_FORTS_MIN = 2;
/** Share of the board that starts neutral. 0.5 reads as "most of it", which is
 *  content/balance.js's own description of what outriders answer: "the maps
 *  start being mostly unclaimed". */
export const OPEN_NEUTRAL_SHARE_MIN = 0.5;

const speedRatio = () => Math.round(UNITS.outriders.speed / UNITS.militia.speed);

/** One line, worded for whichever half of the gate the player is standing on.
 *  `verb` and `rest` are the ELLIPTICAL clause a unit name completes (see the
 *  screen's own `<strong>{name}</strong> <span>{note}</span>` pattern), so the
 *  unit is never named twice in the same sentence. */
function note(unlocked, verb, rest) {
  const lead = unlocked ? verb : `would ${verb}`;
  const tail = unlocked ? '' : ' Unlock in the shop.';
  return `${lead} ${rest}${tail}`;
}

const callout = (id, unit, unlocked, verb, rest) =>
  ({ id, unit, unlocked, note: note(unlocked, verb, rest) });

/**
 * Zero or more short callouts for the pre-battle brief, keyed on the region's
 * own authored data rather than a new field on it.
 *
 * @param {object} meta
 * @param {object} region a REGIONS row (content/regions.data.js) — the same
 *   object screens/prebattle-brief.js `regionBrief` already resolved
 * @returns {{id:string, unit:string, unlocked:boolean, note:string}[]}
 */
export function specialistCallouts(meta, region) {
  const mix = region?.siteCounts?.enemyMix;
  if (!mix) return [];
  const have = new Set(unlockedUnits(meta));
  const out = [];

  if ((region.develop ?? 1) >= WALL_DEVELOP_MIN && mix.forts >= WALL_FORTS_MIN) {
    // BREAK: halberds cut the one advantage no amount of militia answers.
    out.push(callout('wallHalberds', 'halberds', have.has('halberds'), 'halve',
      `a fortified site's defence bonus — ${mix.forts} strongholds here defend at `
      + `×${SITES.stronghold.defMult}.`));
    // HOLD: sappers are the other half of the same fact — the same buildings
    // that are hard to break in ALSO repair fast enough that letting one go
    // again costs more than taking it did.
    out.push(callout('wallSappers', 'sappers', have.has('sappers'), 'make',
      'what you take stay taken — this ground repairs at '
      + `×${UNITS.sappers.repair} once garrisoned.`));
  }

  const total = totalSites(region);
  const neutralShare = total > 0 ? region.siteCounts.neutral / total : 0;
  if (neutralShare >= OPEN_NEUTRAL_SHARE_MIN) {
    const pct = Math.round(neutralShare * 100);
    out.push(callout('openOutriders', 'outriders', have.has('outriders'), 'cover',
      `unclaimed ground ${speedRatio()}× as fast as militia — ${pct}% of this `
      + 'map starts that way.'));
  }

  return out;
}
