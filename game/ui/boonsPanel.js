// The Realm panel's Phase 7 sections (PLAN-PHASE7, Integration): the owned-Boons strip and the Reliquary grid. Built once and patched (THE CLICK RULE).
//
// Why the Realm panel, not the War Council (lead asked for a call): the council is the gold sink and on a 360 px phone its upgrade cards already fill the
// screen, so a strip there pushes the thing you came to buy below the fold. The Realm panel is where "the rules this dynasty plays by" already live (the
// Edict line at the top), Boons last the dynasty like the Edict, and the strip sits right under that line: one compact row of 34 px icons that wraps.
// A tap (or hover / focus) on an icon shows its line under the strip, so the tooltip works on a finger, not only on a mouse.
// Browser only: plain data in (app/boons.js).
import { h } from './dom.js';
import { icon } from './icons.js';

const put = (node, t) => { if (node.textContent !== t) node.textContent = t; };
const RARITY_WORD = { common: 'Common', rare: 'Rare', legendary: 'Legendary', cursed: 'Cursed', duo: 'Duo', relic: 'Relic' };

/**
 * @typedef {Object} OwnedBoonView
 * @property {string} id
 * @property {string} name
 * @property {'common'|'rare'|'legendary'|'cursed'|'duo'} frame
 * @property {string} icon
 * @property {string} text
 * @property {number} [count]     the same Boon taken twice stacks: "×2"
 *
 * @typedef {Object} BoonStripData
 * @property {OwnedBoonView[]} owned    the Duos last
 * @property {boolean} [pending]        an offer is waiting: a "Choose" button in the header
 */

export function createBoonStrip({ onOpenDraft } = {}) {
  const countEl = h('small.nums', {}, '');
  const pendingBtn = h('button.btn.btn-secondary.btn-sm.boon-strip-pending', { type: 'button', onClick: () => onOpenDraft?.() }, icon('boonCard', 14), 'Choose your Boon');
  pendingBtn.hidden = true;
  const rowEl = h('div.boon-strip-row', { role: 'list', 'aria-label': 'Boons held this dynasty' });
  const emptyEl = h('p.boon-strip-empty', {}, 'Win a battle to choose your first Boon. They last the dynasty, and stack.');
  const detailName = h('strong', {}, '');
  const detailText = h('span', {}, '');
  const detailEl = h('p.boon-strip-detail', { 'aria-live': 'polite' }, detailName, detailText);
  detailEl.hidden = true;
  const el = h('section.boon-strip', { 'aria-label': 'Boons' },
    h('h3.realm-section-title', {}, icon('boonCard', 16), 'Boons', countEl, pendingBtn), rowEl, emptyEl, detailEl);
  el.hidden = true;
  const items = new Map(); // id -> { el, sig }
  let selected = '';
  let views = new Map();

  function showDetail(id) {
    const v = views.get(id);
    selected = v ? id : '';
    detailEl.hidden = !v;
    for (const [k, it] of items) it.el.classList.toggle('is-selected', k === selected);
    if (!v) return;
    put(detailName, `${v.name}${v.count > 1 ? ` ×${v.count}` : ''} · ${RARITY_WORD[v.frame] || ''}`);
    put(detailText, ` ${v.text}`);
  }

  /** @param {BoonStripData|null} d */
  function update(d) {
    if (!d) { el.hidden = true; return; }
    el.hidden = false;
    const list = d.owned || [];
    views = new Map(list.map((v) => [v.id, v]));
    put(countEl, list.length ? String(list.length) : '');
    pendingBtn.hidden = !d.pending;
    emptyEl.hidden = list.length > 0;
    // patch: keep each icon's button (a refresh between press and release must not swallow the tap)
    for (const [id, it] of items) if (!views.has(id)) { it.el.remove(); items.delete(id); }
    list.forEach((v, i) => {
      let it = items.get(v.id);
      const sig = `${v.icon}|${v.frame}|${v.count || 1}`;
      if (!it) {
        const b = h('button.boon-chip', { type: 'button', role: 'listitem', onClick: () => showDetail(v.id), onMouseenter: () => showDetail(v.id), onFocus: () => showDetail(v.id) });
        it = { el: b, sig: '' };
        items.set(v.id, it);
      }
      if (it.sig !== sig) {
        it.sig = sig;
        it.el.dataset.rarity = v.frame;
        it.el.replaceChildren(icon(v.icon, 20), v.count > 1 ? h('span.boon-chip-count.nums', {}, `×${v.count}`) : '');
      }
      const label = `${v.name}${v.count > 1 ? ` times ${v.count}` : ''}, ${RARITY_WORD[v.frame] || ''}: ${v.text}`;
      if (it.el.getAttribute('aria-label') !== label) { it.el.setAttribute('aria-label', label); it.el.title = `${v.name}: ${v.text}`; }
      if (rowEl.children[i] !== it.el) rowEl.insertBefore(it.el, rowEl.children[i] || null);
    });
    if (selected && views.has(selected)) showDetail(selected); else showDetail('');
  }
  return { el, update };
}

