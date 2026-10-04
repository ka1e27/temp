// Front lines (DESIGN §4.4) and supply lines (DESIGN §4.3): who owns the land tile by tile, which sends are legal,
// routes fixed at send time, and standing auto-send orders. Hand-built line arenas keep every fight exact.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, step, issue, previewSend, canRoute, routeFor, tileOwner, computeTerritory } from '../battle/sim.js';
import { buildArena } from '../battle/arena.js';
import { think } from '../battle/ai.js';
import { legalRouteFor } from '../battle/routing.js';
import { tileCell } from '../battle/territory.js';
import { hexDistance } from '../battle/geom.js';
import { generateWorld } from '../world/generate.js';
import { createGame, PLAYER_FACTION } from '../meta/state.js';
import { frontier, playerBattleStats, enemyBattleStats } from '../meta/progression.js';
import { SUPPLY, BATTLE } from '../config/battle.js';
import { buildTestWorld, TARGET_REGION, DEFAULT_OWNERS } from './fixtures/battle-world.js';

const PLAYER = Object.freeze({
  atk: 1, def: 1, growth: 0, speed: 1, campTroops: 30, garrisonShare: 0.35, capBonus: 0,
  cooldownMult: 1, powers: { rally: 1, firestorm: 1, bulwark: 1, march: 1, levy: 1 },
});
const ENEMY = Object.freeze({
  atk: 1, def: 1, growth: 0, speed: 1, troopMult: 1, thinkSec: 2, personality: 'aggressive', factionId: 2,
});
const SQ3 = Math.sqrt(3);

/**
 * A straight line of tiles q = 0..length-1 (hex distance = index distance). Tiles below `haloTiles` are the player's
 * halo (another region, stamped `own: 0`); the rest is the target region (region 0).
 * `sites`: [tile, type, owner, troops] in id order. Site 0 is normally the player's camp.
 */
function lineArena({ length = 10, haloTiles = 2, sites, enemyFaction = 2, links = [] }) {
  const tiles = [];
  for (let q = 0; q < length; q++) {
    const tile = { i: q, q, r: 0, x: q * SQ3, y: 0, cost: 1, terrain: 'grass', region: q < haloTiles ? 1 : 0 };
    if (q < haloTiles) tile.own = 0;
    if (links.includes(q)) tile.link = true;
    tiles.push(tile);
  }
  return {
    regionId: 0,
    enemyFaction,
    tiles,
    sites: sites.map(([tile, type, owner, troops], id) => ({ id, settlement: id - 1, tile, type, owner, troops })),
    focus: { minX: 0, maxX: (length - 1) * SQ3, minY: 0, maxY: 0 },
  };
}

/** camp(tile 0) - A village (4) - B village (7) - keep (9). Cells: A = tiles 2..5, B = 6..8, keep = 9. */
function chain(extra = {}) {
  return lineArena({
    sites: [[0, 'camp', 0, 40], [4, 'village', 2, 5], [7, 'village', 2, 5], [9, 'keep', 2, 50]],
    ...extra,
  });
}

function makeBattle(arena, player = PLAYER, enemy = ENEMY) {
  return createBattle(arena, player, enemy);
}

function run(battle, seconds, dt = 0.05) {
  const end = battle.t + seconds;
  while (!battle.result && battle.t < end - 1e-9) step(battle, dt);
}

// --- territory ---------------------------------------------------------------------------------------------------

test('territory: target tiles follow their nearest settlement live, other tiles keep the stamped owner', () => {
  const battle = makeBattle(chain());
  assert.deepEqual([0, 1].map((i) => tileOwner(battle, i)), [0, 0], 'the halo is the player\'s');
  assert.deepEqual([2, 3, 4, 5, 6, 7, 8, 9].map((i) => tileOwner(battle, i)), [2, 2, 2, 2, 2, 2, 2, 2]);
  battle.sites[1].owner = 0; // the player takes village A
  assert.deepEqual([2, 3, 4, 5].map((i) => tileOwner(battle, i)), [0, 0, 0, 0], 'A\'s land recolours with it');
  assert.deepEqual([6, 7, 8, 9].map((i) => tileOwner(battle, i)), [2, 2, 2, 2]);
  const terr = computeTerritory(battle);
  assert.equal(terr.owners.get(3), 0);
  assert.equal(tileOwner(battle, 99), -1, 'an unknown tile belongs to no one');
});

