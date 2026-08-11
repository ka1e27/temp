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
/** A focusable control that owns its own keys — Space activates it, and a
 *  letter typed while it has focus belongs to it, not to a global shortcut. */
const isControl = (el) => !!el && el !== document.body
  && /^(BUTTON|INPUT|SELECT|TEXTAREA|A)$/.test(el.tagName ?? '');

export function createHotkeys(o) {
  const { view, ord, bus, clearDrag, cancelGestures } = o;

  function onKey(ev) {
    if (ev.target !== document.body && ev.target?.tagName === 'INPUT') return;
    // Fifteen single-character shortcuts are bound on `window`, so a focused
    // control has to be able to keep its own keys. Measured: focusing the
    // "25%" segment and typing `q` toggled the militia filter off.
    if (isControl(ev.target) && /^[a-z0-9]$/i.test(ev.key)) return;
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
      if (ord.cancelBuild()) return;
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
    // A focused BUTTON owns Space — it is the conventional activation key, and
  // swallowing it here made every HUD control look broken to anyone using the
  // keyboard (Enter fired, Space did nothing). The old guard only exempted
  // INPUT, which is not where this game's controls live.
  if (k === ' ' && isControl(ev.target)) return;
  if (k === ' ') { ev.preventDefault(); if (!ev.repeat) bus?.emit('ui:slowmo'); return; }
    if (k === 'p') { bus?.emit('ui:pause'); }
  }

  function onKeyUp(ev) {
    if (ev.key === ' ') bus?.emit('ui:slowmo-end');
  }

  return { onKey, onKeyUp };
}
