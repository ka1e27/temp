// The battle screen's SHARED PRESENTATION STATE.
//
// Split out of battle-input.js at the 400-line cap, and it is the right cut:
// this is a plain data shape with no behaviour, read by the renderer and the
// HUD and written only by the input layer. Re-exported from battle-input.js, so
// no importer has to know it moved.
//
// NOTHING HERE IS SIMULATION STATE. The sim never reads any of it; input
// appends command objects to `state.commands[]` and the sim drains them. That
// separation is what makes the whole engine runnable headless.
// PURE: no DOM, no clock.

import { UNIT_IDS } from '../content/balance.js';

/** Shared presentation state. Read by the renderer and the HUD, written only
 *  here. Never touched by the simulation. */
export function createView(init = {}) {
  return {
    fraction: 0.5,
    // DERIVED from the roster. It was a literal object naming five of the
    // eight units, and the three specialists were simply absent — harmless
    // only because `filterList` treats absent as included, which is the kind
    // of accident that stops being harmless the moment somebody writes
    // `filter[u] === true` anywhere.
    filter: Object.fromEntries(UNIT_IDS.map((u) => [u, true])),
    selection: [],
    armed: null,        // click-then-click source
    /** Booster waiting for a target site. The next site click fires it there;
     *  Esc, the same key again, or a click on empty board cancels. */
    armedBooster: null,
    /** Building kind waiting for a HEX rather than a site — the same one-shot
     *  shape as an armed booster (arm, aim, fire-or-cancel), because the
     *  whole point of building is raising one on ground nothing already
     *  occupies. An armed booster still outranks this: see battle-input.js. */
    armedBuild: null,
    selectedSquad: null,
    hoverId: null,
    dragFrom: null,
    dragTo: null,
    /**
     * THE ROAD A SEND DRAG IS DRAWING, hex by hex, as packed [q,r] pairs.
     *
     * Accumulated on the way past rather than reconstructed on release: a
     * pointer trail is the only record of which way round an obstacle the
     * finger actually went, and it is gone the instant the gesture ends. That
     * is the whole of "the drag chains through tiles so you can pick the path".
     *
     * MUTATED IN PLACE, never reassigned — the renderer holds this array to
     * draw the route as it is being drawn, and swapping it would leave the
     * board pointing at the previous gesture's.
     * @type {Array<[number, number]>}
     */
    dragTrail: [],
    /**
     * Every plain drag sets a rally instead of sending.
     *
     * A rally had exactly one input and it was a RIGHT-drag. That does not
     * exist on a touchscreen, and a trackpad's two-finger click is not reliably
     * reported as button 2 while a drag is in progress — so on both of the
     * devices this is actually played on, the chained rally and the toggle were
     * unreachable. The two-finger-tap fallback below only ever covered the
     * CLICK form of setRally, never the drag.
     *
     * A mode rather than a one-shot arm, because a rally network is several
     * gestures in a row. Right-drag is unchanged and still works regardless.
     */
    rallyMode: false,
    /** In-progress RIGHT-button rally drag. Same from→to shape as dragFrom/To,
     *  kept separate so the renderer can draw it dashed — a rally is a standing
     *  order, and it should not look like a squad leaving now. */
    rallyFrom: null,
    rallyTo: null,
    pointer: { x: 0, y: 0 },
    box: null,
    trainPickerFor: null,
    lastCommand: null,
    ...init,
  };
}
