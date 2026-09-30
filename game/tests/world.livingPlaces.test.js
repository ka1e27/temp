import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/generate.js';
import { hexDistance, DIRS } from '../core/hex.js';
import { createProsperityPlan, FEATURE_LEVEL, DECOR_REACH } from '../world/prosperityPlan.js';
import { collectChimneys, buildBoatLanes, forestSpots, seaTiles } from '../world/ambientPlaces.js';
import { AMBIENT } from '../config/ambient.js';

const SEEDS = [1, 7, 13, 42];
const worlds = new Map();
const world = (seed) => {
  if (!worlds.has(seed)) worlds.set(seed, generateWorld(seed));
  return worlds.get(seed);
};
const each = (name, fn) => test(name, () => { for (const seed of SEEDS) fn(seed, world(seed)); });
const nb = (w, t, d) => {
  const r = t.r + DIRS[d].r;
  const col = t.q + DIRS[d].q + (r - (r & 1)) / 2;
  return col < 0 || col >= w.cols || r < 0 || r >= w.rows ? null : w.tiles[r * w.cols + col];
};

// ---------------------------------------------------------------- prosperity plan -----

each('plan: deterministic', (seed, w) => {
  const dump = (p) => JSON.stringify(w.tiles.map((t) => p.info(t.i)));
  assert.equal(dump(createProsperityPlan(w)), dump(createProsperityPlan(w)));
});

each('plan: every decorated tile is a land tile of its own region', (seed, w) => {
  const plan = createProsperityPlan(w);
  let n = 0;
  for (const t of w.tiles) {
    const info = plan.info(t.i);
    if (!info) continue;
    n++;
    assert.ok(t.land && t.region >= 0, `seed ${seed} tile ${t.i}`);
    assert.equal(info.region, t.region);
    assert.ok(w.regions[t.region].tiles.includes(t.i));
    assert.ok(plan.regionTiles(t.region).includes(t.i));
  }
  assert.equal(n, plan.decorTileCount);
  assert.ok(n > 100);
});

each('plan: nothing but paving ever lands on a settlement tile; buildings never on roads, nothing on rivers', (seed, w) => {
  const plan = createProsperityPlan(w);
  for (const t of w.tiles) {
    const i = plan.info(t.i);
    if (!i) continue;
    if (t.settlement !== -1) assert.ok(!i.farm && !i.orchard && !i.hedge && !i.scarecrow && !i.hay && !i.cottages && !i.windmill && !i.market, `seed ${seed} settlement tile ${t.i}`);
    if (i.windmill || i.cottages || i.orchard || i.hedge || i.scarecrow) {
      // Buildings, orchards, hedges and scarecrows never stand on a road or a river.
      assert.ok(!t.road, `seed ${seed} tile ${t.i} has a road`);
      assert.ok(!t.river, `seed ${seed} tile ${t.i} has a river`);
    }
    if (i.windmill || i.cottages || i.farm) assert.equal(t.elev, 1, 'decor sits on lowland');
    assert.notEqual(t.terrain, 'mountain');
  }
});

each('plan: the paved set is exactly the region road tiles', (seed, w) => {
  const plan = createProsperityPlan(w);
  for (const t of w.tiles) {
    if (t.region < 0) continue;
    assert.equal(!!plan.info(t.i)?.paved, t.road !== 0, `seed ${seed} tile ${t.i}`);
  }
});

