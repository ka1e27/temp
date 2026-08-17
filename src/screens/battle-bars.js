// The site panel's three fills: HP, troop composition and training progress.
//
// Bars, not lines — the same "reads as area before any digit is parsed" idea
// that already drives the on-canvas garrison core (palette.js `core`) and the
// outcome preview's `.pv-comp` belongs on the panel too, where the old text
// (`7 troops · HP 193/480`) made a player read three numbers to answer one
// question: "is this fort in trouble?"
//
// PRESENTATION ONLY. Every fraction here is handed in by the caller from a
// field THIS FILE never computes — site.hp/hpMax, site.garrison,
// site.trainProgress — see battle-econ.js's header for why that discipline
// exists and battle-panel.js for where these numbers actually come from.
import { UNIT_IDS } from '../content/balance.js';
import { UNITS_UI } from '../content/strings.js';
import { h, bindText, bindClass, bindStyle, bindAttr } from '../ui/dom.js';
import { plural } from '../ui/format.js';

/**
 * One fill bar: a track, a coloured fill (0..100% width) and a number
 * centred OVER THE WHOLE TRACK — not beside it, and not clipped by a thin
 * fill, which is why the label is its own absolutely-positioned layer rather
 * than a child of the fill.
 * @param {string} cls a modifier class (`bar-hp`, `bar-train`) for CSS.
 */
export function createFillBar(cls) {
  const fill = h('div.bar-fill');
  const label = h('span.bar-label', { text: '' });
  const el = h(`div.bar.${cls}`, {}, fill, label);
  const setW = bindStyle(fill, 'width');
  const setColor = bindStyle(fill, 'background');
  const setText = bindText(label, '');
  const setOpen = bindClass(el, 'is-open');
  return {
    el,
    /** @param {number} frac 0..1, clamped @param {string} text */
    update(frac, text) {
      setW(`${Math.max(0, Math.min(1, frac)) * 100}%`);
      setText(text);
    },
    /** A `var(--c-...)` reference, or any valid CSS colour. */
    color(value) { setColor(value); },
    /** Hidden by default (`display:none` in CSS) — multi-select and the
     *  squad view have nothing to fill this bar with. */
    show(on) { setOpen(on); },
  };
}

/**
 * The troop composition bar: one segment per unit type, width proportional
 * to its share of the garrison, in the SAME five hues the board, the train
 * picker and the outcome preview already use (`var(--c-{unit})` — see
 * palette.js / hud.css's filter chips for the one place that hue is ever
 * written down).
 *
 * Built ONCE — five fixed segments in UNIT_IDS order, never torn down and
 * rebuilt — so a unit that just hit zero merely collapses to 0% width rather
 * than the bar re-attaching its hover card (see battle-tip.js) every time a
 * training cycle completes, which would otherwise leak a listener a tick.
 * THE SEGMENTS ARE NEVER IN THE TAB ORDER, and that is a fix rather than an
 * omission. They used to take `tabIndex = 0` whenever they held troops, which
 * made five keyboard targets 15px tall — a third of the 44px minimum — that
 * ACTIVATE NOTHING: focusing one only opened the hover card, and the card
 * carries a permanent `aria-hidden` (battle-tip.js), so a screen reader
 * announced precisely nothing for the trouble. Five silent undersized stops on
 * the way to the panel's real buttons.
 *
 * What replaces it is better than what it removed: the bar names its OWN
 * composition (`role="img"` plus a live `aria-label`), so the whole breakdown
 * is announced in one go without any interaction at all. A readout should not
 * have to be operated.
 *
 * @param {?object} [tip] the shared unit hover card (battle-tip.js), so
 *   hovering a segment answers "how many of THIS unit" without a permanent
 *   number crowding every segment at once. Optional, same as `board` on the
 *   panel itself — omit it (a headless test) and the bar still renders and
 *   updates, it just has nothing to show on hover.
 */
export function createCompBar(tip) {
  const counts = {};
  const segEls = UNIT_IDS.map((u) => {
    const seg = h('span.bar-comp-seg', {
      'data-interactive': true, tabindex: '-1', 'aria-hidden': 'true',
      style: { background: `var(--c-${u})` },
    });
    tip?.attach(seg, u, () => plural(counts[u] || 0, 'troop', 'troops'));
    return seg;
  });
  const segW = segEls.map((s) => bindStyle(s, 'width'));
  const label = h('span.bar-label', { text: '' });
  const track = h('div.bar-comp-track', {}, ...segEls);
  const el = h('div.bar.bar-comp', { role: 'img' }, track, label);
  const setLabel = bindText(label, '');
  const setOpen = bindClass(el, 'is-open');
  const setName = bindAttr(el, 'aria-label');
  return {
    el,
    /** @param {object} garrison @param {number} held total(garrison), already
     *  computed by siteIntel() — not re-summed here. */
    update(garrison, held) {
      // Built in the same pass that sizes the segments, so the sentence and
      // the picture can never disagree, and skipping the absent units keeps it
      // to what is actually there rather than five "0 militia"s.
      let name = `Garrison ${held}`;
      let first = true;
      for (let i = 0; i < UNIT_IDS.length; i++) {
        const u = UNIT_IDS[i];
        const c = garrison[u] || 0;
        counts[u] = c;
        segW[i](held > 0 ? `${(c / held) * 100}%` : '0%');
        if (c <= 0) continue;
        name += `${first ? ': ' : ', '}${c} ${UNITS_UI[u]?.name || u}`;
        first = false;
      }
      setLabel(String(held));
      setName(name);
    },
    show(on) { setOpen(on); },
  };
}
