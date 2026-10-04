// A rival leader's Grudge against you (PLAN-PHASE4 §4D): "Grudge 72/100", a bar with a notch at the warning line (50). Used on the Regions panel's rival rows
// and on a rival region's card. Built once and patched (the card refreshes every second). Browser only; plain data in.
import { h } from './dom.js';

/**
 * @typedef {Object} GrudgeData
 * @property {number} value
 * @property {number} max
 * @property {boolean} [warned]   past the warning line: the bar turns red
 * @property {boolean} [broken]   their capital is yours: they can swear no Vendetta
 * @property {string} [leader]    "Khan Bokbek", for the accessible name
 */

export function createGrudgeMeter() {
  const fill = h('span');
  const valueEl = h('span.grudge-value.nums', {}, '');
  const el = h('div.grudge-meter', { role: 'meter', 'aria-valuemin': '0' },
    h('span.grudge-label', { 'aria-hidden': 'true' }, 'Grudge'), h('span.grudge-track', { 'aria-hidden': 'true' }, fill), valueEl);
  let sig = '';
  /** @param {GrudgeData|null} g */
  function update(g) {
    if (!g) return;
    const s = `${Math.floor(g.value)}|${g.max}|${!!g.warned}|${!!g.broken}|${g.leader || ''}`;
    if (s === sig) return;
    sig = s;
    const v = Math.max(0, Math.min(g.max, Math.floor(g.value)));
    fill.style.width = `${g.max > 0 ? (100 * v) / g.max : 0}%`;
    valueEl.textContent = g.broken ? 'Broken' : `${v}/${g.max}`;
    el.classList.toggle('is-warned', !!g.warned && !g.broken);
    el.classList.toggle('is-broken', !!g.broken);
    el.setAttribute('aria-valuemax', String(g.max));
    el.setAttribute('aria-valuenow', String(v));
    const who = g.leader ? `${g.leader}'s grudge` : 'Grudge';
    const label = g.broken ? `${who}: broken, their capital is yours` : `${who}: ${v} of ${g.max}${g.warned ? ', a Vendetta is near' : ''}`;
    el.setAttribute('aria-label', label);
    el.title = g.broken ? 'Their capital is yours: they can swear no Vendetta.' : `At ${g.max} they swear a Vendetta and come for you in person.`;
  }
  return { el, update };
}
