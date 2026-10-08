// PLAN-PHASE15 (Honest labels): the card's calibration (progression.js calibrateRatio, DIFFICULTY.calibration). Pure checks here; the
// audit against real fights is balance.audit.test.js (fast) and tools/labelAudit.mjs (full).
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/generate.js';
import { createGame } from '../meta/state.js';
import { difficulty, frontier, calibrateRatio, winChance } from '../meta/progression.js';
import { DIFFICULTY, ECONOMY } from '../config/meta.js';
import { createChallengeGame } from '../meta/challenges.js';
import { dailySpec } from '../meta/daily.js';

const CAL = DIFFICULTY.calibration;
const CTXS = [];
for (let d = 1; d <= 9; d++) {
  for (const personality of ['passive', 'aggressive', 'defensive', 'swarm', 'undying', 'raider', 'usurper', 'unknown']) {
    for (const twist of [null, 'night', 'blizzard', 'flooded', 'holy', 'siege', 'raid']) {
      CTXS.push({ dynasty: d, crown: d === 7 && twist === 'siege', ascension: d % 11, personality, twist, type: [null, 'goldmine', 'monastery', 'bandit', 'ruins', 'dragon'][d % 6], capital: twist === 'siege', throne: d === 8 && personality === 'usurper', tier: d % 9 });
    }
  }
}

test('calibration: every factor documented in config is a positive finite number; every dynasty row is [exponent, factor]', () => {
  assert.ok(CAL.dynasty.length >= 7);
  for (const [e, k] of CAL.dynasty) assert.ok(e > 0 && e <= 1.5 && k > 0 && Number.isFinite(k), `[${e}, ${k}]`);
  for (const k of ['crown', 'ascensionPerLevel', 'capital', 'throne']) assert.ok(CAL[k] > 0 && Number.isFinite(CAL[k]), k);
  for (const g of ['personality', 'twist', 'type', 'tier', 'tierExp', 'ceiling']) for (const [id, v] of Object.entries(CAL[g])) assert.ok(v > 0 && Number.isFinite(v), `${g}.${id}`);
  for (const id of Object.keys(CAL.personality)) assert.ok(id in DIFFICULTY.personality, `calibration.personality.${id} is a real personality`);
});

test('calibrateRatio: monotonic in the raw ratio for one region (a stronger army never reads worse), safe on odd input', () => {
  for (const ctx of CTXS) {
    let prev = -1;
    for (let raw = 0.02; raw < 20; raw *= 1.05) {
      const q = calibrateRatio(raw, ctx);
      assert.ok(Number.isFinite(q) && q > 0, `${JSON.stringify(ctx)} raw ${raw}: ${q}`);
      assert.ok(q >= prev - 1e-12, `${JSON.stringify(ctx)}: not monotonic at raw ${raw.toFixed(3)}`);
      prev = q;
    }
    assert.equal(calibrateRatio(Infinity, ctx), Infinity);
    assert.equal(calibrateRatio(0, ctx), 0);
    assert.ok(Number.isNaN(calibrateRatio(NaN, ctx)));
  }
});

test('calibrateRatio: an identity calibration returns the raw ratio; the Holy Ground ceiling keeps it from ever reading Easy', () => {
  const identity = { dynasty: [[1, 1]], crown: 1, ascensionPerLevel: 1, capital: 1, throne: 1, personality: {}, twist: {}, type: {}, tier: {} };
  for (const raw of [0.1, 0.9, 1.3, 2.5, 7]) assert.equal(calibrateRatio(raw, CTXS[5], identity), raw);
  const easy = ECONOMY.difficultyLabels[0].min;
  for (const ctx of CTXS.filter((c) => c.twist === 'holy')) assert.ok(calibrateRatio(1e6, ctx) < easy, 'Holy Ground tops out below Easy');
  assert.ok(winChance(calibrateRatio(1e6, CTXS.find((c) => c.twist === 'holy'))) < DIFFICULTY.winAtLabelEdge.Easy);
});

test('difficulty(): the label, chance and strength bar read the calibrated ratio; surrender reads the raw one', () => {
  let n = 0;
  for (const seed of [1, 2, 3]) {
    const world = generateWorld(seed);
    const state = createGame(seed, world, 0);
    state.stats.battlesWon = 1;
    for (const muster of [0, 10, 40, 400]) {
      state.upgrades = { ...state.upgrades, muster };
      for (const id of frontier(state, world)) {
        const d = difficulty(state, world, id);
        const region = world.regions[id];
        const ctx = { dynasty: 1, crown: false, ascension: 0, personality: world.factions[region.faction].personality, twist: region.twist || null, type: region.type || null, capital: !!region.isCapital, throne: false, tier: region.tier };
        assert.ok(Math.abs(d.ratio - calibrateRatio(d.rawRatio, ctx)) < 1e-9 * Math.max(1, d.ratio));
        assert.equal(d.winChance, winChance(d.ratio));
        assert.ok(Math.abs(d.power / d.strength - d.ratio) < 1e-9 * Math.max(1, d.ratio), 'the bars agree with the label');
        assert.ok(Math.abs(d.power / d.rawStrength - d.rawRatio) < 1e-9 * Math.max(1, d.rawRatio));
        assert.equal(d.surrender, d.rawRatio >= ECONOMY.surrenderRatio, 'surrender at the raw line');
        n += 1;
      }
    }
  }
  assert.ok(n >= 30, `${n} cards`);
});

test('difficulty(): a challenge continent keeps the raw card (its short ladder was tuned on it)', () => {
  const g = createChallengeGame('daily', dailySpec(20261007));
  const { state, world } = g;
  const ids = frontier(state, world);
  assert.ok(ids.length > 0);
  for (const id of ids) {
    const d = difficulty(state, world, id);
    assert.equal(d.ratio, d.rawRatio);
  }
});
