// The parts of the crowns / leaders UI that need no browser: the pure helpers the components are
// built on, the crown-pip canvas drawing (against a recording stub context), and a guarantee that
// the component modules can be imported without touching the DOM. The real-browser behaviour
// (award timing, Reduce Motion, click-through, auto-hide, phone fit) is asserted by
// tools/gallery/features-check.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { awardOrder, swiftLabel, CROWN_SLOTS } from '../ui/crownRow.js';
import { drawCrownPips } from '../render/crownPips.js';
import { CROWN_KEYS } from '../config/crowns.js';

/** A canvas 2D context that only records what was asked of it. */
function stubCtx({ scale = 1 } = {}) {
  const calls = [];
  const rec = (name) => (...args) => { calls.push([name, ...args]); };
  const ctx = {
    calls,
    globalAlpha: 1,
    getTransform: () => ({ a: scale, d: scale }),
    createLinearGradient: () => ({ addColorStop() {} }),
  };
  for (const n of ['save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'arc']) ctx[n] = rec(n);
  return ctx;
}

const count = (ctx, name) => ctx.calls.filter((c) => c[0] === name).length;

test('crown slots follow the crown keys, in order', () => {
  assert.deepEqual(CROWN_SLOTS.map((s) => s.key), [...CROWN_KEYS]);
});

test('awardOrder: earned crowns in display order, nothing for null', () => {
  assert.deepEqual(awardOrder(null), []);
  assert.deepEqual(awardOrder({ victory: true, swift: false, unbroken: true }), ['victory', 'unbroken']);
  assert.deepEqual(awardOrder({ victory: true, swift: true, unbroken: true }), ['victory', 'swift', 'unbroken']);
  assert.deepEqual(awardOrder({ victory: false, swift: false, unbroken: false }), []);
});

test('swiftLabel: par as m:ss', () => {
  assert.equal(swiftLabel(60), 'Swift ≤ 1:00');
  assert.equal(swiftLabel(90), 'Swift ≤ 1:30');
  assert.equal(swiftLabel(150), 'Swift ≤ 2:30');
});

test('drawCrownPips: draws one outlined, filled pip per crown and reports its size', () => {
  for (const n of [1, 2, 3]) {
    const ctx = stubCtx();
    const size = drawCrownPips(ctx, 100, 50, n, 12);
    assert.equal(count(ctx, 'stroke') >= n, true);
    // each gold pip is filled once for the body (jewel and band add strokes/fills too)
    assert.equal(count(ctx, 'fill') >= n, true);
    assert.equal(count(ctx, 'save'), 1);
    assert.equal(count(ctx, 'restore'), 1);
    assert.ok(size.w > 0 && size.h > 0);
    assert.ok(size.w > (n - 1) * 12 && size.w < n * 20, `width ${size.w}`);
  }
});

test('drawCrownPips: zero, negative and oversized counts are handled', () => {
  const none = stubCtx();
  assert.deepEqual(drawCrownPips(none, 0, 0, 0, 12), { w: 0, h: 0 });
  assert.equal(none.calls.length, 0, 'nothing drawn for zero crowns');
  assert.deepEqual(drawCrownPips(stubCtx(), 0, 0, -2, 12), { w: 0, h: 0 });
  assert.deepEqual(drawCrownPips(stubCtx(), 0, 0, 3, 0), { w: 0, h: 0 });
  const three = drawCrownPips(stubCtx(), 0, 0, 3, 12);
  const nine = drawCrownPips(stubCtx(), 0, 0, 9, 12);
  assert.equal(nine.w, three.w, 'capped at three crowns');
});

test('drawCrownPips: centred on x, so the row is symmetric about it', () => {
  const ctx = stubCtx();
  const { w } = drawCrownPips(ctx, 200, 40, 3, 10);
  const xs = ctx.calls.filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo').map((c) => c[1]);
  // the crown outline spans exactly the row: leftmost x .. rightmost x
  assert.ok(Math.abs(Math.min(...xs) - (200 - w / 2)) < 1);
  assert.ok(Math.abs(Math.max(...xs) - (200 + w / 2)) < 1);
});

test('drawCrownPips: snaps pips to device pixels at DPR 2 (crisp outlines)', () => {
  const ctx = stubCtx({ scale: 2 });
  drawCrownPips(ctx, 100.3, 50.3, 2, 11);
  const firstMove = ctx.calls.find((c) => c[0] === 'moveTo');
  // the bottom-left corner of the first pip is at centre - 0.5 * width: any value that is a multiple
  // of a device pixel (0.5 css px) once the pip centre was snapped and the half-widths are added
  const cx = firstMove[1] + 0.5 * 11;
  assert.equal(Math.round(cx * 2) / 2, cx, `pip centre ${cx} is on a device pixel`);
});

test('drawCrownPips: total > count also draws the missing slots, dimmer', () => {
  const full = stubCtx();
  const partial = stubCtx();
  const a = drawCrownPips(full, 0, 0, 3, 12);
  const b = drawCrownPips(partial, 0, 0, 1, 12, { total: 3 });
  assert.equal(b.w, a.w, 'the row reserves room for all three');
  assert.ok(count(partial, 'fill') < count(full, 'fill'), 'hollow slots skip the gold body');
});

test('drawCrownPips: alpha option fades the row and restores the context', () => {
  const ctx = stubCtx();
  ctx.globalAlpha = 0.8;
  drawCrownPips(ctx, 0, 0, 1, 12, { alpha: 0.5 });
  assert.equal(ctx.calls[0][0], 'save');
  assert.equal(ctx.calls[ctx.calls.length - 1][0], 'restore');
});

test('the UI modules import in Node: no DOM access at load time', async () => {
  // crownRow.js and leaderBanner.js build DOM only inside functions.
  const banner = await import('../ui/leaderBanner.js');
  assert.equal(typeof banner.createLeaderBanner, 'function');
  assert.equal(typeof banner.drawMedallion, 'function');
  const row = await import('../ui/crownRow.js');
  assert.equal(typeof row.createCrownRow, 'function');
});

test('UI files stay free of game-logic imports (they receive plain data)', () => {
  for (const rel of ['../ui/crownRow.js', '../ui/leaderBanner.js']) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
    const imports = [...src.matchAll(/^import .* from '(.+)';$/gm)].map((m) => m[1]);
    for (const spec of imports) {
      assert.ok(!/meta\/|config\/|battle\/|world\//.test(spec), `${rel} imports ${spec}`);
    }
  }
});

test('CSS: both feature stylesheets exist and honour Reduce Motion', () => {
  for (const rel of ['../styles/components/crowns.css', '../styles/components/leaderbanner.css']) {
    const css = readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.match(css, /html\.reduce-motion/, `${rel} has a reduce-motion rule`);
  }
  const banner = readFileSync(new URL('../styles/components/leaderbanner.css', import.meta.url), 'utf8');
  assert.match(banner, /pointer-events:\s*none/);
});
