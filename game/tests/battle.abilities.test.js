// A General's actives and passives in the sim (DESIGN §10.11): the `ability` command (Shield Wall, Charge, Foresight, Raid, Pay the
// Bonus), once per battle, deterministic and saved in the battle JSON; the Marshal's and Champion's passives in combat; the steward
// a General makes, by level.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, step, issue, abilityState, abilityAdvice } from '../battle/sim.js';
import { stewardDecide, stewardStyle } from '../battle/steward.js';
import { think } from '../battle/ai.js';
import { garrisonPerTroopStrength, squadPerTroopStrength } from '../battle/combat.js';
import { STEWARD } from '../config/frontier.js';
import { GENERALS } from '../config/generals.js';
import { POWERS } from '../config/battle.js';

const SQ3 = Math.sqrt(3);
const POW = Object.freeze({ rally: 0, firestorm: 0, bulwark: 0, march: 0, levy: 0 });
const BASE = Object.freeze({ atk: 1, def: 1, growth: 0, speed: 1, campTroops: 40, garrisonShare: 0.35, capBonus: 0, cooldownMult: 1, powers: POW });
const ENEMY = Object.freeze({ atk: 1, def: 1, growth: 0, speed: 1, troopMult: 1, thinkSec: 1, graceSec: 999, personality: 'aggressive', factionId: 2 });
const withAbility = (ability, extra = {}) => ({ ...BASE, ability, ...extra });

function line(sites, length = 12) {
  const tiles = [];
  for (let q = 0; q < length; q++) {
    const t = { i: q, q, r: 0, x: q * SQ3, y: 0, cost: 1, terrain: 'grass', region: q < 2 ? 1 : 0 };
    if (q < 2) t.own = 0;
    tiles.push(t);
  }
  return { regionId: 0, enemyFaction: 2, tiles, sites: sites.map(([tile, type, owner, troops], id) => ({ id, settlement: id - 1, tile, type, owner, troops })),
    focus: { minX: 0, maxX: (length - 1) * SQ3, minY: 0, maxY: 0 }, marches: [] };
}
const run = (b, sec) => { const end = b.t + sec; while (!b.result && b.t < end - 1e-9) step(b, 0.05); };
const SITES = [[0, 'camp', 0, 40], [5, 'village', 2, 10], [11, 'keep', 2, 40]];

test('ability state and once-per-battle: a second use and the wrong ability do nothing', () => {
  const none = createBattle(line(SITES), BASE, ENEMY);
  assert.equal(abilityState(none), null);
  const b = createBattle(line(SITES), withAbility({ id: 'bonus', share: 0.2 }), ENEMY);
  assert.deepEqual(abilityState(b), { id: 'bonus', used: false, ready: true, needsTarget: false, uses: 1, left: 1 });
  issue(b, { type: 'ability', owner: 0, ability: 'charge' });
  step(b, 0.05);
  assert.equal(b.abilityUsed, undefined, 'the wrong ability is ignored');
  issue(b, { type: 'ability', owner: 0, ability: 'bonus' });
  step(b, 0.05);
  assert.ok(Math.abs(b.sites[0].troops - 48) < 1e-9, 'Pay the Bonus: +20% troops at the camp');
  assert.equal(b.events.find((e) => e.type === 'ability').ability, 'bonus');
  issue(b, { type: 'ability', owner: 0, ability: 'bonus' });
  step(b, 0.05);
  assert.ok(Math.abs(b.sites[0].troops - 48) < 1e-9, 'once per battle');
  assert.equal(abilityState(b).ready, false);
  assert.equal(JSON.parse(JSON.stringify(b)).abilityUsed, true, 'saved with the battle');
});

test('Warrior Kings (PLAN-PHASE5): an ability with uses 2 fires twice, then never again', () => {
  const b = createBattle(line(SITES), withAbility({ id: 'bonus', share: 0.5, uses: 2 }), ENEMY);
  assert.deepEqual(abilityState(b), { id: 'bonus', used: false, ready: true, needsTarget: false, uses: 2, left: 2 });
  const seen = [];
  for (let i = 0; i < 3; i++) { issue(b, { type: 'ability', owner: 0, ability: 'bonus' }); step(b, 0.05); seen.push(+b.sites[0].troops.toFixed(3)); }
  assert.equal(b.abilityCount, 2, JSON.stringify(seen));
  assert.ok(Math.abs(b.sites[0].troops - 90) < 1e-6, `40 x1.5 x1.5 = 90 (got ${JSON.stringify(seen)})`);
  assert.equal(abilityState(b).ready, false);
  assert.equal(abilityState(b).used, true);
});

