// Battle-scene logic that needs no browser: the threat readout (enemy-intent chips) and the arena
// ownership timing (capture ripple, surrender cascade, victory flood).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, step, issue } from '../battle/sim.js';
import { buildArena } from '../battle/arena.js';
import { computeThreats, squadEtaSec, projectGarrison } from '../scenes/battleThreat.js';
import { createArenaOwnership } from '../scenes/arenaOwnership.js';
import { buildTestWorld, TARGET_REGION, DEFAULT_OWNERS } from './fixtures/battle-world.js';

const PLAYER = Object.freeze({
  atk: 1, def: 1, growth: 1, speed: 1, campTroops: 30, garrisonShare: 0.35, capBonus: 0,
  cooldownMult: 1, powers: { rally: 1, firestorm: 1, bulwark: 1, march: 1, levy: 1 },
});
const ENEMY = Object.freeze({
  atk: 1, def: 1, growth: 1, speed: 1, troopMult: 1, thinkSec: 2, personality: 'aggressive', factionId: 2,
});

function freshBattle() {
  const world = buildTestWorld();
  const arena = buildArena(world, DEFAULT_OWNERS, TARGET_REGION, PLAYER, ENEMY);
  return { world, battle: createBattle(arena, PLAYER, ENEMY) };
}

/** Sends `count` enemy troops from the enemy keep at one of the player's sites (bypassing the AI). */
function launchEnemySquad(battle, targetSiteId, count) {
  const enemyKeep = battle.sites.find((s) => s.owner === 2 && s.type === 'keep');
  enemyKeep.troops = 200;
  issue(battle, { type: 'send', owner: 2, from: enemyKeep.id, to: targetSiteId, fraction: count / 200 });
  step(battle, 0.05);
}

test('threat readout: nothing incoming means no chips', () => {
  const { battle } = freshBattle();
  assert.equal(computeThreats(battle).size, 0);
});

test('threat readout: a big squad on a small garrison says "falls, N short"; a small one says holds', () => {
  const { battle } = freshBattle();
  const mine = battle.sites.find((s) => s.owner === 0 && s.type !== 'camp') || battle.sites.find((s) => s.owner === 0);
  mine.troops = 10;

  launchEnemySquad(battle, mine.id, 40);
  let threat = computeThreats(battle).get(mine.id);
  assert.ok(threat, 'the besieged player site has a chip');
  assert.equal(threat.holds, false);
  assert.ok(threat.short >= 1);
  assert.match(threat.text, /^falls, \d+ short$/);
  assert.ok(threat.incoming >= 30);
  assert.ok(threat.etaSec > 0);

  // A tiny squad against a strong garrison: holds, with a predicted loss.
  const b2 = freshBattle().battle;
  const mine2 = b2.sites.find((s) => s.owner === 0);
  mine2.troops = 60;
  launchEnemySquad(b2, mine2.id, 8);
  threat = computeThreats(b2).get(mine2.id);
  assert.ok(threat);
  assert.equal(threat.holds, true);
  assert.match(threat.text, /^−\d+ · holds$/);
  assert.ok(threat.loss >= 1 && threat.loss <= 9);
});

test('threat readout ignores squads that are not heading for a player site', () => {
  const { battle } = freshBattle();
  const foe = battle.sites.find((s) => s.owner === 2 && s.type !== 'keep');
  const enemyKeep = battle.sites.find((s) => s.owner === 2 && s.type === 'keep');
  enemyKeep.troops = 100;
  issue(battle, { type: 'send', owner: 2, from: enemyKeep.id, to: foe.id, fraction: 0.5 }); // reinforcement
  step(battle, 0.05);
  assert.equal(computeThreats(battle).size, 0);
});

test('squad ETA shrinks as it marches; garrison projection grows then caps', () => {
  const { battle } = freshBattle();
  const mine = battle.sites.find((s) => s.owner === 0);
  launchEnemySquad(battle, mine.id, 20);
  const sq = battle.squads.find((s) => s.owner === 2);
  const e0 = squadEtaSec(battle, sq);
  for (let i = 0; i < 20; i++) step(battle, 0.05);
  const e1 = squadEtaSec(battle, sq);
  assert.ok(e1 < e0, `eta ${e0.toFixed(2)} -> ${e1.toFixed(2)}`);
  mine.troops = mine.cap - 1;
  assert.equal(projectGarrison(mine, 100), mine.cap);
  mine.troops = mine.cap + 20;
  assert.ok(projectGarrison(mine, 5) < mine.cap + 20);
  assert.ok(projectGarrison(mine, 1000) >= mine.cap);
});

