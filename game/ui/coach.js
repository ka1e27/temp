// Non-blocking coach mark (DESIGN §6, PLAYFEEL §4 "Hint placement rules"). Browser only; no game-logic imports.
//
// A hint is a small bubble with a pointer (a tail) and a pulsing ring on its target. The rules this file enforces, every frame:
//  * the tail ENDS on the target: its tip is 4 px from the target's on-screen box (the contract is 8 px);
//  * it FOLLOWS the target: the target is a live getter, re-read every frame (the map pans, zooms and flies under it);
//  * it NEVER COVERS the target: the bubble goes on whichever side (below, above, right, left) clears the target and the panels,
//    and is squeezed narrower before it is allowed to overlap anything;
//  * it stays fully ON SCREEN, and the tail slides along the bubble's edge so it still reaches the target when the bubble is held back from a screen edge;
//  * it HIDES while its target is off screen or under a panel, and comes back when the target is visible again (it never points at empty map).
// Placement is pure geometry (`placeHint`), exported for unit tests; the DOM work is thin.
import { h } from './dom.js';
import { icon } from './icons.js';
import { announce } from './live.js';

export const TAIL_LEN = 10; // px the tail sticks out of the bubble
export const TAIL_HALF = 9; // half the tail's base
export const TIP_GAP = 4; // px between the tail tip and the target box (contract: <= 8)
const MARGIN = 8; // px the bubble keeps from the screen edge
const ROUND = 14; // the bubble's corner radius the tail must stay clear of
const WIDTHS = [280, 232, 190, 156]; // bubble max-widths to try, widest first
const REACH_STEPS = [0, 14, 30, 48, 68]; // extra tail length (px) to try when something pressable sits between the bubble and its target

/**
 * Where to put a bubble of size `b` for a target box `t` in a viewport `v`. Pure.
 * @param {{ w: number, h: number }} b bubble size
 * @param {{ x: number, y: number, w: number, h: number }} t target box
 * @param {{ w: number, h: number }} v viewport
 * @param {{ prefer?: 'below'|'above'|'left'|'right', obstacles?: Array<{ x: number, y: number, w: number, h: number }> }} [opts]
 * @returns {{ side: 'below'|'above'|'left'|'right', x: number, y: number, tail: { x: number, y: number, len: number, side: 'up'|'down'|'left'|'right', tipX: number, tipY: number }, overlap: number } | null}
 *   `x, y` is the bubble's top-left; `tail.x/y` its top-left; `tail.side` the direction it points; null when no side can work at this size.
 */