test('territory: ties go to the lower site id, and an arena with no stamps treats outside land as the player\'s', () => {
  const arena = chain();
  for (const t of arena.tiles) delete t.own; // an old arena
  const battle = makeBattle(arena);
  assert.equal(tileOwner(battle, 0), 0);
  assert.equal(tileOwner(battle, 1), 0);
  // tile 8 is one hex from B (7) and from the keep (9): B has the lower id
  battle.sites[2].owner = 0;
  assert.equal(tileOwner(battle, 8), 0);
});

test('territory survives a JSON round trip and follows owners changed behind its back', () => {
  const battle = makeBattle(chain());
  assert.equal(tileOwner(battle, 3), 2);
  const copy = JSON.parse(JSON.stringify(battle));
  copy.sites[1].owner = 0;
  assert.equal(tileOwner(copy, 3), 0);
  assert.equal(tileOwner(battle, 3), 2, 'the original is untouched');
});

// --- routes ------------------------------------------------------------------------------------------------------

test('routes: you can attack only where your land touches land you can cross', () => {
  const battle = makeBattle(chain());
  assert.equal(canRoute(battle, 0, 0, 1), true, 'the camp reaches village A');
  assert.equal(canRoute(battle, 0, 0, 2), false, 'B is behind A\'s land');
  assert.equal(canRoute(battle, 0, 0, 3), false, 'so is the keep');
  assert.equal(routeFor(battle, 0, 0, 2), null);
  battle.sites[1].owner = 0;
  assert.equal(canRoute(battle, 0, 0, 2), true, 'taking A opens the road to B');
  assert.equal(canRoute(battle, 0, 0, 3), false, 'the keep still needs B');
  battle.sites[2].owner = 0;
  assert.equal(canRoute(battle, 0, 0, 3), true);
});

test('routes: shape of routeFor (tiles exclude the start tile, points include it, all in world units)', () => {
  const battle = makeBattle(chain());
  const route = routeFor(battle, 0, 0, 1);
  assert.deepEqual([...route.tiles], [1, 2, 3, 4]);
  assert.equal(route.points.length, route.tiles.length + 1);
  assert.deepEqual({ ...route.points[0] }, { x: 0, y: 0 });
  assert.ok(Math.abs(route.points[4].x - 4 * SQ3) < 1e-9);
  assert.equal(route.cost, 4);
  assert.equal(routeFor(battle, 0, 0, 0), null, 'a settlement has no route to itself');
  assert.equal(routeFor(battle, 0, 0, 77), null);
  assert.strictEqual(routeFor(battle, 0, 0, 1), route, 'cached while the front does not move');
  battle.sites[1].owner = 0;
  assert.notStrictEqual(routeFor(battle, 0, 0, 1), route, 'a capture drops the cache');
});

test('routes: the enemy is bound by the same rule', () => {
  const battle = makeBattle(chain());
  assert.equal(canRoute(battle, 2, 3, 0), true, 'the keep reaches the camp over its own land');
  assert.equal(canRoute(battle, 2, 1, 0), true);
  battle.sites[1].owner = 0; // the player holds A now
  assert.equal(canRoute(battle, 2, 2, 0), false, 'B can no longer reach the camp through A\'s land');
  assert.equal(canRoute(battle, 2, 2, 1), true, 'but it can attack A itself, across A\'s own land');
  assert.equal(canRoute(battle, 2, 3, 1), true);
});

test('routes: neutral land (Free Folk hamlets in a rival region) is crossable by both sides', () => {
  const arena = lineArena({
    sites: [[0, 'camp', 0, 40], [4, 'hamlet', 1, 5], [8, 'keep', 2, 50]],
  });
  const battle = makeBattle(arena);
  // cells: hamlet = tiles 2..6 (tile 6: 2 from the hamlet, 2 from the keep, tie to the lower id), keep = 7..9
  assert.equal(tileOwner(battle, 4), 1);
  assert.equal(canRoute(battle, 0, 0, 2), true, 'the player walks across the hamlet\'s land to the keep');
  assert.equal(canRoute(battle, 2, 2, 0), true, 'and the rival walks back');
  battle.sites[1].owner = 2; // the rival takes the hamlet: its land is now the rival's, still open to the rival
  assert.equal(canRoute(battle, 0, 0, 2), false, 'but now the player must take the hamlet first');
  assert.equal(canRoute(battle, 0, 0, 1), true);
});

