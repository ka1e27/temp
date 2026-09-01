// ONE SHOP ROW: what it says, and the buttons it offers.
//
// Split out of ./shop.js at the 400-line cap, along the seam the world map
// already uses (worldmap.js owns the board and the scene; worldmap-detail.js
// owns one region's panel). That file owns the overlay, the header figures, the
// section list and the 250ms affordability tick; this one owns a row.
//
// A FACTORY OVER INJECTED DEPENDENCIES rather than its own scene imports, for
// the reason `createDetailRenderer` is: two pieces of scene state these
// functions write — the `watched` list the tick walks, and the `render` a
// purchase triggers — belong to shop.js, and handing them in keeps this file
// unable to own state it should not. `watched` is passed as a GETTER, because
// shop.js re-points its own array on every render and a reference captured once
// would keep ticking rows that have left the document.
import { h } from '../ui/dom.js';
import { compact, percent, integer, duration } from '../ui/format.js';
import { UI, SHOP } from '../content/strings.js';
import { canBuy, buy, ownedEffects } from '../meta/upgrades.js';
import { buyN } from '../meta/shopbuy.js';
import { buyCharge, canBuyCharge } from '../meta/boosters.js';
import { timeToAfford } from '../meta/idle.js';
import { BOOSTER_LABEL } from './prebattle.js';

/** @param {{ctx:object, meta:()=>object, render:()=>void, watched:()=>object[]}} deps */
export function createRowBuilder({ ctx, meta, render, watched }) {
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
    watched().push({ el, check, wait, last: ok });
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
    watched().push({ el, check, wait, last: ok });
    return el;
  }

  // --- structure -----------------------------------------------------------


  /**
   * WHAT THE LEVELS ALREADY BOUGHT ADD UP TO, as one dim line.
   *
   * The row's description states what ONE level does, so a player back after an
   * absence read `Lv 6` and "+12% crowns per second" and had no way to know
   * they were holding +72%. That total is the thing an idle shop exists to
   * report and this screen never said it.
   *
   * The NUMBERS come from `ownedEffects`, which multiplies the upgrade's own
   * `effects` array by its own level, so a row cannot claim a bonus the engine
   * does not apply. Only the WORDS are authored (content/effects.data.js), and
   * a key with no entry there is omitted rather than guessed at. Returns an
   * ARRAY so the caller spreads nothing at level 0 — an empty node would leave
   * a gap on every unbought row.
   */
  function ownedLine(item) {
    const parts = ownedEffects(meta(), item.id).map((e) => {
      if (e.kind === 'pct') return `+${percent(e.value)} ${e.label}`;
      // A `mult` below 1 is a SAVING, and printing it raw ("training cost
      // x0.85") makes a discount look like a price. See `trainCostMult`, which
      // this project has already printed the wrong way round once.
      if (e.kind === 'discount') return `-${percent(1 - e.value)} ${e.label}`;
      if (e.kind === 'hours') return `+${Math.round(e.value / 3600000)}h ${e.label}`;
      return `+${integer(e.value)} ${e.label}`;
    });
    return parts.length
      ? [h('span.shop-owned', { text: `${SHOP.ownedSoFar} ${parts.join(' · ')}` })]
      : [];
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
        h('span.shop-desc', { text: item.desc }),
        ...ownedLine(item),
        // ALWAYS BUILT, SHOWN BY CSS. The suggestion moves on the 250ms
        // affordability tick, which deliberately toggles one attribute rather
        // than re-render()ing — re-rendering throws focus off whatever the
        // keyboard is on, a bug already fixed once in this file. So the line
        // that explains the ring cannot be a node that comes and goes; it is a
        // node that is always there and `[data-suggested]` reveals.
        h('span.shop-suggest', { text: SHOP.suggestedTag })),
      h('div.shop-row-side', {},
        h('span.shop-level.num', { text: owned }),
        // THE WAIT, ON THE ROW. It was computed, correct, and lived only in the
        // `title` of the Buy button — a hover, on the one control a player
        // cannot press, on the screen the whole idle half exists to bring them
        // back to. "Come back in four minutes" is the pull; a tooltip is not
        // where a pull goes. Built always and revealed by CSS on an unaffordable
        // row, for the same reason `.shop-suggest` is: the 250ms tick toggles
        // attributes and must never re-render, because re-rendering throws
        // focus off whatever the keyboard is on.
        ...(item.locked || maxed ? [] : [h('span.shop-wait', { text: waitText(item.cost, item.currency) })]),
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
    const sec = timeToAfford(meta(), cost);
    // AN EMPIRE THAT EARNS NOTHING CANNOT BE WAITED FOR, and this rendered
    // "Affordable in ~Infinitys" for one. `timeToAfford` answers Infinity at
    // zero income, which is exactly a fresh save — no conquests, no income,
    // every row unaffordable — so the first player ever to open this screen met
    // the one outright broken string on it. Same shape as the relic branch
    // above: where waiting is not the answer, say what is.
    if (!Number.isFinite(sec)) return SHOP.noIncome;
    return `${SHOP.affordIn} ${duration(sec)}`;
  }

  return { upgradeRow, boosterRow };
}
