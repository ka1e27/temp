// Phase 9 (PLAN-PHASE9 §9A, §9B, §9C): the challenge sandbox, the Daily's seed, the scenarios' specs, goals and scores, the lasting
// record (streaks, stars, banners, the main-game reward, share data) and the challenge save. The bot proofs are in
// meta.phase9.play.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/generate.js';
import { createGame } from '../meta/state.js';
import { serialize } from '../meta/save.js';
import { edictMods } from '../meta/edicts.js';
import { enemyDepth } from '../meta/progression.js';
import { boonsUnlocked } from '../meta/boons.js';
import { incomePerSec } from '../meta/economy.js';
import { dayIndex, fromDayIndex, addDays, isDate } from '../meta/dates.js';
import { dailySpec, dailyNumber } from '../meta/daily.js';
import { scenarioSpec, SCENARIO_IDS, scenarioUnlocked, scenarioList } from '../meta/scenarios.js';
import { createChallengeGame, challengeSpecOf, tickChallenge, recordChallengeBattle, serializeChallenge, deserializeChallenge, noteChallengeEvents } from '../meta/challenges.js';
import { goalProgress, goalMet, starsFor, scoreFor, compareScores, challengeResult, goalText } from '../meta/challengeGoals.js';
import { challengeWorld } from '../meta/challenges.js';
import { challengesUnlocked } from '../meta/challengesState.js';
import { rivalsBordering } from '../meta/challengeSetup.js';
import * as R from '../meta/challengesState.js';
import { CHALLENGE_MODE, DAILY } from '../config/challenges.js';

test('dates: yyyymmdd <-> day index round-trips across months, leap days and years', () => {
  for (let n = dayIndex(20231225); n < dayIndex(20290301); n += 13) assert.equal(dayIndex(fromDayIndex(n)), n);
  assert.equal(addDays(20240228, 1), 20240229);
  assert.equal(addDays(20240229, 1), 20240301);
  assert.equal(addDays(20261231, 1), 20270101);
  assert.equal(addDays(20270101, -1), 20261231);
  assert.ok(isDate(20240229) && !isDate(20230229) && !isDate(20261301) && !isDate('20261004'));
  assert.equal(dailyNumber(DAILY.epoch), 1);
});

test('the Daily: the same date gives the same spec; days vary; a bad date throws', () => {
  const a = dailySpec(20261004);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(dailySpec(20261004))));
  assert.ok(Object.isFrozen(a) && Object.isFrozen(a.goal));
  const days = Array.from({ length: 30 }, (_, i) => dailySpec(addDays(20261004, i)));
  assert.ok(new Set(days.map((s) => s.seed)).size >= 28, 'worlds vary by day');
  assert.ok(new Set(days.map((s) => s.goal.kind)).size === DAILY.goals.length, 'every goal kind turns up in a month');
  assert.ok(new Set(days.map((s) => s.edict)).size >= 5, 'Edicts vary');
  for (const s of days) {
    assert.ok(s.boons.length >= 2 && s.boons.length <= 3 && new Set(s.boons).size === s.boons.length);
    assert.ok(DAILY.generals.includes(s.general.kind));
    const w = generateWorld(s.seed, { ...CHALLENGE_MODE.world, ...(s.edict ? { edict: s.edict } : {}) });
    assert.ok(w.regions.length >= CHALLENGE_MODE.minRegions && w.regions.length <= CHALLENGE_MODE.maxRegions, `${s.date}: small continent`);
  }
  assert.throws(() => dailySpec(20261332));
});

