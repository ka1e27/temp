// The player bot (game/battle/bot.js) is the yardstick the difficulty labels are fitted to, so its
// habits are pinned: it gets impatient instead of deadlocking, it throws waves at a keep it cannot
// beat in one blow, it never micro-manages dozens of squads or trickles 1-2 troop squads, it
// answers an attack on one of its sites, and casting a power is not "doing something".
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, step, issue } from '../battle/sim.js';
import { decide } from '../battle/bot.js';

function lineArena(length, specs) {
  const tiles = [];
  for (let q = 0; q < length; q++) tiles.push({ i: q, q, r: 0, x: Math.sqrt(3) * q, y: 0, cost: 1, terrain: 'grass', region: 1 });
  const sites = specs.map((s, id) => ({
    id, settlement: id === 0 && s.type === 'camp' ? -1 : id, tile: s.at, type: s.type, owner: s.owner, troops: s.troops,
  }));
  return { regionId: 1, enemyFaction: 2, tiles, sites, focus: { minX: 0, maxX: Math.sqrt(3) * length, minY: 0, maxY: 0 } };
}

const PLAYER = {
  atk: 1, def: 1, growth: 0, speed: 1, campTroops: 30, garrisonShare: 0.05, capBonus: 0, cooldownMult: 1,
  powers: { rally: 1, firestorm: 0, bulwark: 0, march: 0, levy: 0 },
};
const ENEMY = { atk: 1, def: 1, growth: 0, speed: 1, troopMult: 1, thinkSec: 2, graceSec: 0, personality: 'passive', factionId: 2 };

/** Runs the bot alone (the enemy never acts) and returns the send orders with their times. */
function runBot(battle, seconds) {
  const memo = {};
  const sends = [];
  for (let i = 0; i < seconds * 20 && !battle.result; i++) {
    for (const cmd of decide(battle, battle.t, memo)) {
      if (cmd.type === 'send') sends.push({ t: battle.t, cmd, from: battle.sites[cmd.from[0]].troops });
      issue(battle, cmd);
    }
    step(battle, 0.05);
  }
  return { sends, memo };
}

test('impatient: a keep it could take but not "comfortably" is attacked after a pause, not never', () => {
  // keep 50 troops x 1.6 defence = 80 strength; the camp has 90. Needs 1.2 x 80 = 96 to launch
  // "comfortably" (and keeps a 20% reserve), so a patient bot would sit forever.
  const arena = lineArena(9, [
    { type: 'camp', owner: 0, troops: 90, at: 0 },
    { type: 'keep', owner: 2, troops: 50, at: 7 },
  ]);
  const battle = createBattle(arena, PLAYER, { ...ENEMY, growth: 0 });
  const { sends } = runBot(battle, 60);
  assert.ok(sends.length > 0, 'the bot must eventually commit');
  assert.ok(sends[0].t > 10, `it waits a while first (first order at ${sends[0].t.toFixed(1)}s)`);
  assert.ok(sends[0].t < 45, `but not forever (first order at ${sends[0].t.toFixed(1)}s)`);
});

test('attrition: when even an all-in cannot win outright it throws waves at the keep', () => {
  // keep strength 100 vs a 60-troop camp: never winnable in one blow, but its sites regrow.
  const arena = lineArena(9, [
    { type: 'camp', owner: 0, troops: 60, at: 0 },
    { type: 'keep', owner: 2, troops: 62.5, at: 7 },
  ]);
  const battle = createBattle(arena, PLAYER, ENEMY);
  const { sends } = runBot(battle, 120);
  assert.ok(sends.length > 0, 'it must not sit at full strength for eight minutes');
  assert.ok(sends[0].t > 30, `only after it has clearly run out of patience (${sends[0].t.toFixed(1)}s)`);
});

test('never more than 14 live squads and never a squad under 3 troops', () => {
  const specs = [{ type: 'camp', owner: 0, troops: 400, at: 0 }, { type: 'village', owner: 0, troops: 200, at: 1 }];
  for (let k = 0; k < 8; k++) specs.push({ type: 'hamlet', owner: 2, troops: 12, at: 4 + k });
  const battle = createBattle(lineArena(14, specs), PLAYER, ENEMY);
  const memo = {};
  let maxLive = 0;
  let smallest = Infinity;
  for (let i = 0; i < 60 * 20 && !battle.result; i++) {
    for (const cmd of decide(battle, battle.t, memo)) {
      if (cmd.type === 'send') {
        const troops = Math.floor(battle.sites[cmd.from[0]].troops * cmd.fraction);
        smallest = Math.min(smallest, troops);
      }
      issue(battle, cmd);
    }
    step(battle, 0.05);
    maxLive = Math.max(maxLive, battle.squads.filter((s) => s.owner === 0).length);
  }
  assert.ok(maxLive <= 14 + 2, `live player squads peaked at ${maxLive}`); // +2: one tick of orders can land together
  assert.ok(smallest >= 3, `smallest squad ordered: ${smallest}`);
});

test('answers a march on one of its sites: the nearest surplus is sent', () => {
  const arena = lineArena(11, [
    { type: 'camp', owner: 0, troops: 120, at: 0 },
    { type: 'village', owner: 0, troops: 8, at: 3 },
    { type: 'village', owner: 2, troops: 200, at: 9 },
  ]);
  const battle = createBattle(arena, PLAYER, ENEMY);
  // an enemy squad of 40 already marching on the weak village
  battle.squads.push({ id: battle.nextId++, owner: 2, count: 40, from: 2, to: 1, path: [8, 7, 6, 5, 4, 3], seg: 0, prog: 0, state: 'march', foe: null });
  const memo = {};
  const cmds = decide(battle, 0, memo).filter((c) => c.type === 'send' && c.to === 1);
  assert.ok(cmds.length > 0, 'it should reinforce the village');
  assert.equal(cmds[0].from[0], 0, 'from the camp');
});

test('casting a power is not activity: it must not reset the impatience clock', () => {
  const arena = lineArena(9, [
    { type: 'camp', owner: 0, troops: 30, at: 0 },
    { type: 'keep', owner: 2, troops: 200, at: 7 },
  ]);
  const player = { ...PLAYER, powers: { rally: 1, firestorm: 0, bulwark: 0, march: 0, levy: 1 } };
  const battle = createBattle(arena, player, ENEMY);
  const memo = {};
  const cmds = decide(battle, 0.5, memo);
  assert.ok(cmds.some((c) => c.type === 'power' && c.power === 'levy'), 'levy is cast as soon as it is ready');
  assert.ok(!memo.lastAct, 'but that alone does not count as the bot having done something');
});
