// Canvas plumbing: DPR-correct sizing, resize observation, and the camera.
//
// Two things here are worth getting right on day one because retrofitting them
// is miserable:
//   1. Device pixel ratio. The backing store is cssPx * min(dpr, 2) and the
//      context carries ONE scale, so every draw call downstream works in CSS
//      pixels and never thinks about dpr again. Capping at 2 keeps a 3x phone
//      from quadrupling fill cost for no visible gain.
//   2. A real camera. Screen <-> world is needed by input (hit tests), by the
//      HUD (positioning the training picker over a site) and by the renderer,
//      so it lives in one place and is pure enough to unit test.

/**
 * @typedef {object} Camera
 * @property {number} x world-space x at the centre of the viewport
 * @property {number} y world-space y at the centre of the viewport
 * @property {number} zoom screen px per world unit
 * @property {number} vw viewport width in CSS px
 * @property {number} vh viewport height in CSS px
 */

/**
 * PURE — no DOM, no globals. Tested headlessly.
 * @param {Partial<Camera> & {minZoom?:number, maxZoom?:number}} [init]
 */
export function createCamera(init = {}) {
  const cam = {
    x: init.x ?? 0,
    y: init.y ?? 0,
    zoom: init.zoom ?? 1,
    vw: init.vw ?? 1,
    vh: init.vh ?? 1,
    minZoom: init.minZoom ?? 0.35,
    maxZoom: init.maxZoom ?? 3,

    setViewport(w, h) {
      cam.vw = w;
      cam.vh = h;
      return cam;
    },

    /** World -> screen (CSS px). Writes into `out`; allocates nothing. */
    worldToScreen(wx, wy, out) {
      out.x = (wx - cam.x) * cam.zoom + cam.vw * 0.5;
      out.y = (wy - cam.y) * cam.zoom + cam.vh * 0.5;
      return out;
    },

    /** Screen (CSS px) -> world. Exact inverse of worldToScreen. */
    screenToWorld(sx, sy, out) {
      out.x = (sx - cam.vw * 0.5) / cam.zoom + cam.x;
      out.y = (sy - cam.vh * 0.5) / cam.zoom + cam.y;
      return out;
    },

    /** Drag the world by a screen-space delta. */
    panScreen(dxScreen, dyScreen) {
      cam.x -= dxScreen / cam.zoom;
      cam.y -= dyScreen / cam.zoom;
      return cam;
    },

    /** Zoom keeping the world point under (sx,sy) pinned to that pixel. */
    zoomAt(sx, sy, factor) {
      const before = cam.screenToWorld(sx, sy, _a);
      const wx = before.x;
      const wy = before.y;
      cam.zoom = clamp(cam.zoom * factor, cam.minZoom, cam.maxZoom);
      const after = cam.screenToWorld(sx, sy, _a);
      cam.x += wx - after.x;
      cam.y += wy - after.y;
      return cam;
    },

    setZoom(z) {
      cam.zoom = clamp(z, cam.minZoom, cam.maxZoom);
      return cam;
    },

    /**
     * Frame a world-space AABB inside the part of the viewport the HUD leaves
     * free. `insets` matters more than it looks: the HUD is furniture on the
     * top and bottom only, so padding all four sides equally throws away the
     * horizontal space a wide map needs and leaves the board floating in the
     * middle of a letterbox.
     * @param {{minX:number,minY:number,maxX:number,maxY:number}} bounds
     * @param {number} pad CSS px of breathing room on every side
     * @param {{top?:number,right?:number,bottom?:number,left?:number}} [insets]
     */
    fit(bounds, pad = 24, insets = null) {
      const l = (insets?.left ?? 0) + pad;
      const r = (insets?.right ?? 0) + pad;
      const t = (insets?.top ?? 0) + pad;
      const b = (insets?.bottom ?? 0) + pad;
      const w = Math.max(1e-6, bounds.maxX - bounds.minX);
      const h = Math.max(1e-6, bounds.maxY - bounds.minY);
      const z = Math.min(Math.max(1, cam.vw - l - r) / w, Math.max(1, cam.vh - t - b) / h);
      cam.zoom = clamp(z, cam.minZoom, cam.maxZoom);
      // Centre on the AVAILABLE box rather than the viewport, so the map sits
      // in the free space instead of half under the dock.
      cam.x = (bounds.minX + bounds.maxX) * 0.5 + (r - l) * 0.5 / cam.zoom;
      cam.y = (bounds.minY + bounds.maxY) * 0.5 + (b - t) * 0.5 / cam.zoom;
      return cam;
    },

    /** Keep the map centre roughly on screen; free panning past the edge is
     *  disorienting on a map this small. */
    clampTo(bounds, slack = 0.35) {
      const mx = ((bounds.maxX - bounds.minX) * 0.5 + (cam.vw / cam.zoom) * slack);
      const my = ((bounds.maxY - bounds.minY) * 0.5 + (cam.vh / cam.zoom) * slack);
      const cx = (bounds.minX + bounds.maxX) * 0.5;
      const cy = (bounds.minY + bounds.maxY) * 0.5;
      cam.x = clamp(cam.x, cx - mx, cx + mx);
      cam.y = clamp(cam.y, cy - my, cy + my);
      return cam;
    },

    /**
     * Install camera + dpr as the context transform, so all drawing downstream
     * happens in world coordinates. One setTransform per pass, no push/pop.
     */
    applyTo(ctx, dpr) {
      const s = cam.zoom * dpr;
      ctx.setTransform(s, 0, 0, s, dpr * (cam.vw * 0.5 - cam.x * cam.zoom),
        dpr * (cam.vh * 0.5 - cam.y * cam.zoom));
      return ctx;
    },
  };
  return cam;
}

