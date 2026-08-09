// "What will upgrading actually change" — split out of sitepanel.test.js
// purely for the line cap, since this feature earned its own DOM section
// there and pushed that file over 400 lines.
//
// Same discipline as its sibling: a thin fake document, the REAL
// createSitePanel(), its REAL update() — so a bubble row that renders once and
// then silently stops updating cannot ship behind a green suite the way three
// of the four bubble updaters already did (see the last test in this file).
import test from 'node:test';
import assert from 'node:assert/strict';

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
  fire(type) { for (const fn of this.handlers[type] ?? []) fn({ type }); }
  append(...nodes) { for (const n of nodes) { n.parentNode = this; this.kids.push(n); } }
  removeChild(n) { n.remove(); }
  get firstChild() { return this.kids[0] ?? null; }

  remove() {
    const p = this.parentNode;
    if (p) p.kids.splice(p.kids.indexOf(this), 1);
    this.parentNode = null;
  }

  find(cls) {
    if (this.classList.contains(cls)) return this;
    for (const k of this.kids) {
      const hit = k instanceof FakeEl ? k.find(cls) : null;
      if (hit) return hit;
    }
    return null;
  }

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

// Imported AFTER the shims: ui/dom.js reads `document` at call time.
const { createBattleState } = await import('../src/battle/state.js');
const { makeMods, CONTRACT_VERSION } = await import('../src/battle/contract.js');
const { emptyComp } = await import('../src/battle/combat.js');
const { createSitePanel } = await import('../src/screens/battle-panel.js');
const { createOrders } = await import('../src/screens/battle-orders.js');
const { createView } = await import('../src/screens/battle-input.js');

const at = (state, id) => state.sites.find((s) => s.id === id);

function fixture() {
  return createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: 'upgpreview',
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
  const input = { upgrade: (id) => ord.push({ t: 'UPGRADE', site: id }) };
  const panel = createSitePanel({ getState: () => state, view, input });
  return { panel, view };
}

const select = (view, id) => { view.selection.length = 0; view.selection.push(id); };

// ---------------------------------------------------------------------------
// Upgrade preview: "what will the next level actually change"
// ---------------------------------------------------------------------------

test('the upgrade preview bubbles render for a player site with a level left to buy', () => {
  const s = fixture();
  const { panel, view } = mountPanel(s);
  select(view, 'hold'); // stronghold, L1, does not earn gold
  panel.update(s);

  const labels = panel.el.find('hud-upgrade-preview').findAll('chip-name').map((c) => c.textContent);
  assert.ok(labels.some((t) => t.startsWith('HP +')), `no HP bubble in ${labels}`);
  assert.ok(labels.some((t) => t.startsWith('REGEN +')), `no REGEN bubble in ${labels}`);
  assert.ok(labels.some((t) => t.startsWith('CAP +')), `no CAP bubble in ${labels}`);
  assert.ok(labels.some((t) => t.startsWith('TRAIN +')), `no TRAIN bubble in ${labels}`);
  assert.ok(!labels.some((t) => t.startsWith('GOLD')), 'a stronghold has nothing to preview for gold');
});

test('the upgrade preview disappears at max level — nothing left to buy, nothing to promise', () => {
  const s = fixture();
  const { panel, view } = mountPanel(s);
  const hold = at(s, 'hold');
  select(view, 'hold');
  panel.update(s);
  assert.ok(panel.el.find('hud-upgrade-preview').findAll('chip-name').length > 0);

  hold.level = 5; // the top rung of the current ladder
  panel.update(s);
  assert.equal(panel.el.find('hud-upgrade-preview').findAll('chip-name').length, 0);
});

test('the upgrade preview never shows for a site you do not own', () => {
  const s = fixture();
  const { panel, view } = mountPanel(s);
  select(view, 'cas'); // enemy-owned in this fixture
  panel.update(s);
  assert.equal(panel.el.find('hud-upgrade-preview').findAll('chip-name').length, 0);
});

// ---------------------------------------------------------------------------
// A bubble row that changes shape must mark the panel dirty, or a stale box
// stays anchored at its OLD size while its content has already grown — the
// exact bug hiding in three of the four bubble updaters until this file's
// preview row exposed it: none of them returned renderBubbles()'s own boolean,
// so `wrote |= updateXBubbles(...)` was silently OR-ing in `undefined` — which
// a bitwise OR treats as 0 — and a bubble row appearing for the first time
// never counted as a reason to re-anchor.
// ---------------------------------------------------------------------------

test('every bubble updater reports whether it actually changed anything', async () => {
  const { h } = await import('../src/ui/dom.js');
  const {
    updateEconBubbles, updateTerrainBubbles, updateUnitStatBubbles,
    updateUpgradePreviewBubbles,
  } = await import('../src/screens/battle-bubbles.js');

  const host = () => h('div.test-host', {});

  const econHost = host();
  assert.equal(updateEconBubbles(econHost, { gold: 4, spend: 0, net: 4 }), true,
    'first render with real content must report a change');
  assert.equal(updateEconBubbles(econHost, { gold: 4, spend: 0, net: 4 }), false,
    'an identical re-render must report NO change');

  const terrainHost = host();
  const intel = { ground: { highland: 0, river: false }, defMult: 1, riverFarm: false };
  // Open ground renders NO bubbles — but on a brand-new host that is still a
  // real change (untouched -> known-empty), which is why renderBubbles()
  // diffs against `host.dataset.sig` rather than against "is the list empty".
  assert.equal(updateTerrainBubbles(terrainHost, intel), true,
    'establishing "nothing to show" for the first time is still a change');
  assert.equal(updateTerrainBubbles(terrainHost, intel), false,
    'the SECOND identical empty render is the one that must report no change');

  const unitHost = host();
  assert.equal(updateUnitStatBubbles(unitHost, 'militia'), true);
  assert.equal(updateUnitStatBubbles(unitHost, 'militia'), false);

  const upgradeHost = host();
  const preview = {
    earns: false, trains: true,
    hp: { cur: 250, next: 350 }, regen: { cur: 4, next: 5.6 },
    cap: { cur: 0, next: 20 }, trainMult: { cur: 1, next: 1.35 },
  };
  assert.equal(updateUpgradePreviewBubbles(upgradeHost, preview), true);
  assert.equal(updateUpgradePreviewBubbles(upgradeHost, preview), false);
  assert.equal(updateUpgradePreviewBubbles(upgradeHost, null), true,
    'clearing a row that had content is itself a change');
});
