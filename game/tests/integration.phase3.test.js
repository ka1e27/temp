// A varied map, integration side (DESIGN 10.13; docs/briefs/phase3-hookup.md): the save round-trip of `boons` and `worldEvents`, the card's
// income matching what a Gold Mine pays, the battle manager's Duel branch (Renown for a win, never an occupation), and the tutorial steps.
import test from 'node:test';
import assert from 'node:assert/strict';

import { generateWorld } from '../world/generate.js';
import { createGame, PLAYER_FACTION } from '../meta/state.js';
import { serialize, deserialize } from '../meta/save.js';
import { effectiveRegionIncome } from '../app/income.js';
import { incomePerSec } from '../meta/economy.js';
import { conquer } from '../meta/progression.js';
import { createBattleManager } from '../app/battles.js';
import { duelRunFor, borderingRivalsForTest } from './phase3.helpers.js';
import { TUTORIAL_STEPS } from '../scenes/timing.js';
import { RULES } from '../app/tutorialRules.js';
import { FEATURES } from '../config/features.js';

const SEED = 9; // every type and every twist
const world = generateWorld(SEED);

test('save round-trip: boons and worldEvents survive serialize / deserialize (Dragonscale, a pending offer, a Plague)', () => {
  const state = createGame(SEED, world, 0);
  assert.deepEqual(state.boons, { dragonscale: false });
  assert.ok(state.worldEvents && state.worldEvents.pending === null);
  state.boons.dragonscale = true;
  state.worldEvents.activeSec = 1700;
  state.worldEvents.pending = { id: 3, kind: 'duel', offeredAt: 1690, expiresAt: 1780, faction: 2, regionId: 4, fromRegionId: 5, text: 'x' };
  state.worldEvents.plague = { faction: 3, until: 2300 };
  state.worldEvents.log.duel = 1;
  const back = deserialize(serialize(state));
  assert.ok(back, 'the save loads');
  assert.equal(back.boons.dragonscale, true);
  assert.equal(back.worldEvents.activeSec, 1700);
  assert.equal(back.worldEvents.pending.kind, 'duel');
  assert.equal(back.worldEvents.pending.regionId, 4);
  assert.deepEqual(back.worldEvents.plague, { faction: 3, until: 2300 });
  assert.equal(back.worldEvents.log.duel, 1);
});

test('an old save without boons / worldEvents loads with the defaults', () => {
  const state = createGame(SEED, world, 0);
  const raw = JSON.parse(serialize(state));
  delete raw.boons;
  delete raw.worldEvents;
  const back = deserialize(JSON.stringify(raw));
  assert.ok(back);
  assert.deepEqual(back.boons, { dragonscale: false });
  assert.equal(back.worldEvents.pending, null);
  assert.equal(back.worldEvents.plague, null);
});

test('the card pays what the economy pays: a Gold Mine held shows its +income on the card (effectiveRegionIncome x typeIncomeMult)', () => {
  const state = createGame(SEED, world, 0);
  const mine = world.regions.find((r) => r.type === 'goldmine');
  assert.ok(mine, 'seed 9 has a Gold Mine');
  conquer(state, world, mine.id, 0);
  assert.equal(state.owner[mine.id], PLAYER_FACTION);
  const total = world.regions.filter((r) => state.owner[r.id] === PLAYER_FACTION).reduce((a, r) => a + effectiveRegionIncome(state, world, r), 0);
  assert.ok(Math.abs(total - incomePerSec(state, world)) < 1e-6 * Math.max(1, total), `card sum ${total} vs income ${incomePerSec(state, world)}`);
  // and the Gold Mine itself reads its bonus
  const plain = { ...mine, type: null };
  assert.ok(effectiveRegionIncome(state, world, mine) > effectiveRegionIncome(state, world, plain) * (1 + FEATURES.rewards.goldmine.income) - 1e-9);
});

test('the battle manager finishes a Duel: a win pays its Renown, a loss occupies nothing and wounds no one', () => {
  for (const result of ['win', 'lose']) {
    const state = createGame(SEED, world, 0);
    // a realm with a border to a rival, so a Duel can be fought
    for (const r of world.regions) if (r.tier <= 1) conquer(state, world, r.id, 0);
    const ev = borderingRivalsForTest(state, world);
    assert.ok(ev, 'a duel is possible on seed 9 after the first ring');
    const manager = createBattleManager({ getState: () => state, getWorld: () => world });
    const run = manager.start(duelRunFor(state, world, ev, null, { nowMs: 0 }));
    assert.ok(run && run.kind === 'duel', 'the Duel runs in the manager');
    assert.equal(run.attackerFaction, ev.faction);
    run.battle.result = result;
    const renown0 = state.renown.points;
    const out = manager.finish(run.id);
    assert.equal(out.kind, 'duel');
    assert.equal(out.won, result === 'win');
    assert.equal(state.owner[ev.regionId], PLAYER_FACTION, 'the region is still yours');
    assert.ok(!(state.occupation && state.occupation[ev.regionId]), 'never occupied');
    if (result === 'win') assert.ok(state.renown.points > renown0 && out.renown > 0, 'a win pays Renown');
    else assert.equal(state.renown.points, renown0, 'a loss costs nothing');
    assert.equal(state.battles.length, 0);
  }
});

test('the Phase 3 tutorial steps: each has a rule, an anchor and real words; V3 says the hold from the config', () => {
  for (const id of ['V1', 'V2', 'V3', 'V4', 'V5']) {
    const step = TUTORIAL_STEPS.find((s) => s.id === id);
    assert.ok(step, id);
    assert.equal(typeof RULES[id], 'function', `${id} has a rule`);
    assert.ok(step.anchor && step.text && step.seenOn.length && step.timeoutSec > 0, `${id} is complete`);
  }
  assert.match(TUTORIAL_STEPS.find((s) => s.id === 'V3').text, new RegExp(`${FEATURES.shrine.holdSec} s`));
  assert.equal(RULES.V2({ live: true, gateStanding: true }), true);
  assert.equal(RULES.V2({ live: true, gateStanding: false }), false);
  assert.equal(RULES.V4({ live: true, telegraph: true, bulwarkUnlocked: false }), false);
});
