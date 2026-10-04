// Phase 4 (docs/PLAN-PHASE4.md): the Bounty Board, the Conquest Streak, Deeds, Grudges and Vendettas (with the Champion in the
// sim), their save sanitising and what a new dynasty keeps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/generate.js';
import { createGame } from '../meta/state.js';
import { conquer, conquestBounty, foundDynasty, playerBattleStats } from '../meta/progression.js';
import { bounty, incomePerSec } from '../meta/economy.js';
import {
  tickFrontier, defenseRunFor, defenseReward, ensureFrontier, resolveAway, raidEnemyStats, estimateDefense, vendettaTarget,
  sanitizeFrontier,
} from '../meta/frontier.js';
import {
  ensureBounties, bountyText, bountyProgress, onBattleEnd, onConquest, onFortBuilt, onProsperity, onScout, claimCompleted,
  rerollBounty, rerollInfo, sanitizeBounties, defaultBounties,
} from '../meta/bounties.js';
import {
  streakInfo, streakMultiplier, projectedStreakMultiplier, onStreakBroken, onStreakDefenseWon, tickStreak, sanitizeStreak, multForCount,
} from '../meta/streak.js';
import {
  recordDeed, deedProgress, deedBonuses, drainDeedNews, sanitizeDeeds, ensureDeeds,
} from '../meta/deeds.js';
import {
  addGrudge, grudgeInfo, tickGrudges, drainGrudgeNews, trophyBonus, trophyCount, settleVendetta, isBroken, sanitizeGrudges,
  sanitizeTrophies, grudgeOf,
} from '../meta/grudges.js';
import { createCrownTracker, trackEvents, battleSummaryFor } from '../meta/crowns.js';
import { serialize, deserialize, migrate, sanitizeBattles } from '../meta/save.js';
import { sanitizeGenerals } from '../meta/generalsState.js';
import { step } from '../battle/sim.js';
import { BOUNTIES } from '../config/bounties.js';
import { STREAK } from '../config/streak.js';
import { GRUDGES } from '../config/grudges.js';
import { DEEDS, DEED_CAPS } from '../config/deeds.js';
import { FRONTIER } from '../config/frontier.js';
import { TICK_SEC } from '../config/battle.js';
import { makeWorld, makeGame, ownEverything } from './meta.fixtures.js';

const worlds = new Map();
function worldOf(seed) {
  if (!worlds.has(seed)) worlds.set(seed, generateWorld(seed));
  return worlds.get(seed);
}

/** A realm holding every region of tier <= maxTier, past the raid grace (seed 5: three bordering rivals at tier 2). */
function realm(seed = 5, maxTier = 2, activeSec = FRONTIER.graceSec + 1) {
  const world = worldOf(seed);
  const state = createGame(seed, world, 0);
  for (const r of world.regions) if (r.tier <= maxTier) { state.owner[r.id] = 0; state.conqueredAt[r.id] = 0; }
  state.battles = [];
  ensureFrontier(state).activeSec = activeSec;
  state.frontier.nextCheckAt = activeSec;
  return { world, state };
}

const contract = (id, kind, params = {}, goal = 1) => ({ id, kind, params, progress: 0, goal, reward: { gold: 0, renown: 0, xp: 0 }, done: false });

// --- The Conquest Streak ------------------------------------------------------------------------------------------------------

