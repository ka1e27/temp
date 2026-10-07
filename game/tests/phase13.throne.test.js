// Phase 13: the Throne of Ages battle (battle/throne.js, throneArena.js): the arena, the three phases and their events in order, the
// borrowing's telegraphs, the Usurper's hero squad, the win rule, and a save/reload mid-fight that replays identically.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/generate.js';
import { createGame } from '../meta/state.js';
import { playerBattleStats, enemyBattleStats, difficulty } from '../meta/progression.js';
import { buildArena } from '../battle/arena.js';
import { createBattle, step, issue } from '../battle/sim.js';
import { think } from '../battle/ai.js';
import { decide } from '../battle/bot.js';
import { TICK_SEC, patienceFor } from '../config/battle.js';
import { THRONE } from '../config/crown.js';
import { throneDefMult } from '../battle/throne.js';

/** A Crown world with everything but the Throne held, and small garrisons (troopMult `tm`) so a fight is short. */
function setup(seed, tm = 6, level = 10) {
  const world = generateWorld(seed, { dynasty: 7, crownOfAges: true });
  const state = createGame(seed, world, 0);
  const th = world.crown.throne;
  for (const r of world.regions) if (r.id !== th) state.owner[r.id] = 0;
  for (const k of ['recruitment', 'steel', 'armour', 'muster']) state.upgrades[k] = level;
  const player = playerBattleStats(state, world, th);
  const enemy = { ...enemyBattleStats(world, state, th), troopMult: tm, capMult: 1, atk: 1, def: 1 };
  return { world, state, th, player, enemy, arena: buildArena(world, state.owner, th, player, enemy) };
}

function run(battle, untilSec, memo = {}, log = null) {
  while (!battle.result && battle.t < untilSec - 1e-9) {
    for (const c of think(battle, battle.t)) issue(battle, c);
    for (const c of decide(battle, battle.t, memo)) issue(battle, c);
    step(battle, TICK_SEC);
    if (log) for (const e of battle.events) log.push({ ...e, t: battle.t });
  }
  return battle;
}

test('the Throne arena: a Gate, three Champions\' posts, the borrowed Tide\'s tiles, the Usurper', () => {
  for (const seed of [1, 2, 3, 5, 8]) {
    const { arena, th, world } = setup(seed);
    const a = arena.throne;
    assert.ok(a, `seed ${seed}`);
    assert.equal(arena.regionId, th);
    assert.equal(arena.sites[a.keep].type, 'keep');
    assert.equal(arena.sites[a.gate].type, 'gate');
    assert.equal(a.champions.length, 3, `seed ${seed}: three Champions`);
    assert.deepEqual(a.champions.map((c) => c.kind), THRONE.champions.map((c) => c.kind));
    for (const c of a.champions) {
      const s = arena.sites[c.site];
      assert.ok(s.id === c.site && s.feature === 'champion' && s.throneChampion === c.kind && s.owner === 7);
      assert.equal(world.tiles[s.tile].region, th);
    }
    assert.ok(a.tide.length > 0 && a.tide.length <= THRONE.borrow.tideMaxTiles);
    assert.ok(a.usurper.troops > 0 && a.usurper.power === THRONE.usurperPower);
    arena.sites.forEach((s, i) => assert.equal(s.id, i));
  }
  // only the Throne: every other region's arena has no throne
  const { world, state } = setup(2);
  const other = world.regions.find((r) => r.faction === 7 && !r.throne);
  state.owner[other.id] = 7;
  const p = playerBattleStats(state, world, other.id);
  assert.equal(buildArena(world, state.owner, other.id, p, enemyBattleStats(world, state, other.id)).throne, undefined);
  assert.equal(difficulty(state, world, world.crown.throne).mechanic, 'throne');
  assert.equal(patienceFor(world.regions[world.crown.throne], 7), THRONE.patienceSec);
});

