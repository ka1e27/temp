// The Realm panel's Phase 5 sections (PLAN-PHASE5 §5A-§5C): this dynasty's Edict (crest, name, its two lines), the Challenge laurels it is sworn to, and
// the Legacy tree (spend any time). Built once and patched. Browser only; plain data in (app/dynasty.js).
import { h } from './dom.js';
import { icon } from './icons.js';
import { createLegacyTree } from './legacyTree.js';

const put = (node, t) => { if (node.textContent !== t) node.textContent = t; };

/**
 * @typedef {Object} RealmDynastyData
 * @property {{ id: string, name: string, icon: string, upside: string, cost: string }|null} edict
 * @property {{ id: string, name: string, icon: string, rule: string }[]} challenges   the ones sworn this dynasty
 * @property {string} [challengeNote]       "+50% Legacy points at the next founding for each one kept"
 * @property {import('./legacyTree.js').LegacyView|null} legacy   null until the first founding grants points (the tree still shows its nodes)
 */

/** The Edict and the Challenge laurels: one section, hidden on a first dynasty with neither. */
export function createEdictSection() {
  const crest = h('span.realm-edict-crest', { 'aria-hidden': 'true' });
  const name = h('span.realm-edict-name', {}, '');
  const up = h('span.edict-line.is-up', {}, icon('star', 12), h('span', {}, ''));
  const cost = h('span.edict-line.is-cost', {}, icon('flame', 12), h('span', {}, ''));
  const edictEl = h('div.realm-edict', {}, crest, h('div.realm-edict-text', {}, h('span.realm-edict-kicker', {}, 'Edict of this dynasty'), name, up, cost));
  const laurels = h('div.realm-laurels', { role: 'list', 'aria-label': 'Challenges sworn' });
  const note = h('p.realm-laurels-note', {}, '');
  const el = h('section.realm-dynasty-edict', { 'aria-label': 'Edict and Challenges' }, edictEl, laurels, note);
  el.hidden = true;
  let iconName = '';
  let laurelSig = '';

  /** @param {RealmDynastyData} d */
  function update(d) {
    if (!d) { el.hidden = true; return; }
    const e = d.edict;
    const list = d.challenges || [];
    el.hidden = !e && !list.length;
    edictEl.hidden = !e;
    if (e) {
      if (iconName !== e.icon) { iconName = e.icon; crest.replaceChildren(icon(e.icon, 40)); }
      put(name, e.name);
      put(up.lastChild, e.upside);
      put(cost.lastChild, e.cost);
      edictEl.setAttribute('aria-label', `Edict: ${e.name}. Gain: ${e.upside}. Price: ${e.cost}`);
    }
    const sig = list.map((c) => `${c.id}|${c.name}|${c.rule}`).join(';');
    if (sig !== laurelSig) {
      laurelSig = sig;
      laurels.replaceChildren(...list.map((c) => h('div.realm-laurel', { role: 'listitem', 'data-challenge': c.id, title: c.rule, 'aria-label': `${c.name}: ${c.rule}` },
        h('span.challenge-badge', { 'aria-hidden': 'true' }, icon('laurel', 30), h('span.challenge-badge-mark', {}, icon(c.icon, 12))),
        h('span.realm-laurel-name', {}, c.name))));
    }
    laurels.hidden = !list.length;
    put(note, list.length ? d.challengeNote || '' : '');
    note.hidden = !list.length || !d.challengeNote;
  }
  return { el, update };
}

/** The Legacy tree in the Realm panel. */
export function createLegacySection({ onBuy } = {}) {
  const tree = createLegacyTree({ onBuy, compact: true });
  const intro = h('p.realm-legacy-intro', {}, 'Legacy points come with every dynasty you found. Spend them here at any time: each node is kept forever.');
  const el = h('section.realm-legacy', { 'aria-label': 'Legacy' }, h('h3.realm-section-title', {}, icon('tree', 16), 'Legacy'), intro, tree.el);
  el.hidden = true;
  /** @param {import('./legacyTree.js').LegacyView|null} legacy */
  function update(legacy) {
    el.hidden = !legacy;
    if (legacy) tree.update(legacy);
  }
  return { el, update, tree };
}
