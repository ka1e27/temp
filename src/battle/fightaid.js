// SHARED FIGHT HELPERS — the small pieces both ./arrivals.js and
// ./meleephase.js need, in a file neither of them owns.
//
// THEY LIVE HERE TO BREAK A CYCLE, and the cycle is the dangerous kind. Arrivals
// OPENS a melee and the melee phase reports its casualties, so each file wants
// something from the other; an `export const` read across a cycle lands in its
// own temporal dead zone, which is the exact failure this project already hit
// once between movement.js and retreat.js. A third file both import is the fix
// the house pattern already prescribes.
// PURE.
import { UNIT_IDS, UNITS } from '../content/balance.js';
import { emptyComp, total } from './combat.js';
import { siteById } from './state.js';
import { spawnSquad } from './movement.js';
import { retreatTarget } from './retreat.js';
import { pushEvent, EVENTS } from './events.js';

export const modOf = (state, faction, key, fallback = 1) => state.mods[faction]?.[key] ?? fallback;
/** Per-troop levels (contract v7). Sparse, and absent in every battle the
 *  balance table was measured with. */
export const vetOf = (state, faction) => state.mods[faction]?.unitMult;

/** Both sides' ledgers, from one comparison. Lives here rather than in sim.js
 *  because arrivals is the only phase that kills anybody in a field battle. */
export function recordCasualties(state, loser, killer, before, after) {
  const lost = total(before) - total(after);
  if (lost <= 0) return;
  if (state.factions[loser]) state.factions[loser].unitsLost += lost;
  if (state.factions[killer]) state.factions[killer].unitsKilled += lost;
}

/**
 * A failed attack sends part of each SKIRMISHING contingent home — why a bad
 * probe costs a fraction, not the squad.
 *
 * Driven off every unit's `skirmish` field, not off `comp.raiders` as it was.
 * The VALUE was already read from the spec, so the hardcoded UNIT was invisible
 * and a second skirmisher would have escaped nothing. tests/units.test.js pins
 * it with a negative control.
 */
export function skirmishHome(state, site, group) {
  // A MELEE HAS NO SQUADS LEFT — they were absorbed into it when it opened, so
  // the losing force is one comp and one origin rather than a list. Both callers
  // are served by normalising here instead of by a second copy of the loop.
  const parts = group.squads ?? [{ comp: group.comp, from: group.from ?? null }];
  for (const sq of parts) {
    const escaped = {};
    let back = 0;
    for (const u of UNIT_IDS) {
      const frac = UNITS[u].skirmish;
      if (!frac) continue;
      const n = Math.floor((sq.comp[u] || 0) * frac);
      if (n > 0) { escaped[u] = n; back += n; }
    }
    if (back <= 0) continue;
    const home = siteById(state, sq.from);
    const target = home && home.owner === group.owner
      ? home : retreatTarget(state, site, group.owner);
    if (!target) continue;
    const comp = { ...emptyComp(), ...escaped };
    spawnSquad(state, {
      owner: group.owner, from: site.id, to: target.id, comp, retreating: true,
    });
    state.factions[group.owner].unitsLost -= back;   // they got away after all
    const foe = group.owner === 'player' ? 'enemy' : 'player';
    if (state.factions[foe]) state.factions[foe].unitsKilled -= back;
    pushEvent(state, EVENTS.SKIRMISH_ESCAPE, {
      // `raiders` is kept as the headline count so existing consumers (the HUD
      // toast, tests) keep reading a number rather than becoming undefined; it
      // now means "bodies that got away", which is what it always displayed.
      siteId: site.id, owner: group.owner, raiders: back, escaped, to: target.id,
    });
  }
}

