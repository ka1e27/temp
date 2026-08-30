// WHICH WAY IS THE THRONE — and the four ways this could disclose too much.
//
// The board hides where every enemy building is (`siteKnown`), which measured
// at tick 0 means ZERO known non-player sites on every seed tried — so the
// objective strip names a castle that is not on the board and nothing can be
// selected or attacked. A heading answers that without reopening the fog rule.
//
// The negative controls are the whole file. The obvious fix — seeding the
// throne into `state.seen` — was tried and reverted because it reverses a
// deliberate, tested decision (the coach must not announce an unseen throne),
// so what has to be pinned here is that this one does NOT do that by accident.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattleState } from '../src/battle/state.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { emptyComp } from '../src/battle/combat.js';
import { siteKnown } from '../src/battle/vision.js';
import { bearingTarget, drawBearing } from '../src/render/bearing.js';

const fixture = (rules = {}) => createBattleState({
  contractVersion: CONTRACT_VERSION,
  battleId: 'bearing',
  seed: 1,
  grid: { cols: 17, rows: 5, blocked: [] },
  sites: [
    { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 4 } },
    { id: 'castle', kind: 'castle', hex: [15, 0], owner: 'enemy', garrison: { militia: 40 } },
  ],
  player: makeMods({ expedition: emptyComp() }),
  enemy: makeMods({ expedition: emptyComp() }),
  boosters: [],
  rules: { victory: 'capture-castle', hardCapMs: 480000, aiTier: 1, ...rules },
});

test('there is a bearing while the throne is unknown', () => {
  const s = fixture();
  assert.equal(siteKnown(s, 'player', s.sites[1]), false, 'fixture: the throne must be unseen');
  const t = bearingTarget(s, 'player');
  assert.ok(t, 'no bearing on a board whose throne has never been seen');
  assert.equal(t.id, 'castle');
});

test('IT RETIRES the moment the throne is known — an arrow at a visible thing is clutter', () => {
  const s = fixture();
  s.seen.player.castle = 'enemy';
  assert.equal(siteKnown(s, 'player', s.sites[1]), true, 'fixture: the throne is now a ghost');
  assert.equal(bearingTarget(s, 'player'), null);
});

test('NEGATIVE CONTROL: it does not make the throne known', () => {
  // THE LOAD-BEARING TEST. Seeding `state.seen` was the tempting one-line
  // version and it reverses a decision three tests encode: the coach must not
  // announce a throne fog has never shown anybody. Asking for a bearing must
  // not do that quietly.
  const s = fixture();
  const before = JSON.stringify(s.seen);
  bearingTarget(s, 'player');
  drawBearing(recorder(), s, 'player', geo, bounds, 34, palette, 1);
  assert.equal(JSON.stringify(s.seen), before, 'drawing a bearing wrote to state.seen');
  assert.equal(siteKnown(s, 'player', s.sites[1]), false,
    'the throne became known — the fog rule has been reopened');
});

test('NEGATIVE CONTROL: no bearing when the victory is not capture-castle', () => {
  assert.equal(bearingTarget(fixture({ victory: 'survive' }), 'player'), null);
});

test('NEGATIVE CONTROL: no bearing at a throne you already hold', () => {
  const s = fixture();
  s.sites[1].owner = 'player';
  assert.equal(bearingTarget(s, 'player'), null);
});

test('it paints, and paints nothing once there is nothing to point at', () => {
  const s = fixture();
  const on = recorder();
  drawBearing(on, s, 'player', geo, bounds, 34, palette, 1);
  assert.ok(on.ops.length > 0, 'the marker drew nothing at all');
  s.seen.player.castle = 'enemy';
  const off = recorder();
  drawBearing(off, s, 'player', geo, bounds, 34, palette, 1);
  assert.deepEqual(off.ops, [], 'the marker kept drawing after the throne was seen');
});

test('THE NEEDLE SITS BY THE CAMP, NOT ON THE THRONE — it is a bearing, not a pin', () => {
  // THE BUG A SCREENSHOT CAUGHT, and no test above would have failed on it.
  // The first cut walked from the camp toward the throne and clipped at the
  // board's edge — but the throne is ON the board, so the clip never bound and
  // the marker drew exactly on the castle: the precise position, for free, at
  // tick 0, which is strictly MORE than the ghost this exists to avoid.
  const s = fixture();
  const rec = recorder();
  drawBearing(rec, s, 'player', geo, bounds, 34, palette, 1);
  const camp = geo.hexPos(0, 0, { x: 0, y: 0 });
  const throne = geo.hexPos(15, 0, { x: 0, y: 0 });
  const cx = rec.pts.reduce((t, p) => t + p.x, 0) / rec.pts.length;
  const cy = rec.pts.reduce((t, p) => t + p.y, 0) / rec.pts.length;
  const toCamp = Math.hypot(cx - camp.x, cy - camp.y);
  const toThrone = Math.hypot(cx - throne.x, cy - throne.y);
  assert.ok(toCamp < toThrone,
    `the marker is nearer the throne (${toThrone.toFixed(0)}) than the camp `
    + `(${toCamp.toFixed(0)}) — it is disclosing the position, not the direction`);
  // ...and it does not scale with the distance, or the distance leaks too:
  // doubling how far away the throne is must not move the needle.
  const far = fixture();
  far.sites[1].hex = [15, 4];
  const rec2 = recorder();
  drawBearing(rec2, far, 'player', geo, bounds, 34, palette, 1);
  const cx2 = rec2.pts.reduce((t, p) => t + p.x, 0) / rec2.pts.length;
  const cy2 = rec2.pts.reduce((t, p) => t + p.y, 0) / rec2.pts.length;
  const d1 = Math.hypot(cx - camp.x, cy - camp.y);
  const d2 = Math.hypot(cx2 - camp.x, cy2 - camp.y);
  assert.ok(Math.abs(d1 - d2) < 1,
    `the needle moved ${Math.abs(d1 - d2).toFixed(1)} when only the DISTANCE changed`);
});

test('it points AWAY from the camp, toward the throne', () => {
  // A compass that points the wrong way is worse than none, and "it drew
  // something" cannot tell the two apart.
  const s = fixture();
  const rec = recorder();
  drawBearing(rec, s, 'player', geo, bounds, 34, palette, 1);
  const xs = rec.pts.map((p) => p.x);
  assert.ok(Math.min(...xs) > 0, 'the marker sits on the camp side of the board');
  const camp = geo.hexPos(0, 0, { x: 0, y: 0 });
  assert.ok(Math.max(...xs) > camp.x, 'the marker is not between the camp and the origin');
});

// --- fixtures ---------------------------------------------------------------
const geo = { hexPos: (q, r, out) => { out.x = q * 40; out.y = r * 40; return out; } };
const bounds = { minX: -20, minY: -20, maxX: 660, maxY: 220 };
const palette = { owner: { enemy: '#f00', player: '#0f0' } };

function recorder() {
  const ops = [];
  const pts = [];
  return {
    ops,
    pts,
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 0,
    beginPath() {}, closePath() {},
    moveTo(x, y) { pts.push({ x, y }); },
    lineTo(x, y) { pts.push({ x, y }); },
    fill() { ops.push('fill'); },
    stroke() { ops.push('stroke'); },
  };
}
