// War Council panel (DESIGN §5.2). Browser only; no game-logic imports — the
// integrator resolves each upgrade's current/next effect text and cost via
// game/meta/upgrades.js and passes the finished view data in.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { shortNumber } from './format.js';

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
  const tabsEl = h('div.council-tabs', {},
    ...TABS.map(([id, label]) => {
      const btn = h('button.council-tab', { onClick: () => selectTab(id) }, label);
      tabButtons.set(id, btn);
      return btn;
    }),
  );

  const buyMaxToggle = h('button.council-buymax.pill', {
    onClick: () => {
      buyMaxOn = !buyMaxOn;
      buyMaxToggle.classList.toggle('is-on', buyMaxOn);
      buyMaxToggle.setAttribute('aria-pressed', String(buyMaxOn));
    },
    'aria-pressed': 'false',
  }, 'Buy Max');

  const listEl = h('div.council-list.scroll-y', {});

  const el = h('div.council.glass-panel', {},
    h('div.council-header', {},
      h('h2.council-title', {}, 'War Council'),
      h('button.btn-icon.council-close', { onClick: () => onClose?.(), 'aria-label': 'Close' }, icon('close', 16)),
    ),
    h('div.council-toolbar', {}, tabsEl, buyMaxToggle),
    listEl,
  );

  function selectTab(tab) {
    activeTab = tab;
    for (const [id, btn] of tabButtons) btn.classList.toggle('is-active', id === tab);
    for (const [id, card] of cards) card.el.hidden = card.tab !== tab;
  }
  selectTab(activeTab);

  function buildCard(data) {
    const iconEl = h('span.upgrade-card-icon', {}, icon(data.icon, 22));
    const levelEl = h('span.upgrade-card-level.pill', {}, '');
    const tagEl = h('span.upgrade-card-tag', { title: 'Raises your Army Power the most per gold right now' }, 'Best value');
    tagEl.hidden = true;
    const currentEl = h('span.upgrade-card-current', {}, '');
    const nextEl = h('span.upgrade-card-next', {}, '');
    const costLabelEl = h('span.upgrade-card-cost-value.nums', {}, '');
    const buyBtn = h('button.btn.btn-primary.upgrade-card-buy', {
      onClick: () => (buyMaxOn ? onBuyMax : onBuy)?.(data.id),
    }, icon('coin', 14), costLabelEl);

    const cardEl = h('div.upgrade-card', {},
      iconEl,
      h('div.upgrade-card-info', {},
        h('div.upgrade-card-name-row', {}, h('span.upgrade-card-name', {}, data.name), levelEl, tagEl),
        h('div.upgrade-card-desc', {}, data.desc),
        h('div.upgrade-card-effect', {}, currentEl, h('span.upgrade-card-arrow', {}, '→'), nextEl),
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
        currentEl.textContent = d.locked ? '—' : d.current;
        nextEl.textContent = d.next ?? 'MAX';
        const maxed = d.next == null;
        cardEl.classList.toggle('is-maxed', maxed);
        cardEl.classList.toggle('is-affordable', !maxed && d.affordable);
        buyBtn.disabled = maxed || !d.affordable;
        costLabelEl.textContent = maxed ? 'MAX' : shortNumber(d.cost);
        buyBtn.classList.toggle('is-unlock', !!d.locked);

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
  }

  function destroy() {
    clear(listEl);
    cards.clear();
  }

  return { el, update, destroy };
}
