// The intel panel's behaviour (game/ui/intelPanel.js) without a browser: a tiny DOM stand-in that
// implements just what dom.js, icons.js and the panel touch. Data comes from the real meta layer, so
// the panel is exercised with exactly the shapes intelPanelData() produces.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/generate.js';
import { createGame } from '../meta/state.js';
import { frontier, conquer } from '../meta/progression.js';
import * as intel from '../meta/intel.js';
import { shortNumber } from '../ui/format.js';

// --- minimal DOM ---------------------------------------------------------------------------------
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
    this.style = { setProperty: (k, v) => { this.style[k] = v; } };
    this._classes = new Set();
    this.classList = {
      add: (...c) => c.forEach((x) => this._classes.add(x)),
      remove: (...c) => c.forEach((x) => this._classes.delete(x)),
      contains: (c) => this._classes.has(c),
    };
    this.title = '';
    this.hidden = false;
    this.disabled = false;
    this.type = '';
    this.role = '';
    this.parentNode = null;
  }

  get firstChild() { return this.children[0] || null; }
  get offsetWidth() { return 0; }
  get className() { return [...this._classes].join(' '); }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.children = []; if (v !== '') this.appendChild(new FakeText(v)); }

  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { this.children = this.children.filter((c) => c !== child); return child; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  /** Fires click listeners the way a browser does: never on a disabled button. */
  click() { if (this.disabled) return; for (const fn of this.listeners.click || []) fn({}); }
}

