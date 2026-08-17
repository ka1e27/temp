// MARCH ORDERS — the two verbs that move bodies across the map, split out of
// ./commands.js at the 400-line cap and re-exported from there, so every
// existing `import { subComp } from './commands.js'` still resolves.
//
// They are together because they are the pair that had to change when a squad
// stopped being a thing that only travels between two buildings: SEND spends a
// garrison out of a site you hold, MOVE_SQUAD spends nothing because the bodies
// are already standing in a field. Keeping them one function would mean every
// garrison check growing an "unless it is camped" arm, which is how a rule
// quietly stops applying to half its cases.
// PURE.
import { UNIT_IDS } from '../content/balance.js';
import { emptyComp, addComp, scaleComp, total } from './combat.js';
import { siteById, isBlocked } from './state.js';
import { occupantAt } from './occupancy.js';
import { spawnSquad, pathThrough, squadHexOf } from './movement.js';
import { marchCamped } from './retreat.js';
import { asHex } from './influence.js';
import { inGrid } from './mapgen.js';
import { pushEvent, EVENTS } from './events.js';

/** a minus b, never below zero. */
export function subComp(a, b) {
  const out = emptyComp();
  for (const u of UNIT_IDS) out[u] = Math.max(0, (a[u] || 0) - (b[u] || 0));
  return out;
}

/** Keep only the unit ids in `filter` (the HUD's Q-W-E-R-T chips). */
export function filterComp(comp, filter) {
  if (!Array.isArray(filter) || !filter.length) return addComp(emptyComp(), comp);
  const out = emptyComp();
  for (const u of UNIT_IDS) if (filter.includes(u)) out[u] = comp[u] || 0;
  return out;
}

// --- individual orders -----------------------------------------------------

/**
 * A send now names EITHER a destination site (`to`) or a bare hex (`toHex`),
 * and may carry `waypoints` — the road the player drew rather than the shortest
 * one. `toHex` and `waypoints` are both optional and both absent on every order
 * the AI and the harness issue, so the old shape is still the common one.
 */
export function cmdSend(state, cmd, by) {
  const from = siteById(state, cmd.from);
  if (!from) return 'unknown-site';
  if (from.owner !== by) return 'not-your-site';

  const to = cmd.to != null ? siteById(state, cmd.to) : null;
  const toHex = cmd.toHex ? asHex(cmd.toHex) : null;
  if (cmd.to != null && !to) return 'unknown-site';
  if (!to && !toHex) return 'no-destination';
  if (to && from.id === to.id) return 'same-site';
  // A HEX DESTINATION HAS TO BE ON THE BOARD, and nothing downstream re-checks:
  // `spawnSquad` falls back to a straight line when A* finds nothing, so an
  // off-map order would produce a column marching into the void with a
  // perfectly ordinary arrival tick.
  if (toHex && (!inGrid(state.grid, toHex) || isBlocked(state, toHex.q, toHex.r))) {
    return 'bad-hex';
  }
  // ...AND IT HAS TO BE GROUND, not somebody else's front step. `passableFor`
  // gives the GOAL hex a free pass so an army can path onto a site it means to
  // assault — right for an order aimed AT a building, wrong for a march to a
  // bare tile: without this, a hex order naming the tile an enemy base stands on
  // is an order to CAMP inside it, and arrivals.js obliges, because a camped
  // squad never consults occupancy again. Own ground stays legal — standing in
  // your own yard is exactly what occupancy already allows, and it is how a
  // drawn route chains through your own buildings.
  if (toHex && (occupantAt(state, toHex.q, toHex.r) ?? by) !== by) return 'occupied-hex';

  // THE RULE THAT REPLACED ADJACENCY. A send used to be legal only along an
  // authored edge; now it is legal wherever an army can actually walk, and the
  // only thing that stops one is a base in the way — see ./occupancy.js for why
  // a building denies exactly its own hex and no more. It is answered with the
  // same A* the travel time is computed from, so the rule the player is refused
  // by and the route they are charged for cannot disagree — and with waypoints
  // that means the WHOLE stitched route, or the detour would be validated
  // against a road nobody is going to walk.
  const stops = [
    asHex(from.hex),
    ...(Array.isArray(cmd.waypoints) ? cmd.waypoints.map(asHex) : []),
    to ? asHex(to.hex) : toHex,
  ];
  if (!pathThrough(state, stops, by)) return 'no-route';

  const frac = Math.min(1, Math.max(0, Number(cmd.fraction ?? 1)));
  if (!(frac > 0)) return 'bad-fraction';

  const send = scaleComp(filterComp(from.garrison, cmd.filter), frac);
  if (total(send) === 0) return 'empty-send';

  from.garrison = subComp(from.garrison, send);
  const squad = spawnSquad(state, {
    owner: by,
    from: from.id,
    to: to ? to.id : null,
    toHex: to ? null : toHex,
    waypoints: Array.isArray(cmd.waypoints) ? cmd.waypoints : null,
    comp: send,
    arriveTick: cmd.arriveTick | 0,
  });
  pushEvent(state, EVENTS.SQUAD_SENT, {
    squadId: squad.id, owner: by, from: from.id, to: squad.to, arriveTick: squad.arriveTick,
  });
  return null;
}

