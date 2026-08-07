import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertBattleConfig, assertBattleOutcome, hashBattleConfig,
  makeMods, CONTRACT_VERSION, DEFAULT_MODS,
} from '../src/battle/contract.js';
import { sampleBattleConfig, sampleOutcome } from './fixtures/battleConfig.sample.js';

test('the golden fixture is valid', () => {
  assert.doesNotThrow(() => assertBattleConfig(sampleBattleConfig()));
});

test('a valid outcome round-trips against its config', () => {
  const cfg = sampleBattleConfig();
  const out = sampleOutcome(hashBattleConfig(cfg));
  assert.doesNotThrow(() => assertBattleOutcome(out, cfg));
});

test('makeMods fills every documented field', () => {
  const m = makeMods();
  for (const k of Object.keys(DEFAULT_MODS)) assert.ok(k in m, `missing ${k}`);
  // Nested objects must be copied, not shared with the frozen default.
  makeMods().expedition.militia = 999;
  assert.equal(DEFAULT_MODS.expedition.militia, 8, 'DEFAULT_MODS must not be mutable via makeMods');
});

test('hashBattleConfig is stable across key reordering', () => {
  const a = sampleBattleConfig();
  const b = { ...sampleBattleConfig() };
  // Rebuild the top level with reversed key order.
  const reordered = {};
  for (const k of Object.keys(b).reverse()) reordered[k] = b[k];
  assert.equal(hashBattleConfig(a), hashBattleConfig(reordered));
});

test('hashBattleConfig changes when the simulation input changes', () => {
  const a = sampleBattleConfig();
  const b = sampleBattleConfig({ seed: 999 });
  assert.notEqual(hashBattleConfig(a), hashBattleConfig(b));
});

// --- each corruption must fail, naming the field -------------------------

const corruptions = {
  'contractVersion': { contractVersion: 99 },
  'battleId': { battleId: '' },
  'seed': { seed: 1.5 },
  'sites (too few)': { sites: [] },
  'player camp missing': {
    sites: sampleBattleConfig().sites.filter((s) => s.kind !== 'camp'),
  },
  'enemy castle missing': {
    sites: sampleBattleConfig().sites.filter((s) => s.kind !== 'castle'),
  },
  'dangling adjacency': { adjacency: [['camp', 'nope']] },
  'self-loop adjacency': { adjacency: [['camp', 'camp']] },
  'rules missing': { rules: undefined },
};

for (const [label, patch] of Object.entries(corruptions)) {
  test(`rejects: ${label}`, () => {
    assert.throws(() => assertBattleConfig(sampleBattleConfig(patch)), TypeError);
  });
}

test('rejects duplicate site ids', () => {
  const cfg = sampleBattleConfig();
  cfg.sites.push({ ...cfg.sites[0] });
  assert.throws(() => assertBattleConfig(cfg), /duplicate id/);
});

test('rejects a negative or non-finite modifier', () => {
  assert.throws(() => assertBattleConfig(sampleBattleConfig({
    player: makeMods({ goldRateMult: -1 }),
  })), /goldRateMult/);
  assert.throws(() => assertBattleConfig(sampleBattleConfig({
    player: makeMods({ trainSpeedMult: NaN }),
  })), /trainSpeedMult/);
});

test('rejects an empty unlockedUnits list', () => {
  assert.throws(() => assertBattleConfig(sampleBattleConfig({
    player: makeMods({ unlockedUnits: [] }),
  })), /unlockedUnits/);
});

// --- outcome validation ---------------------------------------------------

test('rejects an outcome whose configHash does not match', () => {
  const cfg = sampleBattleConfig();
  assert.throws(
    () => assertBattleOutcome(sampleOutcome('deadbeef'), cfg),
    /configHash mismatch/,
  );
});

test('rejects an outcome for a different battle', () => {
  const cfg = sampleBattleConfig();
  const out = sampleOutcome(hashBattleConfig(cfg), { battleId: 'other' });
  assert.throws(() => assertBattleOutcome(out, cfg), /battleId/);
});

test('battle must not compute its own rewards', () => {
  // Economy math belongs in meta/rewards.js and nowhere else. The validator
  // actively enforces the split so the two engineers cannot duplicate it.
  const cfg = sampleBattleConfig();
  const out = sampleOutcome(hashBattleConfig(cfg), { rewards: { crowns: 500 } });
  assert.throws(() => assertBattleOutcome(out, cfg), /meta\/rewards\.js owns it/);
});

test('rejects an unknown result string', () => {
  const cfg = sampleBattleConfig();
  const out = sampleOutcome(hashBattleConfig(cfg), { result: 'draw' });
  assert.throws(() => assertBattleOutcome(out, cfg), /result/);
});
