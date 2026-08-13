// THE LAST SURFACE THAT LEAKED: the DOM.
//
// fogleaks.test.js closed the effect layer, a rally line's far end, and squad
// hit-testing on the BOARD. This file is the two surfaces that sit beside the
// canvas and used to keep narrating regardless: the site panel (click a ghost
// and it told you its garrison, HP, level, training and siege state anyway)
// and the drag/attack preview (an exact combat guarantee against a garrison
// nobody had scouted). Every claim below is paired with a control that fails
// if the rule it pins were simply deleted — the recurring failure mode in this
// repo is a fixture that quietly encodes the bug rather than a test that fails.
import test from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// A thin fake DOM — copied from tests/sitepanel.test.js, same discipline: the
// REAL createSitePanel(), its REAL update(), reading the text a player would
// actually read.
// ---------------------------------------------------------------------------
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
const { startBattle } = await import('../src/battle/sim.js');
const { generateBattleMap } = await import('../src/battle/mapgen.js');
const { buildBattleConfig } = await import('../src/meta/modifiers.js');
const { createState } = await import('../src/core/store.js');
const { markConquered, refreshUnlocks } = await import('../src/meta/world.js');
const { REGIONS } = await import('../src/content/regions.data.js');
const { canSee } = await import('../src/battle/vision.js');
const { total } = await import('../src/battle/combat.js');
const { spaceCase } = await import('../src/ui/format.js');
const { createSitePanel } = await import('../src/screens/battle-panel.js');
const { createView } = await import('../src/screens/battle-input.js');
const { computePreview, previewLine } = await import('../src/screens/battle-preview.js');
const { renderCaveats } = await import('../src/screens/battle-parts.js');

/** A real battle on the real path — the same helper construct/vision use. */
function battleFor(id = 'gallowmoor') {
  const state = createState({ seed: 1, now: 0 });
  const i = REGIONS.findIndex((r) => r.id === id);
  for (const p of REGIONS.slice(0, i)) markConquered(state.meta, p.id, { now: 0, durationMs: 0 });
  refreshUnlocks(state.meta, null);
  const b = startBattle(buildBattleConfig(state.meta, id, [], generateBattleMap, { seed: 5 }));
  b.ai.nextThinkTick = 1e9;
  return b;
}

const unseenEnemy = (b) => b.sites
  .find((s) => s.owner === 'enemy' && !canSee(b, 'player', s.hex[0], s.hex[1]));

function mountPanel(state) {
  const view = createView();
  const input = {
    upgrade() {}, setRallyKeep() {}, recruit() {}, useBuild() {},
  };
  return { panel: createSitePanel({ getState: () => state, view, input }), view };
}

const select = (view, id) => { view.selection.length = 0; view.selection.push(id); };

// ---------------------------------------------------------------------------
// 1. computePreview: nothing for an unscouted target, the guarantee for a
//    visible one
// ---------------------------------------------------------------------------

test('preview: an unscouted target gets sendN and ETA, and nothing that describes a fight', () => {
  const b = battleFor();
  const dark = unseenEnemy(b);
  assert.ok(dark, 'no unseen enemy site — this proves nothing');
  const mine = b.sites.find((s) => s.owner === 'player' && total(s.garrison) > 0);
  assert.ok(mine, 'no player garrison to send — this proves nothing');

  const pv = computePreview(b, mine.id, dark.id, { fraction: 1, travelSeconds: () => 4.2 });
  assert.equal(pv.kind, 'unscouted');
  assert.equal(pv.verdict, 'UNSCOUTED');
  assert.equal(pv.line, 'UNSCOUTED · ETA 4.2s');
  assert.equal(pv.sendN, total(mine.garrison), 'the player still knows what THEY are sending');
  assert.equal(pv.eta, 4.2);

  // Every field a guarantee would need to come off the garrison nobody has
  // seen is left OFF the object entirely — not zeroed, not estimated. A
  // reader who writes `pv.win ? 'WIN' : 'LOSE'` without checking `pv.kind`
  // first is exactly the bug this guards: `undefined` must not read as 0,
  // NaN, or a loss.
  for (const key of ['ap', 'dp', 'win', 'survivors', 'attSurvivors', 'defSurvivors',
    'skirmish', 'hp', 'hpMax', 'breachSec', 'insufficient']) {
    assert.ok(!(key in pv), `an unscouted preview carried "${key}" — that is a garrison nobody has seen`);
  }
});

