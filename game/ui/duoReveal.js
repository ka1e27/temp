// The Duo reveal (PLAN-PHASE7 §7A): when a pick completes a Duo, the two Boons' icons slide together, merge in a flash, and the Duo's mark and name rise
// out of it, with one line of what it does. About 3 s, a tap or Escape skips it; under Reduce Motion it is the final frame, held, with no movement.
// Not a dialog (it takes no focus and blocks nothing for long): a polite live region says it. Browser only; plain data in.
import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * @typedef {Object} DuoView
 * @property {string} id
 * @property {string} name          "Fire Arrows"
 * @property {string} icon          the Duo's own mark
 * @property {string} text          what it does
 * @property {{ name: string, icon: string }[]} parts   the two Boons it joins
 */

const HOLD_MS = 3400;
const STILL_HOLD_MS = 3000;

export function createDuoReveal({ onDone } = {}) {
  const leftEl = h('span.duo-part.duo-part-left', { 'aria-hidden': 'true' });
  const rightEl = h('span.duo-part.duo-part-right', { 'aria-hidden': 'true' });
  const flashEl = h('span.duo-flash', { 'aria-hidden': 'true' });
  const markEl = h('span.duo-mark', { 'aria-hidden': 'true' });
  const kickerEl = h('span.duo-kicker', {}, 'Duo Boon');
  const nameEl = h('span.duo-name', {}, '');
  const partsEl = h('span.duo-parts', {}, '');
  const textEl = h('span.duo-text', {}, '');
  const statusEl = h('p.visually-hidden', { role: 'status', 'aria-live': 'polite' }, '');
  const stage = h('div.duo-stage', {}, leftEl, rightEl, flashEl, markEl);
  const el = h('div.duo-reveal', { 'data-keep-live': '' }, h('div.duo-veil', { 'aria-hidden': 'true' }),
    h('div.duo-card', {}, stage, h('div.duo-words', {}, kickerEl, nameEl, partsEl, textEl)), statusEl);
  el.hidden = true;
  let timer = 0;
  let current = null;

  const done = () => {
    if (el.hidden) return;
    clearTimeout(timer);
    el.hidden = true;
    el.classList.remove('is-playing');
    window.removeEventListener('keydown', onKey, true);
    const d = current;
    current = null;
    onDone?.(d);
  };
  const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); done(); } };
  el.addEventListener('click', () => done());

  /** @param {DuoView} d */
  function play(d) {
    if (!d) return;
    current = d;
    const [a, b] = d.parts || [];
    leftEl.replaceChildren(icon(a ? a.icon : 'boonCard', 34));
    rightEl.replaceChildren(icon(b ? b.icon : 'boonCard', 34));
    markEl.replaceChildren(icon(d.icon || 'duoLink', 54));
    nameEl.textContent = d.name;
    partsEl.textContent = a && b ? `${a.name} + ${b.name}` : '';
    textEl.textContent = d.text;
    const still = document.documentElement.classList.contains('reduce-motion');
    el.classList.toggle('is-still', still);
    el.classList.remove('is-playing');
    el.hidden = false;
    void el.offsetWidth;
    el.classList.add('is-playing');
    statusEl.textContent = '';
    setTimeout(() => { statusEl.textContent = `Duo Boon unlocked: ${d.name}. ${d.text}`; }, 200);
    clearTimeout(timer);
    timer = setTimeout(done, still ? STILL_HOLD_MS : HOLD_MS);
    window.addEventListener('keydown', onKey, true);
  }

  return { el, play, skip: done, get playing() { return !el.hidden; }, destroy() { clearTimeout(timer); } };
}
