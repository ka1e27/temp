// Stacked auto-dismiss toasts (ARCHITECTURE §8). Browser only. Every call to
// `update()` pushes ONE new toast — there is no persistent "current state"
// to diff against, so this component intentionally does not follow the
// diff-on-update pattern the way the others do. One exception: a toast that
// carries an `id` a toast on screen already has UPDATES that toast in place and
// restarts its timer, so a run of the same kind of event (a spree in the War
// Council) is one toast, not a pile.
import { h } from './dom.js';
import { icon } from './icons.js';

const DEFAULT_ICON = { info: 'bell', success: 'star', warning: 'flame' };
const DEFAULT_DURATION_MS = 4200;

/**
 * @typedef {Object} ToastData
 * @property {string} [id]
 * @property {'info'|'success'|'warning'} [type]
 * @property {string} message
 * @property {string} [icon]
 * @property {number} [duration]  ms before auto-dismiss
 */

export function createToasts() {
  const el = h('div.toasts', {});
  let seq = 0;

  /** @param {ToastData} toast */
  function update(toast) {
    if (!toast || !toast.message) return;
    if (toast.id != null) {
      const live = [...el.children].find((n) => n.dataset.id === String(toast.id) && n.isConnected && !n.classList.contains('is-out'));
      if (live) {
        live.querySelector('.toast-message').textContent = toast.message;
        clearTimeout(live._toastTimer);
        live._toastTimer = setTimeout(() => dismiss(live), toast.duration ?? DEFAULT_DURATION_MS);
        return;
      }
    }
    const type = toast.type || 'info';
    const node = h(`div.toast.toast-${type}`, {},
      icon(toast.icon || DEFAULT_ICON[type] || 'bell', 18),
      h('span.toast-message', {}, toast.message),
      h('button.toast-close', { onClick: () => dismiss(node), 'aria-label': 'Dismiss' }, icon('close', 12)),
    );
    node.dataset.id = toast.id ?? `t${++seq}`;
    el.appendChild(node);
    requestAnimationFrame(() => node.classList.add('is-in'));

    node._toastTimer = setTimeout(() => dismiss(node), toast.duration ?? DEFAULT_DURATION_MS);
  }

  function dismiss(node) {
    if (!node.isConnected) return;
    clearTimeout(node._toastTimer);
    node.classList.remove('is-in');
    node.classList.add('is-out');
    setTimeout(() => node.remove(), 260);
  }

  function destroy() {
    for (const node of [...el.children]) clearTimeout(node._toastTimer);
    el.replaceChildren();
  }

  return { el, update, destroy };
}
