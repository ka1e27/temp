// A BOOSTER YOU HAVE NONE OF MUST NOT ARM.
//
// A fresh save carries no charges — they are bought with relics, and relics are
// paid only for a region you have BEATEN — so the very first battle a new player
// ever sees puts five live controls down the right rail, all reading `-`.
// Pressing one ARMED it and answered `AIMING RALLY - click a site · Esc
// cancels`; the refusal arrived only on the SECOND click, after the player had
// done exactly what the game told them to. Measured in a real browser before
// the fix: two clicks and ~3 seconds spent on an action the game already knew
// it could not perform.
//
// The fix is one predicate shared with the simulation, not a second copy of the
// rule — the same argument `buildBlocker` makes for the build preview. So the
// first test here is about the SEAM, and the rest are about the two behaviours.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { boosterBlocker, drainCommands } from '../src/battle/commands.js';
import { createArmedBoosters } from '../src/screens/battle-boosters.js';
import { createBattleState } from '../src/battle/state.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { emptyComp } from '../src/battle/combat.js';
import { cmd } from '../src/screens/battle-orders.js';
import { BOOSTERS } from '../src/content/balance.js';

function battle(boosters = []) {
  return createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: 'arm', seed: 1,
    grid: { cols: 11, rows: 9, blocked: [] },
    sites: [
      { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 10 }, hp: 480, hpMax: 480 },
      { id: 'pf1', kind: 'farm', hex: [2, 0], owner: 'player', garrison: { militia: 4 }, hp: 100, hpMax: 100 },
      { id: 'castle', kind: 'castle', hex: [6, 0], owner: 'enemy', garrison: { militia: 20 }, hp: 900, hpMax: 900 },
    ],
    adjacency: [],
    player: makeMods({ expedition: emptyComp() }),
    enemy: makeMods({ expedition: emptyComp() }),
    boosters,
    rules: { victory: 'capture-castle', hardCapMs: 600000, aiTier: 1 },
  });
}

/** The arming layer over a real battle state, with the commands it pushes
 *  collected so a test can see what actually reached the queue. */
function arming(state) {
  const view = { armedBooster: null };
  const pushed = [];
  const api = createArmedBoosters({
    view,
    canvas: null,
    bus: null,
    getState: () => state,
    push: (c) => { pushed.push(c); state.commands.push(c); },
    cmd,
  });
  return { view, pushed, ...api };
}

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

test('the HUD and the simulation share ONE availability predicate', () => {
  // Asserted against the source, not against the comment above it: a second
  // implementation of "can this booster be used" would let the rail and the
  // engine drift, which is the class of bug this project keeps finding.
  const here = dirname(fileURLToPath(import.meta.url));
  const ui = readFileSync(join(here, '..', 'src', 'screens', 'battle-boosters.js'), 'utf8');
  assert.match(ui, /boosterBlocker/, 'the arming layer must ask the shared predicate');
  const sim = readFileSync(join(here, '..', 'src', 'battle', 'commands.js'), 'utf8');
  assert.match(sim, /const blocked = boosterBlocker\(state, cmd\.id\);/,
    'cmdBooster must be the predicate\'s other CALLER, not a copy of it');
});

test('boosterBlocker names the reason the sim would give', () => {
  const none = battle([]);
  assert.equal(boosterBlocker(none, 'rally'), 'booster-unavailable');
  const spent = battle([{ id: 'rally', charges: 1 }]);
  spent.boosters.rally.charges = 0;
  assert.equal(boosterBlocker(spent, 'rally'), 'no-charges');
  assert.equal(boosterBlocker(battle([{ id: 'rally', charges: 1 }]), 'rally'), null);
  assert.equal(boosterBlocker(battle([{ id: 'rally', charges: 1 }]), 'nonesuch'),
    'booster-unavailable');
  // A missing state must read as unusable rather than throwing: the HUD builds
  // before the first tick drains, and an exception there is a dead screen.
  assert.equal(boosterBlocker(null, 'rally'), 'booster-unavailable');
  assert.equal(boosterBlocker(undefined, 'rally'), 'booster-unavailable');
});

// ---------------------------------------------------------------------------
// The behaviour a new player meets
// ---------------------------------------------------------------------------

test('an empty booster does not arm, and refuses on the FIRST press', () => {
  const state = battle([]);          // exactly what a fresh save brings
  const a = arming(state);

  assert.equal(a.armBooster('rally'), false, 'must not report itself armed');
  assert.equal(a.view.armedBooster, null, 'and must not BE armed');
  assert.equal(a.pushed.length, 1, 'the refusal still goes through the simulation');

  // ...and the simulation's own answer is the one the player is shown.
  const rejected = [];
  drainCommands(state, () => {});
  for (const ev of state.events) if (ev.type === 'command-rejected') rejected.push(ev.reason);
  assert.deepEqual(rejected, ['booster-unavailable']);
});

test('...and so does a booster whose charges have run out', () => {
  const state = battle([{ id: 'rally', charges: 1 }]);
  state.boosters.rally.charges = 0;
  const a = arming(state);
  assert.equal(a.armBooster('rally'), false);
  assert.equal(a.view.armedBooster, null);
  drainCommands(state, () => {});
  assert.ok(state.events.some((e) => e.type === 'command-rejected' && e.reason === 'no-charges'));
});

test('a booster you DO have still arms and waits for its target', () => {
  const state = battle([{ id: 'rally', charges: 2 }]);
  const a = arming(state);
  assert.equal(a.armBooster('rally'), true, 'the whole feature must survive the guard');
  assert.equal(a.view.armedBooster, 'rally');
  assert.equal(a.pushed.length, 0, 'an armed booster pushes nothing until it is aimed');

  assert.equal(a.fireBooster('pf1'), true);
  assert.equal(a.view.armedBooster, null);
  assert.deepEqual(a.pushed.map((c) => [c.t, c.id, c.site]), [['BOOSTER', 'rally', 'pf1']]);
});

test('an untargeted booster you have still fires at once', () => {
  // march and tithe act on what you already hold, so they never arm — the guard
  // must not turn them into a two-step.
  const state = battle([{ id: 'tithe', charges: 1 }]);
  const a = arming(state);
  assert.equal(a.armBooster('tithe'), false, 'not armed: it fired');
  assert.equal(a.pushed.length, 1);
  drainCommands(state, () => {});
  assert.equal(state.events.some((e) => e.type === 'command-rejected'), false,
    'a booster you hold must not be refused');
});

test('pressing an armed booster again still cancels it', () => {
  const state = battle([{ id: 'rally', charges: 1 }]);
  const a = arming(state);
  a.armBooster('rally');
  assert.equal(a.armBooster('rally'), false, 'second press cancels');
  assert.equal(a.view.armedBooster, null);
  assert.equal(a.pushed.length, 0, 'cancelling is not an order');
});

test('every booster in the game answers the guard the same way', () => {
  // Five ids, and a guard that only covered some of them would leave exactly the
  // false affordance this file exists to remove.
  for (const id of Object.keys(BOOSTERS)) {
    const empty = arming(battle([]));
    assert.equal(empty.armBooster(id), false, `${id} armed with no charges`);
    assert.equal(empty.view.armedBooster, null, `${id} left the view armed`);
  }
});
