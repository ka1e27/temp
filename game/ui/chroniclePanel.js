// The Chronicle section of the Realm panel (DESIGN §5.9): a scrollable story of the realm, newest first: an icon, the
// story line, and when it happened ("Year 2 · 3h ago"), with a "This dynasty / All time" toggle. Browser only; no
// game-logic imports: the integrator builds the data with `chroniclePanelData(state, world, now)` from
// game/meta/chronicle.js (all the words, the dates and the empty texts are in it) and passes it in whenever the Realm panel
// opens or the chronicle grows.
//
//   const chronicle = createChroniclePanel({ onMode: (mode) => ... });
//   realmBody.append(chronicle.el);
//   chronicle.update(chroniclePanelData(state, world, Date.now()));
//
// The toggle is local (both lists arrive in the data, so switching needs no round trip); `onMode` only reports it. The toggle
// buttons live for the panel's whole life and the list is rebuilt only when its content changed, so an `update` every second
// would be harmless. The list scrolls on its own on a desktop and flows with the Realm panel (which scrolls) on a phone.
import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * @typedef {Object} ChronicleRow   (game/meta/chronicle.js)
 * @property {string} kind
 * @property {string} icon        a name from game/ui/icons.js
 * @property {string} text        the story line
 * @property {string} year        "Year 2"
 * @property {string} ago         "3h ago"
 * @property {boolean} highlight
 * @property {number} dynasty
 * @property {string} chapter     "Dynasty II"
 *
 * @typedef {Object} ChroniclePanelData
 * @property {ChronicleRow[]} dynasty   this dynasty, newest first
 * @property {ChronicleRow[]} all       lifetime highlights, newest first
 * @property {{ title: string, thisDynasty: string, allTime: string }} labels
 * @property {{ dynasty: string, all: string }} empty
 */

let panelCount = 0; // unique ids when several panels exist (the gallery shows four at once)
const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
const setData = (node, key, value) => { const v = String(value); if (node.dataset[key] !== v) node.dataset[key] = v; };

/**
 * @param {{ onMode?: (mode: 'dynasty'|'all') => void }} [callbacks]
 */
export function createChroniclePanel({ onMode } = {}) {
  let data = null;
  let mode = 'dynasty';
  let listSig = '';
  const titleId = `chron-title-${++panelCount}`;

  const titleEl = h('h3.chron-title', { id: titleId }, 'Chronicle');
  const dynLabel = h('span.chron-seg-label', {}, 'This dynasty');
  const dynCount = h('span.chron-seg-count.nums', {}, '');
  const allLabel = h('span.chron-seg-label', {}, 'All time');
  const allCount = h('span.chron-seg-count.nums', {}, '');
  const dynBtn = h('button.chron-seg-btn', { type: 'button', onClick: () => setMode('dynasty') }, dynLabel, dynCount);
  const allBtn = h('button.chron-seg-btn', { type: 'button', onClick: () => setMode('all') }, allLabel, allCount);
  // two toggle buttons in a group (aria-pressed), not tabs: there is one list, and no arrow-key roving to promise
  const seg = h('div.chron-seg', { role: 'group', 'aria-label': 'Chronicle range' }, dynBtn, allBtn);
  // focusable so a keyboard can scroll it (the Realm panel traps Tab inside itself, and the list has no controls of its own)
  const listEl = h('ul.chron-list.scroll-y', { role: 'list', tabindex: '0', 'aria-labelledby': titleId });
  const emptyEl = h('p.chron-empty', {}, '');
  const el = h('section.chron', { 'aria-label': 'Chronicle', dataset: { mode: 'dynasty' } },
    h('div.chron-head', {}, titleEl, seg), listEl, emptyEl);

  function row(r) {
    return h('li.chron-row', { role: 'listitem', dataset: { kind: r.kind, highlight: r.highlight ? '1' : '0' } },
      h('span.chron-chip', {}, icon(r.icon || 'scroll', 16)),
      h('div.chron-body', {},
        h('p.chron-text', {}, r.text),
        h('span.chron-meta', {}, h('span.chron-year', {}, r.year), h('span.chron-sep', { 'aria-hidden': 'true' }, '·'), h('span.chron-ago', {}, r.ago))));
  }

  function render() {
    if (!data) return;
    const rows = (mode === 'all' ? data.all : data.dynasty) || [];
    const sig = [mode, ...rows.map((r) => `${r.kind}|${r.text}|${r.year}|${r.ago}|${r.chapter}`)].join('\n');
    if (sig === listSig) return;
    listSig = sig;
    const nodes = [];
    let chapter = null;
    for (const r of rows) {
      // in the all-time list, rows are grouped under their dynasty
      if (mode === 'all' && r.chapter !== chapter) {
        chapter = r.chapter;
        nodes.push(h('li.chron-chapter', { role: 'presentation' }, h('span', {}, chapter)));
      }
      nodes.push(row(r));
    }
    listEl.replaceChildren(...nodes);
    emptyEl.hidden = rows.length > 0;
    listEl.hidden = rows.length === 0;
    setText(emptyEl, rows.length ? '' : (data.empty ? data.empty[mode] : ''));
    if (listEl.scrollTop) listEl.scrollTop = 0;
  }

  function setMode(next) {
    if (next === mode) return;
    mode = next;
    patchToggle();
    render();
    onMode?.(mode);
  }

  function patchToggle() {
    setData(el, 'mode', mode);
    for (const [btn, key] of [[dynBtn, 'dynasty'], [allBtn, 'all']]) {
      const on = mode === key;
      setData(btn, 'on', on ? '1' : '0');
      if (btn.getAttribute('aria-pressed') !== String(on)) btn.setAttribute('aria-pressed', String(on));
    }
  }

  /** @param {ChroniclePanelData} next */
  function update(next) {
    if (!next) return;
    data = next;
    if (next.labels) {
      setText(titleEl, next.labels.title);
      setText(dynLabel, next.labels.thisDynasty);
      setText(allLabel, next.labels.allTime);
    }
    setText(dynCount, String((next.dynasty || []).length));
    setText(allCount, String((next.all || []).length));
    patchToggle();
    render();
  }

  function destroy() {
    el.replaceChildren();
    data = null;
  }

  return { el, update, destroy, setMode, get mode() { return mode; } };
}
