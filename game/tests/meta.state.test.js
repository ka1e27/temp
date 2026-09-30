import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, resetRegions, PLAYER_FACTION } from '../meta/state.js';
import { makeWorld } from './meta.fixtures.js';

test('createGame: owner mirrors each region\'s original faction', () => {
  const world = makeWorld();
  const state = createGame(1, world, 1000);
  assert.deepEqual(state.owner, [0, 1, 1, 2, 2, 3]);
});

test('createGame: start region is owned by the player and conquered at `now`', () => {
  const world = makeWorld();
  const state = createGame(1, world, 1234);
  assert.equal(state.owner[world.startRegion], PLAYER_FACTION);
  assert.equal(state.conqueredAt[world.startRegion], 1234);
});

test('createGame: every other region has a null conqueredAt', () => {
  const world = makeWorld();
  const state = createGame(1, world, 1234);
  for (const region of world.regions) {
    if (region.id === world.startRegion) continue;
    assert.equal(state.conqueredAt[region.id], null);
  }
});

test('createGame: rally starts at level 1, gold/stats/tutorial start at zero', () => {
  const world = makeWorld();
  const state = createGame(7, world, 0);
  assert.equal(state.seed, 7);
  assert.equal(state.gold, 0);
  assert.equal(state.dynasty.level, 1);
  assert.equal(state.dynasty.stars, 0);
  assert.equal(state.upgrades.rally, 1);
  assert.equal(state.tutorial.done, false);
  assert.equal(state.battle, null);
  assert.equal(state.stats.regionsConquered, 0);
  assert.equal(state.stats.bestBattleSec, null);
});

test('createGame: state is plain JSON (no functions, Maps or Sets)', () => {
  const world = makeWorld();
  const state = createGame(1, world, 0);
  const roundTripped = JSON.parse(JSON.stringify(state));
  assert.deepEqual(roundTripped, state);
});

test('resetRegions: can be called again on an existing state (e.g. after founding a dynasty)', () => {
  const world = makeWorld();
  const state = createGame(1, world, 0);
  state.owner[1] = PLAYER_FACTION; // pretend we conquered region 1
  resetRegions(state, world, 500);
  assert.deepEqual(state.owner, [0, 1, 1, 2, 2, 3]); // back to the world's original owners
  assert.equal(state.conqueredAt[0], 500);
});

test('purity: state.js never touches world (world stays deep-frozen throughout)', () => {
  const world = makeWorld();
  assert.doesNotThrow(() => createGame(1, world, 0));
});

// --- crowns and leader voices (DESIGN §4.8, §3.6) ---------------------------

test('createGame: one empty crowns slot per region, nobody met, lifetime crowns at zero', () => {
  const world = makeWorld();
  const state = createGame(1, world, 0);
  assert.equal(state.crowns.length, world.regions.length);
  assert.ok(state.crowns.every((c) => c === null));
  assert.deepEqual(state.metFactions, []);
  assert.equal(state.stats.crownsEarned, 0);
});

test('createGame: leader voices are on by default', () => {
  const state = createGame(1, makeWorld(), 0);
  assert.equal(state.settings.leaderVoices, true);
});

test('resetRegions (new dynasty): crowns and met factions reset, lifetime crowns survive', () => {
  const world = makeWorld();
  const state = createGame(1, world, 0);
  state.crowns[1] = { victory: true, swift: true, unbroken: false };
  state.metFactions.push(1, 2);
  state.stats.crownsEarned = 2;
  resetRegions(state, world, 500);
  assert.ok(state.crowns.every((c) => c === null));
  assert.deepEqual(state.metFactions, []);
  assert.equal(state.stats.crownsEarned, 2);
});

test('resetRegions: crowns is a fresh array each time (a reset never aliases the old dynasty)', () => {
  const world = makeWorld();
  const state = createGame(1, world, 0);
  const before = state.crowns;
  resetRegions(state, world, 1);
  assert.notEqual(state.crowns, before);
});
