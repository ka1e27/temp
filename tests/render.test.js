// Geometry and formatting: the pure half of the presentation layer.
// Camera transforms, hex <-> pixel round-tripping, the influence buffer, route
// interpolation, palette derivation and number formatting.
//
// The outcome preview — the part that carries the design's load-bearing
// promise — is tested in preview.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createCamera } from '../src/render/canvas.js';
import {
  hexCx, hexCy, hexIndex, hexQ, hexRow, gridBounds, computeOwners, terrainTier,
  PLAYER, ENEMY, NEUTRAL, CONTESTED, NONE,
} from '../src/render/hexRenderer.js';
import { arcPoint, squadProgress, squadBow } from '../src/render/routes.js';
import { parseHex, withAlpha, mix, derive, FALLBACK } from '../src/render/palette.js';
import { createFx } from '../src/render/fx.js';
import { compact, fixed, integer, duration, clock, percent, rate, plural, numStr }
  from '../src/ui/format.js';
import { toPixel, fromPixel } from '../src/core/hex.js';

const V = { x: 0, y: 0 };
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

test('camera: world<->screen round-trips exactly', () => {
  const cam = createCamera({ vw: 800, vh: 600, zoom: 1.75, x: 37, y: -12 });
  for (const [wx, wy] of [[0, 0], [37, -12], [-500, 900], [123.456, -78.9]]) {
    const s = cam.worldToScreen(wx, wy, { x: 0, y: 0 });
    const w = cam.screenToWorld(s.x, s.y, { x: 0, y: 0 });
    near(w.x, wx, 1e-9);
    near(w.y, wy, 1e-9);
  }
});

test('camera: the camera centre lands in the middle of the viewport', () => {
  const cam = createCamera({ vw: 800, vh: 600, zoom: 3, x: 10, y: 20 });
  cam.worldToScreen(10, 20, V);
  assert.equal(V.x, 400);
  assert.equal(V.y, 300);
});

test('camera: zoomAt pins the world point under the cursor', () => {
  const cam = createCamera({ vw: 900, vh: 700, zoom: 1, x: 0, y: 0 });
  const before = cam.screenToWorld(210, 480, { x: 0, y: 0 });
  cam.zoomAt(210, 480, 1.6);
  const after = cam.screenToWorld(210, 480, { x: 0, y: 0 });
  near(after.x, before.x, 1e-9);
  near(after.y, before.y, 1e-9);
  near(cam.zoom, 1.6, 1e-12);
});

test('camera: zoom is clamped to its configured range', () => {
  const cam = createCamera({ vw: 800, vh: 600, minZoom: 0.5, maxZoom: 2 });
  cam.zoomAt(400, 300, 100);
  assert.equal(cam.zoom, 2);
  cam.zoomAt(400, 300, 0.001);
  assert.equal(cam.zoom, 0.5);
});

test('camera: fit centres the bounds and leaves the requested padding', () => {
  const cam = createCamera({ vw: 800, vh: 600 });
  cam.fit({ minX: -100, minY: -50, maxX: 300, maxY: 150 }, 40);
  near(cam.x, 100);
  near(cam.y, 50);
  // width 400 -> (800-80)/400 = 1.8 ; height 200 -> (600-80)/200 = 2.6 ; min wins
  near(cam.zoom, 1.8, 1e-12);
  cam.worldToScreen(-100, -50, V);
  near(V.x, 40, 1e-9);
});

test('camera: fit respects HUD insets and centres on the free space', () => {
  const cam = createCamera({ vw: 800, vh: 600 });
  cam.fit({ minX: 0, minY: 0, maxX: 400, maxY: 200 }, 0, { top: 100, bottom: 200 });
  // Usable height is 600-300 = 300; width is untouched at 800.
  near(cam.zoom, Math.min(800 / 400, 300 / 200), 1e-12);
  // The map centre should land in the middle of the free band, i.e. 100px
  // below the viewport centre's naive position.
  cam.worldToScreen(200, 100, V);
  near(V.x, 400, 1e-9);
  near(V.y, 100 + 300 / 2, 1e-9);
});

