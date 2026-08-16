// THE TICK PHASE THAT MAKES A FIGHT LAST, AND MAKES A TILE CONTESTED.
//
// Two mechanics in one phase, because they are the same mechanic seen twice: a
// force meets a hostile force and neither one is deleted on the tick they
// touch. See ./melee.js for why the projection is `resolveField` unchanged, and
// therefore why the pre-commit preview is still a guarantee.
//
//   AT A SITE   the arriving column and the garrison grind at each other for
//               `MELEE.seconds` before the siege can begin. Relief that lands
//               inside that gap RE-PROJECTS the fight rather than arriving to
//               find it already decided.
//   ON A HEX    two hostile squads on the same tile fight, and a MARCHING squad
//               that walks onto one is halted and joins in. That is the whole
//               of "you cannot walk through an army".
//
// Helpers come from ./arrivals.js rather than being copied: `recordCasualties`
// feeds the lifetime record and `skirmishHome` is the raider escape, and two
// implementations of either is two rules that drift.
// PURE.
import { UNIT_IDS, UNITS } from '../content/balance.js';
import { emptyComp, addComp, scaleComp, total, power } from './combat.js';
import { beginMelee, meleeStep, meleeTicks, meleeTicksLeft } from './melee.js';
import { squadHexOf } from './movement.js';
import { groundOf, siteDefMultOf, garrisonMultOf } from './terrain.js';
import { pushEvent, EVENTS } from './events.js';
import { recordFailedAssault } from './assaultmemory.js';
import { skirmishHome, recordCasualties, modOf, vetOf } from './fightaid.js';

const FACTIONS = ['player', 'enemy'];
const other = (f) => (f === 'player' ? 'enemy' : 'player');
const kOf = (h) => `${h.q},${h.r}`;
/** Same bodies, unit for unit. Used to notice that something OUTSIDE this phase
 *  moved a garrison — see reprojectDefender. */
const sameComp = (a, b) => a === b || UNIT_IDS.every((u) => (a?.[u] || 0) === (b?.[u] || 0));
const hexDist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r)
  + Math.abs(a.r - b.r)) / 2;

/**
 * ARCHERS SHOOT INTO A FIGHT THEY ARE NOT STANDING IN.
 *
 * A unit with `reach` adds its attack to a melee up to that many hexes away,
 * from a squad that is CAMPED and not itself engaged — so keeping the bowmen a
 * tile back is the whole use of them, and walking them into the line throws the
 * reach away.
 *
 * IT IS A SEPARATE COMP, NOT PART OF THE STACK, and that is the load-bearing
 * choice rather than a convenience. `resolveField` returns survivors by SCALING
 * the comp it was handed, so archers folded into the fighting stack would take
 * casualties as though they were in it — which is exactly what reach is meant
 * to buy them out of. Kept apart, they raise the side's power and are never in
 * the casualty pool at all.
 */
export function reachSupport(state, faction, hex, engaged) {
  const out = emptyComp();
  let any = false;
  for (const sq of state.squads) {
    if (sq.owner !== faction || !sq.camped || engaged.has(sq.id)) continue;
    const at = squadHexOf(state, sq);
    if (!at || hexDist(at, hex) === 0) continue;
    for (const u of UNIT_IDS) {
      const reach = UNITS[u].reach;
      const n = sq.comp[u] || 0;
      if (!n || !reach || hexDist(at, hex) > reach) continue;
      out[u] += n;
      any = true;
    }
  }
  return any ? out : null;
}

/** A side's power on open ground, including anything shooting in from a hex back. */
function sidePower(state, faction, hex, own, foe, engaged, opts) {
  const base = power(own, foe, opts);
  const support = reachSupport(state, faction, hex, engaged);
  return support ? base + power(support, foe, opts) : base;
}

/** Every live squad's hex, grouped. The one position scan this phase makes. */
function squadsByHex(state) {
  const byHex = new Map();
  for (const sq of state.squads) {
    if (sq.retreating) continue;
    const at = squadHexOf(state, sq);
    if (!at) continue;
    const k = kOf(at);
    let cell = byHex.get(k);
    if (!cell) { cell = { hex: at, player: [], enemy: [] }; byHex.set(k, cell); }
    cell[sq.owner]?.push(sq);
  }
  return byHex;
}

