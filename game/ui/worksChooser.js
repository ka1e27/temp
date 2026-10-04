// The Works picker (DESIGN §5.8): the five Works as compact rows, each with its icon, name, one line of what it is
// worth, where it applies ("next door" or "here"), and its price; disabled with a visible reason when it cannot
// be built. Browser only; no game-logic imports: the integrator passes game/meta/works.js `worksPanelData(...)
// .choices` (the panel does this for you) and gets the pick back through `onPick`.
//
//   const chooser = createWorksChooser({ onPick: (type) => ... });
//   chooser.update({ choices, intro });
//
// Like the region card it lives in, it is BUILT ONCE and patched in place: the card refreshes about once a second, and a
// row rebuilt between a player's pointerdown and pointerup would swallow the tap. Rows are created on first sight and
// only their text, icon and `disabled` are touched afterwards, and only when they changed.
import { h } from './dom.js';
import { icon } from './icons.js';
import { worksIcon } from './worksIcons.js';
import { shortNumber } from './format.js';

/**
 * @typedef {Object} WorkChoice   (game/meta/works.js)
 * @property {string} type         'barracks' | 'stables' | 'shrine' | 'watchtower' | 'market'
 * @property {string} name
 * @property {string} effect       what one level is worth, one short line
 * @property {'next door'|'here'} scope
 * @property {number} cost         gold for level I
 * @property {boolean} affordable  can be built right now
 * @property {string|null} reason  why it cannot, e.g. "Need 34 more gold", "Already built here"
 * @property {number} [missing]    gold short of the price (shown under the price; the reason line then stays hidden)
 *
 * @typedef {Object} WorksChooserData
 * @property {WorkChoice[]} choices
 * @property {string} [intro]      one sentence under the title ("Next door = regions that border this one...")
 */

const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
const setData = (node, key, value) => { const v = String(value); if (node.dataset[key] !== v) node.dataset[key] = v; };
const setAttr = (node, key, value) => { if (node.getAttribute(key) !== value) node.setAttribute(key, value); };

/**
 * @param {{ onPick?: (type: string) => void }} [callbacks]
 */
export function createWorksChooser({ onPick, iconFor = worksIcon, listLabel = 'Works you can build' } = {}) {
  /** @type {Map<string, object>} one persistent row per Work type */
  const rows = new Map();
  let order = '';

  const introEl = h('p.works-chooser-intro', {}, '');
  const listEl = h('div.works-chooser-list', { role: 'list', 'aria-label': listLabel });
  const el = h('div.works-chooser', {}, introEl, listEl);

  function makeRow(type) {
    const iconHolder = h('span.works-chip', { dataset: { type } }, iconFor(type, 20));
    const nameEl = h('strong.works-choice-name', {}, '');
    const scopeEl = h('span.works-scope', {}, '');
    const effectEl = h('span.works-choice-effect', {}, '');
    const reasonEl = h('span.works-choice-reason', {}, '');
    const priceEl = h('span.works-choice-price', {});
    const missingEl = h('span.works-choice-missing', {});
    const costEl = h('span.works-choice-cost', {}, priceEl, missingEl);
    const btn = h('button.works-choice', {
      type: 'button', role: 'listitem',
      dataset: { type },
      onClick: () => { if (!btn.disabled) onPick?.(type); },
    },
    iconHolder,
    h('span.works-choice-main', {}, h('span.works-choice-head', {}, nameEl, scopeEl), effectEl, reasonEl),
    costEl);
    return { type, btn, nameEl, scopeEl, effectEl, reasonEl, costEl, priceEl, missingEl, costKey: '' };
  }

  function patchCost(row, cost, affordable, missing) {
    const key = `${cost}|${affordable ? 1 : 0}`;
    if (row.costKey !== key) {
      row.costKey = key;
      setData(row.costEl, 'poor', affordable ? '0' : '1');
      row.priceEl.replaceChildren(icon('coin', 13), h('span.nums', {}, shortNumber(cost)));
    }
    setText(row.missingEl, missing > 0 ? `need ${shortNumber(missing)} more` : '');
    if (row.missingEl.hidden !== !(missing > 0)) row.missingEl.hidden = !(missing > 0);
  }

  /** @param {WorksChooserData} data */
  function update(data) {
    if (!data) return;
    setText(introEl, data.intro || '');
    if (introEl.hidden !== !data.intro) introEl.hidden = !data.intro;
    const choices = data.choices || [];
    const sig = choices.map((c) => c.type).join(',');
    for (const c of choices) if (!rows.has(c.type)) rows.set(c.type, makeRow(c.type));
    if (sig !== order) {
      order = sig;
      listEl.replaceChildren(...choices.map((c) => rows.get(c.type).btn));
    }
    for (const c of choices) {
      const row = rows.get(c.type);
      setText(row.nameEl, c.name);
      // Only the exception is tagged: "here" (the Market). Everything else is "next door", said once by the intro.
      setText(row.scopeEl, c.scope || '');
      setData(row.scopeEl, 'scope', c.scope === 'here' ? 'here' : 'near');
      if (row.scopeEl.hidden !== (c.scope !== 'here')) row.scopeEl.hidden = c.scope !== 'here';
      setText(row.effectEl, c.effect);
      // A gold shortfall is said under the price (no extra row); any other reason gets its own line.
      const missing = c.missing || 0;
      setText(row.reasonEl, c.reason && missing === 0 ? c.reason : '');
      if (row.reasonEl.hidden !== !(c.reason && missing === 0)) row.reasonEl.hidden = !(c.reason && missing === 0);
      setData(row.btn, 'state', c.affordable ? 'ready' : (c.reason && /already/i.test(c.reason) ? 'built' : 'poor'));
      if (row.btn.disabled === c.affordable) row.btn.disabled = !c.affordable;
      patchCost(row, c.cost, c.affordable, missing);
      const tip = c.affordable ? `Build ${c.name}: ${c.effect}` : `${c.name}: ${c.reason || 'unavailable'}`;
      if (row.btn.title !== tip) row.btn.title = tip;
      setAttr(row.btn, 'aria-label', `${c.name}, ${c.effect}${c.scope ? `, ${c.scope}` : ''}. ${c.affordable ? `Costs ${shortNumber(c.cost)} gold` : c.reason || 'Unavailable'}`);
    }
  }

  /** The row button for a Work type (for a tutorial pointer), or null. */
  function row(type) {
    const r = rows.get(type);
    return r && r.btn.isConnected ? r.btn : null;
  }

  function destroy() {
    el.replaceChildren();
    rows.clear();
  }

  return { el, update, row, destroy };
}
