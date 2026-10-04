// A varied map in the world (DESIGN §10.13): types and twists, seeded, beyond the first ring only, one Dragon's Lair, Siege on every
// rival capital; the feature sites' tiles; and nothing else in the world changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/generate.js';
import { assignRegionFeatures, gateTile, banditTile, ancientTowerTile, shrineTiles, floodedEdge } from '../world/regionFeatures.js';
import { FEATURES, REGION_TYPES, TWISTS } from '../config/features.js';
import { hexDistance } from '../core/hex.js';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

test('types and twists: none on the start region or the first ring; one Dragon\'s Lair, deep; Siege on every rival capital', () => {
  let typed = 0;
  let twisted = 0;
  let eligible = 0;
  for (const seed of SEEDS) {
    const w = generateWorld(seed);
    const lairs = w.regions.filter((r) => r.type === 'dragon');
    assert.equal(lairs.length, 1, `seed ${seed}: one lair`);
    const maxTier = Math.max(...w.regions.map((r) => r.tier));
    assert.ok(lairs[0].tier >= Math.round(maxTier * FEATURES.dragonFromTierShare) && !lairs[0].isCapital);
    assert.equal(lairs[0].twist, null, 'the boss fight has no twist');
    // the Lair is optional: every other region stays reachable from the start without it
    const seen = new Set([w.startRegion]);
    const queue = [w.startRegion];
    while (queue.length) { const c = queue.shift(); for (const n of w.regions[c].neighbors) if (n !== lairs[0].id && !seen.has(n)) { seen.add(n); queue.push(n); } }
    assert.equal(seen.size, w.regions.length - 1, `seed ${seed}: skipping the Lair locks nothing away`);
    for (const r of w.regions) {
      assert.ok(r.type === null || REGION_TYPES.includes(r.type));
      assert.ok(r.twist === null || TWISTS.includes(r.twist));
      if (r.tier < FEATURES.minTier || r.id === w.startRegion) {
        assert.equal(r.type, null, `seed ${seed} ${r.name}: first ring clean`);
        assert.equal(r.twist, null);
        continue;
      }
      if (r.isCapital) assert.equal(r.twist, 'siege', 'every rival capital is a siege');
      if (r.isCapital) assert.equal(r.type, null);
      if (!r.isCapital && r.type !== 'dragon') {
        eligible += 1;
        if (r.type) typed += 1;
        if (r.twist) twisted += 1;
      }
    }
  }
  assert.ok(typed / eligible > 0.15 && typed / eligible < 0.35, `about 1 in 4 typed (${typed}/${eligible})`);
  assert.ok(twisted / eligible > 0.2 && twisted / eligible < 0.4, `about 1 in 3 twisted (${twisted}/${eligible})`);
});

test('deterministic, and assigning features changes nothing else in the world', () => {
  const a = generateWorld(4);
  const b = generateWorld(4);
  assert.deepEqual(a.regions.map((r) => [r.type, r.twist]), b.regions.map((r) => [r.type, r.twist]));
  const before = JSON.stringify({ tiles: a.tiles, settlements: a.settlements, factions: a.factions, regions: a.regions.map(({ type, twist, ...rest }) => rest) });
  assignRegionFeatures(a);
  const after = JSON.stringify({ tiles: a.tiles, settlements: a.settlements, factions: a.factions, regions: a.regions.map(({ type, twist, ...rest }) => rest) });
  assert.equal(after, before);
  assert.deepEqual(a.regions.map((r) => [r.type, r.twist]), b.regions.map((r) => [r.type, r.twist]), 'idempotent');
});

test('feature tiles: in the region, passable, no settlement; the Gate next to the keep; three spread Shrines; Flooded is walkable', () => {
  for (const seed of SEEDS) {
    const w = generateWorld(seed);
    for (const r of w.regions) {
      const keep = w.tiles[w.settlements[r.keep].tile];
      const check = (i, what) => {
        const t = w.tiles[i];
        assert.equal(t.region, r.id, `${what} in its region`);
        assert.ok(t.passable && t.settlement === -1, `${what} on free land`);
      };
      if (r.twist === 'siege') {
        const g = gateTile(w, r.id);
        assert.ok(g != null, `seed ${seed} ${r.name}: a Gate tile`);
        check(g, 'gate');
        assert.ok(hexDistance(w.tiles[g].q, w.tiles[g].r, keep.q, keep.r) <= 2);
      }
      if (r.type === 'bandit') { const b = banditTile(w, r.id); assert.ok(b != null); check(b, 'bandit'); }
      if (r.type === 'ruins') { const a = ancientTowerTile(w, r.id); assert.ok(a != null); check(a, 'tower'); }
      if (r.twist === 'raid') {
        const s = shrineTiles(w, r.id);
        assert.equal(s.length, FEATURES.shrine.count);
        for (const i of s) check(i, 'shrine');
        assert.equal(new Set(s).size, s.length);
      }
      if (r.twist === 'flooded') {
        // the region's land is one piece when rivers can only be crossed on bridges
        const tiles = r.tiles.map((i) => w.tiles[i]).filter((t) => t.passable);
        const byQR = new Map(w.tiles.map((t) => [`${t.q},${t.r}`, t]));
        const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
        const seen = new Set([keep.i]);
        const q = [keep];
        while (q.length) {
          const c = q.shift();
          DIRS.forEach(([dq, dr], dir) => {
            const n = byQR.get(`${c.q + dq},${c.r + dr}`);
            if (!n || n.region !== r.id || !n.passable || seen.has(n.i) || floodedEdge(c, n, dir)) return;
            seen.add(n.i);
            q.push(n);
          });
        }
        assert.equal(seen.size, tiles.length);
      }
    }
  }
});
