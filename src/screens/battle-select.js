// WHAT IS SELECTED, and the three orders that address a selection rather than
// one site.
//
// Split out of ./battle-orders.js at the 400-line cap, along the seam rather
// than at a line number: that file turns ONE gesture into ONE order, and this
// one owns the set the gesture is aimed at — how it is built (a tap, a
// double-tap along the front, a box) and the verbs that then speak to all of
// it at once.
//
// Those verbs are a family and they were written one at a time, which is how
// SEND came to be the only one missing: `setRally` and `retreatSelection`
// both walked the selection long before `sendFromSelection` existed.
//
// A factory over injected dependencies rather than its own imports, because
// every one of them — `site`, `push`, `issueSend`, `issueRally` — must be the
// same function battle-orders.js uses, not a second copy that agrees today.
//
// `board` AND `getState` ARE DEPENDENCIES, and leaving them out of this list is
// what made `boxSelect` and the rally CLICK throw `ReferenceError` for a whole
// release. The split that created this file moved two functions that closed
// over battle-orders.js's own `board`, `getState` and `_a`; destructuring only
// the four obvious deps left the other three as free variables, which is not a
// syntax error in a module and not a test failure either unless something
// actually calls the path. Nothing did: `tools/smoke.mjs` drives the rally DRAG
// (a different function) and never box-selects at all.
export function createSelection(deps) {
  const { view, bus, board, getState, site, push, cmd, issueSend, issueRally } = deps;
  // The scratch point `boxSelect` projects into. Its own, not the one in
  // battle-orders.js: two files sharing one mutable scratch across a module
  // boundary is a data race waiting for the first interleaved call.
  const _a = { x: 0, y: 0 };

  function selectOnly(id) {
    view.selection.length = 0;
    if (id) view.selection.push(id);
    view.selectedSquad = null;
    const sel = id ? site(id) : null;
    // The picker is for sites that can actually train. Farms cannot, and used
    // to open NOTHING at all as a result — they now open the site panel, which
    // hangs off `selection` and so covers every site on the board.
    view.trainPickerFor = sel && sel.owner === 'player' && sel.kind !== 'farm' ? id : null;
    bus?.emit('ui:selection', view.selection);
  }

  /** Double-tap grabs the whole connected friendly front — the fast way to
   *  order a whole flank without a box drag. */
  function selectFront(id) {
    const seen = new Set([id]);
    const queue = [id];
    while (queue.length) {
      const cur = site(queue.shift());
      if (!cur) continue;
      for (const n of cur.adj) {
        if (!seen.has(n) && site(n)?.owner === 'player') { seen.add(n); queue.push(n); }
      }
    }
    view.selection.length = 0;
    for (const k of seen) view.selection.push(k);
    view.trainPickerFor = null;
    view.selectedSquad = null;
    bus?.emit('ui:selection', view.selection);
  }

  function boxSelect(box) {
    if (!box) return;
    const st = getState();
    const x0 = Math.min(box.x0, box.x1); const x1 = Math.max(box.x0, box.x1);
    const y0 = Math.min(box.y0, box.y1); const y1 = Math.max(box.y0, box.y1);
    view.selection.length = 0;
    for (const si of st.sites) {
      if (si.owner !== 'player') continue;
      board.sitePos(si, _a);
      if (_a.x >= x0 && _a.x <= x1 && _a.y >= y0 && _a.y <= y1) view.selection.push(si.id);
    }
    view.armed = view.selection.length === 1 ? view.selection[0] : null;
    view.trainPickerFor = null;
    view.selectedSquad = null;
    bus?.emit('ui:selection', view.selection);
  }

  /** Rally makes a site auto-send once its garrison passes the threshold — the
   *  idle affordance inside the battle, and the cure for back-line micro.
   *
   *  The click form: whatever is selected rallies to the site under the pointer.
   *  Kept because it is the only way to point a whole flank at one target in a
   *  single action; the drag form (battle-input.js) handles one site at a time. */
  function setRally(wx, wy) {
    const target = board.siteAt(getState(), wx, wy);
    // Copied: a `ui:command` listener is allowed to change the selection.
    const sources = view.selection.length ? view.selection.slice()
      : (view.armed ? [view.armed] : []);
    if (!sources.length) return;
    for (const id of sources) issueRally(site(id), target);
  }

  function retreatSelection() {
    for (const id of view.selection) {
      const src = site(id);
      if (!src) continue;
      if (src.owner === 'player' || src.siege?.owner === 'player') push(cmd.retreat(id));
    }
  }

  /**
   * CONCENTRATING FORCE: one order per player-owned site in the selection, all
   * aimed at the same target — the missing third member of the family
   * `setRally`/`retreatSelection` already belong to. SEND was the one verb
   * that made you drag from every site in turn, costliest on exactly the late
   * maps where `AI.maxSources` already lets the enemy pool three sites into
   * one assault for free. Each source validates and prices INDEPENDENTLY
   * through the same `issueSend` a lone drag uses, so a site with nothing to
   * send simply contributes nothing. No source cap: `AI.maxSources` bounds
   * the AI's SEARCH, not a rule of the game — the player's bound is whatever
   * they selected.
   *
   * NO WAYPOINTS. A drawn route is the hexes ONE drag crossed, from ONE site;
   * a column standing somewhere else has no relationship to those hexes, and
   * threading them through it anyway would march it over ground the player
   * never pointed at. Every source paths however `cmdSend` decides on its
   * own — what an un-drawn single send already does. See battle-input.js
   * `onDown` for where a drag is decided to be this rather than `issueSend`,
   * and battle-waypoints.js `updateDragPreview` for the arrow.
   * @param {?object} to snapped target site, or null for bare ground
   * @param {{toHex?:number[]}} [opts]
   * @returns {number} how many sends were actually issued
   */
  function sendFromSelection(to, opts = {}) {
    const { toHex } = opts;
    // Copied, same reason as setRally above: issueSend can trigger a
    // `ui:command` listener that changes the selection mid-loop.
    const sources = view.selection.slice();
    let n = 0;
    for (const id of sources) {
      const from = site(id);
      if (!from || from.owner !== 'player') continue;
      if (issueSend(from, to, { toHex })) n++;
    }
    return n;
  }

  return {
    selectOnly, selectFront, boxSelect, setRally, retreatSelection, sendFromSelection,
  };
}
