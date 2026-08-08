// Keyboard, split out of battle-input.js.
//
// That file's own header says it recognises POINTER gestures — presses, drags,
// taps, pinches — and a keypress is not one of those, so this is a real seam
// and not just a line-count dodge. Same discipline applies either side of it:
// nothing here mutates simulation state, every intent goes through `ord` and
// ends up as a command object on state.commands[].
import { SEND_FRACTIONS } from '../content/balance.js';
import { BOOSTER_BY_KEY, FILTER_BY_KEY, SPEED_KEYS } from './battle-keys.js';

/**
 * @param {{view:object, ord:object, bus?:object, clearDrag:()=>void,
 *          cancelGestures:()=>void}} o
 *   `cancelGestures` lets Esc abandon an in-flight drag that this module
 *   deliberately knows nothing else about.
 * @returns {{onKey:(ev:KeyboardEvent)=>void, onKeyUp:(ev:KeyboardEvent)=>void}}
 */
export function createHotkeys(o) {
  const { view, ord, bus, clearDrag, cancelGestures } = o;

  function onKey(ev) {
    if (ev.target !== document.body && ev.target?.tagName === 'INPUT') return;
    const k = ev.key.toLowerCase();

    const n = Number(k);
    if (Number.isInteger(n) && n >= 1 && n <= SEND_FRACTIONS.length) {
      view.fraction = SEND_FRACTIONS[n - 1];
      bus?.emit('ui:fraction', view.fraction);
      return;
    }
    // Esc unwinds one step at a time: the aiming reticle first, then selection.
    if (k === 'escape') {
      if (ord.cancelBooster()) return;
      view.armed = null;
      ord.selectOnly(null);
      clearDrag();
      cancelGestures();
      return;
    }

    // `R` is documented twice in the design — as retreat and as the rams
    // filter. Resolved by context, which is unambiguous in practice: retreat
    // needs something selected, and you set filters when nothing is.
    // Shift+R always means the filter.
    if (k === 'r' && !ev.shiftKey) {
      if (ord.retreatSelectedSquad()) return;
      if (view.selection.length) { ord.retreatSelection(); return; }
    }
    if (FILTER_BY_KEY[k]) {
      const u = FILTER_BY_KEY[k];
      view.filter[u] = !view.filter[u];
      bus?.emit('ui:filter', view.filter);
      return;
    }
    if (BOOSTER_BY_KEY[k]) { ord.armBooster(BOOSTER_BY_KEY[k]); return; }
    if (SPEED_KEYS[k] !== undefined) { bus?.emit('ui:speed-step', SPEED_KEYS[k]); return; }
    // Slow-mo is HELD, not toggled, so keyup has to be heard for it to end.
    if (k === ' ') { ev.preventDefault(); if (!ev.repeat) bus?.emit('ui:slowmo'); return; }
    if (k === 'p') { bus?.emit('ui:pause'); }
  }

  function onKeyUp(ev) {
    if (ev.key === ' ') bus?.emit('ui:slowmo-end');
  }

  return { onKey, onKeyUp };
}
