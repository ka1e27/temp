// "Look around the world" — the world map's layout maths and its pan gesture.
//
// The map is deliberately BIGGER than the screen. A campaign you can take in
// at a glance is a diagram; a campaign you have to move through is a world, and
// moving through it is the whole reason the hexes are this large.
//
// Everything above createMapPanner() is pure — no DOM, no globals — because the
// clamp is the part that fails silently. A camera that lets you drag the map
// into the void looks fine in a screenshot and is unusable in the hand, so it
// is unit tested (tests/worldmap.test.js) rather than eyeballed.
//
// The transform model, used by every function here:
//   screen = pan + zoom * content        (transform-origin: 0 0)
// which is exactly `translate3d(pan) scale(zoom)` on one wrapper element. One
// composited property moves all 18 plates; nothing is repositioned per frame.
import { createDisposer } from '../ui/dom.js';

/** CSS px of travel still counted as a tap rather than a drag. The same number
 *  as battle-input.js on purpose — the two screens must feel identical. */
export const TAP_SLOP = 6;

/** Plate geometry in CSS px. Pointy-top, h/w matching the --hex-w/--hex-h
 *  token ratio, spaced by a constant gutter. */
export const HEX = Object.freeze({ w: 224, h: 256, gap: 14, pad: 120 });
export const STEP_X = HEX.w + HEX.gap;
export const STEP_Y = HEX.h * 0.75 + HEX.gap;
export const ZOOM = Object.freeze({ min: 0.45, max: 1.6 });
/** The window must always hold about this many plates. Below it "a big map"
 *  stops reading as a world and starts reading as one hex and a wall. */
export const MIN_VISIBLE = Object.freeze({ cols: 2.6, rows: 2 });

/** Axial (pointy-top) -> the plate's top-left corner, before centring. */
export function hexToPixel(q, r) {
  return { x: STEP_X * (q + r / 2), y: STEP_Y * r };
}

/**
 * Place every region and report the box they need. Coordinates come back
 * shifted so the top-left plate sits at (pad, pad) and nothing is negative —
 * `left`/`top` on an absolutely positioned child cannot be negative without
 * the clamp having to know about it.
 * @param {Array<[number,number]>} hexes axial coords, in DOM order
 * @returns {{cells:{x:number,y:number}[], width:number, height:number}}
 */
export function layoutHexes(hexes) {
  const raw = hexes.map(([q, r]) => hexToPixel(q, r));
  const minX = Math.min(...raw.map((p) => p.x));
  const minY = Math.min(...raw.map((p) => p.y));
  const cells = raw.map((p) => ({ x: p.x - minX + HEX.pad, y: p.y - minY + HEX.pad }));
  return {
    cells,
    width: Math.max(...cells.map((p) => p.x)) + HEX.w + HEX.pad,
    height: Math.max(...cells.map((p) => p.y)) + HEX.h + HEX.pad,
  };
}

/**
 * The clamp. One axis, already-scaled sizes.
 *  - content longer than the view: an edge may reach the matching view edge and
 *    no further, so there is never dead space and never a lost map.
 *  - content shorter: it is pinned centred. Letting a map that already fits
 *    slide around is motion without information.
 */
export function clampAxis(v, content, view) {
  if (!(content > view)) return (view - content) / 2;
  return Math.min(0, Math.max(view - content, v));
}

/** Both axes. `content` is UNSCALED; zoom is applied here so callers cannot
 *  forget it — clamping unscaled sizes is the bug this signature prevents. */
export function clampPan(pan, content, view, zoom = 1) {
  return {
    x: clampAxis(pan.x, content.w * zoom, view.w),
    y: clampAxis(pan.y, content.h * zoom, view.h),
  };
}

/** The pan that puts a content-space point at the centre of the viewport. */
export function centreOn(cx, cy, view, zoom = 1) {
  return { x: view.w / 2 - cx * zoom, y: view.h / 2 - cy * zoom };
}

/**
 * Minimal pan so the content-space span [start, start+size] is inside the
 * viewport with `pad` to spare. Used when focus lands on an off-screen region
 * (Tab), and when a selection arrives from somewhere other than a click.
 * An item too big to fit is aligned to its leading edge rather than its
 * trailing one, so you see the thing rather than the end of it.
 */
