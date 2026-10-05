// Phase 10A: one new system at a time (game/app/pacer.js) and the tutorial steps that wait for it (game/app/tutorial.js `intro`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPacer, systemsInState } from '../app/pacer.js';
import { createTutorialController } from '../app/tutorial.js';
import { createStateContainer } from '../app/stateContainer.js';
import { PACING } from '../config/pacing.js';
import { TUTORIAL_STEPS } from '../scenes/timing.js';

const memoryStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('pacer: the first system at once, the next only after introGapSec of play, a known one always', () => {
  const state = { stats: { playSec: 10 } };
  const p = createPacer({ getState: () => state });
  assert.equal(PACING.introGapSec >= 150, true, 'about three minutes apart (the first-hour target)');
  assert.equal(p.ready('renown'), true);
  p.introduce('renown');
  assert.equal(p.ready('board'), false, 'the next waits');
  assert.equal(p.ready('renown'), true, 'a known system never waits');
  state.stats.playSec += PACING.introGapSec - 1;
  assert.equal(p.ready('board'), false);
  assert.equal(p.wait(), 1);
  state.stats.playSec += 1;
  assert.equal(p.ready('board'), true);
  p.introduce('board');
  p.introduce('board'); // a second call changes nothing
  state.stats.playSec += 5;
  assert.equal(p.ready('streak'), false, 'the clock restarted at the board');
  assert.deepEqual(p.list().map(([n]) => n), ['renown', 'board']);
});

test('pacer: a live gap (0 under the checks) and what a save already shows', () => {
  let gap = 0;
  const state = { stats: { playSec: 0 }, renown: { earned: 3 }, bounties: { unlocked: true }, boons2: { owned: [], draws: 0 }, tutorial: { seen: { H1: true, Q1: true } } };
  const p = createPacer({ getState: () => state, gapSec: () => gap });
  p.introduce('x');
  assert.equal(p.ready('y'), true, 'no wait with a zero gap');
  gap = 100;
  assert.equal(p.ready('y'), false);
  p.reset();
  assert.deepEqual(systemsInState(state).sort(), ['board', 'codex', 'renown']);
  assert.equal(p.ready('codex'), true);
  assert.equal(p.ready('y'), true, 'a restored system does not start the clock');
});

test('tutorial: a step that introduces a system waits for the pacer, then introduces it', () => {
  const { state } = createStateContainer({ storage: memoryStorage(), now: () => 1 }).newRealm(7);
  state.stats.playSec = 50;
  const pacer = createPacer({ getState: () => state });
  const tut = createTutorialController({ getState: () => state, pacer });
  for (const id of ['W0', 'W1', 'W2', 'W3', 'M1']) state.tutorial.seen[id] = true;
  const facts = { scene: 'world', panelsClosed: true, cardOpen: false, battlesWon: 1, conquests: 1, settingsBtn: true, frontierCount: 3 };
  pacer.introduce('renown');
  assert.equal(tut.pick(facts), null, 'the Codex hint waits its turn');
  state.stats.playSec += PACING.introGapSec;
  const step = tut.pick(facts);
  assert.equal(step && step.id, 'H1');
  assert.equal(pacer.known('codex'), true, 'showing it introduced the Codex');
  assert.equal(tut.pick(facts).id, 'H1', 'and it keeps its turn');
  // every system step names its system
  for (const id of ['M2', 'M3', 'R1', 'V1', 'Q1', 'G2', 'L1', 'H1', 'J1', 'F4']) assert.ok(TUTORIAL_STEPS.find((d) => d.id === id).intro, `${id} has an intro`);
});

test('tutorial: a new step waits newHintGapSec after the previous new one; an urgent step and a step already shown do not', () => {
  const { state } = createStateContainer({ storage: memoryStorage(), now: () => 1 }).newRealm(7);
  state.stats.playSec = 0;
  const tut = createTutorialController({ getState: () => state, newHintGapSec: () => 10 });
  const world = { scene: 'world', panelsClosed: true, cardOpen: false, cardAttackable: false, frontierCount: 3, battlesWon: 0, conquests: 0 };
  assert.equal(tut.pick(world).id, 'W0');
  tut.markSeen('W0');
  state.stats.playSec = 4;
  assert.equal(tut.pick(world), null, 'W1 waits its turn');
  state.stats.playSec = 10;
  assert.equal(tut.pick(world).id, 'W1');
  assert.equal(tut.pick({ ...world, panelsClosed: false }), null, 'its rule stops holding');
  state.stats.playSec = 12;
  assert.equal(tut.pick(world).id, 'W1', 'a step already shown comes back without waiting');
  tut.markSeen('W1');
  for (const id of ['W2', 'W3', 'M1']) state.tutorial.seen[id] = true;
  assert.equal(tut.pick({ ...world, eventToast: true, features: { frontier: true } }).id, 'V5', 'an urgent step (an offer with a clock) never waits');
});