test('routes: connector (link) tiles are open to everyone', () => {
  const arena = chain({ links: [3] });
  const battle = makeBattle(arena);
  // tile 3 is A's land but a connector: it would not change this route (A's own land is open to the camp anyway)...
  assert.equal(canRoute(battle, 0, 0, 2), false);
  // ...yet a connector that sits in the middle of the enemy's land keeps the two sides joined
  const open = makeBattle(lineArena({
    sites: [[0, 'camp', 0, 40], [4, 'village', 2, 5], [7, 'village', 2, 5], [9, 'keep', 2, 50]],
    links: [2, 3, 4, 5, 6, 7, 8],
  }));
  assert.equal(canRoute(open, 0, 0, 3), true);
});

test('routes: a player with no legal attack at all is never stranded (plain cheapest path), the enemy keeps its rule', () => {
  // The strip of land in front of the camp is stamped as the enemy's and is nobody's target cell: under the rule the
  // camp cannot take a single step, so there is no legal attack anywhere. The safety net then lets the player march.
  const arena = lineArena({ length: 9, sites: [[0, 'camp', 0, 40], [4, 'village', 2, 5], [7, 'keep', 2, 50]] });
  arena.tiles[1].own = 2;
  const battle = makeBattle(arena);
  assert.equal(canRoute(battle, 0, 0, 1), true);
  assert.deepEqual([...routeFor(battle, 0, 0, 1).tiles], [1, 2, 3, 4]);
  assert.equal(canRoute(battle, 0, 0, 2), true, 'every target is open while the player is walled in');
  // The moment a legal route exists again the rule is back: here the player already holds village A's land, but the
  // keep's land is still not crossable from the camp, only from A.
  const fine = makeBattle(chain());
  assert.equal(canRoute(fine, 0, 0, 2), false, 'no fallback while a legal attack exists');
  // The enemy is never relaxed: with the player's land in between and another player settlement as the goal's cell,
  // its route is simply closed.
  const arena2 = lineArena({ length: 8, sites: [[0, 'camp', 0, 40], [4, 'village', 2, 5], [1, 'village', 0, 10]] });
  const b2 = makeBattle(arena2);
  assert.equal(canRoute(b2, 2, 1, 0), false, 'the enemy cannot reach the camp across the halo village land');
  assert.equal(canRoute(b2, 2, 1, 2), true, 'but it can attack the halo village itself');
});

// --- sends -------------------------------------------------------------------------------------------------------

test('send: sources without a route are dropped; with none left the send is refused', () => {
  const arena = lineArena({
    sites: [[0, 'camp', 0, 40], [4, 'village', 2, 5], [7, 'village', 2, 5], [3, 'village', 0, 30]],
  });
  // site 3 (the player's own village on tile 3) sits in tile 3's land, next to A's; cells are recomputed from sites
  const battle = makeBattle(arena);
  assert.equal(canRoute(battle, 0, 0, 2), false);
  issue(battle, { type: 'send', owner: 0, from: [0], to: 2, fraction: 0.5 });
  step(battle, 0.05);
  assert.equal(battle.squads.length, 0, 'nothing was sent');
  assert.equal(battle.sites[0].troops, 40, 'and no troops left the camp');
  const refused = battle.events.filter((e) => e.type === 'refused');
  assert.deepEqual(refused, [{ type: 'refused', reason: 'noRoute', owner: 0, to: 2 }]);
  assert.equal(battle.events.filter((e) => e.type === 'send').length, 0);
});

test('send: a multi-source send goes out from the sources that can route and skips the rest', () => {
  const battle = makeBattle(lineArena({
    sites: [[0, 'camp', 0, 40], [4, 'village', 2, 5], [7, 'village', 2, 5], [3, 'village', 0, 30], [9, 'keep', 2, 50]],
  }));
  // Player village (site 3, tile 3) owns tiles 2..3 (its cell), so from it A (tile 4) is adjacent land.
  // Cells over the target region tiles 2..9 with sites at 3(P), 4(A), 7(B), 9(K): 2,3 -> P; 4,5 -> A (5: A1, B2); 6,7,8 -> B; 9 -> K
  assert.equal(canRoute(battle, 0, 3, 2), false, 'B is behind A for everyone');
  assert.equal(canRoute(battle, 0, 0, 1), true);
  assert.equal(canRoute(battle, 0, 3, 1), true);
  issue(battle, { type: 'send', owner: 0, from: [0, 3], to: 1, fraction: 0.5 });
  step(battle, 0.05);
  assert.equal(battle.events.filter((e) => e.type === 'send').length, 2);
  issue(battle, { type: 'send', owner: 0, from: [0, 3], to: 2, fraction: 0.5 });
  step(battle, 0.05);
  assert.equal(battle.events.filter((e) => e.type === 'send').length, 0);
  assert.equal(battle.events.filter((e) => e.type === 'refused').length, 1);
});