each('plan: level I decorates the EXISTING farmland (tiles next to a hamlet/village/town), nothing else', (seed, w) => {
  const plan = createProsperityPlan(w);
  const seeds = w.settlements.filter((s) => ['hamlet', 'village', 'town'].includes(s.type));
  let farm = 0; let hay = 0; let hedges = 0;
  const orchards = new Map(); const scarecrows = new Map();
  for (const t of w.tiles) {
    const i = plan.info(t.i);
    if (!i) continue;
    const nextToSettlement = seeds.some((s) => hexDistance(t.q, t.r, w.tiles[s.tile].q, w.tiles[s.tile].r) === 1);
    if (i.farm) {
      farm++;
      assert.ok(nextToSettlement && t.elev === 1 && t.settlement === -1, `seed ${seed} farm tile ${t.i} is not base-bake farmland`);
    } else {
      assert.ok(!i.orchard && !i.hedge && !i.scarecrow && !i.hay, `seed ${seed} tile ${t.i}: farm features off the farmland`);
    }
    if (i.hay) { hay++; assert.ok(i.hay >= 1 && i.hay <= 3); }
    if (i.hedge) { hedges++; assert.ok(i.hedge.axis >= 0 && i.hedge.axis <= 2 && Math.abs(i.hedge.off) < 0.4); }
    if (i.orchard) { orchards.set(t.region, (orchards.get(t.region) || 0) + 1); assert.ok(i.orchard.n >= 5 && i.orchard.n <= 7); }
    if (i.scarecrow) scarecrows.set(t.region, (scarecrows.get(t.region) || 0) + 1);
    if (i.cottages || i.windmill || i.market) assert.ok(!i.orchard && !i.hedge && !i.scarecrow && !i.hay, 'no farm clutter on a structure tile');
  }
  assert.ok(farm > 30 && hay > 10 && hedges > 5, `seed ${seed}: farm ${farm}, hay ${hay}, hedges ${hedges}`);
  for (const n of orchards.values()) assert.ok(n <= 5);
  for (const n of scarecrows.values()) assert.equal(n, 1);
  assert.ok(orchards.size >= w.regions.length * 0.6, `seed ${seed}: orchards in ${orchards.size} of ${w.regions.length} regions`);
  // Orchards of one region never touch each other.
  const os = w.tiles.filter((t) => plan.info(t.i)?.orchard);
  for (const x of os) for (const y of os) if (x !== y && x.region === y.region) assert.ok(hexDistance(x.q, x.r, y.q, y.r) >= 2);
});

each('plan: at most one windmill per region, two hexes from any settlement, sails hub exported', (seed, w) => {
  const plan = createProsperityPlan(w);
  const perRegion = new Map();
  for (const m of plan.windmills) {
    perRegion.set(m.region, (perRegion.get(m.region) || 0) + 1);
    const t = w.tiles[m.tile];
    assert.equal(plan.info(m.tile).windmill, true);
    assert.equal(t.region, m.region);
    for (const s of w.settlements) assert.ok(hexDistance(t.q, t.r, w.tiles[s.tile].q, w.tiles[s.tile].r) >= 2, `seed ${seed} mill ${m.tile} too close to settlement ${s.id}`);
    assert.ok(Math.abs(m.x - (t.x + AMBIENT.windmill.hubDx)) < 1e-9);
    assert.ok(Math.abs(m.y - (t.y - AMBIENT.elevLift[t.elev] + AMBIENT.windmill.hubDy)) < 1e-9);
    assert.ok(Number.isFinite(m.phase));
  }
  for (const n of perRegion.values()) assert.equal(n, 1);
  assert.ok(plan.windmills.length >= w.regions.length * 0.35, `seed ${seed}: ${plan.windmills.length} windmills`);
  assert.equal(plan.windmillsOf(plan.windmills[0].region).length, 1);
});

each('plan: cottages beside a village/town, one or two per tile; market beside the keep', (seed, w) => {
  const plan = createProsperityPlan(w);
  let cottageTiles = 0;
  for (const t of w.tiles) {
    const i = plan.info(t.i);
    if (!i) continue;
    if (i.cottages) {
      cottageTiles++;
      assert.ok(i.cottages.length >= 1 && i.cottages.length <= 2);
      const adj = Array.from({ length: 6 }, (_, d) => nb(w, t, d)).filter(Boolean)
        .some((n) => n.settlement !== -1 && ['village', 'town'].includes(w.settlements[n.settlement].type) && n.region === t.region);
      assert.ok(adj, `seed ${seed} cottage tile ${t.i} not beside a village/town`);
      assert.ok(!i.windmill && !i.market);
    }
    if (i.market) {
      const keep = w.tiles[w.settlements[w.regions[t.region].keep].tile];
      assert.equal(hexDistance(t.q, t.r, keep.q, keep.r), 1, `seed ${seed} market not beside the keep`);
      assert.equal(t.settlement, -1);
    }
  }
  assert.ok(cottageTiles >= 5);
  const marketPerRegion = w.regions.map((r) => plan.regionTiles(r.id).filter((ti) => plan.info(ti).market).length);
  assert.ok(marketPerRegion.every((n) => n <= 1));
  assert.ok(marketPerRegion.filter((n) => n === 1).length >= w.regions.length * 0.8);
});

each('plan: boundsOf covers every decor tile with the documented reach', (seed, w) => {
  const plan = createProsperityPlan(w);
  for (const r of w.regions) {
    const b = plan.boundsOf(r.id);
    if (!plan.regionTiles(r.id).length) { assert.equal(b, null); continue; }
    for (const ti of plan.regionTiles(r.id)) {
      const t = w.tiles[ti];
      assert.ok(t.x - DECOR_REACH.left >= b.minX - 1e-9 && t.x + DECOR_REACH.right <= b.maxX + 1e-9);
      assert.ok(t.y - DECOR_REACH.up >= b.minY - 1e-9 && t.y + DECOR_REACH.down <= b.maxY + 1e-9);
    }
  }
});

