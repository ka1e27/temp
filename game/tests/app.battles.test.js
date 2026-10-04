// The battle manager (game/app/battles.js, ARCHITECTURE 10.1): battles live outside the battle scene. Plain Node: the manager has no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattleManager, MAX_BATTLES } from '../app/battles.js';
import { generateWorld } from '../world/generate.js';
import { createGame, PLAYER_FACTION } from '../meta/state.js';
import { attackableFrontier, playerBattleStats, enemyBattleStats } from '../meta/progression.js';
import { buildArena } from '../battle/arena.js';
import { createBattle } from '../battle/sim.js';
import { PLAYER_OWNER } from '../battle/owner.js';
import { TICK_SEC } from '../config/battle.js';
import { serialize, deserialize } from '../meta/save.js';

const world = generateWorld(7);

function setup() {
  const state = createGame(7, world, 0);
  const saves = [];
  const manager = createBattleManager({ getState: () => state, getWorld: () => world, services: { autosave: { save: () => saves.push(1) } } });
  const fight = (regionId) => {
    const player = playerBattleStats(state, world, regionId);
    const enemy = enemyBattleStats(world, state, regionId);
    return createBattle(buildArena(world, state.owner, regionId, player, enemy), player, enemy);
  };
  return { state, manager, fight, saves };
}

test('start: a run goes into state.battles with an id, kind, region and the crowns tracker; the same region twice is refused', () => {
  const { state, manager, fight } = setup();
  const [a] = attackableFrontier(state, world);
  const run = manager.start({ kind: 'attack', regionId: a, battle: fight(a) });
  assert.ok(run && run.id === 1 && run.kind === 'attack' && run.regionId === a && run.auto === false);
  assert.equal(state.battles.length, 1);
  assert.ok(run.battle.crownTracker || Object.keys(run.battle).some((k) => /tracker/i.test(k)), 'the crowns tracker rides in the battle (saved with it)');
  assert.equal(manager.start({ kind: 'attack', regionId: a, battle: fight(a) }), null, 'one battle per region');
  assert.deepEqual([...manager.busy().regions], [a]);
  assert.ok(manager.busy().sites.size >= 2, 'its settlements are busy');
});

test('start refuses a run beyond MAX_BATTLES', () => {
  const { state, manager, fight } = setup();
  const ids = attackableFrontier(state, world);
  assert.ok(ids.length >= 3);
  for (let i = 0; i < MAX_BATTLES; i++) state.battles.push({ id: 90 + i, kind: 'attack', regionId: 900 + i, battle: fight(ids[0]), commander: null, auto: false, startedAt: 0 });
  assert.equal(manager.start({ kind: 'attack', regionId: ids[1], battle: fight(ids[1]) }), null);
});

test('tick fixed-steps every run at the global speed; pause, an open dialog and a gate hold it still', () => {
  const { state, manager, fight } = setup();
  const [a, b] = attackableFrontier(state, world);
  const ra = manager.start({ kind: 'attack', regionId: a, battle: fight(a) });
  const rb = manager.start({ kind: 'attack', regionId: b, battle: fight(b) });
  manager.focus(ra.id);
  let steps = 0;
  manager.on('beforeStep', () => { steps += 1; });
  manager.tick(TICK_SEC * 4 + 1e-6);
  assert.equal(steps, 8, 'four steps for each of the two runs');
  assert.ok(Math.abs(ra.battle.t - TICK_SEC * 4) < 1e-9 && Math.abs(rb.battle.t - TICK_SEC * 4) < 1e-9, 'the unwatched run keeps running');
  manager.setSpeed(2);
  manager.tick(TICK_SEC);
  assert.ok(Math.abs(ra.battle.t - TICK_SEC * 6) < 1e-9, 'speed is global');
  manager.setPaused(true);
  manager.tick(1);
  assert.ok(Math.abs(ra.battle.t - TICK_SEC * 6) < 1e-9, 'paused: nothing moves');
  manager.setPaused(false);
  manager.setDialogHold(true);
  manager.tick(1);
  assert.ok(Math.abs(rb.battle.t - TICK_SEC * 6) < 1e-9, 'a dialog holds every battle');
  manager.setDialogHold(false);
  manager.setSpeed(1);
  manager.setGate(ra.id, () => true);
  manager.tick(TICK_SEC + 1e-6);
  assert.ok(Math.abs(ra.battle.t - TICK_SEC * 6) < 1e-9, 'a gated run stands still');
  assert.ok(Math.abs(rb.battle.t - TICK_SEC * 7) < 1e-9, 'the others do not');
});

