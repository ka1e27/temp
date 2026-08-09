// The site panel as DOM: does it actually RENDER the numbers, and do its
// buttons actually FIRE?
//
// siteintel.test.js proves the maths agrees with the simulation and
// rallykeep.test.js proves the orders land, but both stop short of the element
// tree — and "a control that looks fine and does nothing" is this project's
// signature bug. So this file stands up a thin fake document, builds the real
// createSitePanel(), runs its real update(), reads the text a player would
// read, and dispatches the click listener the button really registered.
//
// It does NOT test hit testing — a fake DOM cannot. That is tools/smoke.mjs's
// job, and it dispatches real pointer events at real coordinates for exactly
// this reason. What this file catches is the other half: a panel that throws on
// construction, a row that is never populated, or a handler that is never wired.
import test from 'node:test';
import assert from 'node:assert/strict';

import { UNIT_IDS } from '../src/content/balance.js';

class FakeNode {}
globalThis.Node = FakeNode;                    // ui/dom.js tests `c instanceof Node`

class FakeEl extends FakeNode {
  constructor(tag) {
    super();
    this.tagName = String(tag).toUpperCase();
    this.kids = [];
    this.parentNode = null;
    this.attrs = {};
    this.dataset = {};
    this.handlers = {};
    this.style = { setProperty(k, v) { this[k] = v; } };
    this.own = '';
    const classes = new Set();
    this.classList = {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
    };
  }

  get textContent() {
    return this.own + this.kids.map((k) => k.textContent).join('');
  }

  set textContent(v) { this.kids.length = 0; this.own = String(v); }

  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(type, fn) { (this.handlers[type] ??= []).push(fn); }
  /** The listener the element really registered — not a synthetic .click(). */
  fire(type) { for (const fn of this.handlers[type] ?? []) fn({ type }); }
  append(...nodes) { for (const n of nodes) { n.parentNode = this; this.kids.push(n); } }
  removeChild(n) { n.remove(); }
  get firstChild() { return this.kids[0] ?? null; }

  remove() {
    const p = this.parentNode;
    if (p) p.kids.splice(p.kids.indexOf(this), 1);
    this.parentNode = null;
  }

  /** First descendant carrying `cls`. */
  find(cls) {
    if (this.classList.contains(cls)) return this;
    for (const k of this.kids) {
      const hit = k instanceof FakeEl ? k.find(cls) : null;
      if (hit) return hit;
    }
    return null;
  }

  /** Every descendant carrying `cls`, in document order. */
  findAll(cls, out = []) {
    if (this.classList.contains(cls)) out.push(this);
    for (const k of this.kids) if (k instanceof FakeEl) k.findAll(cls, out);
    return out;
  }
}

class FakeText extends FakeNode {
  constructor(text) { super(); this.own = String(text); this.parentNode = null; }
  get textContent() { return this.own; }
  remove() {
    const p = this.parentNode;
    if (p) p.kids.splice(p.kids.indexOf(this), 1);
  }
}

globalThis.document = {
  createElement: (tag) => new FakeEl(tag),
  createTextNode: (t) => new FakeText(t),
};

// Imported AFTER the shims: ui/dom.js reads `document` at call time, but
// keeping the order explicit is what stops a future refactor breaking it.
const { createBattleState } = await import('../src/battle/state.js');
const { drainCommands } = await import('../src/battle/commands.js');
const { step } = await import('../src/battle/sim.js');
const { makeMods, CONTRACT_VERSION } = await import('../src/battle/contract.js');
const { emptyComp, total } = await import('../src/battle/combat.js');
const { RALLY_KEEP, UNITS } = await import('../src/content/balance.js');
const { createSitePanel } = await import('../src/screens/battle-panel.js');
const { createOrders } = await import('../src/screens/battle-orders.js');
const { createView } = await import('../src/screens/battle-input.js');

const at = (state, id) => state.sites.find((s) => s.id === id);

function fixture() {
  return createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: 'panel',
    seed: 1,
    grid: { cols: 11, rows: 9, blocked: [] },
    sites: [
      { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 4 }, hp: 600, hpMax: 600 },
      { id: 'f1', kind: 'farm', hex: [1, 0], owner: 'player', garrison: {}, hp: 100, hpMax: 100 },
      { id: 'hold', kind: 'stronghold', hex: [2, 0], owner: 'player', garrison: {}, hp: 250, hpMax: 250 },
      { id: 'cas', kind: 'castle', hex: [5, 0], owner: 'enemy', garrison: { militia: 6 }, hp: 600, hpMax: 600 },
    ],
    adjacency: [['camp', 'f1'], ['f1', 'hold']],
    player: makeMods({ expedition: emptyComp(), startGold: 5000 }),
    enemy: makeMods({ expedition: emptyComp() }),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 480000, aiTier: 1 },
  });
}

