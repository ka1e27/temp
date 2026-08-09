// The unit hover card.
//
// The dock chips used to read `MIL Q`, `SPE W`, `RAI E`, `RAM R`, `MAR T`. A
// player who has not read balance.js cannot tell which of those breaks a wall,
// and the game never said. They now carry the real name and this card, which
// says what the unit is FOR in the terms the simulation actually uses — the
// copy and its numbers live in content/strings.js UNITS_UI.
//
// Deliberately NOT `title=`: a native tooltip takes a second to appear, cannot
// be styled to match the plate language, never shows for a keyboard user, and
// is unreadable on touch. This is one shared element, parked over the dock so
// it never covers the board, and pointer-events:none so it can never intercept
// a click meant for the chip underneath it.
import { h, mount, bindText, bindClass, bindStyle, createDisposer } from '../ui/dom.js';
import { UNITS_UI } from '../content/strings.js';
import { placeTip, panelBounds } from './battle-anchor.js';

/**
 * @param {{root:HTMLElement}} o  `root` is #hud; the card mounts into it and
 *   positions itself in the same screen-pixel space the camera projects into.
 */
export function createUnitTip(o) {
  const { root } = o;
  const off = createDisposer();
  const name = h('span.tip-name', { text: '' });
  const role = h('span.tip-role', { text: '' });
  const desc = h('p.tip-desc', { text: '' });
  const note = h('span.tip-note', { text: '' });
  const el = h('div.hud-tip.panel', { role: 'tooltip', 'aria-hidden': 'true' },
    h('span.tip-head', {}, name, role), desc, note);
  mount(root, el);

  const set = {
    open: bindClass(el, 'is-open'),
    above: bindClass(el, 'is-above'),
    name: bindText(name, ''),
    role: bindText(role, ''),
    desc: bindText(desc, ''),
    note: bindText(note, ''),
    x: bindStyle(el, '--x'),
    y: bindStyle(el, '--y'),
    cx: bindStyle(el, '--cx'),
  };
  let shownFor = null;

  function show(anchorEl, unitId, footer) {
    const copy = UNITS_UI[unitId];
    if (!copy) return;
    shownFor = anchorEl;
    set.name(copy.name);
    set.role(copy.role);
    set.desc(copy.desc);
    // `footer` may be a function rather than a fixed string — the composition
    // bar's segments attach ONCE (see battle-bars.js) but the count they
    // report changes every training tick, so it has to be read fresh at
    // SHOW time, not baked in at attach time.
    set.note(typeof footer === 'function' ? footer() : (footer || ''));
    // Text first, THEN measure: the card is sized by its copy, and placing it
    // on last unit's box is how a tooltip ends up half off the screen.
    set.open(true);
    const box = anchorEl.getBoundingClientRect();
    const at = placeTip({
      anchor: { x: box.left + box.width / 2, y: box.top },
      size: { w: el.offsetWidth || 260, h: el.offsetHeight || 96 },
      bounds: panelBounds(root.clientWidth || 0, root.clientHeight || 0, { top: 8, bottom: 8 }),
    });
    set.x(`${at.x}px`);
    set.y(`${at.y}px`);
    set.cx(`${at.caretX}px`);
    set.above(at.above);
  }

  function hide(anchorEl) {
    if (anchorEl && anchorEl !== shownFor) return;
    shownFor = null;
    set.open(false);
  }

  return {
    el,
    /**
     * Wire one control to the card. Pointer AND focus, so the descriptions are
     * reachable from the keyboard rather than being a mouse-only secret.
     * @param {HTMLElement} target @param {string} unitId
     * @param {string|(()=>string)} [footer] a fixed string, or a thunk read at
     *   show-time for a value that changes while the card is closed.
     */
    attach(target, unitId, footer) {
      off.listen(target, 'pointerenter', () => show(target, unitId, footer));
      off.listen(target, 'pointerleave', () => hide(target));
      off.listen(target, 'focus', () => show(target, unitId, footer));
      off.listen(target, 'blur', () => hide(target));
      // A chip that has just been clicked keeps hover on desktop but the state
      // it describes has changed, so the card is refreshed rather than left.
      off.listen(target, 'click', () => show(target, unitId, footer));
      target.setAttribute('aria-describedby', el.id || (el.id = 'hud-unit-tip'));
    },
    hide: () => hide(null),
    dispose() { off.dispose(); el.remove(); },
  };
}