test('streak: conquests within the window raise it, the bounty multiplies (gold only), the window and a loss end it', () => {
  const { world, state } = realm(5, 1);
  const targets = world.regions.filter((r) => r.tier === 2 && state.owner[r.id] !== 0).map((r) => r.id);
  assert.equal(streakInfo(state).count, 0);
  assert.equal(projectedStreakMultiplier(state), 1);
  const base = bounty(state, world, targets[0]);
  const r1 = conquer(state, world, targets[0], 1000);
  assert.deepEqual(r1.streak, { count: 1, mult: 1 });
  assert.ok(Math.abs(r1.bounty - base * (world.regions[targets[0]].type === 'goldmine' ? 3 : world.regions[targets[0]].type === 'bandit' ? 2 : 1)) < 1e-6);
  state.frontier.activeSec += 60;
  assert.equal(projectedStreakMultiplier(state), STREAK.mult[2], 'the next win would be the second');
  const want = conquestBounty(state, world, targets[1]);
  const r2 = conquer(state, world, targets[1], 2000);
  assert.equal(r2.streak.count, 2);
  assert.ok(Math.abs(r2.bounty - want) < 1e-6, 'conquer pays exactly what conquestBounty showed');
  assert.equal(streakMultiplier(state), STREAK.mult[2]);
  assert.equal(streakInfo(state).visible, true);
  // a won defense refreshes the window but adds nothing
  state.frontier.activeSec += STREAK.windowSec - 10;
  onStreakDefenseWon(state);
  state.frontier.activeSec += 30;
  assert.equal(tickStreak(state), null, 'still alive: the defense restarted the window');
  assert.equal(streakInfo(state).count, 2);
  // the window runs out
  state.frontier.activeSec += STREAK.windowSec + 1;
  assert.deepEqual(tickStreak(state), { was: 2, reason: 'expired' });
  assert.equal(streakInfo(state).count, 0);
  // a lost attack
  conquer(state, world, targets[2], 3000);
  assert.equal(onStreakBroken(state, 'lost').was, 1);
  assert.equal(streakInfo(state).count, 0);
  assert.equal(state.streak.best, 2);
  assert.equal(multForCount(99), STREAK.mult[STREAK.mult.length - 1]);
});

test('streak: tickFrontier expires it and reports it', () => {
  const { world, state } = realm(5, 1);
  const t = world.regions.find((r) => r.tier === 2 && state.owner[r.id] !== 0).id;
  conquer(state, world, t, 0);
  const r = tickFrontier(state, world, 0, STREAK.windowSec + 5);
  assert.deepEqual(r.streakEnded, { was: 1, reason: 'expired' });
});

// --- Deeds ---------------------------------------------------------------------------------------------------------------------

test('deeds: sum and max keys, tiers earned once with news, capitals per faction, bonuses capped', () => {
  const state = makeGame(makeWorld());
  assert.deepEqual(recordDeed(state, 'conquer', 9), []);
  const e = recordDeed(state, 'conquer', 1);
  assert.equal(e.length, 1);
  assert.equal(e[0].id, 'conqueror');
  assert.equal(e[0].tierName, 'bronze');
  assert.equal(drainDeedNews(state).length, 1);
  assert.deepEqual(drainDeedNews(state), [], 'news is drained once');
  assert.deepEqual(recordDeed(state, 'conquer', 1), [], 'a tier is earned once');
  // max keys keep the best value; jumping two tiers earns both
  assert.equal(recordDeed(state, 'streak', 5).length, 2);
  assert.deepEqual(recordDeed(state, 'streak', 4), []);
  // capitals: distinct factions
  recordDeed(state, 'capital:2');
  recordDeed(state, 'capital:2');
  assert.equal(deedProgress(state).find((d) => d.id === 'kingbreaker').progress, 1);
  recordDeed(state, 'capital:3');
  const b = deedBonuses(state);
  assert.ok(Math.abs(b.incomeMult - 1.01) < 1e-9);
  assert.equal(b.streakWindowSec, 60);
  assert.ok(Math.abs(b.attackVs[2] - 1.03) < 1e-9 && Math.abs(b.attackVs[3] - 1.03) < 1e-9 && b.attackVs[4] === undefined);
  assert.equal(recordDeed(state, 'nonsense', 5).length, 0);
  // everything earned stays within the caps (the +10% power-equivalent budget)
  const all = makeGame(makeWorld());
  for (const d of DEEDS) {
    if (d.key === 'capitals') for (const f of [2, 3, 4]) recordDeed(all, `capital:${f}`);
    else recordDeed(all, d.key, d.tiers[d.tiers.length - 1]);
  }
  const max = deedBonuses(all);
  assert.ok(deedProgress(all).every((d) => d.done));
  assert.ok(max.incomeMult - 1 <= DEED_CAPS.incomeMult + 1e-9 && max.defenceMult - 1 <= DEED_CAPS.defenceMult + 1e-9);
  assert.ok(max.bountyMult - 1 <= DEED_CAPS.bountyMult + 1e-9 && max.fortCostMult >= 1 + DEED_CAPS.fortCostMult - 1e-9);
  assert.ok(Object.values(max.attackVs).every((m) => m - 1 <= DEED_CAPS.attackVs + 1e-9));
});

