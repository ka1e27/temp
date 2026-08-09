// THE TERRAIN LAYER: generation, and the v3 seam.
//
// The companion to tests/terrain.test.js, which owns the EFFECTS. This file
// asks whether the maps the generator actually produces are worth having:
// rivers that read as watercourses rather than as puddles, mountain forts and
// river farms common enough to plan around, and a rock budget that adding
// deliberate massifs did not quietly inflate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/core/store.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { generateBattleMap, verifyReachable, inGrid } from '../src/battle/mapgen.js';
import { startBattle } from '../src/battle/sim.js';
import { assertBattleConfig, CONTRACT_VERSION } from '../src/battle/contract.js';
import { carveRivers, groundOf, riverCount } from '../src/battle/terrain.js';
import { siteGoldPerSec } from '../src/battle/economy.js';
import { RIVERS, MAPGEN } from '../src/content/balance.js';
import { neighbors } from '../src/core/hex.js';
import { basicMods, kOf } from './fixtures/terrainGround.js';

const SPEC = {
  cols: 15, rows: 11, enemySites: 9, neutralSites: 4, playerSites: 5, enemyMult: 1, tier: 2,
};
const SEEDS = [1, 7, 99, 4242, 31337, 0];

// ---------------------------------------------------------------------------
// 6. Generation: rivers are watercourses, and they are passable
// ---------------------------------------------------------------------------

test('a river is a connected snaking chain that crosses the map, not scattered puddles', () => {
  for (const seed of SEEDS) {
    const rivers = carveRivers(seed, 15, 11);
    assert.ok(rivers.length >= RIVERS.minLength, `seed ${seed}: barely any water`);
    const set = new Set(rivers.map(kOf));

    // Connected: every hex touches another river hex, so there are no islands.
    for (const [q, r] of rivers) {
      assert.ok(neighbors({ q, r }).some((h) => set.has(`${h.q},${h.r}`)),
        `seed ${seed}: ${q},${r} is a puddle, not a river`);
    }

    // It goes somewhere: a watercourse spans most of an axis of the map.
    const rows = rivers.map(([, r]) => r);
    const cols = rivers.map(([q, r]) => q + (r >> 1));
    const span = Math.max(Math.max(...rows) - Math.min(...rows),
      Math.max(...cols) - Math.min(...cols));
    assert.ok(span >= 8, `seed ${seed}: span of only ${span} is not a watercourse`);

    // It MEANDERS. A straight run — or a clean diagonal — has exactly one hex
    // per step of span and reads as a canal, which is the one thing a river
    // must not look like. Real wandering shows up as extra length and as
    // genuine lateral reach off the river's own axis.
    const lateral = Math.min(Math.max(...rows) - Math.min(...rows),
      Math.max(...cols) - Math.min(...cols));
    assert.ok(rivers.length >= span + 4,
      `seed ${seed}: ${rivers.length} hexes over a span of ${span} is a canal, not a river`);
    assert.ok(lateral >= 2, `seed ${seed}: lateral reach of ${lateral} — it never wanders`);
  }
  assert.ok(riverCount(11, 9) >= RIVERS.minCount);
  assert.ok(riverCount(40, 40) <= RIVERS.maxCount);
});

test('rivers are deterministic in the seed alone and diverge between seeds', () => {
  assert.deepEqual(carveRivers(4242, 15, 11), carveRivers(4242, 15, 11));
  assert.notDeepEqual(carveRivers(4242, 15, 11), carveRivers(4243, 15, 11));
});

test('generated maps keep rivers passable, on the grid, and never under a mountain', () => {
  for (const seed of SEEDS) {
    const { grid, sites } = generateBattleMap(SPEC, seed);
    const blocked = new Set(grid.blocked.map(kOf));
    assert.ok(grid.rivers.length > 0, `seed ${seed}: a map with no water at all`);
    for (const [q, r] of grid.rivers) {
      assert.ok(inGrid(grid, { q, r }), `seed ${seed}: river hex ${q},${r} is off the grid`);
      assert.ok(!blocked.has(`${q},${r}`),
        `seed ${seed}: ${q},${r} is both river and mountain — one of them is a lie`);
    }
    // The reachability invariant mapgen has always guaranteed still holds with
    // the deliberate massifs in play.
    assert.ok(verifyReachable(grid, sites), `seed ${seed}: a site got walled off`);
  }
});

test('the deliberate massifs come out of the SAME rock budget, not on top of it', () => {
  // Otherwise adding "forts in mountains" silently clogs every map: same sites,
  // longer marches, fewer routes. Measured, that cost the harness real minutes.
  let total = 0;
  const N = 40;
  for (let i = 0; i < N; i++) total += generateBattleMap(SPEC, 1000 + i * 7919).grid.blocked.length;
  const budget = SPEC.cols * SPEC.rows * 0.11;
  assert.ok(Math.abs(total / N - budget) < budget * 0.12,
    `blocked averages ${(total / N).toFixed(1)} against a budget of ${budget.toFixed(1)}`);
});