test('preview: the SAME target, once scouted, gets the real combat guarantee', () => {
  // CONTROL for the test above: without it, "an unscouted target gets no
  // combat numbers" would pass just as happily against a preview that never
  // computes one for ANY enemy site.
  const b = battleFor();
  const dark = unseenEnemy(b);
  assert.ok(dark, 'no unseen enemy site — this proves nothing');
  const mine = b.sites.find((s) => s.owner === 'player' && total(s.garrison) > 0);
  const key = `${dark.hex[0]},${dark.hex[1]}`;
  const lit = { ...b, vision: { ...b.vision, player: { ...b.vision.player, [key]: 1 } } };

  const pv = computePreview(lit, mine.id, dark.id, { fraction: 1, travelSeconds: () => 4.2 });
  assert.notEqual(pv.kind, 'unscouted');
  assert.ok(['assault', 'relieve'].includes(pv.kind), `unexpected kind: ${pv.kind}`);
  assert.ok(Number.isFinite(pv.ap) && pv.ap > 0);
  assert.ok(Number.isFinite(pv.dp));
  assert.equal(typeof pv.win, 'boolean');
  assert.doesNotMatch(pv.line, /UNSCOUTED/);
});

test('preview: pv.win is strictly undefined for an unscouted target — never a false "loss"', () => {
  // battle-hud.js paints `.is-loss` off `pv.win === false` rather than the old
  // `!pv.win`, for exactly this reason: `undefined` must not read as a loss.
  // Pinning the data contract here, since exercising the HUD's own class
  // bindings needs a full canvas/board harness nothing else in this repo
  // stands up either.
  const b = battleFor();
  const dark = unseenEnemy(b);
  const mine = b.sites.find((s) => s.owner === 'player' && total(s.garrison) > 0);
  const pv = computePreview(b, mine.id, dark.id, { fraction: 1, travelSeconds: () => 1 });
  assert.equal(pv.win, undefined);
  assert.notEqual(pv.win, false);
});

test('renderCaveats: an unscouted preview carries no "if unreinforced" claim', () => {
  const host = document.createElement('div');
  renderCaveats(host, { kind: 'unscouted', sendN: 5, eta: 4.2 });
  assert.equal(host.kids.length, 0, 'nothing to be conditional on when nothing is known');

  // CONTROL: the identical shape, but a real assault, DOES carry it —
  // otherwise the assertion above would pass just as happily against a
  // function that dropped the caveat for everyone, which is silence wearing
  // this rule's clothes.
  renderCaveats(host, { kind: 'assault', sendN: 5, eta: 4.2 });
  assert.ok(host.kids.some((k) => k.textContent === 'if unreinforced'));
});

// ---------------------------------------------------------------------------
// 2. The site panel: UNSCOUTED for a ghost, full detail for anything in sight
// ---------------------------------------------------------------------------

