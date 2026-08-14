// Field-battle resolution and siege math.
//
// ZERO RNG. This function is called by BOTH the simulation and the preview UI,
// so what the player is shown before committing is exactly what happens. That
// promise is load-bearing for the whole design — do not introduce randomness,
// wall-clock reads, or hidden state here.
// PURE.
import { UNITS, UNIT_IDS, SITES, SITE_LEVELS, SIEGE_FRONTAGE } from '../content/balance.js';

/** @typedef {Record<string, number>} Composition */

/** Derived from UNIT_IDS, never listed. A hardcoded roster here is a unit that
 *  silently does not exist to every `{...emptyComp(), ...x}` in the codebase. */
export const emptyComp = () => Object.fromEntries(UNIT_IDS.map((u) => [u, 0]));

export const total = (c) => UNIT_IDS.reduce((n, u) => n + (c[u] || 0), 0);

export const addComp = (a, b) => {
  const out = emptyComp();
  for (const u of UNIT_IDS) out[u] = (a[u] || 0) + (b[u] || 0);
  return out;
};

/**
 * Take `frac` of a composition, integerized by largest remainder so the total
 * matches the rounded ideal exactly. Ties break toward the MORE EXPENSIVE unit,
 * so rounding never eats your marshal while sparing a militia.
 */
export function scaleComp(comp, frac) {
  const out = emptyComp();
  const rem = [];
  let ideal = 0;
  let placed = 0;
  for (const u of UNIT_IDS) {
    const v = (comp[u] || 0) * frac;
    out[u] = Math.floor(v);
    rem.push([v - out[u], u]);
    ideal += v;
    placed += out[u];
  }
  let extra = Math.round(ideal) - placed;
  rem.sort((a, b) => b[0] - a[0] || UNITS[b[1]].gold - UNITS[a[1]].gold);
  for (let i = 0; i < rem.length && extra > 0; i++) {
    const u = rem[i][1];
    if (out[u] < (comp[u] || 0)) { out[u]++; extra--; }
  }
  return out;
}

/** Share of a force made up of unit type `u`, by head count. */
const shareOf = (comp, n, u) => (n ? (comp[u] || 0) / n : 0);

/**
 * What the GROUND does to one unit type. Zero RNG, like everything else here.
 *
 * Highland is graded — `ground.highland` is 0..1, how ringed by peaks the site
 * is — so the multiplier is interpolated toward 1.0 on merely hilly ground
 * rather than snapping on. A river is binary: you are in the shallows or you
 * are not.
 *
 * A unit with no `ground` block (militia, marshal) is exactly 1.0 everywhere,
 * which is the point: there is always one answer that does not care what the
 * map looks like.
 * @param {object} spec  a UNITS entry
 * @param {?{highland:number, river:boolean}} ground
 */
export function groundMult(spec, ground) {
  const g = spec.ground;
  if (!ground || !g) return 1;
  let m = 1;
  if (ground.highland > 0) m *= 1 + (g.highland - 1) * ground.highland;
  if (ground.river) m *= g.river;
  return m;
}

/**
 * Total combat power of a force.
 * @param {Composition} comp
 * @param {Composition} foe   opposing composition, for counter multipliers
 * @param {object} opts
 * @param {boolean} opts.defending      use def instead of atk
 * @param {boolean} opts.onOwnSite      enables spearmen bulwark
 * @param {number}  opts.siteDefMult    static per-site-kind defence bonus
 * @param {number}  opts.statMult       upgrade multiplier (unitAtkMult/unitDefMult)
 * @param {?object} opts.unitMult       PER-TROOP multipliers, sparse (contract v7)
 * @param {?object} opts.ground         terrain of the hex being fought over
 */
