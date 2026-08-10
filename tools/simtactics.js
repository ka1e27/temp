// HOW AN ORDINARY PLAYER USES THE THREE SPECIALISTS.
//
// This is the sibling of `upgradeTurn` in simplayer.js, and it exists for the
// same reason: a mechanic the harness does not exercise is a mechanic no balance
// number covers. The site-upgrade ladder went unmeasured for years that way.
// When outriders, halberds and sappers shipped, the harness fielded them the
// only way it knew how — dumped into the same undifferentiated column as
// everything else — and duly reported that all three made the bot WORSE:
//
//     region        default   +outriders   +halberds   +sappers
//     gallowmoor      60%        44%         27%         33%
//     thanescar       52%        25%         25%         27%
//     nightharrow     40%        27%         19%         29%
//
// ONLY ONE OF THE THREE WAS ACTUALLY BROKEN, and finding out which cost a wrong
// answer first. The obvious reading is that all three verbs need teaching, so
// the first attempt here also held halberds back from unfortified targets and
// kept sappers out of assaults entirely — per slot a halberd really is a worse
// line unit than militia, and a sapper really does do nothing in a field. Both
// rules are defensible and both are wrong, measured at n=48:
//
//     region        default   +halberds   +sappers      (hold-back rules)
//     gallowmoor      58%         6%         17%
//     thanescar       50%         8%         13%
//     nightharrow     38%        10%         13%
//
// Worse than the undifferentiated column they replaced, and on thanescar the
// halberds did not join a single assault in an entire battle. THE SLOTS ARE
// ALREADY SPENT. At the site panel the question is never "halberd or four
// militia" — that was decided at the loadout screen and cannot be unwound — it
// is "does this body march or does it stand here", and standing still is worth
// nothing at any exchange rate. Benching a third of the army also drags every
// assault below `ATTACK_MARGIN`, so the bot stops attacking at all: that is the
// 6%, and it is a sunk-cost error rendered as a win rate.
//
// So the rule that survived is the one where the game itself, not the bot's
// judgement, was throwing the value away — see RIDERS. The other two verbs turn
// out to need no teaching, because the bot already reasons with the sim's own
// functions: `sunder` is applied inside `resolveField` and `repair` inside
// `breachSeconds`, both of which the target scan already calls, so a
// halberd-carrying army sees fortified targets get cheaper and takes them.
//
// The surviving rule is deliberately NOT optimal play, for the same reason the
// upgrade rules are not: pricing a campaign against a solver ships an endgame
// nobody clears.
//
// INERT BY CONSTRUCTION ON THE DEFAULT ARMY. None of the three has a
// DEFAULT_COMPOSITION_WEIGHT and the bot only ever trains militia and rams, so
// on a default run every filter below is a no-op over a garrison that holds none
// of them, and `riderTurn` returns without queueing anything. That is what keeps
// all twenty-one tuned regions measuring the same player they were tuned
// against. `tests/harness.test.js` pins it with a negative control rather than
// leaving it to inspection.

import { UNIT_IDS, UNITS, MOVEMENT } from '../src/content/balance.js';
import { total, resolveField, breachSeconds } from '../src/battle/combat.js';
import { groundOf, siteDefMultOf } from '../src/battle/terrain.js';

/**
 * Units that must never share a squad with anything slower than themselves.
 *
 * `movement.js slowestSpeed` is a MIN over everything present, so a single
 * militia in the stack drops a 165-speed outrider to 55 and the entire reason
 * the unit exists is gone before it leaves the gate. The old harness sent
 * `filter: UNIT_IDS` every time, which means it never once moved an outrider at
 * outrider speed — the `+outriders` column above is a measurement of that bug
 * and of nothing else.
 *
 * Derived from the roster rather than listed, so a future fast unit is not
 * silently welded into the baggage train.
 */
export const RIDERS = Object.freeze(
  UNIT_IDS.filter((u) => UNITS[u].speed >= UNITS.militia.speed * 2),
);

/**
 * Units whose payout is in the site they are STANDING IN — and which ride out
 * with everyone else anyway.
 *
 * `repair` multiplies the garrison's structure regen, and `breachSeconds()`
 * returns Infinity the moment regen out-paces siege damage. The tempting
 * conclusion is that a sapper should never leave a wall. It is wrong twice
 * over: a sapper is `siege` 2.5 for 3 slots against militia's 0.6 for 1, so it
 * is the better siege body per slot and belongs in the assault on those grounds
 * alone; and the site it repairs is whichever one it is garrisoning after the
 * capture, which is exactly the one the enemy will come back for.
 *
 * Kept as a named role because the property is real and a future consumer may
 * want it — but it is NOT subtracted from any send. See the header.
 */
export const HOLDERS = Object.freeze(UNIT_IDS.filter((u) => UNITS[u].repair > 1));

/**
 * Units that pay extra against a fortified defender — and, again, ride at
 * everything regardless.
 *
 * `sunder` is applied inside `resolveField`, which the bot's own target scan
 * already calls on every candidate. So an army carrying halberds sees fortified
 * targets return more survivors and a shorter `breachSeconds`, and picks them up
 * on the ordinary scoring path with no special case at all. The verb was never
 * unexercised; only the outriders' was.
 */
export const BREAKERS = Object.freeze(UNIT_IDS.filter((u) => UNITS[u].sunder > 0));

/**
 * The defence multiplier at which `sunder` has something to strip. A farm is
 * `defMult` 1.00 flat (less on a river), a stronghold 1.25, a camp 1.40, a
 * castle 1.60. Exported for the tests and for anyone tempted to reintroduce a
 * gate here: the number is sound, the gate it once fed was not.
 */
