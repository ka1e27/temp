// The scene stack. The assertion that earns this file its place is the last
// one: a scene's bus subscriptions are torn down automatically on exit, because
// a leaked subscription is what makes "the shop updates twice" and nobody can
// ever reproduce it.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createSceneStack } from '../src/core/scenes.js';
import { createBus } from '../src/core/bus.js';

/** A scene that records every lifecycle call into a shared log. */
function probe(id, log, opts = {}) {
  return {
    id,
    keepVisible: opts.keepVisible ?? false,
    enter(params) {
      log.push(`${id}:enter${params ? `(${JSON.stringify(params)})` : ''}`);
      return opts.offs ?? [];
    },
    exit() { log.push(`${id}:exit`); },
    update(dt) { log.push(`${id}:update:${dt}`); },
    render(alpha) { log.push(`${id}:render:${alpha}`); },
  };
}

test('push / replace / pop drive enter and exit exactly once each', () => {
  const log = [];
  const st = createSceneStack();
  st.push(probe('map', log), { region: 'riverfen' });
  assert.deepEqual(st.ids, ['map']);
  st.push(probe('shop', log));
  assert.deepEqual(st.ids, ['map', 'shop']);
  assert.equal(st.top.id, 'shop');
  assert.equal(st.depth, 2);
  assert.equal(st.has('map'), true);

  st.pop();
  assert.deepEqual(st.ids, ['map']);
  st.replace(probe('battle', log));
  assert.deepEqual(st.ids, ['battle']);
  st.clear();
  assert.deepEqual(st.ids, []);

  // replace() exits the outgoing scene BEFORE entering the incoming one, so two
  // scenes never both hold the same canvas / input handlers for a frame.
  assert.deepEqual(log, [
    'map:enter({"region":"riverfen"})', 'shop:enter', 'shop:exit',
    'map:exit', 'battle:enter', 'battle:exit',
  ]);
});

test('only the TOP scene updates; everything below is frozen', () => {
  const log = [];
  const st = createSceneStack();
  st.push(probe('map', log));
  st.push(probe('shop', log, { keepVisible: true }));
  st.update(100);
  assert.deepEqual(log.filter((l) => l.includes('update')), ['shop:update:100']);
});

test('keepVisible draws the scene below, bottom-up', () => {
  const log = [];
  const st = createSceneStack();
  st.push(probe('map', log));
  st.push(probe('shop', log, { keepVisible: true }));
  st.render(0.5);
  assert.deepEqual(log.filter((l) => l.includes('render')), ['map:render:0.5', 'shop:render:0.5']);

  // An opaque overlay hides what is behind it.
  const log2 = [];
  const st2 = createSceneStack();
  st2.push(probe('map', log2));
  st2.push(probe('battle', log2, { keepVisible: false }));
  st2.render(0);
  assert.deepEqual(st2.visible().map((s) => s.id), ['battle']);
  assert.deepEqual(log2.filter((l) => l.includes('render')), ['battle:render:0']);
});

test('an empty stack updates and renders without throwing', () => {
  const st = createSceneStack();
  assert.deepEqual(st.visible(), []);
  assert.equal(st.top, null);
  assert.equal(st.pop(), null);
  st.update(16);
  st.render(0);
});

test('enter() must return an array of unsubscribers, and they ALL run on exit', () => {
  const bus = createBus();
  const st = createSceneStack();
  let repaints = 0;

  const shop = {
    id: 'shop',
    enter() {
      return [
        bus.on('meta:crowns', () => { repaints += 1; }),
        bus.on('meta:upgrade-purchased', () => { repaints += 1; }),
      ];
    },
  };

  st.push(shop);
  bus.emit('meta:crowns');
  bus.emit('meta:upgrade-purchased');
  assert.equal(repaints, 2);

  st.pop();
  bus.emit('meta:crowns');
  bus.emit('meta:upgrade-purchased');
  assert.equal(repaints, 2, 'a popped scene must not still be listening');

  // The classic bug this prevents: push the same scene twice and every event
  // fires its handler twice forever.
  st.push(shop); st.pop();
  st.push(shop); st.pop();
  bus.emit('meta:crowns');
  assert.equal(repaints, 2);
});

test('unsubscribers run BEFORE exit(), so a late event cannot hit a dead scene', () => {
  const order = [];
  const st = createSceneStack();
  st.push({
    id: 'x',
    enter: () => [() => order.push('unsub')],
    exit: () => order.push('exit'),
  });
  st.pop();
  assert.deepEqual(order, ['unsub', 'exit']);
});

test('a throwing scene is reported through onError instead of wedging the stack', () => {
  const seen = [];
  const st = createSceneStack({ onError: (e, phase, id) => seen.push(`${id}:${phase}`) });
  st.push({
    id: 'bad',
    enter() { throw new Error('boom'); },
    update() { throw new Error('boom'); },
    render() { throw new Error('boom'); },
    exit() { throw new Error('boom'); },
  });
  st.update(16);
  st.render(0);
  st.pop();
  assert.deepEqual(seen, ['bad:enter', 'bad:update', 'bad:render', 'bad:exit']);
  assert.equal(st.depth, 0, 'the stack still unwound cleanly');
});

test('returning something other than unsubscribers is flagged, not ignored', () => {
  const seen = [];
  const st = createSceneStack({ onError: (e) => seen.push(e.message) });
  st.push({ id: 'sloppy', enter: () => ({ off: () => {} }) });
  assert.equal(seen.length, 1);
  assert.match(seen[0], /must return an array of unsubscribe functions/);
  // A single function is still accepted as a convenience.
  let closed = false;
  const st2 = createSceneStack();
  st2.push({ id: 'one', enter: () => () => { closed = true; } });
  st2.pop();
  assert.equal(closed, true);
});