test('the sandbox: its own state and world, never the realm; the spec set up exactly', () => {
  const main = createGame(5, generateWorld(5), 1000);
  const before = serialize(main);
  const spec = dailySpec(20261005);
  const { state, world } = createChallengeGame('daily', spec, { nowMs: 1000 });
  assert.equal(serialize(main), before, 'the main realm is untouched');
  assert.notEqual(state.generals, main.generals);
  assert.equal(world.regions.length, state.owner.length);
  assert.equal(world.ladderSpan, CHALLENGE_MODE.world.ladderSpan);
  assert.equal(state.edict.id, spec.edict);
  assert.deepEqual(state.boons2.owned, spec.boons);
  assert.deepEqual(state.relics.owned, spec.relic ? [spec.relic] : []);
  assert.deepEqual(state.relics.placed, {});
  assert.equal(state.gold, DAILY.start.gold);
  for (const [k, v] of Object.entries(DAILY.start.upgrades)) assert.equal(state.upgrades[k], v);
  const g = state.generals.roster.find((x) => x.kind === spec.general.kind);
  assert.ok(g && g.level === DAILY.generalLevel && g.skills.length === 2);
  assert.equal(challengeSpecOf(state), spec);
  assert.ok(state.tutorial.done);
});

test('the hooks: a challenge folds its own mods (no random raids, no economy), climbs a short ladder, drafts no Boons', () => {
  const g = createChallengeGame('scenario', scenarioSpec('gatekeeper'));
  assert.equal(edictMods(g.state).raids, false);
  assert.equal(edictMods(g.state).incomeMult, 0);
  assert.equal(incomePerSec(g.state, g.world), 0);
  const main = createGame(5, generateWorld(5), 0);
  assert.equal(edictMods(main).raids, true, 'the realm keeps its raids (the memo never leaks)');
  const deepest = Math.max(...g.world.regions.map((r) => enemyDepth(g.world, r)));
  assert.ok(Math.abs(deepest - (1 + 2.5)) < 1e-9, 'gatekeeper ladder 1..3.5');
  g.state.owner.fill(0, 0, 3);
  assert.equal(boonsUnlocked(g.state), false);
});

test('scenarios: six, each in the plan\'s shape; the first two always open, the rest by Codex topic', () => {
  assert.deepEqual(SCENARIO_IDS, ['gatekeeper', 'holdTheLine', 'dragonHunt', 'fallenRise', 'manyFronts', 'kingmaker']);
  for (const id of SCENARIO_IDS) {
    const s = scenarioSpec(id);
    assert.equal(s.stars.length, 3);
    const { state, world } = createChallengeGame('scenario', s);
    const r = state.challenge.resolved;
    if (id === 'gatekeeper') assert.ok(world.regions[r.target].isCapital && world.regions[r.target].twist === 'siege');
    if (id === 'holdTheLine') { assert.equal(r.owned.length, 3); assert.ok(rivalsBordering(world, r.owned).length >= 2, 'two rivals'); }
    if (id === 'dragonHunt') assert.equal(world.regions[r.target].type, 'dragon');
    if (id === 'fallenRise') { assert.equal(world.regions[r.target].faction, 5); assert.ok(world.regions[r.target].isCapital, 'the Barrow Keep'); }
    if (id === 'manyFronts') assert.equal(r.targets.length, 3);
    if (id === 'kingmaker') { assert.ok(world.regions.some((x) => x.type === 'goldmine')); assert.ok(Object.keys(state.relics.placed).length > 0); }
  }
  const none = () => false;
  assert.deepEqual(SCENARIO_IDS.map((id) => scenarioUnlocked(id, none)), [true, true, false, false, false, false]);
  assert.ok(scenarioUnlocked('fallenRise', (t) => t === 'ashen'));
  assert.equal(scenarioUnlocked('dragonHunt', () => { throw new Error('x'); }), false);
  assert.equal(scenarioList(R.defaultRecord(), none).length, 6);
});

test('goals: a one-target goal reads as words, not a counter (Phase 10B: "0/1 taken")', () => {
  const { state, world } = createChallengeGame('scenario', scenarioSpec('gatekeeper'));
  const spec = challengeSpecOf(state);
  assert.equal(spec.goal.kind, 'capital');
  assert.equal(goalProgress(state, world, spec).line, 'Capital: not yet taken');
  state.owner[state.challenge.resolved.target] = 0;
  assert.equal(goalProgress(state, world, spec).line, 'Capital taken');
});

