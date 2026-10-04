// Generals (DESIGN §10.8, §10.11): the roster (Marshal, champions on toppled capitals, mercenaries), XP and levels, skill picks,
// wounds, assignment, passives folded into the battle's stats, persistence across dynasties, panel data and sanitising.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/generate.js';
import { createGame } from '../meta/state.js';
import { playerBattleStats, conquer, foundDynasty } from '../meta/progression.js';
import {
  ensureGenerals, generalById, recruitChampion, addXp, xpToNext, pendingPicks, pickSkill, nextPickOptions, skillIds, clearSkills,
  isWounded, commanderEffects, commanderStyle, abilityOf, passiveOf, sanitizeGenerals, freeGenerals, bestFreeGeneral,
  nearestFreeGeneral, assign, settleCommander, generalsPanelData, busyGeneralIds, addMercenary, skillText,
} from '../meta/generals.js';
import { GENERALS, CHAMPION_OF_FACTION } from '../config/generals.js';
import { renownPoints } from '../meta/renownState.js';
import { RENOWN } from '../config/renown.js';

const world = generateWorld(5);
const fresh = (seed = 5) => {
  const s = createGame(seed, world, 0);
  ensureGenerals(s);
  return s;
};

test('roster: the Marshal from the start with a seeded name; deterministic per seed', () => {
  const a = fresh();
  const b = fresh();
  assert.equal(a.generals.roster.length, 1);
  const m = a.generals.roster[0];
  assert.equal(m.id, 'marshal');
  assert.equal(m.kind, 'marshal');
  assert.equal(m.style, 'stalwart');
  assert.equal(m.level, 1);
  assert.ok(m.name.startsWith('Marshal '));
  assert.equal(b.generals.roster[0].name, m.name);
  assert.ok(GENERALS.names.marshal.some((n) => m.name.endsWith(n)));
});

test('champions join when their faction\'s capital falls, once ever; capitals pay Renown; Free Folk have none', () => {
  const s = fresh();
  const cap = world.regions.find((r) => r.isCapital && CHAMPION_OF_FACTION[r.faction]);
  for (const r of world.regions) if (r.neighbors.includes(cap.id)) s.owner[r.id] = 0;
  const before = renownPoints(s);
  const res = conquer(s, world, cap.id, 1000);
  assert.equal(res.recruited, `champion:${cap.faction}`);
  assert.equal(renownPoints(s) - before, RENOWN.earn.capital);
  const g = generalById(s, res.recruited);
  assert.equal(g.kind, CHAMPION_OF_FACTION[cap.faction]);
  assert.equal(g.style, GENERALS.kinds[g.kind].style);
  assert.equal(recruitChampion(s, cap.faction), null, 'once');
  assert.equal(recruitChampion(s, 1), null, 'Free Folk have no champion');
});

test('XP and levels: 100 a win, 80 a defense won, 40 a loss; xp to next = xpPerLevel x level; capped at 10', () => {
  const g = fresh().generals.roster[0];
  const per = GENERALS.xpPerLevel;
  assert.deepEqual(addXp(g, 'win'), { xp: 100, levels: 0, level: 1 });
  addXp(g, 'defenseWon');
  addXp(g, 'loss');
  assert.equal(g.xp, 220);
  addXp(g, 'loss');
  assert.equal(g.level, 2);
  assert.equal(g.xp, 260 - per);
  assert.equal(xpToNext(2), 2 * per);
  for (let i = 0; i < 300; i++) addXp(g, 'win');
  assert.equal(g.level, GENERALS.maxLevel);
  assert.equal(g.xp, 0);
  assert.equal(xpToNext(10), Infinity);
});

test('skills: a 1-of-2 pick at levels 2/4/6/8/10, permanent until a respec', () => {
  const g = fresh().generals.roster[0];
  assert.equal(pendingPicks(g), 0);
  assert.equal(pickSkill(g, 0), false);
  g.level = 4;
  assert.equal(pendingPicks(g), 2);
  assert.deepEqual(nextPickOptions(g), GENERALS.kinds.marshal.skills[0]);
  assert.ok(pickSkill(g, 1));
  assert.ok(pickSkill(g, 0));
  assert.equal(pickSkill(g, 0), false, 'no pick owed');
  assert.deepEqual(skillIds(g), [GENERALS.kinds.marshal.skills[0][1], GENERALS.kinds.marshal.skills[1][0]]);
  assert.equal(pickSkill({ ...g, level: 6, skills: [...g.skills] }, 2), false, 'only 0 or 1');
  clearSkills(g);
  assert.equal(pendingPicks(g), 2);
  assert.ok(skillText('wallLong').includes(String(GENERALS.skillValues.wallLong)));
});