test('panel: an unscouted site says UNSCOUTED and shows nothing else', () => {
  const b = battleFor();
  const dark = unseenEnemy(b);
  assert.ok(dark, 'no unseen enemy site — this proves nothing');
  const { panel, view } = mountPanel(b);

  // SEEN ONCE, NOT SEEN NOW — which is what a ghost is, and is no longer the
  // same thing as "not currently visible". A site this faction has NEVER laid
  // eyes on is not on the board or in this panel at all (`siteKnown`, and the
  // negative control at the end of this test), so a fixture that skipped this
  // line would be asserting the ghost branch against a site that never reaches
  // it.
  b.seen.player[dark.id] = 'enemy';
  select(view, dark.id);
  panel.update(b);

  assert.equal(panel.el.find('hud-selection-title').textContent, spaceCase(dark.kind).toUpperCase());
  assert.equal(panel.el.find('hud-selection-sub').textContent, 'UNSCOUTED · last seen: enemy');

  // No leaked number anywhere a player would actually read.
  for (const cls of ['hud-selection-title', 'hud-selection-sub', 'hud-site-train', 'hud-site-stat']) {
    const text = panel.el.find(cls).textContent;
    assert.doesNotMatch(text, /undefined/, `${cls} leaked undefined`);
    assert.doesNotMatch(text, /NaN/, `${cls} leaked NaN`);
  }
  // Every bar closed — a ghost carries none of the fields they read.
  for (const cls of ['bar-hp', 'bar-comp', 'bar-train', 'bar-build']) {
    assert.equal(panel.el.find(cls).classList.contains('is-open'), false, `${cls} was open on a ghost`);
  }
  // Nothing to earn, spend or fight about either.
  assert.equal(panel.el.find('hud-site-money').kids.length, 0);
  assert.equal(panel.el.find('hud-site-terrain').kids.length, 0);
  // No actionable rows — none of these apply to ground you cannot see. Build
  // moved out to its own rail (battle-actions.js `createBuildRail`) and is no
  // longer part of this panel at all, so there is nothing here left to assert
  // shut for it — it was never gated on the selection to begin with.
  assert.equal(panel.el.find('hud-keep').classList.contains('is-open'), false);
  assert.equal(panel.el.find('hud-recruit').classList.contains('is-open'), false);
  assert.equal(panel.el.find('hud-upgrade'), null, 'the Upgrade button is not even mounted');

  // NEGATIVE CONTROL, and it is the new rule rather than a nicety: forget that
  // this site was ever seen and the panel does not open AT ALL. Without it,
  // every assertion above would pass just as happily against the old behaviour,
  // where a building nobody had ever looked at was still fully inspectable by
  // clicking the silhouette the board drew for free.
  delete b.seen.player[dark.id];
  panel.update(b);
  assert.equal(panel.el.classList.contains('is-open'), false,
    'a building this faction has never seen opened a panel — it is not on the board either');
});

test('panel: the SAME site, once scouted, shows full live detail instead of UNSCOUTED', () => {
  // CONTROL for the test above, same shape as the preview's: without this,
  // "a ghost says UNSCOUTED" would pass just as happily against a panel that
  // says UNSCOUTED for every enemy site, scouted or not.
  const b = battleFor();
  const dark = unseenEnemy(b);
  assert.ok(dark, 'no unseen enemy site — this proves nothing');
  const key = `${dark.hex[0]},${dark.hex[1]}`;
  const lit = { ...b, vision: { ...b.vision, player: { ...b.vision.player, [key]: 1 } } };
  const { panel, view } = mountPanel(lit);

  select(view, dark.id);
  panel.update(lit);

  assert.equal(panel.el.find('hud-selection-title').textContent,
    `${spaceCase(dark.kind).toUpperCase()} · L${dark.level}`);
  assert.doesNotMatch(panel.el.find('hud-selection-sub').textContent, /UNSCOUTED/);
  const hpBar = panel.el.find('bar-hp');
  assert.equal(hpBar.classList.contains('is-open'), true, 'a scouted site must show its HP bar');
  assert.equal(hpBar.find('bar-label').textContent, `${Math.round(dark.hp)}/${Math.round(dark.hpMax)}`);
});

test('panel: switching from a real site to a ghost leaves no undefined/NaN, and closes every bar', () => {
  const b = battleFor();
  const dark = unseenEnemy(b);
  assert.ok(dark, 'no unseen enemy site — this proves nothing');
  const mine = b.sites.find((s) => s.owner === 'player' && s.hp > 0);
  const { panel, view } = mountPanel(b);

  select(view, mine.id);
  panel.update(b);
  assert.equal(panel.el.find('bar-hp').classList.contains('is-open'), true,
    'sanity: the real site opened its HP bar');

  // Seen once, not seen now — see the first ghost test for why the fixture has
  // to say so explicitly since `siteKnown` landed.
  b.seen.player[dark.id] = 'enemy';
  select(view, dark.id);
  panel.update(b);

  const title = panel.el.find('hud-selection-title').textContent;
  const sub = panel.el.find('hud-selection-sub').textContent;
  assert.equal(title, spaceCase(dark.kind).toUpperCase());
  assert.equal(sub, 'UNSCOUTED · last seen: enemy');
  assert.doesNotMatch(title, /undefined|NaN/);
  assert.doesNotMatch(sub, /undefined|NaN/);
  for (const cls of ['bar-hp', 'bar-comp', 'bar-train', 'bar-build']) {
    assert.equal(panel.el.find(cls).classList.contains('is-open'), false, `${cls} stayed open on a ghost`);
  }
});

