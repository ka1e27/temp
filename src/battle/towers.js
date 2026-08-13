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
    pushEvent(state, EVENTS.TOWER_FIRED, {
      squadId: sq.id, owner: sq.owner, siteId: by ? by.id : null,
      kind: by ? by.kind : null, hex: [at.q, at.r], lost,
    });
  }

  // A column shot to nothing is gone. Filtered here rather than left as an
  // empty squad, because every consumer downstream — the renderer, arrivals,
  // the AI's threat scan — would otherwise have to learn that a squad with no
  // bodies in it is not an army.
  state.squads = state.squads.filter((sq) => total(sq.comp) > 0);
}