export function revealAxis(v, start, size, view, zoom = 1, pad = 0) {
  const a = v + start * zoom;
  const b = a + size * zoom;
  let out = v;
  if (b > view - pad) out = v - (b - view + pad);
  if (a + out - v < pad) out = v + pad - a;
  return out;
}

/**
 * The only zoom this screen chooses for you, and it sits at 1:1 for every
 * ordinary window. It scales UP on a display big enough that 1:1 would leave
 * the world floating in a void, and DOWN on one too small to hold a couple of
 * plates — never in between, because a map whose scale moves with the window
 * is a map you cannot learn the shape of.
 */
export function fitZoom(content, view) {
  const up = Math.min(view.w / content.w, view.h / content.h);
  const down = Math.min(1,
    view.w / (HEX.w * MIN_VISIBLE.cols), view.h / (HEX.h * MIN_VISIBLE.rows));
  return Math.min(ZOOM.max, Math.max(ZOOM.min, up, down));
}

/** Change zoom while keeping the content point under (sx,sy) pinned there. */
export function zoomAbout(pan, zoom, next, sx, sy) {
  const z = Math.min(ZOOM.max, Math.max(ZOOM.min, next));
  return { pan: { x: sx - z * (sx - pan.x) / zoom, y: sy - z * (sy - pan.y) / zoom }, zoom: z };
}

// ---------------------------------------------------------------------------
// The gesture. Pointer Events ONLY: one code path for mouse, trackpad and
// touch, exactly as battle-input.js does it.
// ---------------------------------------------------------------------------

/**
 * @param {{viewport:HTMLElement, board:HTMLElement}} o
 *   `viewport` is the clipping window and the event surface; `board` is the
 *   single transformed layer the plates live on.
 */
