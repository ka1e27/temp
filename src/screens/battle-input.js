// Battle controls. Pointer Events ONLY — one code path that behaves the same
// for mouse, trackpad and touch, which is why there is no separate touch
// handler anywhere in this file.
//
// This file recognises GESTURES: presses, drags, taps, pinches, keys. What a
// gesture means in game terms — and every append to state.commands[] — lives in
// battle-orders.js, so the hard rule (presentation never mutates simulation
// state) has exactly one place to be checked.
//
// The commit-size decision is GLOBAL (strength selector + unit filters), never
// a modal between intent and action — a dialog in a real-time game is a bug.
import { createDisposer } from '../ui/dom.js';
import { createHotkeys } from './battle-hotkeys.js';
import { createOrders, cmd } from './battle-orders.js';

export { cmd, filterList } from './battle-orders.js';

const TAP_SLOP = 6;       // CSS px of travel still counted as a tap
const TWO_FINGER_MS = 260;
const DOUBLE_TAP_MS = 320;

/** Shared presentation state. Read by the renderer and the HUD, written only
 *  here. Never touched by the simulation. */
export function createView(init = {}) {
  return {
    fraction: 0.5,
    filter: { militia: true, spearmen: true, raiders: true, rams: true, marshal: true },
    selection: [],
    armed: null,        // click-then-click source
    /** Booster waiting for a target site. The next site click fires it there;
     *  Esc, the same key again, or a click on empty board cancels. */
    armedBooster: null,
    selectedSquad: null,
    hoverId: null,
    dragFrom: null,
    dragTo: null,
    /** In-progress RIGHT-button rally drag. Same from→to shape as dragFrom/To,
     *  kept separate so the renderer can draw it dashed — a rally is a standing
     *  order, and it should not look like a squad leaving now. */
    rallyFrom: null,
    rallyTo: null,
    /** Sites the current drag is routing THROUGH, in order, excluding both the
     *  source and the destination. Empty for an ordinary one-hop order. */
    chain: [],
    pointer: { x: 0, y: 0 },
    box: null,
    trainPickerFor: null,
    lastCommand: null,
    ...init,
  };
}

/**
 * @param {{canvas:HTMLCanvasElement, board:object, view:object,
 *          getState:()=>object, bus?:object}} o
 *   `board` is the battleView (geometry + camera).
 */
