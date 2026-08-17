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
import { shopListing, buy, canBuy, spendAll, buyN, suggestedBuy } from '../meta/upgrades.js';
import { inventory, buyCharge, canBuyCharge } from '../meta/boosters.js';
import { incomePerSec, timeToAfford } from '../meta/idle.js';
import { BOOSTER_LABEL } from './prebattle.js';

export function createShopScene(ctx) {
  let root = null;
  let listRoot = null;
  let setCrowns = null;
  let setRelics = null;
  let setIncome = null;
  let spendAllBtn = null;
  let watched = [];
  // The suggested-buy ring has to survive the 250ms tick without a full
  // `render()` (see the header comment on why that rebuild is forbidden), so
  // it is tracked the same way `watched` tracks disabled state: a map from id
  // to its live row element, plus whichever id currently wears the ring.
  let rowById = new Map();
  let lastSuggested = null;

  const meta = () => ctx.state.meta;

  return {
    id: 'shop',
    keepVisible: true, // the world map keeps rendering underneath

    enter() {
      // MARK THE SCENE, as every other screen does. These two were the only
      // screens that never did, and it was not cosmetic: tools/mobile.mjs gates
      // its phone audit on `scene() === 'shop'`, so that step could never run
      // and silently no-opped instead of failing. The shop was consequently
      // never audited at any width — which is exactly how it shipped unreadable
      // below 520px while the tool reported "no layout problems found".
      //
      // `keepVisible` means the world map stays mounted underneath, so `exit()`
      // restores the marker rather than deleting it.
      document.body.dataset.scene = 'shop';
      root = h('div.screen.shop-overlay');
      const crowns = h('span.num.crowns');
      const relics = h('span.num.relics');
      const income = h('span.num');
      setCrowns = bindText(crowns);
      setRelics = bindText(relics);
      setIncome = bindText(income);

      const close = h('button.btn.ghost.shop-close', {
        text: UI.close, type: 'button',
        'aria-label': 'Close the upgrade shop',
        on: { click: () => ctx.scenes.pop() },
      });

      // Crowns only — see meta/upgrades.js `spendAll`. Relics are the
      // player's deliberate choice of which troop to level (CLAUDE.md's
      // relics section), and this button must not make that choice for them;
      // crowns are the currency this whole fix is about (10-146 identical
      // clicks, measured through this exact rule).
      spendAllBtn = h('button.btn.ghost.shop-spend-all', {
        type: 'button', text: SHOP.spendAll,
        'aria-label': SHOP.spendAllHint,
        on: { click: () => { spendAll(meta(), 'crowns', ctx.bus); render(); } },
      });

      const header = h('div.shop-header.panel', {},
        h('h2#shop-title', { text: UI.shop }),
        // NOT a live region, for the reason worldmap.js records at its own
        // treasury: `polite` plus a 250ms tick plus a `compact` that renders
        // sub-1000 values exactly is ~3-4 announcements a second, i.e. a queue
        // that never drains. It is WORSE here than there, and that is why it
        // ships gated rather than merely quieter: this panel is
        // `role="dialog" aria-modal="true"` with focus moved to Close, so a
        // screen-reader user is inside a modal whose only speech is a number
        // repeating — the buy buttons, their prices and their levels never get
        // a turn. The figures are still read on demand; they are simply no
        // longer shouted.
        h('div.shop-treasury', { 'aria-live': 'off' },
          h('span.label', { text: UI.treasury }), crowns,
          h('span.label', { text: UI.relics }), relics,
          h('span.label', { text: UI.income }), income),
        spendAllBtn,
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
      // Back to the map that is still mounted underneath, not deleted — these
      // are overlays, and a screen that clears the marker outright would make
      // the world map look like no scene at all to anything reading it.
      document.body.dataset.scene = 'worldmap';
      root = listRoot = setCrowns = setRelics = setIncome = spendAllBtn = null;
      watched = [];
      rowById = new Map();
      lastSuggested = null;
    },
  };

  // --- live state ----------------------------------------------------------

  /** Treasury, income and affordability only. Never structure. */
  function tick() {
    const m = meta();
    setCrowns(compact(m.crowns));
    // Never compacted. Relics run 0-200 over a whole campaign and "1.2k" is a
    // crown-sized word — the two currencies have to be tellable apart at a
    // glance or the shop's prices become guesswork.
    setRelics(String(Math.floor(m.relics ?? 0)));
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

    // The suggested-buy ring tracks affordability, which moves on this same
    // clock as every Buy button's own disabled state — idle income keeps
    // ticking while the shop sits open (see the file header). Re-render()ing
    // on this beat is the exact bug already fixed once above (focus thrown
    // off whatever the keyboard is on), so this moves one attribute instead.
    const suggested = suggestedBuy(m);
    if (suggested !== lastSuggested) {
      if (lastSuggested) rowById.get(lastSuggested)?.removeAttribute('data-suggested');
      if (suggested) rowById.get(suggested)?.setAttribute('data-suggested', '1');
      lastSuggested = suggested;
    }
  }

  /** Is there anything at all left to spend crowns on? Feeds "Spend all"'s
   *  own disabled state, the same way `canBuy` feeds one row's button. */
  function canSpendCrowns() {
    return shopListing(meta()).some((g) => g.items.some((i) => i.currency === 'crowns' && i.affordable));
  }

  /** Icon-only by design — the label is the price. Screen readers get the rest. */
  function buyButton({ label, cost, check, wait, onBuy, currency = 'crowns', suggested = false }) {
    const ok = check();
    const relic = currency === 'relics';
    const el = h(`button.btn.buy${relic ? '.buy-relic' : ''}`, {
      type: 'button',
      disabled: !ok,
      'aria-disabled': ok ? null : 'true',
      // The ring is a visual-only cue, so a screen-reader user gets the same
      // claim as a suffix on the button they were already going to read,
      // rather than a second element to tab past.
      'aria-label': `${UI.buy} ${label} for ${Math.round(cost)} ${relic ? 'relics' : 'crowns'}`
        + (suggested ? SHOP.suggestedSuffix : ''),
      // Showing the wait turns "can't afford" into "come back in 90s",
      // which is the pull the idle layer runs on — and is a LIE for a relic
      // price, because no amount of waiting pays one. That row says where they
      // come from instead.
      title: ok ? '' : wait(),
      on: { click: () => { if (check()) { onBuy(); render(); } } },
    }, relic ? String(cost) : compact(cost));
    watched.push({ el, check, wait, last: ok });
    return el;
  }

  /** "x10": the same purchase, up to ten times, through `buyN` — never a
   *  single deduction at ten times today's price (a level-9 line does not
   *  cost nine times its level-0 price). Offered only on endless lines,
   *  where "again" is ever a question worth a shortcut for. */
  function bulkBuyButton(item) {
    const check = () => canBuy(meta(), item.id).ok;
    const ok = check();
    const wait = () => waitText(item.cost, item.currency);
    const el = h('button.btn.ghost.buy-ten', {
      type: 'button',
      disabled: !ok,
      'aria-disabled': ok ? null : 'true',
      'aria-label': SHOP.buyTenHint(item.name),
      title: ok ? '' : wait(),
      on: {
        click: () => {
          if (!check()) return;
          buyN(meta(), item.id, 10, ctx.bus);
          render();
        },
      },
    }, SHOP.buyTen);
    watched.push({ el, check, wait, last: ok });
    return el;
  }

  // --- structure -----------------------------------------------------------

  function render() {
    clear(listRoot);
    watched = [];
    rowById = new Map();
    tick();

    // "Spend all" lives in the header, outside `listRoot`, so its own DOM
    // node survives every render call — but `watched` does not, and that is
    // what its disabled state rides on, exactly like every row's own Buy
    // button. Re-add it here, in the same place a row's would be added.
    const spendOk = canSpendCrowns();
    spendAllBtn.disabled = !spendOk;
    spendAllBtn.title = spendOk ? '' : SHOP.nothingToSpend;
    watched.push({
      el: spendAllBtn, check: canSpendCrowns, wait: () => SHOP.nothingToSpend, last: spendOk,
    });

    // The cheapest-affordable Empire line, or none — recomputed on every
    // render (i.e. every purchase) and kept live between renders by `tick()`.
    // See meta/upgrades.js `suggestedBuy` for why this can never be a locked,
    // maxed, or non-Empire row.
    const suggested = suggestedBuy(meta());
    lastSuggested = suggested;

    for (const group of shopListing(meta())) {
      if (!group.items.length) continue;
      const id = `shop-grp-${group.id}`;
      // A gated group is SHOWN, not hidden, and marked shut. What finishing the
      // campaign buys is worth knowing about before you have finished it; what is
      // not worth doing is offering a button that cannot be pressed, so the rows
      // inside render without one (see upgradeRow).
      const section = h('section.shop-group', {
        'aria-labelledby': id, 'data-locked': group.open === false ? '1' : null,
      },
      h(`h3#${id}`, { text: group.name }),
      h('p.shop-group-note', { text: group.blurb ?? '' }));

      for (const item of group.items) {
        const row = upgradeRow(item, item.id === suggested);
        rowById.set(item.id, row);
        mount(section, row);
      }
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

  /** @param {boolean} suggested this is `suggestedBuy`'s current pick */
  function upgradeRow(item, suggested = false) {
    const maxed = item.reason === 'maxed';
    // An endless line has no denominator to show — "7 / Infinity" is noise, and
    // "7 / 64" would advertise a floating-point ceiling as though it were a
    // design one. Just the level it is at.
    const owned = item.endless ? (item.level ? `Lv ${item.level}` : '')
      : item.maxLevel > 1 ? `${item.level}/${item.maxLevel}`
        : (item.level ? 'owned' : '');

    const buyEl = () => buyButton({
      label: item.name,
      cost: item.cost,
      currency: item.currency,
      check: () => canBuy(meta(), item.id).ok,
      wait: () => waitText(item.cost, item.currency),
      onBuy: () => buy(meta(), item.id, ctx.bus),
      suggested,
    });

    return h('div.shop-row', {
      'data-maxed': maxed ? '1' : null,
      'data-locked': item.locked ? '1' : null,
      'data-suggested': suggested ? '1' : null,
    },
      h('div.shop-row-main', {},
        h('span.shop-name', { text: item.name }),
        h('span.shop-desc', { text: item.desc })),
      h('div.shop-row-side', {},
        h('span.shop-level.num', { text: owned }),
        item.locked
          // The PRICE is still shown — that is what makes a locked line worth
          // looking at — but there is no control, because a disabled button that
          // can never enable this session is just a worse label.
          ? h('span.shop-locked', {
            text: `${compact(item.cost)} · ${UI.locked}`,
            'aria-label': `${item.name} costs ${Math.round(item.cost)} crowns and is locked`
              + ' until the campaign is finished',
          })
          : maxed
            ? h('span.shop-maxed', { text: UI.maxed, 'aria-label': `${item.name} is fully upgraded` })
            // An endless line also gets "x10" stacked ABOVE its price rather
            // than beside it: the row's right column is already as wide as
            // the price button, and a phone has no width to spare next to it
            // (tools/mobile.mjs audits this screen; see shop-row-buys in CSS).
            : item.endless
              ? h('div.shop-row-buys', {}, bulkBuyButton(item), buyEl())
              : buyEl()));
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
            currency: b.chargeCurrency,
            check: () => canBuyCharge(meta(), b.id, 1).ok,
            wait: () => waitText(b.chargeCost, b.chargeCurrency),
            onBuy: () => buyCharge(meta(), b.id, 1, ctx.bus),
          })));
  }

  /** Why you cannot afford it yet. For crowns that is a COUNTDOWN, because the
   *  idle layer really will get you there and saying so is the pull the whole
   *  idle half runs on. For relics it has to be a PLACE, because no amount of
   *  waiting pays one — a "~90s" on a relic price would be the only outright
   *  false thing in this screen. */
  function waitText(cost, currency) {
    if (currency === 'relics') return SHOP.relicsFrom;
    return `${SHOP.affordIn} ~${Math.ceil(timeToAfford(meta(), cost))}s`;
  }
}