test('arena ownership: nearest-site Voronoi covers every land tile of the region', () => {
  const { world, battle } = freshBattle();
  const own = createArenaOwnership(world, battle, TARGET_REGION, DEFAULT_OWNERS);
  const landTiles = world.regions[TARGET_REGION].tiles.map((i) => world.tiles[i]).filter((t) => t.land);
  assert.equal(own.voronoi.size, landTiles.length, 'rock included');
  // a site's own tile belongs to it
  for (const s of battle.sites) {
    if (world.tiles[s.tile].region !== TARGET_REGION) continue;
    assert.equal(own.voronoi.get(s.tile), s.id);
    assert.equal(own.tileOwner(world.tiles[s.tile], 0), s.owner);
  }
  // outside the region: the world's owner
  const outside = world.tiles.find((t) => t.land && t.region !== TARGET_REGION && t.region >= 0);
  assert.equal(own.tileOwner(outside, 0), DEFAULT_OWNERS[outside.region]);
});

test('arena ownership: a capture ripples outward, then settles on the new owner', () => {
  const { world, battle } = freshBattle();
  const own = createArenaOwnership(world, battle, TARGET_REGION, DEFAULT_OWNERS);
  const foe = battle.sites.find((s) => s.owner === 2 && s.type === 'village');
  const cell = own.cells.get(foe.id);
  assert.ok(cell.length >= 2);
  const before = own.signature(0);
  foe.owner = 0; // the sim flipped it
  const flipped = own.onCapture(foe.id, 2, 1000, 250);
  assert.equal(flipped, cell.length);
  const tile = world.tiles[foe.tile];
  // Immediately after the capture the centre tile is already new (delay 0), the far tiles still old.
  assert.equal(own.tileOwner(tile, 1000.5), 0);
  const far = cell.reduce((a, t) => (Math.hypot(t.x - tile.x, t.y - tile.y) > Math.hypot(a.x - tile.x, a.y - tile.y) ? t : a));
  if (far.i !== tile.i) assert.equal(own.tileOwner(far, 1010), 2, 'far tile has not flipped yet');
  assert.equal(own.tileOwner(far, 1400), 0, 'and has once the ripple is over');
  assert.notEqual(own.signature(1010), own.signature(1400));
  assert.notEqual(before, own.signature(1400));
});

test('arena ownership: victory cascade holds the old owner until each slot; flood goes outward from the keep', () => {
  const { world, battle } = freshBattle();
  const own = createArenaOwnership(world, battle, TARGET_REGION, DEFAULT_OWNERS);
  const inRegion = battle.sites.filter((s) => world.tiles[s.tile].region === TARGET_REGION);
  const foes = inRegion.filter((s) => s.owner !== 0);
  const keep = foes.find((s) => s.type === 'keep');
  const others = foes.filter((s) => s.id !== keep.id);
  const now = 5000;
  const prevOwner = new Map(foes.map((s) => [s.id, s.owner]));
  const lastTileBefore = (tile) => own.tileOwner(tile, now);
  const tilesBefore = new Map(own.regionTiles.map((tt) => [tt.i, lastTileBefore(tt)])); // owners as displayed BEFORE the flip
  for (const s of foes) s.owner = 0; // the sim flipped everything at the end
  const slots = own.startCascade(others.map((s) => s.id), (id) => prevOwner.get(id), now + 250, 120);
  assert.equal(slots.length, others.length);
  for (const [i, sl] of slots.entries()) {
    assert.equal(own.siteOwner(sl.siteId, sl.at - 1), prevOwner.get(sl.siteId), `site ${i} still shows its old owner`);
    assert.equal(own.siteOwner(sl.siteId, sl.at + 1), 0, `site ${i} shows the player after its slot`);
    if (i > 0) assert.equal(sl.at - slots[i - 1].at, 120);
  }
  const keepTile = world.tiles[keep.tile];
  const { schedule, endMs } = own.startFlood(now, now + 700, 45, keepTile, (id) => (prevOwner.has(id) ? prevOwner.get(id) : 0));
  assert.ok(schedule.length > 0);
  for (let i = 1; i < schedule.length; i++) assert.ok(schedule[i].at >= schedule[i - 1].at);
  assert.equal(schedule[0].tile.i, keepTile.i, 'the keep tile is first');
  assert.equal(schedule[schedule.length - 1].at, endMs);
  const last = schedule[schedule.length - 1].tile;
  assert.equal(own.tileOwner(last, endMs - 1), tilesBefore.get(last.i), 'the farthest tile still shows the old owner just before its turn');
  assert.equal(own.tileOwner(last, endMs + 1), 0);
  own.settle();
  assert.equal(own.tileOwner(last, now), 0, 'settle() drops every pending recolour');
});
