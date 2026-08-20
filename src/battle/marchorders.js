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
/**
 * CAN A MARCH END ON THIS HEX AT ALL? One predicate, three consumers.
 *
 * `cmdSend` and `cmdMoveSquad` each carried this test inline, and the DRAG
 * PREVIEW carried no version of it — which made the preview lie about the one
 * terrain feature the game draws most prominently. `battle-waypoints.js
 * previewPath` builds its route with `pathThrough`, whose A* uses
 * `occupancy.js passableFor`, and that function gives the GOAL hex a free pass
 * BEFORE it consults `isBlocked` (line 92 against 93) so a column can target a
 * building it means to assault. That exemption was written for buildings and
 * nothing confined it to them: aim a drag at a mountain and A* returns a
 * confident seven-hex route ending on the rock, the board draws it hex by hex
 * with a chevron on the final tile, and releasing produces no squad and a
 * rejection banner. Measured live on a generated map with eleven blocked hexes.
 *
 * `render/routes.js drawDragArc`'s own comment claimed the two were the same
 * question ("the SAME pathThrough the order will be validated by"). They were
 * not, and invariant 3 is the thing this project protects hardest.
 *
 * @returns {?string} the rejection reason, or null if the hex is a legal target
 */
export function marchBlocker(state, toHex) {
  if (!toHex) return null;
  // `spawnSquad` falls back to a straight line when A* finds nothing, so an
  // off-map order would produce a column marching into the void with a
  // perfectly ordinary arrival tick.
  if (!inGrid(state.grid, toHex) || isBlocked(state, toHex.q, toHex.r)) return 'bad-hex';
  return null;
}

/**
 * ...AND THE SAME QUESTION OF EVERY STOP ON A DRAWN ROUTE.
 *
 * `pathThrough` stitches one A* leg per stop, and `passableFor` waives the
 * terrain check for each LEG'S GOAL — so an intermediate waypoint got the same
 * free pass the destination did. Only the final `toHex` was ever validated,
 * which meant a route drawn deliberately through a mountain was ACCEPTED and
 * the resulting squad's path contained a step standing on blocked rock.
 * Measured: order accepted, `path.length` 9, one step on `{q:6,r:0}`. Mountains
 * are the one piece of terrain the game promises is impassable, and a player
 * could walk an army through one by drawing the road themselves.
 *
 * Provably inert on balance: `waypoints` is absent from every order the AI and
 * the harness issue — a grep over `tools/` and `battle/ai*.js` finds no
 * occurrence at all — so no measured number can move.
 */
export function routeBlocker(state, toHex, waypoints) {
  const bad = marchBlocker(state, toHex);
  if (bad) return bad;
  if (!Array.isArray(waypoints)) return null;
  for (const w of waypoints) {
    if (marchBlocker(state, asHex(w))) return 'bad-waypoint';
  }
  return null;
}

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
  const bad = routeBlocker(state, toHex, cmd.waypoints);
  if (bad) return bad;
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
  // A MARCHING COLUMN IS RE-TASKABLE, and the refusal that used to sit here was
  // an implementation artefact rather than a rule. Measured on the shipped game
  // before it went: a squad corrected 2.7s into a 6.7s wrong-way march was back
  // at its start tile at 5.9s having accomplished nothing, with a FOURTH action
  // still needed to go where it was meant to — because the only correction
  // available was `RETREAT_SQUAD`, which takes no destination and only ever aims
  // at the nearest friendly site. Three legs for a misclick, in a game whose
  // design centre is free movement and cheap sends, where misdirected columns
  // are a byproduct of playing as intended.
  //
  // Nothing about the sim had to change to allow it: `marchCamped` below reads
  // the squad's position with `squadHexOf` and sets `spawnTick` to now, which is
  // exactly the re-anchoring `reverseSquad` already does and exactly what stops
  // the march booster's teleport (shortening `arriveTick` alone makes a column
  // JUMP, because position is `(tick - spawnTick) / (arriveTick - spawnTick)`).
  //
  // PROVABLY BALANCE-NEUTRAL: `MOVE_SQUAD` is issued by screens/battle-orders.js
  // and by tests, and by nothing in `tools/` or `battle/ai*.js` at all — so no
  // measured number can move, and the shipped game gets materially more
  // forgiving. A squad in a melee is off `state.squads` entirely and still
  // answers `unknown-squad`: troops already fighting are pulled out with
  // RETREAT, not re-aimed.

  const to = cmd.to != null ? siteById(state, cmd.to) : null;
  const toHex = cmd.toHex ? asHex(cmd.toHex) : null;
  if (cmd.to != null && !to) return 'unknown-site';
  if (!to && !toHex) return 'no-destination';
  const badTo = routeBlocker(state, toHex, cmd.waypoints);
  if (badTo) return badTo;
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

  // THE REMAINDER KEEPS ITS OWN SCHEDULE. Splitting a marching column leaves the
  // rest of it on the `path`, `spawnTick` and `arriveTick` it set out with, even
  // though dropping the slow units off would in principle let it speed up:
  // recomputing `arriveTick` without re-anchoring `spawnTick` is precisely the
  // teleport above, and re-anchoring means rebuilding the remaining path for a
  // gain nobody asked for. A column that detaches part of itself marches on at
  // the pace it set.
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
