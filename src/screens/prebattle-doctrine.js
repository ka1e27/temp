// THE DOCTRINE PICKER — the one decision made before the map is seen.
//
// Split from prebattle.js at the 400-line cap, the same way the army and
// booster rows already are. The TABLE is content/doctrine.data.js and the DRAW
// is meta/doctrine.js; this file only renders a hand somebody else dealt and
// reports which card was pressed.
//
// A RADIOGROUP, NOT A ROW OF TOGGLES, and that is the difference between this
// and the booster row directly above it in the DOM. A booster is a set — carry
// none, carry all five — so each is its own `aria-pressed` button. A doctrine
// is exactly one, so the whole hand is a `radiogroup` and the cards are
// `radio`s: roving tabindex, arrow keys between them, and a screen reader that
// says "2 of 3" rather than reading three unrelated toggles. Getting this wrong
// is not a styling detail — three checked toggles would announce a state the
// game cannot be in.
import { h, clear, mount } from '../ui/dom.js';

/**
 * @param {HTMLElement} body
 * @param {{choices: object[], picked: string|null, onPick: (id: string) => void}} view
 */
export function renderDoctrines(body, view) {
  clear(body);
  const list = h('div.pb-doctrines', {
    role: 'radiogroup', 'aria-label': 'Doctrine',
  });
  for (const d of view.choices) mount(list, card(d, view));
  mount(body, list);
}

function card(d, view) {
  const on = view.picked === d.id;
  return h('button.pb-doctrine', {
    type: 'button',
    role: 'radio',
    'data-doctrine': d.id,
    class: on ? 'is-on' : 'is-off',
    'aria-checked': on ? 'true' : 'false',
    // ROVING TABINDEX. Every card in the tab order would make a three-card
    // choice cost three Tab presses to walk past, which is precisely what the
    // radiogroup role exists to avoid — one stop for the group, arrows within.
    tabIndex: on ? 0 : -1,
    on: {
      click: () => view.onPick(d.id),
      keydown: (e) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!step) return;
        e.preventDefault();
        const i = view.choices.findIndex((c) => c.id === view.picked);
        const n = view.choices.length;
        // A radiogroup WRAPS — that is the platform behaviour, and stopping at
        // the ends would make the third card unreachable by the arrow a user
        // holds down.
        view.onPick(view.choices[(((i < 0 ? 0 : i) + step) % n + n) % n].id);
      },
    },
  },
  h('span.pb-doctrine-name', { text: d.name }),
  // The two terms are read separately, and by their SIGN rather than by their
  // field: a player deciding between three of these is comparing "what do I
  // get" against "what does it cost", not reading a FactionMods key. The note
  // in the table already says which field in plain words.
  h('span.pb-doctrine-terms', {},
    h('span.pb-term.is-gain', { text: termLabel(d.gain) }),
    h('span.pb-term.is-cost', { text: termLabel(d.cost) })),
  h('span.pb-doctrine-note.dim', { text: d.note }));
}

/**
 * A term as a PERCENTAGE OFF ONE, never as the raw multiplier.
 *
 * `x0.82` is a number a player has to do arithmetic on mid-decision; "-18%
 * income" is the same fact already reduced. The one exception is a term at or
 * above 2x, where the multiplier IS the readable form — "+120% treasury" reads
 * as a typo where "x2.2 treasury" does not.
 *
 * THE SIGN COMES FROM THE VALUE, NEVER FROM WHICH SLOT THE TERM IS IN, and the
 * first cut got that backwards in the one case where it matters. A cost is not
 * always a number going DOWN: `trainCostMult: 1.30` is the Drillmaster's price
 * and it is a rise, so keying the sign off the gain/cost slot printed "-30%
 * training cost" — which reads as training getting CHEAPER, the exact opposite
 * of the term it was describing, on a card whose whole job is to be compared
 * against two others. Whether a term is good or bad is carried by the class it
 * is drawn in and by the sentence underneath; the arithmetic is carried here.
 */
export function termLabel(term) {
  const label = TERM_LABEL[term.field] ?? term.field;
  if (term.value >= 2) return `x${term.value} ${label}`;
  const pct = Math.round(Math.abs(term.value - 1) * 100);
  return `${term.value >= 1 ? '+' : '-'}${pct}% ${label}`;
}

/**
 * What each FactionMods field is CALLED to a player. Deliberately short — this
 * is a chip beside two others, and the sentence underneath carries the detail.
 *
 * `garrisonCapBonus` is deliberately ABSENT even though it is a legal doctrine
 * field, because it is the one FactionMods number that is a SUM rather than a
 * multiplier: `termLabel` would read a `+12` as a 1,100% rise and print it.
 * A doctrine that wants it needs a branch here first, and a missing label
 * falling back to the raw field name is a louder failure than a wrong number.
 */
const TERM_LABEL = Object.freeze({
  startGold: 'treasury',
  goldRateMult: 'income',
  farmYieldMult: 'farm yield',
  trainSpeedMult: 'training speed',
  trainCostMult: 'training cost',
  unitAtkMult: 'attack',
  unitDefMult: 'defence',
  marchSpeedMult: 'march speed',
  siegeDmgMult: 'siege',
  structureRegenMult: 'repair',
});
