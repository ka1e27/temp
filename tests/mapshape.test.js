// Region SILHOUETTES: the campaign is not fought on twenty-four rectangles.
//
// The properties here are the ones the rest of mapgen LEANS ON rather than the
// ones that describe how a shape looks. A `narrow` valley that is 3% narrower
// than intended is a tuning question; a `narrow` valley with an unreachable
// pocket in it is a battle nobody can finish, and `repairConnectivity` is
// explicitly forbidden from fixing that by drilling through the silhouette.
//
// Every shape is checked at every grid the region table actually ships, on
// several seeds, because a shape is generated from `cols`/`rows` and a 21x16
// board is not a scaled-up 11x9 one.
import test from 'node:test';
import assert from 'node:assert/strict';

import { shapeMask, maskConnected, SHAPES, SQUEEZE } from '../src/battle/mapshape.js';
import { generateBattleMap, verifyReachable } from '../src/battle/mapgen.js';
import { REGIONS } from '../src/content/regions.data.js';
import { MAPGEN } from '../src/content/balance.js';

const GRIDS = [...new Set(REGIONS.map((r) => `${r.grid.cols}x${r.grid.rows}`))]
  .map((s) => s.split('x').map(Number));
const SEEDS = [1, 2, 7, 99, 12345];
const SHAPED = SHAPES.filter((s) => s !== 'open');

const specFor = (region) => ({
  cols: region.grid.cols,
  rows: region.grid.rows,
  enemySites: region.siteCounts.enemy,
  neutralSites: region.siteCounts.neutral,
  playerSites: region.siteCounts.player,
  enemyMult: region.enemyMult,
  develop: region.develop,
  tier: region.tier,
  region,
});

// ---------------------------------------------------------------------------
// The mask itself
// ---------------------------------------------------------------------------

test('shape: `open` is the rectangle, exactly — the negative control', () => {
  // Every win rate this campaign was measured on came off an unmasked board, so
  // this is not a formality: if `open` ever carved one hex, six regions would be
  // silently re-tuned and nothing else here would notice.
  for (const [cols, rows] of GRIDS) {
    for (const seed of SEEDS) {
      assert.equal(shapeMask('open', cols, rows, seed).size, 0);
      assert.equal(shapeMask(undefined, cols, rows, seed).size, 0);
      assert.equal(shapeMask('no-such-shape', cols, rows, seed).size, 0,
        'an unknown shape must fall back to the rectangle, never throw mid-battle');
    }
  }
});

test('shape: the open ground is always ONE connected region', () => {
  // The guarantee mapgen leans on. `repairConnectivity` may not clear shape rock
  // — that would drill through the silhouette — so the silhouette has to arrive
  // connected rather than be repaired into it.
  for (const [cols, rows] of GRIDS) {
    for (const shape of SHAPED) {
      for (const seed of SEEDS) {
        const mask = shapeMask(shape, cols, rows, seed);
        assert.ok(maskConnected(cols, rows, mask),
          `${shape} ${cols}x${rows} seed=${seed} left an unreachable pocket`);
      }
    }
  }
});

test('shape: every shape carves a real amount, and none of them eats the map', () => {
  // A floor AND a ceiling. A shape that carves 2% is decoration nobody sees; one
  // that carves half the board silently halves the site density the whole region
  // table was tuned at.
  for (const [cols, rows] of GRIDS) {
    for (const shape of SHAPED) {
      for (const seed of SEEDS) {
        const frac = shapeMask(shape, cols, rows, seed).size / (cols * rows);
        assert.ok(frac >= 0.04, `${shape} ${cols}x${rows} carved only ${(frac * 100) | 0}%`);
        assert.ok(frac <= 0.34, `${shape} ${cols}x${rows} carved ${(frac * 100) | 0}%`);
      }
    }
  }
});

test('shape: it is a pure function of (shape, cols, rows, seed)', () => {
  for (const shape of SHAPED) {
    const a = shapeMask(shape, 16, 13, 4242);
    const b = shapeMask(shape, 16, 13, 4242);
    assert.deepEqual([...a].sort(), [...b].sort());
    // ...and the seed genuinely moves it, or every region of a shape would be
    // the same board with different site counts.
    const c = shapeMask(shape, 16, 13, 4243);
    assert.notDeepEqual([...a].sort(), [...c].sort(), `${shape} ignores its seed`);
  }
});

test('shape: the four silhouettes are actually different from each other', () => {
  const seen = SHAPED.map((s) => [...shapeMask(s, 16, 13, 5)].sort().join('|'));
  assert.equal(new Set(seen).size, SHAPED.length, 'two shapes generated the same mask');
});

