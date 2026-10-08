// Battle crowns row (DESIGN §4.8): three crown medals — Victory, Swift, Unbroken — empty or
// earned. One component for the victory card, the region card and the phone bottom sheet.
// Browser only; no game-logic imports (the integrator resolves par time and earned crowns via
// game/meta/crowns.js and passes plain data in).
import { h } from './dom.js';
import { icon } from './icons.js';
import { formatClock } from './format.js';

/** Slot order = display order = award order. `badge` is a tiny corner glyph that tells the crowns apart at a glance. */
export const CROWN_SLOTS = Object.freeze([
  { key: 'victory', badge: 'flag' },
  { key: 'swift', badge: 'clock' },
  { key: 'unbroken', badge: 'shield' },
]);

const SIZES = Object.freeze({ sm: 18, md: 26, lg: 36 });
const POP_MS = 700;

/**
 * @typedef {Object} CrownRowData
 * @property {{ victory: boolean, swift: boolean, unbroken: boolean } | null} earned
 *   null = not conquered yet (three open "target" medals); an object = the final result, where a
 *   false key is a missed crown.
 * @property {number} parSec           par time in battle seconds, shown as "Swift ≤ 1:30"
 * @property {boolean} [animate]       award the earned crowns one by one (~350 ms apart) with a pop
 * @property {number} [durationSec]    optional: the winning time, for the Swift tooltip / screen reader
 * @property {number} [bonusPct]       optional: e.g. 25 shows "+25%" under every earned crown
 */

/** Text for the Swift slot, e.g. `Swift ≤ 1:30`. */
export function swiftLabel(parSec) {
  return `Swift ≤ ${formatClock(parSec)}`;
}

/** The earned crown keys in award order (pure; used by the animation and by tests). */
export function awardOrder(earned) {
  if (!earned) return [];
  return CROWN_SLOTS.filter((s) => earned[s.key]).map((s) => s.key);
}

/** What the row says when nobody hands it texts: the names only (the hints are copy from game/config/crowns.js, passed in as data). */
const NO_TEXTS = Object.freeze({ victory: { label: 'Victory', hint: '' }, unbroken: { label: 'Unbroken', hint: '' } });

function slotText(key, parSec, durationSec, texts) {
  // Victory and Unbroken come from the `texts` the scene hands in (built from CROWN_TEXT in game/config/crowns.js: what "unbroken" means is a
  // balance rule and moves with it); this file imports nothing from the game.
  if (key === 'victory' || key === 'unbroken') return { label: (texts && texts[key] && texts[key].label) || NO_TEXTS[key].label, hint: (texts && texts[key] && texts[key].hint) || '' };
  const par = formatClock(parSec);
  const hint = durationSec != null
    ? `Win within ${par} of battle time, at any speed. This win took ${formatClock(durationSec)}.`
    : `Win within ${par} of battle time, at any speed.`;
  return { label: swiftLabel(parSec), hint };
}

