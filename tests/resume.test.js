// Mid-battle resume. A battle runs 8-14 minutes; losing one to a refresh is
// the papercut this exists to remove.
//
// The asymmetry with save.js matters and is asserted here: progress is
// PRECIOUS (a suspicious save is preserved and refused), an interrupted battle
// is EPHEMERAL (anything suspicious is discarded, never repaired).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  saveBattle, loadBattle, clearBattle, RESUME_KEY, RESUME_MAX_AGE_MS,
} from '../src/meta/resume.js';
import { createMemoryStorage } from '../src/meta/save.js';
import { createState } from '../src/core/store.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { startBattle, step } from '../src/battle/sim.js';
import { CONTRACT_VERSION } from '../src/battle/contract.js';

const NOW = 1_700_000_000_000;

function liveBattle(ticks = 300) {
  const state = createState({ seed: 21, now: 0 });
  const config = buildBattleConfig(state.meta, 'riverfen', [], generateBattleMap, { seed: 21 });
  const battle = startBattle(config);
  for (let i = 0; i < ticks; i++) step(battle);
  return { battle, config };
}

test('a battle round-trips through storage exactly', () => {
  const storage = createMemoryStorage();
  const { battle, config } = liveBattle();
  assert.ok(saveBattle(storage, battle, config, NOW).ok);

  const got = loadBattle(storage, NOW + 1000);
  assert.ok(got.ok, `expected a resumable battle, got "${got.reason}"`);
  assert.deepEqual(got.battle, JSON.parse(JSON.stringify(battle)), 'state must survive intact');
  assert.equal(got.battle.tick, battle.tick);
});

test('a resumed battle keeps stepping from where it stopped', () => {
  const storage = createMemoryStorage();
  const { battle, config } = liveBattle(200);
  saveBattle(storage, battle, config, NOW);

  const resumed = loadBattle(storage, NOW).battle;
  const before = resumed.tick;
  for (let i = 0; i < 50; i++) step(resumed);
  assert.equal(resumed.tick, before + 50, 'a restored battle must be a live battle');
  assert.ok(Number.isFinite(resumed.factions.player.goldCg));
});

test('a finished battle is never offered for resume', () => {
  const storage = createMemoryStorage();
  const { battle, config } = liveBattle(50);
  battle.status = 'win';
  assert.equal(saveBattle(storage, battle, config, NOW).ok, false, 'not written once decided');

  // Even if one were somehow on disk, it must not come back.
  storage.setItem(RESUME_KEY, JSON.stringify({
    contractVersion: CONTRACT_VERSION, savedAt: NOW, battle, config,
  }));
  const got = loadBattle(storage, NOW);
  assert.equal(got.ok, false);
  assert.equal(got.reason, 'already-finished');
});

test('clearing removes it', () => {
  const storage = createMemoryStorage();
  const { battle, config } = liveBattle(20);
  saveBattle(storage, battle, config, NOW);
  clearBattle(storage);
  assert.equal(loadBattle(storage, NOW).reason, 'empty');
});

// --- everything suspicious is DISCARDED, not preserved --------------------

test('a battle from an older contract is discarded, not stepped', () => {
  // The shape the simulation expects changed; replaying it would corrupt.
  const storage = createMemoryStorage();
  const { battle, config } = liveBattle(20);
  storage.setItem(RESUME_KEY, JSON.stringify({
    contractVersion: CONTRACT_VERSION - 1, savedAt: NOW, battle, config,
  }));
  const got = loadBattle(storage, NOW);
  assert.equal(got.ok, false);
  assert.equal(got.reason, 'stale-contract');
  assert.equal(storage.getItem(RESUME_KEY), null, 'discarded — unlike a save, this is not precious');
});

test('a stale battle does not ambush a player who moved on', () => {
  const storage = createMemoryStorage();
  const { battle, config } = liveBattle(20);
  saveBattle(storage, battle, config, NOW);
  const got = loadBattle(storage, NOW + RESUME_MAX_AGE_MS + 1);
  assert.equal(got.reason, 'too-old');
  assert.equal(storage.getItem(RESUME_KEY), null);
});

test('corrupt or incomplete blobs are discarded without throwing', () => {
  for (const raw of ['not json', 'null', '{}', '{"contractVersion":2}', '[]']) {
    const storage = createMemoryStorage();
    storage.setItem(RESUME_KEY, raw);
    const got = loadBattle(storage, NOW);
    assert.equal(got.ok, false, `"${raw}" must not resume`);
    assert.equal(storage.getItem(RESUME_KEY), null, `"${raw}" must be cleared`);
  }
});

test('an empty slot is not an error', () => {
  assert.equal(loadBattle(createMemoryStorage(), NOW).reason, 'empty');
});

test('unreadable storage never takes the boot down', () => {
  const hostile = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  };
  assert.doesNotThrow(() => loadBattle(hostile, NOW));
  assert.equal(loadBattle(hostile, NOW).ok, false);
  const { battle, config } = liveBattle(10);
  assert.doesNotThrow(() => saveBattle(hostile, battle, config, NOW));
  assert.equal(saveBattle(hostile, battle, config, NOW).ok, false);
  assert.doesNotThrow(() => clearBattle(hostile));
});

test('the resume slot never touches the save slot', () => {
  const storage = createMemoryStorage();
  storage.setItem('hexdominion.save', '{"kept":true}');
  const { battle, config } = liveBattle(20);
  saveBattle(storage, battle, config, NOW);
  clearBattle(storage);
  assert.equal(storage.getItem('hexdominion.save'), '{"kept":true}',
    'progress must be untouched by an ephemeral battle blob');
});