test('the generator actually produces both mountain forts and river farms to find', () => {
  let forts = 0;
  let highForts = 0;
  let farms = 0;
  let riverFarms = 0;
  for (let i = 0; i < 40; i++) {
    const seed = 500 + i * 7919;
    const map = generateBattleMap(SPEC, seed);
    const state = startBattle(assertBattleConfig({
      contractVersion: CONTRACT_VERSION,
      battleId: `gen-${seed}`,
      seed,
      grid: map.grid,
      sites: map.sites,
      adjacency: map.adjacency,
      player: basicMods(),
      enemy: basicMods(),
      rules: { victory: 'capture-castle', hardCapMs: 600000, aiTier: 1 },
    }));
    for (const s of state.sites) {
      const g = groundOf(state, s);
      if (s.kind === 'farm') { farms++; if (g.river) riverFarms++; } else {
        forts++;
        if (g.highland >= 0.75) highForts++;
      }
    }
  }
  // A feature that fires one time in twenty is decoration nobody can plan
  // around; one that fires every time is not terrain, it is a global modifier.
  //
  // The lower bound is deliberately ABOVE the rate a loose scatter produces on
  // its own (27.5% on these seeds): mapgen must be placing ranges around forts
  // on purpose, not hoping the dice do it. Turn MAPGEN.highlandFortShare off
  // and this is the assertion that notices.
  assert.ok(highForts / forts > 0.33 && highForts / forts < 0.75,
    `${((highForts / forts) * 100).toFixed(0)}% of forts are highland`);
  assert.ok(riverFarms / farms > 0.12 && riverFarms / farms < 0.75,
    `${((riverFarms / farms) * 100).toFixed(0)}% of farms are on a river`);
});

// ---------------------------------------------------------------------------
// 7. The seam — v3, through the real production path
// ---------------------------------------------------------------------------

test('terrain crosses the seam intact: what mapgen carved is what the battle is fought on', () => {
  const meta = createState({ seed: 21, now: 0 }).meta;
  const config = buildBattleConfig(meta, 'kaldan', [], generateBattleMap, { seed: 21 });
  assertBattleConfig(config);
  // Terrain itself landed in v3; the pin tracks CONTRACT_VERSION rather than
  // that literal number, so a later bump (the castle gate's v4) does not make
  // this assertion lie about what buildBattleConfig actually stamps on a config.
  assert.equal(config.contractVersion, CONTRACT_VERSION, 'the terrain layer rides the current contract');
  assert.ok(config.grid.rivers.length > 0, 'the production path must record its rivers');

  const battle = startBattle(config);
  assert.deepEqual(
    [...battle.grid.rivers].sort(),
    config.grid.rivers.map(kOf).sort(),
    'a river dropped between config and battle would leave the board drawing a lie',
  );

  // And the effects are live on the real map, not just present as data.
  const wetFarms = battle.sites.filter((s) => s.kind === 'farm' && groundOf(battle, s).river);
  const drySame = battle.sites.filter((s) => s.kind === 'farm' && !groundOf(battle, s).river);
  if (wetFarms.length && drySame.length) {
    const own = (s) => ({ ...s, owner: 'player' });
    assert.ok(siteGoldPerSec(battle, own(wetFarms[0])) > siteGoldPerSec(battle, own(drySame[0])));
  }
});

test('the validator rejects a river that is also a mountain, and tolerates no rivers at all', () => {
  const base = () => {
    const meta = createState({ seed: 4, now: 0 }).meta;
    return buildBattleConfig(meta, 'riverfen', [], generateBattleMap, { seed: 4 });
  };
  const bad = base();
  bad.grid.rivers = [...bad.grid.rivers, bad.grid.blocked[0]];
  assert.throws(() => assertBattleConfig(bad), /must stay passable/);

  const malformed = base();
  malformed.grid.rivers = [[1, 2], ['x', 2]];
  assert.throws(() => assertBattleConfig(malformed), /integer pairs/);

  const dupe = base();
  dupe.grid.rivers = [[1, 2], [1, 2]];
  assert.throws(() => assertBattleConfig(dupe), /duplicate/);

  // A map with no watercourses is a valid map — that is what keeps every
  // hand-built fixture in this suite legal.
  const dry = base();
  delete dry.grid.rivers;
  assert.doesNotThrow(() => assertBattleConfig(dry));
  assert.equal(startBattle(dry).grid.rivers.length, 0);
});
