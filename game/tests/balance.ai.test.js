// Enemy AI behaviours (docs/briefs/balance.md §4): opening grace, early reinforcement, no
// double-committing, converging arrivals, punishing over-extension, the all-in counterpunch,
// personalities that differ, a keep that is never stripped, determinism and cost.
// Arenas are hand-built lines of hexes so every distance and timing is exact.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, step, issue } from '../battle/sim.js';
import { think } from '../battle/ai.js';
import { decide } from '../battle/bot.js';
import { buildArena } from '../battle/arena.js';
import { buildTestWorld, TARGET_REGION, DEFAULT_OWNERS } from './fixtures/battle-world.js';

const ENEMY_FACTION = 2;

function player(over = {}) {
  return {
    atk: 1, def: 1, growth: 0, speed: 1, campTroops: 30, garrisonShare: 0.35, capBonus: 0,
    cooldownMult: 1, powers: { rally: 1, firestorm: 0, bulwark: 0, march: 0, levy: 0 }, ...over,
  };
}

function enemy(over = {}) {
  return {
    atk: 1, def: 1, growth: 0, speed: 1, troopMult: 1, thinkSec: 1, graceSec: 0,
    personality: 'aggressive', factionId: ENEMY_FACTION, ...over,
  };
}

/** A straight line of grass hexes 0..length-1 with sites at the given tiles. `specs` are
 * `{ type, owner, troops, at }`; site 0 is always the player's camp (at tile 0 unless given). */
function lineArena(length, specs) {
  const tiles = [];
  for (let q = 0; q < length; q++) {
    tiles.push({ i: q, q, r: 0, x: Math.sqrt(3) * q, y: 0, cost: 1, terrain: 'grass', region: 1 });
  }
  const sites = specs.map((s, id) => ({
    id, settlement: id === 0 && s.type === 'camp' ? -1 : id, tile: s.at, type: s.type, owner: s.owner, troops: s.troops,
  }));
  return {
    regionId: 1, enemyFaction: ENEMY_FACTION, tiles, sites,
    focus: { minX: 0, maxX: Math.sqrt(3) * length, minY: 0, maxY: 0 },
  };
}

/** Runs think() for `seconds` of battle time, stepping the sim; returns every command issued. */
function runAi(battle, seconds, { bot = false } = {}) {
  const log = [];
  const memo = {};
  const end = battle.t + seconds;
  while (battle.t < end - 1e-9 && !battle.result) {
    for (const cmd of think(battle, battle.t)) {
      // record who owned the target WHEN the order was given (a capture later flips it)
      log.push({ t: battle.t, cmd, toOwner: cmd.type === 'send' ? battle.sites[cmd.to].owner : null });
      issue(battle, cmd);
    }
    if (bot) for (const cmd of decide(battle, battle.t, memo)) issue(battle, cmd);
    step(battle, 0.05);
  }
  return log;
}

const isAttackOnPlayer = (_battle, entry) => entry.cmd.type === 'send' && entry.toOwner === 0;

test('opening grace: no attacks on player sites until graceSec, defence allowed', () => {
  const arena = lineArena(9, [
    { type: 'camp', owner: 0, troops: 4, at: 0 },
    { type: 'village', owner: 0, troops: 3, at: 1 },
    { type: 'village', owner: ENEMY_FACTION, troops: 60, at: 5 },
    { type: 'village', owner: ENEMY_FACTION, troops: 60, at: 6 },
    { type: 'keep', owner: ENEMY_FACTION, troops: 80, at: 8 },
  ]);
  const battle = createBattle(arena, player(), enemy({ graceSec: 12, thinkSec: 1 }));
  const early = runAi(battle, 11.5);
  assert.equal(early.filter((e) => isAttackOnPlayer(battle, e)).length, 0, 'no offence inside the grace window');
  const later = runAi(battle, 8);
  assert.ok(later.some((e) => isAttackOnPlayer(battle, e)), 'once the grace is over the aggressive AI goes for the weak player');
});