test('camera: panScreen moves the world by the screen delta / zoom', () => {
  const cam = createCamera({ vw: 800, vh: 600, zoom: 2, x: 0, y: 0 });
  cam.panScreen(100, -50);
  near(cam.x, -50);
  near(cam.y, 25);
});

// ---------------------------------------------------------------------------
// Hex layout
// ---------------------------------------------------------------------------

test('hex: renderer layout agrees with core/hex.js toPixel', () => {
  for (const [q, r] of [[0, 0], [3, 4], [-2, 7], [11, 9]]) {
    const p = toPixel({ q, r }, 34);
    near(hexCx(q, r, 34), p.x, 1e-9);
    near(hexCy(q, r, 34), p.y, 1e-9);
  }
});

test('hex: pixel -> hex -> pixel round-trips for every cell of a 13x10 grid', () => {
  for (let r = 0; r < 10; r++) {
    for (let i = 0; i < 13; i++) {
      const q = i - (r >> 1);
      const back = fromPixel(hexCx(q, r, 34), hexCy(q, r, 34), 34);
      assert.deepEqual(back, { q, r }, `round-trip failed for ${q},${r}`);
    }
  }
});

test('hex: index <-> axial round-trips, and off-grid returns -1', () => {
  const cols = 13;
  const rows = 10;
  for (let idx = 0; idx < cols * rows; idx++) {
    assert.equal(hexIndex(hexQ(idx, cols), hexRow(idx, cols), cols, rows), idx);
  }
  assert.equal(hexIndex(99, 0, cols, rows), -1);
  assert.equal(hexIndex(0, -1, cols, rows), -1);
  assert.equal(hexIndex(0, rows, cols, rows), -1);
});

test('hex: gridBounds encloses every cell', () => {
  const b = gridBounds(13, 10, 34, undefined);
  for (let r = 0; r < 10; r++) {
    for (let i = 0; i < 13; i++) {
      const q = i - (r >> 1);
      assert.ok(hexCx(q, r, 34) >= b.minX && hexCx(q, r, 34) <= b.maxX);
      assert.ok(hexCy(q, r, 34) >= b.minY && hexCy(q, r, 34) <= b.maxY);
    }
  }
});

test('hex: terrain tiers are deterministic and use all three shades', () => {
  const seen = new Set();
  for (let r = 0; r < 10; r++) for (let q = -5; q < 13; q++) seen.add(terrainTier(q, r));
  assert.equal(seen.size, 3);
  assert.equal(terrainTier(4, 7), terrainTier(4, 7));
});