export function createBattleInput(o) {
  const { canvas, board, view, getState, bus } = o;
  const off = createDisposer();
  const cam = board.camera;
  const ord = createOrders(o);
  const w = { x: 0, y: 0 };
  const s = { x: 0, y: 0 };
  const pointers = new Map();
  let press = null;
  let rally = null;
  let panning = false;
  let pinchDist = 0;
  let lastTapAt = 0;
  let lastTapId = null;

  function clearDrag() {
    view.dragFrom = null;
    view.dragTo = null;
    view.rallyFrom = null;
    view.rallyTo = null;
    view.chain.length = 0;
    view.box = null;
    canvas.classList.remove('is-dragging');
  }

  // ---- pointer ------------------------------------------------------------

  function onDown(ev) {
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, at: performance.now(), moved: 0 });
    canvas.setPointerCapture?.(ev.pointerId);
    board.pointer(ev, s);
    cam.screenToWorld(s.x, s.y, w);

    if (pointers.size === 2) {         // two fingers: pan / pinch, cancel order
      clearDrag();
      panning = true;
      pinchDist = spread();
      return;
    }
    const hit = board.siteAt(getState(), w.x, w.y);

    // Right button: rally. Pressing on one of your own sites begins a rally
    // DRAG — the same from→to gesture as a send, because a rally IS a standing
    // send and should not need a different vocabulary to express.
    //
    // It has to be deferred to the release: firing on press meant that pressing
    // the source and dragging to the target set target === source, i.e. it
    // CLEARED the rally you were trying to set. A right-click that never moves
    // still runs the old select-then-click path on release.
    if (ev.button === 2) {
      rally = { fromId: hit?.owner === 'player' ? hit.id : null, sx: s.x, sy: s.y, moved: false };
      if (rally.fromId) {
        view.rallyFrom = rally.fromId;
        view.rallyTo = null;
        canvas.classList.add('is-dragging');
      }
      return;
    }
    if (ev.button === 1 || ev.shiftKey) { panning = true; return; }

    press = { id: hit?.id ?? null, sx: s.x, sy: s.y, moved: false, at: performance.now() };
    view.pointer.x = w.x;
    view.pointer.y = w.y;

    // While a booster is armed the press means "aim here" and nothing else: no
    // drag order, no box select. The release picks the site.
    if (view.armedBooster) return;

    if (hit && hit.owner === 'player') {
      view.dragFrom = hit.id;
      view.dragTo = null;
      canvas.classList.add('is-dragging');
    } else if (!hit) {
      view.box = { x0: w.x, y0: w.y, x1: w.x, y1: w.y };
    }
  }

  function onMove(ev) {
    const rec = pointers.get(ev.pointerId);
    if (rec) {
      rec.moved += Math.abs(ev.clientX - rec.x) + Math.abs(ev.clientY - rec.y);
      rec.x = ev.clientX;
      rec.y = ev.clientY;
    }
    board.pointer(ev, s);
    cam.screenToWorld(s.x, s.y, w);
    view.pointer.x = w.x;
    view.pointer.y = w.y;

    if (panning) {
      if (pointers.size === 2) {
        const d = spread();
        if (pinchDist > 0 && d > 0) cam.zoomAt(s.x, s.y, d / pinchDist);
        pinchDist = d;
      } else if (ev.movementX !== undefined) {
        cam.panScreen(ev.movementX, ev.movementY);
      }
      board.releaseAutoFit();
      board.markBgDirty();
      return;
    }

    if (rally) {
      if (!rally.moved && Math.hypot(s.x - rally.sx, s.y - rally.sy) > TAP_SLOP) rally.moved = true;
      view.hoverId = board.siteAt(getState(), w.x, w.y)?.id ?? null;
      if (view.rallyFrom) {
        const from = ord.site(view.rallyFrom);
        if (from) {
          growChain(from, board.siteAt(getState(), w.x, w.y));
          const head = view.chain.length
            ? ord.site(view.chain[view.chain.length - 1]) || from : from;
          // Snapped target may BE the source — that is how you clear a rally, so
          // it is kept rather than nulled, and the renderer says so.
          const t = ord.snapTarget(head, w.x, w.y);
          view.rallyTo = t ? t.id : null;
        }
      }
      return;
    }

    if (press && !press.moved && Math.hypot(s.x - press.sx, s.y - press.sy) > TAP_SLOP) {
      press.moved = true;
    }
    const hover = board.siteAt(getState(), w.x, w.y);
    view.hoverId = hover?.id ?? null;

    if (view.dragFrom) {
      const from = ord.site(view.dragFrom);
      if (from) {
        growChain(from, hover);
        // Legs are measured from the HEAD of the chain, not the source, so the
        // preview leans toward what is reachable from where the column has got
        // to rather than from where it set out.
        const head = view.chain.length
          ? ord.site(view.chain[view.chain.length - 1]) || from : from;
        const t = ord.snapTarget(head, w.x, w.y);
        view.dragTo = t && t.id !== from.id ? t.id : null;
      }
    } else if (view.box) {
      view.box.x1 = w.x;
      view.box.y1 = w.y;
    }
  }

  /**
   * Grow (or retrace) the chain of sites a drag is routing THROUGH.
   *
   * A waypoint needs a DIRECT HIT — `hover`, not `snapTarget`. snapTarget leans
   * generously toward the nearest adjacent site so a rough drag still lands an
   * order, and that is exactly wrong here: dragging in a straight line past a
   * site would silently turn an ordinary two-site send into a chain. You have
   * to actually drag over a site to route through it.
   *
   * Dragging back over a stop you already passed TRUNCATES there, so a wrong
   * turn is undone by retracing it rather than by starting the drag again.
   */
  function growChain(from, hover) {
    if (!hover || hover.id === from.id) return;
    const i = view.chain.indexOf(hover.id);
    if (i >= 0) { view.chain.length = i + 1; return; }
    const head = view.chain.length
      ? ord.site(view.chain[view.chain.length - 1]) || from : from;
    // Only ground we hold can be marched through; the objective is chosen by
    // where the drag is RELEASED, so a hostile site is never a waypoint.
    if (hover.owner !== 'player' || !head.adj.includes(hover.id)) return;
    view.chain.push(hover.id);
  }

  /** The waypoints for a send that ends at `toId` — the chain up to it, so a
   *  release ON a waypoint makes that waypoint the destination instead. */
  function chainFor(toId) {
    const i = view.chain.indexOf(toId);
    return i >= 0 ? view.chain.slice(0, i) : view.chain.slice();
  }

  function onUp(ev) {
    const rec = pointers.get(ev.pointerId);
    pointers.delete(ev.pointerId);
    canvas.releasePointerCapture?.(ev.pointerId);

    if (rally) {
      board.pointer(ev, s);
      cam.screenToWorld(s.x, s.y, w);
      if (rally.fromId && rally.moved) {
        // Drag form. Releasing on nothing legal abandons the gesture rather
        // than wiping the rally you already had — only a release back on the
        // SOURCE clears, and that reads as deliberate.
        const from = ord.site(rally.fromId);
        const to = view.rallyTo ? ord.site(view.rallyTo) : null;
        // A chained rally sets a rally on EVERY site along the road, because
        // rallies already cascade — so the chain is expressed with the orders
        // the sim already has rather than a new multi-hop concept.
        if (from && to) {
          const chain = chainFor(to.id);
          // Toggle, not set: one link has three states (off, this way, that
          // way) and the drag cycles them, so undoing never needs a second
          // gesture. See battle-orders.js toggleRally.
          if (chain.length) ord.issueRallyChain(from, chain, to);
          else ord.toggleRally(from, to);
        }
      } else {
        ord.setRally(w.x, w.y);   // click form: whatever is selected
      }
      clearDrag();
      rally = null;
      return;
    }

    if (panning) {
      // A quick two-finger tap that never moved is the touch equivalent of a
      // right-click, so rally points work without a keyboard or a second button.
      if (rec && rec.moved < 8 && performance.now() - rec.at < TWO_FINGER_MS && pointers.size === 0) {
        board.pointer(ev, s);
        cam.screenToWorld(s.x, s.y, w);
        ord.setRally(w.x, w.y);
      }
      if (pointers.size === 0) panning = false;
      return;
    }
    if (!press) return;

    board.pointer(ev, s);
    cam.screenToWorld(s.x, s.y, w);
    const from = view.dragFrom ? ord.site(view.dragFrom) : null;

    if (from && press.moved) {
      // Drag order. Releasing back on the source is an explicit cancel.
      const to = view.dragTo ? ord.site(view.dragTo) : null;
      if (to && to.id !== from.id) ord.issueSend(from, to, chainFor(to.id));
      ord.selectOnly(from.id);
      view.armed = from.id;
    } else if (view.box && press.moved) {
      ord.boxSelect(view.box);
    } else {
      tap(board.siteAt(getState(), w.x, w.y));
    }
    clearDrag();
    press = null;
  }

  /**
   * A tap SELECTS. It never sends — see tests/tapsend.test.js.
   *
   * Tap-then-tap used to issue a send. The panel's controls sit over the board
   * and every neighbour is a legal target, so it was indistinguishable from
   * looking at two sites in a row: upgrading two sites in sequence quietly
   * shipped half of one garrison to the other, and a send has no undo. Dragging
   * is the only way to send now, and it is the one that shows you what it will
   * do while you do it.
   *
   * `view.armed` survives as "last site touched": battle-orders.js `setRally`
   * falls back to it and battle-hud.js uses it as the preview's implied origin.
   */
  function tap(hit) {
    const now = performance.now();

    // An armed booster consumes the next click wherever it lands: on a site it
    // fires there, on empty board it cancels — the same shape as Esc.
    if (view.armedBooster) {
      if (hit) ord.fireBooster(hit.id);
      else ord.cancelBooster();
      return;
    }

    if (!hit) {
      // Nothing under the pointer: an in-flight squad is the next best thing to
      // hit, which is the only way to reach RETREAT_SQUAD.
      const sq = ord.squadAt(getState(), w.x, w.y);
      view.armed = null;
      if (sq) ord.selectSquad(sq);
      else ord.selectOnly(null);
      return;
    }

    if (hit.id === lastTapId && now - lastTapAt < DOUBLE_TAP_MS && hit.owner === 'player') {
      ord.selectFront(hit.id);
      lastTapAt = 0;
      return;
    }
    lastTapId = hit.id;
    lastTapAt = now;

    view.armed = hit.owner === 'player' ? hit.id : null;
    ord.selectOnly(hit.id);
  }

  function spread() {
    const [a, b] = pointers.values();
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  function onWheel(ev) {
    ev.preventDefault();
    board.pointer(ev, s);
    cam.zoomAt(s.x, s.y, ev.deltaY < 0 ? 1.12 : 1 / 1.12);
    board.releaseAutoFit();
    board.markBgDirty();
  }

  const { onKey, onKeyUp } = createHotkeys({
    view, ord, bus, clearDrag, cancelGestures: () => { rally = null; press = null; },
  });

  off.listen(canvas, 'pointerdown', onDown);
  off.listen(canvas, 'pointermove', onMove);
  off.listen(canvas, 'pointerup', onUp);
  off.listen(canvas, 'pointercancel', (ev) => { pointers.delete(ev.pointerId); clearDrag(); press = null; rally = null; panning = pointers.size > 0; });
  off.listen(canvas, 'contextmenu', (ev) => ev.preventDefault());
  off.listen(canvas, 'wheel', onWheel, { passive: false });
  off.listen(window, 'keydown', onKey);
  off.listen(window, 'keyup', onKeyUp);

  return {
    view,
    /** Exposed so HUD chips route through exactly the same code as the keys. */
    setFraction(f) { view.fraction = f; bus?.emit('ui:fraction', f); },
    toggleFilter(u) { view.filter[u] = !view.filter[u]; bus?.emit('ui:filter', view.filter); },
    /** Arms a targeted booster (rally / bombard / fortify) so the next site
     *  click fires it there; fires an untargeted one (march / tithe) at once. */
    useBooster: ord.armBooster,
    cancelBooster: ord.cancelBooster,
    /** Fire the armed booster at a site — the click path, exposed for tests. */
    fireBooster: ord.fireBooster,
    setTrain(siteId, unit) { ord.push(cmd.train(siteId, unit)); },
    recruit(siteId, unit) { ord.push(cmd.recruit(siteId, unit)); },
    /** Per-site rally hold-back, from the site panel's stepper. */
    setRallyKeep(siteId, keep) { return ord.issueRallyKeep(siteId, keep); },
    upgrade(siteId) { ord.push(cmd.upgrade(siteId)); },
    retreat: ord.retreatSelection,
    retreatSquad(id) {
      if (id == null) return ord.retreatSelectedSquad();
      ord.push(cmd.retreatSquad(id));
      return true;
    },
    /** Leaves the region unconquered (design section 9). Deliberately NOT bound
     *  to a key: Esc deselects, and ending a battle on a stray keypress is the
     *  kind of thing you only regret once. The HUD's confirm-style Withdraw
     *  button (battle-panel.js) is the only caller. */
    withdraw() { ord.push(cmd.withdraw()); },
    dispose: off.dispose,
  };
}
