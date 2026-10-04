// Quick Conquest's short overlay (PLAN-PHASE5 §5D): "Your commander marches on {region}…" with a progress bar, while app/dynasty.js time-slices the headless
// battle across animation frames. Click-through-proof (it is a dialog for its second or two), no buttons to lose. Browser only.
import { h } from './dom.js';
import { icon } from './icons.js';

const put = (node, t) => { if (node.textContent !== t) node.textContent = t; };

export function createQuickOverlay() {
  const title = h('p.quick-title', {}, '');
  const sub = h('p.quick-sub', {}, '');
  const fill = h('span.quick-fill');
  const bar = h('div.quick-bar', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', 'aria-label': 'Quick Conquest' }, fill);
  const panel = h('div.quick-panel.glass-panel', { role: 'status', 'aria-live': 'polite' },
    h('span.quick-emblem', { 'aria-hidden': 'true' }, icon('swords', 28)), title, sub, bar);
  const el = h('div.quick-overlay', {}, panel);
  el.hidden = true;

  /** @param {{ region: string, commander: string, progress: number }} d */
  function update(d) {
    if (!d) return;
    put(title, `${d.commander} marches on ${d.region}…`);
    put(sub, 'Quick Conquest');
    const pct = Math.round(Math.max(0, Math.min(1, d.progress || 0)) * 100);
    fill.style.width = `${pct}%`;
    if (bar.getAttribute('aria-valuenow') !== String(pct)) bar.setAttribute('aria-valuenow', String(pct));
  }
  return { el, update, destroy() {} };
}