function reducedMotion() {
  const root = document.documentElement;
  if (root.classList.contains('reduce-motion')) return true;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * @param {{ size?: 'sm'|'md'|'lg'|number, startDelayMs?: number, gapMs?: number,
 *           onAward?: (key: string, index: number) => void }} [opts]
 *   `size`: crown glyph size ('sm' 18px for the region card, 'md' 26px for the results card, 'lg' 36px).
 *   `startDelayMs`: pause before the first crown of an animated award (default 450, so a card that
 *   pops in over 420 ms is finished first). `gapMs`: between crowns (default 350).
 *   `onAward(key, index)`: fired as each crown lands, e.g. to play a sound per crown.
 *   `texts`: { victory: { label, hint }, unbroken: { label, hint } }, the crown copy (CROWN_TEXT in game/config/crowns.js).
 */
export function createCrownRow({ size = 'md', startDelayMs = 450, gapMs = 350, onAward, texts } = {}) {
  const px = typeof size === 'number' ? size : SIZES[size] || SIZES.md;
  const sizeClass = typeof size === 'string' && SIZES[size] ? size : 'custom';

  const slots = new Map();
  for (const def of CROWN_SLOTS) {
    const glyph = h('span.crown-glyph', {}, icon('crown', px));
    const ring = h('span.crown-ring', {});
    const sparks = Array.from({ length: 6 }, (_, i) => {
      const spark = h('span.crown-spark', {});
      spark.style.setProperty('--a', `${i * 60 + 15}deg`);
      return spark;
    });
    const badge = h('span.crown-badge', {}, icon(def.badge, Math.max(8, Math.round(px * 0.36))));
    const medal = h('span.crown-medal', {}, ring, ...sparks, glyph, badge);
    const label = h('span.crown-label', {}, '');
    const bonus = h('span.crown-bonus', {}, '');
    const el = h('div.crown-slot', { role: 'listitem', dataset: { key: def.key, state: 'target' } }, medal, label, bonus);
    slots.set(def.key, { el, label, bonus, glyph, popTimer: 0 });
  }

  const el = h('div.crown-row', { role: 'list', 'aria-label': 'Battle crowns', dataset: { size: sizeClass } },
    ...CROWN_SLOTS.map((d) => slots.get(d.key).el));
  el.style.setProperty('--crown-px', `${px}px`);

  let timers = [];
  let lastSig = null;
  let lastData = null;

  function cancelTimers() {
    for (const t of timers) clearTimeout(t);
    timers = [];
  }

  function setState(key, state, pop) {
    const slot = slots.get(key);
    slot.el.dataset.state = state;
    clearTimeout(slot.popTimer);
    slot.el.classList.remove('is-popping');
    if (pop) {
      void slot.el.offsetWidth; // restart the CSS animation if it is already running
      slot.el.classList.add('is-popping');
      // longest part of the pop (the ring) lasts 640 ms
      slot.popTimer = setTimeout(() => slot.el.classList.remove('is-popping'), POP_MS);
    }
  }

  function describe(data, earnedKeys) {
    const count = earnedKeys.length;
    el.setAttribute('aria-label', data.earned
      ? `Battle crowns: ${count} of 3 earned`
      : 'Battle crowns: none earned yet');
    for (const def of CROWN_SLOTS) {
      const slot = slots.get(def.key);
      const text = slotText(def.key, data.parSec || 0, data.durationSec, texts);
      slot.label.textContent = text.label;
      const earned = !!(data.earned && data.earned[def.key]);
      const status = !data.earned ? 'not earned yet' : earned ? 'earned' : 'missed';
      slot.el.title = `${text.label} — ${text.hint}`;
      slot.el.setAttribute('aria-label', `${text.label}: ${status}. ${text.hint}`);
      // While an animated award is still landing, the bonus tag appears with its crown instead. Its line is held from the start
      // (invisible until the crown lands) so the row never grows under a tap: the results card is centred and its Continue would move.
      slot.bonus.textContent = data.bonusPct && earned ? `+${data.bonusPct}%` : '';
      slot.bonus.classList.toggle('is-pending', !!data.animate && earned);
    }
  }

  function restingState(key, data) {
    if (!data.earned) return 'target';
    return data.earned[key] ? 'earned' : 'missed';
  }

  /** @param {CrownRowData} data */
  function update(data) {
    if (!data) return;
    const sig = JSON.stringify([data.earned, data.parSec, !!data.animate, data.durationSec, data.bonusPct]);
    if (sig === lastSig) return; // safe to call every frame
    lastSig = sig;
    lastData = data;
    cancelTimers();

    const earnedKeys = awardOrder(data.earned);
    describe(data, earnedKeys);

    if (!data.animate || earnedKeys.length === 0) {
      for (const def of CROWN_SLOTS) setState(def.key, restingState(def.key, data), false);
      return;
    }

    // Start every slot in its not-yet-earned look, then land the earned crowns one by one.
    for (const def of CROWN_SLOTS) setState(def.key, data.earned[def.key] ? 'target' : 'missed', false);
    const instant = reducedMotion();
    earnedKeys.forEach((key, i) => {
      const land = () => {
        setState(key, 'earned', !instant);
        slots.get(key).bonus.classList.remove('is-pending');
        if (onAward) onAward(key, i);
      };
      if (instant) land();
      else timers.push(setTimeout(land, startDelayMs + i * gapMs));
    });
  }

  /** Runs the last animated award again (gallery / "replay"). */
  function replay() {
    if (!lastData) return;
    const data = { ...lastData, animate: true };
    lastSig = null;
    update(data);
  }

  /**
   * Forget the last data so the next update() renders (and animates) again even if it is
   * identical. Call it when the row is shown for a NEW result, e.g. at the start of every
   * victory card: two wins in a row with the same crowns must both play the award.
   */
  function reset() {
    cancelTimers();
    for (const slot of slots.values()) clearTimeout(slot.popTimer);
    lastSig = null;
  }

  function destroy() {
    cancelTimers();
    for (const slot of slots.values()) clearTimeout(slot.popTimer);
  }

  return { el, update, replay, reset, destroy };
}
