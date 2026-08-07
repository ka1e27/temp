// Upgrade shop. Pushed as an OVERLAY so the world map stays drawn behind it —
// you can see your empire while you spend its income.
import { h, clear, mount } from '../ui/dom.js';
import { compact, rate } from '../ui/format.js';
import { shopListing, buy } from '../meta/upgrades.js';
import { inventory, buyCharge, canBuyCharge } from '../meta/boosters.js';
import { incomePerSec, timeToAfford } from '../meta/idle.js';

const BOOSTER_LABEL = {
  rally: 'Rally', march: 'Forced March', bombard: 'Bombardment',
  fortify: 'Emergency Fortify', tithe: 'War Tithe',
};

export function createShopScene(ctx) {
  let root = null;
  let listRoot = null;
  let crowns = null;

  const meta = () => ctx.state.meta;

  return {
    id: 'shop',
    keepVisible: true, // the world map keeps rendering underneath

    enter() {
      root = h('div.screen.shop-overlay');
      crowns = h('span.num.crowns');

      const header = h('div.shop-header.panel', {},
        h('h2', { text: 'Upgrades' }),
        h('div.shop-treasury', {},
          h('span.label', { text: 'Treasury' }), crowns,
          h('span.label', { text: 'Income' }),
          h('span.num', { text: rate(incomePerSec(meta())) })),
        h('button.btn.ghost', {
          text: 'Close', type: 'button', on: { click: () => ctx.scenes.pop() },
        }));

      listRoot = h('div.shop-list');
      mount(root, h('div.shop-panel.panel', {}, header, listRoot));
      mount(ctx.root, root);

      render();
      const onKey = (e) => { if (e.key === 'Escape') ctx.scenes.pop(); };
      document.addEventListener('keydown', onKey);

      return [
        () => document.removeEventListener('keydown', onKey),
        () => root?.remove(),
      ];
    },

    exit() {
      root = listRoot = crowns = null;
    },
  };

  function render() {
    clear(listRoot);
    crowns.textContent = compact(meta().crowns);

    for (const group of shopListing(meta())) {
      if (!group.items.length) continue;
      const section = h('section.shop-group', {},
        h('h3', { text: group.name }),
        h('p.shop-group-note', { text: group.blurb ?? '' }));

      for (const item of group.items) mount(section, upgradeRow(item));
      mount(listRoot, section);
    }

    // Booster charges — a gold sink that stays relevant because they are
    // consumed every fight.
    const boosters = inventory(meta()).filter((b) => b.unlocked);
    if (boosters.length) {
      const section = h('section.shop-group', {},
        h('h3', { text: 'Booster charges' }),
        h('p.shop-group-note', { text: 'Carried into battle and consumed when used.' }));
      for (const b of boosters) mount(section, boosterRow(b));
      mount(listRoot, section);
    }
  }

  function upgradeRow(item) {
    const maxed = item.level >= item.maxLevel;
    const affordable = item.affordable;
    const wait = !maxed && !affordable ? timeToAfford(meta(), item.cost) : 0;

    return h('div.shop-row', { 'data-maxed': maxed ? '1' : null },
      h('div.shop-row-main', {},
        h('span.shop-name', { text: item.name }),
        h('span.shop-desc', { text: item.desc })),
      h('div.shop-row-side', {},
        h('span.shop-level.num', {
          text: item.maxLevel > 1 ? `${item.level}/${item.maxLevel}` : (item.level ? 'owned' : ''),
        }),
        maxed
          ? h('span.shop-maxed', { text: 'MAX' })
          : h('button.btn.buy', {
            type: 'button',
            disabled: !affordable,
            // Showing the wait turns "can't afford" into "come back in 90s",
            // which is the pull the idle layer runs on.
            title: affordable ? '' : `Affordable in ~${Math.ceil(wait)}s`,
            on: {
              click: () => { buy(meta(), item.id, ctx.bus); render(); },
            },
          }, compact(item.cost))));
  }

  function boosterRow(b) {
    const cost = b.chargeCost;
    const affordable = canBuyCharge(meta(), b.id, 1).ok;
    return h('div.shop-row', {},
      h('div.shop-row-main', {},
        h('span.shop-name', { text: BOOSTER_LABEL[b.id] ?? b.id }),
        h('span.shop-desc', { text: `${b.count} / ${b.maxStock} in stock` })),
      h('div.shop-row-side', {},
        h('span.shop-level.num', { text: `x${b.count}` }),
        h('button.btn.buy', {
          type: 'button', disabled: !affordable,
          on: { click: () => { buyCharge(meta(), b.id, 1, ctx.bus); render(); } },
        }, compact(cost))));
  }
}