const _a = { x: 0, y: 0 };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Bind a <canvas> to its CSS box at the right backing-store resolution.
 * @param {HTMLCanvasElement} canvas
 * @param {{maxDpr?:number, alpha?:boolean, onResize?:(w:number,h:number,dpr:number)=>void}} [opts]
 */
export function createSurface(canvas, opts = {}) {
  const maxDpr = opts.maxDpr ?? 2;
  const ctx = canvas.getContext('2d', { alpha: opts.alpha !== false });
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;

  function resize(w, h) {
    const nextDpr = Math.min(globalThis.devicePixelRatio || 1, maxDpr);
    const nw = Math.max(1, Math.round(w));
    const nh = Math.max(1, Math.round(h));
    if (nw === cssW && nh === cssH && nextDpr === dpr) return false;
    cssW = nw;
    cssH = nh;
    dpr = nextDpr;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    // Default transform: CSS pixels in, device pixels out. Passes that want
    // world space overwrite this with camera.applyTo().
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    opts.onResize?.(cssW, cssH, dpr);
    return true;
  }

  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) resize(box.width, box.height);
    });
    ro.observe(canvas);
  }
  const rect = canvas.getBoundingClientRect?.();
  resize(rect?.width || canvas.clientWidth || 1, rect?.height || canvas.clientHeight || 1);

  return {
    canvas,
    ctx,
    get cssW() { return cssW; },
    get cssH() { return cssH; },
    get dpr() { return dpr; },
    /** Reset to CSS-pixel space and wipe the whole backing store. */
    clear() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },
    /** Opaque wipe, for the background canvas. */
    fill(color) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },
    /** Back to CSS-pixel space (for a screen-space pass such as text). */
    screenSpace() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return ctx;
    },
    resize,
    dispose() {
      ro?.disconnect();
      ro = null;
    },
  };
}

/** Pointer position in CSS pixels relative to a canvas. */
export function pointerPos(canvas, ev, out) {
  const r = canvas.getBoundingClientRect();
  out.x = ev.clientX - r.left;
  out.y = ev.clientY - r.top;
  return out;
}