const realDocument = globalThis.document;
const realNode = globalThis.Node;
before(() => {
  globalThis.Node = FakeNode;
  globalThis.document = {
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    createTextNode: (t) => new FakeText(t),
  };
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
const one = (root, cls) => {
  const list = find(root, cls);
  assert.equal(list.length, 1, `expected exactly one .${cls}, found ${list.length}`);
  return list[0];
};
const text = (n) => n.textContent.replace(/\s+/g, ' ').trim();

async function makePanel(callbacks) {
  const { createIntelPanel } = await import('../ui/intelPanel.js');
  return createIntelPanel(callbacks);
}

function scenario() {
  const world = generateWorld(7);
  const state = createGame(7, world, 0);
  for (let i = 0; i < 3; i += 1) {
    const front = frontier(state, world).sort((a, b) => world.regions[a].tier - world.regions[b].tier || a - b);
    conquer(state, world, front[0], 0);
  }
  const front = frontier(state, world).sort((a, b) => a - b);
  return { world, state, id: front[0], front };
}

// --- tests ----------------------------------------------------------------------------------------

test('unscouted: one Scout button with its cost; nothing else is showing', async () => {
  const calls = [];
  const panel = await makePanel({ onScout: (id) => calls.push(id) });
  const { world, state, id } = scenario();
  state.gold = 1e6;
  const data = intel.intelPanelData(state, world, id);
  panel.update(data);

  assert.equal(panel.el.dataset.state, 'unscouted');
  assert.equal(one(panel.el, 'intel-report').hidden, true);
  assert.equal(one(panel.el, 'intel-scout-row').hidden, false);
  const btn = one(panel.el, 'intel-scout-btn');
  assert.equal(btn.disabled, false);
  assert.match(text(btn), /^Scout/);
  assert.match(text(btn), new RegExp(String(data.scoutCost)));
  assert.match(btn.getAttribute('aria-label'), /Scout this region for/);

  btn.click();
  assert.deepEqual(calls, [id], 'the click reports the region id');
});

test('unscouted and short of gold: disabled, says how much is missing, never fires', async () => {
  const calls = [];
  const panel = await makePanel({ onScout: (id) => calls.push(id) });
  const { world, state, id } = scenario();
  state.gold = 5;
  const data = intel.intelPanelData(state, world, id);
  panel.update(data);

  const btn = one(panel.el, 'intel-scout-btn');
  assert.equal(btn.disabled, true);
  const hint = one(one(panel.el, 'intel-scout-row'), 'intel-hint');
  assert.equal(text(hint), `Need ${data.scoutCost - 5} more gold`);
  btn.click();
  assert.deepEqual(calls, []);

  // The moment the gold arrives, the same panel enables itself.
  state.gold = 1e6;
  panel.update(intel.intelPanelData(state, world, id));
  assert.equal(btn.disabled, false);
  assert.notEqual(text(hint), `Need ${data.scoutCost - 5} more gold`);
});

test('unscouted and free (tutorial region): reads "free" and works with no gold', async () => {
  const calls = [];
  const panel = await makePanel({ onScout: (id) => calls.push(id) });
  const world = generateWorld(7);
  const state = createGame(7, world, 0);
  state.gold = 0;
  const id = intel.tutorialRegionId(state, world);
  panel.update(intel.intelPanelData(state, world, id));
  const btn = one(panel.el, 'intel-scout-btn');
  assert.equal(btn.disabled, false);
  assert.match(text(btn), /free/i);
  btn.click();
  assert.deepEqual(calls, [id]);
});

test('scouted: the report shows chips, personality, weak point, notes and the sabotage button', async () => {
  const sabotageCalls = [];
  const panel = await makePanel({ onSabotage: (id) => sabotageCalls.push(id) });
  const { world, state, id } = scenario();
  state.gold = 1e7;
  intel.scout(state, world, id);
  const data = intel.intelPanelData(state, world, id);
  panel.update(data);
  const r = data.report;

  assert.equal(panel.el.dataset.state, 'scouted');
  assert.equal(one(panel.el, 'intel-scout-row').hidden, true);
  assert.equal(one(panel.el, 'intel-report').hidden, false);

  const chips = find(panel.el, 'intel-chip');
  assert.equal(chips.length, r.groups.length);
  assert.equal(chips[0].dataset.type, 'keep', 'the keep leads');
  for (const [i, g] of r.groups.entries()) {
    assert.match(text(chips[i]), new RegExp(`^${g.label}\\s*${Math.round(g.garrison)}`));
    if (g.count > 1) assert.match(text(chips[i]), new RegExp(`×${g.count}$`));
  }
  assert.equal(find(panel.el, 'intel-chip').filter((c) => c.dataset.weak === '1').length <= 1, true);

  assert.equal(text(one(panel.el, 'intel-personality')), r.personalityLine);
  const weak = text(one(panel.el, 'intel-weak'));
  assert.match(weak, /^Weak point:/);
  assert.match(weak, new RegExp(r.weakPointType, 'i'));
  const notes = find(panel.el, 'intel-note');
  assert.equal(notes.length, r.notes.length);
  assert.ok(notes.length <= 2);

  const btn = one(panel.el, 'intel-sabotage-btn');
  assert.equal(btn.disabled, false);
  assert.match(text(btn), /^Sabotage −15%/);
  assert.ok(text(btn).includes(shortNumber(data.sabotageCost)), 'the price is on the button (abbreviated from 1000 up)');
  btn.click();
  assert.deepEqual(sabotageCalls, [id]);
  assert.equal(panel.el.dataset.sabotage, 'ready');
});

test('scouted but short of gold: sabotage is disabled with a reason line', async () => {
  const calls = [];
  const panel = await makePanel({ onSabotage: (id) => calls.push(id) });
  const { world, state, id } = scenario();
  state.gold = 1e7;
  intel.scout(state, world, id);
  state.gold = 10;
  const data = intel.intelPanelData(state, world, id);
  panel.update(data);
  const btn = one(panel.el, 'intel-sabotage-btn');
  assert.equal(btn.disabled, true);
  assert.equal(text(one(panel.el, 'intel-sabotage-hint')), `Need ${shortNumber(data.sabotageCost - 10)} more gold`);
  assert.equal(panel.el.dataset.sabotage, 'poor');
  btn.click();
  assert.deepEqual(calls, []);
});

test('pips light 0, 1, 2 and the maxed state explains itself', async () => {
  const panel = await makePanel({});
  const { world, state, id } = scenario();
  state.gold = 1e9;
  intel.scout(state, world, id);
  const lit = () => find(panel.el, 'intel-pip').filter((p) => p.dataset.lit === '1').length;

  panel.update(intel.intelPanelData(state, world, id));
  assert.equal(find(panel.el, 'intel-pip').length, 2);
  assert.equal(lit(), 0);
  assert.equal(text(one(panel.el, 'intel-cut')), '');

  intel.sabotage(state, world, id);
  panel.update(intel.intelPanelData(state, world, id));
  assert.equal(lit(), 1);
  assert.equal(text(one(panel.el, 'intel-cut')), '−15%');
  assert.equal(one(panel.el, 'intel-sabotage-btn').disabled, false);

  intel.sabotage(state, world, id);
  panel.update(intel.intelPanelData(state, world, id));
  assert.equal(lit(), 2);
  assert.equal(text(one(panel.el, 'intel-cut')), '−30%');
  const btn = one(panel.el, 'intel-sabotage-btn');
  assert.equal(btn.disabled, true);
  assert.equal(text(btn), 'Garrisons already weakened');
  assert.equal(panel.el.dataset.sabotage, 'maxed');
});

test('update is idempotent, safe to call every frame, and follows a region switch', async () => {
  const panel = await makePanel({});
  const { world, state, front } = scenario();
  state.gold = 1e9;
  const a = front[0];
  const b = front.find((f) => f !== a);
  intel.scout(state, world, a);

  // The visible report as text plus state flags (the hidden scout row keeps whatever it last showed).
  const snapshot = () => [panel.el.dataset.state, one(panel.el, 'intel-report').hidden,
    text(one(panel.el, 'intel-report')), find(panel.el, 'intel-pip').map((p) => p.dataset.lit).join('')].join('|');
  panel.update(intel.intelPanelData(state, world, a));
  const first = snapshot();
  for (let i = 0; i < 5; i += 1) panel.update(intel.intelPanelData(state, world, a));
  assert.equal(snapshot(), first, 'identical data leaves the DOM identical');

  // Another (unscouted) region: back to the one-button state, and the report no longer shows.
  panel.update(intel.intelPanelData(state, world, b));
  assert.equal(panel.el.dataset.state, 'unscouted');
  assert.equal(one(panel.el, 'intel-report').hidden, true);
  // ... and back again.
  panel.update(intel.intelPanelData(state, world, a));
  assert.equal(panel.el.dataset.state, 'scouted');
  assert.equal(snapshot(), first);

  panel.update(null); // ignored, never throws
  assert.doesNotThrow(() => panel.destroy());
});

test('a report with no notes and a single-chip composition still renders', async () => {
  const panel = await makePanel({});
  const { world, state, id } = scenario();
  state.gold = 1e9;
  intel.scout(state, world, id);
  const data = intel.intelPanelData(state, world, id);
  data.report = { ...data.report, notes: [], groups: data.report.groups.slice(0, 1) };
  panel.update(data);
  assert.equal(find(panel.el, 'intel-chip').length, 1);
  assert.equal(one(panel.el, 'intel-notes').hidden, true);
});

test('the stylesheet takes its colours from design tokens, respects Reduce Motion and touch targets', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../styles/components/intel.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const hex = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
  assert.deepEqual(hex, [], 'no raw hex colours: everything derives from tokens.css');
  assert.match(css, /\.reduce-motion|html\.reduce-motion/, 'respects Reduce Motion');
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /pointer: coarse/, 'touch screens get the full-size target');
});
