// Integration-layer logic that needs no browser: state container, autosave gating,
// idle ticker, tutorial controller, world picking / framing helpers, bucket choice.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createStateContainer } from '../app/stateContainer.js';
import { createAutosave } from '../app/autosave.js';
import { createIdleTicker } from '../app/idle.js';
import { createTutorialController } from '../app/tutorial.js';
import {
  pickLandTile, regionLabelAnchors, realmBounds, realmFraming, frameInRect, freeRect, HEX_MARGIN,
} from '../scenes/worldLayers.js';
import { pickBucket, BUCKETS } from '../render/terrainCache.js';
import { SAVE_KEY, saveTo } from '../meta/save.js';
import { PLAYER_FACTION } from '../meta/state.js';
import { generateWorld } from '../world/generate.js';
import { createCamera } from '../render/camera.js';
import { TUTORIAL_STEPS } from '../scenes/timing.js';

function memoryStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _m: m,
  };
}

test('state container: fresh boot, save round-trip, repair, restart', () => {
  const storage = memoryStorage();
  const c = createStateContainer({ storage, now: () => 1000 });
  const first = c.boot();
  assert.equal(first.resumed, false);
  assert.equal(first.state.owner.filter((o) => o === PLAYER_FACTION).length, 1);

  saveTo(storage, first.state);
  const c2 = createStateContainer({ storage, now: () => 2000 });
  const second = c2.boot();
  assert.equal(second.resumed, true);
  assert.equal(second.state.seed, first.state.seed);
  assert.equal(second.world.regions.length, first.world.regions.length);

  // A save whose owner table does not fit its world is repaired, never trusted.
  const broken = JSON.parse(storage.getItem(SAVE_KEY));
  broken.owner = [0, 1];
  storage.setItem(SAVE_KEY, JSON.stringify(broken));
  const c3 = createStateContainer({ storage, now: () => 3000 });
  const third = c3.boot();
  assert.equal(third.state.owner.length, third.world.regions.length);

  third.state.gold = 500;
  const again = c3.restart();
  assert.equal(again.state.gold, 0);
  assert.equal(again.world.seed, third.world.seed, 'restart keeps the continent');
});

test('state container: newRealm(seed) is deterministic; garbage storage boots a fresh realm', () => {
  const c = createStateContainer({ storage: memoryStorage({ [SAVE_KEY]: '{not json' }), now: () => 1 });
  assert.equal(c.boot().resumed, false);
  const a = c.newRealm(42);
  const b = createStateContainer({ storage: memoryStorage(), now: () => 1 }).newRealm(42);
  assert.deepEqual(a.state.owner, b.state.owner);
  assert.equal(a.world.regions.length, b.world.regions.length);
});

test('autosave: gated by canSave, fires on the interval, stamps lastSeen', () => {
  const storage = memoryStorage();
  const state = createStateContainer({ storage: memoryStorage(), now: () => 5 }).newRealm(7).state;
  let allowed = false;
  let clock = 111_000;
  const auto = createAutosave({ storage, getState: () => state, now: () => clock, canSave: () => allowed });
  auto.tick(6);
  assert.equal(storage.getItem(SAVE_KEY), null, 'nothing written while gated');
  allowed = true;
  auto.tick(4.9);
  assert.equal(storage.getItem(SAVE_KEY), null, 'not yet 5 s');
  auto.tick(0.2);
  const saved = JSON.parse(storage.getItem(SAVE_KEY));
  assert.equal(saved.lastSeen, 111_000);
  clock = 222_000;
  auto.save();
  assert.equal(JSON.parse(storage.getItem(SAVE_KEY)).lastSeen, 222_000);
});

test('autosave survives a throwing storage', () => {
  const state = createStateContainer({ storage: memoryStorage(), now: () => 5 }).newRealm(7).state;
  const auto = createAutosave({
    storage: { setItem() { throw new Error('quota'); } }, getState: () => state, now: () => 1,
  });
  assert.doesNotThrow(() => { auto.tick(10); auto.save(); });
});

test('idle ticker accrues wall-clock income and schedules pops from the owned regions', () => {
  const { state, world } = createStateContainer({ storage: memoryStorage(), now: () => 1 }).newRealm(7);
  let r = 0;
  const rng = () => { r = (r + 0.37) % 1; return r; };
  const ticker = createIdleTicker({ getState: () => state, getWorld: () => world, rng });
  const before = state.gold;
  let pop = null;
  for (let i = 0; i < 20 && !pop; i++) pop = ticker.tick(0.5);
  assert.ok(state.gold > before, 'gold ticks up');
  assert.ok(pop, 'a pop fires within 10 s');
  assert.equal(state.owner[pop.regionId], PLAYER_FACTION);
  assert.ok(pop.gold > 0);
});