test('opening grace still lets the AI reinforce a threatened site', () => {
  const arena = lineArena(9, [
    { type: 'camp', owner: 0, troops: 60, at: 0 },
    { type: 'village', owner: ENEMY_FACTION, troops: 20, at: 3 },
    { type: 'village', owner: ENEMY_FACTION, troops: 60, at: 5 },
    { type: 'keep', owner: ENEMY_FACTION, troops: 80, at: 8 },
  ]);
  const battle = createBattle(arena, player(), enemy({ graceSec: 30 }));
  issue(battle, { type: 'send', owner: 0, from: [0], to: 1, fraction: 1 }); // 60 troops at a 20-troop village
  const log = runAi(battle, 3);
  const help = log.filter((e) => e.cmd.type === 'send' && e.cmd.to === 1);
  assert.ok(help.length > 0, 'defence must not wait for the grace to end');
});

test('reinforces early: help is sent as soon as a squad marches, sized to the shortfall', () => {
  const arena = lineArena(11, [
    { type: 'camp', owner: 0, troops: 50, at: 0 },
    { type: 'village', owner: ENEMY_FACTION, troops: 20, at: 5 },
    { type: 'village', owner: ENEMY_FACTION, troops: 70, at: 7 },
    { type: 'keep', owner: ENEMY_FACTION, troops: 90, at: 10 },
  ]);
  const battle = createBattle(arena, player(), enemy({ graceSec: 0, personality: 'defensive' }));
  issue(battle, { type: 'send', owner: 0, from: [0], to: 1, fraction: 0.8 }); // 40 vs a 20 garrison
  const log = runAi(battle, 2.5);
  const help = log.filter((e) => e.cmd.type === 'send' && e.cmd.to === 1);
  assert.ok(help.length > 0, 'the village should be reinforced while the attackers are still far away');
  assert.ok(help[0].t < 2, 'and early');
  const sent = help.reduce((sum, e) => {
    const from = battle.sites[e.cmd.from[0]];
    return sum + Math.floor(from.troops * e.cmd.fraction);
  }, 0);
  assert.ok(sent < 60, `only what is needed, not everything (sent ~${sent})`);
});

test('never double-commits: a wave already marching on a target is counted, not repeated', () => {
  const arena = lineArena(8, [
    { type: 'camp', owner: 0, troops: 2, at: 0 },
    { type: 'village', owner: 0, troops: 6, at: 1 },
    { type: 'village', owner: ENEMY_FACTION, troops: 90, at: 4 },
    { type: 'keep', owner: ENEMY_FACTION, troops: 140, at: 7 },
  ]);
  const battle = createBattle(arena, player(), enemy({ graceSec: 0, thinkSec: 1 }));
  const log = runAi(battle, 1.2);
  const first = log.filter((e) => isAttackOnPlayer(battle, e));
  assert.ok(first.length > 0, 'expected an attack on the weak player village');
  const target = first[0].cmd.to;
  const more = runAi(battle, 1.2).filter((e) => e.cmd.type === 'send' && e.cmd.to === target);
  assert.equal(more.length, 0, 'the second think must see the squads en route and stand down');
});

test('concentrates force: several sources converge on one target and arrive together', () => {
  // A 100-troop target that no single 40-troop village can take; three villages at different
  // distances must pool, and their squads must reach it within a couple of seconds of each other.
  const arena = lineArena(15, [
    { type: 'camp', owner: 0, troops: 100, at: 7 },
    { type: 'village', owner: ENEMY_FACTION, troops: 45, at: 1 },
    { type: 'village', owner: ENEMY_FACTION, troops: 45, at: 3 },
    { type: 'village', owner: ENEMY_FACTION, troops: 45, at: 5 },
    { type: 'keep', owner: ENEMY_FACTION, troops: 5, at: 0 },
  ]);
  arena.sites[0].troops = 60;
  const battle = createBattle(arena, player({ growth: 0 }), enemy({ graceSec: 0, personality: 'aggressive', thinkSec: 1 }));
  const arrivals = new Map();
  const memo = {};
  const senders = new Set();
  for (let i = 0; i < 20 * 25 && !battle.result; i++) {
    for (const cmd of think(battle, battle.t)) {
      issue(battle, cmd);
      if (cmd.type === 'send' && battle.sites[cmd.to].owner === 0) senders.add(cmd.from[0]);
    }
    for (const cmd of decide(battle, battle.t, memo)) void cmd; // the player just sits: no orders
    step(battle, 0.05);
    for (const ev of battle.events) {
      if (ev.type === 'assault' && ev.owner === ENEMY_FACTION && !arrivals.has(ev.site)) arrivals.set(ev.site, battle.t);
    }
    for (const site of battle.sites) {
      if (site.assault && site.assault.owner === ENEMY_FACTION) {
        for (const id of site.assault.squads) {
          const key = `${site.id}:${id}`;
          if (!arrivals.has(key)) arrivals.set(key, battle.t);
        }
      }
    }
  }
  assert.ok(senders.size >= 2, `expected a converging attack from >= 2 sources, got ${senders.size}`);
  const times = [...arrivals.entries()].filter(([k]) => String(k).includes(':')).map(([, t]) => t);
  assert.ok(times.length >= 2, 'expected several squads to reach the target');
  assert.ok(Math.max(...times) - Math.min(...times) < 3.5, `arrivals should be near-simultaneous (spread ${(Math.max(...times) - Math.min(...times)).toFixed(1)}s)`);
});

