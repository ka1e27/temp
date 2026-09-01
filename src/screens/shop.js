// Upgrade shop. Pushed as an OVERLAY so the world map stays drawn behind it —
// you can see your empire while you spend its income.
//
// The treasury ticks the whole time this is open, so an unaffordable button
// becomes affordable while you are looking at it. That state is refreshed in
// place: a full re-render four times a second would throw focus off whatever
// button the keyboard is on, which is the same bug the world map's detail panel
// had. Only a PURCHASE rebuilds the list.
import { h, clear, mount, bindText, inertSiblings } from '../ui/dom.js';
import { compact, rate } from '../ui/format.js';
import { UI, SHOP } from '../content/strings.js';
import { shopListing, canBuy } from '../meta/upgrades.js';
import { spendAll, suggestedBuy } from '../meta/shopbuy.js';
import { inventory } from '../meta/boosters.js';
import { incomePerSec } from '../meta/idle.js';
import { createRowBuilder } from './shoprow.js';

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
  // ONE builder per scene, sharing this scene's own state. `watched` is handed
  // in as a getter rather than as the array, because `render()` re-points it —
  // a captured reference would leave the tick walking rows that are no longer
  // in the document.
  const rows = createRowBuilder({
    ctx, meta, render: () => render(), watched: () => watched,
  });

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
      // The scene under a `keepVisible` overlay stays MOUNTED and therefore
      // stays tabbable — see `ui/dom.js inertSiblings`.
      const unInert = inertSiblings(root);

      render();
      close.focus();

      const onKey = (e) => { if (e.key === 'Escape') ctx.scenes.pop(); };
      document.addEventListener('keydown', onKey);
      const timer = setInterval(tick, 250);

      return [
        unInert,
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
      const crown = group.id === 'crown';
      // A gated group is SHOWN, not hidden, and marked shut. What finishing the
      // campaign buys is worth knowing about before you have finished it; what is
      // not worth doing is offering a button that cannot be pressed, so the rows
      // inside render without one (see upgradeRow).
      //
      // THE CROWN GROUP CARRIES A SECOND MARKER, `data-crown`, so its section
      // reads as a different TIER rather than a seventh line on the same six —
      // see scenes.css for the rank-hued header and top edge this drives. It is
      // set whether the tier is open or shut: the badge is what tells a player
      // scrolling past a locked section that something else is down here, which
      // is the whole point of showing a locked group at all instead of hiding it.
      const section = h('section.shop-group', {
        'aria-labelledby': id, 'data-locked': group.open === false ? '1' : null,
        'data-crown': crown ? '1' : null,
      },
      h(`h3#${id}`, {}, group.name, crown ? h('span.shop-crown-badge', { text: SHOP.crownBadge }) : null),
      h('p.shop-group-note', { text: group.blurb ?? '' }),
      // The one fact a per-row "Locked" tag does not already carry: this gate
      // does not shut again once it has opened once (meta/legacy.js
      // `endgameOpen`), so a player who abdicates keeps the tier they earned.
      ...(crown && group.open === false ? [h('p.shop-group-note.shop-crown-gate', {
        text: SHOP.crownGateNote,
      })] : []));

      for (const item of group.items) {
        const row = rows.upgradeRow(item, item.id === suggested);
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
      for (const b of boosters) mount(section, rows.boosterRow(b));
      mount(listRoot, section);
    }
  }

}
