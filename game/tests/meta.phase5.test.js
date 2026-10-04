// Phase 5 (docs/PLAN-PHASE5.md): Edicts, Legacy, Challenges, Quick Conquest, foundDynasty and the save. Focused unit tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateWorld } from '../world/generate.js';
import { createGame, resetRegions } from '../meta/state.js';
import { foundDynasty, playerBattleStats, enemyBattleStats, difficulty, conquestBounty, conquer } from '../meta/progression.js';
import { incomePerSec } from '../meta/economy.js';
import {
  edictMods, edictChoices, edictInfo, worldOptsFor, commanderFor, currentEdict, freeScoutsLeft, sanitizeEdict, allEdicts,
} from '../meta/edicts.js';
import { legacyInfo, buyLegacy, legacyPointsForFounding, sanitizeLegacy } from '../meta/legacy.js';
import { EDICT_LIST, EDICT_NEUTRAL } from '../config/edicts.js';
import { DYNASTY, ECONOMY } from '../config/meta.js';
import { BOUNTIES } from '../config/bounties.js';
import { PROSPERITY } from '../config/prosperity.js';
import { earnRenown } from '../meta/renownState.js';
import { raidRate } from '../meta/frontier.js';
import { serialize, deserialize } from '../meta/save.js';
import { scoutCost, scout } from '../meta/intel.js';
import { festivalCost } from '../meta/renown.js';
import { bountySlots, ensureBounties } from '../meta/bounties.js';
import { streakInfo } from '../meta/streak.js';
import { createBattle, step, issue } from '../battle/sim.js';
import { buildArena } from '../battle/arena.js';
import { attackableFrontier } from '../meta/progression.js';

const digest = (w) => createHash('sha1').update(JSON.stringify(w)).digest('hex').slice(0, 16);
const owned = (state) => { state.owner = state.owner.map(() => 0); return state; };
const withEdict = (state, id, challenges = []) => { state.edict = { v: 1, id, challenges, scoutsUsed: 0 }; return state; };
const withNodes = (state, ...nodes) => { state.generals.legacy = { v: 1, points: 99, spent: 0, nodes: Object.fromEntries(nodes.map((n) => [n, true])), pendingBonus: 0 }; return state; };

test('no Edict: worlds are byte-identical (pinned digests) and a non-world Edict changes nothing', () => {
  // digests taken with the Phase 4 generator before the Edict pass existed (the code path without an Edict is unchanged)
  const pinned = { '1,1': '3c89495d8ad3ce2c', '7,1': '760e48b3b8cc6657', '12,2': '3a9441c587233d3d', '3,3': '00ca888068769da2' };
  for (const [k, want] of Object.entries(pinned)) {
    const [seed, dynasty] = k.split(',').map(Number);
    const w = generateWorld(seed, { dynasty });
    assert.equal(digest(w), want, `seed ${seed} D${dynasty}`);
    assert.equal(digest(generateWorld(seed, { dynasty, edict: null })), want);
    assert.equal(digest(generateWorld(seed, { dynasty, edict: 'ageOfIron' })), want, 'Age of Iron does not touch the map');
    assert.equal('edict' in w, false);
  }
});

test('world Edicts: Long Winter blizzards about half, Age of Dragons two Lairs, Open Roads no Night', () => {
  let blizz = 0; let elig = 0; let night = 0; let lairs2 = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const lw = generateWorld(seed, { edict: 'longWinter' });
    assert.equal(lw.edict, 'longWinter');
    const e = lw.regions.filter((r) => r.tier >= 2 && !r.isCapital && r.type !== 'dragon');
    elig += e.length; blizz += e.filter((r) => r.twist === 'blizzard').length;
    assert.ok(lw.regions.filter((r) => r.isCapital).every((r) => r.twist === 'siege'), 'capitals keep their Siege');
    night += generateWorld(seed, { edict: 'openRoads' }).regions.filter((r) => r.twist === 'night').length;
    const ad = generateWorld(seed, { edict: 'ageOfDragons' });
    if (ad.regions.filter((r) => r.type === 'dragon').length === 2) lairs2 += 1;
  }
  assert.ok(blizz / elig > 0.4 && blizz / elig < 0.65, `Blizzard on ${(100 * blizz / elig).toFixed(0)}%`);
  assert.equal(night, 0);
  assert.ok(lairs2 >= 7, `two Lairs on ${lairs2}/8 seeds`);
});