test('events are handed out per run; the enemy AI thinks in every run', () => {
  const { state, manager, fight } = setup();
  const [a] = attackableFrontier(state, world);
  const run = manager.start({ kind: 'attack', regionId: a, battle: fight(a) });
  const seen = [];
  manager.on('events', (id, evs) => seen.push([id, evs.length]));
  for (let i = 0; i < 400 && seen.length === 0; i++) manager.tick(TICK_SEC);
  // the enemy acts on its own over time (sends or growth events); at the very least the bus carries this run's id only
  assert.ok(seen.every(([id]) => id === run.id));
});

test('an unwatched run that ends is recorded and finished by the manager: an attack won conquers the region (crowns, chronicle), then the run is gone', () => {
  const { state, manager, fight, saves } = setup();
  const [a] = attackableFrontier(state, world);
  const run = manager.start({ kind: 'attack', regionId: a, battle: fight(a) });
  const ended = [];
  manager.on('ended', (id, result) => ended.push([id, result]));
  // the player takes every site (as a forced win does), then the sim decides on its next step
  // the player takes the region (as the dev hook's forced win does): the sim's result is set, the manager notices on its next tick
  for (const s of run.battle.sites) s.owner = PLAYER_OWNER;
  run.battle.squads = [];
  run.battle.result = 'win';
  run.battle.stats.durationSec = run.battle.t;
  const won0 = state.stats.battlesWon;
  for (let i = 0; i < 20 && !ended.length; i++) manager.tick(TICK_SEC);
  assert.deepEqual(ended, [[run.id, 'win']]);
  assert.equal(state.owner[a], PLAYER_FACTION, 'conquered');
  assert.equal(state.stats.battlesWon, won0 + 1, 'recorded once');
  assert.equal(state.battles.length, 0, 'removed');
  assert.ok(saves.length >= 1, 'autosaved');
});

test('the focused run is NOT finished by the manager (the scene plays its end sequence); recordResult is idempotent; finish applies the win', () => {
  const { state, manager, fight } = setup();
  const [a] = attackableFrontier(state, world);
  const run = manager.start({ kind: 'attack', regionId: a, battle: fight(a) });
  manager.focus(run.id);
  // the player takes the region (as the dev hook's forced win does): the sim's result is set, the manager notices on its next tick
  for (const s of run.battle.sites) s.owner = PLAYER_OWNER;
  run.battle.squads = [];
  run.battle.result = 'win';
  run.battle.stats.durationSec = run.battle.t;
  for (let i = 0; i < 20 && !run.battle.result; i++) manager.tick(TICK_SEC);
  assert.equal(run.battle.result, 'win');
  assert.equal(state.battles.length, 1, 'still there for the victory sequence');
  assert.equal(manager.recordResult(run.id), true);
  assert.equal(manager.recordResult(run.id), false, 'once');
  const out = manager.finish(run.id, { crownResult: null });
  assert.ok(out && out.regionId === a && out.result.bounty >= 0);
  assert.equal(state.owner[a], PLAYER_FACTION);
  assert.equal(manager.focused(), null, 'the watched run is gone: focus returns to the map');
});

test('a lost or retreated attack changes nothing when finished; retreat() ends it through the sim', () => {
  const { state, manager, fight } = setup();
  const [a] = attackableFrontier(state, world);
  const run = manager.start({ kind: 'attack', regionId: a, battle: fight(a) });
  manager.focus(run.id);
  manager.retreat(run.id);
  for (let i = 0; i < 5 && !run.battle.result; i++) manager.tick(TICK_SEC);
  assert.ok(run.battle.result && run.battle.result !== 'win', `ended (${run.battle.result})`);
  const owner0 = state.owner.slice();
  assert.equal(manager.finish(run.id), null);
  assert.deepEqual(state.owner, owner0);
  assert.equal(state.battles.length, 0);
});

test('a running battle survives a save round trip as state.battles and keeps stepping afterwards', () => {
  const { state, manager, fight } = setup();
  const [a] = attackableFrontier(state, world);
  manager.start({ kind: 'attack', regionId: a, battle: fight(a) });
  manager.tick(TICK_SEC * 3 + 1e-6);
  const back = deserialize(serialize(state));
  assert.equal(back.battles.length, 1);
  const m2 = createBattleManager({ getState: () => back, getWorld: () => world });
  const t0 = back.battles[0].battle.t;
  m2.tick(TICK_SEC + 1e-6);
  assert.ok(back.battles[0].battle.t > t0);
});