test('deeds: recorded inside the meta (conquer, crowns, forts) and folded in (income, garrison defence)', async () => {
  const { awardCrowns } = await import('../meta/crowns.js');
  const { buildFort } = await import('../meta/forts.js');
  const { world, state } = realm(5, 1);
  const inc0 = incomePerSec(state, world);
  const g0 = playerBattleStats(state, world).garrisonMult;
  const t = world.regions.find((r) => r.tier === 2 && state.owner[r.id] !== 0).id;
  const res = conquer(state, world, t, 0);
  awardCrowns(state, world, t, { victory: true, swift: true, unbroken: false }, res.bounty);
  const p = state.generals.deeds.progress;
  assert.equal(p.conquer, 1);
  assert.equal(p.crowns, 2);
  state.gold = 1e9;
  assert.ok(buildFort(state, world, t, 'walls'));
  assert.equal(state.generals.deeds.progress.fortLevels, 1);
  // earn Conqueror bronze and Warden bronze: +1% income, +2% garrison defence
  recordDeed(state, 'conquer', 20);
  recordDeed(state, 'defense', 5);
  state.owner[t] = 1; // compare income on the same land
  assert.ok(Math.abs(incomePerSec(state, world) / inc0 - 1.01) < 1e-9);
  assert.ok(Math.abs(playerBattleStats(state, world).garrisonMult / g0 - 1.02) < 1e-9);
});

test('deeds: survive a new dynasty (they ride with the Generals) and the save; Dragonslayer pays Renown at the start', () => {
  const world = makeWorld();
  const state = ownEverything(makeGame(world), world);
  recordDeed(state, 'dragon', 1);
  recordDeed(state, 'conquer', 12);
  state.bounties.completed = 4;
  state.streak = { v: 1, count: 3, lastAt: 10, best: 3 };
  grudgeOf(state, 2).value = 70;
  state.trophies[2] = 2;
  const next = foundDynasty(state, 99);
  assert.ok(next);
  assert.equal(next.generals.deeds.progress.dragon, 1, 'deeds kept');
  assert.equal(next.generals.deeds.earned.conqueror, 1);
  assert.deepEqual(next.bounties, defaultBounties(), 'bounties reset');
  assert.equal(next.streak.count, 0);
  assert.equal(next.grudges[2], undefined, 'grudges reset');
  assert.equal(trophyCount(next, 2), 0, 'trophies reset');
  assert.equal(next.renown.points, 1, 'the Dragonslayer deed: +1 Renown at the dynasty start');
  const back = migrate(JSON.parse(serialize(next)));
  assert.deepEqual(back.generals.deeds.progress, next.generals.deeds.progress);
  assert.deepEqual(back.generals.deeds.earned, next.generals.deeds.earned);
  // junk deeds
  const junk = sanitizeDeeds({ progress: { conquer: 'x', streak: -3, nope: 5, 'capital:2': 9, defense: 30 }, earned: { warden: 9, conqueror: 2, fake: 1 } });
  assert.deepEqual(junk.progress, { 'capital:2': 1, defense: 30 });
  assert.deepEqual(junk.earned, { warden: 2 }, 'earned never above what progress supports');
  assert.equal(sanitizeGenerals({ roster: [], deeds: { progress: { duel: 2 } } }).deeds.progress.duel, 2);
  assert.equal(ensureDeeds({}).v, 1);
});

// --- Grudges and Trophies -------------------------------------------------------------------------------------------------------

