// The world-map marks for Scout and Sabotage (game/render/intelMarks.js) against a recording canvas
// context: what gets drawn where and when, the elevation contract, and that every save() is restored.
import { test } from 'node:test';
import { FACTIONS } from '../config/world.js';
import assert from 'node:assert/strict';
import { drawScoutedGarrisons, drawWeakPointMarker, drawSabotageMark, badgeAlphaAtZoom } from '../render/intelMarks.js';
import { elevOffset } from '../render/tiles.js';
import { createCamera } from '../render/camera.js';
import { INTEL } from '../config/intel.js';

/** A canvas context that records every call and returns harmless stand-ins. */
function recorder() {
  const calls = [];
  let saves = 0;
  const state = {};
  const target = {};
  const ctx = new Proxy(target, {
    get(_t, prop) {
      if (prop === 'calls') return calls;
      if (prop === 'saveDepth') return saves;
      if (prop === 'measureText') return (s) => ({ width: String(s).length * 6 });
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (prop in state) return state[prop];
      return (...args) => {
        if (prop === 'save') saves += 1;
        if (prop === 'restore') saves -= 1;
        calls.push({ op: String(prop), args, alpha: state.globalAlpha });
      };
    },
    set(_t, prop, value) { state[prop] = value; calls.push({ op: 'set:' + String(prop), args: [value], alpha: state.globalAlpha }); return true; },
  });
  state.globalAlpha = 1;
  return ctx;
}
/** Comparable signature of everything drawn (gradients and other objects compare by shape). */
const sig = (ctx) => JSON.stringify(ctx.calls.map((c) => [c.op, c.args]));
const ofOp = (ctx, op) => ctx.calls.filter((c) => c.op === op);

function camera(zoom = 30) {
  const cam = createCamera();
  cam.resize(800, 600);
  cam.x = 10;
  cam.y = 10;
  cam.zoom = zoom;
  return cam;
}

const site = (over = {}) => ({ id: 1, x: 10, y: 10, elev: 1, garrison: 26.4, neutral: false, ...over });

test('badgeAlphaAtZoom fades in between the configured zoom levels', () => {
  const { badgeFadeStartZoom: a, badgeFullZoom: b } = INTEL.marks;
  assert.equal(badgeAlphaAtZoom(a - 1), 0);
  assert.equal(badgeAlphaAtZoom(b + 1), 1);
  const mid = badgeAlphaAtZoom((a + b) / 2);
  assert.ok(mid > 0.4 && mid < 0.6);
  let prev = -1;
  for (let z = a; z <= b; z += 0.25) { const v = badgeAlphaAtZoom(z); assert.ok(v >= prev); prev = v; }
});

test('drawScoutedGarrisons: one rounded badge per site in view, none when zoomed out, forced on request', () => {
  const sites = [site({ id: 1, garrison: 26.4 }), site({ id: 2, x: 12, y: 11, garrison: 9.6 }), site({ id: 3, x: 400, y: 400 })];
  const near = recorder();
  drawScoutedGarrisons(near, camera(30), sites, 2, 30);
  const labels = ofOp(near, 'fillText').map((c) => c.args[0]);
  assert.deepEqual(labels, ['26', '10'], 'garrisons round like the battle badges; the off-screen site is skipped');
  assert.equal(near.saveDepth, 0, 'balanced save/restore');

  const far = recorder();
  drawScoutedGarrisons(far, camera(5), sites, 2, 5);
  assert.equal(ofOp(far, 'fillText').length, 0, 'zoomed out: nothing');

  const forced = recorder();
  drawScoutedGarrisons(forced, camera(5), sites, 2, 5, { force: true });
  assert.equal(ofOp(forced, 'fillText').length, 2);

  const hidden = recorder();
  drawScoutedGarrisons(hidden, camera(30), sites, 2, 30, { skip: (s) => s.id === 1 });
  assert.deepEqual(ofOp(hidden, 'fillText').map((c) => c.args[0]), ['10']);

  drawScoutedGarrisons(recorder(), camera(30), [], 2, 30); // empty is fine
  drawScoutedGarrisons(recorder(), camera(30), null, 2, 30);
});

