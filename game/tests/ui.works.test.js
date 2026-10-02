// The Works panel and chooser (game/ui/worksPanel.js, worksChooser.js, worksIcons.js) without a browser: a tiny DOM
// stand-in that implements just what dom.js, icons.js and the components touch. Data comes from the real meta layer,
// so the UI is exercised with exactly the shapes worksPanelData() produces. The real-browser half (layout, heights,
// touch targets) is checked in tools/gallery/works.html.
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLAYER_FACTION } from '../meta/state.js';
import * as works from '../meta/works.js';
import { WORK_TYPES } from '../config/works.js';
import { makeWorld, makeGame } from './meta.fixtures.js';

// --- minimal DOM ---------------------------------------------------------------------------------
let mutations = 0; // every structural or attribute write below bumps this, so "an identical refresh touches nothing" is testable

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
    this._title = '';
    this.hidden = false;
    this.disabled = false;
    this.type = '';
    this.role = '';
    this.parentNode = null;
  }

  get title() { return this._title; }
  set title(v) { if (v !== this._title) mutations++; this._title = v; }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get offsetWidth() { return 0; }
  get isConnected() { return true; }
  get className() { return [...this._classes].join(' '); }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { mutations++; this.children = []; if (v !== '') this.appendChild(new FakeText(v)); }

  appendChild(child) { mutations++; child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { mutations++; this.children = this.children.filter((c) => c !== child); return child; }
  replaceChildren(...nodes) { mutations++; this.children = []; for (const n of nodes) this.appendChild(n); }
  setAttribute(k, v) { mutations++; this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  /** Fires click listeners the way a browser does: never on a disabled button. */
  click() { if (this.disabled) return; for (const fn of this.listeners.click || []) fn({}); }
  fire(name, ev = {}) { for (const fn of this.listeners[name] || []) fn({ stopPropagation() {}, ...ev }); }
}

const realDocument = globalThis.document;
const realNode = globalThis.Node;
let createWorksPanel;
let createWorksChooser;
let worksIcon;
let WORKS_ICON_ALL;
before(async () => {
  globalThis.Node = FakeNode;
  globalThis.document = {
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    createTextNode: (t) => new FakeText(t),
  };
  ({ createWorksPanel } = await import('../ui/worksPanel.js'));
  ({ createWorksChooser } = await import('../ui/worksChooser.js'));
  ({ worksIcon, WORKS_ICON_ALL } = await import('../ui/worksIcons.js'));
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

function realm({ gold = 1e6, prosperity = 0, list = [] } = {}) {
  const world = makeWorld();
  const state = makeGame(world, { gold });
  state.owner[1] = PLAYER_FACTION;
  state.prosperity = world.regions.map((r) => (r.id === 1 ? prosperity : 0));
  state.conqueredAt[1] = 0;
  if (list.length) state.works = { 1: list.map((w) => ({ ...w })) };
  return { world, state };
}
const data = (env, now = 60 * 60 * 1000) => works.worksPanelData(env.state, env.world, 1, now);

function panelWith(env, callbacks = {}) {
  const calls = { build: [], upgrade: [], demolish: [], view: [] };
  const panel = createWorksPanel({
    onDemolish: (...a) => { calls.demolish.push(a); callbacks.onDemolish?.(...a); },
    onBuild: (...a) => { calls.build.push(a); callbacks.onBuild?.(...a); },
    onUpgrade: (...a) => { calls.upgrade.push(a); callbacks.onUpgrade?.(...a); },
    onView: (v) => calls.view.push(v),
  });
  panel.update(data(env));
  return { panel, calls };
}

// --- icons -----------------------------------------------------------------------------------------

test('worksIcon: every Work has an icon, plus the build glyph; unknown names fall back to a ring', () => {
  assert.deepEqual(WORKS_ICON_ALL.slice(0, 5), [...WORK_TYPES]);
  for (const name of WORKS_ICON_ALL) {
    const svg = worksIcon(name, 20);
    assert.equal(svg.tagName, 'svg');
    assert.ok(svg.children.length >= 2, `${name} draws several shapes`);
    assert.equal(svg.attributes.width, '20');
    assert.match(svg.attributes.class, new RegExp(`icon-works-${name}`));
    assert.equal(svg.attributes['aria-hidden'], 'true');
  }
  assert.equal(worksIcon('moat', 16).children.length, 1);
});

// --- panel -----------------------------------------------------------------------------------------

test('panel: three slot rows in a fresh region: one empty with Build..., two locked with their unlock level and time', () => {
  const env = realm({ prosperity: 0 });
  const { panel } = panelWith(env);
  const rows = find(panel.el, 'works-slot');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.dataset.state), ['empty', 'locked', 'locked']);
  assert.match(textOf(rows[1]), /Unlocks at Prosperity II/);
  assert.match(textOf(rows[1]), /in 1h 0m/, 'thresholds minus tenure: 2 h - 1 h');
  assert.match(textOf(rows[2]), /Unlocks at Prosperity III/);
  const build = one(rows[0], 'works-build');
  assert.match(textOf(build), /Build/);
  assert.equal(panel.view, 'slots');
  assert.equal(panel.el.dataset.view, 'slots');
});

test('panel: a built Work shows its name, level pips, effect and an Upgrade button with the price', () => {
  const env = realm({ prosperity: 1, list: [{ type: 'barracks', level: 2 }] });
  const { panel } = panelWith(env);
  const row = find(panel.el, 'works-slot')[0];
  assert.equal(row.dataset.state, 'built');
  assert.equal(textOf(one(row, 'works-slot-name')), 'Barracks');
  assert.equal(textOf(one(row, 'works-slot-effect')), works.workEffectText('barracks', 2));
  assert.deepEqual(find(row, 'works-pip').map((p) => p.dataset.on), ['1', '1', '0']);
  const btn = one(row, 'works-upgrade');
  assert.equal(btn.disabled, false);
  assert.match(textOf(btn), /Upgrade/);
  assert.match(textOf(btn), new RegExp(String(works.workCost(env.state, env.world, 1, 'barracks', 3)).replace(/(\d)(?=(\d{3})+$)/g, '$1')));
  assert.equal(one(row, 'works-slot-line').children.length, 3, 'name, pips, and the ... (Demolish) button');
});

test('panel: the Upgrade button is disabled when poor (price kept, reason in the tooltip) and reads "Maxed" at level III', () => {
  const poor = realm({ gold: 1, prosperity: 1, list: [{ type: 'stables', level: 1 }] });
  const a = panelWith(poor).panel;
  const btn = one(find(a.el, 'works-slot')[0], 'works-upgrade');
  assert.equal(btn.disabled, true);
  assert.equal(btn.dataset.poor, '1');
  assert.match(btn.title, /Need \d+ more gold/);
  assert.match(btn.attributes['aria-label'], /Need \d+ more gold/);

  const maxed = realm({ prosperity: 1, list: [{ type: 'shrine', level: 3 }] });
  const b = panelWith(maxed).panel;
  const mbtn = one(find(b.el, 'works-slot')[0], 'works-upgrade');
  assert.equal(mbtn.disabled, true);
  assert.equal(mbtn.dataset.maxed, '1');
  assert.match(textOf(mbtn), /Maxed/);
  assert.deepEqual(find(find(b.el, 'works-slot')[0], 'works-pip').map((p) => p.dataset.on), ['1', '1', '1']);
});

test('panel: Upgrade reports (regionId, slot); a disabled one reports nothing', () => {
  const env = realm({ prosperity: 3, list: [{ type: 'barracks', level: 1 }, { type: 'market', level: 1 }] });
  const { panel, calls } = panelWith(env);
  const rows = find(panel.el, 'works-slot');
  one(rows[1], 'works-upgrade').click();
  assert.deepEqual(calls.upgrade, [[1, 1]]);
  env.state.gold = 0;
  panel.update(data(env));
  one(rows[0], 'works-upgrade').click();
  assert.equal(calls.upgrade.length, 1, 'a disabled button does not fire');
});

test('panel: Build... swaps the list for the chooser; picking reports (regionId, slot, type); Back and Escape return', () => {
  const env = realm({ prosperity: 2, list: [{ type: 'barracks', level: 1 }] });
  const { panel, calls } = panelWith(env);
  const rows = find(panel.el, 'works-slot');
  assert.equal(rows[1].dataset.state, 'empty');
  one(rows[1], 'works-build').click();
  assert.equal(panel.view, 'choose');
  assert.equal(panel.el.dataset.view, 'choose');
  assert.equal(one(panel.el, 'works-slots').hidden, true);
  assert.equal(one(panel.el, 'works-choose').hidden, false);
  assert.equal(one(panel.el, 'works-back').hidden, false);
  assert.match(textOf(one(panel.el, 'works-title')), /Build a Work/);
  assert.deepEqual(calls.view, ['choose']);

  const choiceRows = find(panel.el, 'works-choice');
  assert.equal(choiceRows.length, 5);
  assert.equal(choiceRows.find((r) => r.dataset.type === 'barracks').disabled, true, 'already built here');
  choiceRows.find((r) => r.dataset.type === 'barracks').click();
  assert.equal(calls.build.length, 0);
  choiceRows.find((r) => r.dataset.type === 'stables').click();
  assert.deepEqual(calls.build, [[1, 1, 'stables']]);

  one(panel.el, 'works-back').click();
  assert.equal(panel.view, 'slots');
  one(rows[1], 'works-build').click();
  assert.equal(panel.view, 'choose');
  panel.el.fire('keydown', { key: 'Escape' });
  assert.equal(panel.view, 'slots');
  panel.el.fire('keydown', { key: 'Escape' });
  assert.deepEqual(calls.view, ['choose', 'slots', 'choose', 'slots']);
});

test('panel: when the build lands the slot is no longer empty and the panel goes back to the list by itself', () => {
  const env = realm({ prosperity: 0 });
  const { panel } = panelWith(env, {
    onBuild: (id, slot, type) => { works.buildWork(env.state, env.world, id, type); panel.update(data(env)); },
  });
  one(find(panel.el, 'works-slot')[0], 'works-build').click();
  assert.equal(panel.view, 'choose');
  find(panel.el, 'works-choice').find((r) => r.dataset.type === 'market').click();
  assert.equal(panel.view, 'slots');
  const row = find(panel.el, 'works-slot')[0];
  assert.equal(row.dataset.state, 'built');
  assert.equal(textOf(one(row, 'works-slot-name')), 'Market');
});

test('panel: switching to another region resets the view; a region you do not own hides the panel', () => {
  const env = realm({ prosperity: 0 });
  const { panel } = panelWith(env);
  one(find(panel.el, 'works-slot')[0], 'works-build').click();
  assert.equal(panel.view, 'choose');
  const other = works.worksPanelData(env.state, env.world, 2, 0);
  panel.update(other);
  assert.equal(panel.view, 'slots');
  assert.equal(panel.el.hidden, true, 'region 2 is not owned');
  panel.update(data(env));
  assert.equal(panel.el.hidden, false);
});

test('panel: the chooser is not offered when no slot is free', () => {
  const env = realm({ prosperity: 0, list: [{ type: 'market', level: 1 }] });
  const { panel } = panelWith(env);
  assert.deepEqual(find(panel.el, 'works-slot').map((r) => r.dataset.state), ['built', 'locked', 'locked']);
  assert.equal(panel.buildButton(), null);
  panel.openChooser(0);
  assert.equal(panel.view, 'slots');
});

test('panel: an update identical to the last touches nothing, and buttons are never recreated', () => {
  const env = realm({ gold: 500, prosperity: 3, list: [{ type: 'barracks', level: 1 }, { type: 'stables', level: 2 }] });
  const { panel } = panelWith(env);
  const buttonsBefore = [...find(panel.el, 'works-upgrade'), ...find(panel.el, 'works-build'), ...find(panel.el, 'works-choice')];
  panel.update(data(env));
  mutations = 0;
  panel.update(data(env));
  assert.equal(mutations, 0, 'a refresh with nothing new writes nothing to the DOM');
  // gold drifting (idle income) only flips affordability: same nodes, at most attribute patches
  env.state.gold = 499;
  panel.update(data(env));
  env.state.gold = 1e6;
  panel.update(data(env));
  const buttonsAfter = [...find(panel.el, 'works-upgrade'), ...find(panel.el, 'works-build'), ...find(panel.el, 'works-choice')];
  assert.equal(buttonsAfter.length, buttonsBefore.length);
  buttonsAfter.forEach((b, i) => assert.equal(b, buttonsBefore[i], 'same button node'));
});

test('panel: cost nodes are rebuilt only when the price changes (a refresh between pointerdown and pointerup must not swallow the tap)', () => {
  const env = realm({ prosperity: 1, list: [{ type: 'shrine', level: 1 }] });
  const { panel } = panelWith(env);
  const cost = one(find(panel.el, 'works-slot')[0], 'works-btn-cost');
  const inner = cost.children[0];
  env.state.gold -= 5;
  panel.update(data(env));
  assert.equal(cost.children[0], inner, 'unchanged price keeps its nodes');
});

test('panel: pointers for the coach exist only while their target is on screen', () => {
  const env = realm({ prosperity: 2, list: [{ type: 'barracks', level: 1 }] });
  const { panel } = panelWith(env);
  assert.equal(panel.buildButton(), find(panel.el, 'works-build')[1], 'the first EMPTY slot (index 1)');
  assert.equal(panel.upgradeButton(0), find(panel.el, 'works-upgrade')[0]);
  assert.equal(panel.upgradeButton(1), null, 'an empty slot has no upgrade');
  assert.equal(panel.chooserRow('stables'), null, 'the chooser is closed');
  panel.openChooser(1);
  assert.equal(panel.buildButton(), null, 'hidden behind the chooser');
  assert.equal(panel.chooserRow('stables'), find(panel.el, 'works-choice').find((r) => r.dataset.type === 'stables'));
  assert.equal(panel.chooserRow('moat'), null);
});

// --- demolish ---------------------------------------------------------------------------------------

function builtEnv() {
  return realm({ prosperity: 3, list: [{ type: 'barracks', level: 3 }, { type: 'market', level: 1 }] });
}

test('demolish: a built row has a small "..." and nothing else can be demolished', () => {
  const env = builtEnv();
  const { panel } = panelWith(env);
  const rows = find(panel.el, 'works-slot');
  assert.equal(rows.filter((r) => one(r, 'works-more')).length, 3, 'the button exists on every row but is only shown on built ones by CSS');
  assert.equal(panel.demolishButton(0), one(rows[0], 'works-more'));
  assert.equal(panel.demolishButton(2), null, 'slot 2 is empty');
  assert.match(one(rows[0], 'works-more').attributes['aria-label'], /^Demolish Barracks, refund [0-9.,KM]+ gold$/);
  panel.askDemolish(2);
  assert.equal(panel.confirming, -1, 'asking about an empty slot does nothing');
});

test('demolish: the "..." turns the row into a confirm step; Keep cancels without calling back', () => {
  const env = builtEnv();
  const { panel, calls } = panelWith(env);
  const rows = find(panel.el, 'works-slot');
  one(rows[0], 'works-more').click();
  assert.equal(panel.confirming, 0);
  assert.equal(rows[0].dataset.confirm, '1');
  assert.equal(rows[1].dataset.confirm, '0', 'only that row');
  const refund = works.demolishRefundFor(env.state, env.world, 1, 0);
  assert.equal(textOf(one(rows[0], 'works-confirm-text')), `Demolish Barracks? Refund ${refund} gold`);
  assert.equal(calls.demolish.length, 0, 'one tap destroys nothing');
  one(rows[0], 'works-keep').click();
  assert.equal(panel.confirming, -1);
  assert.equal(rows[0].dataset.confirm, '0');
  assert.equal(calls.demolish.length, 0);
});

test('demolish: confirming reports (regionId, slot) once and clears the prompt', () => {
  const env = builtEnv();
  const { panel, calls } = panelWith(env, {
    onDemolish: (id, slot) => { works.demolishWork(env.state, env.world, id, slot); panel.update(data(env)); },
  });
  const rows = find(panel.el, 'works-slot');
  one(rows[0], 'works-more').click();
  one(rows[0], 'works-demolish').click();
  assert.deepEqual(calls.demolish, [[1, 0]]);
  assert.equal(panel.confirming, -1);
  assert.equal(rows[0].dataset.confirm, '0');
  // the Works closed up: the market moved to slot 0 and there is a free slot again
  assert.deepEqual(rows.map((r) => r.dataset.state), ['built', 'empty', 'empty']);
  assert.equal(textOf(one(rows[0], 'works-slot-name')), 'Market');
});

test('demolish: Escape cancels the prompt first (the view stays), the chooser second', () => {
  const env = realm({ prosperity: 3, list: [{ type: 'barracks', level: 1 }] });
  const { panel } = panelWith(env);
  one(find(panel.el, 'works-slot')[0], 'works-more').click();
  panel.el.fire('keydown', { key: 'Escape' });
  assert.equal(panel.confirming, -1);
  assert.equal(panel.view, 'slots');
  one(find(panel.el, 'works-slot')[1], 'works-build').click();
  assert.equal(panel.view, 'choose');
  panel.el.fire('keydown', { key: 'Escape' });
  assert.equal(panel.view, 'slots');
});

test('demolish: the prompt goes away when the chooser opens, the region changes, or its Work is gone', () => {
  const env = builtEnv();
  const { panel } = panelWith(env);
  const rows = find(panel.el, 'works-slot');
  one(rows[0], 'works-more').click();
  panel.openChooser(2);
  assert.equal(panel.confirming, -1, 'chooser opened');
  panel.closeChooser();

  one(rows[0], 'works-more').click();
  panel.update(works.worksPanelData(env.state, env.world, 2, 0));
  assert.equal(panel.confirming, -1, 'another region');
  panel.update(data(env));

  one(rows[0], 'works-more').click();
  works.demolishWork(env.state, env.world, 1, 0);
  panel.update(data(env));
  works.demolishWork(env.state, env.world, 1, 0);
  panel.update(data(env));
  assert.equal(panel.confirming, -1, 'the Work vanished');
});

test('demolish: an unanswered prompt cancels itself after a few seconds', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const env = builtEnv();
    const { panel } = panelWith(env);
    one(find(panel.el, 'works-slot')[0], 'works-more').click();
    assert.equal(panel.confirming, 0);
    mock.timers.tick(5000);
    assert.equal(panel.confirming, 0, 'still waiting');
    mock.timers.tick(1500);
    assert.equal(panel.confirming, -1, 'gave up');
    one(find(panel.el, 'works-slot')[0], 'works-more').click();
    panel.destroy();
    mock.timers.tick(10000); // destroy cleared the timer: nothing throws
  } finally {
    mock.timers.reset();
  }
});

