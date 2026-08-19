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
/**
 * DID THIS DRAG COME BACK TO WHERE IT STARTED?
 *
 * `battle-waypoints.js updateDragPreview` deliberately nulls `view.dragTo`
 * whenever the snap target resolves back to the drag's own origin — that is the
 * "so you can clear a rally" pattern, and it is right for a rally. For a SEND it
 * made a returning drag INDISTINGUISHABLE from a release on open ground, so it
 * fell into the bare-ground branch and marched a share of the garrison onto the
 * tile it was already standing on.
 *
 * Measured before the fix: press on the camp, drag out 30px, come back and
 * release on the camp — squads-from-camp went 0 to 1, a new squad appeared
 * `{to: null, camped: true}` having marched nowhere, and repeating the gesture
 * peeled off ANOTHER share. The detachment then sits exactly on its own site's
 * hex, where `siteAt` wins every hit-test, so it can never be selected again.
 *
 * So the single most natural way to abort a gesture — start a drag by accident,
 * bring it back, let go — silently and permanently fragmented the garrison, with
 * no error and nothing on screen to notice. `resolveDrag`'s own comment already
 * said "releasing back on the source is an explicit cancel"; the comment was the
 * specification and the code had drifted from it, which is this project's
 * most-repeated failure shape.
 *
 * The test is the LAST TRAIL HEX against the origin's own hex rather than
 * `dragTo`, because `dragTo` is exactly the signal that was thrown away.
 */
function backAt(view, q, r) {
  const at = view.dragTrail[view.dragTrail.length - 1];
  return !!at && at.q === q && at.r === r;
}

/** The garrison form: the origin is a SITE, whose `hex` is a `[q,r]` array. */
const backAtSource = (view, from) => !!from && backAt(view, from.hex[0], from.hex[1]);

/**
 * The camped form, and it is the same bug one verb along. A camped force
 * dragged back onto its own tile fell into `issueMove(sq, null, {toHex})`,
 * and `cmdMoveSquad` takes a FRACTION — so instead of marching nowhere it
 * SPLIT, leaving two camped squads stacked on one hex. `sq.hex` may be either
 * shape, so it is read the way `movement.js squadHexOf` reads it.
 */
function backAtSquad(view, sq) {
  if (!sq?.camped || !sq.hex) return false;
  const q = Array.isArray(sq.hex) ? sq.hex[0] : sq.hex.q;
  const r = Array.isArray(sq.hex) ? sq.hex[1] : sq.hex.r;
  return backAt(view, q, r);
}

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
    } else if (sq && !backAtSquad(view, sq)) {
      const at = view.dragTrail[view.dragTrail.length - 1];
      if (at) ord.issueMove(sq, null, { toHex: at, waypoints });
    }
    return true;
  }

  const from = view.dragFrom ? ord.site(view.dragFrom) : null;

  if (!from) return false;
  {
    // Drag order. Releasing back on the source is an explicit cancel — see
    // `backAtSource` above for how nearly that was only a comment.
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
      } else if (!to && !backAtSource(view, from)) {
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
      } else if (!to && !backAtSource(view, from)) {
        // RELEASED ON OPEN GROUND: take the position rather than abandoning
        // the gesture. This is the other half of what the squad rewrite
        // bought — an army can hold a tile, so a drag has somewhere to end
        // that is not a building. `snapTarget` already magnets to a nearby
        // site, so landing here means the player really did release in
        // open country — and `backAtSource` is what makes "really" true:
        // without it a drag that came home read as open country too.
        const at = view.dragTrail[view.dragTrail.length - 1];
        if (at) ord.issueSend(from, null, { toHex: at, waypoints });
      }
      ord.selectOnly(from.id);
      view.armed = from.id;
    }
  }
  return true;
}