/** WHO is on the other side, as a stable key — not how many of them.
 *
 *  THE STALENESS TEST HAS TO DETECT REINFORCEMENT, NOT CASUALTIES, and getting
 *  that wrong is not subtle: keyed on the opposing HEADCOUNT, every tick of an
 *  ordinary fight looked like a new arrival, so the melee re-projected on every
 *  single tick, reset its own clock, and neither side ever finished dying.
 *  Instrumented, that read as a `field-battle` event every six ticks forever.
 *  An id set changes when a column joins or is wiped out — which are exactly
 *  the two things that should move where the fight is going — and does not
 *  change while it merely grinds. */
const sideKey = (list) => list.map((sq) => sq.id).sort().join(',');

/**
 * Project a squad-versus-squad fight and stamp every participant.
 *
 * NEITHER SIDE OWNS OPEN GROUND, so this is decided by power alone — no
 * bulwark, no site multiplier, no attacker/defender asymmetry to argue about.
 * `resolveField` is not called here for exactly that reason: it takes an
 * attacker and a defender, and on a bare tile there is no such distinction to
 * make. The RATIO is the same one it would produce, and it is uniform across
 * the losing side, so each squad's endpoint is just its own comp scaled.
 */
function openHexMelee(state, cell) {
  const engaged = new Set();
  for (const f of FACTIONS) for (const sq of cell[f]) engaged.add(sq.id);
  const comps = {};
  for (const f of FACTIONS) {
    comps[f] = cell[f].reduce((a, sq) => addComp(a, sq.comp), emptyComp());
  }
  const ground = groundOf(state, { hex: [cell.hex.q, cell.hex.r] });
  const optsFor = (f) => ({
    statMult: modOf(state, f, 'unitAtkMult'), unitMult: vetOf(state, f), ground,
  });
  const p = {
    player: sidePower(state, 'player', cell.hex, comps.player, comps.enemy,
      engaged, optsFor('player')),
    enemy: sidePower(state, 'enemy', cell.hex, comps.enemy, comps.player,
      engaged, optsFor('enemy')),
  };
  // Ties go to the defender of the tile in the only sense open ground has one:
  // FACTIONS order, which is fixed, so a replay resolves it the same way.
  const win = p.player > p.enemy ? 'player' : 'enemy';
  const ratio = p[win] > 0 ? 1 - p[other(win)] / p[win] : 0;

  // THE CLOCK IS THE OLDEST ONE STILL RUNNING, not a fresh one — see
  // melee.js meleeTicksLeft. A hex fed by a stream of columns would otherwise
  // never resolve at all, and on open ground there is no siege afterwards to
  // make that visible.
  const running = [];
  for (const f of FACTIONS) {
    for (const sq of cell[f]) if (sq.melee) running.push(meleeTicksLeft(sq.melee, state.tick));
  }
  const ticks = running.length ? Math.min(...running) : meleeTicks();

  for (const f of FACTIONS) {
    const end = f === win ? null : emptyComp();
    for (const sq of cell[f]) {
      sq.camped = true;
      sq.hex = { q: cell.hex.q, r: cell.hex.r };
      sq.melee = {
        from: addComp(emptyComp(), sq.comp),
        end: end ?? scaleComp(sq.comp, ratio),
        tick0: state.tick,
        ticks,
        foe: sideKey(cell[other(f)]),
      };
    }
  }
  // `hex` rather than `siteId`, because there is no site — and it is carried so
  // the screen can place the clash and FOG it. An event with neither reads as
  // "not a positional claim" to the drain in screens/battle.js and would be
  // both invisible and audible everywhere, which is the worst pair.
  pushEvent(state, EVENTS.FIELD_BATTLE, {
    siteId: null, hex: { q: cell.hex.q, r: cell.hex.r }, attacker: win, win: true,
    attPower: p[win], defPower: p[other(win)],
  });
}

