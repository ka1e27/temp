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
// The drag trail is accumulated HERE and trimmed in battle-orders.js — one
// rule, in ./battle-waypoints.js, so the two halves cannot drift. The route
// preview itself — one path for an ordinary drag, one per source for a
// concentrated one — is computed there too, by `updateDragPreview`.
import { updateDragPreview, dragSourcesFor } from './battle-waypoints.js';
// A camped force's position, read the same way every other consumer reads it:
// squads store no coordinate, so `squadHexOf` derives one from the path and the
// tick. Two copies of that derivation disagree about exactly which tick a
// column appears on, which is a bug nobody can reproduce from a report.
import { squadHexOf } from '../battle/movement.js';
import { resolveDrag, campedAt } from './battle-drag.js';

export { cmd, filterList } from './battle-orders.js';
export { createView } from './battle-view.js';

const TAP_SLOP = 6;       // CSS px of travel still counted as a tap
const TWO_FINGER_MS = 260;
const DOUBLE_TAP_MS = 320;

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
    view.dragFromSquad = null;
    view.dragTo = null;
    // The road drawn by the gesture, hex by hex. Emptied in place rather than
    // reassigned: the renderer holds this array to draw the route as it is
    // being drawn, and swapping it would leave the board pointing at the old one.
    view.dragTrail.length = 0;
    view.dragPath = null;
    view.dragPathKey = '';
    view.dragSources = null;
    view.dragPaths = null;
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
    // `view.rallyMode` routes a PLAIN drag down this exact path, so the mode
    // gets the toggle for free rather than reimplementing it.
    // An armed booster still wins: aiming is a one-shot and outranks a mode.
    if (ev.button === 2 || (view.rallyMode && !view.armedBooster && !view.armedBuild)) {
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

    // While a booster OR a build is armed the press means "aim here" and
    // nothing else: no drag order, no box select. The release resolves it.
    if (view.armedBooster || view.armedBuild) return;

    // TROOPS ON A TILE DRAG LIKE TROOPS IN A BUILDING — the gesture that was
    // missing, for a `MOVE_SQUAD` verb the engine had all along.
    //
    // PRECISION BEATS FORGIVENESS, which is the whole precedence rule. `siteAt`
    // carries 1.25 hexes of slop ON PURPOSE so a fingertip near a building still
    // lands on it; `squadAt` is deliberately tight, because a stray click near a
    // column must be able to mean "deselect". So a press that hits an army has
    // genuinely hit it, while one that hits a building may only have been
    // forgiven — a camped force wins over a site the pointer merely landed NEAR,
    // and loses to one it is actually on (`siteAt` with the slop off). Without
    // it, troops parked within a hex or so of your own farm could not be dragged
    // at all: the farm would swallow the press and issue a SEND. Reasoned, not
    // observed — the smoke failure that prompted the look turned out to be a
    // flaky fixture, and the board had no site near the army at all.
    const camped = campedAt(ord, getState(), w.x, w.y);
    const onBuilding = camped ? board.siteAt(getState(), w.x, w.y, 1) : null;
    if (camped && !onBuilding) {
      view.dragFromSquad = camped.id;
      view.dragTo = null;
      canvas.classList.add('is-dragging');
    } else if (hit && hit.owner === 'player') {
      view.dragFrom = hit.id;
      view.dragTo = null;
      // CONCENTRATING FORCE: a drag off an already-selected site commits the
      // whole selection — see battle-waypoints.js `dragSourcesFor`.
      view.dragSources = dragSourcesFor(ord, view, hit.id);
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
          // Snapped target may BE the source — that is how you clear a rally, so
          // it is kept rather than nulled, and the renderer says so.
          const t = ord.snapTarget(from, w.x, w.y);
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

    if (view.dragFromSquad != null) {
      // The camped force draws its road exactly as a building does. It is
      // handed a `{hex}` stand-in rather than a site because that is all
      // `updateDragPreview` ever reads of a source — the same reason
      // `siteScreen` projects a bare hex through the camera the sites use.
      const st = getState();
      const sq = st.squads.find((x) => x.id === view.dragFromSquad);
      const at = sq && squadHexOf(st, sq);
      if (at) updateDragPreview(getState(), ord, view, { hex: [at.q, at.r] }, w.x, w.y, board.hexSize);
    } else if (view.dragFrom) {
      const from = ord.site(view.dragFrom);
      // THE ROAD THE PLAYER IS DRAWING, and the route(s) it previews — one for
      // an ordinary drag, one per source for a concentrated one. Both live in
      // battle-waypoints.js now: it already owned the trail-trimming half of
      // this rule, and the preview half is the same "recompute only when a
      // new hex is crossed or the snap flips" throttle either way.
      if (from) updateDragPreview(getState(), ord, view, from, w.x, w.y, board.hexSize);
    } else if (view.box) {
      view.box.x1 = w.x;
      view.box.y1 = w.y;
    }
  }

  // growChain/chainFor used to track which sites a drag routed THROUGH, so one
  // gesture could express several adjacent hops. Free movement means a send is
  // legal wherever a path exists, so a drag is just "picked up here, released
  // there" now — the pathfinder walks whatever ground is in between on its own.

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
        // Toggle, not set: one link has three states (off, this way, that
        // way) and the drag cycles them, so undoing never needs a second
        // gesture. See battle-orders.js toggleRally.
        if (from && to) ord.toggleRally(from, to);
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
    // Which of the four march orders a completed drag meant lives in
    // ./battle-drag.js — one function, so a camped force and a garrison
    // cannot drift into two different answers to the same gesture.
    if (press.moved && resolveDrag(ord, view, getState())) {
      clearDrag();
      press = null;
      return;
    }
    if (view.box && press.moved) {
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
    // A build targets a HEX, not a site, so it resolves off the world point
    // (`w`, the same one screenToWorld just wrote) rather than off `hit` —
    // the whole point of building is raising one on ground nothing occupies.
    if (view.armedBuild) { ord.fireBuild(w.x, w.y); return; }

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
    view, ord, bus, getState, clearDrag, cancelGestures: () => { rally = null; press = null; },
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
    /** Switch what a plain drag means. Turning it on cancels an armed booster:
     *  the two are both "the next gesture means something else" and having both
     *  live at once is how a player ends up firing a bombard at their own camp. */
    setRallyMode(on) {
      view.rallyMode = !!on;
      if (view.rallyMode) ord.cancelBooster?.();
      bus?.emit('ui:rally-mode', view.rallyMode);
    },
    toggleFilter(u) { view.filter[u] = !view.filter[u]; bus?.emit('ui:filter', view.filter); },
    /** Arms a targeted booster (rally / bombard / fortify) so the next site
     *  click fires it there; fires an untargeted one (march / tithe) at once. */
    useBooster: ord.armBooster,
    cancelBooster: ord.cancelBooster,
    /** Fire the armed booster at a site — the click path, exposed for tests. */
    fireBooster: ord.fireBooster,
    /** Arms a buildable kind so the next board click resolves a hex and
     *  raises it there; pressing the same kind again or Esc cancels. */
    useBuild: ord.armBuild,
    cancelBuild: ord.cancelBuild,
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
