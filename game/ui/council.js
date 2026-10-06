// War Council panel (DESIGN §5.2). Browser only; no game-logic imports — the
// integrator resolves each upgrade's current/next effect text and cost via
// game/meta/upgrades.js and passes the finished view data in.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { shortNumber } from './format.js';
import { watchDialog } from './dialogs.js';

const TABS = [['army', 'Army'], ['realm', 'Realm'], ['powers', 'Powers']];

/**
 * @typedef {Object} UpgradeCardData
 * @property {string} id
 * @property {'army'|'realm'|'powers'} tab
 * @property {string} icon
 * @property {string} name
 * @property {string} desc
 * @property {number} level
 * @property {number|null} max
 * @property {boolean} locked        true if level 0 and not yet unlocked (Powers)
 * @property {string} current        effectText(level)
 * @property {string|null} next      effectText(level+1), null if maxed
 * @property {number|null} cost      null if maxed
 * @property {boolean} affordable
 * @property {boolean} [bestValue]    Army tab: the ONE upgrade that raises Army Power the most per gold right now (computed by the scene, passed in as data)
 */

/**
 * @param {{ onBuy?: (id: string) => void, onBuyMax?: (id: string) => void, onClose?: () => void }} [callbacks]
 */
export function createCouncil({ onBuy, onBuyMax, onClose } = {}) {
  let activeTab = 'army';
  let buyMaxOn = false;
  const cards = new Map(); // id -> { el, update(data), lastLevel }

  const tabButtons = new Map();
  const tabsEl = h('div.council-tabs', { role: 'tablist', 'aria-label': 'Upgrade categories' },
    ...TABS.map(([id, label]) => {
      const btn = h('button.council-tab', { role: 'tab', id: `council-tab-${id}`, 'aria-selected': 'false', 'aria-controls': 'council-list', tabindex: '-1', onClick: () => selectTab(id) }, label);
      tabButtons.set(id, btn);
      return btn;
    }),
  );
  // arrow keys move between the tabs (roving tabindex: only the selected tab is in the Tab order)
  tabsEl.addEventListener('keydown', (e) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (e.key === 'Home' || e.key === 'End' || keys[e.key]) {
      const ids = TABS.map(([id]) => id);
      const at = ids.indexOf(activeTab);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : (at + keys[e.key] + ids.length) % ids.length;
      e.preventDefault();
      selectTab(ids[next]);
      tabButtons.get(ids[next]).focus();
    }
  });

  const buyMaxToggle = h('button.council-buymax.pill', {
    onClick: () => {
      buyMaxOn = !buyMaxOn;
      buyMaxToggle.classList.toggle('is-on', buyMaxOn);
      buyMaxToggle.setAttribute('aria-pressed', String(buyMaxOn));
    },
    'aria-pressed': 'false',
  }, 'Buy Max');

  // PLAN-PHASE11b: when the Best value card sits on another tab, a pointer to it (in the toolbar, kept in the layout when hidden so nothing moves)
  let bestTab = null;
  const tabLabel = (id) => (TABS.find(([t]) => t === id) || [id, id])[1];
  const pointerEl = h('button.council-bv-pointer', { type: 'button', onClick: () => { if (bestTab) selectTab(bestTab); } }, '');
  function refreshPointer() {
    const on = !!bestTab && bestTab !== activeTab;
    pointerEl.classList.toggle('is-on', on);
    pointerEl.tabIndex = on ? 0 : -1;
    pointerEl.setAttribute('aria-hidden', on ? 'false' : 'true');
    if (on) { pointerEl.textContent = `Best value on ${tabLabel(bestTab)} ›`; pointerEl.setAttribute('aria-label', `Best value is on the ${tabLabel(bestTab)} tab: show it`); }
  }
  const listEl = h('div.council-list.scroll-y', { id: 'council-list', role: 'tabpanel', 'aria-labelledby': 'council-tab-army' });

  // Feedback for a purchase made IN the council appears in the council (a toast would sit over the dialog): one polite status line IN the header, between
  // the title and the close button. It never takes a row of its own: one that opened under the header pushed every Buy button down on the first purchase
  // (and back up 4 s later), so a quick second click on a slow machine landed beside the button it aimed at.
  const statusEl = h('div.council-status', { role: 'status', 'aria-live': 'polite' }, '');
  let statusTimer = 0;
  function setStatus(message, kind = 'success') {
    clearTimeout(statusTimer);
    statusEl.textContent = message || '';
    statusEl.dataset.kind = kind;
    statusEl.title = message || ''; // a long name may be cut with an ellipsis on a phone
    statusEl.classList.toggle('is-on', !!message);
    if (message) statusTimer = setTimeout(() => { statusEl.textContent = ''; statusEl.classList.remove('is-on'); }, 4000);
  }
  const el = h('div.council.glass-panel', {},
    h('div.council-header', {},
      h('h2.council-title', {}, 'War Council'),
      statusEl,
      h('button.btn-icon.council-close', { onClick: () => onClose?.(), 'aria-label': 'Close' }, icon('close', 16)),
    ),
    h('div.council-toolbar', {}, tabsEl, pointerEl, buyMaxToggle),
    listEl,
  );

  watchDialog(el, { onEscape: () => onClose?.() });

  function selectTab(tab) {
    activeTab = tab;
    for (const [id, btn] of tabButtons) {
      btn.classList.toggle('is-active', id === tab);
      btn.setAttribute('aria-selected', id === tab ? 'true' : 'false');
      btn.tabIndex = id === tab ? 0 : -1;
    }
    listEl.setAttribute('aria-labelledby', `council-tab-${tab}`);
    for (const [id, card] of cards) card.el.hidden = card.tab !== tab;
    refreshPointer();
  }
  selectTab(activeTab);

  function buildCard(data) {
    const iconEl = h('span.upgrade-card-icon', {}, icon(data.icon, 22));
    const levelEl = h('span.upgrade-card-level.pill', {}, '');
    const tagEl = h('span.upgrade-card-tag', { title: 'Raises your Army Power the most per gold right now' }, 'Best value');
    tagEl.hidden = true;
    const currentEl = h('span.upgrade-card-current', {}, '');
    // "+0 War Camp troops → +2 War Camp troops" wrapped over two ragged lines: when the line does not fit, the current value drops its shared words ("+0 → +2 War Camp troops")
    const currentHead = h('span.upgrade-card-current-head', {}, '');
    const currentTail = h('span.upgrade-card-current-tail', {}, '');
    currentEl.append(currentHead, currentTail);
    let effectKey = '';
    let effectMeasured = false;
    const nextEl = h('span.upgrade-card-next', {}, '');
    const costLabelEl = h('span.upgrade-card-cost-value.nums', {}, '');
    const buyBtn = h('button.btn.btn-primary.upgrade-card-buy', {
      onClick: () => (buyMaxOn ? onBuyMax : onBuy)?.(data.id),
    }, icon('coin', 14), costLabelEl);
    const cardName = data.name;

    const effectEl = h('div.upgrade-card-effect', {}, currentEl, h('span.upgrade-card-arrow', {}, '→'), nextEl);
    const cardEl = h('div.upgrade-card', {},
      iconEl,
      h('div.upgrade-card-info', {},
        h('div.upgrade-card-name-row', {}, h('span.upgrade-card-name', {}, data.name), levelEl, tagEl),
        h('div.upgrade-card-desc', {}, data.desc),
        effectEl,
      ),
      buyBtn,
    );
    cardEl.hidden = data.tab !== activeTab;
    listEl.appendChild(cardEl);

    const entry = {
      el: cardEl, tab: data.tab, lastLevel: data.level,
      update(d) {
        entry.tab = d.tab;
        levelEl.textContent = d.locked ? 'Locked' : `Lv ${d.level}`;
        levelEl.classList.toggle('is-locked', !!d.locked);
        tagEl.hidden = !d.bestValue;
        cardEl.classList.toggle('is-best-value', !!d.bestValue);
        const cur = d.locked ? '—' : d.current;
        const nxt = d.next ?? 'MAX';
        const key = `${cur}|${nxt}`;
        if (key !== effectKey || (!effectMeasured && effectEl.getClientRects().length)) {
          effectKey = key;
          effectMeasured = !!effectEl.getClientRects().length;
          // the words both values share after the number ("War Camp troops"), so the current one can drop them when space is short
          const sp = cur.indexOf(' ');
          const tail = sp > 0 && nxt.indexOf(' ') > 0 && cur.slice(sp) === nxt.slice(nxt.indexOf(' ')) ? cur.slice(sp) : '';
          currentHead.textContent = tail ? cur.slice(0, sp) : cur;
          currentTail.textContent = tail;
          nextEl.textContent = nxt;
          effectEl.classList.remove('is-compact');
          requestAnimationFrame(() => { // measured once laid out: more than one line, and it can be shortened -> compact
            if (tail && effectEl.getClientRects().length && effectEl.scrollWidth > effectEl.clientWidth + 1) effectEl.classList.add('is-compact');
          });
        }
        const maxed = d.next == null;
        cardEl.classList.toggle('is-maxed', maxed);
        cardEl.classList.toggle('is-affordable', !maxed && d.affordable);
        buyBtn.disabled = maxed || !d.affordable;
        costLabelEl.textContent = maxed ? 'MAX' : shortNumber(d.cost);
        buyBtn.classList.toggle('is-unlock', !!d.locked);
        // "Buy Recruitment level 1, 33 gold" / "Unlock Rally, 400 gold" / "Recruitment is at its maximum" (the visible text is only the price)
        const label = maxed ? `${cardName} is at its maximum level`
          : d.locked ? `Unlock ${cardName}, ${shortNumber(d.cost)} gold`
            : buyMaxOn ? `Buy as many ${cardName} levels as you can afford, next level ${d.level + 1} costs ${shortNumber(d.cost)} gold`
              : `Buy ${cardName} level ${d.level + 1}, ${shortNumber(d.cost)} gold`;
        if (buyBtn.getAttribute('aria-label') !== label) buyBtn.setAttribute('aria-label', label);

        if (d.level > entry.lastLevel) {
          cardEl.classList.remove('upgrade-bought');
          // eslint-disable-next-line no-unused-expressions
          cardEl.offsetWidth;
          cardEl.classList.add('upgrade-bought');
        }
        entry.lastLevel = d.level;
      },
    };
    return entry;
  }

  function update(data) {
    if (!data) return;
    for (const d of data.upgrades || []) {
      let entry = cards.get(d.id);
      if (!entry) {
        entry = buildCard(d);
        cards.set(d.id, entry);
      }
      entry.update(d);
      entry.el.hidden = entry.tab !== activeTab;
    }
    if (data.upgrades) { const b = data.upgrades.find((d) => d.bestValue); bestTab = b ? b.tab : null; refreshPointer(); }
  }

  function destroy() {
    clear(listEl);
    cards.clear();
  }

  return { el, update, destroy, setStatus };
}
