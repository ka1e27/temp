// The Chronicle panel (game/ui/chroniclePanel.js) without a browser: a tiny DOM stand-in that implements just what dom.js,
// icons.js and the component touch. Data comes from the real meta layer (chroniclePanelData), so the panel is exercised with
// exactly the shapes the game will hand it. The real-browser half (layout, the toggle with real clicks, phone fit) is
// checked in tools/gallery/keepsakes.html (tools/gallery/keepsakes-check.mjs).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLAYER_FACTION } from '../meta/state.js';
import { chronicleOnConquest, chronicleOnProsperity, chroniclePanelData, chronicleOnDynasty } from '../meta/chronicle.js';
import { CHRONICLE } from '../config/chronicle.js';
import { makeWorld, makeGame } from './meta.fixtures.js';

// --- minimal DOM ---------------------------------------------------------------------------------
let mutations = 0; // every structural or attribute write bumps this: "an identical refresh touches nothing" is testable

class FakeNode {}
class FakeText extends FakeNode {
  constructor(text) { super(); this.data = String(text); }
  get textContent() { return this.data; }
}
class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.listeners = {};
    this.style = {};
    this._classes = new Set();
    this.classList = {
      add: (...c) => c.forEach((x) => this._classes.add(x)),
      remove: (...c) => c.forEach((x) => this._classes.delete(x)),
      contains: (c) => this._classes.has(c),
    };
    this.hidden = false;
    this.disabled = false;
    this.type = '';
    this.parentNode = null;
  }

  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { mutations++; this.children = []; if (v !== '') this.appendChild(new FakeText(v)); }

  appendChild(child) { mutations++; child.parentNode = this; this.children.push(child); return child; }
  replaceChildren(...nodes) { mutations++; this.children = []; for (const n of nodes) this.appendChild(n); }
  setAttribute(k, v) { mutations++; this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  click() { if (this.disabled) return; for (const fn of this.listeners.click || []) fn({}); }
}

const realDocument = globalThis.document;
const realNode = globalThis.Node;
let createChroniclePanel;
before(async () => {
  globalThis.Node = FakeNode;
  globalThis.document = {
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    createTextNode: (t) => new FakeText(t),
  };
  ({ createChroniclePanel } = await import('../ui/chroniclePanel.js'));
});
after(() => {
  globalThis.document = realDocument;
  globalThis.Node = realNode;
});

// --- helpers -------------------------------------------------------------------------------------
function walk(node, visit) {
  visit(node);
  for (const c of node.children || []) walk(c, visit);
}
function find(root, cls) {
  const out = [];
  walk(root, (n) => { if (n._classes && n._classes.has(cls)) out.push(n); });
  return out;
}
const one = (root, cls) => find(root, cls)[0];
const textOf = (node) => node.textContent.replace(/\s+/g, ' ').trim();

const T0 = 1_000_000_000_000;
const HOUR = 3600000;
const ALL3 = { victory: true, swift: true, unbroken: true };

/** A realm with a few chronicle entries, through the real meta layer. */
function realm({ regions = 2 } = {}) {
  const world = makeWorld();
  const state = makeGame(world, {});
  state.chronicle = undefined;
  const take = (id, t, opts) => {
    state.owner[id] = PLAYER_FACTION;
    state.conqueredAt[id] = t;
    chronicleOnConquest(state, world, id, { t, ...opts });
  };
  if (regions >= 1) take(1, T0 + HOUR, { crowns: ALL3, battleSec: 70 });
  if (regions >= 2) take(2, T0 + 2 * HOUR, { crowns: ALL3, battleSec: 55 });
  return { world, state };
}
const NOW = T0 + 5 * HOUR;
const rows = (panel) => find(panel.el, 'chron-row');

// --- tests ---------------------------------------------------------------------------------------

test('panel: the empty chronicle shows the empty line, no rows, and both counts at 0', () => {
  const { world, state } = realm({ regions: 0 });
  const panel = createChroniclePanel({});
  panel.update(chroniclePanelData(state, world, NOW));
  assert.equal(rows(panel).length, 0);
  assert.equal(one(panel.el, 'chron-empty').hidden, false);
  assert.equal(textOf(one(panel.el, 'chron-empty')), CHRONICLE.empty.dynasty);
  assert.equal(one(panel.el, 'chron-list').hidden, true);
  const counts = find(panel.el, 'chron-seg-count').map(textOf);
  assert.deepEqual(counts, ['0', '0']);
});

