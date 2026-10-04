// The Realm panel's Phase 5 sections (PLAN-PHASE5 §5A-§5C): this dynasty's Edict (crest, name, its two lines), the Challenge laurels it is sworn to, and
// the Legacy tree (spend any time). Built once and patched. Browser only; plain data in (app/dynasty.js).
import { h } from './dom.js';
import { icon } from './icons.js';
import { createLegacyTree } from './legacyTree.js';

const put = (node, t) => { if (node.textContent !== t) node.textContent = t; };
const NL = String.fromCharCode(10); // a line break inside a tooltip

/**
 * @typedef {Object} RealmDynastyData
 * @property {{ id: string, name: string, icon: string, upside: string, cost: string }|null} edict
 * @property {{ id: string, name: string, icon: string, rule: string }[]} challenges   the ones sworn this dynasty
 * @property {string} [challengeNote]       "+50% Legacy points at the next founding for each one kept"
 * @property {import('./legacyTree.js').LegacyView|null} legacy   null until the first founding grants points (the tree still shows its nodes)
 */

/**
 * The Edict and the Challenge laurels as ONE compact line near the top of the Realm panel (lead decision 2026-10-04: Dynasty first when the continent is
 * won, then this line, then the Chronicle): a small crest, "Edict: {name}", the sworn Challenges as small laurels. The Edict's gain and price ride in its
 * tooltip and accessible name. Hidden on a first dynasty with neither.
 */
export function createEdictSection() {
  const crest = h('span.realm-edict-crest', { 'aria-hidden': 'true' });
  const name = h('span.realm-edict-name', {}, '');
  const edictEl = h('span.realm-edict', {}, crest, h('span.realm-edict-kicker', {}, 'Edict'), name);
  const laurels = h('span.realm-laurels', { role: 'list', 'aria-label': 'Challenges sworn' });
  const el = h('section.realm-dynasty-edict', { 'aria-label': 'Edict and Challenges' }, edictEl, laurels);
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
      if (iconName !== e.icon) { iconName = e.icon; crest.replaceChildren(icon(e.icon, 22)); }
      put(name, e.name);
      const label = `Edict: ${e.name}. Gain: ${e.upside}. Price: ${e.cost}`;
      edictEl.setAttribute('aria-label', label);
      edictEl.title = [e.upside, e.cost].join(NL);
    }
    const sig = list.map((c) => `${c.id}|${c.name}|${c.rule}`).join(';') + `|${d.challengeNote || ''}`;
    if (sig !== laurelSig) {
      laurelSig = sig;
      const tip = (c) => (d.challengeNote ? [c.rule, d.challengeNote].join(NL) : c.rule);
      laurels.replaceChildren(...list.map((c) => h('span.realm-laurel', { role: 'listitem', 'data-challenge': c.id, title: tip(c), 'aria-label': `${c.name}: ${c.rule}` },
        h('span.challenge-badge', { 'aria-hidden': 'true' }, icon('laurel', 18), h('span.challenge-badge-mark', {}, icon(c.icon, 8))),
        h('span.realm-laurel-name', {}, c.name))));
    }
    laurels.hidden = !list.length;
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
