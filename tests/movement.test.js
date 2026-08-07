import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattleState } from '../src/battle/state.js';
import { recomputeInfluence, speedMultiplierFor } from '../src/battle/influence.js';
import {
  travelTicks, spawnSquad, retreatTarget, reverseSquad, pathBetween, clearPathCache, slowestSpeed,
} from '../src/battle/movement.js';
import { emptyComp, total } from '../src/battle/combat.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { UNITS, MOVEMENT, TERRITORY_SPEED, MAPGEN } from '../src/content/balance.js';
import { TICK_HZ } from '../src/core/loop.js';
import { axialFromOffset } from '../src/battle/mapgen.js';

const comp = (o) => ({ ...emptyComp(), ...o });
let n = 0;

/** A straight three-site road: camp -- f1 -- castle, four hexes apart each. */
function road(over = {}) {
  clearPathCache();
  return createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: `move-${n++}`,
    seed: 5,
    region: { id: 'test', name: 'Test', tier: 1 },
    grid: { cols: 11, rows: 9, blocked: [], ...(over.grid ?? {}) },
    sites: [
      { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 10 }, hp: 600, hpMax: 600 },
      { id: 'f1', kind: 'farm', hex: [4, 0], owner: 'neutral', garrison: { militia: 2 }, hp: 100, hpMax: 100 },
      { id: 'castle', kind: 'castle', hex: [8, 0], owner: 'enemy', garrison: { militia: 8 }, hp: 600, hpMax: 600 },
    ],
    adjacency: [['camp', 'f1'], ['f1', 'castle']],
    player: makeMods(over.player ?? {}),
    enemy: makeMods(over.enemy ?? {}),
    boosters: {},
    rules: { victory: 'capture-castle', hardCapMs: 60000, aiTier: 1 },
  });
}

test('travel time is path length / slowest speed, in whole ticks', () => {
  const s = road();
  s.influence = {}; // neutral ground everywhere: isolate the base formula
  const hexes = pathBetween(s, 'camp', 'f1').length - 1;
  assert.equal(hexes, 4);
  const expect = Math.round((hexes * MOVEMENT.hexSecondsPerSpeed / UNITS.militia.speed) * TICK_HZ);
  assert.equal(travelTicks(s, 'camp', 'f1', comp({ militia: 5 }), 'player'), expect);
  assert.ok(Number.isInteger(expect) && expect >= MOVEMENT.minTicks);
});

test('one ram halves a militia stack — the stack moves at its slowest unit', () => {
  const s = road();
  const fast = travelTicks(s, 'camp', 'f1', comp({ militia: 12 }), 'player');
  const slow = travelTicks(s, 'camp', 'f1', comp({ militia: 12, rams: 1 }), 'player');
  const raid = travelTicks(s, 'camp', 'f1', comp({ raiders: 4 }), 'player');
  assert.ok(slow > fast * 1.5, `a ram must telegraph the push (${fast} -> ${slow})`);
  assert.ok(raid < fast, 'raiders are the fastest thing on the field');
  assert.equal(slowestSpeed(comp({ militia: 12, rams: 1 })), UNITS.rams.speed);
  assert.equal(slowestSpeed(emptyComp()), UNITS.militia.speed);
});

test('territory speeds you up at home and slows you down abroad', () => {
  const s = road();
  recomputeInfluence(s);
  const home = travelTicks(s, 'camp', 'f1', comp({ militia: 5 }), 'player');
  const away = travelTicks(s, 'camp', 'f1', comp({ militia: 5 }), 'enemy');
  assert.ok(home < away, 'the same road is quicker for whoever owns the ground');
  assert.equal(speedMultiplierFor(s, 'player', [0, 0]), TERRITORY_SPEED.friendly);
  assert.equal(speedMultiplierFor(s, 'enemy', [0, 0]), TERRITORY_SPEED.hostile);
  assert.equal(speedMultiplierFor(s, 'player', [4, 0]), TERRITORY_SPEED.neutral);
});

test('marchSpeedMult from the meta layer applies', () => {
  const base = road();
  const quick = road({ player: { marchSpeedMult: 2 } });
  const a = travelTicks(base, 'camp', 'f1', comp({ militia: 5 }), 'player');
  const b = travelTicks(quick, 'camp', 'f1', comp({ militia: 5 }), 'player');
  assert.ok(b < a);
});