test('edictMods is neutral by default and folds Edict, Challenges and Legacy into one object', () => {
  const world = generateWorld(1);
  const s = createGame(1, world, 0);
  const m = edictMods(s);
  for (const [k, v] of Object.entries(EDICT_NEUTRAL)) if (k !== 'bountySlots') assert.equal(m[k], v, k);
  assert.equal(m.bountySlots, BOUNTIES.slots);
  withEdict(s, 'openRoads', ['overrun', 'bogus']);
  withNodes(s, 'scribes', 'heralds');
  const n = edictMods(s);
  assert.ok(Math.abs(n.enemyGarrisonMult - 1.1 * 1.4) < 1e-12, 'Open Roads x Overrun multiply');
  assert.equal(n.freeScout, true);
  assert.equal(n.bountySlots, BOUNTIES.slots + 1);
  assert.equal(n.edictChoices, 4);
  withEdict(s, 'bountyHunters');
  assert.equal(edictMods(s).bountySlots, 5, 'Bounty Hunters 4 + Scribes 1');
  assert.equal(edictMods(s).streak, false);
});

test('every Edict has two lines built from its numbers, and a real trade-off', () => {
  assert.equal(EDICT_LIST.length, 10);
  for (const e of allEdicts()) {
    assert.ok(e.upside && e.cost && !/[{}]/.test(e.upside + e.cost), `${e.id}: ${e.upside} / ${e.cost}`);
  }
  assert.equal(edictInfo('ageOfIron').upside, '+15% attack');
  assert.equal(edictInfo('nope'), null);
});

test('edictChoices: 3 distinct, seeded and deterministic; Heralds (real or preview) adds a 4th', () => {
  const world = generateWorld(2);
  const s = createGame(2, world, 0);
  const a = edictChoices(s, 99).map((e) => e.id);
  assert.equal(a.length, 3);
  assert.equal(new Set(a).size, 3);
  assert.deepEqual(edictChoices(s, 99).map((e) => e.id), a);
  assert.notDeepEqual(edictChoices(s, 100).map((e) => e.id).join() + edictChoices(s, 101).map((e) => e.id).join(), a.join() + a.join());
  const preview = edictChoices(s, 99, { legacyNodes: { heralds: true } }).map((e) => e.id);
  assert.equal(preview.length, 4);
  assert.deepEqual(preview.slice(0, 3), a, 'the first three stay');
  assert.equal(s.generals.legacy, undefined, 'the preview never touched state');
  withNodes(s, 'heralds');
  assert.deepEqual(edictChoices(s, 99).map((e) => e.id), preview);
});

test('foundDynasty: old call forms work; the 5th argument sets the Edict and Challenges, credits Legacy, then applies the buys', () => {
  const world = generateWorld(3);
  const s = owned(createGame(3, world, 0));
  const plain = foundDynasty(s, 77);
  assert.ok(plain && plain.dynasty.level === 2);
  assert.deepEqual(plain.edict, { v: 1, id: null, challenges: [], scoutsUsed: 0 });
  assert.equal(plain.generals.legacy.points, DYNASTY.starBase + 1);
  const next = foundDynasty(s, 77, undefined, world, { edict: 'ageOfIron', challenges: ['ironWill', 'junk'], legacyBuys: ['veteranCamp', 'warlord', 'oldRoads'] });
  assert.equal(next.edict.id, 'ageOfIron');
  assert.deepEqual(next.edict.challenges, ['ironWill']);
  assert.equal(next.generals.legacy.pendingBonus, 0.5);
  assert.deepEqual(next.founding.bought, ['veteranCamp', 'oldRoads']);
  assert.deepEqual(next.founding.refused, [{ id: 'warlord', reason: 'locked' }]);
  assert.equal(next.generals.legacy.spent, 4);
  assert.ok(!JSON.parse(serialize(next)).founding, 'the report is never saved');
  assert.equal(s.edict.id, null, 'the old state is untouched');
  // the dynasty completed with one Challenge pays +50% at ITS founding
  owned(next); next.owner = next.owner.length ? next.owner : [0];
  assert.equal(legacyPointsForFounding(next), Math.round((DYNASTY.starBase + 2) * 1.5));
});