test('send: the route is fixed when the squad sets out, however the front moves', () => {
  const battle = makeBattle(chain());
  issue(battle, { type: 'send', owner: 0, from: [0], to: 1, fraction: 0.5 });
  step(battle, 0.05);
  const squad = battle.squads[0];
  const path = [...squad.path];
  assert.deepEqual(path, [1, 2, 3, 4]);
  battle.sites[1].owner = 0; // the front moves under the marching squad
  battle.sites[3].owner = 0;
  run(battle, 1);
  assert.deepEqual(squad.path, path, 'never rerouted');
});

test('send: a squad march needs only the route it was given (enemy attack on the camp over its own land)', () => {
  const battle = makeBattle(chain());
  issue(battle, { type: 'send', owner: 2, from: [1], to: 0, fraction: 1 });
  step(battle, 0.05);
  assert.equal(battle.squads.length, 1);
  assert.equal(battle.squads[0].owner, 2);
  assert.deepEqual(battle.squads[0].path, [3, 2, 1, 0]);
});

test('previewSend: routable and unroutable sources, and the noRoute outcome', () => {
  const battle = makeBattle(chain());
  const far = previewSend(battle, [0], 2, 0.5);
  assert.equal(far.outcome, 'noRoute');
  assert.equal(far.routable, false);
  assert.deepEqual(far.unroutable, [0]);
  assert.equal(far.sending, 0);
  const near = previewSend(battle, [0], 1, 0.5);
  assert.equal(near.routable, true);
  assert.deepEqual(near.unroutable, []);
  assert.equal(near.outcome, 'capture');
  assert.ok(near.arriveSec > 0);
  // A mixed send: the player's own village in front can route, the camp (behind it) cannot reach B but can reach A
  const mixed = makeBattle(lineArena({
    sites: [[0, 'camp', 0, 40], [4, 'village', 2, 5], [7, 'village', 2, 5], [3, 'village', 0, 30]],
  }));
  const mix = previewSend(mixed, [0, 3], 2, 0.5);
  assert.equal(mix.routable, false);
  assert.deepEqual(mix.unroutable, [0, 3]);
  const both = previewSend(mixed, [0, 3], 1, 0.5);
  assert.equal(both.routable, true);
  assert.deepEqual(both.unroutable, []);
  assert.equal(both.sending, 20 + 15);
});

test('rally: only settlements with a route send; with none able to, it is refused and costs nothing', () => {
  const battle = makeBattle(lineArena({
    sites: [[0, 'camp', 0, 40], [4, 'village', 2, 5], [7, 'village', 2, 5], [3, 'village', 0, 30], [9, 'keep', 2, 50]],
  }));
  issue(battle, { type: 'power', owner: 0, power: 'rally', target: 2 });
  step(battle, 0.05);
  assert.equal(battle.events.filter((e) => e.type === 'send').length, 0);
  assert.equal(battle.cooldowns.rally, 0, 'a refused rally is free');
  assert.equal(battle.events.filter((e) => e.type === 'refused').length, 1);
  issue(battle, { type: 'power', owner: 0, power: 'rally', target: 1 });
  step(battle, 0.05);
  assert.equal(battle.events.filter((e) => e.type === 'send').length, 2);
  assert.ok(battle.cooldowns.rally > 0);
});

// --- supply lines ------------------------------------------------------------------------------------------------

/** camp(0) -> P (id 1, a village the player already holds on tile 5), enemy keep behind it. No growth anywhere. */
function supplyArena(campTroops = 40) {
  return lineArena({ sites: [[0, 'camp', 0, campTroops], [5, 'village', 0, 0], [9, 'keep', 2, 50]] });
}

test('supply: a line sends half the source every interval while it holds enough, with auto: true', () => {
  const battle = makeBattle(supplyArena(40));
  assert.deepEqual(battle.supply, []);
  issue(battle, { type: 'supply', owner: 0, from: 0, to: 1 });
  const sends = [];
  for (let i = 0; i < 1000 && battle.t < 12.5; i++) {
    step(battle, 0.05);
    for (const e of battle.events) if (e.type === 'send') sends.push({ at: Number(battle.t.toFixed(2)), count: e.count, auto: e.auto });
  }
  // 40 -> send 20 (t 0.05), 20 -> 10 (t 3), 10 -> 5 (t 6), then 5 < minTroops: nothing more
  assert.deepEqual(sends.map((s) => s.count), [20, 10, 5]);
  assert.ok(sends.every((s) => s.auto === true));
  assert.ok(sends[0].at <= 0.1 && Math.abs(sends[1].at - SUPPLY.intervalSec) <= 0.1 && Math.abs(sends[2].at - 2 * SUPPLY.intervalSec) <= 0.1, JSON.stringify(sends));
  assert.equal(battle.supply.length, 1, 'the line stands, waiting for the source to refill');
  assert.equal(battle.sites[0].troops, 5);
});

