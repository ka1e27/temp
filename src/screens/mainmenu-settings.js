// The settings drawer.
//
// Split out of ./mainmenu.js for the line budget, in the same shape as its
// export/import drawers — this file owns the CONTENT of one drawer and nothing
// about the menu around it.
//
// These are PREFERENCES, and the reason they exist at all is that both of them
// were previously a chore repeated every single battle:
//
//   - every site starts holding 8 troops back from a rally, so a player who
//     wants their rear country to forward everything had to open each site and
//     walk the number to zero, in every region, forever;
//   - every battle starts at 1x, so a player who reads a three-front endgame map
//     better at half speed had to say so again each time.
//
// Both write to `meta.settings` (core/store.js `createSettings`), which is
// persisted inside the already-saved `meta` key and healed from defaults on
// load — so neither needed a save migration.
import { h, clear, mount, bindText } from '../ui/dom.js';
import { RALLY_KEEP } from '../content/balance.js';
import { markDirty } from '../core/store.js';
import { SPEEDS, speedIndexOf } from './battle-keys.js';

/** A labelled slider row: label, live readout, and the input itself. */
function sliderRow({ id, label, hint, min, max, step, value, format, onInput }) {
  const readout = h('span.set-value.num', { text: format(value) });
  const setText = bindText(readout, format(value));
  const input = h('input.set-slider', {
    type: 'range',
    id,
    min: `${min}`,
    max: `${max}`,
    step: `${step}`,
    value: `${value}`,
    on: {
      input: (e) => {
        const raw = e?.currentTarget ?? input;
        const n = Number.isFinite(raw.valueAsNumber) ? raw.valueAsNumber : Number(raw.value);
        setText(format(n));
        onInput(n);
      },
    },
  });
  return h('div.set-row', {},
    h('div.set-head', {},
      h('label.label', { for: id, text: label }),
      readout),
    input,
    h('p.set-hint.dim', { text: hint }));
}

/**
 * Render the settings drawer into `drawer`.
 *
 * @param {HTMLElement} drawer
 * @param {object} ctx  the scene context (needs `state`)
 * @returns {HTMLElement} the drawer's first focusable control, for focus handoff
 */
export function renderSettings(drawer, ctx) {
  clear(drawer);
  const settings = ctx.state.meta.settings;

  const keep = sliderRow({
    id: 'set-rally-keep',
    label: 'Troops left behind when rallying',
    hint: 'Applied to every site at the start of a battle. 0 forwards everything;'
      + ' you can still change any single site while you play.',
    min: RALLY_KEEP.min,
    max: RALLY_KEEP.max,
    step: RALLY_KEEP.step,
    value: settings.rallyKeepDefault ?? RALLY_KEEP.default,
    format: (n) => (n <= 0 ? 'none' : `${n}`),
    onInput: (n) => {
      settings.rallyKeepDefault = Math.max(0, Math.round(n));
      markDirty(ctx.state);
    },
  });

  const speed = sliderRow({
    id: 'set-speed',
    label: 'Battle speed',
    hint: 'Where a battle opens. Slower is always available; past 2x needs the'
      + ' Tactician upgrade, and a locked speed is simply skipped.',
    min: 0,
    max: SPEEDS.length - 1,
    step: 1,
    value: speedIndexOf(settings.defaultSpeed ?? 1),
    format: (i) => `${SPEEDS[Math.round(i)] ?? 1}×`,
    onInput: (i) => {
      settings.defaultSpeed = SPEEDS[Math.round(i)] ?? 1;
      markDirty(ctx.state);
    },
  });

  mount(drawer, h('div.menu-drawer.menu-settings', {},
    h('h3.menu-drawer-title', { text: 'Settings' }),
    keep,
    speed,
    h('p.set-note.dim', {
      text: 'Preferences are kept across campaigns — starting a new one does not reset them.',
    })));

  return drawer.querySelector('input');
}
