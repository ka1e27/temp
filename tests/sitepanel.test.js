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

// The fake document, the battle fixture and the real panel wiring all live in
// tests/fixtures/panelDom.js, shared with tests/panelbars.test.js — the shims
// have to be installed before any DOM-touching module is evaluated, and doing
// that in one module makes the ordering a property of the harness rather than
// a comment every consumer has to remember to honour.
import {
  RALLY_KEEP, UNITS, drainCommands, step, total, emptyComp,
  at, fixture, mountPanel, select,
} from './fixtures/panelDom.js';

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
  assert.deepEqual(moneyBubbles(panel), ['TRAIN -3.9/s']);
  assert.equal(panel.el.find('hud-site-train').textContent, 'militia x2 every 6.2s · 0.33/s');
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

test('the build timer is a bar, and it no longer masks UNDER SIEGE', () => {
  // The status line used to return `building · 12s left` FIRST, so a site
  // besieged while it built never once said it was under siege. Moving the
  // build to its own bar is what un-masks that, which is why both halves are
  // asserted here rather than in buildbar.test.js.
  const s = fixture();
  const { panel, view } = mountPanel(s);
  const camp = at(s, 'camp');
  select(view, 'camp');
  panel.update(s);
  assert.equal(panel.el.find('bar-build').classList.contains('is-open'), false);

  camp.level = 2;
  camp.upgradeTicksLeft = 300;              // as cmdUpgrade leaves it: level ALREADY raised
  panel.update(s);
  const bar = panel.el.find('bar-build');
  assert.equal(bar.classList.contains('is-open'), true);
  assert.match(bar.textContent, /^L2 · /, 'the level being raised, and the time left');
  assert.equal(panel.el.find('hud-site-stat').textContent, '', 'no duplicate text line');

  camp.siege = { owner: 'enemy', comp: { militia: 5 } };
  panel.update(s);
  assert.match(panel.el.find('hud-site-stat').textContent, /UNDER SIEGE/);
  assert.equal(panel.el.find('bar-build').classList.contains('is-open'), true,
    'and the build is still visible alongside it');
});