test('punishes over-extension: a player site that just emptied itself is hit first', () => {
  const arena = lineArena(10, [
    { type: 'camp', owner: 0, troops: 60, at: 0 },
    { type: 'village', owner: 0, troops: 40, at: 2 },
    { type: 'village', owner: 0, troops: 40, at: 3 },
    { type: 'village', owner: ENEMY_FACTION, troops: 120, at: 7 },
    { type: 'keep', owner: ENEMY_FACTION, troops: 150, at: 9 },
  ]);
  // Front lines (DESIGN §4.4) would hide village #1 behind village #2's land; this test is about target choice, so the
  // land between them is open connector land here (tile.link) and both villages stay attackable.
  for (const i of [3, 4, 5]) arena.tiles[i].link = true;
  const battle = createBattle(arena, player(), enemy({ graceSec: 0, thinkSec: 1, personality: 'defensive' }));
  runAi(battle, 1.1); // the AI sees both villages full: a defensive faction holds still
  battle.sites[1].troops = 3; // ...then the player sends the garrison of village #1 away
  const log = runAi(battle, 2.2);
  const hits = log.filter((e) => isAttackOnPlayer(battle, e));
  assert.ok(hits.length > 0, 'a defensive AI counterattacks an over-extended player');
  assert.equal(hits[0].cmd.to, 1, 'and it picks the emptied village, not the full one');
});

test('clearly losing: commits everything to one counterpunch at the weakest player site, then waits', () => {
  const arena = lineArena(12, [
    { type: 'camp', owner: 0, troops: 200, at: 0 },
    { type: 'village', owner: 0, troops: 150, at: 1 },
    { type: 'village', owner: ENEMY_FACTION, troops: 20, at: 6 },
    { type: 'village', owner: ENEMY_FACTION, troops: 20, at: 7 },
    { type: 'keep', owner: ENEMY_FACTION, troops: 30, at: 11 },
  ]);
  arena.sites[1].troops = 10; // a soft spot exists
  const battle = createBattle(arena, player(), enemy({ graceSec: 0, thinkSec: 1, personality: 'aggressive' }));
  const log = runAi(battle, 9); // the far sites are staggered so every squad lands together
  const strikes = log.filter((e) => isAttackOnPlayer(battle, e));
  assert.ok(strikes.length >= 3, `expected an all-in from every site, got ${strikes.length} orders`);
  assert.ok(strikes.every((e) => e.cmd.to === 1), 'all aimed at the weakest player site');
  const again = runAi(battle, 4).filter((e) => isAttackOnPlayer(battle, e));
  assert.equal(again.length, 0, 'one counterpunch, then it waits (cooldown)');
});

test('personalities differ: defensive ignores a healthy target that aggressive attacks', () => {
  function attacksOn(personality) {
    const arena = lineArena(9, [
      { type: 'camp', owner: 0, troops: 40, at: 0 },
      { type: 'village', owner: ENEMY_FACTION, troops: 90, at: 5 },
      { type: 'village', owner: ENEMY_FACTION, troops: 90, at: 6 },
      { type: 'keep', owner: ENEMY_FACTION, troops: 120, at: 8 },
    ]);
    const battle = createBattle(arena, player(), enemy({ graceSec: 0, thinkSec: 1, personality }));
    return runAi(battle, 4).filter((e) => isAttackOnPlayer(battle, e)).length;
  }
  assert.ok(attacksOn('aggressive') > 0, 'aggressive goes for a healthy camp it can beat');
  assert.equal(attacksOn('passive'), 0, 'passive never attacks');
  assert.ok(attacksOn('swarm') > 0, 'swarm attacks too');
  assert.equal(attacksOn('defensive'), 0, 'defensive does not go looking for a fight with a healthy camp');
});