export function power(comp, foe, opts = {}) {
  const {
    defending = false, onOwnSite = false, siteDefMult = 1, statMult = 1, ground = null,
    unitMult = null, garrisonMult = 1,
  } = opts;
  const foeN = total(foe);
  let p = 0;
  for (const u of UNIT_IDS) {
    const n = comp[u] || 0;
    if (!n) continue;
    const spec = UNITS[u];
    // PER-TROOP levels (contract v7). Inside the loop and not on `statMult`,
    // because that is the entire point of them: an army of thirty militia and
    // six rams with Militia Veterans at level 4 is stronger in a field and
    // exactly as good at walls. A sparse map, so the common case is one lookup
    // returning undefined.
    const vet = unitMult?.[u] ?? 1;
    // Counter multiplier scales with how much of the ENEMY force is the
    // countered type — countering a pure spearwall is worth far more than
    // countering a token spear escort.
    let m = spec.base ?? 1;
    for (const [target, bonus] of Object.entries(spec.counters)) {
      m += bonus * shareOf(foe, foeN, target);
    }
    const stat = defending ? spec.def : spec.atk;
    const bulwark = defending && onOwnSite ? (spec.bulwark ?? 1) : 1;
    // Terrain applies to BOTH sides — it is the ground, not a bonus somebody
    // owns. What changes the fight is that the two forces are made of different
    // things: raiders storming a mountain fort are at 0.70 while the spearmen
    // holding it are at 1.30.
    p += n * stat * m * bulwark * vet * groundMult(spec, ground);
  }
  if ((comp.marshal || 0) > 0) p *= 1 + UNITS.marshal.banner;
  if (defending) p *= siteDefMult;
  // THE MEN, NOT THE MASONRY. `SITES.stronghold.garrisonMult` is the one
  // defensive term `sunderedDefMult` does not touch, and that separation is the
  // whole reason a stronghold is a different building rather than a farm with a
  // bigger `defMult`. Halberds cut a wall out from under its garrison; they do
  // nothing about a garrison that is dug in. So a stronghold has an answer —
  // bodies, and engines to out-pace its regen — and it is not the answer that
  // works on everything else.
  //
  // Applied after `siteDefMult` and outside the per-unit loop, so it scales the
  // whole defence exactly once, whatever the stack is made of.
  if (defending && onOwnSite) p *= garrisonMult;
  return p * statMult;
}

/**
 * How much of a defender's SITE bonus an attacking force strips away.
 *
 * `siteDefMult` is the one term in `power` that no amount of army answers: a
 * castle defends at x1.60 and a built wall stacks on top of it, so past a point
 * more militia is simply more militia dying at the same ratio. `sunder` is the
 * verb for that — halberds cut the ground out from under the garrison rather
 * than out-statting it.
 *
 * SCALED BY SHARE, exactly like `counters`, and for the same reason: a token
 * escort should not strip a castle. A force that is half halberds gets half of
 * the unit's `sunder`, so committing to the answer is what buys the answer.
 * Clamped so the bonus can never invert into an advantage for the attacker.
 * PURE.
 * @param {Composition} comp the ATTACKING force
 * @param {number} siteDefMult the defender's static site bonus
 */
export function sunderedDefMult(comp, siteDefMult) {
  if (!(siteDefMult > 1)) return siteDefMult;
  const n = total(comp);
  if (!n) return siteDefMult;
  let strip = 0;
  for (const u of UNIT_IDS) {
    const s = UNITS[u].sunder;
    if (s) strip += s * ((comp[u] || 0) / n);
  }
  if (strip <= 0) return siteDefMult;
  return 1 + (siteDefMult - 1) * Math.max(0, 1 - Math.min(1, strip));
}

/**
 * The multiplier a garrison applies to its own site's HP regen.
 *
 * Sappers are the answer to holding what you took. `breachSeconds` already
 * returns Infinity when siege damage cannot out-pace repair — that is the
 * mechanism that makes "a few troops genuinely cannot take a stronghold" true
 * without a minimum-troops rule — and this hands the same mechanism to whoever
 * garrisons the site. A wall with sappers behind it is not merely tougher; it
 * is uncrackable by a force that did not bring engines.
 *
 * SHARE-SCALED like `sunder`, so a lone sapper in a hundred-man garrison is
 * worth almost nothing and a dedicated engineer detachment is worth all of it.
 * PURE.
 */
export function repairMult(comp) {
  const n = total(comp);
  if (!n) return 1;
  let m = 1;
  for (const u of UNIT_IDS) {
    const r = UNITS[u].repair;
    if (r) m += (r - 1) * ((comp[u] || 0) / n);
  }
  return m;
}

/**
 * Stage 1 — the field battle. One round, proportional attrition.
 * Ties go to the defender.
 * @returns {{win:boolean, attPower:number, defPower:number, ratio:number,
 *            attSurvivors:Composition, defSurvivors:Composition}}
 */
export function resolveField(attackers, defenders, opts = {}) {
  const {
    siteDefMult = 1, garrisonMult = 1, defenderOwnsSite = true,
    attMult = 1, defMult = 1, shielded = false, ground = null,
    attUnitMult = null, defUnitMult = null,
  } = opts;

  let attPower = power(attackers, defenders,
    { statMult: attMult, unitMult: attUnitMult, ground });
  if (shielded) attPower *= 0.5; // Emergency Fortify
  // Halberds strip the ground out from under the garrison before the round is
  // fought — see `sunderedDefMult`. Applied HERE rather than inside `power` so
  // it reads as what it is: a property of the force attacking, not of the
  // defenders being measured.
  const defPower = power(defenders, attackers, {
    defending: true,
    onOwnSite: defenderOwnsSite,
    siteDefMult: sunderedDefMult(attackers, siteDefMult),
    // ...and `garrisonMult` goes past it untouched, which is the whole of what
    // makes a stronghold a different building. See `power`.
    garrisonMult,
    statMult: defMult,
    unitMult: defUnitMult,
    ground,
  });

  if (attPower > defPower) {
    const ratio = 1 - defPower / attPower;
    let surv = scaleComp(attackers, ratio);
    // A winner always plants a flag, even after a pyrrhic assault.
    if (total(surv) === 0) surv = keepCheapestOne(attackers);
    return { win: true, attPower, defPower, ratio, attSurvivors: surv, defSurvivors: emptyComp() };
  }
  const ratio = defPower > 0 ? 1 - attPower / defPower : 1;
  return {
    win: false, attPower, defPower, ratio,
    attSurvivors: emptyComp(),
    defSurvivors: scaleComp(defenders, ratio),
  };
}

