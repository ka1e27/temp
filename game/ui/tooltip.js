// Pointer-following tooltip (DESIGN §4.3 drag-to-send preview). Browser
// only; no game-logic imports. Snaps directly to the pointer position (no
// smoothing lag) since it's meant to feel precise during a drag.
import { h } from './dom.js';

const OFFSET_X = 16;
const OFFSET_Y = 20;

export function createTooltip() {
  const textEl = h('span.tooltip-text', {}, '');
  const el = h('div.tooltip', { hidden: true }, textEl);

  /** @param {{ visible: boolean, x?: number, y?: number, text?: string }} data */
  function update(data) {
    if (!data) return;
    if (data.text != null) textEl.textContent = data.text;
    if (typeof data.x === 'number' && typeof data.y === 'number') {
      const maxX = window.innerWidth - el.offsetWidth - OFFSET_X;
      const x = Math.min(data.x + OFFSET_X, Math.max(OFFSET_X, maxX));
      el.style.left = `${x}px`;
      el.style.top = `${data.y + OFFSET_Y}px`;
    }
    el.hidden = !data.visible;
  }

  function destroy() {}

  return { el, update, destroy };
}
