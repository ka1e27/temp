// The Works map marks (game/render/worksMarks.js) against a recording canvas stub: the zoom fade, culling, draw order,
// that every building draws, and that the fade-out matches the region labels. Looks are judged in
// tools/gallery/works.html; this file guards behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  worksMarkAlpha, drawWorksMarks, drawWorkBuilding, WORK_BUILDING_TYPES, MARK_OFFSETS,
} from '../render/worksMarks.js';
import { WORKS, WORK_TYPES } from '../config/works.js';
import { WORLD_SCENE } from '../scenes/timing.js';

function stubCtx() {
  const calls = [];
  const rec = (name) => (...args) => { calls.push([name, ...args]); };
  const ctx = { calls, globalAlpha: 1 };
  for (const n of ['save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'arc', 'ellipse',
    'quadraticCurveTo', 'fillRect', 'strokeRect']) ctx[n] = rec(n);
  return ctx;
}
const count = (ctx, name) => ctx.calls.filter((c) => c[0] === name).length;

/** A camera that maps world units 1:1 to pixels times zoom, around the origin, with a big viewport. */
function cam(zoom, { x = 0, y = 0 } = {}) {
  return {
    worldToScreen: (wx, wy) => ({ x: (wx - x) * zoom + 500, y: (wy - y) * zoom + 400 }),
    visibleBounds: (margin = 0) => ({ minX: x - 500 / zoom - margin, maxX: x + 500 / zoom + margin, minY: y - 400 / zoom - margin, maxY: y + 400 / zoom + margin }),
  };
}

const mark = (x, y, works) => ({ regionId: 1, x, y, elev: 1, works });

test('zoom fade: nothing at overview, ramps in, full through working zooms, fades out exactly with the labels', () => {
  const m = WORKS.marks;
  assert.equal(worksMarkAlpha(m.fadeInStartZoom - 1), 0);
  assert.equal(worksMarkAlpha(m.fadeInStartZoom), 0);
  const mid = (m.fadeInStartZoom + m.fadeInFullZoom) / 2;
  assert.ok(Math.abs(worksMarkAlpha(mid) - 0.5) < 1e-9);
  assert.equal(worksMarkAlpha(m.fadeInFullZoom), 1);
  assert.equal(worksMarkAlpha(20), 1);
  assert.equal(worksMarkAlpha(m.fadeOutStartZoom), 1);
  assert.equal(worksMarkAlpha(m.fadeOutEndZoom), 0);
  assert.equal(worksMarkAlpha(200), 0);
  // "fading with zoom like the labels" (render/labels.js reads WORLD_SCENE.labelFade*Zoom)
  assert.equal(m.fadeOutStartZoom, WORLD_SCENE.labelFadeStartZoom);
  assert.equal(m.fadeOutEndZoom, WORLD_SCENE.labelFadeEndZoom);
  let prev = 1;
  for (let z = m.fadeOutStartZoom; z <= m.fadeOutEndZoom; z += 0.5) {
    const a = worksMarkAlpha(z);
    assert.ok(a <= prev + 1e-12);
    prev = a;
  }
});

test('every Work type has a building, and each draws shapes without throwing at every size and level', () => {
  assert.deepEqual([...WORK_BUILDING_TYPES], [...WORK_TYPES]);
  for (const type of WORK_TYPES) {
    for (const w of [6, 14, 28, 60]) {
      for (const level of [0, 1, 2, 3]) {
        const ctx = stubCtx();
        assert.doesNotThrow(() => drawWorkBuilding(ctx, type, 100, 100, w, { level, color: '#3d7ef0', t: 1.3 }));
        assert.ok(count(ctx, 'fill') >= 4 || count(ctx, 'fillRect') >= 3, `${type} at ${w}px draws a building`);
        assert.equal(count(ctx, 'save'), count(ctx, 'restore'));
      }
    }
  }
});

test('drawWorkBuilding: level pips (one dot per level) and a still building without `t`', () => {
  const pipArcs = (level) => {
    const ctx = stubCtx();
    drawWorkBuilding(ctx, 'stables', 50, 50, 30, { level });
    return count(ctx, 'arc');
  };
  const base = pipArcs(0);
  assert.equal(pipArcs(1) - base, 2, 'each pip is an outline disc plus a gold disc');
  assert.equal(pipArcs(3) - base, 6);
  assert.equal(pipArcs(9) - base, 6, 'never more than three');
  const ctx = stubCtx();
  drawWorkBuilding(ctx, 'stables', 50, 50, 30, { pips: false, level: 3 });
  assert.equal(count(ctx, 'arc'), base, 'pips: false');
  for (const bad of [0, -5, NaN]) {
    const c = stubCtx();
    drawWorkBuilding(c, 'shrine', 10, 10, bad);
    assert.equal(c.calls.length, 0, `nothing for width ${bad}`);
  }
  const unknown = stubCtx();
  drawWorkBuilding(unknown, 'moat', 10, 10, 20);
  assert.equal(unknown.calls.length, 0);
});

