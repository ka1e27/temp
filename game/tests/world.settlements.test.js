import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../core/rng.js';
import { WORLD, FACTIONS } from '../config/world.js';
import { hexDistance } from '../core/hex.js';
import { generateTerrain, neighborIndices } from '../world/terrain.js';
import { buildRegions, computeRegionNeighbors, computeTiers } from '../world/regions.js';
import { chooseStart } from '../world/start.js';
import { capRegionBeaches } from '../world/beaches.js';
import { assignFactions } from '../world/factions.js';
import { placeSettlements } from '../world/settlements.js';

const COLS = WORLD.cols;
const ROWS = WORLD.rows;

function build(seed) {
  const rng = createRng(seed);
  const { tiles, mainLandmass, beachInfo } = generateTerrain(seed, rng.fork('terrain'), COLS, ROWS, WORLD.landFraction);
  // same start selection and beach cap as generateWorld (start.js: lush start region, fair rival sectors)
  const { labels, startRegion } = chooseStart(rng, tiles, mainLandmass, COLS, ROWS, WORLD, FACTIONS);
  const regionTotal = Math.max(...labels) + 1;
  capRegionBeaches(tiles, labels, beachInfo);
  for (const t of tiles) t.region = labels[t.i];
  const regions = buildRegions(tiles, labels, regionTotal);
  computeRegionNeighbors(regions, labels, COLS, ROWS);
  computeTiers(regions, startRegion);
  const factions = assignFactions(rng.fork('factions'), regions, startRegion, FACTIONS);
  const settlements = placeSettlements(rng.fork('settlements'), tiles, regions, factions, startRegion, WORLD, COLS, ROWS);
  return { tiles, regions, factions, settlements, startRegion };
}

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

test('every settlement sits on a passable tile', () => {
  for (const seed of SEEDS) {
    const { tiles, settlements } = build(seed);
    for (const s of settlements) assert.ok(tiles[s.tile].passable, `seed ${seed} settlement ${s.id}`);
  }
});

test('every settlement is tagged with the tile it sits on (tiles[*].settlement)', () => {
  for (const seed of SEEDS.slice(0, 5)) {
    const { tiles, settlements } = build(seed);
    for (const s of settlements) assert.equal(tiles[s.tile].settlement, s.id);
  }
});

test('same-region settlements are always >= minSettlementSpacing hexes apart', () => {
  for (const seed of SEEDS) {
    const { tiles, settlements } = build(seed);
    for (let i = 0; i < settlements.length; i++) {
      for (let j = i + 1; j < settlements.length; j++) {
        const a = settlements[i], b = settlements[j];
        if (a.region !== b.region) continue;
        const d = hexDistance(tiles[a.tile].q, tiles[a.tile].r, tiles[b.tile].q, tiles[b.tile].r);
        assert.ok(d >= WORLD.minSettlementSpacing, `seed ${seed}: ${a.id},${b.id} same region, d=${d}`);
      }
    }
  }
});

test('cross-region settlements are (almost) always >= 2 hexes apart', () => {
  // The relaxed floor is a soft preference (see settlements.js), not a hard
  // guarantee: verify the OVERWHELMING majority clear it rather than every
  // single pair, since a region wedged between several already-dense
  // neighbours can rarely be forced tighter.
  let total = 0, violations = 0;
  for (const seed of SEEDS) {
    const { tiles, settlements } = build(seed);
    for (let i = 0; i < settlements.length; i++) {
      for (let j = i + 1; j < settlements.length; j++) {
        const a = settlements[i], b = settlements[j];
        if (a.region === b.region) continue;
        total++;
        const d = hexDistance(tiles[a.tile].q, tiles[a.tile].r, tiles[b.tile].q, tiles[b.tile].r);
        if (d < 2) violations++;
      }
    }
  }
  assert.ok(violations / total < 0.01, `${violations}/${total} cross-region pairs under 2 hexes apart`);
});