test('Legacy: buy rules, budget, War Chest, Royal Treasury, Old Roads and Patronage at the founding', () => {
  const world = generateWorld(4);
  const s = owned(createGame(4, world, 0));
  assert.deepEqual(buyLegacy(s, 'veteranCamp'), { ok: false, reason: 'points' });
  s.generals.legacy = { v: 1, points: 33, spent: 0, nodes: {}, pendingBonus: 0 };
  assert.equal(buyLegacy(s, 'swiftBanners').reason, 'locked');
  for (const id of ['veteranCamp', 'swiftBanners', 'drillmasters', 'warChest', 'oldRoads', 'masons', 'royalTreasury', 'heralds', 'scribes', 'patronage']) assert.ok(buyLegacy(s, id).ok, id);
  assert.equal(buyLegacy(s, 'veteranCamp').reason, 'owned');
  assert.equal(legacyInfo(s).spent, 32); // 2+3+4+5 + 2+3+4 + 2+3+4
  assert.equal(legacyInfo(s).available, 1);
  assert.equal(legacyInfo(s).nodes.quickConquest, 'poor');
  const nw = generateWorld(5, { dynasty: 2 });
  const next = foundDynasty(s, 5, nw, world);
  assert.equal(next.upgrades.recruitment, 2, 'War Chest: 2 levels of the cheapest Army upgrade');
  assert.equal(next.gold, Math.round(120 * ECONOMY.startRegionIncome * 2), 'Royal Treasury');
  assert.equal(next.prosperity[nw.startRegion], 2, 'Old Roads');
  assert.equal(next.renown.points, 2, 'Patronage');
  // three dynasties' points (4 + 5 + 6 = 15) buy about 5-6 nodes (PLAN-PHASE5 budget)
  assert.equal([1, 2, 3].reduce((a, l) => a + DYNASTY.starBase + l, 0), 15);
});

test('Edict effects reach the existing code paths (income, attack, bounty, raids, Renown, Festival, scouting, slots, streak)', () => {
  const world = generateWorld(6);
  const s = createGame(6, world, 0);
  s.owner[world.regions.find((r) => r.tier === 1).id] = 0;
  const base = { inc: incomePerSec(s, world), atk: playerBattleStats(s, world).atk };
  withEdict(s, 'ageOfIron');
  assert.ok(Math.abs(incomePerSec(s, world) / base.inc - 0.85) < 1e-9);
  assert.ok(Math.abs(playerBattleStats(s, world).atk / base.atk - 1.15) < 1e-9);
  const target = attackableFrontier(s, world)[0];
  withEdict(s, null); const b0 = conquestBounty(s, world, target);
  withEdict(s, 'merchantPrinces'); assert.ok(Math.abs(conquestBounty(s, world, target) / b0 - 2) < 1e-9);
  const rival = world.factions.findIndex((f) => f.personality === 'aggressive');
  withEdict(s, null); const r0 = raidRate(s, world, rival);
  withEdict(s, 'ironFrontier'); assert.ok(Math.abs(raidRate(s, world, rival) / r0 - 2) < 1e-9);
  withEdict(s, 'peaceOfCrowns'); assert.equal(raidRate(s, world, rival), 0);
  const got = [1, 1, 1].map(() => earnRenown(s, 1, 'crown'));
  assert.deepEqual(got, [0, 1, 0], 'x0.5 with the fraction carried');
  withEdict(s, null); const f0 = festivalCost(s, target === 0 ? 1 : world.startRegion);
  withEdict(s, 'grandFestival'); assert.ok(festivalCost(s, world.startRegion) <= Math.ceil(f0 / 2));
  s.gold = 0; withEdict(s, 'openRoads'); assert.equal(scoutCost(s, world, target), 0);
  withEdict(s, null); withNodes(s, 'heralds', 'scribes', 'patronage', 'spymaster');
  assert.equal(freeScoutsLeft(s), 3); assert.equal(scoutCost(s, world, target), 0);
  assert.ok(scout(s, world, target)); assert.equal(freeScoutsLeft(s), 2);
  withEdict(s, 'bountyHunters'); assert.equal(bountySlots(s), 5);
  s.owner[attackableFrontier(s, world)[0]] = 0; ensureBounties(s, world);
  assert.equal(s.bounties.slots.length, 5);
  assert.equal(streakInfo(s).mult, 1);
});

