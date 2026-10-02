// Pure parts of the fresh-eyes playtest fixes (the browser half is tools/playtestChecks.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chanceWords } from '../app/chanceWords.js';
import { regionHintBox, regionLabelBox, overlapArea } from '../app/hintTargets.js';
import { RULES } from '../app/tutorialRules.js';
import { swiftDeadlineSec, parFor } from '../meta/crowns.js';
import { PAR } from '../config/crowns.js';
import { sanitizeSettings } from '../meta/save.js';
import { defaultSettings } from '../meta/state.js';
import { formatRate, formatPercent, formatSigned, formatClock } from '../ui/format.js';
import { placeHint } from '../ui/coach.js';
import { buildTestWorld } from './fixtures/battle-world.js';

test('5: the win chance is said in a few plain words', () => {
  assert.equal(chanceWords(0.2), 'about 1 in 5');
  assert.equal(chanceWords(0.5), 'about even');
  assert.equal(chanceWords(0.8), 'about 4 in 5');
  assert.equal(chanceWords(0.01), 'almost no chance');
  assert.equal(chanceWords(0.99), 'almost certain');
  assert.equal(chanceWords(NaN), 'unknown');
  let last = -1;
  for (let p = 0; p <= 1; p += 0.01) { const w = chanceWords(p); assert.equal(typeof w, 'string'); last = p; }
  assert.ok(last > 0.99);
});

test('1: the box a region hint keeps clear is the region on screen, not its label; a bubble placed beside it never overlaps it', () => {
  const bbox = { minX: 10, minY: 10, maxX: 14, maxY: 13 };
  const zoom = 30;
  const toScreen = (x, y) => ({ x: (x - 8) * zoom + 100, y: (y - 8) * zoom + 80 });
  const v = { w: 1200, h: 800 };
  const label = toScreen(12, 11.5);
  const box = regionHintBox(bbox, toScreen, v, label);
  const labelBox = regionLabelBox(label);
  assert.ok(box.w > labelBox.w * 1.5 && box.h > labelBox.h * 3, `the region box (${Math.round(box.w)}x${Math.round(box.h)}) is much bigger than the label box (${labelBox.w}x${labelBox.h})`);
  assert.ok(box.x <= labelBox.x && box.x + box.w >= labelBox.x + labelBox.w, 'it holds the label');
  const bubble = { w: 280, h: 64 };
  const placed = placeHint(bubble, box, v, { prefer: 'below' });
  assert.ok(placed, 'a side is found');
  assert.equal(overlapArea({ x: placed.x, y: placed.y, w: bubble.w, h: bubble.h }, box, -1), 0, 'the bubble sits clear of the whole region');
});

test('1: zoomed in until the region is most of the screen, the box is capped so a side is always left for the bubble', () => {
  const bbox = { minX: 0, minY: 0, maxX: 20, maxY: 20 };
  const toScreen = (x, y) => ({ x: x * 60 - 200, y: y * 60 - 200 });
  const v = { w: 800, h: 600 };
  const box = regionHintBox(bbox, toScreen, v, { x: 400, y: 300 });
  assert.ok(box.w <= v.w * 0.55 + 1 && box.h <= v.h * 0.55 + 1, `capped: ${Math.round(box.w)}x${Math.round(box.h)}`);
  assert.ok(placeHint({ w: 232, h: 64 }, box, v, {}), 'and a bubble fits beside it');
});

test('11: the supply-line hint waits for the first capture of THIS battle', () => {
  const facts = (over) => ({ live: true, battlesBefore: 1, captured: 0, ...over });
  assert.equal(RULES.C1(facts({ captured: 0 })), false, 'not at 0:02 of the second battle');
  assert.equal(RULES.C1(facts({ captured: 1 })), true);
  assert.equal(RULES.C1(facts({ captured: 1, battlesBefore: 0 })), false, 'never in the very first battle');
});

test('7: the Swift countdown counts to par plus the tolerance', () => {
  const world = buildTestWorld();
  const par = parFor(world, 1);
  assert.equal(swiftDeadlineSec(world, 1), par + PAR.toleranceSec);
  assert.ok(swiftDeadlineSec(world, 1) > 30);
});

test('8: Slow battles is a saved setting; an old save left on 0.5x keeps it available', () => {
  assert.equal(defaultSettings().slowBattles, false);
  assert.equal(sanitizeSettings(undefined).slowBattles, false);
  assert.equal(sanitizeSettings({ slowBattles: true }).slowBattles, true);
  assert.equal(sanitizeSettings({ slowBattles: 'yes' }).slowBattles, false);
  assert.equal(sanitizeSettings({ speed: 0.5 }).slowBattles, true, 'an old assist-speed save');
  assert.equal(sanitizeSettings({ speed: 2 }).slowBattles, false);
});

test('robustness: the UI formatters never print NaN', () => {
  for (const bad of [NaN, Infinity, undefined, 'x']) {
    assert.equal(formatRate(bad), '—');
    assert.equal(formatPercent(bad), '—');
    assert.equal(formatSigned(bad), '—');
    assert.equal(formatClock(bad), '—');
  }
  assert.equal(formatRate(2.34), '2.3');
  assert.equal(formatPercent(0.125, 1), '12.5%');
});
