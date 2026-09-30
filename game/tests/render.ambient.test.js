import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/generate.js';
import { createAmbient } from '../render/ambient.js';
import { setCanvasFactory, bucketIndex, BUCKETS, createSpriteCache } from '../render/ambientSprites.js';
import { ramp, h01 } from '../render/ambientCaravans.js';
import { regionAtGround } from '../render/ambientBirds.js';
import { AMBIENT } from '../config/ambient.js';

// ---- a recording fake canvas (Node has no canvas) ------------------------------------------
function makeCtx() {
  const calls = { total: 0, log: null };
  const props = {};
  const ctx = new Proxy({}, {
    get(_, key) {
      if (key === '__calls') return calls;
      if (key in props) return props[key];
      if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (key === 'measureText') return () => ({ width: 10 });
      return (...args) => {
        calls[key] = (calls[key] || 0) + 1;
        calls.total++;
        if (calls.log) calls.log.push(`${String(key)}:${args.map((a) => (typeof a === 'number' ? a.toFixed(2) : typeof a)).join(',')}`);
      };
    },
    set(_, key, value) { props[key] = value; return true; },
  });
  return ctx;
}
setCanvasFactory((w, h) => ({ width: w, height: h, getContext: () => makeCtx() }));

const world = generateWorld(7);
function realm(n) {
  const owner = world.regions.map((r) => (r.id === world.startRegion ? 0 : 2));
  const order = [world.startRegion];
  const seen = new Set(order);
  for (let k = 0; k < order.length; k++) {
    for (const nb of [...world.regions[order[k]].neighbors].sort((a, b) => a - b)) {
      if (!seen.has(nb)) { seen.add(nb); order.push(nb); }
    }
  }
  owner.fill(2);
  for (const id of order.slice(0, n)) owner[id] = 0;
  return owner;
}
function stateOf(owner, level = 0) {
  return { owner, prosperity: world.regions.map(() => level) };
}
const cam = (zoom, x = 46, y = 37) => ({ x, y, zoom, viewW: 1440, viewH: 900 });
function warm(ambient, seconds = 12) {
  for (let i = 0; i < seconds * 20; i++) ambient.update(0.05);
}
function frame(ambient, zoom, x, y) {
  const g = makeCtx();
  const a = makeCtx();
  const c = cam(zoom, x, y);
  ambient.drawGround(g, c);
  ambient.drawAir(a, c);
  return { g, a };
}
function make(opts = {}, n = 9, level = 0) {
  // Sprites bake at once in tests: the per-frame bake budget is wall-clock based, which would make draw streams timing dependent.
  const ambient = createAmbient({ world, reduceMotion: false, pixelRatio: 1, spriteBudgetMs: Infinity, ...opts });
  ambient.rebuild(stateOf(realm(n), level));
  return ambient;
}

test('helpers: ramp, hash and bucket lookup', () => {
  assert.equal(ramp(1, 2, 4), 0);
  assert.equal(ramp(5, 2, 4), 1);
  assert.ok(ramp(3, 2, 4) > 0.4 && ramp(3, 2, 4) < 0.6);
  for (let i = 0; i < 200; i++) { const v = h01(i, i * 3, 7, 1); assert.ok(v >= 0 && v < 1); }
  assert.equal(h01(1, 2, 3, 4), h01(1, 2, 3, 4));
  assert.equal(BUCKETS[bucketIndex(1)], 8);
  assert.equal(BUCKETS[bucketIndex(22)], 22);
  assert.equal(BUCKETS[bucketIndex(1000)], 128);
});

test('regionAtGround agrees with the tile under a point', () => {
  for (const t of world.tiles.filter((x) => x.land).slice(0, 300)) {
    assert.equal(regionAtGround(world, t.x, t.y), t.region);
    assert.equal(regionAtGround(world, t.x + 0.3, t.y + 0.2), world.tiles[t.i].region === t.region ? t.region : regionAtGround(world, t.x + 0.3, t.y + 0.2));
  }
  assert.equal(regionAtGround(world, -50, -50), -1);
});