test('supply: a source below minTroops waits, and resumes when it has enough', () => {
  const battle = makeBattle(supplyArena(9));
  issue(battle, { type: 'supply', owner: 0, from: 0, to: 1 });
  run(battle, 4);
  assert.equal(battle.squads.length, 0);
  battle.sites[0].troops = SUPPLY.minTroops;
  run(battle, SUPPLY.intervalSec + 0.2);
  assert.equal(battle.squads.length, 1);
  assert.equal(battle.squads[0].count, Math.floor(SUPPLY.minTroops * SUPPLY.fraction));
});

test('supply: one line per source, a new one replaces it, repeating the same order changes nothing, unsupply removes', () => {
  const battle = makeBattle(lineArena({
    sites: [[0, 'camp', 0, 40], [5, 'village', 0, 0], [9, 'keep', 2, 50], [3, 'village', 0, 0]],
  }));
  issue(battle, { type: 'supply', owner: 0, from: 0, to: 1 });
  step(battle, 0.05);
  assert.deepEqual(battle.supply.map((l) => [l.from, l.to]), [[0, 1]]);
  const first = battle.supply[0];
  const nextAt = first.nextAt;
  issue(battle, { type: 'supply', owner: 0, from: 0, to: 1 });
  step(battle, 0.05);
  assert.equal(battle.supply[0].nextAt, nextAt, 'the same order leaves the cadence alone');
  issue(battle, { type: 'supply', owner: 0, from: 0, to: 3 });
  step(battle, 0.05);
  assert.deepEqual(battle.supply.map((l) => [l.from, l.to]), [[0, 3]], 'replaced');
  issue(battle, { type: 'supply', owner: 0, from: 1, to: 3 });
  step(battle, 0.05);
  assert.equal(battle.supply.length, 2);
  issue(battle, { type: 'unsupply', owner: 0, from: 0 });
  step(battle, 0.05);
  assert.deepEqual(battle.supply.map((l) => l.from), [1]);
  assert.ok(battle.events.some((e) => e.type === 'unsupply' && e.from === 0 && e.reason === 'removed'));
  issue(battle, { type: 'unsupply', owner: 0, from: 9 });
  step(battle, 0.05);
  assert.equal(battle.supply.length, 1, 'removing a line that does not exist is a no-op');
});

test('supply: several sources at once (from is a list), and only the owner\'s own sites count', () => {
  const battle = makeBattle(lineArena({
    sites: [[0, 'camp', 0, 40], [5, 'village', 0, 0], [9, 'keep', 2, 50], [3, 'village', 0, 20]],
  }));
  issue(battle, { type: 'supply', owner: 0, from: [0, 3, 2], to: 1 }); // site 2 is the enemy's: ignored
  step(battle, 0.05);
  assert.deepEqual(battle.supply.map((l) => l.from), [0, 3]);
  issue(battle, { type: 'supply', owner: 2, from: [1], to: 2 }); // not the owner's site
  step(battle, 0.05);
  assert.deepEqual(battle.supply.map((l) => l.from), [0, 3]);
});

test('supply: no line is made toward a target with no route; the order is refused', () => {
  const battle = makeBattle(chain());
  issue(battle, { type: 'supply', owner: 0, from: 0, to: 2 }); // B, behind A's land
  step(battle, 0.05);
  assert.equal(battle.supply.length, 0);
  assert.deepEqual(battle.events.filter((e) => e.type === 'refused'), [{ type: 'refused', reason: 'noRoute', owner: 0, to: 2 }]);
});

