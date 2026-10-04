// The Relic claim moment (PLAN-PHASE7 §7B): after a conquest that held a Relic, the chest opens into the Relic's mark on slow golden rays, with its name,
// what it does, and "Kept in your Reliquary" (or "New to your Reliquary"). About 3.5 s; a tap, Enter or Escape skips it; Reduce Motion holds a still frame.
// Not a dialog (no focus taken): a polite live region says it. Browser only; plain data in.
import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * @typedef {Object} RelicClaimView
 * @property {string} id
 * @property {string} name
 * @property {string} icon
 * @property {string} text
 * @property {boolean} [isNew]     first time ever found: "New to your Reliquary"
 * @property {string} [regionName]
 */

export function createRelicClaim({ onDone } = {}) {
  const iconEl = h('span.relic-claim-icon', { 'aria-hidden': 'true' });
  const kickerEl = h('span.relic-claim-kicker', {}, 'Relic claimed');
  const nameEl = h('span.relic-claim-name', {}, '');
  const textEl = h('span.relic-claim-text', {}, '');
  const noteEl = h('span.relic-claim-note', {}, '');
  const statusEl = h('p.visually-hidden', { role: 'status', 'aria-live': 'polite' }, '');
  const el = h('div.relic-claim', { 'data-keep-live': '' }, h('div.relic-claim-veil', { 'aria-hidden': 'true' }),
    h('div.relic-claim-card', {}, h('div.relic-claim-art', {}, h('span.relic-claim-rays', { 'aria-hidden': 'true' }), iconEl),
      h('div.relic-claim-words', {}, kickerEl, nameEl, textEl, noteEl)), statusEl);
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

  /** @param {RelicClaimView} d */
  function play(d) {
    if (!d) return;
    current = d;
    iconEl.replaceChildren(icon(d.icon || 'chest', 56));
    kickerEl.textContent = d.regionName ? `Relic claimed in ${d.regionName}` : 'Relic claimed';
    nameEl.textContent = d.name;
    textEl.textContent = d.text;
    noteEl.textContent = d.isNew ? 'New to your Reliquary. It serves you for the rest of this dynasty.' : 'It serves you for the rest of this dynasty.';
    el.classList.remove('is-playing');
    el.hidden = false;
    void el.offsetWidth;
    el.classList.add('is-playing');
    statusEl.textContent = '';
    setTimeout(() => { statusEl.textContent = `Relic claimed: ${d.name}. ${d.text}`; }, 200);
    clearTimeout(timer);
    timer = setTimeout(done, 3600);
    window.addEventListener('keydown', onKey, true);
  }

  return { el, play, skip: done, get playing() { return !el.hidden; }, destroy() { clearTimeout(timer); } };
}
