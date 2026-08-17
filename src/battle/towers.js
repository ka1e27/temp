// BUILDINGS THAT SHOOT.
//
// A stronghold hits anything on a hex touching it; a watchtower reaches two.
// Both were, until now, entirely passive: a wall was a defence multiplier that
// did nothing unless you attacked it, and a tower was a sight radius that did
// nothing at all. Neither had any effect on an army that simply walked past.
//
// THIS COULD NOT HAVE BEEN BUILT BEFORE THE SQUAD PATH. A squad used to be a
// lerp between two site hexes, so "is that column within one hex of this wall"
// had no truthful answer — the position it would have been measured against was
// a place the army was not walking through. `squadHexOf` reads a real hex off
// the route now, and this is the first mechanic that consumes it.
//
// IT IS A TAX ON MARCHING PAST, NOT A DEFENCE. The damage is small on purpose
// (content/balance.towers.js says why): it should make going around a wall
// worth the extra ground, and it must never let a building grind down a real
// assault on its own. Anything that could would make the siege — the mechanic
// the entire design rests on — optional.
//
// PURE. No randomness, like everything else in combat: the same tick with the
// same board kills exactly the same men.
import { TICK_HZ } from '../core/loop.js';
import { TOWERS, towerDamagePerTick } from '../content/balance.towers.js';
import { distance } from '../core/hex.js';
import { scaleComp, total } from './combat.js';
import { asHex } from './influence.js';
import { squadHexOf } from './movement.js';
import { pushEvent, EVENTS } from './events.js';

/**
 * Every armed site `faction` holds, as {hex, damage} — recomputed per tick
 * because a site changes hands and a level rises, and the list is at most a
 * handful of buildings on the biggest board.
 *
 * A site still under construction does NOT shoot, for the same reason
 * scaffolding is blind and earns nothing: presence is not production. A 120-gold
 * foundation that opens fire the instant it is paid for would make the build
 * timer decorative, which is precisely the bug the watchtower's vision gate
 * exists to prevent.
 */
function gunsOf(state, faction) {
  const out = [];
  for (const s of state.sites) {
    if (s.owner !== faction) continue;
    if (!TOWERS[s.kind]) continue;
    if (s.buildTicksLeft > 0) continue;
    const dmg = towerDamagePerTick(s.kind, s.level, TICK_HZ);
    if (dmg > 0) out.push({ site: s, hex: asHex(s.hex), dmg, range: TOWERS[s.kind].rangeHexes });
  }
  return out;
}

/**
 * What a column will have LEFT when it arrives, having been shot at all the way.
 *
 * THIS EXISTS TO KEEP THE PREVIEW HONEST, and that is not a nicety here: the
 * pre-commit preview calls the same functions the simulation runs, so "will I
 * win this" is a guarantee rather than an estimate — invariant 3, and the
 * design's load-bearing promise. Towers broke it the moment they landed,
 * because a column that walks up to a stronghold arrives with fewer men than
 * it set off with, and the DEFENDER's power is a function of the attacker's
 * composition (`counters` scale by the share of the foe that is the countered
 * type). Measured on tests/terrain.test.js's fixture: 30 militia and 6 raiders
 * lost one body on the approach, which moved the raider share from 16.7% to
 * 17.1%, which moved the defending spearwall's counter, which moved the
 * defender's power by 1% — and the preview promised the other number.
 *
 * It is projectable rather than guessable for the same reason `projectGarrison`
 * can project the defender's training: the route is known at commit time, the
 * guns are known, and nothing here is random.
 *
 * SHARES `gunsOf` AND THE DAMAGE ARITHMETIC WITH `towersPhase` deliberately —
 * they are two readings of one rule, and a second implementation is exactly how
 * a preview starts lying again. tests/towers.test.js pins that they agree.
 *
 * @param {object} state
 * @param {{path:Array, owner:string, comp:object, spawnTick:number, arriveTick:number}} plan
 * @returns {object} the composition that arrives
 */
