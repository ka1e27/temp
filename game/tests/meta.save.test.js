import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SAVE_KEY, serialize, deserialize, migrate, exportCode, importCode, saveTo, loadFrom, hasValidOwnerTable,
} from '../meta/save.js';
import { createGame } from '../meta/state.js';
import { makeWorld } from './meta.fixtures.js';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

test('SAVE_KEY matches ARCHITECTURE §5', () => {
  assert.equal(SAVE_KEY, 'hexdominion.v2');
});

test('serialize/deserialize: exact round trip of a real game state', () => {
  const world = makeWorld();
  const state = createGame(3, world, 9000);
  state.gold = 123.5;
  const restored = deserialize(serialize(state));
  assert.deepEqual(restored, state);
});

test('migrate: fills every missing field with a sane default', () => {
  const restored = migrate({});
  assert.equal(restored.version, 1);
  assert.equal(restored.gold, 0);
  assert.deepEqual(restored.owner, []);
  assert.deepEqual(restored.upgrades, { rally: 1 });
  assert.equal(restored.stats.bestBattleSec, null);
  assert.equal(restored.settings.sound, true);
  assert.equal(restored.tutorial.done, false);
  assert.equal(restored.battle, null);
});

test('migrate: a partial save keeps what it has and fills only what\'s missing', () => {
  const restored = migrate({ gold: 42, owner: [0, 1], settings: { sound: false } });
  assert.equal(restored.gold, 42);
  assert.deepEqual(restored.owner, [0, 1]);
  assert.equal(restored.settings.sound, false);
  assert.equal(restored.settings.reduceMotion, false); // filled in
});

test('deserialize: never throws on garbage input, and returns null for it', () => {
  assert.doesNotThrow(() => deserialize('not json at all {{{'));
  assert.equal(deserialize('not json at all {{{'), null);
  assert.equal(deserialize(''), null);
  assert.equal(deserialize('null'), null);
  assert.equal(deserialize('42'), null);
  assert.equal(deserialize('[1,2,3]'), null);
});

test('deserialize: anything without a valid owner table is not a save', () => {
  assert.equal(deserialize('{}'), null, 'empty object');
  assert.equal(deserialize(JSON.stringify({ seed: 5, gold: 10 })), null, 'no owner table');
  assert.equal(deserialize(JSON.stringify({ seed: 5, owner: [] })), null, 'empty owner table');
  assert.equal(deserialize(JSON.stringify({ seed: 5, owner: [0, 'x', 1] })), null, 'non-numeric owner');
  assert.equal(deserialize(JSON.stringify({ seed: 5, owner: [0, -1] })), null, 'negative faction id');
  assert.equal(deserialize(JSON.stringify({ seed: 5, owner: [0, 1.5] })), null, 'fractional faction id');
  const ok = deserialize(JSON.stringify({ seed: 5, gold: 3, owner: [0, 1, 2] }));
  assert.ok(ok, 'a minimal real save loads');
  assert.equal(ok.gold, 3);
  assert.equal(ok.settings.sound, true, 'optional fields still migrate to defaults');
});

test('hasValidOwnerTable', () => {
  assert.equal(hasValidOwnerTable({ owner: [0] }), true);
  assert.equal(hasValidOwnerTable({ owner: [] }), false);
  assert.equal(hasValidOwnerTable(null), false);
  assert.equal(hasValidOwnerTable([]), false);
  assert.equal(hasValidOwnerTable('x'), false);
});

test('exportCode/importCode: round trips a real state through base64', () => {
  const world = makeWorld();
  const state = createGame(5, world, 4321);
  state.gold = 777;
  const code = exportCode(state);
  assert.equal(typeof code, 'string');
  assert.doesNotMatch(code, /[^A-Za-z0-9+/=]/, 'looks like base64');
  const restored = importCode(code);
  assert.deepEqual(restored, state);
});

test('importCode: tolerant of whitespace and newlines pasted into the code', () => {
  const world = makeWorld();
  const state = createGame(1, world, 1);
  const code = exportCode(state);
  const messy = code.slice(0, 10) + '\n  \t' + code.slice(10, 20) + '\n' + code.slice(20);
  const restored = importCode(messy);
  assert.deepEqual(restored, state);
});