test('grudges: sources, the 50 warning (once until it cools), the maximum, decay on active time, Free Folk keep none', () => {
  const { world, state } = realm(5, 1);
  assert.equal(addGrudge(state, 1, 'region'), null, 'Free Folk keep no Grudge');
  assert.deepEqual(addGrudge(state, 2, 'region'), { value: GRUDGES.gains.region, crossed: null });
  let w = null;
  while (!w || w.value < GRUDGES.warnAt) w = addGrudge(state, 2, 'duelDeclined');
  assert.equal(w.crossed, 'warn', 'the step that passes 50 warns');
  assert.deepEqual(drainGrudgeNews(state).map((n) => n.kind), ['warn']);
  assert.equal(addGrudge(state, 2, 'sabotage').crossed, null, 'no second warning');
  const v = addGrudge(state, 2, 100);
  assert.equal(v.value, GRUDGES.max);
  assert.equal(v.crossed, 'vendetta');
  // decay: none at the maximum (it waits for its Vendetta), then -1 per 2 active minutes
  state.frontier.activeSec += 600;
  tickGrudges(state, world);
  assert.equal(grudgeOf(state, 2).value, GRUDGES.max);
  grudgeOf(state, 2).value = 60;
  const at = state.frontier.activeSec;
  tickGrudges(state, world);
  state.frontier.activeSec = at + 240;
  tickGrudges(state, world);
  assert.ok(Math.abs(grudgeOf(state, 2).value - (60 - 240 * GRUDGES.decayPerSec)) < 1e-9);
  assert.equal(grudgeInfo(state, 2, world).value, Math.floor(60 - 240 * GRUDGES.decayPerSec));
  // conquer raises it; sabotage too (inside the meta)
  const rival = world.regions.find((r) => r.faction === 3 && !r.isCapital && r.neighbors.some((n) => state.owner[n] === 0));
  if (rival) {
    const res = conquer(state, world, rival.id, 0);
    assert.equal(res.grudge.faction, 3);
    assert.equal(grudgeOf(state, 3).value, GRUDGES.gains.region);
  }
});

test('trophies: settleVendetta hangs one (up to 3), +5% attack against that faction only; a broken leader', () => {
  const { world, state } = realm(5, 2);
  const target = world.regions.find((r) => state.owner[r.id] === 2);
  const free = world.regions.find((r) => state.owner[r.id] === 1 || state.owner[r.id] === 3);
  const a0 = playerBattleStats(state, world, target.id).atk;
  assert.deepEqual(settleVendetta(state, 2, true), { won: true, faction: 2, trophy: 1 });
  for (let i = 0; i < 4; i++) settleVendetta(state, 2, true);
  assert.equal(trophyCount(state, 2), GRUDGES.vendetta.trophyMax);
  assert.ok(Math.abs(trophyBonus(state, 2) - (1 + GRUDGES.vendetta.trophyAtk * 3)) < 1e-9);
  assert.ok(Math.abs(playerBattleStats(state, world, target.id).atk / a0 - trophyBonus(state, 2)) < 1e-9);
  if (free) assert.ok(Math.abs(playerBattleStats(state, world, free.id).atk - playerBattleStats(state, world).atk) < 1e-9);
  assert.equal(grudgeOf(state, 2).value, GRUDGES.afterWin);
  settleVendetta(state, 3, false);
  assert.equal(grudgeOf(state, 3).value, GRUDGES.afterLoss);
  const cap = world.factions[2].capitalRegion;
  assert.equal(isBroken(state, world, 2), false);
  state.owner[cap] = 0;
  assert.equal(isBroken(state, world, 2), true);
});

// --- The Vendetta ------------------------------------------------------------------------------------------------------------------

function swornRealm() {
  const { world, state } = realm(5, 2);
  // a rival bordering the realm whose leader is not broken
  const faction = [2, 3, 4].find((f) => vendettaTarget(state, world, f));
  grudgeOf(state, faction).value = GRUDGES.max;
  return { world, state, faction };
}