test('demolish: a refresh while the prompt is open touches nothing and keeps the prompt', () => {
  const env = builtEnv();
  const { panel } = panelWith(env);
  one(find(panel.el, 'works-slot')[0], 'works-more').click();
  panel.update(data(env));
  mutations = 0;
  panel.update(data(env));
  assert.equal(mutations, 0);
  assert.equal(panel.confirming, 0);
});

// --- chooser ---------------------------------------------------------------------------------------

test('chooser: five rows in Work order with icon, name, effect, price; the Market alone is tagged "here"', () => {
  const env = realm({ prosperity: 0 });
  const chooser = createWorksChooser({});
  chooser.update(data(env));
  // worksPanelData nests choices; the chooser takes { choices, intro }
  chooser.update({ choices: data(env).choices, intro: data(env).intro });
  const rows = find(chooser.el, 'works-choice');
  assert.deepEqual(rows.map((r) => r.dataset.type), [...WORK_TYPES]);
  const scopes = rows.map((r) => ({ type: r.dataset.type, hidden: one(r, 'works-scope').hidden }));
  assert.deepEqual(scopes.filter((s) => !s.hidden).map((s) => s.type), ['market']);
  assert.match(textOf(chooser.el), /Next door = regions that border this one/);
  for (const r of rows) {
    assert.ok(one(r, 'works-chip').children.length === 1, 'icon');
    assert.ok(textOf(one(r, 'works-choice-name')).length > 3);
    assert.ok(textOf(one(r, 'works-choice-effect')).length > 6);
    assert.match(textOf(one(r, 'works-choice-price')), /\d/);
  }
});