test('the keep is never stripped: it keeps at least its guard however big the horde', () => {
  const arena = lineArena(9, [
    { type: 'camp', owner: 0, troops: 40, at: 0 },
    { type: 'village', owner: ENEMY_FACTION, troops: 200, at: 5 },
    { type: 'keep', owner: ENEMY_FACTION, troops: 1200, at: 8 }, // far over its cap
  ]);
  const battle = createBattle(arena, player(), enemy({ graceSec: 0, thinkSec: 1, personality: 'aggressive' }));
  const keepId = 2;
  runAi(battle, 1.5);
  const inFlight = battle.squads.filter((s) => s.from === keepId).reduce((sum, s) => sum + s.count, 0);
  assert.ok(battle.sites[keepId].troops > 40, `keep left with ${battle.sites[keepId].troops.toFixed(0)} (it sent ${inFlight.toFixed(0)})`);
  assert.ok(battle.sites[keepId].troops > 0.05 * (battle.sites[keepId].troops + inFlight), 'and not a token garrison');
});

test('deterministic and JSON-safe: a mid-battle save/load continues identically', () => {
  const world = buildTestWorld();
  const p = player({ growth: 1 });
  const e = enemy({ growth: 1, graceSec: 3, personality: 'swarm', thinkSec: 1.2 });
  const arena = buildArena(world, [...DEFAULT_OWNERS], TARGET_REGION, p, e);
  function fresh() { return createBattle(arena, p, e); }
  function advance(battle, seconds) { const memo = {}; for (let i = 0; i < seconds * 20 && !battle.result; i++) { for (const c of think(battle, battle.t)) issue(battle, c); for (const c of decide(battle, battle.t, memo)) issue(battle, c); step(battle, 0.05); } }
  const a = fresh(); advance(a, 30);
  const b = fresh(); advance(b, 15);
  const resumed = JSON.parse(JSON.stringify(b));
  for (let i = 0; i < 15 * 20 && !resumed.result; i++) { for (const c of think(resumed, resumed.t)) issue(resumed, c); step(resumed, 0.05); }
  // The bot's memo is not part of the saved battle, so compare only what the AI alone would do:
  const c1 = fresh(); const c2 = fresh();
  for (let i = 0; i < 20 * 40 && !c1.result; i++) { for (const c of think(c1, c1.t)) issue(c1, c); step(c1, 0.05); }
  for (let i = 0; i < 20 * 20 && !c2.result; i++) { for (const c of think(c2, c2.t)) issue(c2, c); step(c2, 0.05); }
  const c2b = JSON.parse(JSON.stringify(c2));
  for (let i = 0; i < 20 * 20 && !c2b.result; i++) { for (const c of think(c2b, c2b.t)) issue(c2b, c); step(c2b, 0.05); }
  assert.equal(JSON.stringify(c2b), JSON.stringify(c1));
  assert.ok(resumed.t > 0);
});

test('think() stays cheap on a real-sized arena (< 0.5 ms per call on average)', () => {
  const world = buildTestWorld();
  const p = player({ growth: 1 });
  const e = enemy({ growth: 1, graceSec: 0, personality: 'swarm', thinkSec: 0.1 });
  const arena = buildArena(world, [...DEFAULT_OWNERS], TARGET_REGION, p, e);
  const battle = createBattle(arena, p, e);
  const memo = {};
  let thinks = 0;
  let ms = 0;
  for (let i = 0; i < 20 * 60 && !battle.result; i++) {
    const t0 = performance.now();
    const cmds = think(battle, battle.t);
    ms += performance.now() - t0;
    thinks += 1;
    for (const c of cmds) issue(battle, c);
    for (const c of decide(battle, battle.t, memo)) issue(battle, c);
    step(battle, 0.05);
  }
  assert.ok(thinks > 100);
  assert.ok(ms / thinks < 0.5, `think() averaged ${(ms / thinks).toFixed(3)} ms`);
});