test('vendetta: sworn at 100 as a frontier raid (90 s, x1.5, not the home region), fought with a Champion, settled both ways', () => {
  const { world, state, faction } = swornRealm();
  const r = tickFrontier(state, world, 0, FRONTIER.checkSec);
  const v = r.announced.find((x) => x.vendetta);
  assert.ok(v, 'a Vendetta was announced');
  assert.equal(v.vendetta.faction, faction);
  assert.ok(v.vendetta.leader.length > 0);
  assert.ok(world.regions[v.toRegionId].tier > 0, 'never the home region');
  assert.ok(v.arriveAt - v.announcedAt >= GRUDGES.vendetta.telegraphSec);
  assert.equal(grudgeInfo(state, faction, world).sworn, true);
  const plain = raidEnemyStats(state, world, { ...v, vendetta: undefined });
  assert.ok(Math.abs(raidEnemyStats(state, world, v).troopMult / plain.troopMult - GRUDGES.vendetta.warBandMult) < 1e-9);
  assert.ok(estimateDefense(state, world, v.toRegionId, v).theirs > estimateDefense(state, world, v.toRegionId, { ...v, vendetta: undefined }).theirs, 'the Champion counts in the odds');
  // no second Vendetta while one is sworn
  assert.equal(tickFrontier(state, world, 0, FRONTIER.checkSec).announced.filter((x) => x.vendetta).length, 0);
  // the run carries the flag and the arena the Champion
  const run = defenseRunFor(state, world, v, null, { nowMs: 0 });
  assert.deepEqual(run.vendetta, v.vendetta);
  assert.ok(run.battle.champion && run.battle.champion.troops > 0);
  assert.equal(run.battle.arena.vendetta.faction, faction);
  // a win: Trophy, +4 Renown on top, Grudge 0, deed
  const before = state.renown.points;
  run.battle.result = 'win';
  const won = defenseReward(state, world, run, 'win', 0);
  assert.deepEqual(won.vendetta, { won: true, faction, trophy: 1 });
  assert.ok(state.renown.points - before >= GRUDGES.vendetta.renown);
  assert.equal(grudgeOf(state, faction).value, 0);
  assert.equal(state.generals.deeds.progress.vendetta, 1);
  // a loss: the Grudge falls to 30
  grudgeOf(state, faction).vendettaAt = 5;
  const lost = defenseReward(state, world, run, 'lose', 0);
  assert.equal(lost.vendetta.won, false);
  assert.equal(grudgeOf(state, faction).value, GRUDGES.afterLoss);
});

test('vendetta: never away (a marching one is called back), and called off when its war band vanishes', () => {
  const { world, state, faction } = swornRealm();
  tickFrontier(state, world, 0, FRONTIER.checkSec);
  assert.ok(state.frontier.incoming.some((r) => r.vendetta));
  const rep = resolveAway(state, world, 4 * 3600 * 1000, 10 * 3600 * 1000, { odds: () => 1 });
  assert.ok(rep.raids.every((x) => !x.vendetta));
  assert.equal(grudgeOf(state, faction).vendettaAt, null, 'unsworn: it is sworn again live');
  assert.equal(grudgeOf(state, faction).value, GRUDGES.max);
  // called off: sworn, but nothing marching or fighting for GRUDGES.calledOffAfterSec
  grudgeOf(state, faction).vendettaAt = state.frontier.activeSec;
  tickGrudges(state, world);
  state.frontier.activeSec += GRUDGES.calledOffAfterSec + 1;
  tickGrudges(state, world);
  assert.equal(grudgeOf(state, faction).vendettaAt, null);
  assert.equal(grudgeOf(state, faction).value, GRUDGES.afterLoss);
});

test('champion (sim): launches from the camp, never merges, and its death drops the war band attack and fires championFell', () => {
  const { world, state } = swornRealm();
  const v = tickFrontier(state, world, 0, FRONTIER.checkSec).announced.find((x) => x.vendetta);
  const run = defenseRunFor(state, world, v, null, { nowMs: 0 });
  const b = run.battle;
  const keep = b.sites[b.arena.keepSite];
  keep.troops = 5000; // the Champion breaks on the keep
  keep.cap = 5000;
  const atk0 = b.enemy.atk;
  let fell = null;
  let launched = false;
  while (!b.result && b.t < 200 && !fell) {
    step(b, TICK_SEC);
    if (b.squads.some((s) => s.champion)) launched = true;
    fell = b.events.find((e) => e.type === 'championFell') || null;
  }
  assert.ok(launched, 'the Champion marched');
  assert.ok(fell, 'the Champion fell');
  assert.equal(fell.owner, v.faction);
  assert.ok(Math.abs(b.enemy.atk / atk0 - (1 - GRUDGES.vendetta.champion.attackDrop)) < 1e-9);
  assert.ok(b.champion.fellAt > 0);
  // plain JSON (saved with the battle)
  assert.deepEqual(JSON.parse(JSON.stringify(b.champion)), b.champion);
});

// --- The Bounty Board --------------------------------------------------------------------------------------------------------------