/**
 * @typedef {Object} RelicSlotView
 * @property {string} id
 * @property {string} name        shown only once found
 * @property {string} icon
 * @property {string} text
 * @property {boolean} found      ever found (kept across dynasties)
 * @property {boolean} [owned]    held this dynasty
 *
 * @typedef {Object} ReliquaryData
 * @property {RelicSlotView[]} slots
 * @property {number} found
 * @property {number} total
 */

export function createReliquary() {
  const countEl = h('small.nums', {}, '');
  const gridEl = h('div.reliquary-grid', { role: 'list', 'aria-label': 'Reliquary' });
  const detailName = h('strong', {}, '');
  const detailText = h('span', {}, '');
  const detailEl = h('p.reliquary-detail', { 'aria-live': 'polite' }, detailName, detailText);
  const introEl = h('p.reliquary-intro', {}, 'Relics lie in a few regions of every continent, marked by a glinting chest. Each one you find is kept here forever.');
  const el = h('section.reliquary', { 'aria-label': 'Reliquary' },
    h('h3.realm-section-title', {}, icon('chest', 16), 'Reliquary', countEl), introEl, gridEl, detailEl);
  el.hidden = true;
  detailEl.hidden = true;
  const slots = [];
  let views = [];
  let selected = -1;

  function showDetail(i) {
    const v = views[i];
    selected = v ? i : -1;
    slots.forEach((s, k) => s.el.classList.toggle('is-selected', k === selected));
    detailEl.hidden = !v;
    if (!v) return;
    put(detailName, v.found ? `${v.name}${v.owned ? ' · held this dynasty' : ''}` : 'Unknown Relic');
    put(detailText, v.found ? ` ${v.text}` : ' Not found yet. Look for a glinting chest on the map.');
  }

  function makeSlot(i) {
    const iconEl = h('span.reliquary-icon', { 'aria-hidden': 'true' });
    const nameEl = h('span.reliquary-name', {}, '');
    const b = h('button.reliquary-slot', { type: 'button', role: 'listitem', onClick: () => showDetail(i), onMouseenter: () => showDetail(i), onFocus: () => showDetail(i) }, iconEl, nameEl);
    return { el: b, iconEl, nameEl, sig: '' };
  }

  /** @param {ReliquaryData|null} d */
  function update(d) {
    if (!d) { el.hidden = true; return; }
    el.hidden = false;
    views = d.slots || [];
    put(countEl, `${d.found} / ${d.total} found · kept across dynasties`);
    while (slots.length < views.length) { const s = makeSlot(slots.length); slots.push(s); gridEl.appendChild(s.el); }
    slots.forEach((s, i) => {
      const v = views[i];
      s.el.hidden = !v;
      if (!v) return;
      const sig = `${v.id}|${v.found}|${v.owned}`;
      if (s.sig !== sig) {
        s.sig = sig;
        s.el.classList.toggle('is-found', !!v.found);
        s.el.classList.toggle('is-owned', !!v.owned);
        s.el.dataset.relic = v.found ? v.id : '';
        s.iconEl.replaceChildren(v.found ? icon(v.icon, 26) : icon('chest', 22));
        put(s.nameEl, v.found ? v.name : '?');
        s.el.setAttribute('aria-label', v.found ? `${v.name}${v.owned ? ', held this dynasty' : ''}: ${v.text}` : 'Unknown Relic, not found yet');
        s.el.title = v.found ? `${v.name}: ${v.text}` : 'Not found yet';
      }
    });
    if (selected >= 0) showDetail(selected);
  }
  return { el, update };
}
