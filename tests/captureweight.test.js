// A CAPTURE SHOULD FEEL LIKE WHAT IT COST, and for the life of the project it
// did not. `site-captured` has carried `kind` since the event was written and
// `fxFromEvent` never read it, so taking an undefended farm and breaking the
// enemy's throne — the literal win condition — fired pixel-identical bursts,
// differing only in tint. It was found by calling the shipped function with two
// events differing ONLY in `kind` and screenshotting both; the screenshots were
// indistinguishable. This file is that probe, as an assertion.
//
// It pins PROPERTIES rather than the numbers themselves — monotonicity, that
// the kind is read at all, that a farm is unchanged — because the constants are
// a look and the look is allowed to be retuned. What is not allowed is the
// ladder collapsing back to one rung, which is what happened by omission.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFx, fxFromEvent } from '../src/render/fx.js';
import { SITE_KINDS } from '../src/content/balance.js';

const PALETTE = {
  owner: { player: '#3ddc97', enemy: '#ff5c5c', neutral: '#6b7688' },
  accent: '#fff', warn: '#e8b64c', danger: '#f0463e', gold: '#e8b64c', text: '#fff',
};

/** A recording stand-in for the particle pool: `fxFromEvent` only ever spawns. */
function recorder() {
  const spawns = [];
  return { spawns, spawn: (kind, x, y, o) => { spawns.push({ kind, x, y, ...o }); } };
}

const capture = (kind, to = 'player') => {
  const fx = recorder();
  fxFromEvent(fx, { type: 'site-captured', kind, from: 'enemy', to, x: 0, y: 0 }, PALETTE, 34);
  return fx.spawns;
};

/** The loudest thing a capture does: the biggest radius it puts on the board. */
const reach = (spawns) => Math.max(...spawns.map((s) => s.r1 ?? 0));

test('a capture reads `kind` at all — two events differing only in kind differ', () => {
  // The negative control, and the whole finding: this assertion fails against
  // every build before this one, because `kind` was never in the switch.
  const farm = capture('farm');
  const castle = capture('castle');
  assert.notDeepEqual(farm, castle,
    'a farm and the enemy throne produced byte-identical effects');
});

test('...and it escalates monotonically, farm -> stronghold -> castle', () => {
  const farm = reach(capture('farm'));
  const hold = reach(capture('stronghold'));
  const throne = reach(capture('castle'));
  assert.ok(hold > farm, `stronghold ${hold} should out-reach farm ${farm}`);
  assert.ok(throne > hold, `castle ${throne} should out-reach stronghold ${hold}`);
});

test('the objective gets a SECOND ring, not merely a bigger one', () => {
  // Scaling one ring further just makes it faster and thinner at the same
  // moment. A second arrival is what reads as a different KIND of event.
  const rings = (k) => capture(k).filter((s) => s.kind === 'shock').length;
  assert.equal(rings('farm'), 1);
  assert.equal(rings('stronghold'), 1);
  assert.equal(rings('castle'), 2, 'the throne should ring twice');
  assert.equal(rings('camp'), 2, 'and so should losing your own camp');
});

test('a farm capture is UNCHANGED — this is a ladder, not a global buff', () => {
  // Tier 0 must multiply by exactly 1. If the whole table drifted upward the
  // monotonicity test above would still pass while every capture in the game
  // got louder, which is a different change from the one intended.
  const farm = capture('farm');
  const wash = farm.find((s) => s.kind === 'wash');
  const shock = farm.find((s) => s.kind === 'shock');
  const burst = farm.find((s) => s.kind === 'burst');
  assert.equal(wash.r1, 34 * 3, 'the wash is what it always was');
  assert.equal(wash.life, 0.42);
  assert.equal(shock.r1, 34 * 2.4);
  assert.equal(burst.n, 10);
});

test('every site kind names itself without falling through to undefined', () => {
  // `SITE_KINDS` is derived from SITES, so a kind added later arrives here
  // automatically rather than silently floating an empty string.
  for (const kind of SITE_KINDS) {
    for (const to of ['player', 'enemy']) {
      const word = capture(kind, to).find((s) => s.kind === 'float')?.text;
      assert.ok(typeof word === 'string' && word.length > 0, `${kind} -> ${to}: ${word}`);
    }
  }
});

test('the throne and the camp say so; an ordinary site does not', () => {
  const wordOf = (k, to) => capture(k, to).find((s) => s.kind === 'float').text;
  assert.match(wordOf('castle', 'player'), /THRONE/);
  // A capture event means it CHANGED HANDS, so the enemy taking the castle back
  // is a loss for the player, not a successful defence.
  assert.match(wordOf('castle', 'enemy'), /THRONE LOST/);
  assert.match(wordOf('camp', 'enemy'), /CAMP LOST/);
  assert.equal(wordOf('farm', 'player'), 'TAKEN');
  assert.equal(wordOf('farm', 'enemy'), 'LOST');
});

test('`delay` is honoured rather than silently ignored', () => {
  // The second ring passes `delay`, and `spawn` had no such option — an
  // unimplemented field is this project's most-repeated defect, so the guard is
  // that a delayed effect draws NOTHING before its time and something after.
  const fx = createFx({ max: 8 });
  fx.spawn('shock', 0, 0, { color: '#fff', life: 0.5, r0: 1, r1: 2, delay: 0.2 });
  let strokes = 0;
  const ctx = new Proxy({}, {
    get: (_t, k) => (k === 'stroke' || k === 'fill' ? () => { strokes++; } : () => {}),
    set: () => true,
  });
  fx.update(0.1);
  fx.draw(ctx, PALETTE, 1);
  assert.equal(strokes, 0, 'it must not draw before its delay has elapsed');
  fx.update(0.2);           // t = +0.1, started
  fx.draw(ctx, PALETTE, 1);
  assert.ok(strokes > 0, 'and it must draw once it has');
});

test('an undelayed effect is untouched by the delay support', () => {
  // The negative control for the change above: every existing spawn omits
  // `delay`, and must still start on the frame it was created.
  const fx = createFx({ max: 8 });
  fx.spawn('shock', 0, 0, { color: '#fff', life: 0.5, r0: 1, r1: 2 });
  let strokes = 0;
  const ctx = new Proxy({}, {
    get: (_t, k) => (k === 'stroke' || k === 'fill' ? () => { strokes++; } : () => {}),
    set: () => true,
  });
  fx.update(0.05);
  fx.draw(ctx, PALETTE, 1);
  assert.ok(strokes > 0, 'an ordinary effect still draws immediately');
});
