// Settings rows for Play your way (PLAN-PHASE14 §14B): colour vision, patterns, text size, high contrast and Effects (Display); the voices level and
// mute-when-hidden (Audio); hold to confirm and the keyboard map (Controls). Built once and patched (THE CLICK RULE). Browser only; the integrator
// (main.js) owns the option state and hands it in through `update(options)`; every change comes back through `onChange(key, value, final)`.
import { h } from './dom.js';
import { PALETTES, PALETTE_IDS } from '../config/palettes.js';
import { TEXT_SIZE_IDS, EFFECTS_IDS } from '../config/options.js';
import { presetColors } from '../render/accessibility.js'; // the default colours as snapshotted before any preset repainted them

let seq = 0;
const nid = (p) => `opt-${p}-${++seq}`;

/** A switch named by its visible label (same look and contract as Settings' own). */
export function switchRow(label, onToggle, { note, key } = {}) {
  const labelId = nid('sw');
  const btn = h('button.settings-toggle', { role: 'switch', 'aria-checked': 'false', 'aria-labelledby': labelId, 'data-option': key || null, onClick: () => onToggle(!btn.classList.contains('is-on')) },
    h('span.settings-toggle-knob', {}));
  const row = h('div.settings-row', {}, h('span.settings-row-label', { id: labelId }, label), btn);
  if (note) row.title = note;
  row.set = (on) => { btn.classList.toggle('is-on', !!on); btn.setAttribute('aria-checked', String(!!on)); };
  row.button = btn;
  return row;
}

/** A row of radio buttons (arrow keys move the choice, as a radiogroup should). `choices`: [{ id, label, extra?: Node }]. */
function radioGroup(name, choices, onPick, cls = '') {
  const labelId = nid('rg');
  const group = h(`div.opt-radios${cls}`, { role: 'radiogroup', 'aria-labelledby': labelId });
  const buttons = choices.map((c) => {
    const b = h('button.opt-radio', { type: 'button', role: 'radio', 'aria-checked': 'false', 'data-value': c.id, tabIndex: -1, onClick: () => onPick(c.id) },
      c.extra || null, h('span.opt-radio-label', {}, c.label));
    group.appendChild(b);
    return b;
  });
  group.addEventListener('keydown', (e) => {
    const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!dir) return;
    e.preventDefault();
    const at = buttons.findIndex((b) => b.getAttribute('aria-checked') === 'true');
    const next = buttons[(at + dir + buttons.length) % buttons.length];
    onPick(next.dataset.value);
    next.focus();
  });
  const wrap = h('div.settings-row.opt-radio-row', {}, h('span.settings-row-label', { id: labelId }, name), group);
  wrap.set = (value) => {
    for (const b of buttons) {
      const on = b.dataset.value === value;
      if (b.getAttribute('aria-checked') !== String(on)) b.setAttribute('aria-checked', String(on));
      b.classList.toggle('is-selected', on);
      b.tabIndex = on ? 0 : -1;
    }
  };
  return wrap;
}

function slider(label, { min = 0, max = 100, step = 5, valueText } = {}, onValue) {
  const id = nid('sl');
  const input = h('input.settings-slider', { id, type: 'range', min, max, step, value: max, 'aria-label': label,
    onInput: (e) => onValue(Number(e.target.value), false), onChange: (e) => onValue(Number(e.target.value), true) });
  const out = h('span.opt-slider-value', { 'aria-hidden': 'true' }, '');
  const row = h('div.settings-row.settings-volume-row', {}, h('label.settings-row-label', { for: id }, label), h('span.opt-slider-wrap', {}, input, out));
  row.set = (v) => {
    if (document.activeElement !== input && input.value !== String(v)) input.value = String(v);
    const t = valueText ? valueText(Number(input.value)) : `${input.value}%`;
    if (out.textContent !== t) out.textContent = t;
    if (valueText) input.setAttribute('aria-valuetext', t);
  };
  row.input = input;
  return row;
}

const EFFECT_NAMES = { full: 'Full', reduced: 'Reduced', minimal: 'Minimal' };
const SIZE_NAMES = { normal: 'Normal', large: 'Large', larger: 'Larger' };

/**
 * @param {{ onChange: (key: string, value: any, final: boolean) => void, onKeyboard: () => void }} cb
 * @returns {{ display: HTMLElement, audio: HTMLElement[], controls: HTMLElement, update: (o: object) => void }}
 */
export function createOptionsSection({ onChange, onKeyboard }) {
  const swatches = (id) => h('span.opt-swatches', { 'aria-hidden': 'true' },
    ...Array.from({ length: 8 }, (_, i) => h('span.opt-swatch', { style: { background: presetColors(id, i).color } })));
  const palette = radioGroup('Colour vision', PALETTE_IDS.map((id) => ({ id, label: PALETTES[id].id === 'default' ? 'Default' : PALETTES[id].name, extra: swatches(id) })),
    (v) => onChange('palette', v, true), '.opt-palettes');
  palette.classList.add('opt-palette-row');
  const patterns = switchRow('Territory patterns', (v) => onChange('patterns', v, true), { key: 'patterns', note: 'Stripes, dots or cross-hatch over each faction’s land, so colour is never the only cue' });
  const textSize = radioGroup('Text size', TEXT_SIZE_IDS.map((id) => ({ id, label: SIZE_NAMES[id] })), (v) => onChange('textSize', v, true), '.opt-sizes');
  const contrast = switchRow('High contrast', (v) => onChange('highContrast', v, true), { key: 'highContrast', note: 'Opaque panels, stronger borders, brighter text' });
  const effects = slider('Effects', { min: 0, max: 2, step: 1, valueText: (v) => EFFECT_NAMES[EFFECTS_IDS[v]] }, (v, final) => onChange('effects', EFFECTS_IDS[v] || 'full', final));
  effects.classList.add('opt-effects-row');
  effects.title = 'Particles, wisps, screen shake and pops. Reduce motion still applies on top.';

  const voices = slider('Voices volume', {}, (v, final) => onChange('voicesVolume', v / 100, final));
  voices.classList.add('opt-voices-row');
  const muteHidden = switchRow('Mute when the tab is hidden', (v) => onChange('muteHidden', v, true), { key: 'muteHidden' });

  const hold = switchRow('Hold to confirm', (v) => onChange('holdToConfirm', v, true), { key: 'holdToConfirm', note: 'Retreat, Reset, a New Realm over your save and Demolish need a press held for a moment' });
  const keysBtn = h('button.btn.btn-secondary.opt-keyboard', { type: 'button', onClick: () => onKeyboard() }, 'Keyboard controls');

  const display = h('section.settings-section.opt-display', { 'aria-labelledby': 'opt-display-title' },
    h('h3.settings-subtitle', { id: 'opt-display-title' }, 'Display'), palette, patterns, textSize, contrast, effects);
  const controls = h('section.settings-section.opt-controls', { 'aria-labelledby': 'opt-controls-title' },
    h('h3.settings-subtitle', { id: 'opt-controls-title' }, 'Controls'), hold, h('div.settings-row.settings-help-row', {}, keysBtn));

  function update(o) {
    if (!o) return;
    palette.set(o.palette);
    patterns.set(o.patterns);
    textSize.set(o.textSize);
    contrast.set(o.highContrast);
    effects.set(Math.max(0, EFFECTS_IDS.indexOf(o.effects)));
    voices.set(Math.round((o.voicesVolume ?? 0.7) * 100));
    muteHidden.set(o.muteHidden);
    hold.set(o.holdToConfirm);
  }
  return { display, audio: [voices, muteHidden], controls, update };
}