test('Challenges in the sim and meta: Iron Will refuses powers, Overrun x1.4, Lone Banner forces the Militia Captain', () => {
  const world = generateWorld(7);
  const s = createGame(7, world, 0);
  const target = attackableFrontier(s, world)[0];
  const t0 = enemyBattleStats(world, s, target).troopMult;
  withEdict(s, null, ['ironWill', 'overrun', 'loneBanner']);
  assert.ok(Math.abs(enemyBattleStats(world, s, target).troopMult / t0 - 1.4) < 1e-9);
  const p = playerBattleStats(s, world, target, { commander: 'marshal' });
  assert.equal(p.commander, null); assert.equal(p.ability, null); assert.equal(p.powersBlocked, 'ironWill');
  assert.equal(commanderFor(s, 'marshal'), null);
  const b = createBattle(buildArena(world, s.owner, target, p, enemyBattleStats(world, s, target)), p, enemyBattleStats(world, s, target));
  issue(b, { type: 'power', owner: 0, power: 'rally', target: 1 });
  step(b, 0.05);
  assert.ok(b.events.some((e) => e.type === 'refused' && e.reason === 'ironWill'));
  assert.equal(b.cooldowns.rally, 0, 'nothing spent');
  assert.deepEqual(currentEdict(s).challenges.map((c) => c.id), ['ironWill', 'overrun', 'loneBanner']);
});

test('arena: Merchant Princes towers and forts, Kingmaker capital Gates, Age of Dragons health', () => {
  const world = generateWorld(1);
  const s = createGame(1, world, 0);
  const cap = world.regions.find((r) => r.isCapital);
  withEdict(s, 'merchantPrinces'); withNodes(s, 'heralds', 'scribes', 'patronage', 'spymaster', 'kingmaker');
  const e = enemyBattleStats(world, s, cap.id);
  assert.equal(e.fortTroopMult, 1.3); assert.equal(e.gateTroopMult, 0.75);
  assert.equal(enemyBattleStats(world, s, world.regions.find((r) => !r.isCapital && r.tier > 1).id).gateTroopMult, 1);
  withEdict(s, 'ageOfDragons'); assert.equal(enemyBattleStats(world, s, cap.id).dragonHpMult, 1.25);
  s.boons = { dragonscale: true };
  const a1 = playerBattleStats(s, world).atk; withEdict(s, null); assert.ok(Math.abs(a1 / playerBattleStats(s, world).atk - 1.1) < 1e-9);
});

test('Grand Festival: natural prosperity takes twice as long', async () => {
  const { prosperityLevel } = await import('../meta/prosperity.js');
  const world = generateWorld(2);
  const s = createGame(2, world, 0);
  const id = world.startRegion;
  s.conqueredAt[id] = 0;
  const t1 = PROSPERITY.thresholdsMs[0];
  assert.equal(prosperityLevel(s, id, t1), 1);
  withEdict(s, 'grandFestival');
  assert.equal(prosperityLevel(s, id, t1), 0);
  assert.equal(prosperityLevel(s, id, 2 * t1), 1);
});