export function projectMarchLosses(state, plan) {
  const { path, owner, comp, spawnTick, arriveTick } = plan;
  // `toId` is excluded for the same reason `towersPhase` excludes `sq.to`: the
  // target does not shoot the assault that is coming for it. Passed explicitly
  // rather than read off a squad, because at preview time there is no squad yet.
  const guns = [...gunsOf(state, 'player'), ...gunsOf(state, 'enemy')]
    .filter((g) => g.site.owner !== owner && g.site.id !== plan.toId);
  if (!guns.length || !path || !path.length) return comp;

  const sq = { path, owner, spawnTick, arriveTick, camped: false, hex: null };
  let live = comp;
  let carry = 0;
  // EXACTLY THE TICKS THE SIM WILL CHARGE, WHICH IS `spawnTick .. arriveTick-1`
  // — and getting that window off by one is what broke the guarantee this whole
  // function exists to keep. Read it off `sim.js step()`'s phase order, because
  // it is a consequence of that order and of nothing local:
  //
  //   - the SPAWN tick IS charged. `drainCommands` creates the squad near the
  //     top of the tick and `towersPhase` runs later in the same one, so the
  //     column is taxed while still standing on its origin hex.
  //   - the ARRIVE tick is NOT. `arrivalsPhase` runs BEFORE `towersPhase` and
  //     takes the squad off the board, which is deliberate and documented there:
  //     a column that reached its target is resolved as a fight rather than shot
  //     at on the doorstep, or the one assault is charged for twice.
  //
  // This loop used to read `spawnTick + 1 .. arriveTick`, so it missed the
  // origin hex and invented the destination hex instead. Driving the real
  // `step()` against this projection over 180 gun placements found three
  // disagreements, every one of them a gun adjacent to the DESTINATION that is
  // not the target itself — the projection charged the column for a hex the sim
  // never taxes, promised a smaller arriving force than arrives, and so moved
  // the counter shares and `defPower` off the number the preview showed. That is
  // invariant 3 (the preview is a guarantee, not an estimate) failing silently.
  //
  // The sub-body remainder accumulates over the same ticks in the same order, so
  // it lands identically. The loop is bounded by the flight time; a long march
  // on the biggest board is a few hundred iterations.
  for (let t = spawnTick; t < arriveTick; t++) {
    const n = total(live);
    if (n <= 0) break;
    const at = squadHexOf({ ...state, tick: t }, sq);
    if (!at) continue;
    let dmg = 0;
    for (const g of guns) if (distance(g.hex, at) <= g.range) dmg += g.dmg;
    if (dmg <= 0) continue;
    carry += dmg;
    const kill = Math.floor(carry);
    carry -= kill;
    if (kill > 0) live = scaleComp(live, Math.max(0, (n - kill) / n));
  }
  return live;
}

/**
 * One tick of every armed building shooting at every enemy column in reach.
 *
 * ATTRITION IS PROPORTIONAL, exactly as a field battle's is, and through the
 * same `scaleComp` — so the integerization is the one already proven
 * deterministic rather than a second rounding rule that drifts from it. A
 * fractional casualty carries in the remainder instead of being floored away;
 * without that, a tower doing 0.16 of a body per tick would kill nobody, ever,
 * and the whole feature would be inert while looking live. That is this
 * project's most-repeated failure and it is one `Math.floor` away here.
 *
 * The carry lives on the SQUAD (`towerHurt`), not on the tower, because it is
 * the squad that is being whittled down and the squad that may walk out of
 * range of one wall and into another's.
 */
export function towersPhase(state) {
  if (!state.squads.length) return;
  const guns = [...gunsOf(state, 'player'), ...gunsOf(state, 'enemy')];
  if (!guns.length) return;

  for (const sq of state.squads) {
    const n = total(sq.comp);
    if (n <= 0) continue;
    const at = squadHexOf(state, sq);
    if (!at) continue;

    let dmg = 0;
    let by = null;
    for (const g of guns) {
      if (g.site.owner === sq.owner) continue;
      // A BUILDING DOES NOT SHOOT THE ARMY THAT IS COMING FOR IT. This is the
      // rule that keeps the whole mechanic a tax on marching PAST rather than a
      // second defence bolted onto the one that already exists. An assault is
      // resolved by the field battle and then the siege; letting the target
      // also whittle the column down on the approach charges for the same
      // attack twice, and it is not a small charge — measured, a short hop that
      // spends its whole flight inside a stronghold's reach lost 43% of the
      // force before the fight even started, which would make the siege
      // mechanic the design rests on decorative.
      if (sq.to != null && g.site.id === sq.to) continue;
      if (distance(g.hex, at) > g.range) continue;
      dmg += g.dmg;
      by = by ?? g.site;
    }
    if (dmg <= 0) continue;

    // Accumulate below one body rather than rounding to nothing.
    const carry = (sq.towerHurt || 0) + dmg;
    const kill = Math.floor(carry);
    sq.towerHurt = carry - kill;
    if (kill <= 0) continue;

    const before = n;
    sq.comp = scaleComp(sq.comp, Math.max(0, (n - kill) / n));
    const lost = before - total(sq.comp);
    if (lost <= 0) continue;
    // `{q, r}` rather than `[q, r]`: this is the same "here, on the board" claim
    // the melee's own event makes, and render/fog.js `fxVisible` and
    // screens/battle.js `locateHex` both read it as an object. It had no
    // consumer at all until the shot got a spark and a sound, so nothing had
    // ever noticed the two shapes disagreeing.
    pushEvent(state, EVENTS.TOWER_FIRED, {
      squadId: sq.id, owner: sq.owner, siteId: by ? by.id : null,
      kind: by ? by.kind : null, hex: { q: at.q, r: at.r }, lost,
    });
  }

  // A column shot to nothing is gone. Filtered here rather than left as an
  // empty squad, because every consumer downstream — the renderer, arrivals,
  // the AI's threat scan — would otherwise have to learn that a squad with no
  // bodies in it is not an army.
  state.squads = state.squads.filter((sq) => total(sq.comp) > 0);
}
