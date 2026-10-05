// Phase 9 (PLAN-PHASE9 tests): the challenges are completable, proved by playing them with the headless challenge bot
// (tools/challengeBot.mjs: the real sim, enemy AI, battle bot and the Steward; the clock is active play at 1x).
//   - 30 consecutive dates' Dailies are all completed, each within DAILY_MAX_SEC of active play
//   - each scenario's goal is met, and its 3 stars are reached (so 3 stars are reachable)
//   - 3 stars are demanding: the same scenarios played carelessly (one battle at a time, or with a weaker army) fall short
import test from 'node:test';
import assert from 'node:assert/strict';
import { playChallenge } from '../../tools/challengeBot.mjs';
import { createChallengeGame } from '../meta/challenges.js';
import { dailySpec } from '../meta/daily.js';
import { scenarioSpec, SCENARIO_IDS } from '../meta/scenarios.js';
import { addDays } from '../meta/dates.js';

const DAILY_MAX_SEC = 20 * 60; // "a sensible time": the bot's slowest of these 30 days is about 15 minutes (median about 4.5)

test('the Daily: 30 consecutive dates are each completed by the bot in under 20 minutes of active play', () => {
  const rows = [];
  for (let i = 0; i < 30; i++) {
    const date = addDays(20261004, i);
    const out = playChallenge(createChallengeGame('daily', dailySpec(date)));
    rows.push({ date, goal: out.result.goal, met: out.result.met, sec: Math.round(out.sec) });
  }
  const bad = rows.filter((r) => !r.met || r.sec > DAILY_MAX_SEC);
  assert.deepEqual(bad, [], JSON.stringify(bad));
  const goals = new Set(rows.map((r) => r.goal));
  assert.equal(goals.size, 4, 'conquer, capital, wins and holdout all turn up');
});

test('the same Daily played twice gives the same result (deterministic sandbox)', () => {
  const a = playChallenge(createChallengeGame('daily', dailySpec(20261007)));
  const b = playChallenge(createChallengeGame('daily', dailySpec(20261007)));
  assert.deepEqual(a.result, b.result);
});

for (const id of SCENARIO_IDS) {
  test(`scenario ${id}: the bot meets the goal and earns all 3 stars`, () => {
    const spec = scenarioSpec(id);
    const out = playChallenge(createChallengeGame('scenario', spec), { concurrent: spec.botConcurrent });
    assert.equal(out.result.met, true, JSON.stringify(out.result));
    assert.equal(out.result.stars, 3, JSON.stringify({ ...out.result, battles: undefined }));
  });
}

test('3 stars are demanding: careless play falls short of them', () => {
  // Many Fronts one battle at a time: the three wins take too long for the 3-star mark
  const mf = scenarioSpec('manyFronts');
  assert.ok(playChallenge(createChallengeGame('scenario', mf), { concurrent: 1 }).result.stars < 3, 'many fronts sequentially');
  // the others with a weaker army (levels off each core upgrade) miss the third star
  for (const [id, off] of [['gatekeeper', 2], ['dragonHunt', 2], ['fallenRise', 4], ['holdTheLine', 2]]) {
    const s = scenarioSpec(id);
    const up = { ...s.start.upgrades };
    for (const k of ['recruitment', 'steel', 'armour', 'muster']) up[k] = Math.max(0, up[k] - off);
    const weak = { ...s, start: { ...s.start, upgrades: up } };
    const out = playChallenge(createChallengeGame('scenario', weak), { concurrent: 1, maxSec: 900 });
    assert.ok(out.result.stars < 3, `${id} weaker: ${out.result.stars} stars`);
  }
});
