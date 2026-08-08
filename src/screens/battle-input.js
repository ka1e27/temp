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
import { SEND_FRACTIONS } from '../content/balance.js';
import { createDisposer } from '../ui/dom.js';
import { BOOSTER_BY_KEY, FILTER_BY_KEY, SPEED_KEYS } from './battle-keys.js';
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
        // Snapped target may BE the source — that is how you clear a rally, so
        // it is kept rather than nulled, and the renderer says so.
        const t = from ? ord.snapTarget(from, w.x, w.y) : null;
        view.rallyTo = t ? t.id : null;
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
      const t = from ? ord.snapTarget(from, w.x, w.y) : null;
      view.dragTo = t && t.id !== from.id ? t.id : null;
    } else if (view.box) {
      view.box.x1 = w.x;
      view.box.y1 = w.y;
    }
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
        if (from && to) ord.issueRally(from, to);
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
      if (to && to.id !== from.id) ord.issueSend(from, to);
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

  /** Click-then-click runs through the SAME issueSend path as the drag, so the
   *  two input styles can never disagree about what is legal. */
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

    const armed = view.armed ? ord.site(view.armed) : null;
    if (armed && armed.id !== hit.id && ord.issueSend(armed, hit)) {
      view.armed = null;
      return;
    }
    view.armed = hit.owner === 'player' ? hit.id : null;
    ord.selectOnly(hit.id);
  }

  function spread() {
    const [a, b] = pointers.values();
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  // ---- keyboard -----------------------------------------------------------

  function onKey(ev) {
    if (ev.target !== document.body && ev.target?.tagName === 'INPUT') return;
    const k = ev.key.toLowerCase();

    const n = Number(k);
    if (Number.isInteger(n) && n >= 1 && n <= SEND_FRACTIONS.length) {
      view.fraction = SEND_FRACTIONS[n - 1];
      bus?.emit('ui:fraction', view.fraction);
      return;
    }
    // Esc unwinds one step at a time: the aiming reticle first, then selection.
    if (k === 'escape') {
      if (ord.cancelBooster()) return;
      view.armed = null;
      ord.selectOnly(null);
      clearDrag();
      rally = null;
      return;
    }

    // `R` is documented twice in the design — as retreat and as the rams
    // filter. Resolved by context, which is unambiguous in practice: retreat
    // needs something selected, and you set filters when nothing is.
    // Shift+R always means the filter.
    if (k === 'r' && !ev.shiftKey) {
      if (ord.retreatSelectedSquad()) return;
      if (view.selection.length) { ord.retreatSelection(); return; }
    }
    if (FILTER_BY_KEY[k]) {
      const u = FILTER_BY_KEY[k];
      view.filter[u] = !view.filter[u];
      bus?.emit('ui:filter', view.filter);
      return;
    }
    if (BOOSTER_BY_KEY[k]) { ord.armBooster(BOOSTER_BY_KEY[k]); return; }
    if (SPEED_KEYS[k] !== undefined) { bus?.emit('ui:speed-step', SPEED_KEYS[k]); return; }
    // Slow-mo is HELD, not toggled, so keyup has to be heard for it to end.
    if (k === ' ') { ev.preventDefault(); if (!ev.repeat) bus?.emit('ui:slowmo'); return; }
    if (k === 'p') { bus?.emit('ui:pause'); }
  }

  function onKeyUp(ev) {
    if (ev.key === ' ') bus?.emit('ui:slowmo-end');
  }

  function onWheel(ev) {
    ev.preventDefault();
    board.pointer(ev, s);
    cam.zoomAt(s.x, s.y, ev.deltaY < 0 ? 1.12 : 1 / 1.12);
    board.releaseAutoFit();
    board.markBgDirty();
  }

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