export const FORTIFIED = 1.20;

/**
 * A rider commits on a thinner margin than the column, and the reason is
 * arithmetic rather than daring.
 *
 * simplayer's `ATTACK_MARGIN` of 1.5 is overkill bought to survive the
 * reinforcement that lands while the squad is in transit. Riders are in transit
 * for a third as long, so a third as much arrives. Measured on real maps the
 * median leg is 0.9-1.7s for a militia column against 0.3-0.6s for riders.
 */
export const RIDER_MARGIN = 1.25;

/** Riders are not siege troops — `siege` 0.5 against a ram's 12. A wall they
 *  cannot open in this long is somebody else's job. */
const RIDER_BREACH_SEC = 40;

/**
 * The column carries EVERYONE, riders included, and that is not a contradiction
 * of the rule above — it is the sunk-cost rule applied to it.
 *
 * `riderTurn` runs first and gets first refusal: any rider detachment that can
 * take something on its own goes on its own, at 165. What it declines is a
 * detachment that cannot act alone, and the choice for those bodies is to march
 * with the column or to stand in a rear camp being 2 slots of nothing. Marching
 * is free in the most literal sense — `slowestSpeed` is a MIN, so adding a
 * FASTER unit to a slow stack cannot slow it. The column moves at militia pace
 * either way; the only question is whether the outriders are in it.
 *
 * Held back entirely, they were: 50 landed on gallowmoor and nine squads' worth
 * ever moved, because a rider pass alone strands everything it turns down.
 */
export const COLUMN_FILTER = Object.freeze([...UNIT_IDS]);

/**
 * Who joins an attack on `target`: everyone still standing here.
 *
 * Both parameters are unused and both are deliberately kept — every version of
 * this function that inspected either one made the bot measurably worse, and the
 * signature is the reminder of why. See the header for the numbers. What is left
 * is the honest answer: the bot's own target scan already calls `resolveField`
 * and `breachSeconds`, which is where `sunder` and `repair` live, so those two
 * verbs are exercised by the ordinary decision path and need no help.
 */
export function assaultFilter(state, target) { // eslint-disable-line no-unused-vars
  return COLUMN_FILTER;
}

/** Just the riders, as their own squad. */
export const RIDER_FILTER = Object.freeze([...RIDERS]);

/**
 * Send the riders somewhere useful, alone.
 *
 * Their own squad every time, so `slowestSpeed` sees 165 and not the pace of
 * whatever else happened to be in the garrison. They take what they can
 * actually take — `siege` 0.5 means a stronghold is not theirs to crack — and
 * otherwise ride forward to the next site nearer the line, which is what turns
 * a rear-camp detachment into pressure instead of a statistic.
 *
 * Queues at most one command per site and returns whether it did, so the caller
 * can keep its own command ordering unchanged when there are no riders at all.
 */
export function riderTurn(state, src, front) {
  const riders = RIDERS.reduce((a, u) => a + (src.garrison[u] || 0), 0);
  if (riders < 4) return false;

  // Riders keep no home floor of their own: they are not the garrison, and a
  // rider left behind is a rider doing nothing. Two stay to keep the site's
  // scouting presence honest, the rest go.
  const fraction = Math.min(1, (riders - 2) / riders);
  const send = {};
  for (const u of UNIT_IDS) send[u] = RIDERS.includes(u)
    ? Math.floor((src.garrison[u] || 0) * fraction) : 0;
  if (total(send) < 3) return false;

  let best = null;
  let bestScore = Infinity;
  for (const id of src.adj) {
    const t = state.sites.find((x) => x.id === id);
    if (!t || t.owner === 'player' || t.siege?.owner === 'player') continue;
    if (t.kind === 'castle') continue; // not a rider's target at any margin
    const ground = groundOf(state, t);
    const field = resolveField(send, t.garrison, {
      siteDefMult: siteDefMultOf(state, t), ground,
    });
    if (!field.win || field.attPower < field.defPower * RIDER_MARGIN) continue;
    const secs = breachSeconds(field.attSurvivors, t.hp, t.kind, t.level, 1, 1, ground);
    if (!Number.isFinite(secs) || secs > RIDER_BREACH_SEC) continue;
    // Nearest thing they can actually take. Unowned ground is the prize —
    // a neutral farm costs a rider detachment nothing and pays for ten minutes.
    const score = secs + (t.owner === 'enemy' ? 20 : 0);
    if (score < bestScore) { bestScore = score; best = t; }
  }

  if (!best) {
    // Nothing takeable adjacent: ride toward the line rather than sit on it.
    const d = front[src.id];
    if (d === undefined || d === 0) return false;
    best = src.adj
      .map((id) => state.sites.find((x) => x.id === id))
      .filter((n) => n && n.owner === 'player' && front[n.id] < d)
      .sort((a, b) => total(a.garrison) - total(b.garrison))[0];
    if (!best) return false;
  }

  state.commands.push({
    t: 'SEND', from: src.id, to: best.id, fraction, filter: RIDER_FILTER,
  });
  return true;
}

/**
 * The reference march time for one hex, in seconds, at a unit's speed. Exported
 * only so a test can state the rider claim in the units it is actually about
 * rather than re-deriving MOVEMENT's constant.
 */
export const hexSeconds = (unitId) => MOVEMENT.hexSecondsPerSpeed / UNITS[unitId].speed;
