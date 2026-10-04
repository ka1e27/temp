// The battle tray (DESIGN 10.5): one chip per running battle, under the HUD on the map and at the top left in a battle. Browser only; no game-logic
// imports: the shell passes plain view data. Built once per battle and patched in place (a refresh between pointerdown and pointerup never recreates a
// chip, so a tap is never swallowed: the lesson of the region card and the battle HUD).
//
//   const tray = createBattleTray({ onSelect: (id) => ..., onAuto: (id, on) => ... });
//   tray.update({ visible, runs: [{ id, regionName, kind, share, clock, threatened, focused, auto, autoLabel }] });
//
// A chip is a button: its name says everything ("Attack on Greenreach, 0:31, you hold 60% of the troops, watching"); the kind is an icon (sword = attack,
// shield = defense) and words; `share` is the player's part of the troops in that arena (the bar); `threatened` pulses it (still under Reduce Motion: a
// steady red rim instead). The small Delegate toggle beside it hands that battle to its commander even while you watch it (ARCHITECTURE 10.1 `setAuto`).
import { h } from './dom.js';
import { icon } from './icons.js';

const pct = (x) => Math.round(Math.max(0, Math.min(1, x)) * 100);

/**
 * @param {{ onSelect?: (id: number) => void, onAuto?: (id: number, on: boolean) => void }} [callbacks]
 */
export function createBattleTray({ onSelect, onAuto, onCommander } = {}) {
  const listEl = h('div.battle-tray-list', { role: 'list' });
  const el = h('nav.battle-tray', { 'aria-label': 'Running battles' }, listEl);
  el.hidden = true;
  const chips = new Map(); // id -> { row, btn, iconSlot, nameEl, kindEl, clockEl, barFill, autoBtn, autoState, last }

  function build(id) {
    const iconSlot = h('span.tray-chip-icon', { 'aria-hidden': 'true' });
    const nameEl = h('span.tray-chip-name', {}, '');
    const kindEl = h('span.tray-chip-kind', {}, '');
    const clockEl = h('span.tray-chip-clock.nums', {}, '');
    const barFill = h('span.tray-chip-bar-fill');
    const bar = h('span.tray-chip-bar', { 'aria-hidden': 'true' }, barFill);
    const btn = h('button.tray-chip', { type: 'button', onClick: () => onSelect?.(id) },
      iconSlot,
      h('span.tray-chip-text', { 'aria-hidden': 'true' }, h('span.tray-chip-top', {}, nameEl, clockEl), h('span.tray-chip-bottom', {}, kindEl, bar)),
    );
    const autoState = h('span.tray-auto-state', {}, 'Off');
    const autoBtn = h('button.tray-auto', {
      type: 'button',
      onClick: () => { const e = chips.get(id); onAuto?.(id, !(e && e.last && e.last.auto)); },
      'aria-pressed': 'false',
    }, icon('shield', 14), h('span.tray-auto-label', { 'aria-hidden': 'true' }, 'Delegate'), autoState);
    // who commands it (DESIGN 10.11): a native select of the free Generals, the current one and the Militia Captain; rebuilt only when the choices change
    const cmdSelect = h('select.tray-commander', { onChange: () => onCommander?.(id, cmdSelect.value || null) });
    const row = h('div.tray-row', { role: 'listitem' }, btn, cmdSelect, autoBtn);
    listEl.appendChild(row);
    const entry = { row, btn, iconSlot, nameEl, kindEl, clockEl, barFill, autoBtn, autoState, cmdSelect, cmdSig: '', last: null, iconKind: null };
    chips.set(id, entry);
    return entry;
  }

  const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
  const setAttr = (node, k, v) => { if (node.getAttribute(k) !== v) node.setAttribute(k, v); };

  /**
   * @param {{ visible: boolean, runs: { id: number, regionName: string, kind: 'attack'|'defense', share: number, clock: string, threatened?: boolean, focused?: boolean, auto?: boolean, autoLabel?: string }[] }} data
   */
  function update(data) {
    if (!data) return;
    const runs = data.runs || [];
    const want = new Set(runs.map((r) => r.id));
    for (const [id, e] of chips) if (!want.has(id)) { e.row.remove(); chips.delete(id); }
    runs.forEach((r, i) => {
      const e = chips.get(r.id) || build(r.id);
      if (listEl.children[i] !== e.row) listEl.insertBefore(e.row, listEl.children[i] || null);
      const held = r.kind === 'defense' || r.kind === 'duel'; // a Duel (DESIGN 10.13) is held like a defense
      if (e.iconKind !== r.kind) { e.iconSlot.replaceChildren(icon(r.kind === 'duel' ? 'laurel' : held ? 'shield' : 'sword', 18)); e.iconKind = r.kind; }
      const kindWord = r.kind === 'duel' ? 'Duel' : held ? 'Defense' : 'Attack';
      setText(e.nameEl, r.regionName);
      setText(e.kindEl, kindWord); // (the commander shows in the picker beside the chip, and in the chip's name)
      if (r.commanderOptions) {
        const sig = JSON.stringify(r.commanderOptions);
        if (sig !== e.cmdSig) { e.cmdSig = sig; e.cmdSelect.replaceChildren(...r.commanderOptions.map((o) => h('option', { value: o.id || '' }, o.label))); }
        const v = r.commanderId || '';
        if (e.cmdSelect.value !== v) e.cmdSelect.value = v;
        setAttr(e.cmdSelect, 'aria-label', `Commander of the ${kindWord.toLowerCase()} ${r.kind === 'duel' ? 'at' : held ? 'of' : 'on'} ${r.regionName}`);
      }
      e.cmdSelect.hidden = !r.commanderOptions;
      setText(e.clockEl, r.clock || '');
      const w = `${pct(r.share)}%`;
      if (e.barFill.style.width !== w) e.barFill.style.width = w;
      e.row.classList.toggle('is-focused', !!r.focused);
      e.row.classList.toggle('is-threatened', !!r.threatened);
      e.row.classList.toggle('is-defense', held);
      setAttr(e.btn, 'aria-current', r.focused ? 'true' : 'false');
      const label = `${kindWord} ${r.kind === 'duel' ? 'at' : held ? 'of' : 'on'} ${r.regionName}${r.commanderName ? `, commanded by ${r.commanderName}` : ''}, ${r.clock || '0:00'}, you hold ${pct(r.share)}% of the troops${r.threatened ? ', a settlement is in danger' : ''}${r.focused ? ', watching' : ', press to watch'}`;
      setAttr(e.btn, 'aria-label', label);
      const auto = !!r.auto;
      e.autoBtn.classList.toggle('is-on', auto);
      setAttr(e.autoBtn, 'aria-pressed', String(auto));
      // "Delegate", not "Auto" (the battle HUD's Auto is the supply-line switch) nor "Captain" (the Militia Captain is a commander in the select beside it)
      const who = r.commanderName || 'your commander';
      setAttr(e.autoBtn, 'aria-label', `Delegate: let ${who} fight ${r.regionName} even while you watch`);
      setAttr(e.autoBtn, 'title', `Delegate: let ${who} fight ${r.regionName} even while you watch`);
      setText(e.autoState, auto ? 'On' : 'Off');
      e.last = r;
    });
    const show = !!data.visible && runs.length > 0;
    if (el.hidden === show) el.hidden = !show;
  }

  /** The chip of a battle (for hints and checks). */
  const chipOf = (id) => (chips.get(id) || {}).btn || null;

  function destroy() {
    listEl.replaceChildren();
    chips.clear();
  }

  return { el, update, chipOf, destroy };
}