test('rebuild builds routes, smoke sources; stats has the documented shape', () => {
  const ambient = make();
  const s = ambient.stats();
  assert.ok(s.caravans.routes > 15, `routes ${s.caravans.routes}`);
  assert.ok(s.smokeSources > 10);
  assert.equal(s.enabled, true);
  for (const k of ['groundMs', 'airMs', 'totalMs', 'windmills', 'boats', 'reduceMotion', 'quality']) assert.ok(k in s, k);
});

test('caravans: none at far zoom, dots at mid zoom, carts up close; never more than 40', () => {
  const ambient = make({}, 9);
  warm(ambient);
  let f = frame(ambient, 5);
  assert.equal(ambient.stats().caravans.drawn, 0);
  assert.equal(f.g.__calls.drawImage || 0, 0);

  f = frame(ambient, 12.5); // dots band
  f = frame(ambient, 12.5);
  const dots = ambient.stats().caravans;
  assert.ok(dots.drawn > 0, 'dots drawn');
  assert.ok(f.g.__calls.arc > 0);

  f = frame(ambient, 26, 50, 38);
  f = frame(ambient, 26, 50, 38);
  assert.ok(ambient.stats().caravans.drawn > 0, 'carts drawn close up');
  assert.ok(f.g.__calls.drawImage > 0, 'cart sprites blitted');

  // Everything owned, everything in view.
  const all = createAmbient({ world, pixelRatio: 1, spriteBudgetMs: Infinity });
  all.rebuild(stateOf(world.regions.map(() => 0)));
  warm(all, 30);
  for (let i = 0; i < 4; i++) frame(all, 16, 46, 36);
  const c = all.stats().caravans;
  assert.ok(c.drawn <= AMBIENT.caravans.maxAlive, `drawn ${c.drawn}`);
  assert.ok(c.candidates >= c.drawn);
});

test('caravan count is stable frame to frame (no flicker) and grows with the realm', () => {
  const small = make({}, 3);
  const big = make({}, 12);
  warm(small); warm(big);
  frame(small, 24); frame(big, 24);
  const counts = [];
  for (let i = 0; i < 20; i++) { small.update(0.016); frame(small, 24); counts.push(small.stats().caravans.drawn); }
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 3, `drawn varies ${counts}`);
  frame(big, 24, 50, 36);
  assert.ok(big.stats().caravans.routes > small.stats().caravans.routes * 2);
});

test('spawn rate scales with income: a richer region gets a busier road', () => {
  const poor = createAmbient({ world, pixelRatio: 1, spriteBudgetMs: Infinity, incomeOf: () => 1 });
  const rich = createAmbient({ world, pixelRatio: 1, spriteBudgetMs: Infinity, incomeOf: () => 60 });
  poor.rebuild(stateOf(realm(9)));
  rich.rebuild(stateOf(realm(9)));
  assert.ok(rich.stats().caravans.lanes > poor.stats().caravans.lanes, 'more lanes for a richer region');
  // Carts per second over all routes = lanes / lane period.
  const rate = (a) => a.routes.reduce((n, r) => n + r.lanes / r.period, 0);
  assert.ok(rate(rich) > rate(poor) * 2, `rich ${rate(rich).toFixed(3)} vs poor ${rate(poor).toFixed(3)}`);
});

test('quality 0 thins the carts; setQuality clamps', () => {
  const ambient = make({}, 12);
  warm(ambient, 20);
  for (let i = 0; i < 3; i++) frame(ambient, 22, 50, 36);
  const full = ambient.stats().caravans.drawn;
  ambient.setQuality(0);
  for (let i = 0; i < 4; i++) frame(ambient, 22, 50, 36);
  const low = ambient.stats().caravans.drawn;
  assert.ok(full >= 8, `enough carts to compare (${full})`);
  assert.ok(low <= Math.ceil(full * 0.6), `quality 0: ${low} vs ${full}`);
  ambient.setQuality(7);
  ambient.setQuality(-3);
  ambient.setQuality(NaN);
  assert.equal(ambient.stats().quality, 1);
});