/** A fake finished battle for recordChallengeBattle: every player site held (or not). */
function fakeRun(kind, regionId, held = true) {
  const sites = [{ id: 0, owner: 0 }, { id: 1, owner: 2 }];
  return { kind, regionId, battle: { arena: { sites }, sites: [{ id: 0, owner: held ? 0 : 2 }, { id: 1, owner: 2 }] } };
}

test('goals: survive (a region lost fails), wins (a loss too many fails), stars, scores, the risen count', () => {
  const { state, world } = createChallengeGame('scenario', scenarioSpec('holdTheLine'));
  const spec = challengeSpecOf(state);
  tickChallenge(state, world, 100);
  assert.equal(state.challenge.sent, 2, 'two scripted raids marched by 100 s (30 s, 90 s)');
  assert.ok(state.frontier.incoming.every((r) => r.scripted && state.owner[r.toRegionId] === 0));
  assert.equal(goalProgress(state, world, spec).line, '1:40 / 8:00');
  recordChallengeBattle(state, world, fakeRun('defense', state.challenge.resolved.owned[0], true), 'win');
  tickChallenge(state, world, 400);
  assert.equal(state.challenge.done && state.challenge.done.met, true, 'survived 8:00');
  assert.equal(tickChallenge(state, world, 50).done.atSec, 500, 'the timer stops once done');
  assert.equal(starsFor(state, world, spec), 3, 'every defense unbroken');
  const h = createChallengeGame('scenario', scenarioSpec('holdTheLine'));
  const out = recordChallengeBattle(h.state, h.world, fakeRun('defense', 0, false), 'lose');
  assert.ok(out.justDone && out.done.met === false, 'a lost defense fails it at once');
  const w = createChallengeGame('daily', dailySpec(20261004));
  const ws = { ...challengeSpecOf(w.state), goal: { kind: 'wins', n: 2, max: 1 } };
  w.state.challenge.log.push({ k: 'a', r: 'w', c: 3, u: true, t: 1, region: 1 }, { k: 'a', r: 'l', c: 0, u: false, t: 2, region: 2 });
  assert.equal(goalMet(w.state, w.world, ws), false);
  w.state.challenge.log.push({ k: 'd', r: 'w', c: 0, u: true, t: 3, region: 0 });
  assert.equal(goalMet(w.state, w.world, ws), true);
  assert.ok(compareScores({ met: true, sec: 900 }, { met: false, sec: 10 }) < 0);
  assert.ok(compareScores({ met: true, sec: 300, crowns: 1 }, { met: true, sec: 301, crowns: 9 }) < 0);
  assert.ok(compareScores({ met: true, sec: 300, crowns: 5 }, { met: true, sec: 300, crowns: 2 }) < 0);
  assert.ok(compareScores({ met: true, stars: 2, goal: 'gold', gold: 10, sec: 300 }, { met: true, stars: 2, goal: 'gold', gold: 5, sec: 300 }) < 0);
  assert.ok(compareScores({ met: true, stars: 3, sec: 900 }, { met: true, stars: 2, sec: 10 }) < 0);
  noteChallengeEvents(w.state, [{ type: 'fallenRose', owner: 5, count: 4 }, { type: 'fallenRose', owner: 0, count: 9 }, { type: 'send' }]);
  assert.equal(w.state.challenge.risen, 4);
  assert.equal(scoreFor(w.state, w.world, ws).met, false);
  assert.equal(challengeResult(w.state, w.world, ws).battles.length, 3);
});

