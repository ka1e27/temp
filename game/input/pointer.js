// Pointer/wheel/keyboard -> high-level map intents (mouse + touch + pen).
//
// Browser-only (Pointer Events, canvas, window) — unlike camera.js this file
// is not required to be pure, but the tricky little bits of MATH inside it
// (wheel-delta normalisation, the tap/drag threshold, fling velocity from a
// move history, pinch midpoint/spread) are pulled out as small exported pure
// functions so they can still be unit-tested from plain Node
// (see game/tests/input.test.js) instead of only through a real DOM.
//
// Drag protocol (see docs handed down from the integrator):
//   pointerdown -> handlers.canStartDrag(wx, wy, info) -> 'send'|'lasso'|'pan'
//   once movement crosses the tap/drag threshold:
//     onDragStart(kind, sx, sy, wx, wy)   -- sx/sy/wx/wy of the ORIGINAL down point
//     onDragMove(kind, sx, sy, wx, wy)    -- repeated, current point
//     onDragEnd(kind, sx, sy, wx, wy, { cancelled })
//   for kind 'pan', THIS FILE drives the camera (panBy while dragging, fling
//   on release with the measured velocity) — the integrator still gets the
//   onDragStart/Move/End('pan', ...) calls too, purely as notifications.
//   Released before crossing the threshold (and no long-press fired) -> onTap.

export const LONG_PRESS_MS = 450;
const WHEEL_ZOOM_SPEED = 0.0015;
const VELOCITY_WINDOW_MS = 120;
const VELOCITY_MAX_SAMPLES = 8;

// ---------------------------------------------------------------------------
// Pure helpers (exported for direct unit testing).
// ---------------------------------------------------------------------------

/** 6px for a precise mouse, 10px for an imprecise finger/pen contact. */
export function tapThreshold(pointerType) {
  return pointerType === 'mouse' ? 6 : 10;
}

/** WheelEvent.deltaMode: 0=pixel, 1=line, 2=page. Normalise to pixel-ish units. */
export function normalizeWheelDelta(deltaX, deltaY, deltaMode) {
  const scale = deltaMode === 1 ? 16 : deltaMode === 2 ? 800 : 1;
  return { dx: deltaX * scale, dy: deltaY * scale };
}

/** Smooth zoom factor for a normalised wheel deltaY (scroll up -> zoom in). */
export function wheelZoomFactor(dy, speed = WHEEL_ZOOM_SPEED) {
  return Math.exp(-dy * speed);
}

export function pinchMidpoint(ax, ay, bx, by) {
  return { x: (ax + bx) / 2, y: (ay + by) / 2 };
}

export function pinchSpread(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

/** Screen px/s velocity from a short history of {t (ms), sx, sy} samples,
 *  oldest first — used to hand `fling` a real release velocity. */
export function velocityFromSamples(samples) {
  if (!samples || samples.length < 2) return { vx: 0, vy: 0 };
  const first = samples[0];
  const last = samples[samples.length - 1];
  const dtSec = (last.t - first.t) / 1000;
  if (!(dtSec > 0)) return { vx: 0, vy: 0 };
  return { vx: (last.sx - first.sx) / dtSec, vy: (last.sy - first.sy) / dtSec };
}

// ---------------------------------------------------------------------------
// createInput
// ---------------------------------------------------------------------------

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} camera a camera created by game/render/camera.js
 * @param {object} handlers see the file header for the full contract; every
 *   handler is optional except that a missing `canStartDrag` defaults every
 *   drag to 'pan'.
 * @returns {{ setEnabled(enabled: boolean): void, destroy(): void }}
 */
