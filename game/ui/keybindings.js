// The keyboard map dialog (PLAN-PHASE14 §14B.5): every rebindable action with its key. Press a key button, then the new key; Escape cancels.
// A key another action holds is SWAPPED (that action takes the old key) and the status line says so; a reserved key (Escape, Tab, Enter, the
// arrows, brackets, plus, minus) is refused in words. "Reset to defaults" puts every key back. Browser only: the integrator saves the map.
import { h } from './dom.js';
import { createModal } from './modal.js';
import { KEY_ACTIONS, keyLabel, actionLabel, rebind, defaultBindings, findConflicts } from './keymap.js';

/**
 * @param {{ bindings: Object<string,string>, onChange: (bindings: Object<string,string>) => void }} opts
 * @returns {{ modal: object, el: HTMLElement }}
 */
export function showKeybindings({ bindings, onChange }) {
  let map = { ...bindings };
  let capturing = null; // action id waiting for its key
  const status = h('p.keybind-status', { role: 'status', 'aria-live': 'polite' }, '');
  const rows = new Map();
  const list = h('div.keybind-list', { role: 'list' });
  for (const a of KEY_ACTIONS) {
    const keyBtn = h('button.btn.btn-secondary.keybind-key', { type: 'button', 'data-action': a.id, onClick: () => startCapture(a.id) }, '');
    const row = h('div.keybind-row', { role: 'listitem' }, h('span.keybind-label', {}, a.label), keyBtn);
    rows.set(a.id, { row, keyBtn });
    list.appendChild(row);
  }
  function render() {
    const conflicts = new Set(findConflicts(map).flatMap((c) => c.actions));
    for (const [id, { keyBtn, row }] of rows) {
      const waiting = capturing === id;
      const text = waiting ? 'Press a key…' : keyLabel(map[id]);
      if (keyBtn.textContent !== text) keyBtn.textContent = text;
      keyBtn.setAttribute('aria-label', waiting ? `${actionLabel(id)}: press the new key, or Escape to cancel` : `${actionLabel(id)}: ${keyLabel(map[id])}. Press to change`);
      keyBtn.classList.toggle('is-waiting', waiting);
      row.classList.toggle('is-conflict', conflicts.has(id));
    }
  }
  function say(text, warn = false) {
    status.textContent = text;
    status.classList.toggle('is-warn', warn);
  }
  function startCapture(id) {
    capturing = id;
    render();
    say(`Press the new key for ${actionLabel(id)}. Escape cancels.`);
  }
  // capture phase on window: runs before the dialogs' own Escape (document) and before every game shortcut
  function onKey(e) {
    if (!capturing) return;
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return; // wait for the real key
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const id = capturing;
    if (e.code === 'Escape') { capturing = null; render(); say('Unchanged.'); rows.get(id).keyBtn.focus(); return; }
    const res = rebind(map, id, e.code);
    if (res.error) { say(`${keyLabel(e.code) || e.code} is reserved for the game (Escape, Tab, Enter, the arrows, brackets, plus and minus). Pick another key.`, true); return; }
    const old = map[id];
    map = res.bindings;
    capturing = null;
    render();
    say(res.swapped
      ? `${actionLabel(id)} is now ${keyLabel(map[id])}. ${keyLabel(map[id])} was ${actionLabel(res.swapped)}, which moved to ${keyLabel(old)}.`
      : `${actionLabel(id)} is now ${keyLabel(map[id])}.`, !!res.swapped);
    onChange({ ...map });
    rows.get(id).keyBtn.focus();
  }
  window.addEventListener('keydown', onKey, true);
  const reset = h('button.btn.btn-secondary.keybind-reset', { type: 'button', onClick: () => { map = defaultBindings(); capturing = null; render(); say('Every key is back to its default.'); onChange({ ...map }); } }, 'Reset to defaults');
  const body = h('div.keybind', {}, h('p.settings-note', {}, 'Keys are physical places on the keyboard. Choosing a key another action uses swaps the two.'), list, h('div.keybind-foot', {}, reset, status));
  const close = () => { window.removeEventListener('keydown', onKey, true); modal.destroy(); };
  const modal = createModal({ title: 'Keyboard controls', body, actions: [{ label: 'Done', variant: 'primary', onClick: close }] }, { onDismiss: () => { if (!capturing) close(); } });
  modal.el.classList.add('keybind-modal');
  render();
  document.body.appendChild(modal.el);
  return { modal, el: modal.el };
}