/**
 * Move an army that is standing on open ground.
 *
 * Its own verb rather than a branch of SEND, because the two validate nothing
 * alike: a send spends a garrison out of a building you must own, and this
 * spends nothing at all — the bodies are already in the field. Folding them
 * together would mean every garrison check growing an "unless it is camped"
 * arm, which is how a rule quietly stops applying.
 *
 * IT SPLITS, exactly as a send does. `fraction` and `filter` mean here what
 * they mean there, and the half that is not ordered anywhere STAYS PUT — same
 * hex, still camped — which is the direct analogue of a garrison's hold-back.
 * Without this a camped force was the one body of troops on the board you
 * could not divide: the whole army went or none of it did, so the moment you
 * stopped on open ground you lost a power you had while standing in a yard.
 * The order was always half of the "troops on a tile behave like troops in a
 * building" rule; only the interaction was missing (see battle-input.js).
 */
export function cmdMoveSquad(state, cmd, by) {
  const squad = state.squads.find((s) => s.id === cmd.squadId);
  if (!squad) return 'unknown-squad';
  if (squad.owner !== by) return 'not-your-squad';
  if (!squad.camped) return 'squad-in-transit';

  const to = cmd.to != null ? siteById(state, cmd.to) : null;
  const toHex = cmd.toHex ? asHex(cmd.toHex) : null;
  if (cmd.to != null && !to) return 'unknown-site';
  if (!to && !toHex) return 'no-destination';
  if (toHex && (!inGrid(state.grid, toHex) || isBlocked(state, toHex.q, toHex.r))) {
    return 'bad-hex';
  }
  // ...AND IT HAS TO BE GROUND, not somebody else's front step. `passableFor`
  // gives the GOAL hex a free pass so an army can path onto a site it means to
  // assault — right for an order aimed AT a building, wrong for a march to a
  // bare tile: without this, a hex order naming the tile an enemy base stands on
  // is an order to CAMP inside it, and arrivals.js obliges, because a camped
  // squad never consults occupancy again. Own ground stays legal — standing in
  // your own yard is exactly what occupancy already allows, and it is how a
  // drawn route chains through your own buildings.
  if (toHex && (occupantAt(state, toHex.q, toHex.r) ?? by) !== by) return 'occupied-hex';

  const frac = Math.min(1, Math.max(0, Number(cmd.fraction ?? 1)));
  if (!(frac > 0)) return 'bad-fraction';
  const march = scaleComp(filterComp(squad.comp, cmd.filter), frac);
  if (total(march) === 0) return 'empty-send';
  const stay = subComp(squad.comp, march);
  const waypoints = Array.isArray(cmd.waypoints) ? cmd.waypoints : null;

  // THE WHOLE FORCE GOES: re-task the squad in place. This is the older path
  // and it is kept as its own branch rather than folded into the split below,
  // because moving every body is not a division — a squad that spawned a
  // sibling and then emptied itself would leave a zero-strength camp on the
  // board that every consumer would have to learn to ignore.
  if (total(stay) === 0) {
    if (!marchCamped(state, squad, {
      to: to ? to.id : null, toHex: to ? null : toHex, waypoints,
    })) return 'no-route';
    pushEvent(state, EVENTS.SQUAD_SENT, {
      squadId: squad.id, owner: by, from: null, to: squad.to, arriveTick: squad.arriveTick,
    });
    return null;
  }

  // PART OF IT GOES. The route is validated BEFORE anything is taken out of
  // the camp, for the reason cmdSend validates before it debits a garrison:
  // `spawnSquad` answers an impossible route with a straight line rather than
  // a refusal, so ordering first and asking later produces a column walking
  // through a mountain and a camp that has already paid for it.
  const at = squadHexOf(state, squad);
  if (!at) return 'no-route';
  const stops = [
    at,
    ...(waypoints ? waypoints.map(asHex) : []),
    to ? asHex(to.hex) : toHex,
  ];
  if (!pathThrough(state, stops, by)) return 'no-route';

  squad.comp = stay;
  const moved = spawnSquad(state, {
    owner: by,
    from: null,
    fromHex: at,
    to: to ? to.id : null,
    toHex: to ? null : toHex,
    waypoints,
    comp: march,
  });
  pushEvent(state, EVENTS.SQUAD_SENT, {
    squadId: moved.id, owner: by, from: null, to: moved.to, arriveTick: moved.arriveTick,
  });
  return null;
}