test('shape: a narrow valley is skinny, and a choke has a waist', () => {
  // The two claims a player would make looking at them, measured as open rows
  // per column rather than as total area — area cannot tell a valley from a
  // scatter, and it is the profile that makes these ground rather than terrain.
  const [cols, rows] = [21, 16];
  const openPerCol = (mask) => {
    const out = [];
    for (let col = 0; col < cols; col++) {
      let n = 0;
      for (let row = 0; row < rows; row++) {
        const q = col - (row >> 1);
        if (!mask.has(`${q},${row}`)) n++;
      }
      out.push(n);
    }
    return out;
  };

  // Both bounds come off SQUEEZE rather than being written down here, so a
  // future re-tune moves the shapes and the assertions together — a hardcoded
  // "at most 85%" would go red on the next balance pass and teach nobody
  // anything.
  for (const seed of SEEDS) {
    const wide = openPerCol(shapeMask('narrow', cols, rows, seed));
    assert.ok(Math.max(...wide) <= Math.round(rows * SQUEEZE.narrowKeep),
      `narrow seed=${seed} is wider than its own keep: ${Math.max(...wide)}/${rows}`);

    const ch = openPerCol(shapeMask('choke', cols, rows, seed));
    const ends = Math.max(ch[0], ch[cols - 1]);
    assert.ok(Math.min(...ch) <= Math.round(rows * SQUEEZE.chokeNeck) + 1,
      `choke seed=${seed} has no waist: min ${Math.min(...ch)} vs ends ${ends}`);
    assert.ok(Math.min(...ch) < ends, `choke seed=${seed} never narrows at all`);
  }
});

// ---------------------------------------------------------------------------
// Through the real generator
// ---------------------------------------------------------------------------

test('shape: no site is ever placed inside the rock', () => {
  for (const region of REGIONS) {
    for (const seed of [3, 11, 808]) {
      const gen = generateBattleMap(specFor(region), seed);
      const rock = new Set(gen.grid.blocked.map(([q, r]) => `${q},${r}`));
      for (const s of gen.sites) {
        assert.ok(!rock.has(`${s.hex[0]},${s.hex[1]}`),
          `${region.id} (${region.shape}) put ${s.id} inside a mountain`);
      }
    }
  }
});

test('shape: an `open` region generates the map it always did, byte for byte', () => {
  // The property that let eighteen regions be reshaped without re-tuning the
  // other six: with an empty mask the band filter, the river trim and the
  // pre-seeded `blocked` set are all no-ops, so the generator walks the exact
  // path it walked before shapes existed. Verified against HEAD when this
  // shipped — all six `open` regions were identical on four seeds — and pinned
  // here as the intrinsic form of the same claim.
  for (const region of REGIONS.filter((r) => r.shape === 'open')) {
    const withShape = specFor(region);
    const without = { ...withShape, region: { ...region, shape: undefined } };
    for (const seed of [1, 5, 77, 4242]) {
      assert.equal(
        JSON.stringify(generateBattleMap(withShape, seed)),
        JSON.stringify(generateBattleMap(without, seed)),
        `${region.id} is not shape-free at seed ${seed}`,
      );
    }
  }
});

test('shape: every generated map still passes verifyReachable', () => {
  for (const region of REGIONS) {
    for (const seed of [3, 11, 808]) {
      const gen = generateBattleMap(specFor(region), seed);
      assert.ok(verifyReachable(gen.grid, gen.sites),
        `${region.id} (${region.shape}) generated an unreachable site at seed ${seed}`);
    }
  }
});

test('shape: rivers never run under a mountain range', () => {
  // drawBlocked paints rock over water, so a river inside the mask would be a
  // watercourse the renderer silently deletes — a lie about the ground.
  for (const region of REGIONS) {
    const gen = generateBattleMap(specFor(region), 21);
    const rock = new Set(gen.grid.blocked.map(([q, r]) => `${q},${r}`));
    for (const [q, r] of gen.rivers ?? gen.grid.rivers ?? []) {
      assert.ok(!rock.has(`${q},${r}`), `${region.id} ran a river through rock at ${q},${r}`);
    }
  }
});

test('shape: it is spent INSIDE the rock budget, not on top of it', () => {
  // An `open` region must still land on exactly MAPGEN.blockedFrac, and a shaped
  // one must never be that PLUS its mask — otherwise every shaped region quietly
  // became a smaller board with the same site count.
  for (const region of REGIONS) {
    const gen = generateBattleMap(specFor(region), 55);
    const frac = gen.grid.blocked.length / (region.grid.cols * region.grid.rows);
    if (region.shape === 'open') {
      assert.ok(Math.abs(frac - MAPGEN.blockedFrac) < 0.02,
        `${region.id} is open but blocked ${(frac * 100) | 0}%`);
    } else {
      assert.ok(frac >= MAPGEN.blockedFrac - 0.02 && frac <= 0.34,
        `${region.id} (${region.shape}) blocked ${(frac * 100) | 0}%`);
    }
  }
});

test('shape: the table only spends shapes it has, and spells them right', () => {
  for (const region of REGIONS) {
    assert.ok(SHAPES.includes(region.shape),
      `${region.id} asks for shape "${region.shape}", which mapshape.js does not have`);
  }
  // ...and it is actually spent. A `shape` column where every row said `open`
  // would pass every other assertion in this file.
  const shaped = REGIONS.filter((r) => r.shape !== 'open');
  assert.ok(shaped.length >= 12, `only ${shaped.length} of 24 regions are shaped`);
  assert.ok(REGIONS.some((r) => r.shape === 'open'),
    'and the regions whose flavour is "no cover" must stay rectangles');
});
