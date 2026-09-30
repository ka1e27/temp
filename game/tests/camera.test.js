import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createCamera } from '../render/camera.js';

// Drive `update` in fixed slices, like a real frame loop would.
function advance(cam, totalSec, stepSec = 1 / 60) {
  let t = 0;
  while (t < totalSec - 1e-9) {
    const step = Math.min(stepSec, totalSec - t);
    cam.update(step);
    t += step;
  }
}

describe('camera: screen <-> world round trip', () => {
  for (const zoom of [0.5, 1, 3.7, 20]) {
    test(`round-trips at zoom ${zoom}`, () => {
      const cam = createCamera({ minZoom: 0.01, maxZoom: 1000 });
      cam.resize(1280, 800);
      cam.zoom = zoom;
      cam.x = 12.3;
      cam.y = -4.2;
      for (const [wx, wy] of [[0, 0], [12.3, -4.2], [100, 50], [-30, 17.5]]) {
        const s = cam.worldToScreen(wx, wy);
        const back = cam.screenToWorld(s.x, s.y);
        assert.ok(Math.abs(back.x - wx) < 1e-9, `x round-trip at zoom ${zoom}`);
        assert.ok(Math.abs(back.y - wy) < 1e-9, `y round-trip at zoom ${zoom}`);
      }
    });
  }

  test('screen centre maps to the camera position', () => {
    const cam = createCamera();
    cam.resize(1000, 600);
    cam.x = 5;
    cam.y = 9;
    const centre = cam.worldToScreen(5, 9);
    assert.equal(centre.x, 500);
    assert.equal(centre.y, 300);
  });

  test('visibleBounds matches the viewport half-extents, plus margin', () => {
    const cam = createCamera();
    cam.resize(200, 100);
    cam.zoom = 2;
    cam.x = 0;
    cam.y = 0;
    const b = cam.visibleBounds(0);
    assert.deepEqual(b, { minX: -50, minY: -25, maxX: 50, maxY: 25 });
    const withMargin = cam.visibleBounds(10);
    assert.deepEqual(withMargin, { minX: -60, minY: -35, maxX: 60, maxY: 35 });
  });
});

describe('camera: zoomAt anchors the world point under the cursor', () => {
  for (const [sx, sy] of [[640, 400], [0, 0], [1200, 50], [300, 700]]) {
    test(`anchor fixed at screen (${sx},${sy})`, () => {
      const cam = createCamera({ minZoom: 0.01, maxZoom: 1000 });
      cam.resize(1280, 800);
      cam.zoom = 4;
      cam.x = 17;
      cam.y = -6;
      const before = cam.screenToWorld(sx, sy);
      cam.zoomAt(2, sx, sy);
      assert.equal(cam.zoom, 8);
      const after = cam.screenToWorld(sx, sy);
      assert.ok(Math.abs(after.x - before.x) < 1e-9, 'x anchor drifted');
      assert.ok(Math.abs(after.y - before.y) < 1e-9, 'y anchor drifted');
    });
  }

  test('zoomAt clamps to the configured min/max zoom', () => {
    const cam = createCamera({ minZoom: 1, maxZoom: 10 });
    cam.resize(800, 600);
    cam.zoomAt(1000, 400, 300);
    assert.equal(cam.zoom, 10);
    cam.zoomAt(0.0001, 400, 300);
    assert.equal(cam.zoom, 1);
  });

  test('setZoomLimits re-clamps the current zoom immediately', () => {
    const cam = createCamera({ minZoom: 1, maxZoom: 10 });
    cam.zoom = 8;
    cam.setZoomLimits(1, 5);
    assert.equal(cam.zoom, 5);
  });

  test('zoomAt cancels an in-flight flyTo', async () => {
    const cam = createCamera();
    cam.resize(800, 600);
    const p = cam.flyTo({ x: 100, y: 100, zoom: 5 }, 1000);
    cam.zoomAt(1.1, 400, 300);
    const result = await p;
    assert.equal(result.cancelled, true);
  });
});

