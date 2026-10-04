// The Realm panel's Phase 4 sections (PLAN-PHASE4 §4C, §4D): the Deeds grid (lifetime milestones in bronze, silver and gold, kept across dynasties) and the
// Trophy wall (a defeated Vendetta's banner, +attack against that faction for the rest of the dynasty). Built once per deed / trophy and patched.
// Browser only; plain data in (the scene builds it from game/meta/deeds.js and the trophies).
import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * @typedef {Object} DeedCell
 * @property {string} id
 * @property {string} name          "Conqueror"
 * @property {string} icon          an icons.js name
 * @property {number} tier          tiers earned (0 = none yet)
 * @property {number} maxTier
 * @property {number} progress      toward the next tier (or the last goal once maxed)
 * @property {number} goal
 * @property {string} line          "Conquer 50 regions · +1% income" (what the next tier asks and grants), or what it grants once maxed
 *
 * @typedef {Object} TrophyCell
 * @property {number} faction
 * @property {string} name          "the Crimson Legion"
 * @property {string} emblem
 * @property {string} color
 * @property {number} count         banners taken (stacks to the config's cap)
 * @property {string} bonus         "+10% attack against them"
 */

const put = (node, t) => { if (node.textContent !== t) node.textContent = t; };

export function createDeedsSection() {
  const countEl = h('small', {}, '');
  const grid = h('div.deeds-grid', { role: 'list' });
  const note = h('p.deeds-note', {}, 'Deeds are kept forever: across every dynasty to come.');
  const el = h('section.realm-deeds', { 'aria-label': 'Deeds' }, h('h3.realm-section-title', {}, icon('star', 16), 'Deeds', countEl), grid, note);
  el.hidden = true;
  const cells = new Map();

  /** @param {DeedCell[]|null} list */
  function update(list) {
    el.hidden = !list || !list.length;
    if (!list) return;
    let earned = 0;
    let total = 0;
    list.forEach((d, i) => {
      earned += d.tier;
      total += d.maxTier;
      let c = cells.get(d.id);
      if (!c) {
        const medal = h('span.deed-medal', { 'aria-hidden': 'true' }, icon(d.icon || 'star', 18));
        const nameText = h('span', {}, '');
        const pips = h('span.deed-pips', { 'aria-hidden': 'true' });
        const name = h('span.deed-name', {}, nameText, pips);
        const barFill = h('span');
        const line = h('span.deed-line', {}, '');
        c = { el: h('div.deed', { role: 'listitem', 'data-deed': d.id }, medal, name, h('div.deed-bar', { 'aria-hidden': 'true' }, barFill), line), nameText, pips, barFill, line, pipKey: '' };
        cells.set(d.id, c);
      }
      put(c.nameText, d.name);
      const pipKey = `${d.tier}/${d.maxTier}`;
      if (c.pipKey !== pipKey) {
        c.pipKey = pipKey;
        c.pips.replaceChildren(...Array.from({ length: d.maxTier }, (_, k) => h(`i${k < d.tier ? '.on' : ''}`)));
      }
      const maxed = d.tier >= d.maxTier;
      const goal = Math.max(1, d.goal || 1);
      const frac = maxed ? 1 : Math.max(0, Math.min(1, (d.progress || 0) / goal));
      c.barFill.style.width = `${Math.round(frac * 100)}%`;
      put(c.line, d.line || '');
      if (c.el.dataset.tier !== String(d.tier)) c.el.dataset.tier = String(d.tier);
      c.el.classList.toggle('is-maxed', maxed);
      const tierWord = ['not yet earned', 'bronze', 'silver', 'gold'][Math.min(3, d.tier)] || `tier ${d.tier}`;
      const label = `${d.name}: ${tierWord}${maxed ? ', complete' : `, ${Math.floor(d.progress || 0)} of ${goal}`}. ${d.line || ''}`;
      if (c.el.getAttribute('aria-label') !== label) c.el.setAttribute('aria-label', label);
      if (grid.children[i] !== c.el) grid.insertBefore(c.el, grid.children[i] || null);
    });
    put(countEl, `${earned} / ${total}`);
  }
  return { el, update };
}

export function createTrophySection() {
  const wall = h('div.trophy-wall', { role: 'list' });
  const empty = h('p.trophy-empty', {}, 'No banners yet. Beat a rival leader’s Vendetta to hang theirs here.');
  const el = h('section.realm-trophies', { 'aria-label': 'Trophy wall' }, h('h3.realm-section-title', {}, icon('pennant', 16), 'Trophy wall'), wall);
  el.hidden = true;
  const cells = new Map();
  /** @param {{ show: boolean, trophies: TrophyCell[] }|null} data */
  function update(data) {
    el.hidden = !data || !data.show;
    if (!data) return;
    const list = data.trophies || [];
    const keep = new Set();
    list.forEach((t, i) => {
      keep.add(t.faction);
      let c = cells.get(t.faction);
      if (!c) {
        const banner = h('span.trophy-banner', { 'aria-hidden': 'true' }, icon(t.emblem || 'flag', 20));
        const count = h('span.trophy-count.nums', { 'aria-hidden': 'true' }, '');
        const label = h('span.trophy-label', {}, '');
        c = { el: h('div.trophy', { role: 'listitem', 'data-faction': String(t.faction) }, banner, count, label), banner, count, label };
        cells.set(t.faction, c);
      }
      c.banner.style.setProperty('--chip-color', t.color || '#c63932');
      c.el.style.setProperty('--chip-color', t.color || '#c63932');
      put(c.count, `×${t.count}`);
      c.count.hidden = t.count <= 1;
      put(c.label, t.name.replace(/^the /i, ''));
      const aria = `${t.name}'s banner${t.count > 1 ? `, ${t.count} taken` : ''}: ${t.bonus}`;
      if (c.el.getAttribute('aria-label') !== aria) { c.el.setAttribute('aria-label', aria); c.el.title = `${t.name}: ${t.bonus}`; }
      if (wall.children[i] !== c.el) wall.insertBefore(c.el, wall.children[i] || null);
    });
    for (const [f, c] of cells) if (!keep.has(f)) { c.el.remove(); cells.delete(f); }
    if (!list.length) { if (empty.parentNode !== wall) wall.appendChild(empty); } else if (empty.parentNode) empty.remove();
  }
  return { el, update };
}
