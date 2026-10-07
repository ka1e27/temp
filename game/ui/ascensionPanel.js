// The Realm panel's Ascension ladder (PLAN-PHASE13 §13C): shown once the Crown of Ages has been won. A small ladder of the ten levels, cleared
// rungs lit gold, the dynasty's own level marked, the next one open and the rest locked; each rung says the modifier it adds. Also the crown pips
// for the dynasty banner (one per level cleared). Browser only: app/crown.js builds the data from the pure module.
import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * @typedef {Object} AscensionView
 * @property {number} highest        the highest level cleared (0 = none yet)
 * @property {number} current        this dynasty's level (0 = none)
 * @property {number} open           the highest level a founding may choose now (highest + 1, capped)
 * @property {{ level: number, text: string, legacy: string }[]} levels   1..10
 * @property {string} [note]
 */

const put = (node, t) => { if (node.textContent !== t) node.textContent = t; };

export function createAscensionSection() {
  const summary = h('p.ascension-summary', {}, '');
  const note = h('p.ascension-note', {}, '');
  const ladder = h('ol.ascension-ladder', { 'aria-label': 'The Ascension ladder' });
  const el = h('section.ascension-section', {},
    h('h3.realm-section-title', {}, icon('ascension', 16), 'Ascension', h('small', {}, 'kept forever')), summary, ladder, note);
  el.hidden = true;
  const rungs = new Map();

  function rung(lv) {
    const num = h('span.ascension-rung-num.nums', {}, String(lv.level));
    const text = h('span.ascension-rung-text', {}, '');
    const tag = h('span.ascension-rung-tag', {}, '');
    const li = h('li.ascension-rung', { 'data-level': String(lv.level) }, num, h('span.ascension-rung-body', {}, text, tag));
    const r = { li, text, tag };
    rungs.set(lv.level, r);
    return r;
  }

  /** @param {AscensionView|null} d */
  function update(d) {
    el.hidden = !d;
    if (!d) return;
    put(summary, d.highest ? `Highest cleared: Ascension ${d.highest}.${d.current ? ` This dynasty: Ascension ${d.current}.` : ''}` : `No Ascension cleared yet.${d.current ? ` This dynasty: Ascension ${d.current}.` : ' Choose one at your next founding.'}`);
    put(note, d.note || '');
    note.hidden = !d.note;
    // highest level at the top: a ladder you climb
    const order = d.levels.slice().sort((a, b) => b.level - a.level);
    const sig = order.map((x) => x.level).join(',');
    if (ladder.dataset.sig !== sig) { ladder.dataset.sig = sig; rungs.clear(); ladder.replaceChildren(...order.map((lv) => rung(lv).li)); }
    for (const lv of order) {
      const r = rungs.get(lv.level);
      const cleared = lv.level <= d.highest;
      const isCurrent = lv.level === d.current;
      const open = !cleared && lv.level <= d.open;
      const state = cleared ? 'cleared' : open ? 'open' : 'locked';
      if (r.li.dataset.state !== state) r.li.dataset.state = state;
      r.li.classList.toggle('is-current', isCurrent);
      put(r.text, lv.text);
      put(r.tag, isCurrent ? `This dynasty · ${lv.legacy}` : cleared ? `Cleared · ${lv.legacy}` : open ? `Open · ${lv.legacy}` : 'Locked');
      r.li.setAttribute('aria-label', `Ascension ${lv.level}: ${lv.text}. ${r.tag.textContent}`);
    }
  }

  return { el, update };
}

/** Crown pips for the dynasty banner (one per Ascension cleared); returns the element (empty when none). */
export function crownPipsEl(n) {
  const k = Math.max(0, n | 0);
  return h('span.realm-crown-pips', { 'aria-label': k ? `Ascension ${k} cleared` : null, role: k ? 'img' : null },
    ...Array.from({ length: k }, () => h('span.realm-crown-pip', { 'aria-hidden': 'true' }, icon('crown', 12))));
}