test('importCode: never throws on completely invalid input, and returns null for it', () => {
  assert.doesNotThrow(() => importCode('!!! not valid base64 at all ###'));
  assert.doesNotThrow(() => importCode(''));
  assert.equal(importCode('!!! not valid base64 at all ###'), null);
  assert.equal(importCode(''), null);
  assert.equal(importCode('garbage!!'), null);
  assert.equal(importCode('aGVsbG8gd29ybGQ='), null, 'valid base64 of non-JSON text is not a save');
});

test('saveTo/loadFrom: round trips through injected storage', () => {
  const world = makeWorld();
  const state = createGame(2, world, 555);
  const storage = memoryStorage();
  saveTo(storage, state);
  const restored = loadFrom(storage);
  assert.deepEqual(restored, state);
});

test('loadFrom: returns null when nothing has been saved yet', () => {
  assert.equal(loadFrom(memoryStorage()), null);
});

test('loadFrom: corrupt or blank storage is null, not a blank default state', () => {
  for (const junk of ['{not json', '', '{}', '{"owner":[]}', 'null', '[]']) {
    const storage = memoryStorage();
    storage.setItem(SAVE_KEY, junk);
    assert.equal(loadFrom(storage), null, `junk ${JSON.stringify(junk)}`);
  }
});

// --- per-dynasty feature fields: crowns, metFactions, intel, prosperity -------------------------

test('round trip: crowns, metFactions, intel and prosperity survive save and load exactly', () => {
  const world = makeWorld();
  const state = createGame(5, world, 100);
  state.crowns[1] = { victory: true, swift: true, unbroken: false };
  state.crowns[2] = { victory: true, swift: false, unbroken: false };
  state.metFactions = [2, 3];
  state.intel = { 1: { scouted: true, sabotage: 0 }, 2: { scouted: true, sabotage: 2 } };
  state.prosperity = [0, 1, 3, 0];
  const restored = deserialize(serialize(state));
  assert.deepEqual(restored, state);
  assert.deepEqual(importCode(exportCode(state)), state);
});

test('migrate: an old save without the feature fields gets tolerant defaults', () => {
  const restored = migrate({ owner: [0, 1, 1], gold: 5 });
  assert.deepEqual(restored.crowns, []);
  assert.deepEqual(restored.metFactions, []);
  assert.deepEqual(restored.intel, {});
  assert.deepEqual(restored.prosperity, []);
});

test('migrate: junk in the feature fields is cleaned, never thrown on', () => {
  const restored = migrate({
    owner: [0, 1],
    crowns: [null, 'x', 7, { victory: 1, swift: 'yes' }, { victory: true, swift: false, unbroken: true, extra: 9 }, []],
    metFactions: [2, 2, -1, 1.5, 'a', null, 3],
    intel: { 1: { scouted: true, sabotage: 1 }, x: { scouted: true }, 2: 'junk', 3: { sabotage: 99 }, 4: {} },
    prosperity: [1, 'a', -3, 2.5, 400, null, 2],
  });
  assert.deepEqual(restored.crowns, [
    null, null, null,
    { victory: true, swift: true, unbroken: false },
    { victory: true, swift: false, unbroken: true },
    null,
  ]);
  assert.deepEqual(restored.metFactions, [2, 3]);
  assert.deepEqual(Object.keys(restored.intel).sort(), ['1', '3']);
  assert.equal(restored.intel[1].sabotage, 1);
  assert.equal(restored.intel[3].scouted, true, 'sabotage implies scouted');
  assert.deepEqual(restored.prosperity, [1, 0, 0, 0, 99, 0, 2]);
  for (const bad of ['crowns', 'metFactions', 'intel', 'prosperity']) {
    for (const junk of [null, 5, 'str', true]) {
      const r = migrate({ owner: [0], [bad]: junk });
      assert.ok(bad === 'intel' ? typeof r.intel === 'object' && !Array.isArray(r.intel) : Array.isArray(r[bad]), `${bad}: ${JSON.stringify(junk)}`);
    }
  }
});

test('a new realm starts with empty per-dynasty feature state', () => {
  const state = createGame(1, makeWorld(), 0);
  assert.equal(state.crowns.every((c) => c === null), true);
  assert.deepEqual(state.metFactions, []);
  assert.deepEqual(state.intel, {});
  assert.deepEqual(state.prosperity, []);
});
