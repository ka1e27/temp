// THE WORLD MAP'S HEADER: the five figures, and the four ways off the screen.
//
// Split out of worldmap.js at the 400-line cap, along the seam that matters
// rather than at a line number: everything here is the strip across the top,
// and everything left there is the MAP — the porthole, the hexes, the pan
// gesture and the detail panel.
//
// It hands back the element AND the setters AND the buttons, because the caller
// refreshes the figures on a 250ms timer and has to disable the buttons for
// the duration of an auto-resolve. Returning only the element would mean
// re-querying the DOM for both, which is exactly how a selector that names a
// container stops asserting when the layout moves — a scar tools/smoke.mjs
// already carries twice.
import { h, bindText, bindClass } from '../ui/dom.js';
import { UI, WORLD } from '../content/strings.js';
import { frontierEntry, incursionEntry } from './endgate.js';
import { FRONTIER_ID, frontierOpen } from '../content/endless.data.js';
import { incursionView } from '../meta/incursion.js';
import { regionsConquered } from '../meta/world.js';

/**
 * @param {{meta:()=>object, scenes:object, screens:object}} o
 * @returns {{el:HTMLElement, navButtons:HTMLElement[], set:object}}
 */
export function createWorldHeader({ meta, scenes, screens }) {
  // HOW FAR THROUGH THE WAR YOU ARE, which the world map has never shown. The
  // four figures beside it are all MONEY; this is the only one that answers
  // "where am I", and it is the number the whole screen is a picture of. Its
  // title names the destination, so the objective is one hover from the count.
  const campaign = h('span.num.campaign', { title: WORLD.capitalHint });
  const crowns = h('span.num.crowns');
  const relics = h('span.num.relics');
  const income = h('span.num.income');
  // The one figure that is a LIMIT rather than a balance —
  // see UI.offlineCap. `is-floor` when the player has bought nothing that raises
  // it, which is the state the finding was about.
  const away = h('span.num.away', { title: UI.offlineCapHint });

  // HOISTED rather than built inline: while a raid auto-resolves in the
  // background these are the only things that could carry the player off this
  // screen while the results of that resolve still need `scenes.replace` to land
  // HERE, so each is disabled for the duration rather than guarded ad hoc in a
  // handler somebody adds later and forgets to.
  //
  // Shown LOCKED rather than absent — see screens/endgate.js for why that
  // reversed, and for the shop's own precedent.
  const frontierBtn = frontierEntry({
    open: frontierOpen(regionsConquered(meta())),
    onOpen: () => scenes.replace(screens.prebattle, { regionId: FRONTIER_ID }),
  });
  const incursionBtn = incursionEntry({
    open: incursionView(meta()).open,
    onOpen: () => scenes.push(screens.incursion),
  });
  // `.wm-shop` on the control itself, not "the first button in the header":
  // tools/smoke.mjs used to select `.wm-actions button`, and the moment a second
  // button joined that row it would have been hit-testing whichever came first
  // in the DOM while still reporting that it had checked the shop.
  const shopBtn = h('button.btn.wm-shop', {
    text: UI.shop, type: 'button',
    'aria-label': 'Open the upgrade shop',
    on: { click: () => scenes.push(screens.shop) },
  });
  const menuBtn = h('button.btn.ghost.wm-menu', {
    text: 'Menu', type: 'button',
    'aria-label': 'Open the main menu',
    on: { click: () => scenes.push(screens.mainmenu) },
  });
  const navButtons = [frontierBtn, incursionBtn, shopBtn, menuBtn].filter(Boolean);

  const el = h('div.wm-header.panel', {},
    // NOT a live region. It was `polite` and refreshes every 250ms, and
    // `compact` renders values under 1000 as whole numbers — measured at 3.0
    // announcements a second in the early game, which is a polite queue that
    // never drains and a screen reader that says nothing else about this screen
    // ever again. The countdown in the detail panel already learned this ("a
    // countdown announced once a second is a denial of service"); the treasury
    // had not.
    h('div.wm-treasury', { 'aria-live': 'off' },
      // FIRST, because it is the orientation figure and the rest are balances.
      // The placements in worldmap.css are explicit per index, so anything
      // inserted here has to be renumbered there — that comment is why the
      // pairs are pinned rather than auto-flowed.
      h('span.label', { text: WORLD.rowCampaign, title: WORLD.capitalHint }), campaign,
      h('span.label', { text: UI.treasury }), crowns,
      h('span.label', { text: UI.relics }), relics,
      h('span.label', { text: UI.income }), income,
      // Titled on BOTH halves — see UI.offlineCapHint for what was missing and
      // what it cost. No `aria-label`: the label precedes the value in DOM
      // order, so a screen reader already reads "Away cap, 8h" and an override
      // would only be wordier.
      h('span.label', { text: UI.offlineCap, title: UI.offlineCapHint }), away),
    // The endless loops sit here rather than in the detail panel because
    // neither has a hex of its own.
    h('div.wm-actions', {}, ...navButtons));

  return {
    el,
    navButtons,
    set: {
      campaign: bindText(campaign),
      crowns: bindText(crowns),
      relics: bindText(relics),
      income: bindText(income),
      away: bindText(away),
      awayFloor: bindClass(away, 'is-floor'),
    },
  };
}
