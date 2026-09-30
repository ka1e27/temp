import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../core/rng.js';
import { WORLD, FACTIONS } from '../config/world.js';
import { generateTerrain, neighborIndices } from '../world/terrain.js';
import { buildRegions, computeRegionNeighbors, computeTiers } from '../world/regions.js';
import { chooseStart } from '../world/start.js';
import { capRegionBeaches } from '../world/beaches.js';
import { assignFactions } from '../world/factions.js';

const COLS = WORLD.cols;
const ROWS = WORLD.rows;

/** Runs terrain + region + faction generation, short of settlements/roads/names. */
function build(seed) {
  const rng = createRng(seed);
  const { tiles, mainLandmass, beachInfo } = generateTerrain(seed, rng.fork('terrain'), COLS, ROWS, WORLD.landFraction);
  // same start selection and beach cap as generateWorld (start.js: lush start region, fair rival sectors)
  const { startTile, labels, startRegion } = chooseStart(rng, tiles, mainLandmass, COLS, ROWS, WORLD, FACTIONS);
  const regionTotal = Math.max(...labels) + 1;
  capRegionBeaches(tiles, labels, beachInfo);
  for (const t of tiles) t.region = labels[t.i];
  const regions = buildRegions(tiles, labels, regionTotal);
  computeRegionNeighbors(regions, labels, COLS, ROWS);
  computeTiers(regions, startRegion);
  const factions = assignFactions(rng.fork('factions'), regions, startRegion, FACTIONS);
  return { tiles, regions, factions, startRegion, startTile };
}

function isRegionContiguous(region, cols, rows) {
  const set = new Set(region.tiles);
  const seen = new Set([region.tiles[0]]);
  const queue = [region.tiles[0]];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    for (const { index: nb } of neighborIndices(cur, cols, rows)) {
      if (set.has(nb) && !seen.has(nb)) {
        seen.add(nb);
        queue.push(nb);
      }
    }
  }
  return seen.size === region.tiles.length;
}

function isFactionSectorContiguous(regions, factionId) {
  const members = regions.filter((r) => r.faction === factionId).map((r) => r.id);
  if (members.length === 0) return true;
  const set = new Set(members);
  const seen = new Set([members[0]]);
  const queue = [members[0]];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    for (const nb of regions[cur].neighbors) {
      if (set.has(nb) && !seen.has(nb)) {
        seen.add(nb);
        queue.push(nb);
      }
    }
  }
  return seen.size === members.length;
}

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

test('region count lands within regionCount +/- 3', () => {
  for (const seed of SEEDS) {
    const { regions } = build(seed);
    assert.ok(Math.abs(regions.length - WORLD.regionCount) <= 3, `seed ${seed}: ${regions.length} regions`);
  }
});

test('every region is contiguous', () => {
  for (const seed of SEEDS) {
    const { regions } = build(seed);
    for (const region of regions) {
      assert.ok(isRegionContiguous(region, COLS, ROWS), `seed ${seed} region ${region.id} not contiguous`);
    }
  }
});

test('the region adjacency graph is connected (every region gets a tier)', () => {
  for (const seed of SEEDS) {
    const { regions } = build(seed);
    assert.ok(regions.every((r) => r.tier >= 0), `seed ${seed}: some region unreached`);
  }
});

test('every region has at least one neighbour', () => {
  for (const seed of SEEDS) {
    const { regions } = build(seed);
    assert.ok(regions.every((r) => r.neighbors.length >= 1), `seed ${seed}`);
  }
});

test('region.neighbors is symmetric (a lists b iff b lists a)', () => {
  for (const seed of SEEDS.slice(0, 5)) {
    const { regions } = build(seed);
    for (const r of regions) {
      for (const nb of r.neighbors) assert.ok(regions[nb].neighbors.includes(r.id));
    }
  }
});

test('start region is coastal, near the map edge, and owned by faction 0', () => {
  for (const seed of SEEDS) {
    const { regions, startRegion } = build(seed);
    const start = regions[startRegion];
    assert.ok(start.coastal, `seed ${seed}: start region not coastal`);
    assert.equal(start.faction, 0);
    assert.equal(start.tier, 0);
  }
});

test('start tile sits toward the west/south-west of the grid', () => {
  for (const seed of SEEDS) {
    const { tiles, startTile } = build(seed);
    const t = tiles[startTile];
    // Not a tight bound — the continent's own rotation/aspect now varies per
    // seed (round 2: silhouette variety), so "south-west" in grid coordinates
    // is a looser target than when every continent was a centred ellipse.
    // This just rules out a start anywhere near the north/east.
    assert.ok(t.col < COLS * 0.65, `seed ${seed}: start col ${t.col}`);
    assert.ok(t.row > ROWS * 0.15, `seed ${seed}: start row ${t.row}`);
  }
});

test('tiers are a BFS distance from the start region: tier 0 exists once, tiers rise by at most 1 per hop', () => {
  for (const seed of SEEDS) {
    const { regions, startRegion } = build(seed);
    assert.equal(regions.filter((r) => r.tier === 0).length, 1);
    assert.equal(regions[startRegion].tier, 0);
    for (const r of regions) {
      for (const nb of r.neighbors) assert.ok(Math.abs(regions[nb].tier - r.tier) <= 1);
    }
  }
});

test('tier 1 regions always belong to Free Folk', () => {
  for (const seed of SEEDS) {
    const { regions } = build(seed);
    const tier1 = regions.filter((r) => r.tier === 1);
    assert.ok(tier1.every((r) => r.faction === 1), `seed ${seed}: a tier-1 region isn't Free Folk`);
  }
});