test('supply: a line ends when its source is lost, and survives its target being captured', () => {
  const battle = makeBattle(lineArena({
    sites: [[0, 'camp', 0, 60], [4, 'village', 2, 3], [9, 'keep', 2, 50], [3, 'village', 0, 12]],
  }));
  issue(battle, { type: 'supply', owner: 0, from: 0, to: 1 });
  issue(battle, { type: 'supply', owner: 0, from: 3, to: 2 }); // not routable (keep is far): refused, no line
  run(battle, 8);
  assert.equal(battle.sites[1].owner, 0, 'the enemy village fell to the supplied squads');
  assert.equal(battle.supply.length, 1);
  assert.equal(battle.supply[0].to, 1, 'the line now reinforces the captured village');
  // the source falls
  battle.sites[0].owner = 2;
  step(battle, 0.05);
  assert.equal(battle.supply.length, 0);
  assert.ok(battle.events.some((e) => e.type === 'unsupply' && e.from === 0 && e.reason === 'lost'));
});

test('supply: a line waits while its route is closed by a recapture, then resumes when it reopens', () => {
  const battle = makeBattle(chain());
  battle.sites[1].owner = 0; // the player holds A, so camp -> B is legal
  issue(battle, { type: 'supply', owner: 0, from: 0, to: 2 });
  let sends = 0;
  const go = (seconds) => {
    const end = battle.t + seconds;
    while (battle.t < end - 1e-9) {
      step(battle, 0.05);
      sends += battle.events.filter((e) => e.type === 'send').length;
    }
  };
  go(0.1);
  assert.equal(sends, 1, 'the first send goes out at once');
  battle.sites[1].owner = 2; // A is retaken: the road to B closes
  go(2 * SUPPLY.intervalSec);
  assert.equal(sends, 1, 'nothing new is sent while there is no route');
  assert.equal(battle.supply.length, 1, 'the line stands');
  battle.sites[1].owner = 0; // reopened
  go(SUPPLY.intervalSec + 0.2);
  assert.equal(sends, 2, 'and it resumes');
});

test('supply: old saves without `supply` start with no lines; lines are plain JSON and replay identically', () => {
  const battle = makeBattle(supplyArena(40));
  delete battle.supply;
  issue(battle, { type: 'supply', owner: 0, from: 0, to: 1 });
  step(battle, 0.05);
  assert.equal(battle.supply.length, 1);
  const old = makeBattle(supplyArena(40));
  delete old.supply;
  step(old, 0.05);
  assert.deepEqual(old.supply, []);

  const a = makeBattle(supplyArena(60));
  issue(a, { type: 'supply', owner: 0, from: 0, to: 1 });
  run(a, 5);
  const b = JSON.parse(JSON.stringify(a));
  run(a, 12);
  run(b, 12);
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'a saved battle resumes identically');

  const c = makeBattle(supplyArena(60));
  issue(c, { type: 'supply', owner: 0, from: 0, to: 1 });
  run(c, 17);
  assert.equal(JSON.stringify(c), JSON.stringify(a), 'deterministic');
});

// --- AI and the real arenas --------------------------------------------------------------------------------------

test('the AI never orders a send it has no route for, and never stalls for lack of one', () => {
  const battle = makeBattle(chain(), { ...PLAYER, growth: 1 }, { ...ENEMY, growth: 1, graceSec: 0 });
  let sends = 0;
  for (let i = 0; i < 4000 && !battle.result; i++) {
    for (const cmd of think(battle, battle.t)) {
      if (cmd.type !== 'send') continue;
      sends += 1;
      for (const from of cmd.from) assert.equal(canRoute(battle, cmd.owner, from, cmd.to), true, `send ${from} -> ${cmd.to} at t=${battle.t.toFixed(1)}`);
      issue(battle, cmd);
    }
    step(battle, 0.05);
    assert.equal(battle.events.filter((e) => e.type === 'refused').length, 0, 'the AI was refused');
  }
  assert.ok(sends > 0, 'the AI still attacks under the rule');
});

test('real arena: every site is routable from the camp after taking the nearer ones, and think stays cheap', () => {
  const world = buildTestWorld();
  const arena = buildArena(world, DEFAULT_OWNERS, TARGET_REGION, PLAYER, ENEMY);
  const battle = createBattle(arena, { ...PLAYER, growth: 1 }, { ...ENEMY, growth: 1 });
  assert.ok(arena.tiles.some((t) => t.own === 0), 'halo tiles are stamped with their owner');
  assert.ok(arena.tiles.every((t) => t.region === arena.regionId || t.own !== undefined), 'every non-target tile is stamped');
  const enemySites = battle.sites.filter((s) => s.owner !== 0);
  const legal = enemySites.filter((s) => canRoute(battle, 0, 0, s.id));
  assert.ok(legal.length >= 1, 'the player can attack something from the start');
  // capture everything in id order, always legal or rescued by the safety net
  for (const site of enemySites) {
    assert.equal(canRoute(battle, 0, 0, site.id) || battle.sites.some((s) => s.owner === 0 && canRoute(battle, 0, s.id, site.id)), true);
    site.owner = 0;
  }
  const again = createBattle(arena, { ...PLAYER, growth: 1 }, { ...ENEMY, growth: 1 });
  let worst = 0;
  let total = 0;
  let n = 0;
  for (let i = 0; i < 600; i++) {
    const t0 = performance.now();
    const cmds = think(again, again.t);
    const dt = performance.now() - t0;
    worst = Math.max(worst, dt);
    total += dt;
    n += 1;
    for (const c of cmds) issue(again, c);
    step(again, 0.05);
  }
  assert.ok(total / n < 2, `think averaged ${(total / n).toFixed(3)} ms`);
  assert.ok(worst < 50, `think worst ${worst.toFixed(2)} ms`);
});