/** Squad-versus-squad, on every contested hex on the board. */
function hexMelees(state) {
  for (const cell of squadsByHex(state).values()) {
    if (!cell.player.length || !cell.enemy.length) {
      // The other side is gone: whoever is left stops fighting and keeps the
      // ground. `camped` stays, so survivors are re-taskable with MOVE_SQUAD
      // rather than stranded where the fight happened.
      for (const f of FACTIONS) for (const sq of cell[f]) sq.melee = null;
      continue;
    }
    // RE-PROJECT WHEN THE OTHER SIDE CHANGED, which is what makes reinforcing a
    // fight mean something: a column landing mid-melee does not join a decided
    // outcome, it moves where the outcome was going.
    const stale = FACTIONS.some((f) => cell[f].some(
      (sq) => !sq.melee || sq.melee.foe !== sideKey(cell[other(f)]),
    ));
    if (stale) openHexMelee(state, cell);
    for (const f of FACTIONS) {
      for (const sq of cell[f]) {
        const m = sq.melee;
        if (!m) continue;
        const step = meleeStep({
          att0: m.from, attEnd: m.end, def0: m.from, defEnd: m.end,
          tick0: m.tick0, ticks: m.ticks,
        }, state.tick);
        sq.comp = step.att;
        if (step.done) sq.melee = null;
      }
    }
  }
  if (state.squads.some((sq) => total(sq.comp) === 0)) {
    state.squads = state.squads.filter((sq) => total(sq.comp) > 0);
  }
}

/**
 * Begin, or reinforce, the field battle outside a site's walls.
 *
 * Called from arrivals.js in place of the instant `resolveField` that used to
 * live there. Reinforcing MERGES and re-projects from the merged force, so a
 * second column arriving at 60% does not fight its own separate battle.
 */
/** The `resolveField` options a site melee is fought under. Factored out
 *  because reprojectDefender has to rebuild the SAME fight from a new baseline,
 *  and a second copy of this list is a second thing to keep in step. */
function meleeOpts(state, site, owner) {
  return {
    siteDefMult: siteDefMultOf(state, site),
    garrisonMult: garrisonMultOf(state, site),
    defenderOwnsSite: true,
    attMult: modOf(state, owner, 'unitAtkMult'),
    defMult: modOf(state, site.owner, 'unitDefMult'),
    attUnitMult: vetOf(state, owner),
    defUnitMult: vetOf(state, site.owner),
    shielded: site.shieldTicks > 0,
    ground: groundOf(state, site),
  };
}

export function openSiteMelee(state, site, owner, comp, from = null) {
  const opts = meleeOpts(state, site, owner);
  const prior = site.melee && site.melee.owner === owner ? site.melee : null;
  // BANK WHAT HAS ALREADY DIED before the re-projection throws its baseline
  // away. `comp0`/`garrison0` are what the CURRENT projection started from, and
  // the lifetime record is fed by differencing them against the survivors — so
  // re-baselining without paying out first loses every casualty taken before
  // the reinforcement arrived, silently and only on fights that were joined.
  if (prior) {
    recordCasualties(state, owner, site.owner, prior.comp0, prior.comp);
    recordCasualties(state, site.owner, owner, prior.garrison0, site.garrison);
  }
  const att = prior ? addComp(prior.comp, comp) : addComp(emptyComp(), comp);
  const m = beginMelee(att, site.garrison, state.tick, opts);
  const before = prior ? prior.before : total(site.garrison);
  site.melee = {
    owner,
    comp: att,
    comp0: att,
    garrison0: addComp(emptyComp(), site.garrison),
    attEnd: m.attEnd,
    defEnd: m.defEnd,
    tick0: state.tick,
    ticks: meleeTicksLeft(prior, state.tick),
    before,
    // Where the skirmishers run to if this assault fails. Kept from the FIRST
    // column: reinforcements merge into the fight, and a rally point that
    // changed with each of them would send survivors somewhere nobody launched
    // from.
    from: prior ? prior.from : from,
  };
  pushEvent(state, EVENTS.FIELD_BATTLE, {
    siteId: site.id, attacker: owner, win: m.win,
    attPower: m.attPower, defPower: m.defPower,
  });
}

