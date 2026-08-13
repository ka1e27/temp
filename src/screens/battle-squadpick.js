// PICKING AN ARMY OUT OF THE FIELD.
//
// Split out of ./battle-orders.js at the 400-line cap, in the same shape as
// ./battle-build.js beside it: a factory that takes the handful of things it
// closes over and hands back the three verbs. The seam is real rather than
// arbitrary — everything here is about a SQUAD, and nothing else in
// battle-orders.js is.
import { squadProgress, squadBow } from '../render/routes.js';
import { perceivedSquads } from '../battle/vision.js';
import { loadStops, routeAt } from '../render/routePath.js';

/** How close a click has to land, as a fraction of a hex. */
const SQUAD_PICK = 0.5;
const _p = { x: 0, y: 0 };

/**
 * @param {{getState:Function, view:object, board:object, geo:object,
 *          push:Function, cmd:object, bus?:object}} o
 */
export function createSquadPicker(o) {
  const { getState, view, board, geo, push, cmd, bus } = o;

  /** Nearest in-flight squad to a world point, so `R` can reach one. Squads are
   *  drawn along the bowed arcs routes.js walks, so hit-testing reuses that
   *  geometry rather than guessing at it. */
  function squadAt(st, wx, wy) {
    const r = board.hexSize * SQUAD_PICK;
    let best = null;
    let bestD = r * r;
    // FOG, and it follows straight from the comment above: hit-testing reuses
    // the renderer's geometry so a squad is clickable exactly where it is
    // DRAWN — and a squad outside vision is not drawn at all. Scanning the raw
    // list would leave an invisible enemy column pickable out of empty dark,
    // which is a worse tell than drawing it would have been, because the player
    // learns the army is there by finding it with the cursor.
    //
    // Unlike a SITE, whose position and kind are common knowledge (so clicking
    // a ghost to aim a blind attack is intended), a squad's existence is
    // precisely what fog hides.
    const squads = perceivedSquads(st, 'player');
    for (let i = 0; i < squads.length; i++) {
      const sq = squads[i];
      // Through the SAME geometry the renderer walks, so a squad drawn mid-arc
      // is clickable exactly where it is drawn.
      const stops = loadStops(sq, geo);
      if (!stops) continue;
      routeAt(sq, stops, squadProgress(sq, st.tick), squadBow(sq), _p, null);
      const dx = wx - _p.x;
      const dy = wy - _p.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = sq; }
    }
    return best;
  }

  /** Order the selected squad home. A squad that has already ARRIVED is no
   *  longer in `state.squads`, so forget it rather than sending an order the
   *  sim can only answer with 'unknown-squad'.
   *  @returns {boolean} true when a live squad was turned around. */
  function retreatSelectedSquad() {
    const id = view.selectedSquad;
    if (id == null) return false;
    const sq = getState().squads.find((x) => x.id === id);
    if (!sq) { view.selectedSquad = null; return false; }
    push(cmd.retreatSquad(sq.id));
    return true;
  }

  function selectSquad(sq) {
    view.selection.length = 0;
    view.trainPickerFor = null;
    view.armed = null;
    view.selectedSquad = sq.id;
    bus?.emit('ui:selection', view.selection);
  }

  return { squadAt, retreatSelectedSquad, selectSquad };
}
