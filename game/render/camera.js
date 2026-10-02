// World-map camera: screen<->world conversion, clamped pan/zoom, animated
// flights and pointer-driven inertia.
//
// PURE MATH, NO DOM. Every time-based feature (flyTo, fling, screen shake,
// rubber-band settle) is advanced only by an externally driven `update(dt)` —
// this file never reads a clock itself (no `performance.now`, `Date.now`,
// `requestAnimationFrame`). That is what lets game/tests/camera.test.js drive
// it deterministically from plain Node with synthetic dt values.
//
// World units follow docs/ARCHITECTURE.md §3: pointy-top axial hexes, hex
// size 1 (centre-to-corner = 1 world unit). `zoom` is CSS px per world unit.

const clamp = (v, lo, hi) => (lo <= hi ? Math.min(hi, Math.max(lo, v)) : (lo + hi) / 2);
const lerp = (a, b, t) => a + (b - a) * t;

/** Named easings for `flyTo`. Unknown names fall back to `inOutCubic`. */
const EASES = {
  linear: (t) => t,
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - (1 - t) ** 3,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
};

// Rubber-band feel at pan-clamp edges: how far (CSS px, independent of zoom)
// the centre may be dragged past the hard bound, and how fast it eases back.
const OVERSCROLL_PX = 60;
const SETTLE_RATE = 10; // 1/s
const SETTLE_SNAP = 1e-4; // world units; below this, snap exactly to the edge

// Inertia (`fling`) friction, screen px/s decay rate, per the spec ("~4/s").
const FLING_FRICTION = 4;
const FLING_STOP_EPS2 = 0.01; // (px/s)^2 below which inertia is considered stopped

// Deterministic (non-random) screen-shake trauma decay.
const SHAKE_DECAY = 2.5; // 1/s
const SHAKE_MAX_PX = 14;

/**
 * @typedef {{minX:number, minY:number, maxX:number, maxY:number}} Bounds
 * @typedef {{x:number, y:number}} Point
 */

/**
 * Move `pos` by `delta`, softly resisting travel beyond [lo, hi] so a drag
 * past the map edge feels like rubber rather than hitting a wall. Bounded: no
 * matter how large `delta` is, the result never exceeds `over` past the edge.
 */
function moveAxisSoft(pos, delta, lo, hi, over) {
  if (lo > hi) return (lo + hi) / 2; // degenerate bounds: collapse to centre
  let next = pos + delta;
  if (next >= lo && next <= hi) return next;
  if (over <= 0) return clamp(next, lo, hi);
  const edge = next > hi ? hi : lo;
  const existingOver = pos > hi ? pos - hi : pos < lo ? lo - pos : 0;
  const resistance = Math.max(0, 1 - existingOver / over);
  next = pos + delta * resistance;
  if (next > hi) next = Math.min(next, hi + over);
  if (next < lo) next = Math.max(next, lo - over);
  return next;
}

/** Ease any current overshoot past [lo, hi] back toward the edge. */
function settleAxis(pos, lo, hi, dt) {
  if (lo > hi) return pos;
  if (pos > hi) {
    const over = (pos - hi) * Math.exp(-SETTLE_RATE * dt);
    return over < SETTLE_SNAP ? hi : hi + over;
  }
  if (pos < lo) {
    const over = (lo - pos) * Math.exp(-SETTLE_RATE * dt);
    return over < SETTLE_SNAP ? lo : lo - over;
  }
  return pos;
}

/**
 * @param {{minZoom?: number, maxZoom?: number}} [opts]
 */