test('drawScoutedGarrisons honours the elevation contract: raised tiles lift their badge', () => {
  const zoom = 30;
  const cam = camera(zoom);
  const flat = recorder();
  drawScoutedGarrisons(flat, cam, [site({ elev: 1 })], 2, zoom);
  const mountain = recorder();
  drawScoutedGarrisons(mountain, cam, [site({ elev: 3 })], 2, zoom);
  const yFlat = ofOp(flat, 'fillText')[0].args[2];
  const yMountain = ofOp(mountain, 'fillText')[0].args[2];
  const expectedLift = elevOffset({ elev: 3 }, zoom) - elevOffset({ elev: 1 }, zoom);
  assert.ok(expectedLift > 0);
  assert.ok(Math.abs((yFlat - yMountain) - expectedLift) < 1e-6, `lift ${yFlat - yMountain} vs ${expectedLift}`);
});

test('drawScoutedGarrisons: neutral hamlets wear Free Folk stone, the rest the region colour', () => {
  const ctx = recorder();
  drawScoutedGarrisons(ctx, camera(30), [site({ id: 1 }), site({ id: 2, x: 12, y: 11, neutral: true })], 2, 30);
  const colours = new Set(ofOp(ctx, 'set:fillStyle').map((c) => c.args[0]));
  assert.ok(colours.has(FACTIONS[2].color), 'region owner (Crimson Legion) colour');
  assert.ok(colours.has(FACTIONS[1].color), 'neutral hamlet: Free Folk stone');
  assert.equal(ofOp(ctx, 'fillText').length, 2);
});

test('drawWeakPointMarker: an elliptical ring on the site, stiller under Reduce Motion, safe with no site', () => {
  const cam = camera(30);
  const live = recorder();
  drawWeakPointMarker(live, cam, site(), 30, 0.7);
  const ellipses = ofOp(live, 'ellipse');
  assert.ok(ellipses.length >= 3, 'ping + casing + line');
  for (const e of ellipses) assert.ok(e.args[3] < e.args[2], 'a ground ellipse: flatter than wide');
  assert.equal(live.saveDepth, 0);

  const still = recorder();
  drawWeakPointMarker(still, cam, site(), 30, 0.7, { reduceMotion: true });
  assert.ok(ofOp(still, 'ellipse').length < ellipses.length, 'no ping ring');
  // Same t twice draws the same thing; a different t breathes.
  const again = recorder();
  drawWeakPointMarker(again, cam, site(), 30, 0.7);
  assert.deepEqual(sig(again), sig(live));

  // The ring is centred under the settlement's raised top.
  const p = cam.worldToScreen(10, 10);
  const cx = ofOp(live, 'ellipse')[0].args[0];
  assert.ok(Math.abs(cx - p.x) < 1e-6);

  assert.doesNotThrow(() => drawWeakPointMarker(recorder(), cam, null, 30, 0));
  const nothing = recorder();
  drawWeakPointMarker(nothing, cam, site(), 30, 0, { alpha: 0 });
  assert.equal(nothing.calls.length, 0, 'fully faded: no drawing at all');
});

test('drawSabotageMark: a torch of the requested size, balanced state, animated only when asked', () => {
  for (const size of [12, 16, 22, 32]) {
    const ctx = recorder();
    drawSabotageMark(ctx, 100, 100, size);
    assert.equal(ctx.saveDepth, 0, `size ${size}`);
    const scale = ofOp(ctx, 'scale')[0].args[0];
    assert.ok(Math.abs(scale - size / 24) < 1e-9, 'the glyph scales with the label');
    assert.ok(ofOp(ctx, 'bezierCurveTo').length >= 4, 'two flame layers');
  }
  const a = recorder();
  const b = recorder();
  drawSabotageMark(a, 100, 100, 20);
  drawSabotageMark(b, 100, 100, 20);
  assert.deepEqual(sig(a), sig(b), 'still by default: deterministic');
  const t1 = recorder();
  const t2 = recorder();
  drawSabotageMark(t1, 100, 100, 20, 0.1);
  drawSabotageMark(t2, 100, 100, 20, 0.5);
  assert.notDeepEqual(sig(t1), sig(t2), 'the flame flickers with t');
});

test('intelMarks stays pure drawing: no game imports, no clock, no randomness', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../render/intelMarks.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const banned of [/Math\.random/, /Date\.now/, /performance\./, /requestAnimationFrame/, /meta\//, /state\./]) {
    assert.doesNotMatch(src, banned);
  }
});