test('panel: a ghost states its last-known owner in the past tense, and only when there is one', () => {
  const b = battleFor();
  const dark = unseenEnemy(b);
  assert.ok(dark, 'no unseen enemy site — this proves nothing');
  const { panel, view } = mountPanel(b);

  select(view, dark.id);
  panel.update(b);
  // NEVER SEEN AT ALL is no longer "a ghost with nothing to say about
  // ownership" — it is not on the board and not in this panel, so there is no
  // past tense to state yet. This half is the negative control for the half
  // below: without it, "a ghost names its last-known owner" would pass just as
  // happily against a panel that named an owner for every enemy site whether
  // the player had ever looked or not.
  assert.equal(panel.el.classList.contains('is-open'), false,
    'a site nobody has ever looked at opened a panel');

  // It was seen once, and nobody has looked since — the exact shape
  // recomputeVision leaves behind (tests/vision.test.js: "seen keeps the
  // STALE owner"). Poking state.seen directly tests the DISPLAY side of that
  // contract, not the recompute itself, which that file already owns.
  b.seen.player[dark.id] = 'enemy';
  panel.update(b);
  assert.equal(panel.el.find('hud-selection-sub').textContent, 'UNSCOUTED · last seen: enemy');
});

// ---------------------------------------------------------------------------
// 3. A squad is gone the instant it leaves vision — no ghost, not even a
//    stale selection
// ---------------------------------------------------------------------------

test('panel: an enemy squad stops being inspectable the instant it leaves vision', () => {
  // Hand-built rather than a real battle: perceivedSquads needs tick, sites,
  // squads and vision (see vision.test.js's own fixture for the same shape) —
  // AND, since contract v10, a real `path` to read a position off: this
  // fixture predates that and `squadHexOf` returned null for it, so the
  // column was silently unfindable regardless of vision, which is a stronger
  // failure than the one this test exists to catch and was masking it. `path`
  // is a straight line so the column sits at (5,5) at tick 5 of 10 — the
  // exact hex the `vision` fixture below already lights.
  const sites = [{ id: 'a', hex: [0, 0] }, { id: 'b', hex: [10, 10] }];
  const enemySquad = {
    id: 'sq1', owner: 'enemy', from: 'a', to: 'b', spawnTick: 0, arriveTick: 10,
    comp: { militia: 40 }, retreating: false,
    // A squad carries the ROUTE it walks (contract v10) and its position is
    // read off that, not lerped between its two endpoint sites — so a fixture
    // without one is an army that is nowhere, invisible to fog and to this
    // panel alike. Written out because the fixture is hand-built; a real battle
    // gets it from the same A* the travel time is priced by.
    path: Array.from({ length: 11 }, (_, i) => ({ q: i, r: i })),
    camped: false, hex: null,
  };
  const state = {
    tick: 5, sites, squads: [enemySquad], vision: { player: { '5,5': 1 }, enemy: {} },
  };
  const { panel, view } = mountPanel(state);
  view.selectedSquad = 'sq1';
  panel.update(state);
  assert.equal(panel.el.classList.contains('is-open'), true,
    'sanity: the column really is inspectable while it is in sight');
  assert.match(panel.el.find('hud-selection-title').textContent, /40 troops/);

  // The SAME selection — only the column marching off the lit ground, the
  // way it would tick to tick.
  state.vision = { player: {}, enemy: {} };
  panel.update(state);
  assert.equal(panel.el.classList.contains('is-open'), false,
    'an enemy column stayed inspectable after marching out of sight — the '
    + 'stale-selection leak squadById used to have');

  // NEGATIVE CONTROL: the player's OWN squad is never dropped by vision at
  // all (perceivedSquads includes it unconditionally), so the branch above is
  // really about the ENEMY, not "any squad off the lit ground".
  const mineSquad = { ...enemySquad, id: 'sq2', owner: 'player' };
  state.squads.push(mineSquad);
  view.selectedSquad = 'sq2';
  panel.update(state);
  assert.equal(panel.el.classList.contains('is-open'), true,
    "the player's own column must stay inspectable regardless of vision");
});
