// The export and import drawers — a save survives a cleared browser.
//
// Split out of ./mainmenu.js for the line budget when the record drawer landed,
// in the same shape as its settings, abdication and recovery siblings: this
// file owns the CONTENT of two drawers and nothing about the menu around them.
//
// The seam is a real one rather than a convenience. Everything here is about
// moving a save ACROSS a browser, and it is the only part of the menu that
// touches meta/save.js at all — the rest of that file is about which scene to
// go to next.
//
// A REFUSED IMPORT CHANGES NOTHING, and says why. `importSave` applies the same
// rules a disk load does, which is the whole reason this is safe to offer: a
// player pasting the wrong clipboard cannot lose an empire to it. That
// guarantee is one `if (!res.ok) return` and it is the load-bearing line in
// this file — mainmenu-recovery.js exists because the equivalent guarantee on
// the DISK path was silently absent for a whole release.
import { h, clear, mount } from '../ui/dom.js';
import { SAVE } from '../content/strings.js';
import { exportSave, importSave } from '../meta/save.js';

/** A textarea a save can actually be selected out of. */
function textbox(props) {
  return h('textarea.menu-text', {
    spellcheck: 'false', autocomplete: 'off', rows: '4',
    // The board is user-select:none; a save you cannot select is not an export.
    style: { userSelect: 'text', WebkitUserSelect: 'text', width: '100%' },
    ...props,
  });
}

/**
 * The export drawer: the save as text, and a copy button.
 *
 * @param {HTMLElement} drawer
 * @param {object} ctx  scene context (needs `state`)
 * @param {{say:(s:string)=>void, close:()=>HTMLElement}} io
 *   `close` builds the shared dismiss button, so both drawers here and the
 *   three in mainmenu.js stay one control rather than five copies.
 */
export function renderExport(drawer, ctx, { say, close }) {
  clear(drawer);
  const text = exportSave(ctx.state, { now: Date.now() });
  const box = textbox({ readonly: true, 'aria-label': 'Your save, as text' });
  box.value = text;
  mount(drawer, h('div.menu-drawer', {},
    h('label.label', { for: 'menu-export-box', text: 'Copy this somewhere safe' }),
    box,
    h('div.row', {},
      h('button.btn.menu-copy', {
        type: 'button',
        text: 'Copy to clipboard',
        on: {
          click: () => {
            box.select();
            navigator.clipboard?.writeText(text).catch(() => {});
            say(SAVE.exported);
          },
        },
      }),
      close())));
  box.id = 'menu-export-box';
  box.focus();
  box.select();
  return box;
}

/**
 * The import drawer.
 *
 * @param {{say:(s:string)=>void, close:()=>HTMLElement, onAdopt:(state:object,
 *          now:number)=>void}} io
 *   `onAdopt` is only ever called for a save that PARSED — see the refusal
 *   guarantee in this file's header.
 */
export function renderImport(drawer, ctx, { say, close, onAdopt }) {
  clear(drawer);
  const box = textbox({ 'aria-label': 'Paste a save', placeholder: 'Paste your save text here' });

  const run = () => {
    const text = String(box.value ?? '').trim();
    if (!text) { say('Paste a save first.'); return; }
    const now = Date.now();
    const res = importSave(text, { now });
    if (!res.ok) {
      say(`${SAVE.refusedTitle}: ${SAVE.reasons[res.reason] ?? res.reason}. ${SAVE.refusedBody}`);
      return;
    }
    onAdopt(res.state, now);
    say(SAVE.imported);
  };

  mount(drawer, h('div.menu-drawer', {},
    h('label.label', { for: 'menu-import-box', text: 'Paste a save' }),
    box,
    h('div.row', {},
      h('button.btn.primary.menu-do-import', { type: 'button', text: 'Import', on: { click: run } }),
      close())));
  box.id = 'menu-import-box';
  box.focus();
  return box;
}