test('chooser: disabled rows say why: a gold shortfall under the price, "Already built here" on its own line', () => {
  const env = realm({ gold: 10, prosperity: 2, list: [{ type: 'shrine', level: 1 }] });
  const chooser = createWorksChooser({});
  const d = data(env);
  chooser.update({ choices: d.choices, intro: d.intro });
  const byType = (t) => find(chooser.el, 'works-choice').find((r) => r.dataset.type === t);
  const stables = byType('stables');
  assert.equal(stables.disabled, true);
  assert.equal(stables.dataset.state, 'poor');
  const need = d.choices.find((c) => c.type === 'stables').missing;
  assert.ok(need > 0);
  assert.equal(textOf(one(stables, 'works-choice-missing')), `need ${need} more`);
  assert.equal(one(stables, 'works-choice-missing').hidden, false);
  assert.equal(one(stables, 'works-choice-reason').hidden, true, 'the shortfall is not said twice');
  assert.match(stables.title, /Need \d+ more gold/);
  const shrine = byType('shrine');
  assert.equal(shrine.disabled, true);
  assert.equal(shrine.dataset.state, 'built');
  assert.equal(textOf(one(shrine, 'works-choice-reason')), 'Already built here');
  assert.equal(one(shrine, 'works-choice-reason').hidden, false);
  assert.equal(one(shrine, 'works-choice-missing').hidden, true);
});

