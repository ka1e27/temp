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
import { effectiveRegionIncome } from '../app/income.js';
import { incomePerSec } from '../meta/economy.js';
import { conquer } from '../meta/progression.js';
import { worksIncomeMult } from '../meta/worksEffects.js';

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

test('tutorial controller: a set of seen steps, the right step for the facts, events and timeouts, the hints setting, replay', () => {
  const { state } = createStateContainer({ storage: memoryStorage(), now: () => 1 }).newRealm(7);
  const tut = createTutorialController({ getState: () => state });
  const world = { scene: 'world', panelsClosed: true, cardOpen: false, cardAttackable: false, cardUnscouted: false, frontierCount: 3, battlesWon: 0, conquests: 0, realmComplete: false, ownedFrontierCount: 1 };
  assert.deepEqual(state.tutorial, { seen: {}, done: false });
  assert.equal(tut.pick(world).id, 'W0');
  tut.notify('nothing'); // not W0's event
  assert.equal(tut.pick(world).id, 'W0');
  tut.update(4);
  assert.equal(tut.pick(world).id, 'W0');
  tut.update(1.5); // W0 has a 5 s timeout, counted while it is on screen
  assert.ok(state.tutorial.seen.W0);
  assert.equal(tut.pick(world).id, 'W1', 'W1 follows W0');
  tut.notify('panAndZoom');
  assert.equal(tut.pick(world).id, 'W2');
  // W2 needs a frontier; the card opening (W3) wins once a region is selected and attackable
  tut.notify('regionSelected');
  assert.ok(state.tutorial.seen.W2);
  assert.equal(tut.pick({ ...world, cardOpen: true, cardAttackable: true }).id, 'W3');
  tut.notify('battleStart');
  assert.equal(tut.pick({ ...world, cardOpen: true, cardAttackable: true }), null, 'nothing else on the map before the first victory');
  // the tutorial battle: B1 first, then B3 on the first capture (and only while it is shown); B2 (send size) and B4 (multi-select) wait for the
  // second battle (Phase 10A: four hints in the tutorial battle's first 10 s)
  const battle0 = { scene: 'battle', live: true, t: 3, battlesBefore: 0, ownSites: 1, enemySites: 3, captured: 0, rallyReady: false, firestormReady: false, selectedCount: 0, noRouteSeen: false };
  assert.equal(tut.pick(battle0).id, 'B1');
  assert.equal(tut.pick({ ...battle0, scene: 'world' }), null, 'a battle step is silent on the map');
  assert.equal(tut.pick(battle0).id, 'B1');
  tut.dismiss();
  assert.ok(state.tutorial.seen.B1, 'the x marks the current step seen');
  assert.equal(tut.pick(battle0), null, 'no send-size hint in the tutorial battle');
  assert.equal(tut.pick({ ...battle0, captured: 1, ownSites: 2 }).id, 'B3', 'the first capture explains captures and the keep');
  tut.notify('capture');
  assert.ok(state.tutorial.seen.B3, 'a capture while B3 is on screen marks it seen');
  assert.equal(tut.pick({ ...battle0, captured: 1, ownSites: 2 }), null, 'no multi-select hint in the tutorial battle either');
  // the second battle
  const battle = { ...battle0, battlesBefore: 1 };
  assert.equal(tut.pick(battle).id, 'B2');
  tut.notify('sizeChanged');
  assert.equal(tut.pick({ ...battle, ownSites: 2 }).id, 'B4');
  tut.notify('multiSend');
  assert.equal(tut.pick({ ...battle0, ownSites: 2, t: 16, rallyReady: true }), null, 'no Rally hint in the tutorial battle');
  assert.equal(tut.pick({ ...battle, ownSites: 2, t: 6, rallyReady: true }), null, 'Rally waits for 15 s');
  assert.equal(tut.pick({ ...battle, ownSites: 2, t: 16, rallyReady: true }).id, 'B5');
  tut.notify('rally');
  // steps that need a feature stay silent until it is on; Firestorm only when it is ready
  assert.equal(tut.pick({ ...battle, battlesBefore: 1, t: 25, features: {} }).id, 'C3', 'C1 and C2 need supply lines; C3 goes ahead without them');
  const noCapture = tut.pick({ ...battle, battlesBefore: 1, t: 25, captured: 0, features: { supply: true } });
  assert.notEqual(noCapture && noCapture.id, 'C1', 'the supply-line hint waits for the first capture of this battle');
  assert.equal(tut.pick({ ...battle, battlesBefore: 1, t: 25, captured: 1, features: { supply: true } }).id, 'C1');
  tut.notify('pauseOrSpeed');
  assert.ok(state.tutorial.seen.C3, 'an event marks a step seen even when it is not the one on screen');
  assert.equal(tut.pick({ ...battle, firestormReady: true }).id, 'P1');
  // the world again
  assert.equal(tut.pick({ ...world, battlesWon: 1 }).id, 'M1');
  tut.notify('councilOpened');
  assert.equal(tut.pick({ ...world, battlesWon: 1, cardOpen: true, cardUnscouted: true }).id, 'M2');
  assert.equal(tut.pick({ ...world, battlesWon: 1, realmComplete: true }).id, 'M4');
  const m3 = { ...world, battlesWon: 3, conquests: 3, ownedFrontierCount: 2, features: { works: true }, worksDue: true, worksRegion: 4 };
  assert.equal(tut.pick({ ...m3, worksRegion: -1 }), null, 'M3 needs an owned region with a free slot and a hostile border to point at');
  assert.equal(tut.pick({ ...m3, worksDue: false }), null, 'and no Work built yet');
  assert.equal(tut.pick(m3).id, 'M3');
  tut.notify('workBuilt');
  assert.ok(state.tutorial.seen.M3, 'a Work built marks M3 seen');
  // hints off: nothing shows, nothing is lost
  state.settings.hints = false;
  assert.equal(tut.pick(world), null);
  state.settings.hints = true;
  // replay: every step unseen again, hints on
  tut.replay();
  assert.deepEqual(state.tutorial, { seen: {}, done: false });
  assert.equal(tut.pick(world).id, 'W0');
  state.tutorial.done = true;
  assert.equal(tut.pick(world), null, 'done switches every hint off');
  assert.equal(TUTORIAL_STEPS.map((x) => x.id).join(' '), 'W0 W1 W2 W3 B1 B2 B3 B4 B5 C1 C2 C3 P1 P2 M1 M2 M3 M4 F1 F2 F3 F4 G1 G2 R1 V1 V2 V3 U2 V4 V5 Q1 Q2 D1 D2 A1 U1 S1 K1 L1 H1 J1');
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

test('the income the region cards show adds up to what the game pays, Markets included (app/income.js mirrors meta/economy.js)', () => {
  const { state, world } = createStateContainer({ storage: memoryStorage(), now: () => 1 }).newRealm(7);
  for (let i = 0; i < 3; i++) {
    const next = world.regions.find((r) => state.owner[r.id] !== PLAYER_FACTION && r.neighbors.some((n) => state.owner[n] === PLAYER_FACTION));
    conquer(state, world, next.id, 1000 + i);
  }
  const owned = world.regions.filter((r) => state.owner[r.id] === PLAYER_FACTION);
  const sum = () => owned.reduce((a, r) => a + effectiveRegionIncome(state, world, r), 0);
  assert.ok(Math.abs(sum() - incomePerSec(state, world)) < 1e-9, 'no Works: the cards sum to incomePerSec');
  const before = effectiveRegionIncome(state, world, owned[1]);
  state.works = { [owned[1].id]: [{ type: 'market', level: 2 }] };
  assert.ok(worksIncomeMult(state, owned[1].id) > 1, 'a Market raises its region');
  assert.ok(Math.abs(sum() - incomePerSec(state, world)) < 1e-9, 'with a Market: the cards still sum to incomePerSec');
  assert.ok(effectiveRegionIncome(state, world, owned[1]) > before, 'and the Market region shows its raise');
});

test('the Living Frontier steps (F1-F4): a raid toast with Go on the map or in a battle, two battles at once, then fortify', async () => {
  const { createTutorialController } = await import('../app/tutorial.js');
  const seen = {};
  const st = { tutorial: { seen, done: false }, settings: { hints: true } };
  const tut = createTutorialController({ getState: () => st });
  const all = (ids) => ids.forEach((id) => { seen[id] = true; });
  all(['W0', 'W1', 'W2', 'W3', 'B1', 'B2', 'B3', 'B4', 'B5', 'C1', 'C2', 'C3', 'P1', 'P2', 'M1', 'M2', 'M3', 'M4']);
  const world = { scene: 'world', panelsClosed: true, cardOpen: false, frontierCount: 3, battlesWon: 3, conquests: 4, incoming: 0, raidToast: false, raids: 0, fortRegion: 5, features: { frontier: true, works: true, supply: true } };
  assert.equal(tut.pick(world), null, 'nothing before the first raid');
  assert.equal(tut.pick({ ...world, incoming: 1, raidToast: true }).id, 'F1', 'a war band is coming: Go or the Captain');
  assert.equal(tut.pick({ ...world, incoming: 1, raidToast: true, features: {} }), null, 'silent while the frontier is off');
  const battle = { scene: 'battle', live: true, t: 20, battlesBefore: 3, ownSites: 2, enemySites: 3, captured: 1, incoming: 1, raidToast: true, runs: 1, features: { frontier: true, supply: true } };
  assert.equal(tut.pick(battle).id, 'F2', 'in a battle elsewhere too');
  tut.notify('raidGo');
  assert.ok(seen.F1 && seen.F2, 'Go marks both seen');
  assert.equal(tut.pick({ ...battle, incoming: 0, runs: 2 }).id, 'F3', 'two battles at once: switch');
  tut.notify('battleSwitched');
  assert.equal(tut.pick({ ...world, raids: 1, fortRegion: -1 }), null, 'no region to fortify, no hint');
  assert.equal(tut.pick({ ...world, raids: 1 }).id, 'F4', 'after the first raid: fortify');
  tut.notify('fortBuilt');
  assert.equal(tut.pick({ ...world, raids: 1 }), null);
});