test('Shield Wall: Bulwark on every settlement you hold, with heal and levy skills', () => {
  const sites = [[0, 'camp', 0, 40], [3, 'village', 0, 20], [11, 'keep', 2, 40]];
  const b = createBattle(line(sites), withAbility({ id: 'shieldWall', duration: 8, heal: 0.1, levy: 5 }), ENEMY);
  issue(b, { type: 'ability', owner: 0, ability: 'shieldWall' });
  step(b, 0.05);
  assert.equal(b.sites[0].bulwarkUntil, 8);
  assert.equal(b.sites[1].bulwarkUntil, 8);
  assert.equal(b.sites[2].bulwarkUntil, 0, 'not the enemy\'s');
  assert.ok(Math.abs(b.sites[1].troops - (20 * 1.1 + 5)) < 1e-9);
  assert.deepEqual(b.events.find((e) => e.type === 'ability').sites, [0, 1]);
  assert.ok(garrisonPerTroopStrength(b.sites[1], 0, b.player, 2, b.enemy, 1) === POWERS.bulwark.mult);
});

test('Charge: the next N squads march faster and hit harder, then it is spent', () => {
  const a = createBattle(line(SITES), withAbility({ id: 'charge', squads: 1, speed: 0.5, strength: 0.3 }), ENEMY);
  const plain = createBattle(line(SITES), BASE, ENEMY);
  issue(a, { type: 'ability', owner: 0, ability: 'charge' });
  step(a, 0.05);
  for (const b of [a, plain]) issue(b, { type: 'send', owner: 0, from: [0], to: 1, fraction: 0.2 }); // 8 troops vs 10 at the village
  step(a, 0.05); step(plain, 0.05);
  const sq = a.squads[0];
  assert.equal(sq.power, 1.3);
  assert.equal(sq.speedMult, 1.5);
  assert.equal(a.effects.chargeLeft, 0);
  run(a, 10); run(plain, 10);
  assert.equal(a.sites[1].owner, 0, 'the charge takes the village with 8 against 10 (8 x 1.3 > 10)');
  assert.equal(plain.sites[1].owner, 2, 'without it, 8 against 10 fails');
  issue(a, { type: 'send', owner: 0, from: [0], to: 2, fraction: 0.1 });
  step(a, 0.05);
  assert.equal(a.squads.find((q) => q.to === 2).power, undefined, 'only the next N');
});

test('Foresight slows enemy squads for its duration and reveals targets', () => {
  const sites = [[0, 'camp', 0, 40], [11, 'keep', 2, 60]];
  const b = createBattle(line(sites), withAbility({ id: 'foresight', duration: 8, slow: 0.3 }), { ...ENEMY, graceSec: 0 });
  const c = createBattle(line(sites), BASE, { ...ENEMY, graceSec: 0 });
  issue(b, { type: 'ability', owner: 0, ability: 'foresight' });
  step(b, 0.05);
  assert.equal(b.effects.slowUntil, 8, 'applied at the start of the step, t = 0');
  assert.equal(b.effects.revealUntil, b.effects.slowUntil);
  for (const x of [b, c]) issue(x, { type: 'send', owner: 2, from: [1], to: 0, fraction: 0.5 });
  step(b, 0.05); step(c, 0.05);
  for (let i = 0; i < 40; i++) { step(b, 0.05); step(c, 0.05); }
  const pb = b.squads[0].seg + b.squads[0].prog;
  const pc = c.squads[0].seg + c.squads[0].prog;
  assert.ok(Math.abs(pb / pc - 0.7) < 0.05, `slowed to 70% (${(pb / pc).toFixed(3)})`);
});