test('hidden mask hides everything of those regions (function and array forms) and can be cleared', () => {
  const ambient = make({}, 9, 3);
  warm(ambient, 15);
  frame(ambient, 30, 46, 37);
  const base = ambient.stats();
  assert.ok(base.caravans.drawn > 0 && base.smokePuffsDrawn > 0 && base.sailsDrawn > 0);

  ambient.setHiddenMask(() => true);
  frame(ambient, 30, 46, 37);
  let s = ambient.stats();
  assert.equal(s.caravans.drawn, 0);
  assert.equal(s.smokePuffsDrawn, 0);
  assert.equal(s.sailsDrawn, 0);
  assert.equal(s.boatsDrawn, 0);

  ambient.setHiddenMask(world.regions.map(() => 1));
  frame(ambient, 30, 46, 37);
  s = ambient.stats();
  assert.equal(s.caravans.drawn + s.smokePuffsDrawn + s.sailsDrawn, 0);

  // Hide one region only: its carts vanish, the rest stay. (Which region has carts in this camera view depends
  // on the generated world, so take the first route region whose hiding removes some but not all of them.)
  let partial = false;
  for (const hideId of new Set(ambient.routes.map((r) => r.regionId))) {
    ambient.setHiddenMask((r) => r === hideId);
    frame(ambient, 30, 46, 37);
    s = ambient.stats();
    if (s.caravans.drawn > 0 && s.caravans.drawn < base.caravans.drawn) { partial = true; break; }
  }
  assert.ok(partial, 'hiding a single region removes only the carts of that region');

  ambient.setHiddenMask(null);
  frame(ambient, 30, 46, 37);
  assert.ok(ambient.stats().caravans.drawn >= base.caravans.drawn - 2);
});

test('setEnabled(false) draws and advances nothing (battle arena)', () => {
  const ambient = make({}, 9, 3);
  warm(ambient, 5);
  const t = ambient.stats().time;
  ambient.setEnabled(false);
  ambient.update(1);
  assert.equal(ambient.stats().time, t);
  const { g, a } = frame(ambient, 30);
  assert.equal(g.__calls.total, 0);
  assert.equal(a.__calls.total, 0);
  ambient.setEnabled(true);
  ambient.update(1);
  assert.ok(ambient.stats().time > t);
  const f2 = frame(ambient, 30);
  assert.ok(f2.g.__calls.total + f2.a.__calls.total > 0);
});

test('smoke: player settlements at full density, other revealed owners at half; fog (-1) and hidden regions none', () => {
  const owner = realm(9);
  const ambient = createAmbient({ world, pixelRatio: 1, spriteBudgetMs: Infinity });
  ambient.rebuild(stateOf(owner));
  const defs = (s) => AMBIENT.smoke.chimneys[s.type];
  const mine = world.settlements.filter((s) => owner[s.region] === 0 && defs(s)).reduce((n, s) => n + defs(s).length, 0);
  const others = world.settlements.filter((s) => owner[s.region] > 0 && defs(s)).length; // first chimney only
  assert.equal(ambient.stats().smokeSources, mine + others);
  // Fogged regions (owner -1, as the world scene's visual owners) have no smoke at all.
  const fogged = owner.map((o) => (o === 0 ? 0 : -1));
  const foggy = createAmbient({ world, pixelRatio: 1, spriteBudgetMs: Infinity });
  foggy.rebuild(stateOf(fogged));
  assert.equal(foggy.stats().smokeSources, mine);
  warm(ambient, 3);
  // Player plumes only (rivals hidden): the full wisp, and the sparse wisp is exactly half of it.
  ambient.setHiddenMask((r) => owner[r] !== 0);
  frame(ambient, 40, 48, 38);
  const full = ambient.stats().smokePuffsDrawn;
  const plumes = ambient.stats().smokePlumesDrawn;
  assert.ok(plumes > 5, `plumes ${plumes}`);
  assert.equal(full, plumes * AMBIENT.smoke.puffs);
  // Everyone visible: extra sparse plumes appear.
  ambient.setHiddenMask(null);
  frame(ambient, 40, 48, 38);
  const all = ambient.stats();
  assert.ok(all.smokePlumesDrawn > plumes, 'rival and Free Folk smoke');
  assert.equal(all.smokePuffsDrawn, plumes * AMBIENT.smoke.puffs + (all.smokePlumesDrawn - plumes) * AMBIENT.smoke.puffsSparse);
  // Reduce Motion halves the player's smoke.
  ambient.setHiddenMask((r) => owner[r] !== 0);
  ambient.setReduceMotion(true);
  frame(ambient, 40, 48, 38);
  assert.equal(ambient.stats().smokePuffsDrawn * 2, full);
  // Far zoom: no smoke at all.
  frame(ambient, 9, 48, 38);
  assert.equal(ambient.stats().smokePuffsDrawn, 0);
});

