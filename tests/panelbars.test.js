// The site panel's fills: HP, troop composition, training progress.
//
// Split out of tests/sitepanel.test.js at the 400-line cap, along the seam
// rather than at a line number — that file asks whether the panel's CONTROLS
// reach the simulation, this one asks whether its READOUTS say what the state
// actually holds. Both mount the same real panel over the same fake document
// (tests/fixtures/panelDom.js), so neither can drift into its own stub.
//
// The BUILD bar deliberately stayed behind: what is worth pinning about it is
// that it no longer masks UNDER SIEGE, which is a claim about the status line
// rather than about a fill.
//
// The bars are presentation-only by design (see src/screens/battle-bars.js):
// every fraction is handed in by the caller. So what is worth pinning here is
// exactly the arithmetic of turning a garrison into widths and a sentence, and
// the a11y contract that stopped five 15px spans being keyboard targets.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  UNIT_IDS, UNITS, at, fixture, mountPanel, select,
} from './fixtures/panelDom.js';


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

// A READOUT SHOULD NOT HAVE TO BE OPERATED. The segments used to take
// `tabIndex = 0` whenever they held troops — five keyboard stops 15px tall,
// a third of the 44px minimum, that activate nothing and (the hover card
// carrying a permanent `aria-hidden`) announced nothing either. Both halves of
// the replacement are asserted here, and the negative control is the one that
// matters: it is the tab stops coming back that this test exists to catch.
test('the composition bar names itself, and its segments are never tab stops', () => {
  const s = fixture();
  const { panel, view } = mountPanel(s);
  const camp = at(s, 'camp');
  camp.garrison = { militia: 3, spearmen: 1 };
  select(view, 'camp');
  panel.update(s);

  const bar = panel.el.find('bar-comp');
  assert.equal(bar.getAttribute('role'), 'img', 'a labelled graphic, not a control');
  assert.equal(bar.getAttribute('aria-label'), 'Garrison 4: 3 Militia, 1 Spearmen',
    'the whole breakdown, announced without any interaction');

  for (const seg of bar.findAll('bar-comp-seg')) {
    assert.equal(seg.getAttribute('tabindex'), '-1', 'not a keyboard target at any size');
  }

  // ...and it stays true as the garrison changes, which is where the old code
  // put them BACK in the tab order.
  camp.garrison = { militia: 0, spearmen: 0, raiders: 12 };
  panel.update(s);
  assert.equal(bar.getAttribute('aria-label'), 'Garrison 12: 12 Raiders',
    'absent units are omitted, not listed as zero');
  for (const seg of bar.findAll('bar-comp-seg')) {
    assert.equal(seg.getAttribute('tabindex'), '-1');
  }
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