test('panel: rows are newest first, each with its icon chip, story line, year and ago', () => {
  const { world, state } = realm();
  const data = chroniclePanelData(state, world, NOW);
  const panel = createChroniclePanel({});
  panel.update(data);
  const list = rows(panel);
  assert.equal(list.length, data.dynasty.length);
  assert.ok(list.length >= 3);
  assert.equal(textOf(one(list[0], 'chron-text')), data.dynasty[0].text);
  assert.equal(textOf(one(list[0], 'chron-year')), data.dynasty[0].year);
  assert.match(textOf(one(list[0], 'chron-year')), /^Year \d+$/);
  assert.equal(textOf(one(list[0], 'chron-ago')), data.dynasty[0].ago);
  for (const r of list) {
    assert.equal(find(r, 'chron-chip').length, 1);
    assert.equal(find(r, 'chron-chip')[0].children[0].tagName, 'svg', 'the chip holds the icon');
  }
  assert.equal(one(panel.el, 'chron-empty').hidden, true);
  assert.equal(one(panel.el, 'chron-list').hidden, false);
  // the order is the data's order (newest first): the times only fall
  const kinds = list.map((r) => r.dataset.kind);
  assert.deepEqual(kinds, data.dynasty.map((r) => r.kind));
});

test('panel: highlights carry data-highlight so the gold edge can be styled', () => {
  const { world, state } = realm();
  const data = chroniclePanelData(state, world, NOW);
  const panel = createChroniclePanel({});
  panel.update(data);
  const flags = rows(panel).map((r) => r.dataset.highlight);
  assert.deepEqual(flags, data.dynasty.map((r) => (r.highlight ? '1' : '0')));
  assert.ok(flags.includes('1'), 'the first conquest is a highlight');
});

test('toggle: This dynasty / All time swap the list in place; onMode reports; the buttons never rebuild', () => {
  const { world, state } = realm();
  const data = chroniclePanelData(state, world, NOW);
  const seen = [];
  const panel = createChroniclePanel({ onMode: (m) => seen.push(m) });
  panel.update(data);
  const [dynBtn, allBtn] = find(panel.el, 'chron-seg-btn');
  assert.equal(panel.mode, 'dynasty');
  assert.equal(dynBtn.dataset.on, '1');
  assert.equal(allBtn.dataset.on, '0');
  assert.equal(dynBtn.getAttribute('aria-pressed'), 'true');
  assert.equal(allBtn.getAttribute('aria-pressed'), 'false');

  allBtn.click();
  assert.equal(panel.mode, 'all');
  assert.deepEqual(seen, ['all']);
  assert.equal(panel.el.dataset.mode, 'all');
  assert.equal(allBtn.dataset.on, '1');
  assert.equal(dynBtn.dataset.on, '0');
  assert.equal(rows(panel).length, data.all.length, 'the all-time list is the lifetime highlights');
  assert.ok(find(panel.el, 'chron-chapter').length >= 1, 'all-time rows sit under a chapter divider');
  assert.equal(find(panel.el, 'chron-seg-btn')[1], allBtn, 'the same button node is still there');

  allBtn.click(); // already on: no callback
  assert.deepEqual(seen, ['all']);
  dynBtn.click();
  assert.deepEqual(seen, ['all', 'dynasty']);
  assert.equal(rows(panel).length, data.dynasty.length);
  assert.equal(find(panel.el, 'chron-chapter').length, 0, 'no dividers in the dynasty list');
  panel.setMode('all');
  assert.equal(panel.mode, 'all');
  assert.equal(allBtn.dataset.on, '1');
});

test('toggle: the counts follow the data', () => {
  const { world, state } = realm();
  const data = chroniclePanelData(state, world, NOW);
  const panel = createChroniclePanel({});
  panel.update(data);
  assert.deepEqual(find(panel.el, 'chron-seg-count').map(textOf), [String(data.dynasty.length), String(data.all.length)]);
});

test('all time: rows are grouped under one divider per dynasty, newest dynasty first', () => {
  const world = makeWorld();
  const state = makeGame(world, {});
  state.chronicle = undefined;
  state.owner[1] = PLAYER_FACTION;
  state.conqueredAt[1] = T0;
  chronicleOnConquest(state, world, 1, { t: T0, crowns: ALL3, battleSec: 60 });
  state.dynasty = { ...state.dynasty, level: 2, stars: 3 };
  chronicleOnDynasty(state, world, { t: T0 + 24 * HOUR });
  const data = chroniclePanelData(state, world, T0 + 30 * HOUR);
  const panel = createChroniclePanel({});
  panel.update(data);
  panel.setMode('all');
  const dividers = find(panel.el, 'chron-chapter').map(textOf);
  assert.equal(dividers.length, new Set(data.all.map((r) => r.chapter)).size);
  assert.equal(dividers[0], data.all[0].chapter, 'the newest dynasty comes first');
  assert.ok(dividers.length >= 2);
});

