// THE LIFETIME RECORD, and the reason it is a module rather than a screen.
//
// `meta.stats` counted thirteen things on every battle for most of this
// project's life and nothing displayed one of them. The drawer that fixes that
// (screens/mainmenu-record.js) computes NOTHING — every figure comes from
// meta/record.js — so this file can state what each one means without opening a
// menu, and a wrong number is a failing test rather than something a player
// squints at.
//
// The assertions that matter are the EDGES, not the arithmetic. A fresh save,
// a save that has only ever won, and a save whose counters do not add up are
// all real states, and each has a right answer that is not "0".
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  winRate, withdrawals, killRatio, awayShare, crownsNet, recordView,
} from '../src/meta/record.js';
import { createStats, createState } from '../src/core/store.js';
import { applyOutcome } from '../src/meta/rewards.js';
import { tick, applyOfflineProgress } from '../src/meta/idle.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { CONTRACT_VERSION, hashBattleConfig } from '../src/battle/contract.js';

test('record: a fresh save has no ratios, and says so with null rather than zero', () => {
  const s = createStats();
  // NULL, NOT 0. "0% win rate" is a claim about a player who has fought and
  // lost; a new save has not fought. The drawer renders null as an em dash.
  assert.equal(winRate(s), null);
  assert.equal(killRatio(s), null);
  assert.equal(awayShare(s), null);
  assert.equal(recordView(s).empty, true, 'a save with nothing in it must announce itself');
});

test('record: win rate is over BATTLES, so a withdrawal is not counted as a loss', () => {
  // meta/rewards.js increments `losses` for a loss OR a timeout. A withdrawal
  // is a battle that is neither, so wins + losses < battles and the gap is
  // real. Computing `wins / (wins + losses)` would quietly flatter every
  // player who has ever pulled out of a fight.
  const s = { ...createStats(), battles: 10, wins: 4, losses: 3 };
  assert.equal(winRate(s), 0.4);
  assert.equal(withdrawals(s), 3);
  assert.notEqual(winRate(s), 4 / 7, 'win rate must not be taken over decided battles only');
});

test('record: a flawless record reads as unknown, not as infinity', () => {
  // A player who has killed without losing anybody divides by zero. "∞ : 1"
  // reads as a bug rather than as a perfect record, so the ratio is withheld
  // and the two raw counts underneath it tell the story instead.
  const s = { ...createStats(), unitsKilled: 500, unitsLost: 0 };
  assert.equal(killRatio(s), null);
  const v = recordView(s);
  assert.equal(v.unitsKilled, 500);
  assert.equal(v.unitsLost, 0);

  // NEGATIVE CONTROL: one loss and the ratio appears.
  assert.equal(killRatio({ ...s, unitsLost: 250 }), 2);
});

test('record: negative and non-finite counters cannot reach the screen', () => {
  // A hand-edited save, or one written by a build where a counter was briefly
  // a string (core/store.js documents that exact incident: `stats.playMs +=
  // dtMs` became string concatenation at 10Hz). `fromPersisted` heals these,
  // but this layer must not depend on having been healed.
  const junk = {
    battles: -5, wins: NaN, losses: undefined, unitsKilled: '40', unitsLost: 10,
    crownsEarned: Infinity, crownsSpent: -1, playMs: -1000, offlineMsClaimed: NaN,
  };
  const v = recordView(junk);
  for (const [k, n] of Object.entries(v)) {
    if (typeof n !== 'number') continue;
    assert.ok(Number.isFinite(n) && n >= 0, `${k} reached the screen as ${n}`);
  }
  assert.equal(v.winRate, null, 'a save with no valid battles has no win rate');
});

test('record: the away share is a share of TIME, and it is the idle half made visible', () => {
  const s = { ...createStats(), playMs: 3600_000, offlineMsClaimed: 3600_000 };
  assert.equal(awayShare(s), 0.5);
  // It is deliberately NOT an income share: nothing counts offline CROWNS
  // separately, and reconstructing one from a rate that changes every time a
  // region is taken would be a number that looks exact and is not.
  assert.equal(awayShare({ ...s, crownsEarned: 999999 }), 0.5,
    'the away share must not move when income moves — it is a claim about time');
});

test('record: crownsNet is earned minus spent, and may legitimately be negative', () => {
  assert.equal(crownsNet({ crownsEarned: 100, crownsSpent: 30 }), 70);
  // Abdication keeps `stats` and zeroes the purse, so a second run can have
  // spent more than IT earned. That is a true statement about a lifetime, not
  // an error to clamp away.
  assert.equal(crownsNet({ crownsEarned: 10, crownsSpent: 90 }), -80);
});

// ---------------------------------------------------------------------------
// ...and the half that matters more: the counters are actually WRITTEN
// ---------------------------------------------------------------------------

test('record: a real battle and a real idle tick move the numbers the drawer reads', () => {
  // THE FAILURE THIS GUARDS is the one this project has already refunded four
  // shop upgrades for: a surface that displays a field nobody increments. Every
  // figure in the drawer is checked here against the REAL writers rather than
  // against a hand-built stats object.
  const state = createState({ seed: 3, now: 0 });
  const meta = state.meta;
  const before = recordView(meta.stats);
  assert.equal(before.battles, 0);

  // Through the REAL seam — buildBattleConfig + a valid BattleOutcome — rather
  // than a hand-built pair, for the reason tests/seam.test.js exists: a fixture
  // that skips the validator is a fixture that can encode the bug.
  const cfg = buildBattleConfig(meta, 'riverfen', [], generateBattleMap, { seed: 3 });
  applyOutcome(meta, cfg, {
    contractVersion: CONTRACT_VERSION,
    battleId: cfg.battleId,
    configHash: hashBattleConfig(cfg),
    regionId: 'riverfen',
    result: 'win',
    durationMs: 60_000,
    ticks: 600,
    stats: {
      sitesHeld: 11, sitesTotal: 11, unitsLost: 12, unitsKilled: 30,
      goldEarned: 900, peakArmy: 40,
    },
    boostersConsumed: [],
  }, { now: 1000 });

  const after = recordView(meta.stats);
  assert.equal(after.battles, 1, 'applyOutcome did not count the battle');
  assert.equal(after.wins, 1);
  assert.equal(after.unitsLost, 12);
  assert.equal(after.unitsKilled, 30);
  assert.equal(after.winRate, 1);
  assert.equal(after.killRatio, 2.5);
  assert.ok(after.crownsEarned > 0, 'a won region paid nothing');

  // The two time counters have different writers and both feed `awayShare`.
  tick(state, 5000, 5000, null);
  assert.ok(recordView(meta.stats).playMs >= 5000, 'the play clock is not running');
  state.lastSeenAt = 0;
  applyOfflineProgress(state, 3600_000, 3600_000, null);
  const t = recordView(meta.stats);
  assert.ok(t.offlineMsClaimed > 0, 'time away was never credited');
  assert.ok(t.awayShare > 0 && t.awayShare < 1, `away share out of range: ${t.awayShare}`);
  assert.equal(t.empty, false);
});
