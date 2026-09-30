// Powers (DESIGN §4.5): rally, firestorm, bulwark, forced march, levy; cooldowns and locked
// (level 0) powers. See docs/ARCHITECTURE.md §6.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, step, issue } from '../battle/sim.js';
import { garrisonPerTroopStrength } from '../battle/combat.js';
import { POWERS } from '../config/battle.js';

const BASE_PLAYER = Object.freeze({
  atk: 1, def: 1, growth: 0, speed: 1, campTroops: 30, garrisonShare: 0.35, capBonus: 0,
  cooldownMult: 1, powers: { rally: 1, firestorm: 1, bulwark: 1, march: 1, levy: 1 },
});
const ENEMY = Object.freeze({
  atk: 1, def: 1, growth: 0, speed: 1, troopMult: 1, thinkSec: 2, personality: 'aggressive', factionId: 2,
});

/** camp(0) - village(1) - keep(2), a straight line so every pair is a single-hop path. */
function threeSiteArena() {
  const tiles = [0, 1, 2].map((q) => ({
    i: q, q, r: 0, x: q * Math.sqrt(3), y: 0, cost: 1, terrain: 'grass', region: 0,
  }));
  const sites = [
    { id: 0, settlement: -1, tile: 0, type: 'camp', owner: 0, troops: 30 },
    { id: 1, settlement: 0, tile: 1, type: 'village', owner: 0, troops: 20 },
    { id: 2, settlement: 1, tile: 2, type: 'keep', owner: 2, troops: 50 },
  ];
  return { regionId: 0, enemyFaction: 2, tiles, sites, focus: { minX: 0, maxX: 2 * Math.sqrt(3), minY: 0, maxY: 0 } };
}

function player(overrides = {}) {
  return { ...BASE_PLAYER, powers: { ...BASE_PLAYER.powers, ...overrides.powers }, ...overrides };
}

test('rally: every owned site (except the target) sends a share toward it', () => {
  const battle = createBattle(threeSiteArena(), player(), ENEMY);
  issue(battle, { type: 'power', owner: 0, power: 'rally', target: 2 });
  step(battle, 0.05);

  const sent = battle.events.filter((e) => e.type === 'send');
  assert.equal(sent.length, 2, 'both camp and village should send toward the keep');
  assert.deepEqual(sent.map((e) => e.from).sort(), [0, 1]);
  assert.ok(sent.every((e) => e.to === 2));
  assert.equal(battle.sites[0].troops, 30 - Math.floor(30 * POWERS.rally.share));
  assert.equal(battle.sites[1].troops, 20 - Math.floor(20 * POWERS.rally.share));
  const powerEvent = battle.events.find((e) => e.type === 'power');
  assert.equal(powerEvent.power, 'rally');
  assert.equal(powerEvent.owner, 0);
  assert.equal(powerEvent.target, 2);
  assert.ok(battle.cooldowns.rally > 0, 'cooldown should be set');
});

test('firestorm: delayed impact damages hostile squads and garrisons in radius, not the caster\'s own', () => {
  const battle = createBattle(threeSiteArena(), player(), ENEMY);
  // A friendly squad marching past, within blast radius of the keep, to prove firestorm
  // spares it. `to` is the (friendly) village, not the keep, even though its path still
  // passes through the keep's tile for positioning — the test steps enough ticks for the
  // firestorm delay to elapse, and a squad genuinely marching `to` a hostile site would
  // eventually arrive and start a real assault, contaminating the measurement with unrelated
  // combat damage; arriving "at" a friendly destination is just a harmless reinforcement.
  const friendlySquad = {
    id: battle.nextId++, owner: 0, count: 15, from: 1, to: 1, path: [2], seg: 0, prog: 0.5,
    state: 'march', foe: null,
  };
  battle.squads.push(friendlySquad);

  const keepTile = battle.arena.tiles.find((t) => t.i === 2);
  issue(battle, { type: 'power', owner: 0, power: 'firestorm', target: { q: keepTile.q, r: keepTile.r } });
  step(battle, 0.05); // cast this tick
  assert.equal(battle.pending.length, 1);
  assert.equal(battle.events.filter((e) => e.type === 'firestorm').length, 0, 'impact is delayed');

  const before = battle.sites[2].troops;
  const firestormEvents = [];
  for (let i = 0; i < 200 && battle.pending.length > 0; i++) {
    step(battle, 0.05);
    firestormEvents.push(...battle.events.filter((e) => e.type === 'firestorm'));
  }
  assert.equal(battle.pending.length, 0, 'the pending effect should have resolved');
  assert.equal(firestormEvents.length, 1);
  assert.ok(Math.abs(firestormEvents[0].radius - POWERS.firestorm.radius) < 1e-9);
  assert.equal(battle.sites[2].troops, before - POWERS.firestorm.damage, 'enemy keep garrison takes damage');
  assert.equal(friendlySquad.count, 15, 'the caster\'s own squad must be untouched');
});

