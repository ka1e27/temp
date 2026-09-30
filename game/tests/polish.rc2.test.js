// The last polish round: "Best value" in the council, the "Stuck?" hint's decision, which intent lines get drawn, and the dynasty copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bestValueUpgrade, meanArmyPower } from '../app/bestValue.js';
import { UPGRADES, levelOf, upgradeCost } from '../meta/upgrades.js';
import { frontier } from '../meta/progression.js';
import { stuckHintDue } from '../scenes/stuckHint.js';
import { STUCK_HINT, DRAG_ARROW } from '../scenes/timing.js';
import { intentWorthDrawing } from '../render/units.js';
import { makeWorld, makeGame, ownEverything } from './meta.fixtures.js';

// --- Best value ------------------------------------------------------------------------------------------------------------

test('bestValueUpgrade: the Army upgrade with the most Army Power per gold, by brute force', () => {
  const world = makeWorld();
  const state = makeGame(world);
  const best = bestValueUpgrade(state, world);
  assert.ok(best, 'a fresh realm has an Army upgrade that raises power');
  assert.equal(UPGRADES[best.id].tab, 'army');
  const ids = frontier(state, world);
  const base = meanArmyPower(state, world, ids);
  let top = null;
  for (const def of Object.values(UPGRADES).filter((u) => u.tab === 'army')) {
    const lvl = levelOf(state, def.id);
    const gain = meanArmyPower({ ...state, upgrades: { ...state.upgrades, [def.id]: lvl + 1 } }, world, ids) - base;
    const perGold = gain / upgradeCost(def.id, lvl);
    if (gain > 0 && (!top || perGold > top.perGold)) top = { id: def.id, perGold };
  }
  assert.equal(best.id, top.id);
  assert.ok(Math.abs(best.perGold - top.perGold) < 1e-9);
  assert.ok(best.gain > 0 && best.cost === upgradeCost(best.id, levelOf(state, best.id)));
});

test('bestValueUpgrade: it follows the prices (buy the winner until another card is the better deal) and never names a non-Army card', () => {
  const world = makeWorld();
  const state = makeGame(world);
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const best = bestValueUpgrade(state, world);
    if (!best) break;
    seen.add(best.id);
    assert.equal(UPGRADES[best.id].tab, 'army');
    state.upgrades[best.id] = levelOf(state, best.id) + 1;
  }
  assert.ok(seen.size >= 2, `the recommendation moves on as prices climb (saw ${[...seen].join(', ')})`);
});

test('bestValueUpgrade: nothing to recommend when no region is left to fight', () => {
  const world = makeWorld();
  const state = makeGame(world);
  ownEverything(state, world);
  assert.equal(bestValueUpgrade(state, world), null);
});

