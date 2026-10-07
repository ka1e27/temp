// PLAN-PHASE14 §14A (late-game pacing): the levers that took the late walls down, pinned.
//   - the player bot keeps attacking while Supply Wagons' lines run (supply squads are not squads it manages; re-pointing a line is not a look)
//   - the tools' patience stops growing at PATIENCE_MAX_SEC (the Throne keeps its own)
//   - a Holy Ground garrison starts no higher than the card counts it (FEATURES.holy.startCap x its cap)
//   - the Throne's card factor (THRONE.card.factor) is the measured 0.25
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle } from '../battle/sim.js';
import { decide } from '../battle/bot.js';
import { patienceFor, PATIENCE_SEC, PATIENCE_MAX_SEC, SITE_TYPES } from '../config/battle.js';
import { THRONE } from '../config/crown.js';
import { FEATURES } from '../config/features.js';
import { DIFFICULTY } from '../config/meta.js';
import { generateWorld } from '../world/generate.js';
import { createGame } from '../meta/state.js';
import { enemyBattleStats, playerBattleStats } from '../meta/progression.js';
import { buildArena } from '../battle/arena.js';

function lineArena(length, specs) {
  const tiles = [];
  for (let q = 0; q < length; q++) tiles.push({ i: q, q, r: 0, x: Math.sqrt(3) * q, y: 0, cost: 1, terrain: 'grass', region: 1 });
  const sites = specs.map((s, id) => ({ id, settlement: id === 0 && s.type === 'camp' ? -1 : id, tile: s.at, type: s.type, owner: s.owner, troops: s.troops }));
  return { regionId: 1, enemyFaction: 2, tiles, sites, focus: { minX: 0, maxX: Math.sqrt(3) * length, minY: 0, maxY: 0 } };
}
const PLAYER = { atk: 1, def: 1, growth: 0, speed: 1, campTroops: 30, garrisonShare: 0.05, capBonus: 0, cooldownMult: 1, powers: { rally: 0, firestorm: 0, bulwark: 0, march: 0, levy: 0 } };
const ENEMY = { atk: 1, def: 1, growth: 0, speed: 1, troopMult: 1, thinkSec: 2, graceSec: 0, personality: 'passive', factionId: 2 };
const sendsTo = (cmds, battle, owner) => cmds.filter((c) => c.type === 'send' && battle.sites[c.to].owner === owner);

test('the bot attacks in the same look that sets up supply lines (Supply Wagons\' overflow habit)', () => {
  const battle = createBattle(lineArena(10, [
    { type: 'camp', owner: 0, troops: 90, at: 0 },
    { type: 'village', owner: 0, troops: 200, at: 2 },
    { type: 'village', owner: 0, troops: 200, at: 3 },
    { type: 'keep', owner: 2, troops: 5, at: 9 },
  ]), PLAYER, ENEMY);
  const cmds = decide(battle, 0, { supply: 'overflow' });
  assert.ok(cmds.some((c) => c.type === 'supply'), 'full sites are lined to the hub');
  assert.ok(sendsTo(cmds, battle, 2).length > 0, 'and the keep is attacked in the same look');
});

test('supply-line squads (squad.auto) do not fill the bot\'s hands; its own squads still cap at 14', () => {
  const make = (auto) => {
    const battle = createBattle(lineArena(10, [
      { type: 'camp', owner: 0, troops: 90, at: 0 },
      { type: 'village', owner: 0, troops: 20, at: 3 },
      { type: 'keep', owner: 2, troops: 5, at: 9 },
    ]), PLAYER, ENEMY);
    for (let i = 0; i < 14; i++) {
      battle.squads.push({ id: 100 + i, owner: 0, count: 3, from: 1, to: 0, path: [3, 2, 1, 0], seg: 0, prog: 0, state: 'march', foe: null, ...(auto ? { auto: true } : {}) });
    }
    return sendsTo(decide(battle, 0, {}), battle, 2).length;
  };
  assert.ok(make(true) > 0, 'with 14 supply squads on the road the bot still attacks');
  assert.equal(make(false), 0, 'with 14 squads of its own it does not launch a 15th');
});

test('patience grows with the dynasty up to PATIENCE_MAX_SEC; dynasty 1 and the Throne are unchanged', () => {
  const mid = { tier: 4, isCapital: false };
  const cap = { tier: 5, isCapital: true };
  const early = { tier: 1, isCapital: false };
  assert.equal(patienceFor(early, 1), PATIENCE_SEC.early);
  assert.equal(patienceFor(mid, 1), PATIENCE_SEC.mid);
  assert.equal(patienceFor(cap, 1), PATIENCE_SEC.capital);
  assert.equal(patienceFor(early, 2), 2 * PATIENCE_SEC.early);
  for (let d = 1; d <= 9; d++) for (const r of [early, mid, cap]) assert.ok(patienceFor(r, d) <= PATIENCE_MAX_SEC);
  assert.equal(patienceFor(cap, 7), PATIENCE_MAX_SEC);
  assert.equal(patienceFor({ tier: 4, isCapital: true, throne: true }, 7), THRONE.patienceSec);
  assert.equal(PATIENCE_MAX_SEC, 600);
});

test('a Holy Ground garrison starts at no more than startCap x its cap (the card\'s over-cap credit); other regions are untouched', () => {
  assert.equal(FEATURES.holy.startCap, DIFFICULTY.overCapCredit, 'the card counts exactly this much, so it reads the same');
  let found = null;
  for (let seed = 1; seed <= 40 && !found; seed++) {
    const world = generateWorld(seed);
    const holy = world.regions.find((r) => r.twist === 'holy' && r.tier >= 3);
    if (holy) found = { seed, world, holy };
  }
  assert.ok(found, 'some seed has a Holy Ground region beyond the first rings');
  const { seed, world, holy } = found;
  const state = createGame(seed, world, 0);
  state.dynasty.level = 5; // big late garrisons, far over their caps
  for (const r of world.regions) if (r.id !== holy.id && r.faction !== holy.faction) state.owner[r.id] = 0;
  for (const n of holy.neighbors) state.owner[n] = 0;
  const enemy = enemyBattleStats(world, state, holy.id);
  assert.equal(enemy.startCapCredit, FEATURES.holy.startCap);
  const plain = world.regions.find((r) => !r.twist && r.tier >= 3 && r.faction > 1);
  if (plain) assert.equal(enemyBattleStats(world, state, plain.id).startCapCredit, undefined);
  const arena = buildArena(world, state.owner, holy.id, playerBattleStats(state, world, holy.id), enemy);
  const foes = arena.sites.filter((s) => s.owner !== 0 && s.owner !== 1 && SITE_TYPES[s.type]);
  assert.ok(foes.length > 0);
  for (const s of foes) assert.ok(s.troops <= FEATURES.holy.startCap * SITE_TYPES[s.type].cap * s.capMult + 1e-9, `${s.type} starts at ${s.troops}`);
});

test('the Throne card factor is the Phase 14 measurement', () => {
  assert.equal(THRONE.card.factor, 0.25);
});