export function placeHint(b, t, v, opts = {}) {
  const obstacles = opts.obstacles || [];
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const tcx = t.x + t.w / 2;
  const tcy = t.y + t.h / 2;
  const auto = tcy < v.h * 0.55 ? ['below', 'above'] : ['above', 'below'];
  const horiz = tcx < v.w * 0.5 ? ['right', 'left'] : ['left', 'right'];
  const order = [...new Set([opts.prefer, ...auto, ...horiz].filter(Boolean))];
  let best = null;
  order.forEach((side, rank) => {
    // The tail is TAIL_LEN long when the bubble can sit right next to the target. When a control is in between (the send-size row above a power
    // button), the bubble holds back and the tail reaches across it (up to 68 px more) so nothing pressable is covered.
    for (const extra of REACH_STEPS) {
      const reach = TAIL_LEN + TIP_GAP + extra;
      const len = TAIL_LEN + extra;
      const slack = 6; // the tip may sit this far beyond the box edge along it
      // Positions along the target's edge to try: centred on it first, then slid as far either way as the tail can still reach the box
      // (so a bubble can step aside from a panel or toast that sits next to its target).
      const horizontal = side === 'below' || side === 'above';
      const span = horizontal ? { lo: t.x, hi: t.x + t.w, size: b.w, max: v.w } : { lo: t.y, hi: t.y + t.h, size: b.h, max: v.h };
      const centre = horizontal ? tcx : tcy;
      const fromLo = Math.max(MARGIN, span.lo - slack - span.size + ROUND);
      const toHi = Math.min(span.max - span.size - MARGIN, span.hi + slack - ROUND);
      const centred = clamp(centre - span.size / 2, MARGIN, span.max - span.size - MARGIN);
      const along = [centred];
      if (fromLo <= toHi) for (const c of [fromLo, toHi]) { const q = clamp(c, fromLo, toHi); if (!along.some((a) => Math.abs(a - q) < 1)) along.push(q); }
      let clearHere = false;
      along.forEach((pos, ai) => {
        let x;
        let y;
        if (horizontal) {
          x = pos;
          y = side === 'below' ? t.y + t.h + reach : t.y - reach - b.h;
        } else {
          y = pos;
          x = side === 'right' ? t.x + t.w + reach : t.x - reach - b.w;
        }
        // hard rules: on screen, off the target, tail able to reach it
        if (x < MARGIN - 0.5 || y < MARGIN - 0.5 || x + b.w > v.w - MARGIN + 0.5 || y + b.h > v.h - MARGIN + 0.5) return;
        const boxOverlap = (o, pad) => {
          const w = Math.min(x + b.w, o.x + o.w + pad) - Math.max(x, o.x - pad);
          const hh = Math.min(y + b.h, o.y + o.h + pad) - Math.max(y, o.y - pad);
          return w > 0 && hh > 0 ? w * hh : 0;
        };
        if (boxOverlap(t, 1) > 0) return;
        let tail;
        if (horizontal) {
          const lo = Math.max(t.x - slack, x + ROUND);
          const hi = Math.min(t.x + t.w + slack, x + b.w - ROUND);
          if (lo > hi) return;
          const tipX = clamp(tcx, lo, hi);
          tail = side === 'below' // a bubble below the target: its tail is on its top edge, pointing up
            ? { side: 'up', x: tipX - TAIL_HALF, y: y - len, len, tipX, tipY: y - len }
            : { side: 'down', x: tipX - TAIL_HALF, y: y + b.h, len, tipX, tipY: y + b.h + len };
        } else {
          const lo = Math.max(t.y - slack, y + ROUND);
          const hi = Math.min(t.y + t.h + slack, y + b.h - ROUND);
          if (lo > hi) return;
          const tipY = clamp(tcy, lo, hi);
          tail = side === 'right' // a bubble right of the target: its tail is on its left edge, pointing left
            ? { side: 'left', x: x - len, y: tipY - TAIL_HALF, len, tipX: x - len, tipY }
            : { side: 'right', x: x + b.w, y: tipY - TAIL_HALF, len, tipX: x + b.w + len, tipY };
        }
        // soft rule: stay off the panels (a covered control is worth far more than a longer tail or a bubble off-centre)
        // an obstacle may carry a `weight` (default 1): a toast is on top of the hint and goes away by itself, so covering it costs next to nothing beside covering a control
        const overlap = obstacles.reduce((sum, o) => sum + boxOverlap(o, 2) * (o.weight ?? 1), 0);
        const score = overlap * 1000 + rank * 10 + extra * 0.4 + ai * 0.05;
        if (!best || score < best.score) best = { side, x, y, tail, overlap, score };
        if (overlap === 0) clearHere = true;
      });
      if (clearHere) break; // the nearest clear spot on this side is the one to use
    }
  });
  return best ? { side: best.side, x: best.x, y: best.y, tail: best.tail, overlap: best.overlap } : null;
}