test('board: locked until a conquest, then three possible contracts of distinct kinds, seeded and deterministic', () => {
  const world = worldOf(5);
  const fresh = createGame(5, world, 0);
  ensureBounties(fresh, world);
  assert.equal(fresh.bounties.unlocked, false, 'never in the tutorial');
  assert.ok(fresh.bounties.slots.every((s) => s === null));
  const a = realm(5, 1).state;
  const b = realm(5, 1).state;
  ensureBounties(a, world);
  ensureBounties(b, world);
  assert.equal(a.bounties.unlocked, true);
  assert.deepEqual(a.bounties.slots, b.bounties.slots, 'deterministic');
  const kinds = a.bounties.slots.map((c) => c.kind);
  assert.equal(new Set(kinds).size, 3, kinds.join());
  for (const c of a.bounties.slots) {
    assert.ok(c.kind in BOUNTIES.kinds);
    assert.ok(bountyText(c, world, a).length > 5, bountyText(c, world, a));
    assert.ok(c.reward.gold > 0);
    assert.deepEqual(bountyProgress(a, world, c), { progress: 0, goal: c.goal });
    if (c.kind === 'retake') assert.fail('no occupied region: retake is impossible');
  }
  // a different dynasty draws differently
  const c = realm(5, 1).state;
  c.dynasty.level = 2;
  ensureBounties(c, world);
  assert.notDeepEqual(c.bounties.slots.map((x) => [x.kind, x.params]), a.bounties.slots.map((x) => [x.kind, x.params]));
});

test('board: typed completes on conquest, pays income x minutes x 60 and redraws; chain needs two within 10 minutes', () => {
  const { world, state } = realm(5, 1);
  ensureBounties(state, world);
  const mine = world.regions.find((r) => r.type === 'goldmine' && state.owner[r.id] !== 0);
  state.bounties.slots = [contract(900, 'typed', { type: 'goldmine' }), contract(901, 'chain', { lastAt: null }, 2), null];
  const inc = incomePerSec(state, world);
  const done = onConquest(state, world, mine.id, { retaken: false });
  assert.deepEqual(done.map((d) => d.contract.id), [900]);
  assert.equal(state.bounties.slots[1].progress, 1, 'chain: one of two');
  const g0 = state.gold;
  const paid = claimCompleted(state, world, done, 0);
  assert.equal(paid.gold, Math.round(inc * BOUNTIES.kinds.typed.minutes * 60));
  assert.ok(Math.abs(state.gold - g0 - paid.gold) < 1e-6);
  assert.equal(paid.renown, BOUNTIES.kinds.typed.renown);
  assert.deepEqual(paid.replaced, [0]);
  assert.notEqual(state.bounties.slots[0] && state.bounties.slots[0].id, 900);
  assert.equal(state.bounties.completed, 1);
  assert.equal(state.generals.deeds.progress.bounty, 1);
  assert.deepEqual(claimCompleted(state, world, done, 0).claimed, [], 'never paid twice');
  // chain: a second conquest within the window completes it; one later only restarts it
  state.frontier.activeSec += 60;
  assert.deepEqual(onConquest(state, world, 0, {}).map((d) => d.contract.id), [901]);
  state.bounties.slots[1] = contract(902, 'chain', { lastAt: null }, 2);
  onConquest(state, world, 0, {});
  state.frontier.activeSec += BOUNTIES.chainWindowSec + 1;
  assert.deepEqual(onConquest(state, world, 0, {}), []);
  assert.equal(state.bounties.slots[1].progress, 1);
});

