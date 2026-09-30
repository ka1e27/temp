import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmitter } from '../core/events.js';

test('on/emit delivers the payload to a listener', () => {
  const e = createEmitter();
  const seen = [];
  e.on('capture', (p) => seen.push(p));
  e.emit('capture', { site: 3 });
  assert.deepEqual(seen, [{ site: 3 }]);
});

test('multiple listeners on the same type all fire, in registration order', () => {
  const e = createEmitter();
  const seen = [];
  e.on('x', () => seen.push('a'));
  e.on('x', () => seen.push('b'));
  e.emit('x');
  assert.deepEqual(seen, ['a', 'b']);
});

test('emit on a type with no listeners does not throw', () => {
  const e = createEmitter();
  assert.doesNotThrow(() => e.emit('nothing', 1));
});

test('on() returns an unsubscribe function', () => {
  const e = createEmitter();
  const seen = [];
  const off = e.on('x', (p) => seen.push(p));
  e.emit('x', 1);
  off();
  e.emit('x', 2);
  assert.deepEqual(seen, [1]);
});

test('a listener unsubscribing itself mid-emit does not affect the current dispatch', () => {
  const e = createEmitter();
  const seen = [];
  let off;
  off = e.on('x', (p) => {
    seen.push(`self:${p}`);
    off();
  });
  e.on('x', (p) => seen.push(`other:${p}`));
  e.emit('x', 1);
  assert.deepEqual(seen, ['self:1', 'other:1']);
  e.emit('x', 2);
  assert.deepEqual(seen, ['self:1', 'other:1', 'other:2']);
});

test('different event types are independent', () => {
  const e = createEmitter();
  const seen = [];
  e.on('a', () => seen.push('a'));
  e.on('b', () => seen.push('b'));
  e.emit('a');
  assert.deepEqual(seen, ['a']);
});