test('save: Edict and Legacy round-trip; junk is repaired; an old save gets standard rules and an empty Legacy', () => {
  const world = generateWorld(3);
  const s = withNodes(withEdict(createGame(3, world, 0), 'warriorKings', ['overrun']), 'veteranCamp', 'swiftBanners');
  s.generals.legacy.spent = 5;
  const back = deserialize(serialize(s));
  assert.deepEqual(back.edict, s.edict);
  assert.deepEqual(back.generals.legacy, s.generals.legacy);
  const junk = JSON.parse(serialize(s));
  junk.edict = { id: 'nope', challenges: ['overrun', 'overrun', 7, 'x'], scoutsUsed: -3 };
  junk.generals.legacy = { v: 1, points: -5, spent: 'a', nodes: { swiftBanners: true, warlord: true, scribes: 1 }, pendingBonus: 'x' };
  const fixed = deserialize(JSON.stringify(junk));
  assert.deepEqual(fixed.edict, { v: 1, id: null, challenges: ['overrun'], scoutsUsed: 0 });
  assert.deepEqual(fixed.generals.legacy.nodes, {}, 'a node without its prerequisite is dropped');
  assert.ok(fixed.generals.legacy.points >= fixed.generals.legacy.spent);
  assert.deepEqual(sanitizeEdict(undefined), { v: 1, id: null, challenges: [], scoutsUsed: 0 });
  assert.deepEqual(sanitizeLegacy('x'), { v: 1, points: 0, spent: 0, nodes: {}, pendingBonus: 0 });
  const old = JSON.parse(serialize(s)); delete old.edict; delete old.generals.legacy;
  const o = deserialize(JSON.stringify(old));
  assert.equal(o.edict.id, null);
  assert.equal(o.generals.legacy, undefined);
  assert.equal(edictMods(o).atkMult, 1);
  assert.deepEqual(worldOptsFor(o), { dynasty: 1 });
  assert.deepEqual(worldOptsFor(s), { dynasty: 1, edict: 'warriorKings' });
});

test('Quick Conquest: refusals, an incremental headless win at 75% bounty with the Victory crown only, hooks run', async () => {
  const Q = await import('../meta/quick.js');
  const { QUICK } = await import('../config/legacy.js');
  const world = generateWorld(1);
  const s = createGame(1, world, 0);
  const easy = attackableFrontier(s, world).find((id) => difficulty(s, world, id).label === 'Easy');
  assert.ok(easy != null, 'test setup: an Easy first-ring region');
  assert.equal(Q.canQuickConquer(s, world, easy).reason, 'locked');
  withNodes(s, 'oldRoads', 'masons', 'royalTreasury', 'quickConquest');
  assert.deepEqual(Q.canQuickConquer(s, world, easy), { ok: true });
  assert.equal(Q.canQuickConquer(s, world, easy, { busy: { regions: new Set([easy]) } }).reason, 'busy');
  assert.equal(Q.canQuickConquer(s, world, world.startRegion).reason, 'owned');
  const cap = world.regions.find((r) => r.isCapital);
  assert.equal(Q.canQuickConquer(s, world, cap.id).reason, 'capital');
  const expected = conquestBounty(s, world, easy) * QUICK.bountyShare;
  const job = Q.createQuickConquest(s, world, easy, { commander: 'marshal' });
  assert.equal(job.commander, 'marshal');
  const json = JSON.parse(JSON.stringify(job));
  let r = Q.stepQuickConquest(job, 50);
  assert.equal(r.done, false); assert.ok(r.progress > 0 && r.progress < 1);
  let guard = 0;
  while (!(r = Q.stepQuickConquest(job, 400)).done && guard++ < 100);
  assert.equal(r.progress, 1);
  // deterministic: the same job replays to the same end
  while (!Q.stepQuickConquest(json, 1000).done);
  assert.equal(json.battle.t, job.battle.t);
  const gold0 = s.gold;
  const out = Q.finishQuickConquest(s, world, job, 1000);
  assert.equal(out.won, true, `the Easy fight was won (${job.battle.result} at ${job.battle.t.toFixed(0)} s)`);
  assert.equal(s.owner[easy], 0);
  assert.ok(Math.abs(out.conquerResult.bounty - expected) < 1e-6, 'bounty x0.75');
  assert.deepEqual(s.crowns[easy], { victory: true, swift: false, unbroken: false });
  assert.ok(s.gold > gold0);
  assert.equal(s.stats.battlesWon, 1);
  assert.equal(out.summary.quick, true);
  assert.ok(out.commander && out.commander.id === 'marshal', 'the commander gets its XP');
});