test('board: battle contracts, fortify, prosper, scout and retake read the right facts', () => {
  const { world, state } = realm(5, 1);
  ensureBounties(state, world);
  state.bounties.slots = [contract(1, 'noPowers'), contract(2, 'forts', {}, 2), contract(3, 'general', { generalId: 'marshal' })];
  const sum = { kind: 'attack', won: true, powersUsed: 1, capturesByType: { fort: 1, tower: 1 }, twist: null, commander: 'marshal', crowns: {} };
  const done = onBattleEnd(state, world, { kind: 'attack' }, 'win', sum);
  assert.deepEqual(done.map((d) => d.contract.id).sort(), [2, 3], 'a power was used: noPowers stays');
  assert.equal(done[0].commander, 'marshal');
  assert.deepEqual(onBattleEnd(state, world, { kind: 'duel' }, 'win', { ...sum, kind: 'duel', powersUsed: 0 }), [], 'Duels count for nothing');
  assert.equal(onBattleEnd(state, world, { kind: 'attack' }, 'win', { ...sum, powersUsed: 0 }).length, 1);
  state.bounties.slots = [contract(4, 'fortify', {}, 2), contract(5, 'prosper', { level: 2 }), contract(6, 'scout', { marked: [] })];
  assert.deepEqual(onFortBuilt(state, world, 1, 'walls'), []);
  assert.equal(onFortBuilt(state, world, 1, 'walls').length, 1);
  assert.deepEqual(onProsperity(state, world, [{ regionId: 1, level: 1, from: 0 }]), []);
  assert.equal(onProsperity(state, world, [{ regionId: 1, level: 2, from: 1 }]).length, 1);
  onScout(state, world, 7);
  assert.deepEqual(onConquest(state, world, 8, {}), []);
  assert.equal(onConquest(state, world, 7, {}).length, 1);
  state.bounties.slots = [contract(7, 'retake'), contract(8, 'swiftHard'), contract(9, 'cleanDefense')];
  assert.equal(onConquest(state, world, 3, { retaken: true }).length, 1);
  assert.equal(onBattleEnd(state, world, {}, 'win', { kind: 'attack', won: true, crowns: { swift: true }, labelAtAttack: 'Fair' }).length, 0);
  assert.equal(onBattleEnd(state, world, {}, 'win', { kind: 'attack', won: true, crowns: { swift: true }, labelAtAttack: 'Hard' }).length, 1);
  assert.equal(onBattleEnd(state, world, {}, 'win', { kind: 'defense', won: true, playerSitesLost: 1 }).length, 0);
  assert.equal(onBattleEnd(state, world, {}, 'win', { kind: 'defense', won: true, playerSitesLost: 0 }).length, 1);
});

test('board: reroll free once per 20 active minutes, then 1 Renown; nothing is charged when it fails', () => {
  const { world, state } = realm(5, 2);
  ensureBounties(state, world);
  const old = state.bounties.slots[0];
  assert.equal(rerollInfo(state).free, true);
  const r1 = rerollBounty(state, world, 0);
  assert.equal(r1.ok, true);
  assert.equal(r1.cost, 'free');
  assert.notEqual(state.bounties.slots[0].kind, old.kind);
  assert.equal(new Set(state.bounties.slots.map((c) => c.kind)).size, 3);
  assert.equal(rerollInfo(state).free, false);
  state.renown.points = 0;
  assert.deepEqual(rerollBounty(state, world, 0), { ok: false, reason: 'renown' });
  state.renown.points = 1;
  const r2 = rerollBounty(state, world, 1);
  assert.equal(r2.cost, BOUNTIES.rerollRenown);
  assert.equal(state.renown.points, 0);
  state.frontier.activeSec += BOUNTIES.freeRerollSec;
  assert.equal(rerollInfo(state).free, true);
  assert.equal(rerollBounty(state, world, 9).reason, 'empty');
});

test('crown tracker: counts powers, captures by type and the ability; battleSummaryFor builds the summary', () => {
  const battle = { sites: [{ id: 0, owner: 0, type: 'camp' }, { id: 1, owner: 2, type: 'fort' }, { id: 2, owner: 2, type: 'tower' }] };
  const tr = createCrownTracker(battle);
  trackEvents(tr, [
    { type: 'capture', site: 1, from: 2, to: 0 }, { type: 'capture', site: 2, from: 2, to: 0 }, { type: 'power', owner: 0 },
    { type: 'power', owner: 2 }, { type: 'ability', owner: 0 },
  ], 5);
  assert.deepEqual(tr.capturesByType, { fort: 1, tower: 1 });
  assert.equal(tr.powersUsed, 1);
  assert.equal(tr.abilityUsed, true);
  trackEvents(tr, [{ type: 'end', result: 'win' }], 40);
  const s = battleSummaryFor(tr, { ...battle, result: 'win', t: 40, arena: { regionId: 3, twist: 'night' } },
    { kind: 'defense', regionId: 3, commander: 'marshal', vendetta: { faction: 2 } }, null, null);
  assert.equal(s.kind, 'defense');
  assert.equal(s.won, true);
  assert.equal(s.twist, 'night');
  assert.equal(s.commander, 'marshal');
  assert.equal(s.vendetta, true);
  assert.equal(s.durationSec, 40);
  // an old tracker (saved before Phase 4) is upgraded in place
  const old = { v: 1, playerSitesLost: 0, result: null, endT: null, lastT: 0, held: [0] };
  const s2 = battleSummaryFor(old, { ...battle, result: 'lose', t: 9, arena: { regionId: 1 } }, { kind: 'attack', regionId: 1 }, null, null);
  assert.equal(s2.powersUsed, 0);
  assert.deepEqual(s2.capturesByType, {});
});

