// Hanging a HUD element off a site on the board.
//
// battle-anchor.js is the maths; this is the two dozen lines of DOM that feed
// it. Kept apart because the maths is what breaks silently and it is worth
// testing with no document at all — and because battle-panel.js is up against
// the 400-line cap.
//
// Nothing here reads simulation state except through the site objects it is
// handed, and nothing here writes any.
import { bindStyle, bindClass } from '../ui/dom.js';
import {
  placePanel, panelBounds, boxAround, WEIGHT, TRAIN_FAN_R,
} from './battle-anchor.js';

/**
 * The panel's position, recomputed every frame while it is open.
 *
 * `board` is optional on purpose: without it (a headless test, or any caller
 * that has no camera) the panel simply renders where the stylesheet puts it and
 * every other feature still works. With it, this is what makes the panel follow
 * a pan, flip at an edge, and stay off the sites you are dragging between.
 *
 * @param {HTMLElement} el the panel
 * @param {?object} board battleView — read-only; only `camera` and `siteScreen`
 * @param {(state:object, id:string)=>?object} siteById site lookup
 */
export function createFollower(el, board, siteById) {
  const set = {
    x: bindStyle(el, '--x'), y: bindStyle(el, '--y'),
    cx: bindStyle(el, '--cx'), cy: bindStyle(el, '--cy'),
    adrift: bindClass(el, 'is-adrift'),
  };
  const pt = { x: 0, y: 0 };
  const blockers = [];
  const size = { w: 240, h: 120 };
  let side = null;
  let measuredAt = -1e9;
  let dirty = true;

  /**
   * Layout reads are the one genuinely expensive thing in a per-frame path, so
   * the box is re-measured only when its CONTENT changed (the caller says so
   * via markDirty) and at most ten times a second. A still panel over a still
   * camera therefore costs no layout at all.
   *
   * Measuring matters more than it looks: the panel grows a line when a site
   * starts building or gains a rally, and a stale height is a panel that hangs
   * over the dock for as long as the staleness lasts.
   */
  function measure(now) {
    if (!dirty || now - measuredAt < 100) return;
    dirty = false;
    measuredAt = now;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w > 0 && h > 0) { size.w = w; size.h = h; }
  }

  return {
    get side() { return side; },
    /** The panel's text just changed, so its box may have too. */
    markDirty() { dirty = true; },
    reset() { side = null; measuredAt = -1e9; dirty = true; },

    /**
     * @param {object} state battle state
     * @param {?object} site the selected site, or null when nothing is selected
     * @param {object} view presentation state (for the training fan)
     * @param {number} now ms
     * @param {object} [insets] HUD furniture to stay clear of
     */
    place(state, site, view, now, insets) {
      if (!board || !site) return;
      measure(now);
      const cam = board.camera;
      board.siteScreen(site, pt);
      const anchor = { x: pt.x, y: pt.y };

      // Panned off the edge of the world. A panel clamped to a viewport corner
      // with its site nowhere near it is exactly the stranded-in-the-corner
      // panel this whole change is about — and, being interactive, it would sit
      // there eating clicks meant for the board. So it goes away instead, and
      // comes straight back when you pan its site into view.
      if (set.adrift(anchor.x < 0 || anchor.y < 0
        || anchor.x > cam.vw || anchor.y > cam.vh)) side = null;

      // Keep-out boxes: the site itself (widened to the training fan when the
      // fan is open over it), then every ADJACENT site, because those are the
      // targets of the drag the panel must not get in the way of.
      blockers.length = 0;
      const r = board.hexSize * cam.zoom;
      const self = view?.trainPickerFor === site.id
        ? TRAIN_FAN_R + 24
        : Math.max(r, 26);
      blockers.push(boxAround(anchor.x, anchor.y, self, WEIGHT.self));
      for (let i = 0; i < site.adj.length; i++) {
        const n = siteById(state, site.adj[i]);
        if (!n) continue;
        board.siteScreen(n, pt);
        blockers.push(boxAround(pt.x, pt.y, Math.max(r, 26), WEIGHT.neighbour));
      }
      for (const box of insets?.plates ?? []) blockers.push(box);

      const at = placePanel({
        site: anchor,
        size,
        bounds: panelBounds(cam.vw, cam.vh, insets),
        blockers,
        r: self,
        prefer: side,
      });
      side = at.side;
      set.x(`${at.x}px`);
      set.y(`${at.y}px`);
      set.cx(`${at.caretX}px`);
      set.cy(`${at.caretY}px`);
      if (el.dataset.caret !== at.edge) el.dataset.caret = at.edge;
    },
  };
}