test('chooser: a ready row is enabled, tappable, and reports its type', () => {
  const env = realm({ prosperity: 0 });
  const picks = [];
  const chooser = createWorksChooser({ onPick: (t) => picks.push(t) });
  const d = data(env);
  chooser.update({ choices: d.choices, intro: d.intro });
  const row = chooser.row('watchtower');
  assert.ok(row);
  assert.equal(row.disabled, false);
  assert.equal(row.dataset.state, 'ready');
  row.click();
  assert.deepEqual(picks, ['watchtower']);
});

// --- structure -----------------------------------------------------------------------------------

function sourceOf(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8');
}
const code = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');

test('UI purity: worksPanel, worksChooser and worksIcons import only dom, icons, format and each other', () => {
  for (const f of ['worksPanel', 'worksChooser', 'worksIcons']) {
    const src = sourceOf(`../ui/${f}.js`);
    const imports = [...src.matchAll(/^import .* from '(.+)';$/gm)].map((m) => m[1]);
    for (const spec of imports) {
      assert.ok(['./dom.js', './icons.js', './format.js', './worksIcons.js', './worksChooser.js'].includes(spec), `${f} imports ${spec}`);
    }
  }
});

test('UI copy: no bonus percentage is ever typed into the Works UI (effect text comes from config)', () => {
  for (const f of ['worksPanel', 'worksChooser', 'worksIcons']) {
    const src = code(sourceOf(`../ui/${f}.js`));
    assert.ok(!/['"`][^'"`\n]*[+−-]\d+(?:\.\d+)?\s?%/.test(src), `${f} types a percentage`);
    assert.ok(!/\b(?:crownBonusPct|bonusPct)\s*:\s*\d/.test(src), `${f} has a literal bonusPct`);
  }
});

test('CSS: works.css honours Reduce Motion and keeps the phone rules', () => {
  const css = sourceOf('../styles/components/works.css');
  assert.match(css, /html\.reduce-motion/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /pointer: coarse/);
});