test('influence: the flood buffer resolves faction keys into owner codes', () => {
  const owners = computeOwners(
    { '0,0': 'player', '1,0': 'enemy', '2,0': 'neutral', '3,0': 'contested', '99,9': 'player' },
    13, 10, undefined,
  );
  assert.equal(owners[hexIndex(0, 0, 13, 10)], PLAYER);
  assert.equal(owners[hexIndex(1, 0, 13, 10)], ENEMY);
  assert.equal(owners[hexIndex(2, 0, 13, 10)], NEUTRAL);
  assert.equal(owners[hexIndex(3, 0, 13, 10)], CONTESTED);
  assert.equal(owners[hexIndex(4, 0, 13, 10)], NONE);
  assert.equal(owners.length, 130);
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

test('routes: the arc starts at the source and ends at the target', () => {
  arcPoint(0, 0, 100, 40, 1, 0, V);
  near(V.x, 0); near(V.y, 0);
  arcPoint(0, 0, 100, 40, 1, 1, V);
  near(V.x, 100); near(V.y, 40);
});

test('routes: opposite bows put the midpoint on opposite sides of the link', () => {
  const a = arcPoint(0, 0, 100, 0, 1, 0.5, { x: 0, y: 0 });
  const b = arcPoint(0, 0, 100, 0, -1, 0.5, { x: 0, y: 0 });
  assert.equal(a.x, 50);
  assert.equal(b.x, 50);
  assert.ok(a.y > 0 && b.y < 0, 'bows must separate');
  near(a.y, -b.y);
});

test('routes: squad progress is clamped and derived only from ticks', () => {
  const sq = { id: 1, spawnTick: 10, arriveTick: 30 };
  assert.equal(squadProgress(sq, 0), 0);
  assert.equal(squadProgress(sq, 10), 0);
  assert.equal(squadProgress(sq, 20), 0.5);
  near(squadProgress(sq, 25.5), 0.775);
  assert.equal(squadProgress(sq, 999), 1);
  assert.equal(squadBow({ id: 1 }), 1);
  assert.equal(squadBow({ id: 2 }), -1);
});

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

test('palette: hex parsing, alpha and mixing', () => {
  assert.equal(parseHex('#3ddc97'), 0x3ddc97);
  assert.equal(parseHex('#fff'), 0xffffff);
  assert.equal(parseHex('rebeccapurple'), null);
  assert.equal(withAlpha('#3ddc97', 0.2), 'rgba(61,220,151,0.2)');
  assert.equal(withAlpha('#000000', 5), 'rgba(0,0,0,1)');
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mix('#ff0000', '#00ff00', 0), '#ff0000');
});

test('palette: derive precomputes every string the draw path needs', () => {
  const p = derive({ ...FALLBACK });
  for (const k of ['player', 'enemy', 'neutral', 'contested']) {
    assert.equal(typeof p.flood[k], 'string');
    assert.equal(typeof p.border[k], 'string');
  }
  for (const u of ['militia', 'spearmen', 'raiders', 'rams', 'marshal']) {
    assert.match(p.units[u], /^#/);
  }
  assert.equal(p.owner.player, FALLBACK.player);
});

// ---------------------------------------------------------------------------
// FX pool
// ---------------------------------------------------------------------------

test('fx: the pool is fixed size and never grows', () => {
  const fx = createFx({ max: 8 });
  for (let i = 0; i < 40; i++) fx.spawn('ring', i, i, { life: 1 });
  assert.equal(fx.live(), 8);
  fx.update(2);
  assert.equal(fx.live(), 0);
});

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

test('format: compact magnitudes', () => {
  assert.equal(compact(0), '0');
  assert.equal(compact(999), '999');
  assert.equal(compact(1234), '1.2K');
  assert.equal(compact(12345), '12K');
  assert.equal(compact(3_400_000), '3.4M');
  assert.equal(compact(1_000_000_000), '1B');
  assert.equal(compact(-1500), '-1.5K');
  assert.equal(compact(Infinity), '∞');
});

test('format: durations, and infinity is a real answer', () => {
  assert.equal(duration(4.2), '4.2s');
  assert.equal(duration(31), '31s');
  assert.equal(duration(65), '1:05');
  assert.equal(duration(250), '4:10');
  assert.equal(duration(Infinity), '∞');
  assert.equal(clock(0), '0:00');
  assert.equal(clock(305), '5:05');
});

test('format: fixed, integer, percent, rate, plural', () => {
  assert.equal(fixed(239.8123), '239.8');
  assert.equal(integer(1234567), '1,234,567');
  assert.equal(percent(0.5), '50%');
  assert.equal(rate(2.4), '+2.4/s');
  assert.equal(rate(-1), '-1.0/s');
  assert.equal(plural(1, 'survives', 'survive'), '1 survives');
  assert.equal(plural(3, 'survives', 'survive'), '3 survive');
});

test('format: numStr interns small integers so the draw path never allocates', () => {
  assert.equal(numStr(0), '0');
  assert.equal(numStr(42), '42');
  assert.equal(numStr(999), '999');
  // Same identity on the second call: that is the whole point.
  assert.ok(numStr(42) === numStr(42));
  assert.equal(numStr(1000), '1000');
  assert.equal(numStr(-3), '-3');
});
