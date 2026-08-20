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

// The FLOOR of the gate, and what it was chosen against: a ~54ms repaint on a
// campaign board, which at 8/s is well under half the main thread and measured
// at 59-60 fps.
const GATE_MS = 125;
/**
 * ...AND THE GATE IS A DUTY CYCLE, NOT A FIXED RATE, because the constant above
 * is a claim about how much a repaint COSTS and that is a property of the board.
 *
 * Measured on the frontier (endless mode, 60x48 = 2880 hexes against a campaign
 * board's 336): one repaint costs 168ms, not 54. A campaign board rarely
 * saturates the gate — the signature only moves when a column crosses a hex,
 * every 0.7-2.5s — but a board that size carries far more columns and hits it
 * continuously, asking for 8 x 168 = 1344ms of work per second. Measured: 60.1
 * fps with the sim PAUSED (so the per-frame layer is entirely fine at that size)
 * against 28-43 fps running.
 *
 * So the gate is now `max(GATE_MS, lastCost * DUTY)`: the last repaint's own
 * cost decides how long the next one has to wait. DUTY is 2.3 deliberately —
 * `54 * 2.3` is 124ms, just under the floor, so EVERY CAMPAIGN BOARD IS
 * UNCHANGED and only a board expensive enough to saturate the gate is slowed.
 *
 * This is a self-limiting mitigation and not the real fix. The real fix is to
 * clip the repaint to the viewport: `computeOwners`, `computeVeil`, the flood,
 * the plates, the rock and the grid lines all walk the WHOLE board regardless of
 * what the camera can see, which on a map you are meant to explore zoomed in is
 * mostly wasted. That is a six-function change to the renderer's hot path and it
 * wants its own pass.
 */
const DUTY = 2.3;
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
  let cost = 0;           // what the last repaint actually took, in ms
  const gate = () => Math.max(GATE_MS, cost * DUTY);

  return {
    /** Coalesced. `force` skips the gate for callers that are not gestures —
     *  a fit or a zoom reset, where the repaint owes this frame. */
    markDirty(force) {
      if (force) { dirty = true; askedAt = 0; return; }
      const t = nowMs();
      if (t - askedAt < gate()) { pending = true; return; }
      askedAt = t;
      pending = false;
      dirty = true;
    },

    /** Does this frame owe a repaint? Clears the flag. */
    take() {
      // A gesture that ended inside the gate still owes one repaint.
      if (!dirty && pending && nowMs() - askedAt >= gate()) {
        askedAt = nowMs();
        pending = false;
        dirty = true;
      }
      if (!dirty) return false;
      dirty = false;
      return true;
    },

    /** Called immediately BEFORE a repaint: the canvas is about to match the
     *  camera, and the CSS transform has to be cleared before anything is
     *  painted into it or the new pixels land offset by the old slide. */
    painted() {
      at = { x: camera.x, y: camera.y, zoom: camera.zoom };
      if (transform !== '' && el) { transform = ''; el.style.transform = ''; }
    },

    /**
     * What the repaint that just finished COST. Separate from `painted` because
     * that one has to run before any pixel is drawn (it clears the slide) and
     * this one can only be known after the last one — see the DUTY note above
     * for what the number is used for.
     */
    spent(ms) {
      if (Number.isFinite(ms) && ms >= 0) cost = ms;
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
