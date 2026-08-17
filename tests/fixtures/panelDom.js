// The thin fake document the site-panel suites are built on, plus the battle
// fixture and the real panel wiring they both mount.
//
// Kept here for the same reason tests/fixtures/terrainGround.js is: two files
// (sitepanel.test.js and panelbars.test.js) stand up the SAME panel over the
// same board, and two copies of a DOM shim drift into two subtly different
// documents — at which point a test proves something about its own stub.
//
// The import ORDER is the load-bearing part. `ui/dom.js` reads `document` at
// call time, but the shims still have to be installed before any module that
// touches the DOM at import time is evaluated. Doing the shimming and the
// dynamic imports together in one module is what makes that ordering a
// property of the harness rather than a comment every consumer has to honour.

// Imported and re-exported rather than `export ... from`: a re-export does not
// bind the name in THIS module's scope, and the next helper added here that
// needs it would fail on a line that looks exactly like it should work.
import { UNIT_IDS } from '../../src/content/balance.js';

export { UNIT_IDS };

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
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
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
export const { createBattleState } = await import('../../src/battle/state.js');
export const { drainCommands } = await import('../../src/battle/commands.js');
export const { step } = await import('../../src/battle/sim.js');
export const { makeMods, CONTRACT_VERSION } = await import('../../src/battle/contract.js');
export const { emptyComp, total } = await import('../../src/battle/combat.js');
export const { RALLY_KEEP, UNITS } = await import('../../src/content/balance.js');
export const { createSitePanel } = await import('../../src/screens/battle-panel.js');
export const { createOrders } = await import('../../src/screens/battle-orders.js');
export const { createView } = await import('../../src/screens/battle-input.js');

export const at = (state, id) => state.sites.find((s) => s.id === id);

export function fixture() {
  return createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: 'panel',
    seed: 1,
    grid: { cols: 11, rows: 9, blocked: [] },
    sites: [
      { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 4 }, hp: 600, hpMax: 600 },
      { id: 'f1', kind: 'farm', hex: [1, 0], owner: 'player', garrison: {}, hp: 100, hpMax: 100 },
      { id: 'hold', kind: 'trainingGround', hex: [2, 0], owner: 'player', garrison: {}, hp: 180, hpMax: 180 },
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
export function mountPanel(state) {
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

export const select = (view, id) => { view.selection.length = 0; view.selection.push(id); };