// --- Save --------------------------------------------------------------------------------------------------------------------------

test('save: bounties, streak, grudges and trophies round-trip; junk and old saves come back valid', () => {
  const { world, state } = realm(5, 2);
  ensureBounties(state, world);
  state.streak = { v: 1, count: 3, lastAt: 1500, best: 4 };
  addGrudge(state, 2, 'capital');
  addGrudge(state, 2, 'region');
  state.trophies[3] = 2;
  const back = deserialize(serialize(state));
  assert.deepEqual(back.bounties, state.bounties);
  assert.deepEqual(back.streak, state.streak);
  assert.deepEqual(back.grudges, state.grudges);
  assert.deepEqual(back.trophies, state.trophies);
  // an old save without any of it
  const old = JSON.parse(serialize(state));
  delete old.bounties; delete old.streak; delete old.grudges; delete old.trophies;
  const m = migrate(old);
  assert.deepEqual(m.bounties, defaultBounties());
  assert.equal(m.streak.count, 0);
  assert.deepEqual(m.trophies, { v: 1 });
  // junk
  assert.deepEqual(sanitizeBounties('x'), defaultBounties());
  const sb = sanitizeBounties({ slots: [{ kind: 'typed', params: { type: 'castle' } }, { kind: 'chain', goal: 99, progress: 7, reward: { gold: -5 } }, { kind: 'chain' }], draws: -2, unlocked: true });
  assert.equal(sb.slots[0], null, 'an unknown type is dropped');
  assert.equal(sb.slots[1].goal, 10);
  assert.equal(sb.slots[1].reward.gold, 0);
  assert.equal(sb.slots[2], null, 'a duplicate kind is dropped');
  assert.equal(sb.draws, 0);
  assert.deepEqual(sanitizeStreak({ count: 5, lastAt: null }), { v: 1, count: 0, lastAt: null, best: 5 });
  const sg = sanitizeGrudges({ 1: { value: 50 }, 2: { value: 500, warnedAt: 'x' }, foo: 3, news: [{ kind: 'warn', faction: 2, value: 55 }, { kind: 'bad' }] });
  assert.equal(sg[1], undefined, 'Free Folk keep no Grudge');
  assert.equal(sg[2].value, GRUDGES.max);
  assert.equal(sg[2].warnedAt, null);
  assert.equal(sg.foo, undefined);
  assert.equal(sg.news.length, 1);
  assert.deepEqual(sanitizeTrophies({ 2: 9, 1: 1, 3: 'x' }), { v: 1, 2: GRUDGES.vendetta.trophyMax });
});

test('save: a Vendetta run and a marching Vendetta keep their flag; an attack keeps labelAtAttack', () => {
  const { world, state, faction } = swornRealm();
  const v = tickFrontier(state, world, 0, FRONTIER.checkSec).announced.find((x) => x.vendetta);
  const f = sanitizeFrontier(JSON.parse(JSON.stringify(state.frontier)));
  assert.deepEqual(f.incoming.find((r) => r.id === v.id).vendetta, v.vendetta);
  const run = defenseRunFor(state, world, v, null, { nowMs: 0 });
  state.battles = [JSON.parse(JSON.stringify(run))];
  const kept = sanitizeBattles(state, state.owner);
  assert.deepEqual(kept[0].vendetta, { faction, leader: v.vendetta.leader });
  assert.equal(kept[0].battle.champion.troops, run.battle.champion.troops);
  const atk = { id: 7, kind: 'attack', regionId: run.battle.arena.regionId, battle: run.battle, labelAtAttack: 'Hard' };
  void atk; // an attack run on an enemy region keeps its label (checked on the shape only: the region must be the enemy's)
  const enemyRun = sanitizeBattles({ battles: [{ ...JSON.parse(JSON.stringify(run)), kind: 'attack', labelAtAttack: 'Hard' }] },
    state.owner.map((o, i) => (i === run.regionId ? 2 : o)));
  assert.equal(enemyRun[0].labelAtAttack, 'Hard');
});
