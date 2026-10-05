// Settings panel (DESIGN §8). Browser only; no game-logic imports — save
// export/import strings are produced by whatever the integrator wires
// onExport/onImport to (game/meta/save.js), never computed here.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { createModal } from './modal.js';
import { showControls } from './controls.js';
import { watchDialog } from './dialogs.js';

let toggleSeq = 0;

// A switch is named by the visible label next to it (aria-labelledby), and says on / off through aria-checked.
function toggleRow({ label, iconOn, iconOff, checked, onToggle }) {
  const labelId = `settings-switch-${++toggleSeq}`;
  const btn = h('button.settings-toggle', {
    role: 'switch', 'aria-checked': String(!!checked), 'aria-labelledby': labelId,
    onClick: () => onToggle?.(!btn.classList.contains('is-on')),
  }, h('span.settings-toggle-knob', {}));
  btn.classList.toggle('is-on', !!checked);

  const row = h('div.settings-row', {},
    h('span.settings-row-label', { id: labelId }, iconOn ? icon(checked ? iconOn : (iconOff || iconOn), 18) : null, label),
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
 *   onToggleHints?: (v: boolean) => void, onToggleSlowBattles?: (v: boolean) => void, onToggleLeaderVoices?: (v: boolean) => void,
 *   onToggleMusic?: (v: boolean) => void, onMusicVolume?: (v: number, final: boolean) => void, onSfxVolume?: (v: number, final: boolean) => void, onReplayTutorial?: () => void, onExport?: () => string, onImport?: (code: string) => boolean,
 *   onReset?: () => void, onClose?: () => void, onCodex?: () => void }} [callbacks]  onCodex: Settings > Codex (Phase 8)
 */
