// "Hold to confirm" (PLAN-PHASE14 §14B.5): with the option on, a button that does something irreversible (Retreat, Delete forever, a New Realm
// over a save, Demolish) acts only after a press held for HOLD_CONFIRM_MS. A fill sweeps across the button while it is held; letting go, a second
// finger or losing focus cancels. The keyboard holds Space or Enter the same way. A plain click does nothing but a nudge of the "Hold" word, so a
// stray tap can never retreat. Buttons are wired once and read the option at press time, so it applies live, even to a panel built at boot.
// With the option off a hold button is an ordinary button. `html[data-hold-confirm]` shows the fill and the word (styles/components/options.css).
import { HOLD_CONFIRM_MS } from '../config/options.js';

let enabled = false;
export function setHoldToConfirm(on) {
  enabled = !!on;
  if (typeof document !== 'undefined') document.documentElement.toggleAttribute('data-hold-confirm', enabled);
}
export const holdToConfirmOn = () => enabled;

/**
 * Makes `btn` a hold button. When a hold completes (option on) `onConfirm` runs; by default that is the button's own click, let through once.
 * With the option off the button's own click handlers run as usual.
 * @param {HTMLButtonElement} btn
 * @param {() => void} [onConfirm]
 * @param {{ ms?: number }} [opts]
 */
export function makeHoldButton(btn, onConfirm, { ms = HOLD_CONFIRM_MS } = {}) {
  if (!btn || btn.classList.contains('is-hold')) return btn;
  let passing = false;
  const confirm = onConfirm || (() => { passing = true; try { btn.click(); } finally { passing = false; } });
  btn.classList.add('is-hold');
  btn.style.setProperty('--hold-ms', `${ms}ms`);
  const label = btn.getAttribute('aria-label') || btn.textContent.trim();
  const fill = document.createElement('span');
  fill.className = 'hold-fill';
  fill.setAttribute('aria-hidden', 'true');
  const hint = document.createElement('span');
  hint.className = 'hold-hint';
  // the word is CSS content (options.css), so the button's own text, which tools and tests match on, stays exactly its label
  hint.setAttribute('aria-hidden', 'true');
  btn.prepend(fill);
  btn.append(hint);
  const sync = () => {
    if (enabled) btn.setAttribute('aria-label', `${label} (press and hold)`);
    else if (btn.getAttribute('aria-label') !== label) btn.setAttribute('aria-label', label);
  };
  sync();
  let timer = 0;
  let pointerId = null;
  let completedAt = -1e9;
  const start = () => {
    if (timer) return;
    btn.classList.add('is-holding');
    timer = setTimeout(() => {
      timer = 0;
      btn.classList.remove('is-holding');
      completedAt = performance.now();
      confirm();
    }, ms);
  };
  const cancel = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = 0;
    btn.classList.remove('is-holding');
  };
  btn.addEventListener('focus', sync);
  btn.addEventListener('pointerenter', sync);
  btn.addEventListener('pointerdown', (e) => {
    sync();
    if (!enabled) return;
    if (pointerId != null && e.pointerId !== pointerId) { cancel(); return; } // a second finger
    if (e.button) return;
    pointerId = e.pointerId;
    try { btn.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    start();
  });
  const end = (e) => { if (pointerId != null && e && e.pointerId !== pointerId) return; pointerId = null; cancel(); };
  btn.addEventListener('pointerup', end);
  btn.addEventListener('pointercancel', end);
  btn.addEventListener('lostpointercapture', end);
  btn.addEventListener('keydown', (e) => {
    if (!enabled || (e.key !== ' ' && e.key !== 'Enter')) return;
    e.preventDefault(); // no click from the key itself
    e.stopPropagation();
    if (!e.repeat) start();
  });
  btn.addEventListener('keyup', (e) => { if (enabled && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); cancel(); } });
  btn.addEventListener('blur', cancel);
  // option on: every click is swallowed (the hold already acted); one that was not a hold nudges the "Hold" word
  btn.addEventListener('click', (e) => {
    if (!enabled || passing) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (performance.now() - completedAt < 600) return;
    btn.classList.remove('is-nudge');
    void btn.offsetWidth;
    btn.classList.add('is-nudge');
  }, true);
  return btn;
}
