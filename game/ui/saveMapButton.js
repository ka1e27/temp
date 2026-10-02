// The "Save the map" button (DESIGN §5.9): one full-width secondary button that turns the finished realm into a Tapestry PNG.
// Used twice, so it is one component: at the foot of the Chronicle in the Realm panel, and in the Found a Dynasty
// confirmation (the last chance to keep a picture of the old continent). Browser only; no game-logic imports: the words
// arrive from the scene (`saveText(...)` in game/meta/keepsake.js, from config), the work is done by the callback.
//
//   const save = createSaveMapButton({ onSave: () => worldScene.onSaveMap() });
//   realmBody.append(save.el);
//   save.update({ label: saveText('button'), busyLabel: saveText('busy'), busy: false });
//
// Built once and patched in place: a refresh between pointerdown and pointerup never recreates the button, so a tap is never
// swallowed. While `busy` the button is disabled (aria-busy) and shows `busyLabel`; a second press cannot start a second render.
import { h } from './dom.js';
import { icon } from './icons.js';

const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };

/**
 * @param {{ onSave?: () => void, variant?: 'primary'|'secondary' }} [callbacks]
 */
export function createSaveMapButton({ onSave, variant = 'secondary' } = {}) {
  let busy = false;
  const labelEl = h('span.keepsake-save-label', {}, 'Save the map');
  const el = h(`button.btn.btn-${variant}.btn-block.keepsake-save`, {
    type: 'button',
    onClick: () => { if (!busy) onSave?.(); },
  }, icon('map', 16), labelEl);

  // The result of a save is said beside the button that was pressed (it lives in a dialog: a toast would sit over it). The caller mounts `statusEl` after `el`.
  const statusEl = h('p.keepsake-save-status', { role: 'status', 'aria-live': 'polite' }, '');
  let statusTimer = 0;
  function setStatus(message, kind = 'success') {
    clearTimeout(statusTimer);
    statusEl.textContent = message || '';
    statusEl.dataset.kind = kind;
    statusEl.hidden = !message;
    if (message) statusTimer = setTimeout(() => { statusEl.textContent = ''; statusEl.hidden = true; }, 6000);
  }
  statusEl.hidden = true;

  /** @param {{ label?: string, busyLabel?: string, busy?: boolean }} data */
  function update(data) {
    if (!data) return;
    if (data.busy != null) busy = !!data.busy;
    const text = busy ? (data.busyLabel ?? labelEl.textContent) : (data.label ?? labelEl.textContent);
    setText(labelEl, text);
    if (el.disabled !== busy) el.disabled = busy;
    const aria = busy ? 'true' : 'false';
    if (el.getAttribute('aria-busy') !== aria) el.setAttribute('aria-busy', aria);
  }

  function destroy() {
    el.replaceChildren();
  }

  return { el, statusEl, setStatus, update, destroy, get busy() { return busy; } };
}