test('the challenge save: round-trips under its own key; junk and realm saves are refused', () => {
  assert.notEqual(CHALLENGE_MODE.saveKey, 'hexdominion.v2');
  const g = createChallengeGame('scenario', scenarioSpec('holdTheLine'));
  tickChallenge(g.state, g.world, 40);
  const back = deserializeChallenge(serializeChallenge(g.state));
  assert.deepEqual(back.state.challenge, g.state.challenge);
  assert.ok(back.state.frontier.incoming.length === 1 && back.state.frontier.incoming.every((r) => r.scripted === true && r.mult >= 1));
  assert.equal(back.world.regions.length, g.world.regions.length);
  const realm = serialize(createGame(5, generateWorld(5), 0));
  const bad = [JSON.stringify({ ...g.state, challenge: { ...g.state.challenge, kind: 'x' } }), JSON.stringify({ ...g.state, owner: [0] }), realm];
  for (const junk of ['', '{', 'null', '[]', '{"challenge":{}}', ...bad]) assert.equal(deserializeChallenge(junk), null, junk.slice(0, 30));
  const odd = JSON.parse(serializeChallenge(g.state));
  odd.challenge.log = [{ k: 'zz', r: 5, c: 99, t: -4 }, 7];
  odd.challenge.mods = { raids: 'no', incomeMult: 99, nonsense: true };
  const s = deserializeChallenge(JSON.stringify(odd)).state.challenge;
  assert.deepEqual(s.log, [{ k: 'a', r: 'l', c: 3, u: false, t: 0, region: -1 }]);
  assert.deepEqual(s.mods, { incomeMult: 10 });
});

test('the record: streaks (practice and missed days), first vs best, stars, banners, sanitizer and junk', () => {
  const rec = R.defaultRecord();
  const day = (d, met = true, sec = 600, practice = false, today = d) => R.recordDailyResult(rec, { date: d, met, sec, crowns: 4, practice }, today);
  assert.equal(day(20261001, false, 900).firstAttempt, true);
  assert.equal(day(20261001, true, 700).newBest, true);
  assert.equal(day(20261001, true, 800).newBest, false);
  assert.deepEqual(rec.daily[20261001].first, { met: false, sec: 900, crowns: 4 });
  assert.equal(rec.daily[20261001].best.sec, 700);
  for (let i = 1; i < 7; i++) day(addDays(20261001, i));
  assert.equal(R.dailyStreak(rec.daily, 20261007), 7);
  assert.equal(R.dailyStreak(rec.daily, 20261008), 7, 'today not played yet: the streak is alive');
  assert.equal(R.dailyStreak(rec.daily, 20261009), 0, 'a missed day ends it');
  day(20261005, true, 100, true, 20261020); // a past day replayed as practice: a best, no streak credit
  day(20261009, true, 500, false, 20261010); // played the day after: no streak credit either
  assert.equal(R.dailyStreak(rec.daily, 20261010), 0);
  assert.equal(rec.daily[20261005].best.sec, 100);
  assert.equal(rec.bestStreak, 7);
  assert.deepEqual(R.syncBanners(rec, null), ['ember']);
  assert.deepEqual(R.syncBanners(rec, null), []);
  for (const id of SCENARIO_IDS) R.recordScenarioResult(rec, { id, met: true, stars: 3, sec: 100, crowns: 1, gold: 5, goal: 'x' });
  assert.equal(R.totalStars(rec), 18);
  const mainGold = createGame(5, generateWorld(5), 0);
  mainGold.generals.deeds = { v: 1, progress: { conquer: 300 }, earned: { conqueror: 3 }, news: [] };
  const mainBefore = serialize(mainGold);
  assert.deepEqual(R.syncBanners(rec, mainGold), ['gilded', 'ashenBone']);
  assert.equal(serialize(mainGold), mainBefore, 'the main save is only read');
  assert.equal(R.selectBanner(rec, 'frost'), false, 'locked');
  assert.equal(R.selectBanner(rec, 'gilded'), true);
  assert.equal(R.recordScenarioResult(rec, { id: 'gatekeeper', met: false, stars: 0, sec: 5 }).stars, 3, 'stars never go down');
  assert.deepEqual(R.deserializeRecord(R.serializeRecord(rec)), rec);
  for (const junk of [null, '', 'x', '[]', '{"daily":5,"banners":{"unlocked":["gilded","bogus"],"selected":"bogus"},"rewarded":[1,"a"]}']) {
    const r = R.deserializeRecord(junk);
    assert.ok(r.v === 1 && r.banners.unlocked.includes('plain') && r.banners.selected === 'plain' && R.bannerList(r).length === 5);
  }
});