test('Quick Conquest does not count for the ability contract (it is not watched)', async () => {
  const { onBattleEnd } = await import('../meta/bounties.js');
  const s = { bounties: { v: 1, unlocked: true, slots: [{ id: 1, kind: 'ability', params: { generalId: 'marshal' }, progress: 0, goal: 1, reward: { gold: 1, renown: 0, xp: 0 }, done: false }] } };
  const summary = { kind: 'attack', won: true, abilityUsed: true, commander: 'marshal', powersUsed: 0 };
  assert.equal(onBattleEnd(s, null, null, 'win', { ...summary, quick: true }).length, 0);
  assert.equal(onBattleEnd(s, null, null, 'win', summary).length, 1);
});

test('Legacy and Edict effects: Masons, Old Alliances, Veteran Camp, Swift Banners, Drillmasters, Long Winter and Dragon rewards', async () => {
  const { fortCost, buildFort } = await import('../meta/forts.js');
  const { settleCommander, generalById } = await import('../meta/generals.js');
  const world = generateWorld(8);
  const s = createGame(8, world, 0);
  const home = world.startRegion;
  const full = fortCost(s, world, home, 'walls', 1);
  withNodes(s, 'oldRoads', 'masons');
  assert.equal(fortCost(s, world, home, 'walls', 1), Math.round(full * 0.5));
  s.gold = 1e9; assert.ok(buildFort(s, world, home, 'walls'));
  assert.equal(fortCost(s, world, home, 'tower', 1) > 0 && fortCost(s, world, home, 'tower', 1) >= Math.round(fortCost(createGame(8, world, 0), world, home, 'tower', 1)), true, 'only the first is cheaper');
  const p0 = playerBattleStats(s, world);
  withNodes(s, 'veteranCamp', 'swiftBanners');
  const p1 = playerBattleStats(s, world);
  assert.ok(Math.abs(p1.campTroops / p0.campTroops - 1.15) < 1e-9 && Math.abs(p1.speed / p0.speed - 1.08) < 1e-9);
  withNodes(s, 'veteranCamp', 'swiftBanners', 'drillmasters');
  const g = generalById(s, 'marshal');
  const before = g.xp;
  settleCommander(s, { kind: 'attack', regionId: 1, commander: 'marshal' }, 'win', 0);
  assert.equal(g.xp - before, 125, '100 XP x1.25');
  // Old Alliances: a Free Folk region surrenders from 2.4
  s.stats.battlesWon = 1;
  const ff = attackableFrontier(s, world).find((id) => world.factions[world.regions[id].faction].personality === 'passive');
  s.upgrades.muster = 0; let lvl = 0;
  while (difficulty(s, world, ff).ratio < 2.45 && lvl < 400) { lvl += 1; s.upgrades.muster = lvl; }
  const r = difficulty(s, world, ff).ratio;
  assert.ok(r >= 2.4 && r < ECONOMY.surrenderRatio, `test setup: ratio ${r}`);
  assert.equal(difficulty(s, world, ff).surrender, false, 'below 3.0 no surrender without the node');
  withNodes(s, 'veteranCamp', 'swiftBanners', 'drillmasters', 'oldRoads', 'masons', 'royalTreasury', 'quickConquest', 'oldAlliances');
  assert.equal(difficulty(s, world, ff).surrender, true);
  // Long Winter: +1 Renown for a Blizzard region; Age of Dragons: the Lair pays x2 Renown
  const lw = generateWorld(8, { edict: 'longWinter' });
  const ls = withEdict(createGame(8, lw, 0), 'longWinter');
  const bl = lw.regions.find((x) => x.twist === 'blizzard' && !x.type);
  assert.equal(conquer(ls, lw, bl.id, 0).renown, 1);
  const ad = generateWorld(8, { edict: 'ageOfDragons' });
  const as = withEdict(createGame(8, ad, 0), 'ageOfDragons');
  const lair = ad.regions.find((x) => x.type === 'dragon');
  assert.equal(conquer(as, ad, lair.id, 0).renown, 20);
});
