// Field-battle resolution and siege math.
//
// ZERO RNG. This function is called by BOTH the simulation and the preview UI,
// so what the player is shown before committing is exactly what happens. That
// promise is load-bearing for the whole design — do not introduce randomness,
// wall-clock reads, or hidden state here.
// PURE.
import { UNITS, UNIT_IDS, SITES, SITE_LEVELS } from '../content/balance.js';

/** @typedef {Record<string, number>} Composition */

export const emptyComp = () => ({ militia: 0, spearmen: 0, raiders: 0, rams: 0, marshal: 0 });

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
 * @param {?object} opts.ground         terrain of the hex being fought over
 */
export function power(comp, foe, opts = {}) {
  const {
    defending = false, onOwnSite = false, siteDefMult = 1, statMult = 1, ground = null,
  } = opts;
  const foeN = total(foe);
  let p = 0;
  for (const u of UNIT_IDS) {
    const n = comp[u] || 0;
    if (!n) continue;
    const spec = UNITS[u];
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
    p += n * stat * m * bulwark * groundMult(spec, ground);
  }
  if ((comp.marshal || 0) > 0) p *= 1 + UNITS.marshal.banner;
  if (defending) p *= siteDefMult;
  return p * statMult;
}

/**
 * Stage 1 — the field battle. One round, proportional attrition.
 * Ties go to the defender.
 * @returns {{win:boolean, attPower:number, defPower:number, ratio:number,
 *            attSurvivors:Composition, defSurvivors:Composition}}
 */
export function resolveField(attackers, defenders, opts = {}) {
  const {
    siteDefMult = 1, defenderOwnsSite = true,
    attMult = 1, defMult = 1, shielded = false, ground = null,
  } = opts;

  let attPower = power(attackers, defenders, { statMult: attMult, ground });
  if (shielded) attPower *= 0.5; // Emergency Fortify
  const defPower = power(defenders, attackers, {
    defending: true, onOwnSite: defenderOwnsSite, siteDefMult, statMult: defMult, ground,
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
 * Siege damage per second from a besieging force. Rams are 20x a militia.
 *
 * Terrain lands here too, and this is where "a fort in the mountains" is really
 * felt: a ram works at 0.55 in full highland, so the answer to a mountain
 * fastness is not more engines, it is more bodies — militia are unaffected.
 * @param {?object} ground terrain of the site under siege
 */
export function siegeDps(comp, mult = 1, ground = null) {
  let d = 0;
  for (const u of UNIT_IDS) {
    const n = comp[u] || 0;
    if (n) d += n * UNITS[u].siege * groundMult(UNITS[u], ground);
  }
  return d * mult;
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