test('the three phases in order: Champions, the Gate, the borrowing (telegraphed), the Usurper, and the win', () => {
  let saw = 0;
  for (const seed of [1, 2, 3]) {
    const { arena, player, enemy } = setup(seed, 8);
    const b = createBattle(arena, player, enemy);
    const log = [];
    run(b, 900, {}, log);
    assert.equal(b.result, 'win', `seed ${seed}`);
    const at = (type, f = () => true) => { const e = log.find((x) => x.type === type && f(x)); return e ? e.t : Infinity; };
    assert.ok(at('thronePhase', (e) => e.phase === 2) < at('thronePhase', (e) => e.phase === 3), 'phase 2 before 3');
    assert.ok(at('thronePhase', (e) => e.phase === 3) <= at('usurperField'));
    assert.ok(at('usurperField') < at('usurperFell'));
    assert.ok(at('usurperFell') <= at('end'));
    const field = log.find((e) => e.type === 'usurperField');
    assert.ok(field.hp > 0 && field.hp === field.maxHp);
    assert.ok(log.filter((e) => e.type === 'usurperHit').every((e) => e.hp < e.maxHp));
    assert.equal(b.throne.usurper.fell, true);
    assert.equal(b.sites[arena.throne.keep].owner, 0);
    for (const e of log.filter((x) => x.type === 'throneChampion')) assert.ok(e.left >= 0 && e.left < 3 && e.name);
    // every strike was telegraphed THRONE.borrow.telegraphSec before
    for (const s of log.filter((e) => e.type === 'usurperBorrow' && e.stage === 'strike')) {
      const tel = log.filter((e) => e.type === 'usurperBorrow' && e.stage === 'telegraph' && e.kind === s.kind && e.t <= s.t + 1e-9).pop();
      assert.ok(tel && Math.abs(tel.at - s.t) < TICK_SEC + 1e-9, `${s.kind} at ${s.t} telegraphed`);
      saw += 1;
    }
  }
  assert.ok(saw >= 1, 'at least one borrow struck in these fights');
});

test('the borrowing cycles Rising, Tide, Plague every 30 s (x2/3 at Ascension 9); the Plague weakens your sites', () => {
  const { arena, player, enemy } = setup(2, 8);
  const b = createBattle(arena, player, { ...enemy, hazardIntervalMult: 2 / 3 });
  b.sites[arena.throne.gate].owner = 0; // the Gate falls at once: phase 2 from the first step
  b.sites[arena.throne.gate].troops = 5;
  const log = [];
  for (let i = 0; i < 1400 && !b.result; i++) { step(b, TICK_SEC); for (const e of b.events) log.push({ ...e, t: b.t }); }
  const strikes = log.filter((e) => e.type === 'usurperBorrow' && e.stage === 'strike');
  assert.deepEqual(strikes.slice(0, 3).map((e) => e.kind), ['rising', 'tide', 'plague']);
  assert.ok(Math.abs((strikes[1].t - strikes[0].t) - THRONE.borrow.everySec * 2 / 3) < 0.1, 'Quickening');
  assert.ok(log.some((e) => e.type === 'send' && e.rising && e.borrowed));
  assert.ok(log.some((e) => e.type === 'usurperBorrow' && e.kind === 'tide' && e.stage === 'end'));
  const mine = b.sites.find((s) => s.owner === 0);
  b.throne.borrow.plagueUntil = b.t + 5;
  assert.equal(throneDefMult(b, mine, b.t), THRONE.borrow.plagueDefMult);
  assert.equal(throneDefMult(b, mine, b.t + 6), 1);
  const fresh = createBattle(arena, player, enemy);
  assert.equal(throneDefMult(fresh, fresh.sites[arena.throne.gate], 0), 1 + 3 * THRONE.championGateDef, 'three Champions harden the Gate');
});

test('a save and reload in the middle of the Throne replays exactly (battle.throne is plain JSON)', () => {
  const { arena, player, enemy } = setup(3, 8);
  const a = createBattle(arena, player, enemy);
  const memoA = {};
  run(a, 30, memoA);
  const mid = JSON.parse(JSON.stringify(a));
  const memoB = JSON.parse(JSON.stringify(memoA));
  run(a, 400, memoA);
  run(mid, 400, memoB);
  assert.equal(JSON.stringify(mid.throne), JSON.stringify(a.throne));
  assert.equal(mid.result, a.result);
  assert.equal(mid.t, a.t);
});

test('the keep alone does not win while the Usurper stands; he marches on it', () => {
  const { arena, player, enemy } = setup(1, 8);
  const b = createBattle(arena, player, enemy);
  const keep = b.sites[arena.throne.keep];
  b.sites[arena.throne.gate].owner = 0;
  b.throne.phase = 2;
  keep.owner = 0; // the player holds the keep before he ever took the field
  keep.troops = 40;
  const log = [];
  for (let i = 0; i < 40 && !b.result; i++) { step(b, TICK_SEC); for (const e of b.events) log.push(e); }
  assert.equal(b.result, null);
  assert.ok(log.some((e) => e.type === 'usurperField'), 'he takes the field');
  const sq = b.squads.find((s) => s.usurper);
  if (sq) assert.equal(b.sites[sq.to].owner, 0, 'and marches on a site of yours');
});