test('the main-game reward: +1 Renown for today\'s Daily, once per date, never for a past day', () => {
  const rec = R.defaultRecord();
  const main = createGame(5, generateWorld(5), 0);
  const before = main.renown.points;
  assert.equal(R.claimDailyReward(main, rec, 20261004, 20261004), null, 'not completed yet');
  R.recordDailyResult(rec, { date: 20261004, met: true, sec: 600, crowns: 3 }, 20261004);
  assert.deepEqual(R.claimDailyReward(main, rec, 20261004, 20261004), { renown: 1 });
  assert.equal(R.claimDailyReward(main, rec, 20261004, 20261004), null, 'once per date');
  assert.equal(main.renown.points, before + 1);
  R.recordDailyResult(rec, { date: 20261001, met: true, sec: 600, crowns: 3, practice: true }, 20261004);
  assert.equal(R.claimDailyReward(main, rec, 20261001, 20261004), null, 'a past day pays nothing');
  main.edict.id = 'peaceOfCrowns';
  R.recordDailyResult(rec, { date: 20261005, met: true, sec: 600, crowns: 3 }, 20261005);
  assert.deepEqual(R.claimDailyReward(main, rec, 20261005, 20261005), { renown: 1 }, 'Peace of the Crowns does not halve it to nothing');
});

test('share data: the pieces of the share line, and the calendar', () => {
  const rec = R.defaultRecord();
  const result = { kind: 'daily', date: 20261231, met: true, sec: 702.4, crowns: 8, battles: [
    { kind: 'attack', won: true }, { kind: 'attack', won: true }, { kind: 'defense', won: true }, { kind: 'attack', won: false }] };
  R.recordDailyResult(rec, result, result.date);
  const d = R.shareData(result, rec);
  const n = dailyNumber(20261231);
  assert.deepEqual({ ...d }, { title: 'Hex Dominion Daily', number: n, date: 20261231, sec: 702, time: '11:42', crowns: 8,
    crownRating: 3, firstTry: true, attempts: 1, marks: ['attack', 'attack', 'defense', 'loss'], met: true });
  assert.equal(R.shareText(d), `Hex Dominion Daily #${n} · 11:42 · 👑👑👑 · 1st try 🗡️🗡️🛡️✖️`);
  // Phase 10B: the share line and the result card read the same whole seconds (97.6 s was 1:38 in the line and 1:37 on the card)
  assert.equal(R.shareData({ ...result, sec: 97.6 }, rec).time, '1:37');
  assert.equal(R.shareData({ ...result, sec: 59.99 }, rec).time, '0:59');
  const cal = R.dailyCalendar(rec, 20261231, 7);
  assert.equal(cal.length, 7);
  assert.ok(cal[0].today && cal[0].met && cal[0].bestSec === 702.4 && !cal[1].played);
});

test('the hub: goal lines from config with the world names; the Challenges open after the first conquest', () => {
  const cap = Array.from({ length: 20 }, (_, i) => dailySpec(addDays(20261004, i))).find((s) => s.goal.kind === 'capital');
  const w = challengeWorld(cap);
  const line = goalText(cap, w);
  assert.match(line, /^Topple .+'s capital, .+$/);
  assert.ok(!line.includes('{') && !line.includes('the goal'));
  const g = createChallengeGame('daily', cap);
  assert.equal(goalText(cap, g.world, g.state), line, 'the hub card and the HUD agree');
  assert.equal(goalText(scenarioSpec('holdTheLine'), challengeWorld(scenarioSpec('holdTheLine'))), 'Hold every region for 8 minutes');
  const main = createGame(5, generateWorld(5), 0);
  assert.equal(challengesUnlocked(main), false);
  main.stats.regionsConquered = 1;
  assert.equal(challengesUnlocked(main), true);
  assert.equal(challengesUnlocked(null), false);
});
