// Non-blocking coach mark (DESIGN §6). Browser only; no game-logic imports.
// Points an arrow + a pulsing highlight ring at a screen point or a live
// DOM element (re-measured every frame while visible, since the map it
// usually points at pans/zooms under it).
import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * @typedef {Object} CoachData
 * @property {boolean} visible
 * @property {string} [text]
 * @property {{ x: number, y: number, side?: 'up'|'down' } | { el: HTMLElement }} [target]  screen point, or an element
 *   to track. A point may force the bubble ABOVE (`side: 'up'`) or BELOW it; the default is above when the point
 *   is in the lower 40% of the screen.
 * @property {() => void} [onDismiss]  what the × does for THIS hint (default: the tutorial's skip-this-step)
 * @property {HTMLElement} [avoid]  an element the bubble must not cover (it is lifted clear of it)
 */

/**
 * @param {{ onDismiss?: () => void }} [callbacks]
 */
export function createCoach({ onDismiss } = {}) {
  let localDismiss = null; // a hint that is not a tutorial step brings its own × (skipping a tutorial step would be wrong for it)
  let rafId = null;
  let target = null;
  let avoidEl = null;

  const textEl = h('p.coach-text', {}, '');
  const bubble = h('div.coach-bubble', {},
    textEl,
    h('button.coach-dismiss', { onClick: () => (localDismiss || onDismiss)?.(), 'aria-label': 'Dismiss hint' }, icon('close', 12)),
  );
  const ring = h('div.coach-ring', {});
  const el = h('div.coach', { hidden: true }, ring, bubble);

  function targetPoint() {
    if (!target) return null;
    // A screen POINT gets a fixed-size ring; an ELEMENT gets a ring sized to it.
    if (typeof target.x === 'number') return { x: target.x, y: target.y, w: 8, h: 8, side: target.side, gap: target.gap || 0 };
    if (target.el && target.el.isConnected) {
      const r = target.el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    }
    return null;
  }

  function place() {
    const p = targetPoint();
    if (!p) return;

    const ringSize = Math.max(p.w, p.h, 36) + 16;
    ring.style.width = `${ringSize}px`;
    ring.style.height = `${ringSize}px`;
    ring.style.left = `${p.x}px`;
    ring.style.top = `${p.y}px`;

    const vh = window.innerHeight;
    // Target in the lower part of the screen → the bubble sits above it (unless the caller says which side).
    const pointsUp = p.side ? p.side === 'up' : p.y > vh * 0.6;
    bubble.classList.toggle('arrow-down', !pointsUp);
    bubble.classList.toggle('arrow-up', pointsUp);

    const bubbleRect = bubble.getBoundingClientRect();
    const margin = 12;
    let x = p.x - bubbleRect.width / 2;
    x = Math.max(margin, Math.min(window.innerWidth - bubbleRect.width - margin, x));
    const gap = p.gap || 0; // extra clearance between the target and the bubble (a point target inside a panel, like the card's Attack button)
    let y = pointsUp ? p.y - p.h / 2 - bubbleRect.height - 22 - gap : p.y + p.h / 2 + 22 + gap;
    if (pointsUp && avoidEl && avoidEl.isConnected) {
      const a = avoidEl.getBoundingClientRect();
      if (a.width > 0) y = Math.min(y, a.top - bubbleRect.height - 10);
    }
    bubble.style.left = `${x}px`;
    bubble.style.top = `${Math.max(margin, y)}px`;
  }

  function loop() {
    place();
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  /**
   * Safe to call every frame: it only swaps the text/target the running placement loop reads,
   * and starts/stops that loop when visibility changes (no cancel + restart per call).
   * @param {CoachData} data
   */
  function update(data) {
    if (!data) return;
    if (data.text != null && data.text !== textEl.textContent) textEl.textContent = data.text;
    target = data.target || null;
    localDismiss = data.onDismiss || null;
    avoidEl = data.avoid || null;
    const show = !!data.visible && !!target;
    if (el.hidden === show) el.hidden = !show;
    if (show) {
      if (rafId == null) loop();
    } else {
      stop();
    }
  }

  function destroy() {
    stop();
  }

  return { el, update, destroy };
}