test('blocked terrain forces a real detour', () => {
  const wall = [];
  for (let row = 0; row < 7; row++) {
    const h = axialFromOffset(2, row);
    wall.push([h.q, h.r]);
  }
  const open = road();
  const walled = road({ grid: { cols: 11, rows: 9, blocked: wall } });
  const direct = pathBetween(open, 'camp', 'f1').length;
  const around = pathBetween(walled, 'camp', 'f1');
  assert.ok(around, 'a chokepoint must not seal the map');
  assert.ok(around.length > direct, 'the detour costs real ground');
  assert.ok(travelTicks(walled, 'camp', 'f1', comp({ militia: 5 }), 'player')
    > travelTicks(open, 'camp', 'f1', comp({ militia: 5 }), 'player'));
});

test('paths are cached per battle and per site pair', () => {
  const s = road();
  const first = pathBetween(s, 'camp', 'castle');
  assert.equal(pathBetween(s, 'camp', 'castle'), first, 'same array, no recompute');
  clearPathCache();
  assert.notEqual(pathBetween(s, 'camp', 'castle'), first);
  assert.deepEqual(pathBetween(s, 'camp', 'castle'), first, '...but the same route');
});

test('a squad computes arriveTick once and never integrates position', () => {
  const s = road();
  s.tick = 40;
  const sq = spawnSquad(s, { owner: 'player', from: 'camp', to: 'f1', comp: comp({ militia: 4 }) });
  assert.equal(s.squads.length, 1);
  assert.equal(sq.spawnTick, 40);
  assert.ok(sq.arriveTick > 40);
  assert.equal(sq.retreating, false);
  assert.equal(total(sq.comp), 4);
  const frozen = sq.arriveTick;
  s.tick = 60;
  assert.equal(s.squads[0].arriveTick, frozen, 'nothing recomputes mid-flight');
  assert.ok(!('x' in sq) && !('hex' in sq), 'squads carry no position');
});

test('a requested arriveTick can hold a wave back but never speed it up', () => {
  const s = road();
  const natural = s.tick + travelTicks(s, 'camp', 'f1', comp({ militia: 4 }), 'player');
  const late = spawnSquad(s, {
    owner: 'player', from: 'camp', to: 'f1', comp: comp({ militia: 4 }), arriveTick: natural + 25,
  });
  const cheat = spawnSquad(s, {
    owner: 'player', from: 'camp', to: 'f1', comp: comp({ militia: 4 }), arriveTick: 1,
  });
  assert.equal(late.arriveTick, natural + 25);
  assert.equal(cheat.arriveTick, natural, 'a synchronized wave cannot outrun its own legs');
});

test('retreatTarget walks the site graph to the nearest friendly site', () => {
  const s = road();
  assert.equal(retreatTarget(s, 'f1', 'player').id, 'camp');
  assert.equal(retreatTarget(s, 'f1', 'enemy').id, 'castle');
  assert.equal(retreatTarget(s, 'camp', 'player'), null, 'nowhere else to go');
});

test('reversing a squad conserves every unit and costs only the time flown', () => {
  const s = road();
  recomputeInfluence(s);
  const sq = spawnSquad(s, {
    owner: 'player', from: 'camp', to: 'f1', comp: comp({ militia: 6, raiders: 2 }),
  });
  const trip = sq.arriveTick - sq.spawnTick;
  s.tick = sq.spawnTick + Math.floor(trip / 2);
  const before = { ...sq.comp };

  assert.ok(reverseSquad(s, sq));
  assert.equal(sq.retreating, true);
  assert.equal(sq.to, 'camp');
  assert.deepEqual(sq.comp, before, 'a retreat never loses a man');
  assert.equal(sq.arriveTick - s.tick, Math.floor(trip / 2), 'the way back is the way flown');
  assert.equal(sq.arriveTick - sq.spawnTick, trip, 'interpolation stays continuous');
});

test('a squad whose home fell retreats to the next friendly site', () => {
  const s = road();
  const sq = spawnSquad(s, { owner: 'enemy', from: 'castle', to: 'f1', comp: comp({ militia: 5 }) });
  s.tick = sq.spawnTick + 2;
  const home = s.sites.find((x) => x.id === 'castle');
  home.owner = 'player';           // the castle flipped while they were in the air
  s.sites.find((x) => x.id === 'f1').owner = 'enemy';
  assert.equal(reverseSquad(s, sq), true);
  assert.equal(sq.to, 'f1');
  assert.equal(total(sq.comp), 5);
});

test('a retreat with no friendly ground left fails cleanly', () => {
  const s = road();
  const sq = spawnSquad(s, { owner: 'enemy', from: 'castle', to: 'f1', comp: comp({ militia: 5 }) });
  for (const site of s.sites) site.owner = 'player';
  assert.equal(reverseSquad(s, sq), false);
  assert.equal(total(sq.comp), 5, 'a failed retreat still loses nobody');
});

test('generated maps and the movement module agree on the grid', () => {
  assert.ok(MAPGEN.siteClearance >= 1, 'sites are never walled in at generation');
});