test('plan: feature levels match DESIGN §5.6', () => {
  assert.deepEqual({ ...FEATURE_LEVEL }, { farm: 1, cottages: 2, windmill: 2, paved: 3, market: 3 });
});

// ---------------------------------------------------------------- ambient places -----

each('boat lanes: open-sea water tiles within two hexes of a Harbour region coast', (seed, w) => {
  const sea = seaTiles(w);
  const lanes = buildBoatLanes(w);
  assert.ok(lanes.length >= 1, `seed ${seed}: no boat lanes`);
  for (const lane of lanes) {
    assert.equal(w.regions[lane.region].perk, 'harbour');
    assert.ok(lane.tiles.length >= 2 && lane.tiles.length <= AMBIENT.boats.laneTiles[1]);
    const coast = w.regions[lane.region].tiles.map((i) => w.tiles[i]).filter((t) => t.coast);
    for (const i of lane.tiles) {
      const t = w.tiles[i];
      assert.ok(!t.land, 'boats sail on water');
      assert.ok(sea[i], 'open sea, not an inland lake');
      assert.ok(coast.some((c) => hexDistance(t.q, t.r, c.q, c.r) <= 2), `seed ${seed}: lane strays from the coast`);
    }
    for (let k = 0; k < lane.tiles.length - 1; k++) {
      const a = w.tiles[lane.tiles[k]]; const b = w.tiles[lane.tiles[k + 1]];
      assert.equal(hexDistance(a.q, a.r, b.q, b.r), 1);
    }
    // Smoothed path: starts/ends inside the lane's first/last tile; length equals the cumulative sum.
    assert.ok(Math.abs(lane.cum[lane.cum.length - 1] - lane.length) < 1e-4);
    for (let i = 0; i < lane.pts.length; i += 2) {
      const near = lane.tiles.some((ti) => Math.hypot(lane.pts[i] - w.tiles[ti].x, lane.pts[i + 1] - w.tiles[ti].y) <= 1.05);
      assert.ok(near, 'path points stay over the lane tiles');
    }
  }
});

each('boat lanes: deterministic, at most maxBoats per region', (seed, w) => {
  const dump = () => JSON.stringify(buildBoatLanes(w).map((l) => ({ ...l, pts: Array.from(l.pts), cum: Array.from(l.cum) })));
  assert.equal(dump(), dump());
  const per = new Map();
  for (const l of buildBoatLanes(w)) per.set(l.region, (per.get(l.region) || 0) + 1);
  for (const n of per.values()) assert.ok(n <= AMBIENT.boats.perHarbour[1]);
});

each('seaTiles: water only, and every map-edge water tile is sea', (seed, w) => {
  const sea = seaTiles(w);
  for (const t of w.tiles) {
    if (sea[t.i]) assert.ok(!t.land);
    if (!t.land && (t.col === 0 || t.row === 0 || t.col === w.cols - 1 || t.row === w.rows - 1)) assert.ok(sea[t.i]);
  }
});

each('chimneys: one per configured anchor, on the settlement, with the elevation lift applied', (seed, w) => {
  const ch = collectChimneys(w);
  const expected = w.settlements.reduce((n, s) => n + (AMBIENT.smoke.chimneys[s.type]?.length || 0), 0);
  assert.equal(ch.length, expected);
  for (const c of ch) {
    const s = w.settlements[c.settlement];
    const t = w.tiles[s.tile];
    assert.ok(Math.abs(c.x - t.x) < 1.2);
    assert.ok(c.y < t.y - AMBIENT.elevLift[t.elev] + 0.01 && c.y > t.y - 1.6);
    assert.equal(c.region, s.region);
    assert.ok(c.phase >= 0 && c.phase < 1);
  }
  assert.ok(!ch.some((c) => c.type === 'fort' || c.type === 'tower'));
});

each('forest spots: every forest/pine tile of a region, in tile order', (seed, w) => {
  const f = forestSpots(w);
  const expected = w.tiles.filter((t) => (t.terrain === 'forest' || t.terrain === 'pine') && t.region >= 0);
  assert.equal(f.count, expected.length);
  expected.forEach((t, i) => { assert.equal(f.regions[i], t.region); assert.ok(Math.abs(f.xs[i] - t.x) < 1e-3); });
});
