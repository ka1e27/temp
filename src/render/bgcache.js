// WHEN THE CACHED BACKGROUND CANVAS REPAINTS, AND WHERE IT SITS IN BETWEEN.
//
// Split out of battleView.js at the 400-line cap. Two rules that only make
// sense together:
//
// THE GATE. `#board-bg` costs ~54ms to repaint and `markDirty` is called on
// every pointermove while panning, so a camera gesture used to repaint it ONCE
// PER FRAME: measured 295 repaints in a 10s pan, main thread pinned at 994ms/s,
// 60fps -> 31 on a desktop and 36 -> 17 on a throttled phone.
//
// THE LOCK. Gating alone looks WRONG, and that is worse than the frame rate it
// buys: `#board-fx` follows the camera every frame while the background only
// catches up eight times a second, so the terrain visibly drags behind the sites
// standing on it. So between repaints the cached canvas is TRANSLATED with the
// camera. A pan is a pure translation, so every painted pixel lands back exactly
// where it belongs — no resampling, no blur, and the cost is one compositor
// transform. The two layers stay locked at any repaint rate, and the gate is
// then only deciding how often the trailing edge gets refilled.
//
// Zoom is not a translation, so a zoom change asks for a real repaint rather
// than scaling a stale bitmap into a soft one.

const GATE_MS = 125;
/** How far the canvas may slide before it is repainted anyway. Translating
 *  reveals unpainted canvas at the trailing edge; this bounds that strip. */
const SLIDE_MAX = 96;

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * @param {{el:HTMLCanvasElement|null, camera:object}} o
 */
export function createBgCache(o) {
  const { el, camera } = o;
  let dirty = true;
  let askedAt = 0;
  let pending = false;
  let at = null;          // the camera the canvas was last painted for
  let transform = '';

  return {
    /** Coalesced. `force` skips the gate for callers that are not gestures —
     *  a fit or a zoom reset, where the repaint owes this frame. */
    markDirty(force) {
      if (force) { dirty = true; askedAt = 0; return; }
      const t = nowMs();
      if (t - askedAt < GATE_MS) { pending = true; return; }
      askedAt = t;
      pending = false;
      dirty = true;
    },

    /** Does this frame owe a repaint? Clears the flag. */
    take() {
      // A gesture that ended inside the gate still owes one repaint.
      if (!dirty && pending && nowMs() - askedAt >= GATE_MS) {
        askedAt = nowMs();
        pending = false;
        dirty = true;
      }
      if (!dirty) return false;
      dirty = false;
      return true;
    },

    /** Called immediately after a repaint: the canvas now matches the camera. */
    painted() {
      at = { x: camera.x, y: camera.y, zoom: camera.zoom };
      if (transform !== '' && el) { transform = ''; el.style.transform = ''; }
    },

    /** Slide the canvas so it stays locked to the camera between repaints. */
    sync() {
      if (!el || !at) return;
      if (camera.zoom !== at.zoom) { dirty = true; return; }
      const dx = (at.x - camera.x) * camera.zoom;
      const dy = (at.y - camera.y) * camera.zoom;
      if (Math.abs(dx) > SLIDE_MAX || Math.abs(dy) > SLIDE_MAX) { dirty = true; return; }
      const t = dx === 0 && dy === 0 ? '' : `translate(${dx}px, ${dy}px)`;
      if (transform !== t) { transform = t; el.style.transform = t; }
    },
  };
}
