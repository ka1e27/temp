// War Council panel (DESIGN §5.2). Browser only; no game-logic imports — the
// integrator resolves each upgrade's current/next effect text and cost via
// game/meta/upgrades.js and passes the finished view data in.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { shortNumber } from './format.js';
import { watchDialog } from './dialogs.js';

const TABS = [['army', 'Army'], ['realm', 'Realm'], ['powers', 'Powers']];

/**
 * An upgrade's "current → next" with only what changes: the words both values share before and after the change are written once.
 * effectDiff('+0% troop growth', '+3% troop growth') -> { head: '', cur: '+0%', next: '+3%', tail: 'troop growth' }
 * effectDiff('Send 50% from every settlement · 30s cooldown', '... · 28.5s cooldown') -> { head: 'Send 50% from every settlement ·', cur: '30s', next: '28.5s', tail: 'cooldown' }
 * Each side keeps at least one word of its own.
 */
export function effectDiff(cur, next) {
  const a = String(cur).split(' ');
  const b = String(next).split(' ');
  let p = 0;
  while (p < a.length - 1 && p < b.length - 1 && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - 1 - p && s < b.length - 1 - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return { head: a.slice(0, p).join(' '), cur: a.slice(p, a.length - s).join(' '), next: b.slice(p, b.length - s).join(' '), tail: a.slice(a.length - s).join(' ') };
}

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
 * @property {string|null} [forbidden] Powers under Iron Will: why it cannot be bought ("Iron Will"); the Buy button is replaced by a lock
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
  // The Powers tab under Iron Will says so at the top, before any card: a player who ticked it at the founding bought every power and found
  // them all locked in battle (user report, 2026-10-08). The scene passes the words (`powersNotice`); null hides it.
  const noticeText = h('span', {}, '');
  const noticeEl = h('p.council-notice', { role: 'note' }, icon('lock', 16), noticeText);
  let notice = null;
  listEl.appendChild(noticeEl);

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
    noticeEl.hidden = !(notice && tab === 'powers');
    refreshPointer();
  }
  selectTab(activeTab);

  function buildCard(data) {
    const iconEl = h('span.upgrade-card-icon', {}, icon(data.icon, 22));
    const levelEl = h('span.upgrade-card-level.pill', {}, '');
    const tagEl = h('span.upgrade-card-tag', { title: 'Raises your Army Power the most per gold right now' }, 'Best value');
    tagEl.hidden = true;
    // only what changes, the shared words written once (effectDiff): "+0 → +2 War Camp troops", "Send 50% from every settlement · 30s → 28.5s cooldown"
    const headEl = h('span.upgrade-card-head', {}, '');
    const currentEl = h('span.upgrade-card-current', {}, '');
    const nextEl = h('span.upgrade-card-next', {}, '');
    const tailEl = h('span.upgrade-card-tail', {}, '');
    let effectKey = '';
    const costLabelEl = h('span.upgrade-card-cost-value.nums', {}, '');
    const forbidEl = h('span.upgrade-card-forbid', {}, icon('lock', 14), h('span', {}, ''));
    const buyBtn = h('button.btn.btn-primary.upgrade-card-buy', {
      onClick: () => (buyMaxOn ? onBuyMax : onBuy)?.(data.id),
    }, h('span.upgrade-card-price', {}, icon('coin', 14), costLabelEl), forbidEl);
    const cardName = data.name;

    const effectEl = h('div.upgrade-card-effect', {}, headEl, currentEl, h('span.upgrade-card-arrow', {}, '→'), nextEl, tailEl);
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
        if (key !== effectKey) {
          effectKey = key;
          const diff = d.next == null ? { head: '', cur, next: nxt, tail: '' } : effectDiff(cur, nxt);
          const glue = (t) => t.replace(/ ·/g, ' ·'); // a "·" separator never starts a line
          headEl.textContent = glue(diff.head);
          currentEl.textContent = glue(diff.cur);
          nextEl.textContent = glue(diff.next);
          tailEl.textContent = glue(diff.tail);
          effectEl.setAttribute('aria-label', d.next == null ? `${cur}, at its maximum` : `now ${cur}, next level ${nxt}`); // the whole values for a screen reader
        }
        const maxed = d.next == null;
        cardEl.classList.toggle('is-maxed', maxed);
        cardEl.classList.toggle('is-affordable', !maxed && d.affordable);
        buyBtn.disabled = maxed || !d.affordable || !!d.forbidden;
        costLabelEl.textContent = maxed ? 'MAX' : shortNumber(d.cost);
        buyBtn.classList.toggle('is-unlock', !!d.locked && !d.forbidden);
        buyBtn.classList.toggle('is-forbidden', !!d.forbidden);
        cardEl.classList.toggle('is-forbidden', !!d.forbidden);
        if (d.forbidden && forbidEl.lastChild.textContent !== d.forbidden) forbidEl.lastChild.textContent = d.forbidden;
        // "Buy Recruitment level 1, 33 gold" / "Unlock Rally, 400 gold" / "Recruitment is at its maximum" (the visible text is only the price)
        const label = d.forbidden ? `${cardName} cannot be bought: ${d.forbidden} forbids powers this dynasty`
          : maxed ? `${cardName} is at its maximum level`
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
    if (data.powersNotice !== undefined) {
      notice = data.powersNotice || null;
      if (notice && noticeText.textContent !== notice) noticeText.textContent = notice;
      noticeEl.hidden = !(notice && activeTab === 'powers');
    }
  }

  function destroy() {
    clear(listEl);
    cards.clear();
  }

  return { el, update, destroy, setStatus };
}