/** The panel wired to the REAL orders module, so a click ends in state.commands. */
function mountPanel(state) {
  const view = createView();
  const board = {
    hexSize: 34,
    sitePos: (s, out) => { out.x = s.hex[0] * 51; out.y = s.hex[1] * 59; return out; },
    siteAt: () => null,
  };
  const ord = createOrders({
    canvas: { classList: { toggle() {} } }, board, view, getState: () => state, bus: null,
  });
  const input = {
    upgrade: (id) => ord.push({ t: 'UPGRADE', site: id }),
    setRallyKeep: (id, keep) => ord.issueRallyKeep(id, keep),
  };
  const panel = createSitePanel({ getState: () => state, view, input });
  return { panel, view, ord };
}

const select = (view, id) => { view.selection.length = 0; view.selection.push(id); };

// ---------------------------------------------------------------------------

/** The gold/training/net readout is a row of bubbles now (see
 *  battle-bubbles.js) — one `.chip-name` per fact — rather than one
 *  concatenated sentence. Read them back as a list so the assertion still
 *  pins down the exact numbers a player would read. */
const moneyBubbles = (panel) =>
  panel.el.find('hud-site-money').findAll('chip-name').map((c) => c.textContent);

test('the panel renders the economics of the selected site', () => {
  const s = fixture();
  const { panel, view } = mountPanel(s);

  select(view, 'camp');
  panel.update(s);
  assert.equal(panel.el.find('hud-selection-title').textContent, 'CAMP · L1');
  assert.deepEqual(moneyBubbles(panel), ['GOLD +4.0/s', 'TRAIN -3.8/s', 'NET +0.3/s']);
  assert.equal(panel.el.find('hud-site-train').textContent,
    'militia x2 every 6.4s · 0.31/s');

  select(view, 'f1');
  panel.update(s);
  assert.deepEqual(moneyBubbles(panel), ['GOLD +2.0/s']);
  assert.equal(panel.el.find('hud-site-train').textContent, '', 'a farm trains nothing');

  select(view, 'hold');
  panel.update(s);
  assert.deepEqual(moneyBubbles(panel), ['TRAIN -3.0/s']);
  assert.equal(panel.el.find('hud-site-train').textContent, 'militia x2 every 8s · 0.25/s');
});

test('a site that costs more than it earns is marked as draining', () => {
  const s = fixture();
  const { panel, view } = mountPanel(s);
  select(view, 'hold');
  panel.update(s);
  const money = panel.el.find('hud-site-money');
  assert.equal(money.classList.contains('is-drain'), true);

  select(view, 'f1');                       // a farm only earns
  panel.update(s);
  assert.equal(panel.el.find('hud-site-money').classList.contains('is-drain'), false);
});

test('the rally row appears only on a site that HAS a rally', () => {
  const s = fixture();
  const { panel, view } = mountPanel(s);
  const camp = at(s, 'camp');

  select(view, 'camp');
  panel.update(s);
  assert.equal(panel.el.find('hud-keep').classList.contains('is-open'), false);

  camp.rallyTargets = ['f1'];
  panel.update(s);
  const row = panel.el.find('hud-keep');
  assert.equal(row.classList.contains('is-open'), true);
  assert.equal(row.find('keep-value').textContent, `keeps ${RALLY_KEEP.default}`);
});

test('dragging the rally slider moves the SIMULATION, not just the label', () => {
  const s = fixture();
  const { panel, view } = mountPanel(s);
  const camp = at(s, 'camp');
  camp.garrison = { ...emptyComp(), militia: 30 };
  camp.rallyTargets = ['f1'];
  select(view, 'camp');
  panel.update(s);

  const slider = panel.el.find('hud-keep').find('keep-slider');
  slider.value = `${RALLY_KEEP.default + RALLY_KEEP.step}`;
  slider.fire('input');
  assert.equal(s.commands.length, 1, 'the drag queued exactly one order');
  assert.equal(camp.rallyKeep, RALLY_KEEP.default, 'and did NOT touch the site itself');

  step(s);
  assert.equal(camp.rallyKeep, RALLY_KEEP.default + RALLY_KEEP.step);
  assert.equal(total(camp.garrison), RALLY_KEEP.default + RALLY_KEEP.step,
    'the rally really held that many back');
  panel.update(s);
  assert.equal(panel.el.find('keep-value').textContent,
    `keeps ${RALLY_KEEP.default + RALLY_KEEP.step}`);

  slider.value = '0';
  slider.fire('input');
  step(s);
  assert.equal(camp.rallyKeep, 0);
});