/** A mid-campaign footprint: the player holds the ground behind the target (a chain of lower-tier regions). */
function stateAtLevel(world, seed, region) {
  const state = createGame(seed, world, 0);
  let cur = region;
  while (cur.tier > 0) {
    const parent = cur.neighbors.map((n) => world.regions[n]).filter((n) => n.tier === cur.tier - 1).sort((a, b) => a.id - b.id)[0];
    if (!parent) break;
    state.owner[parent.id] = PLAYER_FACTION;
    cur = parent;
  }
  return state;
}

// --- the arena opens on soft targets -----------------------------------------------------------------------------

test('arenas: the War Camp can attack something other than the keep at the start, with short border marches (seeds 1-6, every frontier region)', () => {
  let checked = 0;
  let corridors = 0;
  let met = 0;
  let keepFirst = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const world = generateWorld(seed);
    const state = createGame(seed, world, 0);
    const player = playerBattleStats(state, world);
    for (const id of frontier(state, world)) {
      const enemy = enemyBattleStats(world, state, id);
      let arena;
      try { arena = buildArena(world, state.owner, id, player, enemy); } catch { continue; }
      const battle = createBattle(arena, player, enemy);
      const soft = battle.sites.filter((s) => s.owner !== 0 && s.type !== 'keep');
      const open = soft.filter((s) => legalRouteFor(battle, 0, 0, s.id));
      const want = Math.min(soft.length, world.regions[id].tier === 1 ? BATTLE.openingTargetsFirstRing : BATTLE.openingTargets);
      if (open.length >= want) met += 1;
      if (soft.length > 0 && open.length === 0) keepFirst += 1;
      // no march is longer than the cap, each is recorded, and every tile of it is no-man's-land
      for (const march of arena.marches) {
        assert.ok(march.tiles.length >= 1 && march.tiles.length <= BATTLE.corridorMaxTiles, `seed ${seed} ${world.regions[id].name}: a border march of ${march.tiles.length} tiles`);
        for (const i of march.tiles) {
          assert.equal(arena.tiles.find((t) => t.i === i).link, true);
          assert.equal(tileOwner(battle, i), -1);
        }
      }
      corridors += arena.marches.length;
      checked += 1;
    }
  }
  assert.ok(checked >= 15, `only ${checked} arenas checked`);
  assert.ok(corridors >= 1, 'at least one arena needed a border march, or this test checks nothing');
  assert.ok(met >= 0.85 * checked, `the opening guarantee held in ${met} of ${checked} arenas`);
  assert.ok(keepFirst <= 0.06 * checked, `${keepFirst} of ${checked} arenas open on the keep alone`);
});

test('arenas: almost every settlement but the keep can be taken before the keep (capture closure, seeds 1-6, every region)', () => {
  let checked = 0;
  let shielded = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const world = generateWorld(seed);
    for (const region of world.regions.filter((r) => r.tier > 0)) {
      const state = stateAtLevel(world, seed, region);
      const player = playerBattleStats(state, world, region.id);
      const enemy = enemyBattleStats(world, state, region.id);
      let arena;
      try { arena = buildArena(world, state.owner, region.id, player, enemy); } catch { continue; }
      const battle = createBattle(arena, player, enemy);
      const soft = battle.sites.filter((s) => s.owner !== 0 && s.type !== 'keep');
      for (let progress = true; progress;) {
        progress = false;
        for (const s of soft) {
          if (s.owner === 0) continue;
          if (battle.sites.some((m) => m.owner === 0 && m.tile !== s.tile && legalRouteFor(battle, 0, m.id, s.id))) { s.owner = 0; progress = true; }
        }
      }
      if (soft.some((s) => s.owner !== 0)) shielded += 1; // a wall no 3-tile march can open
      checked += 1;
    }
  }
  assert.ok(checked >= 60, `only ${checked} arenas checked`);
  assert.ok(shielded <= 0.12 * checked, `${shielded} of ${checked} arenas keep a settlement walled in behind the keep`);
});