/** A target as the coach reads it each frame. */
/**
 * @typedef {Object} CoachData
 * @property {boolean} visible
 * @property {string} [text]
 * @property {string} [id]          the tutorial step (kept on the element for automated checks)
 * @property {{ el?: HTMLElement, find?: () => (HTMLElement|null|undefined), get?: () => ({ x: number, y: number, w: number, h: number } | null), probe?: () => ({ x: number, y: number }) } | { x: number, y: number }} [target]
 *   a DOM element (`el`, or `find` to look it up again every frame), a live getter for a box (`get`: a world object, re-read every frame), both
 *   (a group: `get` gives the box, `find` the element used to see whether it is covered), or a screen point (a small box). With an element,
 *   "covered" means it is not what is on top at its own centre; a getter alone is a world target, covered when a panel (not the map canvas) is on top.
 * @property {'below'|'above'|'left'|'right'} [prefer]  the side of the target the bubble should try first

 * @property {boolean} [noRing]     no pulsing ring on the target's box: something else marks it (the W2 region outline)
 * @property {boolean} [card]       no pointer: a small card in the middle of the free map (for hints about the map itself)
 * @property {Array<HTMLElement | (() => ({ x: number, y: number, w: number, h: number } | null))>} [avoid]  more things the bubble must stay off
 * @property {() => void} [onDismiss]  what the × does for THIS hint (default: the tutorial's skip-this-step)
 */

/**
 * @param {{ onDismiss?: () => void, selfTick?: boolean, obstacles?: () => Array<HTMLElement|(() => ({ x: number, y: number, w: number, h: number } | null))|null|undefined> }} [callbacks]
 *   `selfTick: false` when the shell calls `tick()` itself at the end of every frame (so the coach is placed against the frame's final camera);
 *   `obstacles` lists the panels a bubble should not cover (the coach skips the ones that hold its target).
 */
