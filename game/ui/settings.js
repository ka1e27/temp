// Settings panel (DESIGN §8). Browser only; no game-logic imports — save
// export/import strings are produced by whatever the integrator wires
// onExport/onImport to (game/meta/save.js), never computed here.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { createModal } from './modal.js';

function toggleRow({ label, iconOn, iconOff, checked, onToggle }) {
  const btn = h('button.settings-toggle', {
    role: 'switch', 'aria-checked': String(!!checked),
    onClick: () => onToggle?.(!btn.classList.contains('is-on')),
  }, h('span.settings-toggle-knob', {}));
  btn.classList.toggle('is-on', !!checked);

  const row = h('div.settings-row', {},
    h('span.settings-row-label', {}, iconOn ? icon(checked ? iconOn : (iconOff || iconOn), 18) : null, label),
    btn,
  );
  row.setToggle = (on) => {
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-checked', String(on));
    if (iconOn) {
      const iconSlot = row.querySelector('.icon');
      iconSlot?.replaceWith(icon(on ? iconOn : (iconOff || iconOn), 18));
    }
  };
  return row;
}

/**
 * @param {{ onToggleSound?: (v: boolean) => void, onToggleReduceMotion?: (v: boolean) => void,
 *   onToggleHints?: (v: boolean) => void, onToggleLeaderVoices?: (v: boolean) => void,
 *   onToggleMusic?: (v: boolean) => void, onMusicVolume?: (v: number, final: boolean) => void, onExport?: () => string, onImport?: (code: string) => boolean,
 *   onReset?: () => void, onClose?: () => void }} [callbacks]
 */
export function createSettings({
  onToggleSound, onToggleReduceMotion, onToggleHints, onToggleLeaderVoices, onToggleMusic, onMusicVolume,
  onExport, onImport, onReset, onClose,
} = {}) {
  const soundRow = toggleRow({
    label: 'Sound', iconOn: 'sound-on', iconOff: 'sound-off', checked: true,
    onToggle: (v) => { soundRow.setToggle(v); onToggleSound?.(v); },
  });
  const volumeInput = h('input.settings-slider', {
    type: 'range', min: 0, max: 100, step: 5, value: 40, 'aria-label': 'Music volume',
    // Live while dragging, saved once on release.
    onInput: (e) => onMusicVolume?.(Number(e.target.value) / 100, false),
    onChange: (e) => onMusicVolume?.(Number(e.target.value) / 100, true),
  });
  const musicRow = toggleRow({
    label: 'Music', checked: true,
    onToggle: (v) => { musicRow.setToggle(v); volumeRow.classList.toggle('is-off', !v); onToggleMusic?.(v); },
  });
  const volumeRow = h('div.settings-row.settings-volume-row', {},
    h('span.settings-row-label', {}, 'Music volume'), volumeInput);
  const motionRow = toggleRow({
    label: 'Reduce motion', checked: false,
    onToggle: (v) => { motionRow.setToggle(v); onToggleReduceMotion?.(v); },
  });
  const hintsRow = toggleRow({
    label: 'Hints', checked: true,
    onToggle: (v) => { hintsRow.setToggle(v); onToggleHints?.(v); },
  });

  const voicesRow = toggleRow({
    label: 'Leader voices', checked: true,
    onToggle: (v) => { voicesRow.setToggle(v); onToggleLeaderVoices?.(v); },
  });

  const exportArea = h('textarea.settings-code', {
    readOnly: true, rows: 3, placeholder: 'Tap "Export" to generate a save code…',
    onClick: (e) => e.target.select(),
  });
  const importArea = h('textarea.settings-code', { rows: 3, placeholder: 'Paste a save code here…' });
  const importMsg = h('span.settings-import-msg', {}, '');

  const resetBtn = h('button.btn.btn-danger.btn-block', { onClick: () => confirmReset() }, icon('flame', 16), 'Reset Save');

  const el = h('div.settings.glass-panel', {},
    h('div.settings-header', {},
      h('h2.settings-title', {}, 'Settings'),
      h('button.btn-icon.settings-close', { onClick: () => onClose?.(), 'aria-label': 'Close' }, icon('close', 16)),
    ),
    h('div.settings-body.scroll-y', {},
      h('section.settings-section', {}, soundRow, musicRow, volumeRow, motionRow, hintsRow, voicesRow),
      h('section.settings-section', {},
        h('h3.settings-subtitle', {}, 'Save code'),
        exportArea,
        h('button.btn.btn-secondary.btn-block', {
          onClick: () => { exportArea.value = onExport?.() || ''; exportArea.select(); },
        }, 'Export'),
        importArea,
        h('div.settings-import-row', {},
          h('button.btn.btn-secondary.btn-block', {
            onClick: () => {
              const ok = onImport?.(importArea.value.trim());
              importMsg.textContent = ok ? 'Imported!' : 'That code didn’t work.';
              importMsg.classList.toggle('is-error', !ok);
            },
          }, 'Import'),
          importMsg,
        ),
      ),
      h('section.settings-section', {}, resetBtn),
    ),
  );

  function confirmReset() {
    const modal = createModal({
      title: 'Reset save?',
      body: 'This permanently deletes your realm — gold, upgrades, regions, everything. There is no undo.',
      actions: [
        { label: 'Cancel', variant: 'secondary', onClick: () => modal.destroy() },
        { label: 'Delete forever', variant: 'danger', onClick: () => { modal.destroy(); onReset?.(); } },
      ],
    }, { onDismiss: () => modal.destroy() });
    document.body.appendChild(modal.el);
  }

  /** @param {{ sound?: boolean, reduceMotion?: boolean, hints?: boolean, leaderVoices?: boolean, music?: boolean, musicVolume?: number }} data */
  function update(data) {
    if (!data) return;
    if (data.sound != null) soundRow.setToggle(data.sound);
    if (data.reduceMotion != null) motionRow.setToggle(data.reduceMotion);
    if (data.hints != null) hintsRow.setToggle(data.hints);
    if (data.leaderVoices != null) voicesRow.setToggle(data.leaderVoices);
    if (data.music != null) { musicRow.setToggle(data.music); volumeRow.classList.toggle('is-off', !data.music); }
    if (data.musicVolume != null) volumeInput.value = String(Math.round(data.musicVolume * 100));
  }

  function destroy() {
    clear(el);
  }

  return { el, update, destroy };
}
