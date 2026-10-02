// Dialog manager (DESIGN §7.5a): every panel that takes over the screen (Settings, War Council, Realm, the welcome-back card, the controls card, confirmations,
// the results card) behaves the same way for a keyboard and a screen reader. Browser only; no game-logic imports.
//
//   * focus MOVES IN when it opens (the least destructive button, or what the dialog names with `data-autofocus`) and is RESTORED to the opener on close;
//   * everything behind it is `inert` (the canvas, the rest of the UI): not focusable, not clickable, not in the accessibility tree;
//   * Tab is TRAPPED inside the topmost dialog; Escape closes the topmost one only (one handler per layer, topmost first), also on the title screen,
//     where the map's own input is switched off;
//   * it carries `role="dialog"`, `aria-modal` and `aria-labelledby` (its heading);
//   * while ANY dialog is open `<html data-dialog>` is set, so shortcuts (input/pointer.js, ui/battleHud.js) stand down, and subscribers (the battle scene)
//     hear the count: a battle pauses itself while a dialog is open and resumes when the last one closes.
//
// Panels that the scenes show and hide with `el.hidden` register once with `watchDialog(el, opts)`; popups that are built and destroyed (createModal) call
// `openDialog` / `closeDialog`. Elements marked `data-keep-live` (the toasts) are never made inert, so they are still announced.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** @type {Array<{ el: HTMLElement, opts: DialogOptions, opener: HTMLElement|null }>} */
const stack = [];
const inerted = new Set();
const subscribers = new Set();
let uid = 0;

/**
 * @typedef {Object} DialogOptions
 * @property {HTMLElement} [labelEl]     the element that gets role / aria-modal / aria-labelledby (default: the dialog element itself)
 * @property {HTMLElement} [titleEl]     the heading that names it (default: the first h1-h3 inside)
 * @property {string} [label]            a plain aria-label when there is no heading
 * @property {HTMLElement|string|((el: HTMLElement) => HTMLElement|null)} [initialFocus]
 * @property {(() => void)|null} [onEscape]   what Escape does (default: close this dialog); null = Escape does nothing here
 */

const shown = (e) => e.getClientRects().length > 0 && !e.closest('[hidden]') && getComputedStyle(e).visibility !== 'hidden';

/** The focusable, visible controls inside `root`, in DOM order. */
export function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((e) => shown(e) && !e.closest('[inert]'));
}

function ensureId(e, prefix) {
  if (!e.id) { uid += 1; e.id = `${prefix}-${uid}`; }
  return e.id;
}

function describe(entry) {
  const target = entry.opts.labelEl || entry.el;
  if (!target.getAttribute('role')) target.setAttribute('role', 'dialog');
  target.setAttribute('aria-modal', 'true');
  const title = entry.opts.titleEl || entry.el.querySelector('h1, h2, h3, .modal-title');
  if (title) target.setAttribute('aria-labelledby', ensureId(title, 'dialog-title'));
  else if (entry.opts.label) target.setAttribute('aria-label', entry.opts.label);
  if (!entry.el.hasAttribute('tabindex')) entry.el.setAttribute('tabindex', '-1');
}

/** Everything that is not the topmost dialog (or one of its ancestors) becomes inert; the toasts stay live. */
function sync() {
  for (const e of inerted) e.removeAttribute('inert');
  inerted.clear();
  const top = stack[stack.length - 1];
  document.documentElement.toggleAttribute('data-dialog', !!top);
  if (!top) return;
  let node = top.el;
  while (node && node !== document.body && node.parentElement) {
    for (const sib of node.parentElement.children) {
      if (sib === node || sib.hasAttribute('data-keep-live') || sib.hasAttribute('inert')) continue;
      if (['SCRIPT', 'STYLE', 'LINK', 'META'].includes(sib.tagName)) continue;
      sib.setAttribute('inert', '');
      inerted.add(sib);
    }
    node = node.parentElement;
  }
}

function notify() {
  for (const fn of subscribers) fn(stack.length);
}

function focusInitial(entry) {
  const { el, opts } = entry;
  let target = null;
  if (typeof opts.initialFocus === 'function') target = opts.initialFocus(el);
  else if (typeof opts.initialFocus === 'string') target = el.querySelector(opts.initialFocus);
  else if (opts.initialFocus) target = opts.initialFocus;
  if (!target) target = el.querySelector('[data-autofocus]');
  if (!target || !shown(target)) target = focusables(el)[0] || el;
  target.focus({ preventScroll: true });
}

/** Opens `el` as a modal dialog (idempotent). */
export function openDialog(el, opts = {}) {
  if (!el || !el.isConnected || stack.some((d) => d.el === el)) return;
  const active = document.activeElement;
  const entry = { el, opts, opener: active && active !== document.body ? /** @type {HTMLElement} */ (active) : null };
  stack.push(entry);
  describe(entry);
  sync();
  focusInitial(entry);
  notify();
}

/** Closes `el` and, when it was the topmost, gives focus back to what opened it. */
export function closeDialog(el) {
  const at = stack.findIndex((d) => d.el === el);
  if (at < 0) return;
  const [entry] = stack.splice(at, 1);
  const wasTop = at === stack.length;
  sync();
  const insideOrNowhere = !document.activeElement || document.activeElement === document.body || el.contains(document.activeElement);
  if (wasTop && insideOrNowhere) {
    const back = stack.length ? null : entry.opener;
    if (stack.length) focusInitialIfLost(stack[stack.length - 1]);
    else if (back && back.isConnected && shown(back) && !back.closest('[inert]')) back.focus({ preventScroll: true });
  }
  notify();
}

function focusInitialIfLost(entry) {
  if (!entry.el.contains(document.activeElement)) focusInitial(entry);
}

/**
 * A panel that its scene shows and hides with `el.hidden`: it is a dialog exactly while it is visible.
 * @returns {() => void} stops watching
 */
export function watchDialog(el, opts = {}) {
  const apply = () => { if (el.hidden) closeDialog(el); else openDialog(el, opts); };
  const mo = new MutationObserver(apply);
  mo.observe(el, { attributes: true, attributeFilter: ['hidden'] });
  if (!el.hidden) queueMicrotask(apply);
  return () => { mo.disconnect(); closeDialog(el); };
}

/** Hears how many dialogs are open (0 = none), whenever it changes. Returns an unsubscribe function. */
export function onDialogChange(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export const dialogCount = () => stack.length;
export const isDialogOpen = () => stack.length > 0;

// One listener for the whole page: the topmost dialog owns Escape and Tab.
if (typeof document !== 'undefined') document.addEventListener('keydown', (e) => {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopImmediatePropagation(); // nothing under the dialog (selection clearing, a panel's own Escape) sees it
    if (top.opts.onEscape === null) return;
    (top.opts.onEscape || (() => closeDialog(top.el)))();
    return;
  }
  if (e.key !== 'Tab') return;
  const list = focusables(top.el);
  if (!list.length) { e.preventDefault(); top.el.focus(); return; }
  const first = list[0];
  const last = list[list.length - 1];
  const active = document.activeElement;
  if (!top.el.contains(active)) { e.preventDefault(); first.focus(); return; }
  if (e.shiftKey && (active === first || active === top.el)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
}, true);

// If focus ever lands outside the topmost dialog (a script, a click on something that slipped through), bring it back.
if (typeof document !== 'undefined') document.addEventListener('focusin', (e) => {
  const top = stack[stack.length - 1];
  if (!top || top.el.contains(e.target) || e.target.closest?.('[data-keep-live]')) return;
  focusInitial(top);
});