test('the council card carries the tag as data (the UI kit imports nothing) and the scene recomputes on purchase', () => {
  const council = readFileSync(new URL('../ui/council.js', import.meta.url), 'utf8');
  assert.match(council, /bestValue/);
  const imports = [...council.matchAll(/^import .* from '(.+)';$/gm)].map((m) => m[1]);
  assert.ok(!imports.some((spec) => /meta\/|config\/|app\/|world\//.test(spec)), `council.js imports ${imports.join(', ')}`);
  const world = readFileSync(new URL('../scenes/world.js', import.meta.url), 'utf8');
  assert.match(world, /updateCouncil\(true\); \/\/ a purchase changes which upgrade is the best value now/);
});

// --- The "Stuck?" hint -------------------------------------------------------------------------------------------------------

const base = { hintsOn: true, tutorialStepId: null, battleT: 70, lastCaptureT: 0, done: false, fireReady: false, rallyReady: true };

test('stuck hint: 60 s with no capture and a ready power names exactly the unlocked, ready powers', () => {
  assert.equal(STUCK_HINT.afterSec, 60);
  assert.deepEqual(stuckHintDue({ ...base, fireReady: true }), { key: 'both', text: STUCK_HINT.text.both, power: 'firestorm' });
  assert.equal(STUCK_HINT.text.both, 'Stuck? Firestorm their strongest site, or Rally everything at once.');
  assert.deepEqual(stuckHintDue(base), { key: 'rally', text: 'Stuck? Rally everything at once.', power: 'rally' });
  assert.deepEqual(stuckHintDue({ ...base, rallyReady: false, fireReady: true }), { key: 'firestorm', text: 'Stuck? Firestorm their strongest site.', power: 'firestorm' });
});

test('stuck hint: not before 60 s since the last capture, not twice, not with hints off, not with nothing to press', () => {
  assert.equal(stuckHintDue({ ...base, battleT: 59.9 }), null);
  assert.equal(stuckHintDue({ ...base, battleT: 119, lastCaptureT: 60 }), null, 'a capture restarts the clock');
  assert.ok(stuckHintDue({ ...base, battleT: 120, lastCaptureT: 60 }));
  assert.equal(stuckHintDue({ ...base, done: true }), null);
  assert.equal(stuckHintDue({ ...base, hintsOn: false }), null);
  assert.equal(stuckHintDue({ ...base, rallyReady: false, fireReady: false }), null, 'a locked or cooling power is never named');
});

test('stuck hint: never while the tutorial is in a battle step (3 to 5), fine on the map step and after the tutorial', () => {
  for (const step of [3, 4, 5]) assert.equal(stuckHintDue({ ...base, tutorialStepId: step }), null, `step ${step}`);
  assert.ok(stuckHintDue({ ...base, tutorialStepId: 6 }));
  assert.ok(stuckHintDue({ ...base, tutorialStepId: null }));
});

// --- Intent lines ------------------------------------------------------------------------------------------------------------

test('intent lines: threats and races only, never an enemy reinforcing its own site or a player squad', () => {
  const battle = { sites: [{ owner: 0 }, { owner: 2 }, { owner: 2 }, { owner: 1 }] };
  assert.equal(intentWorthDrawing(battle, { owner: 2, to: 0 }), true, 'marching on the player');
  assert.equal(intentWorthDrawing(battle, { owner: 2, to: 3 }), true, 'a race for a neutral site');
  assert.equal(intentWorthDrawing(battle, { owner: 2, to: 1 }), false, 'reinforcing its own site');
  assert.equal(intentWorthDrawing(battle, { owner: 0, to: 1 }), false, 'our own squads have the drag arrow');
  assert.equal(intentWorthDrawing(battle, { owner: 2, to: 99 }), false);
});

// --- The arrow and the copy --------------------------------------------------------------------------------------------------

test('the drag arrow colours are saturated green and red, and gold otherwise', () => {
  assert.deepEqual(Object.keys(DRAG_ARROW).sort(), ['capture', 'fail', 'neutral']);
  const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const [cr, cg, cb] = hex(DRAG_ARROW.capture);
  const [fr, fg, fb] = hex(DRAG_ARROW.fail);
  assert.ok(cg > 180 && cr < 90 && cg - cb > 60, 'green is green');
  assert.ok(fr > 200 && fg < 100 && fb < 100, 'red is red');
});

test('no UI, scene or app copy promises a "larger" continent or world', () => {
  for (const f of ['../ui/realm.js', '../scenes/world.js', '../app/stateContainer.js']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
    assert.doesNotMatch(src, /larger,? (tougher )?(world|continent)|somewhat larger/i, f);
  }
  const realm = readFileSync(new URL('../ui/realm.js', import.meta.url), 'utf8');
  assert.match(realm, /A new continent awaits, with tougher enemies/);
});

test('the step-2 hint says a minute or two', () => {
  assert.match(readFileSync(new URL('../scenes/timing.js', import.meta.url), 'utf8'), /Attack! Battles take a minute or two\./);
});
