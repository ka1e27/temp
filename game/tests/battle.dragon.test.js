// The Dragon (DESIGN §10.13): perches on an enemy site (which defends harder), flies between them, breathes telegraphed fire at
// the player's strongest point (Bulwark cuts it), takes damage from assaults on its perch, and its fall is the region's surrender;
// the keep alone does not win a Lair. Deterministic and saved with the battle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, step, issue } from '../battle/sim.js';
import { FEATURES } from '../config/features.js';
import { think } from '../battle/ai.js';
import { decide } from '../battle/bot.js';

const SQ3 = Math.sqrt(3);
const D = FEATURES.dragon;
const POW = Object.freeze({ rally: 0, firestorm: 0, bulwark: 1, march: 0, levy: 0 });
const P = Object.freeze({ atk: 1, def: 1, growth: 0, speed: 1, campTroops: 40, garrisonShare: 0.35, capBonus: 0, cooldownMult: 1, powers: POW });
const E = Object.freeze({ atk: 1, def: 1, growth: 0, speed: 1, troopMult: 1, thinkSec: 1, graceSec: 999, personality: 'aggressive', factionId: 2 });

function lair(sites, hp = 200, length = 14) {
  const tiles = [];
  for (let q = 0; q < length; q++) {
    const t = { i: q, q, r: 0, x: q * SQ3, y: 0, cost: 1, terrain: 'grass', region: q < 2 ? 1 : 0 };
    if (q < 2) t.own = 0;
    tiles.push(t);
  }
  return {
    regionId: 0, enemyFaction: 2, tiles, type: 'dragon', dragon: { hp },
    sites: sites.map(([tile, type, owner, troops], id) => ({ id, settlement: id - 1, tile, type, owner, troops })),
    focus: { minX: 0, maxX: (length - 1) * SQ3, minY: 0, maxY: 0 }, marches: [],
  };
}
const run = (b, sec) => { const end = b.t + sec; while (!b.result && b.t < end - 1e-9) step(b, 0.05); };

test('it starts on the keep, which defends harder while it perches', () => {
  const b = createBattle(lair([[0, 'camp', 0, 40], [7, 'village', 2, 10], [13, 'keep', 2, 40]]), P, E);
  assert.deepEqual({ hp: b.dragon.hp, perch: b.dragon.perch }, { hp: 200, perch: 2 });
  step(b, 0.05);
  assert.equal(b.sites[2].dragonDef, D.perchDef);
  assert.deepEqual(JSON.parse(JSON.stringify(b)).dragon.perch, 2, 'plain JSON, saved with the battle');
});

test('breath: telegraphed, then burns the player\'s strongest point in range; a Bulwarked site takes only part', () => {
  const sites = [[0, 'camp', 0, 40], [8, 'village', 0, 60], [11, 'keep', 2, 40]];
  const b = createBattle(lair(sites), P, E);
  let tele = null;
  let breath = null;
  while (!breath && b.t < D.breathSec * 2) {
    step(b, 0.05);
    for (const e of b.events) {
      if (e.type === 'dragonTelegraph' && !tele) tele = { ...e, t: b.t };
      if (e.type === 'dragonBreath') breath = { ...e, t: b.t };
    }
  }
  assert.ok(tele && breath, 'a telegraph, then the breath');
  assert.equal(tele.target, 1, 'the strongest point in range: the 60-troop village');
  assert.ok(Math.abs(breath.t - tele.t - D.telegraphSec) < 0.06);
  assert.ok(Math.abs(b.sites[1].troops - (60 - (60 * D.breathShare + D.breathDamage))) < 1e-6);
  // with Bulwark on the target at the telegraph
  const c = createBattle(lair(sites), P, E);
  let done = false;
  while (!done && c.t < D.breathSec * 2) {
    step(c, 0.05);
    for (const e of c.events) {
      if (e.type === 'dragonTelegraph') issue(c, { type: 'power', owner: 0, power: 'bulwark', target: e.target });
      if (e.type === 'dragonBreath') done = true;
    }
  }
  assert.ok(Math.abs(c.sites[1].troops - (60 - (60 * D.breathShare + D.breathDamage) * D.bulwarkCut)) < 1e-6);
});

test('it flies to another enemy site when its perch falls, and on its own every flySec', () => {
  const b = createBattle(lair([[0, 'camp', 0, 40], [6, 'village', 2, 10], [13, 'keep', 2, 40]]), P, E);
  b.dragon.perch = 1;
  b.sites[1].owner = 0; // its perch is taken
  step(b, 0.05);
  assert.ok(b.dragon.flight && b.dragon.flight.to === 2);
  assert.ok(b.events.some((e) => e.type === 'dragonFly'));
  run(b, D.flightSec + 0.1);
  assert.equal(b.dragon.perch, 2);
  const c = createBattle(lair([[0, 'camp', 0, 40], [6, 'village', 2, 10], [13, 'keep', 2, 40]]), P, E);
  let flew = false;
  while (!flew && c.t < D.flySec + 5) { step(c, 0.05); flew = c.events.some((e) => e.type === 'dragonFly'); }
  assert.ok(flew && Math.abs(c.t - D.flySec) < D.breathSec, 'it changes perch on its own');
});

test('assaults on its perch wound it; its fall wins the battle and the region surrenders; the keep alone does not', () => {
  const b = createBattle(lair([[0, 'camp', 0, 300], [13, 'keep', 2, 30]], 40), P, E);
  issue(b, { type: 'send', owner: 0, from: [0], to: 1, fraction: 0.3 }); // 90 troops on the perched keep (30 x 1.6 x 1.4 = 67)
  run(b, 25);
  assert.ok(b.events.length >= 0);
  assert.equal(b.result, 'win');
  assert.ok(b.dragon.dead);
  const keepOnly = createBattle(lair([[0, 'camp', 0, 300], [6, 'village', 2, 10], [13, 'keep', 2, 5]], 1e9), P, E);
  keepOnly.dragon.perch = 1;
  keepOnly.sites[2].owner = 0; // the keep is taken by force of arms...
  step(keepOnly, 0.05);
  assert.equal(keepOnly.result, null, '...but the Dragon still holds the Lair');
});

test('with nowhere left to perch it is driven off and the region surrenders', () => {
  const b = createBattle(lair([[0, 'camp', 0, 40], [13, 'keep', 2, 40]], 1e9), P, E);
  b.sites[1].owner = 0;
  run(b, 1);
  assert.equal(b.result, 'win');
});

test('deterministic with the AI and the bot', () => {
  const play = () => {
    const b = createBattle(lair([[0, 'camp', 0, 120], [5, 'village', 2, 20], [9, 'village', 2, 20], [13, 'keep', 2, 60]], 300), { ...P, growth: 1 }, { ...E, growth: 1, graceSec: 10 });
    const memo = {};
    while (!b.result && b.t < 200) { for (const c of think(b, b.t)) issue(b, c); for (const c of decide(b, b.t, memo)) issue(b, c); step(b, 0.05); }
    return JSON.stringify(b);
  };
  assert.equal(play(), play());
});
