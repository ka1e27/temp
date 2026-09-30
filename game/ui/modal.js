// Generic modal dialog primitive (ARCHITECTURE §8). Used directly for
// confirmations (retreat, reset save) and as a building block by other
// game/ui components. Browser only; no game-logic imports.
import { h, clear } from './dom.js';
import { icon } from './icons.js';

/**
 * @typedef {Object} ModalAction
 * @property {string} label
 * @property {'primary'|'secondary'|'danger'} [variant]
 * @property {() => void} [onClick]
 */

/**
 * @typedef {Object} ModalData
 * @property {string} [title]
 * @property {Node|string} [body]
 * @property {ModalAction[]} [actions]
 * @property {boolean} [dismissible]   default true; false hides the close button and disables Escape/backdrop-click
 */

/**
 * @param {ModalData} [initial]
 * @param {{ onDismiss?: () => void }} [callbacks]  onDismiss fires on Escape,
 *   backdrop click or the close button — it does not remove the modal
 *   itself; call `destroy()` in response (or ignore it to force a choice).
 */
export function createModal(initial = {}, { onDismiss } = {}) {
  let dismissible = initial.dismissible !== false;

  const titleEl = h('h2.modal-title', {}, '');
  const bodyEl = h('div.modal-body', {});
  const actionsEl = h('div.modal-actions', {});
  const closeBtn = h('button.btn-icon.modal-close', { onClick: () => dismiss(), 'aria-label': 'Close' }, icon('close', 16));

  const backdrop = h('div.modal-backdrop', {
    onClick: (e) => { if (e.target === backdrop) dismiss(); },
  },
    h('div.modal-panel.glass-panel', { role: 'dialog', 'aria-modal': 'true' },
      h('div.modal-header', {}, titleEl, closeBtn),
      bodyEl,
      actionsEl,
    ),
  );

  function dismiss() {
    if (dismissible) onDismiss?.();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') dismiss();
  }
  window.addEventListener('keydown', onKeydown);

  function update(data = {}) {
    if (data.title != null) titleEl.textContent = data.title;
    if (data.body != null) {
      clear(bodyEl);
      bodyEl.appendChild(data.body instanceof Node ? data.body : document.createTextNode(String(data.body)));
    }
    if (data.actions) {
      clear(actionsEl);
      for (const action of data.actions) {
        actionsEl.appendChild(h(`button.btn.btn-${action.variant || 'secondary'}`, {
          onClick: action.onClick,
        }, action.label));
      }
    }
    if (data.dismissible != null) {
      dismissible = data.dismissible;
      closeBtn.hidden = !dismissible;
    }
  }

  update(initial);

  function destroy() {
    window.removeEventListener('keydown', onKeydown);
    backdrop.remove();
  }

  return { el: backdrop, update, destroy };
}