function keepCheapestOne(comp) {
  const out = emptyComp();
  const present = UNIT_IDS.filter((u) => (comp[u] || 0) > 0);
  if (!present.length) return out;
  present.sort((a, b) => UNITS[a].gold - UNITS[b].gold);
  out[present[0]] = 1;
  return out;
}

/**
 * Siege damage per second from a besieging stack. Rams are 20x a militia.
 *
 * A WALL HAS A FRONTAGE (content/balance.js `SIEGE_FRONTAGE`): ordinary bodies
 * past the first `SIEGE_FRONTAGE` of them contribute nothing, because they are
 * queueing rather than digging. ENGINES (`engine: true` — rams) are exempt and
 * stay linear, which is the entire statement: a crowd cannot substitute for a
 * siege train.
 *
 * This used to be linear in headcount and that is how `breachSeconds` stopped
 * binding. Measured before the frontage existed: 700 militia broke a level-5
 * castle in FIVE SECONDS, and the same 700 slots spent on the mixed spread
 * produced almost exactly the same siege output — which is why rams measured as
 * a straight loss, and why "leave the rams at home" was worth +23 to +38 points
 * across the campaign.
 *
 * The scaling is applied to the bodies' summed damage rather than to a body
 * count, so a stack's MIX still matters: forty halberds out-dig forty militia
 * exactly as much as they always did. Only the crowd behind them stops counting.
 *
 * TERRAIN LANDS HERE TOO, and the frontage INVERTED what it asks of you. This
 * comment used to read "the answer to a mountain fastness is not more engines,
 * it is more bodies — militia are unaffected", which was true while a crowd was
 * a siege train and is now exactly backwards: past forty, more bodies buy
 * nothing at all. What answers highland is BETTER bodies, and the game already
 * has them — 40 sappers work at 2.5 siege x 1.15 highland for 115 dps where 40
 * militia manage 24. The forty at the wall are a composition decision now.
 * @param {?object} ground terrain of the site under siege
 */
export function siegeDps(comp, mult = 1, ground = null) {
  let engines = 0;
  let bodyDmg = 0;
  let bodies = 0;
  for (const u of UNIT_IDS) {
    const n = comp[u] || 0;
    if (!n) continue;
    const spec = UNITS[u];
    const d = n * spec.siege * groundMult(spec, ground);
    if (spec.engine) { engines += d; continue; }
    bodyDmg += d;
    bodies += n;
  }
  // Below the frontage this is exactly 1, so a small force is untouched — see
  // the constant's own comment on why that inertness is the point.
  const crowd = bodies > SIEGE_FRONTAGE ? SIEGE_FRONTAGE / bodies : 1;
  return (engines + bodyDmg * crowd) * mult;
}

export function siteRegen(kind, level = 1, mult = 1) {
  return SITES[kind].hpRegen * SITE_LEVELS[level - 1].regen * mult;
}

export function siteMaxHp(kind, level = 1) {
  return SITES[kind].hp * SITE_LEVELS[level - 1].hp;
}

/**
 * Seconds for a besieging force to breach, or Infinity when its damage cannot
 * out-pace repair. This is what the HUD renders as "BREACH IN 31s" versus
 * "INSUFFICIENT — walls repair faster than you break them", and it is the whole
 * reason a handful of troops cannot take a stronghold.
 */
export function breachSeconds(comp, hp, kind, level = 1, siegeMult = 1, regenMult = 1,
  ground = null) {
  const net = siegeDps(comp, siegeMult, ground) - siteRegen(kind, level, regenMult);
  if (net <= 0) return Infinity;
  return hp / net;
}

/**
 * Project a site's HP forward `seconds` of undisturbed repair. Deterministic,
 * so the preview can show the state the attacker will actually meet on arrival.
 */
export function projectHp(hp, seconds, kind, level = 1, regenMult = 1) {
  return Math.min(siteMaxHp(kind, level), hp + siteRegen(kind, level, regenMult) * seconds);
}