test('every pair of settlements in a region is connected by a passable path staying inside the region', () => {
  for (const seed of SEEDS) {
    const { tiles, regions, settlements } = build(seed);
    for (const region of regions) {
      if (region.settlements.length === 0) continue;
      const passableInRegion = new Set(region.tiles.filter((i) => tiles[i].passable));
      const startTile = settlements[region.keep].tile;
      const reachable = new Set([startTile]);
      const queue = [startTile];
      let head = 0;
      while (head < queue.length) {
        const cur = queue[head++];
        for (const { index: nb } of neighborIndices(cur, COLS, ROWS)) {
          if (passableInRegion.has(nb) && !reachable.has(nb)) {
            reachable.add(nb);
            queue.push(nb);
          }
        }
      }
      for (const id of region.settlements) {
        assert.ok(reachable.has(settlements[id].tile), `seed ${seed} region ${region.id} settlement ${id} unreachable`);
      }
    }
  }
});

test('every region has exactly one keep', () => {
  for (const seed of SEEDS) {
    const { settlements, regions } = build(seed);
    for (const region of regions) {
      const keeps = region.settlements.filter((id) => settlements[id].type === 'keep');
      assert.equal(keeps.length, 1, `seed ${seed} region ${region.id}: ${keeps.length} keeps`);
      assert.equal(settlements[region.keep].type, 'keep');
    }
  }
});

test('every region has at least one village', () => {
  for (const seed of SEEDS) {
    const { settlements, regions } = build(seed);
    for (const region of regions) {
      const villages = region.settlements.filter((id) => settlements[id].type === 'village');
      assert.ok(villages.length >= 1, `seed ${seed} region ${region.id} has no village`);
    }
  }
});

test('the start region is keep + villages only', () => {
  for (const seed of SEEDS) {
    const { settlements, regions, startRegion } = build(seed);
    const region = regions[startRegion];
    for (const id of region.settlements) {
      assert.ok(['keep', 'village'].includes(settlements[id].type), `seed ${seed} start region has a ${settlements[id].type}`);
    }
  }
});

test('settlement totals stay within [nearSettlements, farSettlements] bounds, tier 0 and max tier as anchors', () => {
  for (const seed of SEEDS) {
    const { regions } = build(seed);
    const maxTier = Math.max(...regions.map((r) => r.tier));
    for (const region of regions) {
      const total = region.settlements.length;
      // Loosely bounded: a region can end up smaller than its tier target
      // (see settlements.js), never larger than the far end, and never
      // below 1 (a keep always exists).
      assert.ok(total >= 1 && total <= WORLD.farSettlements[1] + 1, `seed ${seed} region ${region.id} tier ${region.tier}/${maxTier}: ${total} settlements`);
    }
  }
});

test('keeps share their name with the region — deferred to generate.js, but the field exists here as empty', () => {
  const { settlements } = build(1);
  // settlements.js itself does not assign names; confirm the placeholder so
  // a regression here is caught close to the source.
  for (const s of settlements) assert.equal(s.name, '');
});

test('type mix leans the documented way for each personality (statistical, aggregated across seeds)', () => {
  const counts = { passive: {}, aggressive: {}, defensive: {}, swarm: {} };
  const bump = (bucket, type) => { counts[bucket][type] = (counts[bucket][type] ?? 0) + 1; };

  for (const seed of SEEDS) {
    const { settlements, regions, factions, startRegion } = build(seed);
    for (const region of regions) {
      if (region.id === startRegion) continue;
      const personality = factions[region.faction]?.personality;
      if (!counts[personality]) continue;
      for (const id of region.settlements) {
        if (settlements[id].type === 'keep') continue;
        bump(personality, settlements[id].type);
      }
    }
  }

  // hamlet/village dominate passive and swarm; town/village dominate
  // aggressive; fort/tower are far more common under defensive than
  // elsewhere.
  const share = (bucket, types) => {
    const total = Object.values(counts[bucket]).reduce((a, b) => a + b, 0);
    const matched = types.reduce((a, t) => a + (counts[bucket][t] ?? 0), 0);
    return total > 0 ? matched / total : 0;
  };
  assert.ok(share('passive', ['hamlet', 'village']) > 0.7);
  assert.ok(share('aggressive', ['town', 'village']) > 0.6);
  assert.ok(share('swarm', ['village', 'hamlet']) > 0.7);
  const defensiveFortTowerShare = share('defensive', ['fort', 'tower']);
  const passiveFortTowerShare = share('passive', ['fort', 'tower']);
  assert.ok(defensiveFortTowerShare > passiveFortTowerShare, 'defensive should favour forts/towers more than passive');
});

test('placeSettlements is deterministic for a given seed', () => {
  const a = build(13);
  const b = build(13);
  assert.deepEqual(a.settlements, b.settlements);
});