export function createCamera({ minZoom = 0.01, maxZoom = 1000 } = {}) {
  const cam = {
    instant: false, // Reduce Motion: flyTo cuts instead of flying (set by main.js)
    // --- state -------------------------------------------------------
    x: 0,
    y: 0,
    zoom: 1,
    viewW: 300,
    viewH: 150,
    shakeX: 0,
    shakeY: 0,

    // --- internal (still plain data; no closures so tests/integrators
    // can introspect if they really need to) ---------------------------
    _minZoom: minZoom,
    _maxZoom: maxZoom,
    _bounds: null,
    _boundsPadding: 0,
    _flight: null, // { from:{x,y,zoom}, to:{x,y,zoom}, ms, elapsed, easeName, resolve }
    _vx: 0,
    _vy: 0, // fling inertia, screen px/s
    _trauma: 0,
    _shakeT: 0,

    resize(w, h) {
      cam.viewW = w;
      cam.viewH = h;
    },

    worldToScreen(wx, wy) {
      return {
        x: cam.viewW / 2 + (wx - cam.x) * cam.zoom,
        y: cam.viewH / 2 + (wy - cam.y) * cam.zoom,
      };
    },

    screenToWorld(sx, sy) {
      return {
        x: cam.x + (sx - cam.viewW / 2) / cam.zoom,
        y: cam.y + (sy - cam.viewH / 2) / cam.zoom,
      };
    },

    visibleBounds(margin = 0) {
      const halfW = cam.viewW / 2 / cam.zoom;
      const halfH = cam.viewH / 2 / cam.zoom;
      return {
        minX: cam.x - halfW - margin,
        minY: cam.y - halfH - margin,
        maxX: cam.x + halfW + margin,
        maxY: cam.y + halfH + margin,
      };
    },

    /** Move the centre by a SCREEN-space delta (e.g. a pointer drag delta). */
    panBy(dxScreen, dyScreen) {
      cam._cancelFlight({ cancelled: true });
      cam._vx = 0;
      cam._vy = 0;
      cam._moveBy(-dxScreen / cam.zoom, -dyScreen / cam.zoom);
    },

    /** Multiply zoom by `factor`, keeping the world point under (sx,sy) fixed. */
    zoomAt(factor, sx, sy) {
      cam._cancelFlight({ cancelled: true });
      if (!Number.isFinite(factor) || factor <= 0) return;
      const before = cam.screenToWorld(sx, sy);
      const newZoom = clamp(cam.zoom * factor, cam._minZoom, cam._maxZoom);
      if (newZoom === cam.zoom) return;
      cam.zoom = newZoom;
      const targetX = before.x - (sx - cam.viewW / 2) / newZoom;
      const targetY = before.y - (sy - cam.viewH / 2) / newZoom;
      cam._moveBy(targetX - cam.x, targetY - cam.y);
    },

    /**
     * Pan clamp: the centre may not leave `bounds` (expanded outward by
     * `padding` world units on every side). Soft rubber-band lets it travel a
     * little further under active panning/inertia, easing back in `update`.
     * @param {Bounds|null} bounds pass null/undefined to clear clamping
     */
    setBounds(bounds, padding = 0) {
      cam._bounds = bounds ? { ...bounds } : null;
      cam._boundsPadding = padding;
    },

    setZoomLimits(min, max) {
      cam._minZoom = min;
      cam._maxZoom = max;
      cam.zoom = clamp(cam.zoom, min, max);
    },

    /** The zoom (CSS px / world unit) that fits `bounds` in the viewport,
     *  leaving `padding` CSS px of margin on every side. Pure; no side effect. */
    fitZoom(bounds, padding = 0) {
      const w = Math.max(1e-6, bounds.maxX - bounds.minX);
      const h = Math.max(1e-6, bounds.maxY - bounds.minY);
      const availW = Math.max(1, cam.viewW - 2 * padding);
      const availH = Math.max(1, cam.viewH - 2 * padding);
      return clamp(Math.min(availW / w, availH / h), cam._minZoom, cam._maxZoom);
    },

    /**
     * Animate to a point/zoom, or fit a bounds rect (via `fitZoom`).
     * Zoom is interpolated in log space so a large zoom change doesn't lurch.
     * Any pan/zoom/fling cancels an in-flight flyTo; a new flyTo cancels the
     * previous one. Resolves `{cancelled}` — cancelled ones resolve too, they
     * never reject, so `await`ing a flight never needs a try/catch just
     * because the user grabbed the map mid-flight.
     * @param {{x?:number,y?:number,zoom?:number}|{bounds:Bounds,padding?:number}} target
     * @returns {Promise<{cancelled:boolean}>}
     */
    flyTo(target, ms = 900, ease = 'inOutCubic') {
      if (cam.instant) ms = 1; // Reduce Motion: every flight is a cut
      cam._cancelFlight({ cancelled: true });
      cam._vx = 0;
      cam._vy = 0;
      const from = { x: cam.x, y: cam.y, zoom: cam.zoom };
      let to;
      if (target && target.bounds) {
        const b = target.bounds;
        to = {
          x: (b.minX + b.maxX) / 2,
          y: (b.minY + b.maxY) / 2,
          zoom: cam.fitZoom(b, target.padding || 0),
        };
      } else {
        to = {
          x: target?.x ?? cam.x,
          y: target?.y ?? cam.y,
          zoom: target?.zoom ?? cam.zoom,
        };
      }
      to.zoom = clamp(to.zoom, cam._minZoom, cam._maxZoom);
      return new Promise((resolve) => {
        cam._flight = { from, to, ms: Math.max(1, ms), elapsed: 0, easeName: ease, resolve };
      });
    },

    /** Convenience: fly straight to a bounds rect's fit (see `flyTo`). */
    fitTo(bounds, padding = 0, ms = 900, ease = 'inOutCubic') {
      return cam.flyTo({ bounds, padding }, ms, ease);
    },

    cancelFlight() {
      cam._cancelFlight({ cancelled: true });
    },

    _cancelFlight(result) {
      const f = cam._flight;
      if (f) {
        cam._flight = null;
        f.resolve(result);
      }
    },

    /** Begin inertial panning at (vx,vy) screen px/s; decays with `update`.
     *  A fresh touch/drag should call `fling(0, 0)` to stop any residual glide. */
    fling(vx, vy) {
      cam._cancelFlight({ cancelled: true });
      cam._vx = vx;
      cam._vy = vy;
    },

    /** Deterministic screen-shake impulse (no RNG, so it stays test-friendly).
     *  `strength` is trauma added in [0,1]; decays via `update`. The renderer
     *  reads `shakeX`/`shakeY` and adds them at draw time — they are NOT
     *  baked into worldToScreen, so hit-testing never jitters. */
    shake(strength = 1) {
      cam._trauma = clamp(cam._trauma + strength, 0, 1);
    },

    /** True while a flight is animating or inertia hasn't settled. */
    isMoving() {
      return !!cam._flight || cam._vx * cam._vx + cam._vy * cam._vy > FLING_STOP_EPS2;
    },

    /** Advance flights / inertia / rubber-band settle / shake decay by dt seconds. */
    update(dt) {
      dt = Math.max(0, dt);
      if (cam._flight) {
        const f = cam._flight;
        f.elapsed += dt * 1000;
        const t = Math.min(1, f.elapsed / f.ms);
        const k = (EASES[f.easeName] || EASES.inOutCubic)(t);
        cam.x = lerp(f.from.x, f.to.x, k);
        cam.y = lerp(f.from.y, f.to.y, k);
        cam.zoom = Math.exp(lerp(Math.log(f.from.zoom), Math.log(f.to.zoom), k));
        if (t >= 1) {
          cam.x = f.to.x;
          cam.y = f.to.y;
          cam.zoom = f.to.zoom;
          cam._flight = null;
          f.resolve({ cancelled: false });
        }
        cam._updateShake(dt);
        return; // a directed flight owns the camera; skip inertia/settle
      }
      if (cam._vx * cam._vx + cam._vy * cam._vy > FLING_STOP_EPS2) {
        cam._moveBy(-cam._vx * dt / cam.zoom, -cam._vy * dt / cam.zoom);
        const decay = Math.exp(-FLING_FRICTION * dt);
        cam._vx *= decay;
        cam._vy *= decay;
      } else {
        cam._vx = 0;
        cam._vy = 0;
      }
      cam._settleBounds(dt);
      cam._updateShake(dt);
    },

    // --- internal helpers ----------------------------------------------
    _moveBy(dxWorld, dyWorld) {
      if (cam._bounds) {
        const { minX, minY, maxX, maxY } = cam._bounds;
        const pad = cam._boundsPadding || 0;
        const over = OVERSCROLL_PX / cam.zoom;
        cam.x = moveAxisSoft(cam.x, dxWorld, minX - pad, maxX + pad, over);
        cam.y = moveAxisSoft(cam.y, dyWorld, minY - pad, maxY + pad, over);
      } else {
        cam.x += dxWorld;
        cam.y += dyWorld;
      }
    },

    _settleBounds(dt) {
      if (!cam._bounds) return;
      const { minX, minY, maxX, maxY } = cam._bounds;
      const pad = cam._boundsPadding || 0;
      cam.x = settleAxis(cam.x, minX - pad, maxX + pad, dt);
      cam.y = settleAxis(cam.y, minY - pad, maxY + pad, dt);
    },

    _updateShake(dt) {
      if (cam._trauma > 0) {
        cam._trauma = Math.max(0, cam._trauma - SHAKE_DECAY * dt);
        cam._shakeT += dt;
        const amt = cam._trauma * cam._trauma;
        cam.shakeX = Math.sin(cam._shakeT * 37.1) * SHAKE_MAX_PX * amt;
        cam.shakeY = Math.sin(cam._shakeT * 29.7 + 1.7) * SHAKE_MAX_PX * amt;
      } else if (cam.shakeX !== 0 || cam.shakeY !== 0) {
        cam.shakeX = 0;
        cam.shakeY = 0;
      }
    },
  };

  return cam;
}
