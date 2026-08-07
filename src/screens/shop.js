// Upgrade shop. Pushed as an OVERLAY so the world map stays drawn behind it —
// you can see your empire while you spend its income.
//
// The treasury ticks the whole time this is open, so an unaffordable button
// becomes affordable while you are looking at it. That state is refreshed in
// place: a full re-render four times a second would throw focus off whatever
// button the keyboard is on, which is the same bug the world map's detail panel
// had. Only a PURCHASE rebuilds the list.
import { h, clear, mount, bindText } from '../ui/dom.js';
import { compact, rate } from '../ui/format.js';
import { UI, SHOP } from '../content/strings.js';
import { shopListing, buy } from '../meta/upgrades.js';
import { inventory, buyCharge, canBuyCharge } from '../meta/boosters.js';
import { incomePerSec, timeToAfford } from '../meta/idle.js';
import { BOOSTER_LABEL } from './prebattle.js';

export function createShopScene(ctx) {
  let root = null;
  let listRoot = null;
  let setCrowns = null;
  let setIncome = null;
  let watched = [];

  const meta = () => ctx.state.meta;

  return {
    id: 'shop',
    keepVisible: true, // the world map keeps rendering underneath

    enter() {
      root = h('div.screen.shop-overlay');
      const crowns = h('span.num.crowns');
      const income = h('span.num');
      setCrowns = bindText(crowns);
      setIncome = bindText(income);

      const close = h('button.btn.ghost.shop-close', {
        text: UI.close, type: 'button',
        'aria-label': 'Close the upgrade shop',
        on: { click: () => ctx.scenes.pop() },
      });

      const header = h('div.shop-header.panel', {},
        h('h2#shop-title', { text: UI.shop }),
        h('div.shop-treasury', { 'aria-live': 'polite' },
          h('span.label', { text: UI.treasury }), crowns,
          h('span.label', { text: UI.income }), income),
        close);

      listRoot = h('div.shop-list');
      mount(root, h('div.shop-panel.panel', {
        role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'shop-title',
      }, header, listRoot));
      mount(ctx.root, root);

      render();
      close.focus();

      const onKey = (e) => { if (e.key === 'Escape') ctx.scenes.pop(); };
      document.addEventListener('keydown', onKey);
      const timer = setInterval(tick, 250);

      return [
        () => clearInterval(timer),
        () => document.removeEventListener('keydown', onKey),
        () => root?.remove(),
      ];
    },

    exit() {
      root = listRoot = setCrowns = setIncome = null;
      watched = [];
    },
  };

  // --- live state ----------------------------------------------------------

  /** Treasury, income and affordability only. Never structure. */
  function tick() {
    const m = meta();
    setCrowns(compact(m.crowns));
    setIncome(rate(incomePerSec(m)));
    for (const w of watched) {
      const ok = w.check();
      if (w.last === ok) continue;
      w.last = ok;
      w.el.disabled = !ok;
      if (ok) w.el.removeAttribute('aria-disabled');
      else w.el.setAttribute('aria-disabled', 'true');
      w.el.title = ok ? '' : w.wait();
    }
  }

  /** Icon-only by design — the label is the price. Screen readers get the rest. */
  function buyButton({ label, cost, check, wait, onBuy }) {
    const ok = check();
    const el = h('button.btn.buy', {
      type: 'button',
      disabled: !ok,
      'aria-disabled': ok ? null : 'true',
      'aria-label': `${UI.buy} ${label} for ${Math.round(cost)} crowns`,
      // Showing the wait turns "can't afford" into "come back in 90s",
      // which is the pull the idle layer runs on.
      title: ok ? '' : wait(),
      on: { click: () => { if (check()) { onBuy(); render(); } } },
    }, compact(cost));
    watched.push({ el, check, wait, last: ok });
    return el;
  }

  // --- structure -----------------------------------------------------------

  function render() {
    clear(listRoot);
    watched = [];
    tick();

    for (const group of shopListing(meta())) {
      if (!group.items.length) continue;
      const id = `shop-grp-${group.id}`;
      const section = h('section.shop-group', { 'aria-labelledby': id },
        h(`h3#${id}`, { text: group.name }),
        h('p.shop-group-note', { text: group.blurb ?? '' }));

      for (const item of group.items) mount(section, upgradeRow(item));
      mount(listRoot, section);
    }

    // Booster charges — a gold sink that stays relevant because they are
    // consumed every fight.
    const boosters = inventory(meta()).filter((b) => b.unlocked);
    if (boosters.length) {
      const section = h('section.shop-group', { 'aria-labelledby': 'shop-grp-charges' },
        h('h3#shop-grp-charges', { text: 'Booster charges' }),
        h('p.shop-group-note', { text: 'Carried into battle and consumed when used.' }));
      for (const b of boosters) mount(section, boosterRow(b));
      mount(listRoot, section);
    }
  }

  function upgradeRow(item) {
    const maxed = item.level >= item.maxLevel;
    const owned = item.maxLevel > 1 ? `${item.level}/${item.maxLevel}` : (item.level ? 'owned' : '');

    return h('div.shop-row', { 'data-maxed': maxed ? '1' : null },
      h('div.shop-row-main', {},
        h('span.shop-name', { text: item.name }),
        h('span.shop-desc', { text: item.desc })),
      h('div.shop-row-side', {},
        h('span.shop-level.num', { text: owned }),
        maxed
          ? h('span.shop-maxed', { text: UI.maxed, 'aria-label': `${item.name} is fully upgraded` })
          : buyButton({
            label: item.name,
            cost: item.cost,
            check: () => meta().crowns >= item.cost,
            wait: () => `${SHOP.affordIn} ~${Math.ceil(timeToAfford(meta(), item.cost))}s`,
            onBuy: () => buy(meta(), item.id, ctx.bus),
          })));
  }

  function boosterRow(b) {
    const name = BOOSTER_LABEL[b.id] ?? b.id;
    const full = b.count >= b.maxStock;
    return h('div.shop-row', { 'data-booster': b.id },
      h('div.shop-row-main', {},
        h('span.shop-name', { text: name }),
        h('span.shop-desc', { text: `${b.count} / ${b.maxStock} ${SHOP.chargeLabel} in stock` })),
      h('div.shop-row-side', {},
        h('span.shop-level.num', {
          text: `x${b.count}`, 'aria-label': `${b.count} ${name} charges owned`,
        }),
        full
          ? h('span.shop-maxed', { text: UI.maxed, 'aria-label': SHOP.boosterFull })
          : buyButton({
            label: `one ${name} charge`,
            cost: b.chargeCost,
            check: () => canBuyCharge(meta(), b.id, 1).ok,
            wait: () => `${SHOP.affordIn} ~${Math.ceil(timeToAfford(meta(), b.chargeCost))}s`,
            onBuy: () => buyCharge(meta(), b.id, 1, ctx.bus),
          })));
  }
}