test('update: an identical refresh touches nothing; a new entry rebuilds only the list', () => {
  const { world, state } = realm();
  const panel = createChroniclePanel({});
  panel.update(chroniclePanelData(state, world, NOW));
  const before = mutations;
  panel.update(chroniclePanelData(state, world, NOW));
  assert.equal(mutations, before, 'same data, no DOM writes');
  const firstRow = rows(panel)[0];

  chronicleOnProsperity(state, world, [{ regionId: 1, level: 3, from: 2 }], { t: NOW });
  const grew = chroniclePanelData(state, world, NOW);
  panel.update(grew);
  assert.equal(rows(panel).length, grew.dynasty.length);
  assert.notEqual(rows(panel)[0], firstRow, 'the newest line is at the top');
  assert.match(textOf(one(rows(panel)[0], 'chron-text')), /\w/);
});

test('update: a changed "ago" label rewrites the list text but keeps the toggle buttons', () => {
  const { world, state } = realm();
  const panel = createChroniclePanel({});
  panel.update(chroniclePanelData(state, world, NOW));
  const [dynBtn] = find(panel.el, 'chron-seg-btn');
  const before = textOf(one(panel.el, 'chron-ago'));
  panel.update(chroniclePanelData(state, world, NOW + 30 * HOUR));
  assert.notEqual(textOf(one(panel.el, 'chron-ago')), before);
  assert.equal(find(panel.el, 'chron-seg-btn')[0], dynBtn);
});

test('update: an emptied all-time list shows the all-time empty line', () => {
  const { world, state } = realm({ regions: 0 });
  const panel = createChroniclePanel({});
  panel.update(chroniclePanelData(state, world, NOW));
  panel.setMode('all');
  assert.equal(textOf(one(panel.el, 'chron-empty')), CHRONICLE.empty.all);
  assert.equal(one(panel.el, 'chron-empty').hidden, false);
});

test('robustness: update(null) is a no-op, destroy empties the section, labels fall back', () => {
  const panel = createChroniclePanel();
  panel.update(null);
  assert.equal(rows(panel).length, 0);
  panel.update({ dynasty: [], all: [] });
  assert.equal(textOf(one(panel.el, 'chron-title')), 'Chronicle');
  panel.destroy();
  assert.equal(panel.el.children.length, 0);
});

test('text is set with textContent only (story lines can contain player-chosen names)', () => {
  const src = readFileSync(new URL('../ui/chroniclePanel.js', import.meta.url), 'utf8');
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(src));
});

test('purity: the panel imports only dom and icons; no meta, config or numbers in the UI', () => {
  const src = readFileSync(new URL('../ui/chroniclePanel.js', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/^import .* from '(.+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['./dom.js', './icons.js']);
  assert.ok(!/\d+\s*%/.test(src), 'no typed percentages');
});

// --- the "Save the map" button ------------------------------------------------------------------------

test('save button: one tap calls onSave once; the label and icon are there', async () => {
  const { createSaveMapButton } = await import('../ui/saveMapButton.js');
  let calls = 0;
  const save = createSaveMapButton({ onSave: () => { calls += 1; } });
  assert.equal(save.el.tagName, 'button');
  assert.ok(save.el.classList.contains('btn-secondary') && save.el.classList.contains('btn-block'));
  assert.equal(save.el.children[0].tagName, 'svg', 'the map icon comes first');
  save.update({ label: 'Save the map', busyLabel: 'Saving...', busy: false });
  assert.equal(textOf(save.el), 'Save the map');
  save.el.click();
  assert.equal(calls, 1);
});

test('save button: busy disables it, shows the busy label, ignores presses; idle restores it; same data touches nothing', async () => {
  const { createSaveMapButton } = await import('../ui/saveMapButton.js');
  let calls = 0;
  const save = createSaveMapButton({ onSave: () => { calls += 1; } });
  const idle = { label: 'Save the map', busyLabel: 'Saving...', busy: false };
  save.update(idle);
  const node = save.el;
  save.update({ ...idle, busy: true });
  assert.equal(save.busy, true);
  assert.equal(node.disabled, true);
  assert.equal(node.getAttribute('aria-busy'), 'true');
  assert.equal(textOf(node), 'Saving...');
  node.disabled = false; // even if a browser let the event through, the component refuses a second render
  node.click();
  assert.equal(calls, 0, 'a press while busy does nothing');
  save.update({ ...idle, busy: true });
  node.disabled = true;
  save.update(idle);
  assert.equal(node.disabled, false);
  assert.equal(node.getAttribute('aria-busy'), 'false');
  assert.equal(textOf(node), 'Save the map');
  assert.equal(save.el, node, 'never rebuilt');
  const before = mutations;
  save.update(idle);
  save.update(idle);
  assert.equal(mutations, before, 'identical data, no DOM writes');
  save.update(null);
  node.click();
  assert.equal(calls, 1);
});

test('save button: imports only dom and icons', () => {
  const src = readFileSync(new URL('../ui/saveMapButton.js', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/^import .* from '(.+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['./dom.js', './icons.js']);
});