test('tutorial controller advances on the right events and honours the hints setting', () => {
  const { state } = createStateContainer({ storage: memoryStorage(), now: () => 1 }).newRealm(7);
  const tut = createTutorialController({ getState: () => state });
  assert.equal(tut.currentStepDef().id, 0);
  tut.notify('send'); // wrong event: ignored
  assert.equal(state.tutorial.step, 0);
  tut.notify('tap');
  assert.equal(state.tutorial.step, 1);
  tut.notify('regionSelected');
  assert.equal(state.tutorial.step, 2);
  tut.notify('battleStart');
  assert.equal(state.tutorial.step, 3);
  tut.dismiss();
  assert.equal(state.tutorial.step, 4);
  // step 4 has a 10 s timeout
  tut.update(4);
  assert.equal(state.tutorial.step, 4);
  tut.update(7);
  assert.equal(state.tutorial.step, 5);
  tut.notify('powerUsed', { power: 'firestorm' });
  assert.equal(state.tutorial.step, 5, 'only Rally counts');
  tut.notify('powerUsed', { power: 'rally' });
  assert.equal(state.tutorial.step, 6);
  tut.notify('councilOpened');
  assert.equal(state.tutorial.done, true);
  assert.equal(tut.currentStepDef(), null);

  state.tutorial = { step: 0, done: false };
  state.settings.hints = false;
  assert.equal(tut.currentStepDef(), null, 'hints off hides every step');
  assert.equal(TUTORIAL_STEPS.length, 7);
});

test('pickLandTile resolves tile centres (and mountain faces) to the tile drawn there', () => {
  const world = generateWorld(7);
  let checked = 0;
  for (const t of world.tiles) {
    if (!t.land) continue;
    const hit = pickLandTile(world, t.x, t.y - (t.elev === 3 ? 0.5 : t.elev === 2 ? 0.34 : 0.22));
    // A raised tile's visible top must pick that tile unless a nearer (later-row) tile covers it.
    assert.ok(hit && hit.land, 'a land tile is hit');
    assert.ok(hit.row >= t.row || hit.i === t.i);
    checked++;
  }
  assert.ok(checked > 200);
  assert.equal(pickLandTile(world, -50, -50), null, 'off the grid is null');
});

test('label anchors sit on land in their own region; realm bounds cover owned + frontier', () => {
  const world = generateWorld(7);
  const anchors = regionLabelAnchors(world);
  assert.equal(anchors.length, world.regions.length);
  for (const region of world.regions) {
    const a = anchors[region.id];
    assert.ok(a.x >= region.bbox.minX - 1 && a.x <= region.bbox.maxX + 1, `region ${region.id} x`);
    assert.ok(a.y >= region.bbox.minY - 2 && a.y <= region.bbox.maxY + 1, `region ${region.id} y`);
  }
  const { state } = createStateContainer({ storage: memoryStorage(), now: () => 1 }).newRealm(7);
  const b = realmBounds(state, state.owner.length ? generateWorld(7) : world);
  const start = world.regions[world.startRegion].bbox;
  assert.ok(b.minX <= start.minX && b.maxX >= start.maxX && b.minY <= start.minY && b.maxY >= start.maxY);
});

test('frameInRect centres the bounds in the free rect and caps zoom', () => {
  const cam = createCamera({ minZoom: 0.05, maxZoom: 200 });
  cam.resize(1440, 900);
  const rect = freeRect(1440, 900);
  assert.ok(rect.y0 >= 80, 'below the HUD');
  assert.ok(rect.x1 <= 1440 - 340, 'leaves room for the region card');
  const t = frameInRect(cam, { minX: 10, minY: 10, maxX: 14, maxY: 12 }, rect, { padding: 24, maxZoom: 26 });
  assert.equal(t.zoom, 26);
  cam.x = t.x; cam.y = t.y; cam.zoom = t.zoom;
  const p = cam.worldToScreen(12, 11);
  assert.ok(Math.abs(p.x - (rect.x0 + rect.x1) / 2) < 1e-6);
  assert.ok(Math.abs(p.y - (rect.y0 + rect.y1) / 2) < 1e-6);
  // big bounds are limited by the rect, not by the cap
  const big = frameInRect(cam, { minX: 0, minY: 0, maxX: 80, maxY: 50 }, rect, { padding: 24, maxZoom: 26 });
  assert.ok(big.zoom < 14);
});

test('realmFraming: home + nearest frontier, no more than stays readable', () => {
  const world = generateWorld(7);
  const { state } = createStateContainer({ storage: memoryStorage(), now: () => 1 }).newRealm(7);
  const cam = createCamera({ minZoom: 0.05, maxZoom: 200 });
  cam.resize(1440, 900);
  const rect = freeRect(1440, 900);
  const b = realmFraming(state, generateWorld(7), cam, rect, { minReadable: 19, padding: 30 });
  const home = world.regions[world.startRegion].bbox;
  // A region's bbox is its tile centres: the framing adds a hex-and-a-bit margin so the outer hexes are fully in view.
  assert.ok(b.minX <= home.minX - HEX_MARGIN + 1e-9 && b.maxX >= home.maxX + HEX_MARGIN - 1e-9);
  const full = realmBounds(state, world);
  assert.ok(b.maxX - b.minX <= full.maxX - full.minX + 2 * HEX_MARGIN + 1e-9);
  const phone = freeRect(390, 844);
  assert.equal(phone.x0, 10);
  assert.ok(phone.y0 >= 72);
});

test('bake bucket choice: covers the range, with hysteresis', () => {
  assert.equal(pickBucket(20), 22);
  assert.equal(pickBucket(1000), BUCKETS[BUCKETS.length - 1]);
  assert.equal(pickBucket(2), BUCKETS[0]);
  const b = pickBucket(30);
  assert.equal(pickBucket(b * 1.1, b), b, 'small zoom wiggles keep the bucket');
  assert.notEqual(pickBucket(b * 1.6, b), b, 'a real zoom change re-buckets');
});