test('Raid: free squads from your strongest reachable site; needs a target; can ride through arrows', () => {
  const sites = [[0, 'camp', 0, 40], [5, 'tower', 2, 2], [11, 'keep', 2, 40]];
  const b = createBattle(line(sites), withAbility({ id: 'raid', share: 0.15, squads: 2, noArrows: true }), ENEMY);
  issue(b, { type: 'ability', owner: 0, ability: 'raid' });
  step(b, 0.05);
  assert.equal(b.abilityUsed, undefined, 'no target: nothing happens');
  issue(b, { type: 'ability', owner: 0, ability: 'raid', target: 1 });
  step(b, 0.05);
  const raiders = b.squads.filter((q) => q.owner === 0);
  assert.equal(raiders.length, 2);
  assert.ok(raiders.every((q) => q.count === 6 && q.noArrows && q.to === 1));
  assert.equal(b.sites[0].troops, 40, 'free: the camp keeps its troops');
  run(b, 15);
  assert.ok(!b.events.some((e) => e.type === 'arrow'), 'arrows are not loosed at them');
  assert.equal(b.sites[1].owner, 0);
  const keepFar = createBattle(line(sites), withAbility({ id: 'raid', share: 0.15, squads: 1 }), ENEMY);
  issue(keepFar, { type: 'ability', owner: 0, ability: 'raid', target: 2 });
  step(keepFar, 0.05);
  assert.equal(keepFar.abilityUsed, undefined, 'a target with no route is refused, and the ability stays');
  assert.ok(keepFar.events.some((e) => e.type === 'refused'));
});

test('passives in combat: the Marshal\'s garrisons and the Champion\'s assaults', () => {
  const site = { type: 'village', bulwarkUntil: 0 };
  assert.equal(garrisonPerTroopStrength(site, 0, { ...BASE, garrisonMult: 1.15 }, 2, ENEMY, 0), 1.15);
  assert.equal(garrisonPerTroopStrength(site, 2, { ...BASE, garrisonMult: 1.15 }, 2, ENEMY, 0), 1, 'only the player\'s');
  assert.equal(squadPerTroopStrength(0, { ...BASE, assaultMult: 1.15 }, 2, ENEMY, false), 1.15);
  assert.equal(squadPerTroopStrength(0, { ...BASE, assaultMult: 1.15 }, 2, ENEMY, true), 1, 'not in field clashes');
});

test('abilityAdvice: the Bonus at once; Raid waits for the opening; nothing without an ability', () => {
  assert.equal(abilityAdvice(createBattle(line(SITES), BASE, ENEMY), 0), null);
  assert.equal(abilityAdvice(createBattle(line(SITES), withAbility({ id: 'bonus', share: 0.2 }), ENEMY), 0).ability, 'bonus');
  const r = createBattle(line(SITES), withAbility({ id: 'raid', share: 0.15, squads: 1 }), ENEMY);
  assert.equal(abilityAdvice(r, 2), null);
  assert.equal(abilityAdvice(r, 50).target, 1);
});

test('determinism: the same commands with abilities replay identically', () => {
  const play = () => {
    const b = createBattle(line(SITES), withAbility({ id: 'charge', squads: 3, speed: 0.5, strength: 0.3 }, { growth: 1 }), { ...ENEMY, growth: 1, graceSec: 0 });
    const memo = {};
    while (!b.result && b.t < 120) {
      for (const c of think(b, b.t)) issue(b, c);
      for (const c of stewardDecide(b, b.t, memo, { style: 'bold', level: 5, skills: [] })) issue(b, c);
      step(b, 0.05);
    }
    return JSON.stringify(b);
  };
  assert.equal(play(), play());
});

test('the steward a General makes: faster and further-sighted with level, skills applied, better than the Captain at level 1', () => {
  const l1 = stewardStyle({ style: 'stalwart', level: 1, skills: [] });
  const l10 = stewardStyle({ style: 'stalwart', level: 10, skills: [] });
  assert.equal(l1.thinkSec, GENERALS.steward.atLevel1.thinkSec);
  assert.equal(l10.lookahead, GENERALS.steward.atLevel10.lookahead);
  assert.ok(l1.thinkSec < STEWARD.captain.thinkSec && l1.lookahead >= STEWARD.captain.lookahead);
  assert.ok(l10.thinkSec < l1.thinkSec && l10.lookahead > l1.lookahead);
  assert.equal(l1.useAbility, true);
  const skilled = stewardStyle({ style: 'bold', level: 4, skills: ['counter13', 'thinkFast', 'usesFirestorm'] });
  assert.equal(skilled.retake, GENERALS.skillValues.counter13);
  assert.ok(skilled.thinkSec < stewardStyle({ style: 'bold', level: 4, skills: [] }).thinkSec);
  assert.ok(stewardStyle({ style: 'stalwart', level: 1, skills: [] }).consolidate === false, 'tactics come with level');
  assert.ok(stewardStyle({ style: 'cunning', level: 1, skills: ['usesFirestorm'] }).powers.filter((p) => p === 'firestorm').length === 1, 'never twice');
  assert.equal(stewardStyle('captain'), STEWARD.captain, 'style names still work');
});