test('drawWorksMarks: draws each Work of every mark in view, in the owner colour, and restores the context', () => {
  const ctx = stubCtx();
  const marks = [mark(0, 0, [{ type: 'barracks', level: 1 }, { type: 'market', level: 2 }]), mark(3, 1, [{ type: 'shrine', level: 3 }])];
  const one = stubCtx();
  drawWorkBuilding(one, 'shrine', 0, 0, 10, { level: 3 });
  drawWorksMarks(ctx, cam(20), marks, 20);
  assert.equal(count(ctx, 'save'), count(ctx, 'restore'));
  assert.ok(count(ctx, 'fill') > count(one, 'fill') * 2, 'three buildings');
});

test('drawWorksMarks: nothing below the fade-in zoom or above the fade-out zoom, and `force` ignores the fade', () => {
  const marks = [mark(0, 0, [{ type: 'barracks', level: 1 }])];
  for (const zoom of [3, WORKS.marks.fadeInStartZoom, WORKS.marks.fadeOutEndZoom, 80]) {
    const ctx = stubCtx();
    drawWorksMarks(ctx, cam(zoom), marks, zoom);
    assert.equal(ctx.calls.length, 0, `zoom ${zoom}`);
  }
  const forced = stubCtx();
  drawWorksMarks(forced, cam(5), marks, 5, { force: true });
  assert.ok(forced.calls.length > 0);
  const faded = stubCtx();
  drawWorksMarks(faded, cam(10), marks, 10);
  assert.ok(faded.calls.some((c) => c[0] === 'save'));
});

test('drawWorksMarks: marks outside the viewport are culled, `skip` hides a mark, `alpha` 0 draws nothing', () => {
  const marks = [mark(0, 0, [{ type: 'barracks', level: 1 }]), mark(5000, 0, [{ type: 'barracks', level: 1 }])];
  const all = stubCtx();
  drawWorksMarks(all, cam(20), marks, 20);
  const visibleOnly = stubCtx();
  drawWorksMarks(visibleOnly, cam(20), [marks[0]], 20);
  assert.equal(all.calls.length, visibleOnly.calls.length, 'the far mark adds nothing');
  const skipped = stubCtx();
  drawWorksMarks(skipped, cam(20), marks, 20, { skip: () => true });
  assert.equal(skipped.calls.length, 0);
  const invisible = stubCtx();
  drawWorksMarks(invisible, cam(20), marks, 20, { alpha: 0 });
  assert.equal(invisible.calls.length, 0);
  for (const empty of [null, undefined, []]) {
    const c = stubCtx();
    drawWorksMarks(c, cam(20), empty, 20);
    assert.equal(c.calls.length, 0);
  }
});

test('drawWorksMarks: at most maxShown Works per region, back to front (lower on screen draws later)', () => {
  const types = ['barracks', 'stables', 'shrine', 'watchtower', 'market'].map((type) => ({ type, level: 1 }));
  const a = stubCtx();
  const b = stubCtx();
  drawWorksMarks(a, cam(20), [mark(0, 0, types)], 20);
  drawWorksMarks(b, cam(20), [mark(0, 0, types.slice(0, WORKS.marks.maxShown))], 20);
  assert.equal(a.calls.length, b.calls.length, 'only maxShown are drawn');
  // barracks, stables and watchtower draw no arcs of their own, so every arc is a level pip; two arcs per pip, at its y
  const order = stubCtx();
  const plain = ['barracks', 'stables', 'watchtower'].map((type) => ({ type, level: 1 }));
  drawWorksMarks(order, cam(20), [mark(0, 0, plain)], 20);
  const pipYs = order.calls.filter((c) => c[0] === 'arc').map((c) => c[2]).filter((_, i) => i % 2 === 0);
  assert.equal(pipYs.length, 3);
  assert.deepEqual(pipYs, [...pipYs].sort((p, q) => p - q), 'buildings are drawn in rising y order');
});

test('slot offsets: three distinct spots to the right of and below the keep, never on the keep itself', () => {
  assert.equal(MARK_OFFSETS.length, WORKS.marks.maxShown);
  const seen = new Set(MARK_OFFSETS.map((o) => `${o.dx},${o.dy}`));
  assert.equal(seen.size, MARK_OFFSETS.length);
  for (const o of MARK_OFFSETS) assert.ok(o.dx >= 1.0, 'clear of the keep sprite (about 1 unit half-width)');
});

test('marks are the same scale on every display: size comes from zoom x config, not from the device', () => {
  const small = stubCtx();
  const big = stubCtx();
  drawWorkBuilding(small, 'market', 0, 0, WORKS.marks.sizeUnits * 15);
  drawWorkBuilding(big, 'market', 0, 0, WORKS.marks.sizeUnits * 30);
  assert.equal(small.calls.length, big.calls.length, 'same drawing, scaled');
});
