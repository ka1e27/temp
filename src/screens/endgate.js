// A WAY IN THAT IS VISIBLE BEFORE IT IS OPEN.
//
// The incursion ladder and abdication were both absent from the DOM until the
// campaign was finished — not disabled, not shown-locked, simply not built. So
// a player twelve regions into a twenty-four-region campaign had no way to know
// either existed, and `ENDGAME.incursionLocked` / `ENDGAME.abdicateLocked` —
// written for exactly this moment — had NO READER at all. That is the dead-copy
// shape `IDLE.awayCapped` was already found in once, where a whole block of
// strings sat unreachable while a screen hardcoded its own beside them.
//
// The precedent for the fix is the game's own and it is already proven:
// `screens/shop.js` shows the Crown tier locked WITH its price and its unlock
// condition from a region-1 save, and its comment says why — "the PRICE is
// still shown, that is what makes a locked line worth showing".
//
// ONE HELPER, TWO SCREENS, because the two would otherwise drift in exactly the
// way this exists to fix: one of them showing what is coming and the other not.
import { h } from '../ui/dom.js';

/**
 * @param {{cls:string, text:string, open:boolean, why:string, label:string,
 *          onOpen:Function}} o
 *   `why` is the locked explanation and `label` the open one. The handler is
 *   guarded as well as the button being `disabled`, because `disabled` is a
 *   presentation fact and a keyboard or a script can still reach a handler.
 */
export function endgameEntry(o) {
  return h(`button.btn.${o.cls}`, {
    text: o.text, type: 'button',
    disabled: o.open ? null : true,
    // Not `disabled` alone: that styles as "temporarily unavailable", and this
    // is "not yet earned", which the shop already distinguishes the same way.
    'data-locked': o.open ? null : '1',
    title: o.open ? null : o.why,
    // The locked reason is the accessible name, or a screen reader gets a
    // button with no explanation of why it will not activate.
    'aria-label': o.open ? o.label : `${o.text} — ${o.why}`,
    on: { click: () => { if (o.open) o.onOpen(); } },
  });
}
