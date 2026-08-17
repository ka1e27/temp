// WHAT A COMPLETED DRAG MEANT.
//
// Split out of ./battle-input.js at the 400-line cap, along the seam rather
// than at a line number. That file recognises the GESTURE — press, travel,
// release, and the pinch and pan that are not orders at all — and
// battle-orders.js turns an intent into a command object. This is the piece
// between them: given where a drag started and where it ended, WHICH of the
// four march orders was it?
//
// The four are one rule seen from four directions, which is why they belong in
// one function rather than scattered down a handler: a camped force onto a
// site, a camped force onto bare ground, a garrison onto a site, a garrison
// onto bare ground. Troops standing in a field answer this gesture exactly as
// troops standing in a yard do — see battle/marchorders.js `cmdMoveSquad` for
// the half of that rule the simulation owns.
//
// PRESENTATION ONLY: every branch here ends in an `ord.*` call, and every one
// of those ends in a command object. Nothing below touches sim state.

/** The player's own CAMPED force at a world point, or null. Built on the same
 *  `squadAt` the tap path already uses — ONE hit-test, so an army you can
 *  select is an army you can drag, and both stay fog-gated for free rather
 *  than through a second scan that agrees today. */
export function campedAt(ord, state, wx, wy) {
  const sq = ord.squadAt(state, wx, wy);
  return sq && sq.camped && sq.owner === 'player' ? sq : null;
}

/**
 * @param {object} ord   battle-orders.js
 * @param {object} view  the presentation state (battle-view.js)
 * @param {object} state the battle slice, for the camped-squad lookup
 * @returns {boolean} true when the drag was resolved as a march order — false
 *   means it was not a drag from anything, and the caller should fall through
 *   to its box-select and tap branches.
 */
export function resolveDrag(ord, view, state) {
  // A CAMPED FORCE RESOLVES ITS DRAG FIRST, and down the same three branches
  // a garrison's does: onto a site (assault or reinforce), or onto bare
  // ground. It carries waypoints on the same `isDrawnRoute` test, because a
  // road drawn out of a field is a road either way.
  if (view.dragFromSquad != null) {
    const st = state;
    const sq = st.squads.find((x) => x.id === view.dragFromSquad);
    const to = view.dragTo ? ord.site(view.dragTo) : null;
    const drawn = ord.isDrawnRoute(view.dragTrail);
    const waypoints = drawn ? ord.trimWaypoints(view.dragTrail) : [];
    if (sq && to) {
      ord.issueMove(sq, to, { waypoints });
    } else if (sq) {
      const at = view.dragTrail[view.dragTrail.length - 1];
      if (at) ord.issueMove(sq, null, { toHex: at, waypoints });
    }
    return true;
  }

  const from = view.dragFrom ? ord.site(view.dragFrom) : null;

  if (!from) return false;
  {
    // Drag order. Releasing back on the source is an explicit cancel.
    const to = view.dragTo ? ord.site(view.dragTo) : null;
    if (view.dragSources) {
      // CONCENTRATING FORCE. No waypoints — see battle-orders.js
      // `sendFromSelection` for why a drawn route cannot generalise to
      // more than one origin. The SELECTION SURVIVES the send, unlike the
      // single-source branch below: collapsing it back to one site would
      // charge a re-select for every subsequent target, which is most of
      // the cost this gesture exists to remove.
      if (to && to.id !== from.id) {
        ord.sendFromSelection(to);
      } else if (!to) {
        const at = view.dragTrail[view.dragTrail.length - 1];
        if (at) ord.sendFromSelection(null, { toHex: at });
      }
      view.armed = from.id;
    } else {
      // WAYPOINTS ONLY WHEN THE DRAG MEANT THEM. A straight pull from a site
      // to its neighbour crosses hexes it means nothing by — the player was
      // pointing, not drawing — and pinning the army to those would refuse
      // the whole order if one of them happened to be occupied.
      // `isDrawnRoute` is the test for "meaningfully longer than the
      // straight line".
      const drawn = ord.isDrawnRoute(view.dragTrail);
      const waypoints = drawn ? ord.trimWaypoints(view.dragTrail) : [];
      if (to && to.id !== from.id) {
        ord.issueSend(from, to, { waypoints });
      } else if (!to) {
        // RELEASED ON OPEN GROUND: take the position rather than abandoning
        // the gesture. This is the other half of what the squad rewrite
        // bought — an army can hold a tile, so a drag has somewhere to end
        // that is not a building. `snapTarget` already magnets to a nearby
        // site, so landing here means the player really did release in
        // open country.
        const at = view.dragTrail[view.dragTrail.length - 1];
        if (at) ord.issueSend(from, null, { toHex: at, waypoints });
      }
      ord.selectOnly(from.id);
      view.armed = from.id;
    }
  }
  return true;
}