export function createCoach({ onDismiss, selfTick = true, obstacles } = {}) {
  let localDismiss = null; // a hint that is not a tutorial step brings its own × (skipping a tutorial step would be wrong for it)
  let rafId = null;
  let data = null;
  let widthIdx = 0;

  const textEl = h('p.coach-text', {}, '');
  const bubble = h('div.coach-bubble', {},
    textEl,
    h('button.coach-dismiss', { onClick: () => (localDismiss || onDismiss)?.(), 'aria-label': 'Dismiss hint' }, icon('close', 12)),
  );
  const tail = h('div.coach-tail', { dataset: { side: 'up' } });
  const ring = h('div.coach-ring', {});
  const el = h('div.coach', { hidden: true }, ring, bubble, tail);

  const boxOfEl = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const isShown = (e) => !!e && e.isConnected && e.getClientRects().length > 0 && !e.closest('[hidden]');

  /** The target's box right now, or null (missing). */
  function readTarget() {
    const t = data && data.target;
    if (!t) return null;
    if (typeof t.get === 'function') return t.get() || null;
    if (typeof t.x === 'number') return { x: t.x - 14, y: t.y - 14, w: 28, h: 28 };
    const e = targetEl();
    return isShown(e) ? boxOfEl(e) : null;
  }

  /** The DOM element a target is, if it is one (re-found every frame for `find`). */
  function targetEl() {
    const t = data && data.target;
    if (!t) return null;
    return (typeof t.find === 'function' ? t.find() : t.el) || null;
  }

  /** Off screen (less than half of it in view) or under a panel? */
  function targetHidden(box) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(box.x + box.w, vw) - Math.max(box.x, 0);
    const hh = Math.min(box.y + box.h, vh) - Math.max(box.y, 0);
    if (w <= 0 || hh <= 0 || (w * hh) / Math.max(1, box.w * box.h) < 0.5) return true;
    const te = targetEl();
    const tgt = data && data.target;
    const pt = tgt && typeof tgt.probe === 'function' ? tgt.probe() : null; // a big target (a region) is probed at its label, not at the middle of a box that may lie under a panel
    // its label off screen: only a clipped sliver of the region can be in view (RC2 playtest, seed 23: after the W1 zoom the W2 bubble pointed at the screen corner under the HUD)
    if (pt && (pt.x < 0 || pt.y < 0 || pt.x > vw || pt.y > vh)) return true;
    const probe = te && isShown(te) ? boxOfEl(te) : box; // a group target is probed at its element's own centre, not the gap between its parts
    const cx = Math.min(vw - 1, Math.max(0, pt ? pt.x : probe.x + probe.w / 2));
    const cy = Math.min(vh - 1, Math.max(0, pt ? pt.y : probe.y + probe.h / 2));
    const top = document.elementFromPoint(cx, cy);
    if (!top || el.contains(top)) return false;
    if (te) return !(te === top || te.contains(top));
    const canvas = document.getElementById('world');
    return !!canvas && top !== canvas && !canvas.contains(top);
  }

  const PRESSABLE = 'button, [role="button"], a[href], input, select, textarea';

  /**
   * The boxes the bubble must stay off. A panel is one box, EXCEPT a panel that holds the target (the HUD bar round a HUD button): the bubble
   * may sit beside the target inside it, but never over that panel's other controls, which are listed one by one.
   */
  function obstacleBoxes(targetBox) {
    const held = targetEl();
    const out = [];
    const add = (box) => { if (box && box.w > 0 && box.h > 0) out.push(box); };
    const tcx = targetBox.x + targetBox.w / 2;
    const tcy = targetBox.y + targetBox.h / 2;
    const addEl = (x) => {
      if (!x || !x.getBoundingClientRect || !isShown(x)) return;
      if (held && x.contains(held)) {
        for (const ctl of x.querySelectorAll(PRESSABLE)) {
          if (!isShown(ctl) || ctl === held || held.contains(ctl) || ctl.contains(held) || el.contains(ctl)) continue;
          add(boxOfEl(ctl));
        }
        return;
      }
      const box = boxOfEl(x);
      if (!(tcx >= box.x && tcx <= box.x + box.w && tcy >= box.y && tcy <= box.y + box.h)) add(box);
    };
    for (const o of (obstacles ? obstacles() : [])) { if (typeof o === 'function') add(o()); else addEl(o); } // an element, or a function giving a box
    for (const o of (data.avoid || [])) { if (typeof o === 'function') add(o()); else addEl(o); }
    return out;
  }

  function hide() {
    if (!el.hidden) el.hidden = true;
    el.style.visibility = '';
  }

  /** A hidden coach has no size: show it (unseen) for the measuring, and let the placement decide whether it stays. */
  function prepareToMeasure() {
    if (el.hidden) { el.hidden = false; el.style.visibility = 'hidden'; }
  }

  /** Re-read the target and place everything. Call it every frame (the shell does, at the end of the frame; or `selfTick`). */
  function tick() {
    if (!data || !data.visible || (!data.target && !data.card)) { hide(); return; }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (data.card) { placeCard(vw, vh); return; }
    const box = readTarget();
    if (!box || targetHidden(box)) { hide(); return; }
    const obs = obstacleBoxes(box);
    prepareToMeasure();
    // the widest bubble that has a legal side AND covers no panel; narrower ones only when it must (the least-covering one when none is clear)
    let placed = null;
    let size = null;
    let pick = null;
    for (let i = 0; i < WIDTHS.length; i++) {
      bubble.style.maxWidth = `${Math.min(WIDTHS[i], vw - 2 * MARGIN)}px`;
      const sz = { w: bubble.offsetWidth, h: bubble.offsetHeight };
      const p = placeHint(sz, box, { w: vw, h: vh }, { prefer: data.prefer, obstacles: obs });
      if (!p) continue;
      if (!pick || p.overlap < pick.p.overlap) pick = { p, sz, i };
      if (p.overlap === 0) break;
    }
    if (pick) {
      placed = pick.p;
      size = pick.sz;
      widthIdx = pick.i;
      bubble.style.maxWidth = `${Math.min(WIDTHS[pick.i], vw - 2 * MARGIN)}px`; // the DOM must hold the width that was placed
    }
    void size;
    if (!placed) { hide(); return; } // nowhere legal at any width: no hint is better than a wrong one
    el.style.visibility = '';
    el.dataset.mode = 'pointer';
    el.dataset.side = placed.side;
    bubble.style.left = `${Math.round(placed.x)}px`;
    bubble.style.top = `${Math.round(placed.y)}px`;
    tail.hidden = false;
    tail.dataset.side = placed.tail.side;
    const vertical = placed.tail.side === 'up' || placed.tail.side === 'down';
    tail.style.width = `${vertical ? 2 * TAIL_HALF : placed.tail.len}px`;
    tail.style.height = `${vertical ? placed.tail.len : 2 * TAIL_HALF}px`;
    tail.style.left = `${Math.round(placed.tail.x)}px`;
    tail.style.top = `${Math.round(placed.tail.y)}px`;
    const pad = 5;
    if (data.noRing) { ring.hidden = true; return; } // a region target is marked on the map itself (a bright pulsing outline), not by a box
    ring.hidden = false;
    ring.style.left = `${Math.round(box.x - pad)}px`;
    ring.style.top = `${Math.round(box.y - pad)}px`;
    ring.style.width = `${Math.round(box.w + 2 * pad)}px`;
    ring.style.height = `${Math.round(box.h + 2 * pad)}px`;
    ring.style.borderRadius = `${Math.min(999, Math.round(Math.min(box.w, box.h) / 2 + pad))}px`;
  }

  /** A hint about the map itself ("drag to move it"): a small card over the middle of the free map, no pointer, no ring. */
  function placeCard(vw, vh) {
    prepareToMeasure();
    bubble.style.maxWidth = `${Math.min(300, vw - 2 * MARGIN)}px`;
    const w = bubble.offsetWidth;
    const hh = bubble.offsetHeight;
    const obs = obstacleBoxes({ x: vw / 2, y: vh / 2, w: 0, h: 0 }).concat([]);
    const x = Math.max(MARGIN, Math.min(vw - w - MARGIN, (vw - w) / 2));
    let best = null;
    for (const fy of [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74]) {
      const y = Math.max(MARGIN, Math.min(vh - hh - MARGIN, vh * fy - hh / 2));
      const overlap = obs.reduce((s, o) => {
        const ow = Math.min(x + w, o.x + o.w) - Math.max(x, o.x);
        const oh = Math.min(y + hh, o.y + o.h) - Math.max(y, o.y);
        return s + (ow > 0 && oh > 0 ? ow * oh : 0);
      }, 0);
      if (!best || overlap < best.overlap) best = { y, overlap };
      if (overlap === 0) break;
    }
    el.style.visibility = '';
    el.dataset.mode = 'card';
    el.dataset.side = 'none';
    bubble.style.left = `${Math.round(x)}px`;
    bubble.style.top = `${Math.round(best.y)}px`;
    tail.hidden = true;
    ring.hidden = true;
  }

  function loop() {
    tick();
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  /**
   * Safe to call every frame: it swaps the text/target the placement reads and places at once (no flash at an old spot).
   * @param {CoachData} next
   */
  let spoken = '';
  function update(next) {
    if (!next) return;
    data = next;
    if (next.text != null && next.text !== textEl.textContent) textEl.textContent = next.text;
    // a hint is read out once when it appears (polite live region, ui/live.js); it is silent while it is simply re-placed every frame
    if (next.visible && next.text && (next.target || next.card)) {
      if (next.text !== spoken) { spoken = next.text; announce(`Hint: ${next.text}`); }
    } else if (!next.visible) spoken = '';
    localDismiss = next.onDismiss || null;
    el.dataset.step = next.id || '';
    if (!next.visible || (!next.target && !next.card)) {
      stop();
      hide();
      return;
    }
    tick();
    if (selfTick && rafId == null) loop();
  }

  function destroy() {
    stop();
  }

  return { el, update, tick, destroy, get bubble() { return bubble; }, get tail() { return tail; } };
}