test('passives scale with level and skills; abilities fold in their skills', () => {
  const g = fresh().generals.roster[0];
  assert.ok(Math.abs(passiveOf(g).value - 0.15) < 1e-12);
  g.level = 10;
  assert.ok(Math.abs(passiveOf(g).value - 0.15 * (1 + 9 * GENERALS.passivePerLevel)) < 1e-12);
  g.skills = [0, 0];
  assert.equal(abilityOf(g).duration, GENERALS.abilities.shieldWall.duration + GENERALS.skillValues.wallLong);
  assert.ok(Math.abs(passiveOf(g).value - (0.15 * (1 + 9 * GENERALS.passivePerLevel) + GENERALS.skillValues.passivePlus)) < 1e-12);
  assert.deepEqual(commanderEffects(null), { garrisonMult: 1, assaultMult: 1, cooldownMult: 1, speedMult: 1, campTroopsMult: 1, reclaim: 0, ability: null }); // reclaim: the Gravewarden's passive (PLAN-PHASE6)
  assert.deepEqual(commanderStyle(g), { style: 'stalwart', level: 10, skills: skillIds(g) });
  assert.equal(commanderStyle(null), null);
});

test('playerBattleStats folds the commander in; the old signature is unchanged', () => {
  const s = fresh();
  const target = world.regions.find((r) => r.tier === 1).id;
  const plain = playerBattleStats(s, world, target);
  assert.equal(plain.garrisonMult, 1);
  assert.equal(plain.ability, null);
  assert.equal(plain.commander, null);
  const m = playerBattleStats(s, world, target, { commander: 'marshal' });
  assert.ok(Math.abs(m.garrisonMult - 1.15) < 1e-12);
  assert.equal(m.ability.id, 'shieldWall');
  assert.equal(m.commander, 'marshal');
  assert.equal(m.atk, plain.atk);
  const amber = recruitChampion(s, 4);
  const a = playerBattleStats(s, world, target, { commander: amber.id });
  assert.ok(Math.abs(a.speed - plain.speed * 1.2) < 1e-12, 'the Outrider +20% march speed');
  const violet = recruitChampion(s, 3);
  assert.ok(Math.abs(playerBattleStats(s, world, target, { commander: violet }).cooldownMult - plain.cooldownMult * 0.8) < 1e-12);
  const merc = addMercenary(s);
  assert.equal(merc.kind, 'mercenary');
  assert.ok(GENERALS.mercenaryPassives.some((p) => p.stat === merc.passive.stat));
  assert.equal(playerBattleStats(s, world, target, { commander: merc.id }).ability.id, 'bonus');
});

test('wounds: a loss wounds for 10 min; wounded or busy Generals are not free; assignment helpers', () => {
  const s = fresh();
  recruitChampion(s, 2);
  const run = { kind: 'attack', regionId: 3, commander: 'marshal', battle: { result: null } };
  s.battles = [run];
  assert.deepEqual([...busyGeneralIds(s)], ['marshal']);
  assert.deepEqual(freeGenerals(s, 0).map((g) => g.id), ['champion:2']);
  const out = settleCommander(s, { ...run, battle: { result: 'lose' } }, 'lose', 1000);
  assert.equal(out.xp, 40);
  assert.equal(out.wounded, true);
  const m = generalById(s, 'marshal');
  assert.ok(isWounded(m, 1000 + GENERALS.woundMs - 1));
  assert.ok(!isWounded(m, 1000 + GENERALS.woundMs));
  assert.equal(m.regionId, 3);
  s.battles = [];
  assert.deepEqual(freeGenerals(s, 2000).map((g) => g.id), ['champion:2'], 'the wounded Marshal is not free');
  assert.equal(settleCommander(s, { kind: 'attack', commander: null }, 'win', 0), null, 'the Militia Captain earns nothing');
  const def = settleCommander(s, { kind: 'defense', regionId: 2, commander: 'champion:2' }, 'win', 0);
  assert.equal(def.xp, 80);
  // best and nearest
  m.woundedUntil = null;
  assert.equal(bestFreeGeneral(s, world, 5, 'attack', 0).id, 'champion:2', 'levels tie: the Champion suits an attack');
  assert.equal(bestFreeGeneral(s, world, 5, 'defense', 0).id, 'marshal');
  m.level = 3;
  assert.equal(bestFreeGeneral(s, world, 5, 'attack', 0).id, 'marshal', 'a higher level wins');
  const far = world.regions.reduce((a, b) => (b.tier > a.tier ? b : a)).id;
  generalById(s, 'champion:2').regionId = far;
  m.regionId = world.startRegion;
  assert.equal(nearestFreeGeneral(s, world, far, 0).id, 'champion:2');
  assert.equal(nearestFreeGeneral(s, world, world.startRegion, 0).id, 'marshal');
  const r2 = assign({ commander: null }, 'marshal');
  assert.equal(r2.commander, 'marshal');
  assert.equal(assign(r2, null).commander, null);
});

