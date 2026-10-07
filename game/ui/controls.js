// The controls card: one screen listing EVERY control, in two columns (mouse and keyboard, touch). Shown by the `?` button in a battle and by
// "Controls" in Settings. Browser only; no game-logic imports.
import { h } from './dom.js';
import { createModal } from './modal.js';
import { labelOf } from './keymap.js';

/** [key or gesture, what it does] rows, in the order a player meets them. Exported so a test can check that nothing is missing. */
export const CONTROLS = Object.freeze({
  mouse: Object.freeze([
    ['Drag', 'the map to move it'],
    ['Scroll', 'to zoom'],
    ['Click', 'a glowing region to see what it offers'],
    ['Drag', 'from one of your settlements to any settlement to send troops'],
    ['1 2 3 4', 'send 25 / 50 / 75 / 100% of a garrison (or use the bar)'],
    ['Click', 'your settlements to select several, then click a target'],
    ['Shift-drag', 'to lasso your settlements'],
    ['A', 'select all your settlements'],
    ['Ctrl-drag', 'a supply line (Alt-drag works too): a settlement keeps sending troops to a target on its own'],
    ['Ctrl-drag again', 'onto the same target (or right-click the source) to end it'],
    ['Auto (S)', 'switch on Auto, then plain drags and clicks make supply lines'],
    ['The arrow', 'green, solid, with a check and "Capture": you will take it. Red, dashed, with a cross: not enough troops. Grey dotted: no route, so take a closer settlement first'],
    ['Q W E R T', 'Rally, Firestorm, Bulwark, Forced March, Levy (then click the target)'],
    ['Space', 'pause; the speed button runs the battle 1x, 2x or 3x'],
    ['Right-click / Esc', 'clear your selection or cancel a power'],
    ['Tab', 'to the map, then arrow keys move a ring between regions or settlements; Enter opens a region (or selects a settlement of yours, or sends to another from your selection or the War Camp)'],
    ['[ and ]', 'on the map: the regions you can attack, one by one; + and - zoom; Shift with the arrows moves the map'],
    ['Regions button', 'a list of every region you can see, frontier first, for the keyboard and screen readers'],
    ['M', 'mute or unmute the sound'],
  ]),
  touch: Object.freeze([
    ['Drag', 'the map to move it'],
    ['Pinch', 'to zoom (two fingers also move the map)'],
    ['Tap', 'a glowing region to see what it offers'],
    ['Drag', 'from one of your settlements to any settlement to send troops'],
    ['Size bar', 'tap 25 / 50 / 75 / 100% to choose how much to send'],
    ['Tap', 'your settlements to select several, then tap a target'],
    ['Long-press, then drag', 'a supply line: a settlement keeps sending troops on its own'],
    ['Long-press', 'a source that has a line, then let go (or repeat the drag) to end it'],
    ['Auto', 'switch on Auto, then plain drags and taps make supply lines'],
    ['The arrow', 'green, solid, with a check: you will take it. Red, dashed, with a cross: not enough troops. Grey dotted: no route, so take a closer settlement first'],
    ['Powers', 'tap a power, then tap the target (Firestorm: tap twice to fire)'],
    ['Pause and speed', 'the buttons at the top right'],
    ['Tap', 'an empty spot to clear your selection'],
  ]),
});

/** The keyboard rows name the player's own keys (Settings > Keyboard controls, ui/keymap.js), not the defaults. */
function liveKey(k) {
  const join = (ids) => ids.map(labelOf).join(' ');
  switch (k) {
    case '1 2 3 4': return join(['send25', 'send50', 'send75', 'send100']);
    case 'Q W E R T': return join(['power1', 'power2', 'power3', 'power4', 'power5']);
    case 'A': return labelOf('selectAll');
    case 'Auto (S)': return `Auto (${labelOf('auto')})`;
    case 'Space': return labelOf('pause');
    case 'M': return labelOf('mute');
    default: return k;
  }
}

export function showControls() {
  const col = (title, rows, live) => h('div.hd-controls-col', {}, h('h3', {}, title), ...rows.map(([k, v]) => h('p', {}, h('b', {}, live ? liveKey(k) : k), ` ${v}`)));
  const body = h('div.hd-controls', {}, col('Mouse and keyboard', CONTROLS.mouse, true), col('Touch', CONTROLS.touch));
  const modal = createModal({
    title: 'Controls',
    body,
    actions: [{ label: 'Got it', variant: 'primary', onClick: () => modal.destroy() }],
  }, { onDismiss: () => modal.destroy() });
  document.body.appendChild(modal.el);
  return modal;
}