export function createSettings({
  onToggleSound, onToggleReduceMotion, onToggleHints, onToggleSlowBattles, onToggleLeaderVoices, onToggleMusic, onMusicVolume, onSfxVolume,
  onReplayTutorial, onExport, onImport, onReset, onClose, onCodex, onChallenges, onBanner,
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
  // the sound effects have their own level (the score has Music volume); letting go of the slider plays a sample, so it can be heard
  const sfxInput = h('input.settings-slider', {
    type: 'range', min: 0, max: 100, step: 5, value: 100, 'aria-label': 'Effects volume',
    onInput: (e) => onSfxVolume?.(Number(e.target.value) / 100, false),
    onChange: (e) => onSfxVolume?.(Number(e.target.value) / 100, true),
  });
  const sfxRow = h('div.settings-row.settings-volume-row.settings-sfx-row', {},
    h('span.settings-row-label', {}, 'Effects volume'), sfxInput);
  const motionRow = toggleRow({
    label: 'Reduce motion', checked: false,
    onToggle: (v) => { motionRow.setToggle(v); onToggleReduceMotion?.(v); },
  });
  const hintsRow = toggleRow({
    label: 'Hints', checked: true,
    onToggle: (v) => { hintsRow.setToggle(v); onToggleHints?.(v); },
  });

  const slowRow = toggleRow({
    label: 'Slow battles', checked: false,
    onToggle: (v) => { slowRow.setToggle(v); onToggleSlowBattles?.(v); },
  });
  slowRow.title = 'Adds a half-speed setting to the battle speed button';

  // Replay the tutorial (every hint unseen again) and read every control
  const helpRow = h('div.settings-row.settings-help-row', {},
    h('button.btn.btn-secondary.settings-replay', { onClick: () => onReplayTutorial?.() }, icon('star', 16), 'Replay tutorial'),
    h('button.btn.btn-secondary.settings-controls', { onClick: () => showControls() }, icon('scroll', 16), 'Controls'),
    onCodex ? h('button.btn.btn-secondary.settings-codex', { onClick: () => onCodex() }, icon('map', 16), 'Codex') : null);

  const voicesRow = toggleRow({
    label: 'Leader voices', checked: true,
    onToggle: (v) => { voicesRow.setToggle(v); onToggleLeaderVoices?.(v); },
  });

  const exportArea = h('textarea.settings-code', {
    readOnly: true, rows: 3, placeholder: 'Tap "Export" to generate a save code…', 'aria-label': 'Exported save code',
    onClick: (e) => e.target.select(),
  });
  const importArea = h('textarea.settings-code', { rows: 3, placeholder: 'Paste a save code here…', 'aria-label': 'Save code to import' });
  // the result of an import is announced (polite live region)
  const importMsg = h('span.settings-import-msg', { role: 'status', 'aria-live': 'polite' }, '');

  // Copy: the code is long and a phone cannot select all of it by hand; "Copied" confirms it (said aloud as well, polite status)
  const copyMsg = h('span.settings-import-msg', { role: 'status', 'aria-live': 'polite' }, '');
  let copyTimer = 0;
  async function copyCode() {
    const text = exportArea.value || onExport?.() || '';
    exportArea.value = text;
    let done = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); done = true; }
    } catch { /* not allowed here: fall back to selecting it */ }
    if (!done) {
      exportArea.select();
      try { done = document.execCommand('copy'); } catch { done = false; }
    }
    copyMsg.textContent = done ? 'Copied' : 'Select the code and copy it';
    copyMsg.classList.toggle('is-error', !done);
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { copyMsg.textContent = ''; }, 2500);
  }

  const resetBtn = h('button.btn.btn-danger.btn-block', { onClick: () => confirmReset() }, icon('flame', 16), 'Reset Save');

  // Phase 9: the Challenges (the Daily and the Scenarios) and the realm's banner style (§9C, purely visual). Both arrive as data once the
  // challenge kit has loaded; a locked style shows how it is earned.
  const challengesBtn = h('button.btn.btn-secondary.settings-challenges', { onClick: () => onChallenges?.() }, icon('trophy', 16), 'Challenges');
  challengesBtn.hidden = true;
  const bannerGroup = h('div.settings-banners', { role: 'radiogroup', 'aria-label': 'Banner style' });
  const bannerSection = h('section.settings-section.settings-banner-section', {},
    h('h3.settings-subtitle', {}, 'Banner style'),
    h('p.settings-note', {}, 'How your flags look on the map. Purely for show.'),
    bannerGroup);
  bannerSection.hidden = true;
  let bannerSig = '';
  function renderBanners(list) {
    const sig = JSON.stringify(list);
    if (sig === bannerSig) return;
    bannerSig = sig;
    clear(bannerGroup);
    for (const b of list) {
      const opt = h('button.settings-banner', {
        type: 'button', role: 'radio', 'aria-checked': String(!!b.selected), 'aria-disabled': String(!b.unlocked),
        'data-banner': b.id, title: b.unlocked ? b.name : `${b.name}: ${b.text}`,
        onClick: () => { if (b.unlocked && !b.selected) onBanner?.(b.id); },
      },
      h('span.settings-banner-swatch', { 'aria-hidden': 'true' }, h('span.settings-banner-cloth')),
      h('span.settings-banner-name', {}, b.name),
      h('span.settings-banner-rule', {}, b.unlocked ? (b.selected ? 'In use' : 'Unlocked') : b.text),
      b.unlocked ? null : icon('lock', 14));
      opt.classList.toggle('is-locked', !b.unlocked);
      opt.classList.toggle('is-selected', !!b.selected);
      bannerGroup.appendChild(opt);
    }
  }
  const saveSection = h('section.settings-section.settings-save-section', {});
  const resetSection = h('section.settings-section.settings-reset-section', {}, resetBtn);
  const challengeNote = h('p.settings-note.settings-challenge-note', {}, 'You are playing a challenge. Your realm and its save wait untouched; the save code is back when you return.');
  challengeNote.hidden = true;

  const el = h('div.settings.glass-panel', {},
    h('div.settings-header', {},
      h('h2.settings-title', {}, 'Settings'),
      h('button.btn-icon.settings-close', { onClick: () => onClose?.(), 'aria-label': 'Close' }, icon('close', 16)),
    ),
    h('div.settings-body.scroll-y', {},
      h('section.settings-section', {}, soundRow, musicRow, volumeRow, sfxRow, motionRow, slowRow, hintsRow, helpRow, voicesRow, challengesBtn),
      bannerSection,
      challengeNote,
      saveSection,
      resetSection,
    ),
  );
  saveSection.append(
        h('h3.settings-subtitle', {}, 'Save code'),
        exportArea,
        h('div.settings-import-row', {},
          h('button.btn.btn-secondary.btn-block', {
            onClick: () => { exportArea.value = onExport?.() || ''; exportArea.select(); },
          }, 'Export'),
          h('button.btn.btn-secondary.btn-block.settings-copy', { onClick: () => copyCode() }, icon('scroll', 16), 'Copy'),
          copyMsg,
        ),
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
  );

  // a dialog while it is visible: focus moves in, Tab is trapped, Escape closes, focus returns to the Settings button (ui/dialogs.js)
  watchDialog(el, { onEscape: () => onClose?.() });

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
    if (data.slowBattles != null) slowRow.setToggle(data.slowBattles);
    if (data.leaderVoices != null) voicesRow.setToggle(data.leaderVoices);
    if (data.music != null) { musicRow.setToggle(data.music); volumeRow.classList.toggle('is-off', !data.music); }
    if (data.musicVolume != null) volumeInput.value = String(Math.round(data.musicVolume * 100));
    if (data.sfxVolume != null) sfxInput.value = String(Math.round(data.sfxVolume * 100));
    if (data.challengesUnlocked != null) challengesBtn.hidden = !data.challengesUnlocked;
    if (Array.isArray(data.banners)) { renderBanners(data.banners); bannerSection.hidden = false; }
    if (data.inChallenge != null) {
      saveSection.hidden = !!data.inChallenge;
      resetSection.hidden = !!data.inChallenge;
      challengeNote.hidden = !data.inChallenge;
    }
  }

  function destroy() {
    clear(el);
  }

  return { el, update, destroy };
}