test('assign re-folds a running battle\'s stats with the new commander, keeping a used ability used', () => {
  const s = fresh();
  const target = world.regions.find((r) => r.tier === 1).id;
  const run = { kind: 'attack', regionId: target, commander: null, battle: { player: playerBattleStats(s, world, target), arena: {}, abilityUsed: true } };
  assign(run, 'marshal', s, world, playerBattleStats);
  assert.ok(Math.abs(run.battle.player.garrisonMult - 1.15) < 1e-12);
  assert.equal(run.battle.player.ability.id, 'shieldWall');
  assert.equal(run.battle.abilityUsed, true);
});

test('persistence: the roster survives a new dynasty (levels, skills), Renown resets', () => {
  const s = fresh();
  for (const r of world.regions) s.owner[r.id] = 0;
  const m = generalById(s, 'marshal');
  m.level = 6;
  m.skills = [1, 0, 1];
  m.regionId = 4;
  recruitChampion(s, 3);
  s.renown = { points: 9, earned: 9, spent: 0, festivals: 2, log: { crown: 9, defense: 0, retake: 0, capital: 0 } };
  const next = foundDynasty(s, 77);
  assert.equal(next.generals.roster.length, 2);
  const m2 = next.generals.roster.find((g) => g.id === 'marshal');
  assert.equal(m2.level, 6);
  assert.deepEqual(m2.skills, [1, 0, 1]);
  assert.equal(m2.regionId, null, 'the old map is forgotten');
  assert.equal(next.renown.points, 0);
  assert.equal(next.renown.festivals, 0);
});

test('panel data: one entry per General with copy from the config; the hire row', () => {
  const s = fresh();
  s.renown = { points: 3, earned: 3, spent: 0, festivals: 0, log: { crown: 3, defense: 0, retake: 0, capital: 0 } };
  const d = generalsPanelData(s, world, 0);
  assert.equal(d.generals.length, 1);
  const e = d.generals[0];
  assert.equal(e.passive, 'Your settlements +15% defence');
  assert.ok(e.active.startsWith('Shield Wall'));
  assert.equal(e.skills.length, 5);
  assert.equal(e.xpNext, GENERALS.xpPerLevel);
  assert.equal(e.train.cost, RENOWN.cost.trainPerLevel);
  assert.equal(e.train.can, true);
  assert.equal(d.hire.can, false);
  assert.match(d.hire.reason, /more Renown/);
});

test('sanitizeGenerals: junk-proof, the Marshal always present, at most 2 mercenaries, levels and picks clamped', () => {
  assert.equal(sanitizeGenerals(null).roster[0].id, 'marshal');
  const clean = sanitizeGenerals({ seq: 9, roster: [
    { id: 'champion:2', kind: 'crimson', name: 'X', style: 'bold', level: 99, xp: 1e9, skills: [0, 1, 7, 1, 0, 1, 1], woundedUntil: 'no' },
    { id: 'merc:1', kind: 'mercenary', level: 1, passive: { stat: 'speed', value: 5 } },
    { id: 'merc:2', kind: 'mercenary', level: 1 }, { id: 'merc:3', kind: 'mercenary', level: 1 },
    { id: 'evil', kind: 'marshal' }, null, { id: 'champion:2', kind: 'crimson' },
  ] });
  const ids = clean.roster.map((g) => g.id);
  assert.deepEqual(ids, ['marshal', 'champion:2', 'merc:1', 'merc:2']);
  const c = clean.roster[1];
  assert.equal(c.level, 10);
  assert.equal(c.xp, 0);
  assert.deepEqual(c.skills, [0, 1, 1, 0, 1]);
  assert.equal(c.woundedUntil, null);
  assert.equal(clean.roster[2].passive.value, 0.1, 'a mercenary\'s passive value comes from the config');
  assert.equal(clean.seq, 9);
});