export function createInput(canvas, camera, handlers = {}) {
  let enabled = true;
  /** @type {Map<number, object>} pointerId -> tracked pointer state */
  const active = new Map();
  let drag = null; // { kind: 'send'|'lasso'|'pan', ids: [pointerId, ...] }
  let pinch = null; // { spread, midSx, midSy } while drag.ids.length === 2
  let panRef = null; // { sx, sy } while drag.kind === 'pan' && ids.length === 1
  let vHist = [];

  canvas.style.touchAction = 'none';

  const getPos = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { sx: event.clientX - rect.left, sy: event.clientY - rect.top };
  };

  const clearLongPress = (s) => {
    if (s.longPressTimer != null) {
      clearTimeout(s.longPressTimer);
      s.longPressTimer = null;
    }
  };

  const endDragKind = (kind, sx, sy, cancelled) => {
    const w = camera.screenToWorld(sx, sy);
    handlers.onDragEnd?.(kind, sx, sy, w.x, w.y, { cancelled });
  };

  /** Right-click / Escape / setEnabled(false): abort whatever is in progress. */
  const cancelActiveDrag = () => {
    if (!drag) return;
    const owner = active.get(drag.ids[0]);
    endDragKind(drag.kind, owner ? owner.sx : 0, owner ? owner.sy : 0, true);
    drag = null;
    pinch = null;
    vHist = [];
  };

  function findOtherTouch(excludeId) {
    if (drag && drag.ids.length >= 2) return null; // already a full pinch
    for (const [id, s] of active) {
      if (id !== excludeId && s.pointerType === 'touch') return id;
    }
    return null;
  }

  /** Two touches down at once are always a pinch/two-finger-pan, full stop —
   *  it overrides whatever the first finger's own drag kind was. */
  function beginPinch(idA, idB) {
    const a = active.get(idA);
    const b = active.get(idB);
    if (!a || !b) return;
    clearLongPress(a);
    clearLongPress(b);
    const hadPan = !!(drag && drag.kind === 'pan');
    if (drag && !hadPan) endDragKind(drag.kind, a.sx, a.sy, true);
    a.moved = true;
    b.moved = true;
    drag = { kind: 'pan', ids: [idA, idB] };
    const mid = pinchMidpoint(a.sx, a.sy, b.sx, b.sy);
    pinch = { spread: pinchSpread(a.sx, a.sy, b.sx, b.sy), midSx: mid.x, midSy: mid.y };
    vHist = [];
    if (!hadPan) {
      const w = camera.screenToWorld(mid.x, mid.y);
      handlers.onDragStart?.('pan', mid.x, mid.y, w.x, w.y);
    }
  }

  function updateSinglePan(sx, sy, timeStamp) {
    camera.panBy(sx - panRef.sx, sy - panRef.sy);
    panRef = { sx, sy };
    vHist.push({ t: timeStamp, sx, sy });
    while (vHist.length > 1 && vHist[0].t < timeStamp - VELOCITY_WINDOW_MS) vHist.shift();
    if (vHist.length > VELOCITY_MAX_SAMPLES) vHist.shift();
    const w = camera.screenToWorld(sx, sy);
    handlers.onDragMove?.('pan', sx, sy, w.x, w.y);
  }

  function updatePinch() {
    const [idA, idB] = drag.ids;
    const a = active.get(idA);
    const b = active.get(idB);
    if (!a || !b || !pinch) return;
    const mid = pinchMidpoint(a.sx, a.sy, b.sx, b.sy);
    const spread = pinchSpread(a.sx, a.sy, b.sx, b.sy);
    const factor = pinch.spread > 0 ? spread / pinch.spread : 1;
    if (Number.isFinite(factor) && factor > 0) camera.zoomAt(factor, mid.x, mid.y);
    camera.panBy(mid.x - pinch.midSx, mid.y - pinch.midSy);
    pinch = { spread, midSx: mid.x, midSy: mid.y };
    const w = camera.screenToWorld(mid.x, mid.y);
    handlers.onDragMove?.('pan', mid.x, mid.y, w.x, w.y);
  }

  /** Movement just crossed the tap/drag threshold: commit to the drag kind
   *  decided back at pointerdown and fire the start (+ an immediate move so
   *  the integrator isn't stuck rendering the stale down-point). */
  function promote(id, s, timeStamp) {
    s.moved = true;
    clearLongPress(s);
    const kind = s.candidateKind;
    const w0 = camera.screenToWorld(s.startSx, s.startSy);
    drag = { kind, ids: [id] };
    handlers.onDragStart?.(kind, s.startSx, s.startSy, w0.x, w0.y);
    if (kind === 'pan') {
      panRef = { sx: s.startSx, sy: s.startSy };
      vHist = [];
      updateSinglePan(s.sx, s.sy, timeStamp);
    } else {
      handlers.onDragMove?.(kind, s.sx, s.sy, s.wx, s.wy);
    }
  }

  function onPointerDown(event) {
    if (!enabled) return;
    if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 2) return;
    const { sx, sy } = getPos(event);

    if (event.button === 2) {
      cancelActiveDrag();
      handlers.onCancel?.();
      return;
    }

    canvas.setPointerCapture?.(event.pointerId);
    camera.fling(0, 0); // any fresh contact stops residual glide + any auto-flight

    const w = camera.screenToWorld(sx, sy);
    const info = {
      pointerType: event.pointerType,
      button: event.button,
      shift: event.shiftKey,
      ctrl: event.ctrlKey,
      alt: event.altKey,
    };
    const state = {
      pointerType: event.pointerType,
      button: event.button,
      info,
      startSx: sx, startSy: sy, startWx: w.x, startWy: w.y,
      sx, sy, wx: w.x, wy: w.y,
      moved: false,
      longPressFired: false,
      longPressTimer: null,
      candidateKind: (handlers.canStartDrag?.(w.x, w.y, info)) || 'pan',
    };
    active.set(event.pointerId, state);

    const otherTouchId = event.pointerType === 'touch' ? findOtherTouch(event.pointerId) : null;
    if (otherTouchId != null) {
      beginPinch(otherTouchId, event.pointerId);
    } else if (event.pointerType !== 'mouse') {
      state.longPressTimer = setTimeout(() => {
        if (state.moved || (drag && drag.ids.includes(event.pointerId))) return;
        state.longPressFired = true;
        handlers.onLongPress?.(state.sx, state.sy, state.wx, state.wy, { pointerType: state.pointerType });
      }, LONG_PRESS_MS);
    }
  }

  function onPointerMove(event) {
    if (!enabled) return;
    const { sx, sy } = getPos(event);
    const s = active.get(event.pointerId);

    if (!s) {
      if (event.pointerType === 'mouse') {
        const w = camera.screenToWorld(sx, sy);
        handlers.onHover?.(sx, sy, w.x, w.y);
      }
      return;
    }

    const w = camera.screenToWorld(sx, sy);
    s.sx = sx; s.sy = sy; s.wx = w.x; s.wy = w.y;

    if (drag && drag.ids.includes(event.pointerId)) {
      if (drag.kind === 'pan' && drag.ids.length === 2) updatePinch();
      else if (drag.kind === 'pan') updateSinglePan(sx, sy, event.timeStamp);
      else handlers.onDragMove?.(drag.kind, sx, sy, w.x, w.y);
      return;
    }

    if (!s.moved) {
      const d = Math.hypot(sx - s.startSx, sy - s.startSy);
      if (d >= tapThreshold(s.pointerType)) promote(event.pointerId, s, event.timeStamp);
    }
  }

  function onPointerUp(event) {
    const s = active.get(event.pointerId);
    if (!s) return;
    const cancelled = event.type === 'pointercancel';
    clearLongPress(s);
    active.delete(event.pointerId);

    if (drag && drag.ids.includes(event.pointerId)) {
      if (drag.ids.length === 2) {
        // one finger of a pinch lifted: fall back to plain single-finger pan
        // using the survivor's CURRENT point, so the next move is a small
        // delta rather than a jump from the old two-finger midpoint.
        const remainId = drag.ids.find((id) => id !== event.pointerId);
        const r = active.get(remainId);
        drag.ids = [remainId];
        pinch = null;
        vHist = [];
        if (r) panRef = { sx: r.sx, sy: r.sy };
        return;
      }
      const kind = drag.kind;
      const v = kind === 'pan' ? velocityFromSamples(vHist) : null;
      endDragKind(kind, s.sx, s.sy, cancelled);
      if (kind === 'pan' && !cancelled) camera.fling(v.vx, v.vy);
      drag = null;
      pinch = null;
      vHist = [];
      return;
    }

    if (!cancelled && !s.longPressFired) {
      handlers.onTap?.(s.sx, s.sy, s.wx, s.wy, {
        button: s.button, shift: s.info.shift, pointerType: s.pointerType,
      });
    }
  }

  function onWheel(event) {
    if (!enabled) return;
    event.preventDefault();
    const { sx, sy } = getPos(event);
    const { dy } = normalizeWheelDelta(event.deltaX, event.deltaY, event.deltaMode);
    camera.zoomAt(wheelZoomFactor(dy), sx, sy);
  }

  function onContextMenu(event) {
    event.preventDefault();
  }

  function onKeyDown(event) {
    if (!enabled) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (event.key === 'Escape') {
      cancelActiveDrag();
      handlers.onCancel?.();
      return;
    }
    handlers.onKey?.(event.key, event);
  }

  function setEnabled(value) {
    value = !!value;
    if (enabled === value) return;
    enabled = value;
    if (!value) {
      cancelActiveDrag();
      for (const s of active.values()) clearLongPress(s);
      active.clear();
    }
  }

  function destroy() {
    setEnabled(false);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('keydown', onKeyDown);
    canvas.style.touchAction = '';
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);

  return { setEnabled, destroy };
}
