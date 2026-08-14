// A FIELD BATTLE TAKES TIME, AND TWO FORCES ON ONE HEX FIGHT.
//
// Combat used to be instantaneous: a column arrived, `resolveField` ran once,
// and one side was gone before the next tick. That made a battle a sequence of
// commitments with no middle — you could not reinforce a fight, you could not
// pull out of one, and two armies could walk through each other on the same
// tile without noticing.
//
// THE ONE DESIGN DECISION THAT MAKES THIS AFFORDABLE: `resolveField` is
// unchanged and is now read as the PROJECTION — where this fight ends if
// nothing interferes. The sim interpolates both sides toward that projection
// over `MELEE_SECONDS` and re-projects whenever either side's composition
// changes. Three things fall out of that, and each one is a property the
// alternative (a fresh Lanchester exchange per tick) would not have had:
//
//   * THE PRE-COMMIT PREVIEW IS STILL A GUARANTEE. Invariant 3 says the preview
//     calls the same function the simulation runs, and it still does — the
//     preview shows the projection, and an uninterrupted fight lands exactly
//     there. A per-tick exchange would have needed a second implementation of
//     "where does this end", which is the class of bug this project keeps
//     finding (`upgradeProgress`, `recruitReadyTick`).
//   * IT IS BALANCE-NEUTRAL WHERE NOTHING INTERRUPTS. Same inputs, same
//     outcome, later. What changes is only what a player can now DO in between.
//   * THE AI AND THE HARNESS NEED NO NEW MODEL. Both decide by asking
//     `resolveField` whether an attack wins; that answer is still true.
//
// PURE.
import { UNIT_IDS, MELEE } from '../content/balance.js';
import { TICK_HZ } from '../core/loop.js';
import { emptyComp, total, resolveField } from './combat.js';

/** Largest-remainder rounding of `frac` of the way from `a` to `b`, per unit.
 *
 *  INTEGER BODIES, EVERY TICK. A melee that carried fractional troops would
 *  show 12.4 militia in the panel and make `total()` disagree with the sum of
 *  the pieces the renderer draws — and the sub-body remainder that towers.js
 *  carries on a squad is not available here, because a melee's endpoints move
 *  every time somebody reinforces. Rounding toward the projection each tick and
 *  re-deriving from the CURRENT comp keeps the two ends honest. */
function lerpComp(a, b, frac) {
  const out = emptyComp();
  for (const u of UNIT_IDS) {
    const from = a[u] || 0;
    const to = b[u] || 0;
    out[u] = Math.round(from + (to - from) * frac);
  }
  return out;
}

/**
 * How long a fight between these two forces lasts, in ticks.
 *
 * FLAT, not scaled by headcount. A big battle taking longer reads well and is
 * wrong for this game: the whole point of the timer is the opening it makes for
 * relief, and an opening that grows with the size of the fight is widest exactly
 * where the defender least needs it. It also has to be a number a player can
 * learn — "a field battle is about six seconds" is usable, "it depends" is not.
 */
export const meleeTicks = () => Math.max(1, Math.round(MELEE.seconds * TICK_HZ));

/**
 * What is LEFT of a fight's clock when it is re-projected.
 *
 * A REINFORCEMENT CHANGES WHERE A FIGHT IS GOING, NOT HOW LONG IT LASTS, and
 * getting that wrong does not look like a bug — it looks like a slow campaign.
 * Restarting the clock on every arrival means a steady trickle of columns holds
 * a melee open forever: measured on gallowmoor, one assault ran EIGHTY ticks
 * against a sixty-tick clock and had still resolved nothing, and the harness
 * read the whole region as `losses=0` with thirty-one timeouts while it was
 * ahead. Nothing failed and no test could see it — the fight was progressing,
 * it simply never arrived.
 *
 * Floored at one tick rather than zero: a column landing on the last tick of a
 * fight still gets one tick of it, so an arrival can never be a no-op that
 * re-projects and completes in the same breath.
 */
export const meleeTicksLeft = (prior, tick) => (prior
  ? Math.max(1, prior.ticks - (tick - prior.tick0))
  : meleeTicks());

/**
 * Start (or restart) a melee between two forces, recording where it is headed.
 *
 * `opts` is passed straight to `resolveField`, so a melee at a site carries the
 * site's defence exactly as an instant assault used to. Re-projected rather
 * than patched when either side changes: a reinforcement that arrives at 60% of
 * the way through does not "add men to a losing fight", it changes where the
 * fight was going, which is the entire tactical point of the timer.
 */
export function projectMelee(att, def, opts = {}) {
  const r = resolveField(att, def, opts);
  return {
    attEnd: r.attSurvivors,
    defEnd: r.defSurvivors,
    win: r.win,
    attPower: r.attPower,
    defPower: r.defPower,
  };
}

/**
 * One tick of an in-progress melee.
 *
 * `m` is `{att, def, attEnd, defEnd, tick0, ticks}` — the two live comps, where
 * they are headed, and the clock. Returns the two new comps plus `done`.
 *
 * The fraction is derived from `state.tick` rather than counted down, for the
 * same reason `squadHexOf` reads position off `arriveTick`: a counter is a
 * second place for the truth to live, and it drifts the moment a tick is
 * replayed from a command log.
 */
export function meleeStep(m, tick) {
  const elapsed = tick - m.tick0;
  const frac = m.ticks > 0 ? Math.min(1, elapsed / m.ticks) : 1;
  return {
    att: lerpComp(m.att0, m.attEnd, frac),
    def: lerpComp(m.def0, m.defEnd, frac),
    done: frac >= 1,
  };
}

/**
 * The melee record a caller stores. `att0`/`def0` are the compositions the
 * projection was taken FROM, and they are what `meleeStep` interpolates out of
 * — so re-projecting is always "new endpoints from where we are now", never a
 * correction applied to a stale start.
 */
export function beginMelee(att, def, tick, opts = {}) {
  const p = projectMelee(att, def, opts);
  return {
    att0: att, def0: def, att, def,
    attEnd: p.attEnd, defEnd: p.defEnd, win: p.win,
    // Carried through rather than recomputed: the FIELD_BATTLE event reports
    // both sides' power and tests/sim.test.js checks it against `power()`
    // directly, so dropping them here would have made the event silently
    // undefined — which is the shape of the SIEGE_BEGUN `kind` bug this
    // project already found once by asserting on a payload nobody read.
    attPower: p.attPower, defPower: p.defPower,
    tick0: tick, ticks: meleeTicks(),
  };
}

/** Has one side been wiped out? A melee ends the moment either side is empty,
 *  even before its clock runs out — otherwise a squad with nobody left in it
 *  would go on holding ground for the remaining seconds. */
export const meleeOver = (m) => total(m.att) === 0 || total(m.def) === 0;