test('bulwark: defence multiplier applies to the targeted site while active', () => {
  const battle = createBattle(threeSiteArena(), player(), ENEMY);
  const village = battle.sites[1]; // player-owned
  const before = garrisonPerTroopStrength(village, 0, battle.player, battle.arena.enemyFaction, battle.enemy, battle.t);
  issue(battle, { type: 'power', owner: 0, power: 'bulwark', target: 1 });
  step(battle, 0.05);
  assert.ok(village.bulwarkUntil > battle.t);
  const during = garrisonPerTroopStrength(village, 0, battle.player, battle.arena.enemyFaction, battle.enemy, battle.t);
  assert.ok(Math.abs(during - before * POWERS.bulwark.mult) < 1e-9);

  // Cannot bulwark a site you don't own.
  const battle2 = createBattle(threeSiteArena(), player(), ENEMY);
  issue(battle2, { type: 'power', owner: 0, power: 'bulwark', target: 2 }); // the enemy keep
  step(battle2, 0.05);
  assert.equal(battle2.sites[2].bulwarkUntil, 0, 'bulwark should be refused on a non-owned site');
});

test('forced march: player squads move faster while active', () => {
  function speedAfterOneTick(marchActive) {
    const battle = createBattle(threeSiteArena(), player(), ENEMY);
    if (marchActive) battle.effects.marchUntil = 999;
    issue(battle, { type: 'send', owner: 0, from: [0], to: 2, fraction: 1.0 });
    step(battle, 0.05);
    return battle.squads[0].prog + battle.squads[0].seg; // total progress along the path
  }
  const normal = speedAfterOneTick(false);
  const marched = speedAfterOneTick(true);
  assert.ok(marched > normal * 1.5, `forced march should move noticeably farther: ${marched} vs ${normal}`);
  assert.ok(Math.abs(marched / normal - POWERS.march.mult) < 0.05);
});

test('levy: adds troops at every settlement the caster owns', () => {
  const battle = createBattle(threeSiteArena(), player(), ENEMY);
  const before = { camp: battle.sites[0].troops, village: battle.sites[1].troops, keep: battle.sites[2].troops };
  issue(battle, { type: 'power', owner: 0, power: 'levy', target: null });
  step(battle, 0.05);
  assert.equal(battle.sites[0].troops, before.camp + POWERS.levy.troops);
  assert.equal(battle.sites[1].troops, before.village + POWERS.levy.troops);
  assert.equal(battle.sites[2].troops, before.keep, 'the enemy keep must be untouched');
});

test('cooldowns: a power cannot be reused until its cooldown (scaled by level) elapses', () => {
  const lvl3 = player({ powers: { rally: 3 }, cooldownMult: 1 });
  const battle = createBattle(threeSiteArena(), lvl3, ENEMY);
  const t0 = battle.t; // commands apply at the START of the step, i.e. at the pre-tick time
  issue(battle, { type: 'power', owner: 0, power: 'rally', target: 2 });
  step(battle, 0.05);
  const expectedCooldown = POWERS.rally.cooldown * POWERS.cooldownPerLevel ** (3 - 1);
  assert.ok(Math.abs(battle.cooldowns.rally - (t0 + expectedCooldown)) < 1e-9);
  assert.ok(expectedCooldown < POWERS.rally.cooldown, 'higher level should shorten the cooldown');

  // Immediately trying again is a no-op: no new sends, cooldown untouched.
  const troopsAfterFirst = battle.sites[0].troops;
  issue(battle, { type: 'power', owner: 0, power: 'rally', target: 2 });
  step(battle, 0.05);
  assert.equal(battle.sites[0].troops, troopsAfterFirst, 'on cooldown: nothing should be sent');

  // Fast-forward past the cooldown: it works again.
  for (let i = 0; i < Math.ceil(expectedCooldown / 0.05) + 2; i++) step(battle, 0.05);
  const troopsBeforeThird = battle.sites[0].troops;
  issue(battle, { type: 'power', owner: 0, power: 'rally', target: 2 });
  step(battle, 0.05);
  assert.ok(battle.sites[0].troops < troopsBeforeThird, 'off cooldown: rally should fire again');
});

test('a locked power (level 0) is silently ignored', () => {
  const locked = player({ powers: { rally: 0 } });
  const battle = createBattle(threeSiteArena(), locked, ENEMY);
  const before = battle.sites.map((s) => s.troops);
  issue(battle, { type: 'power', owner: 0, power: 'rally', target: 2 });
  step(battle, 0.05);
  assert.deepEqual(battle.sites.map((s) => s.troops), before);
  assert.equal(battle.cooldowns.rally, 0);
  assert.equal(battle.events.filter((e) => e.type === 'power').length, 0);
});
