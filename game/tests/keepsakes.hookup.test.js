// Keepsakes wiring (docs/briefs/keepsakes-hookup.md): the Chronicle lives in the save, survives a reload, an import and a new dynasty, and the container
// writes the dynasty line. (The story's own rules are meta.chronicle.test.js; the real Realm panel is tools/gallery/keepsakes-check.mjs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame } from '../meta/state.js';
import { serialize, deserialize, exportCode, importCode, migrate } from '../meta/save.js';
import { recordChronicle, chronicleEntries, lifetimeHighlights, createChronicle } from '../meta/chronicle.js';
import { createStateContainer } from '../app/stateContainer.js';
import { makeWorld } from './meta.fixtures.js';

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
}

test('a new game carries an empty chronicle', () => {
  const s = createGame(3, makeWorld(), 1000);
  assert.deepEqual(s.chronicle, createChronicle());
});

test('the chronicle round-trips through the save, the export code and an old save without one', () => {
  const s = createGame(3, makeWorld(), 1000);
  recordChronicle(s, { kind: 'firstConquest', t: 5000, data: { region: 'Dunspire' } });
  assert.equal(chronicleEntries(s).length, 1, 'the control: the entry was recorded');
  const back = deserialize(serialize(s));
  assert.equal(chronicleEntries(back).length, 1, 'survives deserialize(serialize(state))');
  assert.deepEqual(back.chronicle, s.chronicle);
  const imported = importCode(exportCode(s));
  assert.equal(chronicleEntries(imported).length, 1, 'survives export and import');
  const legacy = JSON.parse(serialize(s));
  delete legacy.chronicle;
  assert.deepEqual(migrate(legacy).chronicle, createChronicle(), 'a save from before the chronicle starts an empty story, nothing invented');
});

test('junk in the saved chronicle is repaired, never thrown on', () => {
  const s = JSON.parse(serialize(createGame(3, makeWorld(), 1000)));
  for (const junk of ['x', 5, [], { entries: 'no', lifetime: { a: 1 }, bestSec: 'fast', streak: -4, conquests: Infinity }, { entries: Array.from({ length: 5000 }, (_, i) => ({ kind: 'conquest', t: i })) }]) {
    s.chronicle = junk;
    let back;
    assert.doesNotThrow(() => { back = migrate(s); });
    assert.ok(Array.isArray(back.chronicle.entries) && Array.isArray(back.chronicle.lifetime));
    assert.ok(back.chronicle.entries.length <= 200, `capped: ${back.chronicle.entries.length}`);
    assert.ok(Number.isFinite(back.chronicle.streak) && back.chronicle.streak >= 0);
  }
});

test('founding a dynasty writes the new chapter\'s first line and keeps the lifetime highlights', () => {
  const storage = memoryStorage();
  const c = createStateContainer({ storage, now: () => 9_000_000 });
  c.boot();
  const { state, world } = c.get();
  state.owner = state.owner.map(() => 0); // the whole continent
  recordChronicle(state, { kind: 'firstConquest', t: 1000, data: { region: 'Home' } });
  const before = lifetimeHighlights(state).length;
  const res = c.tryFoundDynasty();
  assert.ok(res, 'the dynasty is founded');
  const next = c.get().state;
  assert.equal(next.dynasty.level, 2);
  const lines = chronicleEntries(next);
  assert.ok(lines.some((e) => e.kind === 'dynasty'), `this chapter opens with the dynasty line: ${lines.map((e) => e.kind)}`);
  assert.ok(lifetimeHighlights(next).length >= before, 'the lifetime highlights survive the new dynasty');
  assert.equal(world.regions.length > 0, true);
});

test('state.js and save.js import the chronicle leaf, never chronicle.js (an import cycle)', () => {
  for (const f of ['../meta/state.js', '../meta/save.js']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.match(src, /chronicleState\.js/, `${f} uses the leaf`);
    assert.doesNotMatch(src, /from '\.\/chronicle\.js'/, `${f} must not import chronicle.js`);
  }
});
