// Tutorial hints: the pure placement geometry (PLAYFEEL §4 placement rules), the shared target boxes, the save migration from the old linear
// tutorial, and the controls card. The real-browser half is tools/hints.mjs (every viewport, real input) and the per-frame monitor it loads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeHint, TIP_GAP } from '../ui/coach.js';
import { siteBox, siteHalf, regionLabelBox, unionBox, distPointBox, overlapArea, visibleFraction, boxOfRect } from '../app/hintTargets.js';
import { migrateTutorial } from '../meta/save.js';
import { CONTROLS } from '../ui/controls.js';
import { TUTORIAL_STEPS } from '../scenes/timing.js';
import { RULES } from '../app/tutorialRules.js';

const VIEWPORTS = [[1280, 720], [1440, 900], [1920, 1080], [1339, 863], [390, 844], [844, 390], [768, 1024]];
const BUBBLES = [{ w: 280, h: 58 }, { w: 232, h: 84 }, { w: 190, h: 110 }, { w: 156, h: 150 }];

/** A small deterministic generator so the cases are the same on every run. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

test('placeHint: whenever it places a hint, every rule holds (tip within 8 px, bubble off the target and on screen, tail on the bubble edge)', () => {
  const rnd = lcg(7);
  let placed = 0;
  let total = 0;
  for (const [vw, vh] of VIEWPORTS) {
    for (let i = 0; i < 400; i++) {
      const tw = 24 + rnd() * 330;
      const th = 24 + rnd() * 90;
      const t = { x: rnd() * (vw - tw), y: rnd() * (vh - th), w: tw, h: th };
      const b = BUBBLES[Math.floor(rnd() * BUBBLES.length)];
      const obstacles = rnd() < 0.5 ? [{ x: 0, y: 0, w: vw, h: 76 }, { x: vw - 380, y: 84, w: 368, h: 380 }] : [];
      total += 1;
      const p = placeHint(b, t, { w: vw, h: vh }, { obstacles });
      if (!p) continue;
      placed += 1;
      const box = { x: p.x, y: p.y, w: b.w, h: b.h };
      const where = `${vw}x${vh} target ${JSON.stringify(t)} bubble ${b.w}x${b.h} -> ${JSON.stringify(p)}`;
      assert.ok(p.x >= 7.5 && p.y >= 7.5 && p.x + b.w <= vw - 7.5 && p.y + b.h <= vh - 7.5, `on screen: ${where}`);
      assert.equal(overlapArea(box, t, 0), 0, `never covers the target: ${where}`);
      assert.ok(distPointBox({ x: p.tail.tipX, y: p.tail.tipY }, t) <= 8, `the tip ends within 8 px: ${where}`);
      assert.ok(distPointBox({ x: p.tail.tipX, y: p.tail.tipY }, t) >= TIP_GAP - 0.5 || overlapArea({ x: p.tail.tipX, y: p.tail.tipY, w: 0.1, h: 0.1 }, t, 0) === 0, `the tip stops short of the target: ${where}`);
      // the tail sits on the bubble's edge that faces the target and points at it
      if (p.tail.side === 'up') assert.ok(Math.abs(p.tail.y + p.tail.len - p.y) < 0.6 && p.tail.tipY < p.y, where);
      if (p.tail.side === 'down') assert.ok(Math.abs(p.tail.y - (p.y + b.h)) < 0.6 && p.tail.tipY > p.y + b.h, where);
      if (p.tail.side === 'left') assert.ok(Math.abs(p.tail.x + p.tail.len - p.x) < 0.6 && p.tail.tipX < p.x, where);
      if (p.tail.side === 'right') assert.ok(Math.abs(p.tail.x - (p.x + b.w)) < 0.6 && p.tail.tipX > p.x + b.w, where);
    }
  }
  assert.ok(placed / total > 0.85, `most targets can be pointed at (${placed} of ${total})`);
});

test('placeHint: a target at the very edge of the screen still gets a legal bubble (the tail slides along the edge)', () => {
  const v = { w: 1440, h: 900 };
  const gear = { x: 1372, y: 24, w: 42, h: 42 }; // the HUD's last button, hard against the right edge
  const p = placeHint({ w: 280, h: 60 }, gear, v, {});
  assert.ok(p);
  assert.ok(p.x + 280 <= v.w - 8 + 0.5);
  assert.ok(distPointBox({ x: p.tail.tipX, y: p.tail.tipY }, gear) <= 8);
});

test('placeHint: prefers the requested side when it is legal, and flips when it is not', () => {
  const v = { w: 1440, h: 900 };
  const t = { x: 700, y: 400, w: 60, h: 40 };
  assert.equal(placeHint({ w: 240, h: 60 }, t, v, { prefer: 'left' }).side, 'left');
  assert.equal(placeHint({ w: 240, h: 60 }, t, v, { prefer: 'above' }).side, 'above');
  // a target flush against the left edge cannot have a bubble on its left
  assert.notEqual(placeHint({ w: 240, h: 60 }, { x: 4, y: 400, w: 60, h: 40 }, v, { prefer: 'left' }).side, 'left');
});

test('placeHint: a bubble that cannot avoid a panel beside the target goes to the side where it covers nothing', () => {
  const v = { w: 1440, h: 900 };
  const button = { x: 1100, y: 400, w: 300, h: 44 }; // a card's Attack button on the right
  const card = { x: 1084, y: 90, w: 340, h: 380 }; // 16 px of padding round the button
  const p = placeHint({ w: 250, h: 50 }, button, v, { prefer: 'left', obstacles: [card] });
  assert.equal(p.side, 'left', 'beside the card, not over its text');
  assert.ok(p.overlap < 400, `at most the card's padding (${p.overlap} px squared)`);
});

test('shared target boxes: a settlement box scales with the zoom and never shrinks below a finger; union, distance, overlap and visibility behave', () => {
  assert.equal(siteHalf(10), 22);
  assert.ok(siteHalf(100) > siteHalf(40));
  const b = siteBox({ x: 100, y: 200 }, 64);
  assert.equal(b.w, 2 * siteHalf(64));
  assert.deepEqual(unionBox({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 5, w: 10, h: 10 }), { x: 0, y: 0, w: 30, h: 15 });
  assert.equal(distPointBox({ x: 5, y: 5 }, { x: 0, y: 0, w: 10, h: 10 }), 0);
  assert.equal(distPointBox({ x: 13, y: 14 }, { x: 0, y: 0, w: 10, h: 10 }), 5);
  assert.equal(overlapArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }, 0), 0);
  assert.ok(overlapArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 0, w: 10, h: 10 }, 0) > 0);
  assert.equal(visibleFraction({ x: -5, y: 0, w: 10, h: 10 }, 100, 100), 0.5);
  assert.equal(visibleFraction({ x: 200, y: 0, w: 10, h: 10 }, 100, 100), 0);
  assert.deepEqual(boxOfRect({ left: 1, top: 2, width: 3, height: 4 }), { x: 1, y: 2, w: 3, h: 4 });
  assert.equal(regionLabelBox({ x: 100, y: 100 }).w, 104);
});

test('migrateTutorial: the old linear tutorial becomes a set of seen steps, and a finished one keeps what it taught', () => {
  assert.deepEqual(migrateTutorial(undefined), { seen: {}, done: false });
  assert.deepEqual(migrateTutorial({ step: 0, done: false }), { seen: {}, done: false });
  assert.deepEqual(Object.keys(migrateTutorial({ step: 3, done: false }).seen).sort(), ['W0', 'W1', 'W2', 'W3']);
  assert.deepEqual(Object.keys(migrateTutorial({ step: 4, done: false }).seen).sort(), ['B1', 'W0', 'W1', 'W2', 'W3']);
  const finished = migrateTutorial({ step: 6, done: true });
  assert.equal(finished.done, false, 'a player who finished the old tutorial still gets the NEW steps when they become relevant');
  assert.deepEqual(Object.keys(finished.seen).sort(), ['B1', 'B3', 'B5', 'M1', 'W0', 'W1', 'W2', 'W3']);
  // the new shape passes through, junk is dropped
  assert.deepEqual(migrateTutorial({ seen: { W0: true, B2: true, nonsense: true, X: false }, done: true }), { seen: { W0: true, B2: true }, done: true });
});

test('the step table and the rules agree: every step has a rule, a scene and a way to be seen; ids are unique', () => {
  const ids = TUTORIAL_STEPS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of TUTORIAL_STEPS) {
    assert.ok(RULES[s.id], `a rule for ${s.id}`);
    assert.ok(s.scene === 'world' || s.scene === 'battle');
    // a step is seen by something the player does (`seenOn`) or by its own timeout (C2 leaves after 6 s, per PLAYFEEL §4)
    assert.ok(s.text.length > 10 && (s.seenOn.length > 0 || s.timeoutSec > 0), s.id);
    for (const a of s.after || []) assert.ok(ids.indexOf(a) >= 0 && ids.indexOf(a) < ids.indexOf(s.id), `${s.id} comes after ${a} in the table`);
  }
  assert.deepEqual(Object.keys(RULES).sort(), [...ids].sort());
});

test('the controls card lists every control, in both columns', () => {
  const all = (rows) => rows.map(([k, v]) => `${k} ${v}`).join(' | ');
  const mouse = all(CONTROLS.mouse);
  const touch = all(CONTROLS.touch);
  for (const need of ['Drag', 'Scroll', 'Shift-drag', 'Ctrl-drag', 'Auto', 'Q W E R T', 'Space', 'Right-click / Esc', '1 2 3 4', 'A ']) assert.ok(mouse.includes(need), `mouse column mentions ${need}`);
  for (const need of ['Pinch', 'Long-press', 'Auto', 'Tap', 'Powers', 'Pause and speed', 'Size bar']) assert.ok(touch.includes(need), `touch column mentions ${need}`);
  assert.match(mouse, /supply line/);
  assert.match(touch, /supply line/);
});

test('placeHint: a control sitting between the bubble and its target is crossed by a longer tail, not covered by the bubble', () => {
  const v = { w: 390, h: 844 };
  const rally = { x: 20, y: 770, w: 54, h: 54 }; // a power button on the bottom row
  const sizeRow = { x: 12, y: 690, w: 366, h: 56 }; // the send-size buttons right above it
  const otherPowers = { x: 82, y: 770, w: 296, h: 54 }; // the four other power buttons beside it
  const p = placeHint({ w: 232, h: 84 }, rally, v, { prefer: 'above', obstacles: [sizeRow, otherPowers] });
  assert.ok(p, 'a legal spot exists');
  assert.equal(p.overlap, 0, 'the bubble covers nothing');
  assert.ok(p.tail.len > 10, `the tail reaches across the row (${p.tail.len} px)`);
  assert.ok(distPointBox({ x: p.tail.tipX, y: p.tail.tipY }, rally) <= 8);
});
