// WHAT A BUILDING DOES TO AN ARMY WALKING PAST IT.
//
// Its own file rather than three more columns in `SITES`, for the same reason
// `BUILD_COSTS` is its own table: only two kinds have an entry, and a per-kind
// field that is absent on five of seven kinds reads as a hole rather than as a
// deliberate zero. A kind missing from here simply does not shoot, which is the
// honest default — `SITES[kind].range ?? 0` scattered through the sim is how a
// number gets silently applied to a building nobody meant to arm.
//
// THE TWO ARMED KINDS ARE THE TWO THAT ALREADY EARN NOTHING. A stronghold
// trains nothing and makes no gold; a watchtower does neither and cannot even
// fight. Both were bought purely for a passive effect — a defence multiplier
// and a sight radius — and this is the first thing either does on its OWN
// initiative. That is deliberate: giving a farm or a training ground a gun
// would make the economic buildings the military ones too, which is exactly
// the collapse the yard/wall split was made to undo.
//
// RANGE IS IN HEXES AND IT IS THE WHOLE DIFFERENCE BETWEEN THEM.
//
//   stronghold   1 hex  — anything touching it. A wall hits what is at its feet.
//   watchtower   2 hex  — it shoots as far as it is useful, which is still half
//                         of what it SEES (VISION_RADIUS 4). A tower that shot
//                         everything it could see would be a fortress with no
//                         drawback, and its drawback is the whole reason it is
//                         the cheapest thing on the build menu.
//
// The damage is deliberately small per second. This is a TAX ON MARCHING PAST,
// not a defence in itself: it should make routing an army around a wall worth
// the extra ground, and it must not make a lone watchtower able to grind down a
// real column on its own. Anything that can kill an assault by itself would
// make the siege mechanic — the thing the whole design rests on — optional.
// PURE DATA.
import { VISION_RADIUS } from './balance.js';

/** @typedef {{rangeHexes:number, dps:number}} TowerSpec */

/** @type {Readonly<Record<string, TowerSpec>>} */
export const TOWERS = Object.freeze({
  // A wall hits hard but only at its feet: walking into contact with a
  // stronghold should cost something even if you never intend to storm it.
  stronghold: Object.freeze({ rangeHexes: 1, dps: 1.6 }),
  // Reaches further and stings less. A watchtower's job is to make the ground
  // around it expensive to loiter on, so that a column crossing your territory
  // has to keep moving.
  watchtower: Object.freeze({ rangeHexes: 2, dps: 0.9 }),
});

/** Kinds that shoot at all, derived rather than repeated — a list written out
 *  twice is how a kind ends up armed in one file and unarmed in another. */
export const ARMED_KINDS = Object.freeze(Object.keys(TOWERS));

/**
 * COUNTER-INTELLIGENCE, not a weapon: a faction's own watchtower denies the
 * OTHER side sight of ITS squads (never sites — see battle/vision.js
 * `perceivedSquads`) within this many hexes of the tower. Only the watchtower
 * gets one; a stronghold's job is already done by `TOWERS` above.
 *
 * READS `VISION_RADIUS.watchtower` rather than mint a second number at the
 * same value: one bubble, two directions — what the tower GRANTS its own side
 * (sight) and what it DENIES the other (detection of the squads inside that
 * same sight). A radius wider than the tower's own sight would hide an army
 * the tower's owner could not itself see from there, which is not
 * counter-intelligence, it is a blind spot with a name.
 */
export const COUNTER_INTEL_RADIUS = { watchtower: VISION_RADIUS.watchtower };

/**
 * Damage a building deals in one tick, or 0 if it is unarmed.
 *
 * Scaled by LEVEL the same way HP and regen are: a site you have poured four
 * upgrades into should shoot harder, or the upgrade ladder would be the one
 * investment that makes a wall tougher without making it more dangerous.
 * Linear in level rather than compounding, because `SITE_LEVELS` already
 * compounds HP and two multiplying ladders on one building is how a late-game
 * stronghold becomes unapproachable.
 */
export function towerDamagePerTick(kind, level, tickHz) {
  const spec = TOWERS[kind];
  if (!spec || !(tickHz > 0)) return 0;
  return (spec.dps * (1 + 0.25 * (Math.max(1, level) - 1))) / tickHz;
}