describe('camera: pan clamp', () => {
  test('panBy keeps the centre within bounds + padding', () => {
    const cam = createCamera();
    cam.resize(400, 300);
    cam.zoom = 10;
    cam.setBounds({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, 5);
    // Drag enormously far in screen space — must never explode past the
    // hard bound by more than the small rubber-band allowance.
    cam.panBy(-1_000_000, -1_000_000);
    const overWorld = 60 / cam.zoom; // OVERSCROLL_PX / zoom, mirrors camera.js
    assert.ok(cam.x <= 100 + 5 + overWorld + 1e-6, `x=${cam.x} escaped the clamp`);
    assert.ok(cam.y <= 50 + 5 + overWorld + 1e-6, `y=${cam.y} escaped the clamp`);

    cam.panBy(1_000_000, 1_000_000);
    assert.ok(cam.x >= 0 - 5 - overWorld - 1e-6, `x=${cam.x} escaped the clamp`);
    assert.ok(cam.y >= 0 - 5 - overWorld - 1e-6, `y=${cam.y} escaped the clamp`);
  });

  test('rubber-banded overshoot settles back to the hard edge over time', () => {
    const cam = createCamera();
    cam.resize(400, 300);
    cam.zoom = 10;
    cam.setBounds({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, 0);
    cam.panBy(-100_000, 0); // shove far past maxX
    assert.ok(cam.x > 100, 'expected an overshoot to settle from');
    advance(cam, 5); // plenty of time for the exponential settle to finish
    assert.ok(Math.abs(cam.x - 100) < 1e-3, `x=${cam.x} did not settle to the edge`);
  });

  test('a pan within bounds is completely unclamped (no resistance)', () => {
    const cam = createCamera();
    cam.resize(400, 300);
    cam.zoom = 10;
    cam.setBounds({ minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 }, 0);
    cam.x = 0;
    cam.y = 0;
    cam.panBy(-50, -20); // screen px, well inside bounds
    assert.equal(cam.x, 5); // -(-50)/10
    assert.equal(cam.y, 2);
  });

  test('no bounds set means no clamping at all', () => {
    const cam = createCamera();
    cam.resize(400, 300);
    cam.zoom = 1;
    cam.panBy(-1_000_000, -1_000_000);
    assert.equal(cam.x, 1_000_000);
    assert.equal(cam.y, 1_000_000);
  });

  test('fling respects the same soft clamp as panBy', () => {
    const cam = createCamera();
    cam.resize(400, 300);
    cam.zoom = 10;
    cam.setBounds({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, 0);
    cam.x = 100;
    cam.y = 25;
    cam.fling(-3000, 0); // a fast, realistic flick left over at release
    advance(cam, 3);
    const overWorld = 60 / cam.zoom;
    assert.ok(cam.x <= 100 + overWorld + 1e-6);
    assert.ok(!cam.isMoving(), 'inertia should have fully decayed by 3s');
  });
});

describe('camera: flyTo', () => {
  test('reaches its target exactly (point + zoom)', async () => {
    const cam = createCamera({ minZoom: 0.01, maxZoom: 1000 });
    cam.resize(800, 600);
    cam.x = 0;
    cam.y = 0;
    cam.zoom = 1;
    const done = cam.flyTo({ x: 42, y: -17, zoom: 6 }, 300);
    advance(cam, 0.3 + 1 / 60);
    const result = await done;
    assert.equal(result.cancelled, false);
    assert.equal(cam.x, 42);
    assert.equal(cam.y, -17);
    assert.equal(cam.zoom, 6);
    assert.equal(cam.isMoving(), false);
  });

  test('fits a bounds rect (centre + fitZoom) and reaches it exactly', async () => {
    const cam = createCamera({ minZoom: 0.01, maxZoom: 1000 });
    cam.resize(1000, 500);
    const bounds = { minX: 0, minY: 0, maxX: 200, maxY: 100 };
    const done = cam.flyTo({ bounds, padding: 0 }, 200);
    advance(cam, 0.25);
    await done;
    assert.equal(cam.x, 100);
    assert.equal(cam.y, 50);
    assert.equal(cam.zoom, 5); // min(1000/200, 500/100) = 5
  });

  test('fitZoom is pure and does not move the camera', () => {
    const cam = createCamera({ minZoom: 0.01, maxZoom: 1000 });
    cam.resize(1000, 500);
    cam.x = 999;
    cam.y = 999;
    cam.zoom = 3;
    const z = cam.fitZoom({ minX: 0, minY: 0, maxX: 200, maxY: 100 }, 0);
    assert.equal(z, 5);
    assert.equal(cam.x, 999);
    assert.equal(cam.y, 999);
    assert.equal(cam.zoom, 3);
  });

  test('zoom is interpolated in log space (midpoint is the geometric mean)', () => {
    const cam = createCamera({ minZoom: 0.001, maxZoom: 1000 });
    cam.resize(800, 600);
    cam.zoom = 1;
    const done = cam.flyTo({ x: 0, y: 0, zoom: 100 }, 1000, 'linear');
    cam.update(0.5); // exactly halfway through a linear ease
    assert.ok(Math.abs(cam.zoom - 10) < 1e-6, `expected geometric mean 10, got ${cam.zoom}`);
    cam.update(0.5 + 1 / 60);
    return done;
  });

  test('isMoving is true mid-flight and false once arrived', () => {
    const cam = createCamera();
    cam.resize(800, 600);
    const done = cam.flyTo({ x: 10, y: 10, zoom: 2 }, 100);
    assert.equal(cam.isMoving(), true);
    advance(cam, 0.2);
    assert.equal(cam.isMoving(), false);
    return done;
  });

  test('cancelFlight resolves the pending promise with cancelled:true and freezes position', async () => {
    const cam = createCamera();
    cam.resize(800, 600);
    cam.x = 1;
    cam.y = 1;
    cam.zoom = 1;
    const done = cam.flyTo({ x: 500, y: 500, zoom: 50 }, 1000);
    cam.update(0.1); // partway there
    const midX = cam.x;
    cam.cancelFlight();
    const result = await done;
    assert.equal(result.cancelled, true);
    assert.equal(cam.x, midX, 'position should freeze where the flight was cancelled');
    assert.equal(cam.isMoving(), false);
  });

  test('a new flyTo supersedes and cancels the previous one', async () => {
    const cam = createCamera();
    cam.resize(800, 600);
    const first = cam.flyTo({ x: 100, y: 0, zoom: 1 }, 1000);
    const second = cam.flyTo({ x: -100, y: 0, zoom: 1 }, 100);
    const firstResult = await first;
    assert.equal(firstResult.cancelled, true);
    advance(cam, 0.2);
    const secondResult = await second;
    assert.equal(secondResult.cancelled, false);
    assert.equal(cam.x, -100);
  });

  test('panBy cancels an in-flight flyTo instead of fighting it', async () => {
    const cam = createCamera();
    cam.resize(800, 600);
    cam.zoom = 1;
    const done = cam.flyTo({ x: 200, y: 200, zoom: 1 }, 1000);
    cam.panBy(10, 0);
    const result = await done;
    assert.equal(result.cancelled, true);
  });
});

describe('camera: inertia (fling)', () => {
  test('decays smoothly and eventually stops', () => {
    const cam = createCamera();
    cam.resize(800, 600);
    cam.zoom = 1;
    cam.x = 0;
    cam.y = 0;
    cam.fling(240, 0); // screen px/s
    assert.equal(cam.isMoving(), true);
    advance(cam, 0.25, 1 / 240);
    assert.ok(cam.x < 0, 'content dragged left should move the camera right in world space... '
      + 'fling(+vx) mirrors panBy(+dx), so x should have moved negative');
    advance(cam, 5);
    assert.equal(cam.isMoving(), false);
  });

  test('fling(0,0) stops residual inertia immediately (the "new touch" rule)', () => {
    const cam = createCamera();
    cam.resize(800, 600);
    cam.fling(500, 500);
    assert.equal(cam.isMoving(), true);
    cam.fling(0, 0);
    assert.equal(cam.isMoving(), false);
  });
});

describe('camera: screen shake', () => {
  test('is zero until shake() is called, then decays back to zero', () => {
    const cam = createCamera();
    assert.equal(cam.shakeX, 0);
    assert.equal(cam.shakeY, 0);
    cam.shake(1);
    cam.update(1 / 60);
    assert.ok(cam.shakeX !== 0 || cam.shakeY !== 0, 'expected a nonzero shake offset');
    advance(cam, 5);
    assert.ok(Math.abs(cam.shakeX) < 1e-6 && Math.abs(cam.shakeY) < 1e-6, 'shake should fully decay');
  });

  test('shake never moves worldToScreen (draw-time only)', () => {
    const cam = createCamera();
    cam.resize(800, 600);
    cam.x = 5;
    cam.y = 5;
    cam.zoom = 2;
    const before = cam.worldToScreen(5, 5);
    cam.shake(1);
    cam.update(1 / 60);
    const after = cam.worldToScreen(5, 5);
    assert.deepEqual(after, before);
  });
});