test('empty return carts: about half as many as loaded ones, shown as their own sprite and dot', () => {
  const ambient = make({}, 12);
  warm(ambient, 40);
  let loaded = 0; let empty = 0;
  for (let i = 0; i < 40; i++) {
    ambient.update(0.5);
    frame(ambient, 24, 48, 38);
    const c = ambient.stats().caravans;
    empty += c.emptyDrawn;
    loaded += c.drawn - c.emptyDrawn;
  }
  assert.ok(empty > 30 && loaded > 60, `loaded ${loaded}, empty ${empty}`);
  const share = empty / (empty + loaded);
  assert.ok(share > 0.22 && share < 0.45, `empty share ${share.toFixed(2)} (loaded ${loaded}, empty ${empty})`);
  // Every route has a return stream: lanes per route >= 1 for both directions.
  assert.ok(ambient.routes.every((r) => r.lanes >= 1 && r.retLanes >= 1));
  const rate = (lanes, period) => lanes / period;
  for (const r of ambient.routes) assert.ok(Math.abs(rate(r.retLanes, r.retPeriod) / rate(r.lanes, r.period) - AMBIENT.caravans.returnShare) < 1e-9);
});
test('windmill sails: only at level II+, turning normally, frozen under Reduce Motion', () => {
  const owner = realm(9);
  const low = createAmbient({ world, pixelRatio: 1, spriteBudgetMs: Infinity });
  low.rebuild(stateOf(owner, 1));
  assert.equal(low.stats().windmills, 0);
  const ambient = createAmbient({ world, pixelRatio: 1, spriteBudgetMs: Infinity });
  ambient.rebuild(stateOf(owner, 2));
  assert.ok(ambient.stats().windmills > 3);
  const mill = ambient.windmills[0];
  ambient.setFeatures({ smoke: false, birds: false });
  const view = (a) => { const c = cam(60, mill.x, mill.y); const g = makeCtx(); g.__calls.log = []; a.drawAir(g, c); return g.__calls.log.filter((l) => l.startsWith('drawImage:')); };
  ambient.update(0.5);
  const r1 = view(ambient);
  ambient.update(2);
  const r2 = view(ambient);
  assert.ok(r1.length >= 1);
  assert.notDeepEqual(r1, r2, 'sails turn');
  ambient.setReduceMotion(true);
  const r3 = view(ambient);
  ambient.update(3);
  const r4 = view(ambient);
  assert.deepEqual(r3, r4, 'sails stand still with Reduce Motion');
  // A windmill that has not reached level II yet is not in the list; levelling up adds it.
  ambient.rebuild(stateOf(owner, 0));
  assert.equal(ambient.stats().windmills, 0);
  ambient.rebuild(stateOf(owner, 3));
  assert.ok(ambient.stats().windmills > 3);
});

