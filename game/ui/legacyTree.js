// The Legacy tree (PLAN-PHASE5 §5B): three branches (War, Realm, Court) of five nodes each, bought with Legacy points that persist across dynasties.
// One component, mounted twice: in the founding ceremony (page 2) and in the Realm panel (spend any time). Built once per node and patched in place
// (THE CLICK RULE: a Buy press must survive the refreshes). Browser only; plain data in (app/dynasty.js builds it from game/meta/legacy.js).
import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * @typedef {Object} LegacyNodeView
 * @property {string} id
 * @property {string} name
 * @property {number} cost
 * @property {string} effect          one line, from config numbers
 * @property {'owned'|'affordable'|'short'|'locked'} state   owned; can buy now; next in line but not enough points; needs the node before it
 * @property {string} [reason]        why it cannot be bought ("Needs Veteran Camp", "2 more points")
 *
 * @typedef {Object} LegacyBranchView
 * @property {string} id
 * @property {string} name            "War"
 * @property {string} icon            an icons.js name (legacyWar, legacyRealm, legacyCourt)
 * @property {LegacyNodeView[]} nodes
 *
 * @typedef {Object} LegacyView
 * @property {number} available       points to spend now
 * @property {number} [spent]
 * @property {LegacyBranchView[]} branches
 */

const put = (node, t) => { if (node.textContent !== t) node.textContent = t; };
const setAttr = (node, k, v) => { if (node.getAttribute(k) !== v) node.setAttribute(k, v); };

/**
 * @param {{ onBuy?: (nodeId: string) => void, compact?: boolean }} [opts]
 *   compact: the Realm panel's narrower layout (the branch tabs are always used)
 */
export function createLegacyTree({ onBuy, compact = false } = {}) {
  const pointsNum = h('span.nums', {}, '0');
  const pointsEl = h('span.legacy-points', { title: 'Legacy points to spend' }, icon('tree', 16), pointsNum, h('span.legacy-points-word', {}, 'Legacy points'));
  const tabs = h('div.legacy-tabs', { role: 'tablist', 'aria-label': 'Legacy branches' });
  const cols = h('div.legacy-branches');
  const status = h('p.legacy-status', { role: 'status', 'aria-live': 'polite' }, '');
  const el = h(`div.legacy-tree${compact ? '.is-compact' : ''}`, {}, h('div.legacy-head', {}, pointsEl, tabs), cols, status);

  const branches = new Map(); // id -> { tab, col, nodes: Map }
  let active = null;
  let statusTimer = 0;

  function select(id) {
    active = id;
    for (const [bid, b] of branches) {
      const on = bid === id;
      b.tab.classList.toggle('is-active', on);
      setAttr(b.tab, 'aria-selected', on ? 'true' : 'false');
      b.tab.tabIndex = on ? 0 : -1;
      b.col.classList.toggle('is-active', on);
    }
  }

  function buildBranch(b) {
    const tab = h('button.legacy-tab', { type: 'button', role: 'tab', onClick: () => select(b.id) }, icon(b.icon, 18), h('span', {}, b.name));
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const ids = [...branches.keys()];
      const i = ids.indexOf(b.id);
      const next = ids[(i + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length];
      select(next);
      branches.get(next).tab.focus();
      e.preventDefault();
    });
    const list = h('ol.legacy-nodes');
    const col = h('section.legacy-branch', { 'data-branch': b.id, role: 'tabpanel', 'aria-label': `${b.name} branch` },
      h('h4.legacy-branch-title', {}, icon(b.icon, 22), h('span', {}, b.name)), list);
    tabs.appendChild(tab);
    cols.appendChild(col);
    const rec = { tab, col, list, nodes: new Map() };
    branches.set(b.id, rec);
    return rec;
  }

  function buildNode(rec, n) {
    const name = h('span.legacy-node-name', {}, '');
    const cost = h('span.legacy-node-cost.nums', {}, '');
    const effect = h('span.legacy-node-effect', {}, '');
    const reason = h('span.legacy-node-reason', {}, '');
    const mark = h('span.legacy-node-mark', { 'aria-hidden': 'true' });
    const buyLabel = h('span', {}, 'Buy');
    const buy = h('button.btn.btn-primary.legacy-buy', { type: 'button', onClick: () => onBuy?.(n.id) }, buyLabel);
    const li = h('li.legacy-node', { 'data-node': n.id }, mark,
      h('div.legacy-node-text', {}, h('div.legacy-node-top', {}, name, cost), effect, reason), buy);
    rec.list.appendChild(li);
    const node = { li, name, cost, effect, reason, mark, buy, buyLabel, markState: '' };
    rec.nodes.set(n.id, node);
    return node;
  }

  /** @param {LegacyView|null} data */
  function update(data) {
    if (!data) return;
    put(pointsNum, String(data.available ?? 0));
    for (const b of data.branches || []) {
      const rec = branches.get(b.id) || buildBranch(b);
      b.nodes.forEach((n, i) => {
        const node = rec.nodes.get(n.id) || buildNode(rec, n);
        if (rec.list.children[i] !== node.li) rec.list.insertBefore(node.li, rec.list.children[i] || null);
        put(node.name, n.name);
        put(node.cost, n.state === 'owned' ? 'Owned' : `${n.cost} pt${n.cost === 1 ? '' : 's'}`);
        put(node.effect, n.effect || '');
        const why = n.state === 'owned' || n.state === 'affordable' ? '' : n.reason || '';
        put(node.reason, why);
        node.reason.hidden = !why;
        if (node.li.dataset.state !== n.state) node.li.dataset.state = n.state;
        if (node.markState !== n.state) {
          node.markState = n.state;
          node.mark.replaceChildren(icon(n.state === 'owned' ? 'star' : n.state === 'locked' ? 'lock' : 'tree', 14));
        }
        // the Buy button lives for the node's whole life: it hides once owned, and is greyed (still focusable, it says why) when it cannot be bought
        node.buy.hidden = n.state === 'owned';
        const can = n.state === 'affordable';
        setAttr(node.buy, 'aria-disabled', can ? 'false' : 'true');
        node.buy.classList.toggle('is-off', !can);
        put(node.buyLabel, `Buy · ${n.cost}`);
        setAttr(node.buy, 'aria-label', `Buy ${n.name} for ${n.cost} Legacy point${n.cost === 1 ? '' : 's'}${can ? '' : `: ${why || 'not available'}`}`);
        setAttr(node.li, 'aria-label', `${n.name}, ${n.state === 'owned' ? 'owned' : `${n.cost} points`}. ${n.effect || ''}${why ? ` ${why}.` : ''}`);
      });
    }
    if (active == null && branches.size) select(branches.keys().next().value);
  }

  /** A line under the tree ("Bought Veteran Camp", "Not enough points"): never a toast over the dialog. */
  function setStatus(text, kind = 'success') {
    put(status, text || '');
    status.dataset.kind = kind;
    clearTimeout(statusTimer);
    if (text) statusTimer = setTimeout(() => put(status, ''), 4000);
  }

  return { el, update, setStatus, select, buyButton: (id) => { for (const b of branches.values()) { const n = b.nodes.get(id); if (n) return n.buy; } return null; } };
}