test('the rally slider spans the whole legal band and clamps past its ends', () => {
  // A slider cannot "disable" its ends the way a stepper did, so the guarantee
  // moved: the control ADVERTISES the band, and anything outside it is clamped
  // by the sim rather than refused. Both halves are checked here because a
  // mis-advertised range is a control that silently cannot reach a legal value.
  const s = fixture();
  const { panel, view } = mountPanel(s);
  const camp = at(s, 'camp');
  camp.rallyTargets = ['f1'];
  select(view, 'camp');
  panel.update(s);

  const slider = panel.el.find('hud-keep').find('keep-slider');
  assert.equal(slider.attrs.min, `${RALLY_KEEP.min}`);
  assert.equal(slider.attrs.max, `${RALLY_KEEP.max}`);
  assert.equal(slider.attrs.step, `${RALLY_KEEP.step}`);

  slider.value = `${RALLY_KEEP.max + 100}`;
  slider.fire('input');
  step(s);
  assert.equal(camp.rallyKeep, RALLY_KEEP.max, 'over the top is clamped, not refused');

  slider.value = '-5';
  slider.fire('input');
  step(s);
  assert.equal(camp.rallyKeep, RALLY_KEEP.min);
});

test('the Upgrade button still reaches the simulation', () => {
  const s = fixture();
  const { panel, view } = mountPanel(s);
  select(view, 'f1');
  panel.update(s);
  const before = at(s, 'f1').level;
  panel.el.find('hud-upgrade').fire('click');
  drainCommands(s);
  assert.equal(at(s, 'f1').level, before + 1);
});

// ---------------------------------------------------------------------------
// Bars: HP, troop composition, training progress
// ---------------------------------------------------------------------------

test('the HP bar fraction and label come straight off site.hp/hpMax', () => {
  const s = fixture();
  const { panel, view } = mountPanel(s);
  const camp = at(s, 'camp');
  camp.hp = 300;
  camp.hpMax = 600;
  select(view, 'camp');
  panel.update(s);

  const bar = panel.el.find('bar-hp');
  assert.equal(bar.classList.contains('is-open'), true);
  assert.equal(bar.find('bar-fill').style.width, '50%');
  assert.equal(bar.find('bar-label').textContent, '300/600');
});

test('the troop composition bar is stacked in proportion, with the total on it', () => {
  const s = fixture();
  const { panel, view } = mountPanel(s);
  const camp = at(s, 'camp');
  camp.garrison = { militia: 3, spearmen: 1 };
  select(view, 'camp');
  panel.update(s);

  const bar = panel.el.find('bar-comp');
  const segs = bar.findAll('bar-comp-seg');
  assert.equal(segs.length, UNIT_IDS.length, 'one fixed segment per unit type, in UNIT_IDS order');
  assert.equal(segs[0].style.width, '75%', 'militia: 3 of 4');
  assert.equal(segs[1].style.width, '25%', 'spearmen: 1 of 4');
  assert.equal(segs[2].style.width, '0%', 'raiders: none present');
  assert.equal(bar.find('bar-label').textContent, '4');
});

test('the training bar reads site.trainProgress directly, clamped to a fraction', () => {
  const s = fixture();
  const { panel, view } = mountPanel(s);
  const hold = at(s, 'hold');
  hold.trainProgress = 0.5;
  select(view, 'hold');
  panel.update(s);

  const bar = panel.el.find('bar-train');
  assert.equal(bar.classList.contains('is-open'), true);
  assert.equal(bar.find('bar-fill').style.width, '50%');

  hold.trainProgress = 1; // a finished batch waiting for room can sit at exactly 1
  panel.update(s);
  assert.equal(bar.find('bar-fill').style.width, '100%');

  select(view, 'f1');     // a farm cannot train — the bar disappears, not stalls
  panel.update(s);
  assert.equal(panel.el.find('bar-train').classList.contains('is-open'), false);
});

test('the currently-training unit gets its real atk/def bubbles, from balance.js', () => {
  const s = fixture();
  const { panel, view } = mountPanel(s);
  select(view, 'camp'); // trains militia by default
  panel.update(s);
  const stats = panel.el.find('hud-site-unit-stats').findAll('chip-name').map((c) => c.textContent);
  assert.deepEqual(stats, [`ATK ${UNITS.militia.atk}`, `TOUGH ${UNITS.militia.def}`]);
});

// ---------------------------------------------------------------------------
// Siege escalation: the whole panel reads danger, not just one line
// ---------------------------------------------------------------------------

test('a hostile siege turns the whole panel, not just the status line', () => {
  const s = fixture();
  const { panel, view } = mountPanel(s);
  const camp = at(s, 'camp');
  select(view, 'camp');
  panel.update(s);
  assert.equal(panel.el.classList.contains('is-siege'), false);
  assert.equal(panel.el.find('hud-site-stat').classList.contains('is-warn'), false);

  camp.siege = { owner: 'enemy', comp: { militia: 5 } };
  panel.update(s);
  assert.equal(panel.el.classList.contains('is-siege'), true);
  assert.equal(panel.el.find('hud-site-stat').classList.contains('is-warn'), true);
  assert.match(panel.el.find('hud-site-stat').textContent, /UNDER SIEGE/);
});