export function createMapPanner(o) {
  const { viewport, board } = o;
  const off = createDisposer();
  const view = { w: 1, h: 1 };
  const content = { w: 1, h: 1 };
  const pointers = new Map();
  let pan = { x: 0, y: 0 };
  let zoom = 1;
  let press = null;
  let pinch = 0;
  let pinched = false;
  /** The player has pinched or ctrl-wheeled, so the scale is theirs to keep. */
  let chosen = false;
  /** The gesture that just ended travelled far enough to be a drag, so the
   *  click the browser is about to synthesise is NOT a selection. Panning and
   *  selecting share the left button; this flag is the entire difference. */
  let swallowClick = false;

  function measure() {
    view.w = viewport.clientWidth || 1;
    view.h = viewport.clientHeight || 1;
  }

  function write() {
    board.style.setProperty('--wm-x', `${Math.round(pan.x)}px`);
    board.style.setProperty('--wm-y', `${Math.round(pan.y)}px`);
    board.style.setProperty('--wm-z', `${zoom}`);
  }

  function setPan(x, y) {
    pan = clampPan({ x, y }, content, view, zoom);
    write();
  }

  function local(ev) {
    const r = viewport.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  /** Every gesture that changes zoom goes through here, and every one of them
   *  is the player's decision — after which the window may resize freely
   *  without the screen second-guessing the scale they chose. */
  function setZoom(next, sx, sy) {
    const z = zoomAbout(pan, zoom, next, sx, sy);
    chosen = z.zoom !== zoom || chosen;
    zoom = z.zoom;
    setPan(z.pan.x, z.pan.y);
  }

  function refit() {
    measure();
    if (!chosen) zoom = fitZoom(content, view);
    setPan(pan.x, pan.y);
  }

  /** The last finger left. Anything that moved the map — a drag past the slop
   *  or a pinch — means the click now on its way is not a selection. */
  function endDrag() {
    swallowClick = !!press?.moved || pinched;
    press = null;
    pinched = false;
    viewport.classList.remove('is-panning');
  }

  function onDown(ev) {
    // A press always resets the guard: a drag that ended off the map never got
    // its click, and a stale flag would eat the NEXT real one.
    swallowClick = false;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    pointers.set(ev.pointerId, local(ev));
    if (pointers.size === 2) {
      // Second finger down: the gesture is now a pinch, and whatever the first
      // one had started is abandoned rather than half-applied.
      press = null;
      pinched = true;
      pinch = spread();
      viewport.classList.add('is-panning');
      return;
    }
    const p = local(ev);
    // No setPointerCapture: capture retargets the compatibility `click` to the
    // capture element, which would mean a plain click never reached the hex it
    // landed on. Window-level move/up listeners give the same robustness.
    press = { sx: p.x, sy: p.y, px: pan.x, py: pan.y, moved: false };
  }

  function onMove(ev) {
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, local(ev));
    if (pointers.size >= 2) {
      const d = spread();
      if (pinch > 0 && d > 0) {
        const m = midpoint();
        setZoom(zoom * (d / pinch), m.x, m.y);
      }
      pinch = d;
      return;
    }
    if (!press) return;
    const p = local(ev);
    const dx = p.x - press.sx;
    const dy = p.y - press.sy;
    if (!press.moved && Math.hypot(dx, dy) > TAP_SLOP) {
      press.moved = true;
      viewport.classList.add('is-panning');
    }
    if (press.moved) setPan(press.px + dx, press.py + dy);
  }

  function onUp(ev) {
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) pinch = 0;
    if (pointers.size === 0) endDrag();
  }

  // Capture phase on the viewport, so a drag's click is stopped before it can
  // reach the hex underneath. A keyboard Enter still produces a click with no
  // pointer gesture in front of it, and passes straight through.
  function onClick(ev) {
    if (!swallowClick) return;
    swallowClick = false;
    ev.stopPropagation();
    ev.preventDefault();
  }

  /**
   * An `overflow: hidden` box is still SCROLLABLE programmatically, and the
   * browser scrolls one to reveal a focused child — using that child's layout
   * position, which knows nothing about the transform this map moves by. Left
   * alone it drags the world sideways the moment you Tab or click a hex near
   * the edge. Undo it; reveal() has already done the same job properly.
   * Scroll steps run before paint, so nothing flickers.
   */
  function onScroll() {
    if (!viewport.scrollLeft && !viewport.scrollTop) return;
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
  }

  // Trackpad two-finger scroll arrives as wheel, not as pointers, so it must be
  // handled or it fights the drag by scrolling an ancestor instead.
  function onWheel(ev) {
    ev.preventDefault();
    const k = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? view.h : 1;
    if (ev.ctrlKey) {                       // pinch on a trackpad, ctrl+wheel on a mouse
      const p = local(ev);
      setZoom(zoom * (ev.deltaY < 0 ? 1.1 : 1 / 1.1), p.x, p.y);
      return;
    }
    setPan(pan.x - ev.deltaX * k, pan.y - ev.deltaY * k);
  }

  const spread = () => {
    const [a, b] = pointers.values();
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const midpoint = () => {
    const [a, b] = pointers.values();
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  off.listen(viewport, 'pointerdown', onDown);
  off.listen(window, 'pointermove', onMove);
  off.listen(window, 'pointerup', onUp);
  off.listen(window, 'pointercancel', onUp);
  off.listen(viewport, 'click', onClick, true);
  off.listen(viewport, 'wheel', onWheel, { passive: false });
  off.listen(viewport, 'scroll', onScroll);
  off.listen(viewport, 'dragstart', (ev) => ev.preventDefault());

  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(refit);
    ro.observe(viewport);
    off(() => ro.disconnect());
  }
  measure();

  return {
    get pan() { return { ...pan }; },
    get zoom() { return zoom; },
    get view() { return { ...view }; },
    get content() { return { ...content }; },

    /** Declare the world's size, then re-fit and re-clamp. Safe to call on a
     *  rebuild: the pan the player had is carried over, not reset. */
    setContent(w, hgt) {
      content.w = Math.max(1, w);
      content.h = Math.max(1, hgt);
      refit();
    },

    /** Put a content-space point in the middle of the window. */
    centre(cx, cy) {
      const p = centreOn(cx, cy, view, zoom);
      setPan(p.x, p.y);
    },

    /** Pan the least amount that brings an element fully into view. */
    reveal(el, pad = 24) {
      if (!el) return;
      onScroll();
      measure();
      setPan(
        revealAxis(pan.x, el.offsetLeft, el.offsetWidth, view.w, zoom, pad),
        revealAxis(pan.y, el.offsetTop, el.offsetHeight, view.h, zoom, pad),
      );
    },

    dispose: off.dispose,
  };
}