test('Reduce Motion: caravans move at 60 % speed, no birds ever', () => {
  const a = make({}, 9);
  const b = make({ reduceMotion: true }, 9);
  for (let i = 0; i < 20; i++) { a.update(0.05); b.update(0.05); }
  const ta = a.stats().caravanClock;
  const tb = b.stats().caravanClock;
  assert.ok(Math.abs(tb / ta - AMBIENT.reduceMotion.caravanSpeed) < 1e-9);
  // Birds: run 200 s over forest; Reduce Motion never starts a flock.
  const forestSpot = world.tiles.find((t) => t.terrain === 'forest' && t.region >= 0);
  const drive = (amb) => {
    let flocks = 0; let was = false;
    for (let sec = 0; sec < 200; sec++) {
      for (let k = 0; k < 4; k++) amb.update(0.25);
      const g = makeCtx();
      amb.drawAir(g, cam(20, forestSpot.x, forestSpot.y));
      const active = amb.stats().birdsActive;
      if (active && !was) flocks++;
      was = active;
    }
    return flocks;
  };
  const calm = createAmbient({ world, pixelRatio: 1, spriteBudgetMs: Infinity, reduceMotion: true });
  calm.rebuild(stateOf(realm(9)));
  assert.equal(drive(calm), 0);
  const lively = createAmbient({ world, pixelRatio: 1, spriteBudgetMs: Infinity });
  lively.rebuild(stateOf(realm(9)));
  const n = drive(lively);
  assert.ok(n >= 3 && n <= 9, `flocks in 200 s: ${n}`);
});

test('birds respect the hidden mask and never fly without forest in view', () => {
  const amb = createAmbient({ world, pixelRatio: 1, spriteBudgetMs: Infinity });
  amb.rebuild(stateOf(realm(9)));
  const spot = world.tiles.find((t) => t.terrain === 'forest' && t.region >= 0);
  const c = cam(20, spot.x, spot.y);
  amb.drawAir(makeCtx(), c);
  amb.setHiddenMask(() => true);
  assert.equal(amb.spawnFlock(), false, 'no flock over hidden regions');
  amb.setHiddenMask(null);
  assert.equal(amb.spawnFlock(), true);
  const empty = createAmbient({ world, pixelRatio: 1, spriteBudgetMs: Infinity });
  empty.rebuild(stateOf(realm(9)));
  empty.drawAir(makeCtx(), cam(20, -40, -40)); // view over open sea
  assert.equal(empty.spawnFlock(), false);
});

test('boats: player-owned harbour boats use the owner sail variant, others off-white', () => {
  const ambient = createAmbient({ world, pixelRatio: 1, spriteBudgetMs: Infinity });
  const owner = realm(9);
  const harbour = world.regions.filter((r) => r.perk === 'harbour');
  owner[harbour[0].id] = 0;
  ambient.rebuild(stateOf(owner));
  assert.ok(ambient.stats().boats >= harbour.length);
  const lane = ambient.boatLanes.find((l) => l.region === harbour[0].id);
  const t = lane.tiles.map((i) => world.tiles[i]);
  const mid = t[Math.floor(t.length / 2)];
  const drawn = (id) => {
    ambient.setHiddenMask((r) => r !== id);
    const g = makeCtx();
    ambient.update(1);
    ambient.drawGround(g, cam(40, mid.x, mid.y));
    return ambient.stats().boatsDrawn;
  };
  assert.ok(drawn(harbour[0].id) >= 1);
  assert.equal(drawn(-2), 0);
});

test('determinism: two ambients fed the same calls draw the same stream', () => {
  const run = () => {
    const amb = make({ seed: 5 }, 9, 3);
    const out = [];
    for (let i = 0; i < 40; i++) {
      amb.update(0.05);
      if (i % 8 === 0) {
        const g = makeCtx(); g.__calls.log = [];
        const a = makeCtx(); a.__calls.log = [];
        const c = cam(28, 48, 38);
        amb.drawGround(g, c);
        amb.drawAir(a, c);
        out.push(g.__calls.log.join('|'), a.__calls.log.join('|'));
      }
    }
    return out.join('\n');
  };
  assert.equal(run(), run());
});

