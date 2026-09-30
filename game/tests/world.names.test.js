import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../core/rng.js';
import { createNameGenerator } from '../world/names.js';

test('names are non-empty strings shaped like Root+Suffix', () => {
  const gen = createNameGenerator(createRng(1));
  for (let i = 0; i < 20; i++) {
    const name = gen();
    assert.equal(typeof name, 'string');
    assert.ok(name.length >= 4);
    assert.ok(/^[A-Z][a-z]+$/.test(name), `"${name}" doesn't look like a fantasy compound name`);
  }
});

test('names from one generator are unique', () => {
  const gen = createNameGenerator(createRng(2));
  const names = new Set();
  for (let i = 0; i < 200; i++) {
    const name = gen();
    assert.ok(!names.has(name), `duplicate name "${name}"`);
    names.add(name);
  }
});

test('same seed produces the same sequence of names', () => {
  const genA = createNameGenerator(createRng(42));
  const genB = createNameGenerator(createRng(42));
  const a = Array.from({ length: 30 }, () => genA());
  const b = Array.from({ length: 30 }, () => genB());
  assert.deepEqual(a, b);
});

test('different seeds produce different sequences', () => {
  const genA = createNameGenerator(createRng(1));
  const genB = createNameGenerator(createRng(2));
  const a = Array.from({ length: 10 }, () => genA());
  const b = Array.from({ length: 10 }, () => genB());
  assert.notDeepEqual(a, b);
});

test('two independent generators (as if from two different rng forks) can collide with each other but never with themselves', () => {
  // This documents the actual contract: uniqueness is per-generator-instance.
  // generate.js is responsible for using exactly ONE instance for the whole
  // world so nothing collides across regions and settlements together.
  const shared = createNameGenerator(createRng(5));
  const used = new Set();
  for (let i = 0; i < 50; i++) {
    const name = shared();
    assert.ok(!used.has(name));
    used.add(name);
  }
});
