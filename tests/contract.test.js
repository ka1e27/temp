import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertBattleConfig, assertBattleOutcome, hashBattleConfig,
  makeMods, CONTRACT_VERSION, DEFAULT_MODS,
} from '../src/battle/contract.js';
import { SITE_LEVELS } from '../src/content/balance.js';
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

// --- the untrusted boundary ----------------------------------------------
//
// `meta/resume.js steppable()` calls `assertBattleConfig` deliberately, as the
// shield over `hexdominion.battle` — a hand-editable localStorage key. Everything
// below was ACCEPTED by the validator and then either corrupted live sim state or
// threw a raw TypeError from two files further in, which is the one thing this
// seam exists to stop: an error that names the field, or nothing at all.
//
// The asymmetry that gave them away is worth keeping in mind when adding a field:
// the OPTIONAL, cosmetic `unitMult` validated its keys against `UNIT_IDS` and its
// values as finite and non-negative, while `expedition` — the army that lands on
// tick 0 — got `typeof === 'object'` and nothing else.

test('rejects a non-numeric expedition count', () => {
  // Accepted before, and `battle/state.js` builds the garrison with `+=`, so the
  // live simulation held the STRING "0lots" as a headcount: every comparison
  // false, every sum NaN, a garrison that can neither fight nor be killed.
  assert.throws(() => assertBattleConfig(sampleBattleConfig({
    player: makeMods({ expedition: { militia: 'lots' } }),
  })), /expedition\.militia/);
});

test('rejects a negative or fractional expedition count', () => {
  assert.throws(() => assertBattleConfig(sampleBattleConfig({
    player: makeMods({ expedition: { militia: -50 } }),
  })), /expedition\.militia/);
  assert.throws(() => assertBattleConfig(sampleBattleConfig({
    player: makeMods({ expedition: { militia: 2.5 } }),
  })), /expedition\.militia/);
});

test('rejects an unknown unit in the expedition', () => {
  // A typo'd id is silently zero troops otherwise — a battle lost for a reason
  // nothing anywhere reports.
  assert.throws(() => assertBattleConfig(sampleBattleConfig({
    player: makeMods({ expedition: { militai: 8 } }),
  })), /unknown unit "militai"/);
});

// A SITE'S GARRISON IS AN ARMY AND WAS VALIDATED LIKE A LABEL — the same hole
// as `expedition` above, one field over, and it survived the pass that closed
// that one. `battle/state.js` seeds a site as `{...emptyComp(), ...s.garrison}`,
// so a bad value does not merge with the zero, it REPLACES it.
//
// The fixture is FROZEN, so these mutate the config it hands back rather than
// growing it a second parameter.
const withGarrison = (g) => {
  const c = sampleBattleConfig();
  if (g === undefined) delete c.sites[0].garrison;
  else c.sites[0].garrison = g;
  return c;
};

test('rejects a non-numeric garrison count on a site', () => {
  assert.throws(() => assertBattleConfig(withGarrison({ militia: 'lots' })),
    /garrison\.militia/);
});

test('rejects a negative, fractional or unknown garrison entry', () => {
  for (const bad of [{ militia: -3 }, { militia: 1.5 }, { militai: 3 }]) {
    assert.throws(() => assertBattleConfig(withGarrison(bad)), /garrison/,
      `accepted ${JSON.stringify(bad)}`);
  }
});

test('a well-formed garrison is still accepted, present or absent', () => {
  // The negative control. A validator that refused every garrison would pass
  // all three tests above and break every real config in the game.
  assert.doesNotThrow(() => assertBattleConfig(withGarrison({ militia: 4, spearmen: 2 })));
  assert.doesNotThrow(() => assertBattleConfig(withGarrison(undefined)));
});

test('rejects a hardCapMs that is not finite', () => {
  // `Infinity > 0` is true, so the one rule guaranteeing a battle ENDS was
  // satisfied by the value that means it never does.
  for (const cap of [Infinity, NaN, '480000']) {
    assert.throws(() => assertBattleConfig(sampleBattleConfig({
      rules: { victory: 'capture-castle', hardCapMs: cap, aiTier: 1 },
    })), /hardCapMs/, `hardCapMs ${cap} was accepted`);
  }
});

test('rejects a site level off the upgrade ladder', () => {
  // `battle/state.js` indexes `SITE_LEVELS[level - 1]` for hpMax, so both of
  // these used to throw `TypeError: reading 'hp'` deep inside
  // `createBattleState` — after the seam had declared the config valid.
  for (const level of [0, 99, 1.5, '2']) {
    const cfg = sampleBattleConfig();
    cfg.sites[1].level = level;
    assert.throws(() => assertBattleConfig(cfg), /sites\[f1\]\.level/, `level ${level} was accepted`);
  }
  // ...and ABSENT is still fine: every hand-built fixture omits it and means 1.
  const ok = sampleBattleConfig();
  assert.equal(ok.sites[1].level, undefined);
  assert.doesNotThrow(() => assertBattleConfig(ok));
  ok.sites[1].level = SITE_LEVELS.length;
  assert.doesNotThrow(() => assertBattleConfig(ok), 'the top of the ladder must be legal');
});

test('a missing or absurd grid is an error, not a crash', () => {
  // `core/hex.js inGrid` reads `grid.rows` unguarded, so no grid at all threw an
  // uncaught TypeError out of the middle of the site loop.
  assert.throws(() => assertBattleConfig(sampleBattleConfig({ grid: undefined })), /grid:/);
  for (const bad of [{ cols: '9', rows: 9 }, { cols: 1e9, rows: 9 }, { cols: 0, rows: 9 },
    { cols: 11, rows: -1 }, { cols: 11.5, rows: 9 }]) {
    assert.throws(
      () => assertBattleConfig(sampleBattleConfig({ grid: bad })),
      /grid\.(cols|rows)/,
      `grid ${JSON.stringify(bad)} was accepted`,
    );
  }
});

test('a bad grid does not swallow the rest of the report', () => {
  // The site-off-map check is SKIPPED when the grid is unusable (there is nothing
  // to check against), but every other field must still be validated in the same
  // pass — the seam reports every fault at once or it costs a round trip each.
  assert.throws(() => assertBattleConfig(sampleBattleConfig({
    grid: undefined, battleId: '',
  })), /battleId/);
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
