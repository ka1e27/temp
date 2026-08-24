// Keyboard, split out of battle-input.js.
//
// That file's own header says it recognises POINTER gestures — presses, drags,
// taps, pinches — and a keypress is not one of those, so this is a real seam
// and not just a line-count dodge. Same discipline applies either side of it:
// nothing here mutates simulation state, every intent goes through `ord` and
// ends up as a command object on state.commands[].
import { SEND_FRACTIONS } from '../content/balance.js';
import { BOOSTER_BY_KEY, FILTER_BY_KEY, SPEED_KEYS, filterUnits } from './battle-keys.js';
import { navigableSites, stepId } from './battle-keynav.js';

/**
 * @param {{view:object, ord:object, bus?:object, getState:()=>object,
 *          clearDrag:()=>void, cancelGestures:()=>void}} o
 *   `cancelGestures` lets Esc abandon an in-flight drag that this module
 *   deliberately knows nothing else about. `getState` is here for exactly one
 *   question — which troop chips this battle offers — so the keyboard and the
 *   rail cannot disagree about it.
 * @returns {{onKey:(ev:KeyboardEvent)=>void, onKeyUp:(ev:KeyboardEvent)=>void}}
 */
/** A focusable control that owns its own keys — Space activates it, and a
 *  letter typed while it has focus belongs to it, not to a global shortcut. */
const isControl = (el) => !!el && el !== document.body
  && /^(BUTTON|INPUT|SELECT|TEXTAREA|A)$/.test(el.tagName ?? '');

export function createHotkeys(o) {
  const { view, ord, bus, getState, clearDrag, cancelGestures } = o;

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
    // WALKING THE BOARD WITHOUT A POINTER. `]`/`[` (and the arrows, which were
    // bound to nothing) cycle the cursor; Enter aims it at a target and commits.
    // Until this existed the keyboard could set filters and fire the two
    // untargeted boosters and NOTHING ELSE — every other verb in the game hangs
    // off a selection, and only a pointer could make one.
    //
    // The cursor IS `view.hoverId`, deliberately: the renderer already draws a
    // ring there, so this needed no draw code and a keyboard player sees the
    // same mark a mouse player does. A pointermove overwrites it, which is the
    // right precedence — the last input to say where it is looking wins.
    //
    // ⚠ AND A FOCUSED CONTROL KEEPS ALL FOUR OF THESE. The guard at the top of
    // this function only exempts single alphanumerics, so without this Enter
    // would fire the board's aim AND activate the focused button in the same
    // keystroke, and an arrow would walk the board out from under a slider.
    if ((k === ']' || k === '[' || k === 'arrowright' || k === 'arrowleft'
      || k === 'enter') && isControl(ev.target)) return;
    if (k === ']' || k === '[' || k === 'arrowright' || k === 'arrowleft') {
      const dir = (k === ']' || k === 'arrowright') ? 1 : -1;
      const st = getState?.();
      if (!st) return;
      ev.preventDefault();
      if (view.kbAiming) {
        // Aiming walks everything the player KNOWS about — you may send at an
        // enemy wall or at your own — minus the sources, which are already
        // where the order is coming from.
        const list = navigableSites(st, 'player', false)
          .filter((s) => !view.selection.includes(s.id));
        view.hoverId = stepId(list, view.hoverId, dir);
      } else {
        const list = navigableSites(st, 'player', true);
        const id = stepId(list, view.hoverId, dir);
        view.hoverId = id;
        if (id) { ord.selectOnly(id); bus?.emit('ui:focus-panel'); }
      }
      return;
    }
    if (k === 'enter') {
      ev.preventDefault();
      if (view.kbAiming) {
        const to = view.hoverId ? ord.site(view.hoverId) : null;
        if (to) ord.sendFromSelection(to);
        view.kbAiming = false;
        return;
      }
      // Aiming needs somewhere to aim FROM. Seeding the cursor at the first
      // candidate rather than leaving it on the source is what makes the very
      // next `]` mean "the one after that" instead of "start over".
      if (!view.selection.length) return;
      const st = getState?.();
      const list = st ? navigableSites(st, 'player', false)
        .filter((s) => !view.selection.includes(s.id)) : [];
      if (!list.length) return;
      view.kbAiming = true;
      view.hoverId = list[0].id;
      return;
    }

    // Esc unwinds one step at a time: the aiming reticle first, then selection.
    if (k === 'escape') {
      if (ord.cancelBooster()) return;
      if (ord.cancelBuild()) return;
      if (view.kbAiming) { view.kbAiming = false; return; }
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
      // ONLY A TROOP THIS BATTLE HAS A CHIP FOR. All nine letters were bound
      // regardless, so pressing `U` in a battle carrying no halberds flipped a
      // flag with nothing on screen to show for it — and left it flipped for
      // the rest of the battle, ready to silently exclude the troop the moment
      // one was captured into the army. Swallowed rather than fallen through,
      // because it is still the filter key that was pressed: the answer is
      // "not in this battle", not "that key means something else here".
      if (getState && !filterUnits(getState()).includes(u)) return;
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