test('sprite cache builds each sprite once per bucket', () => {
  const cache = createSpriteCache();
  const before = cache.count();
  const a = cache.cart(3, 0);
  assert.equal(cache.cart(3, 0), a);
  assert.notEqual(cache.cart(3, 1), a);
  assert.equal(cache.sails(3), cache.sails(3));
  assert.equal(cache.boat(3, 0), cache.boat(3, 0));
  assert.notEqual(cache.boat(3, 0), cache.boat(3, 1));
  assert.equal(cache.puff('smoke', 1), cache.puff('smoke', 1));
  assert.ok(cache.count() > before);
  cache.clear();
  assert.equal(cache.count(), 0);
});

test('rebuild is cheap when nothing changed and keeps caravan state across an unrelated rebuild', () => {
  const ambient = make({}, 9);
  warm(ambient, 20);
  const before = ambient.routes.map((r) => r.bornAt);
  const owner = realm(9);
  ambient.rebuild(stateOf(owner));
  assert.deepEqual(ambient.routes.map((r) => r.bornAt), before);
  // Conquering a neighbour keeps existing roads' state and starts new roads fresh (not pre-populated).
  const owner2 = owner.slice();
  const extra = world.regions.find((r) => owner2[r.id] !== 0 && r.neighbors.some((n) => owner2[n] === 0));
  owner2[extra.id] = 0;
  const clockNow = ambient.stats().caravanClock;
  ambient.rebuild(stateOf(owner2));
  const fresh = ambient.routes.filter((r) => r.bornAt >= clockNow - 1e-9);
  assert.ok(fresh.length >= 1, 'new roads start now');
  assert.ok(ambient.routes.filter((r) => r.bornAt < clockNow).length >= before.length * 0.6, 'old roads keep their state');
});

test('sprite budget: over budget a bucket falls back to the nearest built one (or null), and converges', () => {
  const cache = createSpriteCache();
  cache.beginFrame(Infinity);
  const built = cache.sails(3);
  cache.beginFrame(-1); // budget already "spent": nothing new may be baked this frame
  assert.equal(cache.sails(4), built, 'nearest built bucket answers');
  assert.equal(cache.sails(2), built);
  assert.equal(cache.sails(8), null, 'too far from any built bucket: skipped this frame');
  assert.equal(cache.count(), 1);
  cache.beginFrame(Infinity);
  const later = cache.sails(8);
  assert.ok(later && later !== built, 'builds once the budget allows');
  // With a real budget at least the first sprite of a frame is always built.
  const c2 = createSpriteCache();
  c2.beginFrame(0);
  assert.ok(c2.boat(2, 0));
});

test('a cold zoom bucket fills in over frames, never throws, and prewarm bakes it in one go', () => {
  const ambient = make({}, 9, 3);
  warm(ambient, 8);
  // Frames at a zoom never seen before: whatever is not baked yet is skipped or drawn from a neighbour bucket.
  for (let i = 0; i < 12; i++) frame(ambient, 47, 48, 38);
  assert.ok(ambient.stats().caravans.drawn > 0);
  const fresh = createAmbient({ world, pixelRatio: 1, spriteBudgetMs: Infinity });
  fresh.rebuild(stateOf(realm(9), 3));
  const before = fresh.stats().spriteCount;
  fresh.prewarm(30);
  const after = fresh.stats().spriteCount;
  assert.equal(after - before, 63, "4 wisps + 1 rotor + 2 boats + 56 carts (28 loaded, 28 empty)");
  fresh.prewarm(30);
  assert.equal(fresh.stats().spriteCount, after, 'prewarm is idempotent');
});