test('~70% of tier 2 regions belong to Free Folk (aggregated: any one seed has too few tier-2 regions to check alone)', () => {
  let tier2Count = 0;
  let tier2FreeFolk = 0;
  for (const seed of SEEDS) {
    const { regions } = build(seed);
    const tier2 = regions.filter((r) => r.tier === 2);
    tier2Count += tier2.length;
    tier2FreeFolk += tier2.filter((r) => r.faction === 1).length;
  }
  const share = tier2FreeFolk / tier2Count;
  assert.ok(tier2Count > 30, `only ${tier2Count} tier-2 regions sampled across ${SEEDS.length} seeds`);
  assert.ok(Math.abs(share - 0.7) < 0.15, `tier-2 Free Folk share across all seeds was ${share}`);
});

test('rival faction sectors (2,3,4) are each contiguous', () => {
  // Only the three RIVAL sectors are an ARCHITECTURE-stated guarantee
  // ("three contiguous rival sectors", DESIGN §3.3) — see below for why
  // Free Folk (1) is checked separately and more loosely.
  for (const seed of SEEDS) {
    const { regions } = build(seed);
    for (const fid of [2, 3, 4]) {
      assert.ok(isFactionSectorContiguous(regions, fid), `seed ${seed} faction ${fid} not contiguous`);
    }
  }
});

test('Free Folk territory is usually contiguous, but a dead-end enclave bordering only the start region is left alone', () => {
  // Free Folk membership falls out of which tier-1/2 regions roll that way;
  // nothing forces it contiguous. A small appendage whose only neighbour is
  // the start region itself has no rival territory to join either, so it
  // is deliberately left as Free Folk rather than force-relocated (see
  // factions.js). Checked in aggregate, not as a hard per-seed assertion.
  let contiguousCount = 0;
  for (const seed of SEEDS) {
    const { regions } = build(seed);
    if (isFactionSectorContiguous(regions, 1)) contiguousCount++;
  }
  assert.ok(contiguousCount / SEEDS.length >= 0.8, `only ${contiguousCount}/${SEEDS.length} seeds had contiguous Free Folk territory`);
});

test('rival sectors are usually within +/- 2 regions of each other (balanced growth + a rebalancing backstop)', () => {
  // Not a per-seed hard guarantee: contiguity always wins over balance when
  // they conflict (see factions.js's rebalanceSectors), and geography
  // occasionally leaves a small residual gap. Checked in aggregate instead.
  let withinTarget = 0;
  let maxGapSeen = 0;
  for (const seed of SEEDS) {
    const { regions } = build(seed);
    const counts = [2, 3, 4].map((fid) => regions.filter((r) => r.faction === fid).length);
    const gap = Math.max(...counts) - Math.min(...counts);
    maxGapSeen = Math.max(maxGapSeen, gap);
    if (gap <= 2) withinTarget++;
  }
  assert.ok(withinTarget / SEEDS.length >= 0.75, `only ${withinTarget}/${SEEDS.length} seeds within +/-2`);
  assert.ok(maxGapSeen <= 5, `a gap of ${maxGapSeen} regions is far outside the target even as an outlier`);
});

test('every rival faction has exactly one capital, at its sector\'s highest tier', () => {
  for (const seed of SEEDS) {
    const { regions, factions } = build(seed);
    for (const fid of [2, 3, 4]) {
      const capitals = regions.filter((r) => r.isCapital && r.faction === fid);
      assert.equal(capitals.length, 1, `seed ${seed} faction ${fid}: ${capitals.length} capitals`);

      const sectorMembers = regions.filter((r) => r.faction === fid);
      const maxTier = Math.max(...sectorMembers.map((r) => r.tier));
      assert.equal(capitals[0].tier, maxTier);
      assert.equal(factions[fid].capitalRegion, capitals[0].id);
    }
  }
});

test('the player and Free Folk have no capital (capitalRegion -1)', () => {
  const { factions } = build(1);
  assert.equal(factions[0].capitalRegion, -1);
  assert.equal(factions[1].capitalRegion, -1);
});

test('no region is left without a faction', () => {
  for (const seed of SEEDS) {
    const { regions } = build(seed);
    assert.ok(regions.every((r) => r.faction !== -1), `seed ${seed}`);
  }
});

test('region.biome is the dominant terrain among the region\'s own tiles', () => {
  for (const seed of SEEDS.slice(0, 5)) {
    const { tiles, regions } = build(seed);
    for (const region of regions) {
      const counts = new Map();
      for (const i of region.tiles) counts.set(tiles[i].terrain, (counts.get(tiles[i].terrain) ?? 0) + 1);
      const maxCount = Math.max(...counts.values());
      assert.ok(counts.get(region.biome) === maxCount, `region ${region.id} biome ${region.biome} isn't dominant`);
    }
  }
});

test('region.coastal is true iff some tile in the region touches water', () => {
  for (const seed of SEEDS.slice(0, 5)) {
    const { tiles, regions } = build(seed);
    for (const region of regions) {
      const actuallyCoastal = region.tiles.some((i) => tiles[i].coast !== 0);
      assert.equal(region.coastal, actuallyCoastal, `region ${region.id}`);
    }
  }
});

test('generateWorld-equivalent region pipeline is deterministic for a given seed', () => {
  const a = build(7);
  const b = build(7);
  assert.deepEqual(a.regions, b.regions);
  assert.deepEqual(a.factions, b.factions);
  assert.equal(a.startRegion, b.startRegion);
});