/**
 * SOMETHING ELSE MOVED THE GARRISON — re-project the fight around it.
 *
 * This is the defender's half of "a reinforcement changes where a fight is
 * going", and leaving it out was not one bug but five, because `siteMelees`
 * writes `site.garrison` every tick from a FROZEN baseline: every other system
 * that touches a defending garrison had its work silently reverted on the next
 * tick, and two of them then looped.
 *
 *   reinforce a defended site   200 troops arrived, SQUAD_ARRIVED fired, and the
 *                               outcome was byte-identical to sending nobody
 *   RALLY out of a site         the garrison was revived every tick and rallied
 *                               again — 300 troops became 10,084, which is a
 *                               determinism and economy break, not a nuisance
 *   RETREAT a garrison          the men both walked away intact AND stayed in
 *                               the fight, so the site lost anyway
 *   BOMBARD                     the kill was erased; the charge was still spent
 *   training finishing          gold spent, UNITS_TRAINED fired, no troops
 *
 * One mechanism answers all five, and it is the one `openSiteMelee` already
 * applies to the attacker: bank what has died so far, re-baseline from where
 * both sides ACTUALLY are now, and carry the remaining clock. `site.garrison`
 * goes back to being the single source of truth for who is defending, which is
 * what every one of those systems already assumed it was.
 */
function reprojectDefender(state, site, m) {
  // The casualties so far are the difference against what THIS phase last
  // wrote — not against the new garrison, whose delta is the external change
  // and is not a casualty of anything.
  recordCasualties(state, m.owner, site.owner, m.comp0, m.comp);
  recordCasualties(state, site.owner, m.owner, m.garrison0, m.defWrote);
  const p = beginMelee(m.comp, site.garrison, state.tick, meleeOpts(state, site, m.owner));
  m.comp0 = m.comp;
  m.garrison0 = addComp(emptyComp(), site.garrison);
  m.attEnd = p.attEnd;
  m.defEnd = p.defEnd;
  m.ticks = meleeTicksLeft(m, state.tick);
  m.tick0 = state.tick;
}

/** Step every field battle happening outside a wall. */
function siteMelees(state) {
  for (const site of state.sites) {
    const m = site.melee;
    if (!m) continue;
    // Nothing else may quietly overwrite the defenders. `defWrote` is what this
    // phase put there last tick; anything different came from outside.
    if (m.defWrote && !sameComp(site.garrison, m.defWrote)) reprojectDefender(state, site, m);
    const step = meleeStep({
      att0: m.comp0, attEnd: m.attEnd, def0: m.garrison0, defEnd: m.defEnd,
      tick0: m.tick0, ticks: m.ticks,
    }, state.tick);
    m.comp = step.att;
    site.garrison = step.def;
    m.defWrote = step.def;   // the yardstick the check above reads next tick
    if (!step.done && total(step.att) > 0 && total(step.def) > 0) continue;

    recordCasualties(state, m.owner, site.owner, m.comp0, step.att);
    recordCasualties(state, site.owner, m.owner, m.garrison0, step.def);
    site.melee = null;
    if (total(step.att) > 0 && total(step.def) === 0) {
      // Beating the garrison does NOT capture: the siege begins.
      site.garrison = emptyComp();
      site.siege = { owner: m.owner, comp: step.att };
      pushEvent(state, EVENTS.SIEGE_BEGUN, {
        siteId: site.id, kind: site.kind, owner: m.owner, defender: site.owner, hp: site.hp,
      });
    } else {
      // A FAILED ASSAULT LEAVES A MEMORY — see battle/assaultmemory.js. `before`
      // is the garrison that was there when the fight STARTED, carried across
      // every re-projection, because that is what the attacker actually met.
      recordFailedAssault(state, m.owner, site.id, m.before);
      site.garrison = step.def;
      skirmishHome(state, site, { owner: m.owner, comp: m.comp0, from: m.from });
    }
  }
}

export function meleePhase(state) {
  siteMelees(state);
  hexMelees(state);
}