test('arenas: no border march is longer than the cap, and a march rarely hugs the keep (seeds 1-6, every region, tier-appropriate armies)', () => {
  let arenas = 0;
  let marches = 0;
  let longest = 0;
  let hugging = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const world = generateWorld(seed);
    for (const region of world.regions.filter((r) => r.tier > 0)) {
      const state = stateAtLevel(world, seed, region);
      const player = playerBattleStats(state, world, region.id);
      const enemy = enemyBattleStats(world, state, region.id);
      let arena;
      try { arena = buildArena(world, state.owner, region.id, player, enemy); } catch { continue; }
      arenas += 1;
      const keeps = arena.sites.filter((x) => x.type === 'keep' && x.owner !== 0).map((x) => arena.tiles.find((t) => t.i === x.tile));
      for (const march of arena.marches) {
        marches += 1;
        longest = Math.max(longest, march.tiles.length);
        assert.ok(march.tiles.length <= BATTLE.corridorMaxTiles, `seed ${seed} ${region.name}: a border march of ${march.tiles.length} tiles (cap ${BATTLE.corridorMaxTiles})`);
        const tiles = march.tiles.map((i) => arena.tiles.find((t) => t.i === i));
        // a Siege's Gate stands next to the keep by design (DESIGN §10.13)
        if (arena.twist === 'siege') continue; // its Gate reshapes the land at the keep, so every march there is counted out
        if (tiles.some((t) => keeps.some((k) => hexDistance(t, k) <= 1))) hugging += 1;
      }
    }
  }
  assert.ok(arenas >= 60 && marches >= 20, `${arenas} arenas with ${marches} marches: this test checks nothing`);
  assert.ok(longest >= 1);
  assert.ok(hugging <= 0.2 * marches, `${hugging} of ${marches} marches touch the keep's tile or its neighbours`);
});

// --- border marches are no-man's-land ----------------------------------------------------------------------------

test('link tiles (border marches and connectors) are neutral land: owner -1, never recoloured by a capture', () => {
  const battle = makeBattle(chain({ links: [3] }));
  assert.equal(tileOwner(battle, 3), -1);
  assert.equal(computeTerritory(battle).owners.get(3), -1);
  assert.equal(tileOwner(battle, 2), 2, 'the land around it is still the enemy\'s');
  battle.sites[1].owner = 0; // the player takes village A: its land recolours, the march does not
  assert.deepEqual([2, 3, 4, 5].map((i) => tileOwner(battle, i)), [0, -1, 0, 0]);
});

test('no legal route ever enters enemy land, except the land of the settlement it attacks (seeds 1-6, every region, both sides)', () => {
  let routes = 0;
  let marches = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const world = generateWorld(seed);
    for (const region of world.regions.filter((r) => r.tier > 0)) {
      const state = stateAtLevel(world, seed, region);
      const player = playerBattleStats(state, world, region.id);
      const enemy = enemyBattleStats(world, state, region.id);
      let arena;
      try { arena = buildArena(world, state.owner, region.id, player, enemy); } catch { continue; }
      const battle = createBattle(arena, player, enemy);
      marches += arena.tiles.filter((t) => t.link && battle.sites.every((s) => s.tile !== t.i)).length;
      for (const from of battle.sites) {
        for (const to of battle.sites) {
          if (from.id === to.id) continue;
          const route = legalRouteFor(battle, from.owner, from.id, to.id);
          if (!route) continue;
          routes += 1;
          const opponent = from.owner === 0 ? arena.enemyFaction : 0;
          for (const i of route.tiles) {
            const owner = tileOwner(battle, i);
            if (owner === opponent && i !== to.tile) assert.equal(tileCell(battle, i), to.id, `seed ${seed} ${region.name}: ${from.id} -> ${to.id} crosses enemy tile ${i}`);
          }
          for (const i of route.tiles) {
            const tile = battle.arena.tiles.find((t) => t.i === i);
            if (tile.link) assert.equal(tileOwner(battle, i), -1, 'a link tile on a route is neutral');
          }
        }
      }
    }
  }
  assert.ok(routes > 500, `only ${routes} routes checked`);
  assert.ok(marches > 0, 'some arena needed a border march, or this test checks nothing');
});
