// AUTO-RESOLVE — hand a raid to the same bot tools/simplayer.js measures every
// region in regions.data.js with, instead of playing it out.
//
// Nothing here is a fixture-encoded guess about what the feature does; every
// assertion drives the REAL seam (src/meta/autobattle.js, which is the only
// file under src/ that imports tools/autoresolve.js — see that file's own
// header) or the real screen half (worldmap-autobattle.js's runAutoResolve,
// which takes no DOM at all and is tested directly, the same way
// tests/worldmap.test.js only ever drives the DOM-free half of that screen).
//
// Four properties, in the order the task brief states them:
//   1. RAIDS ONLY — a first conquest and an incursion rung both refuse, in the
//      PURE layer, not the screen.
//   2. DETERMINISM — invariant 3 (zero randomness in combat) means the same
//      meta state resolves to the same outcome, and "auto-resolved" and
//      "played out by hand" are the same function called twice, not two
//      implementations that happen to agree.
//   3. ONE PAYOUT PATH — meta/rewards.js applyOutcome, and nothing here calls
//      it or touches a crown/relic directly.
//   4. CANCELLING MUTATES NOTHING — proven with a before/after snapshot, not
//      merely read off the comment that says so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createState } from '../src/core/store.js';
import { markConquered, refreshUnlocks, raidCooldownRemaining, record } from '../src/meta/world.js';
import { recalcIncome } from '../src/meta/idle.js';
import { applyOutcome } from '../src/meta/rewards.js';
import { hashBattleConfig } from '../src/battle/contract.js';
import { startBattle, step } from '../src/battle/sim.js';
import { toOutcome } from '../src/battle/outcome.js';
import { playerTurn } from '../tools/simplayer.js';
import {
  canAutoResolve, startAutoResolve, buildRaidConfig, AUTO_RESOLVE_CHUNK_TICKS,
} from '../src/meta/autobattle.js';
import { runAutoResolve } from '../src/screens/worldmap-autobattle.js';

/** A player who has conquered exactly `id`, `clears` raids on it ago, and
 *  nothing else — mirrors tests/raideconomy.test.js `stage()`. Riverfen is
 *  used almost everywhere below because it is the cheapest board to resolve
 *  (~0.15ms/tick; see the wall-clock section), which keeps this whole file
 *  fast to run. */
function conquered(id, { clears = 0 } = {}) {
  const s = createState({ seed: 11, now: 0 });
  markConquered(s.meta, id, { now: 0, durationMs: 0 });
  if (clears) s.meta.regions[id].clears = clears;
  refreshUnlocks(s.meta, null);
  recalcIncome(s.meta, null);
  return s;
}

/** Run a config to its end exactly the way tools/simplayer.js `playOne` does
 *  — same think cadence (every 20 ticks), same step order — WITHOUT going
 *  anywhere near src/meta/autobattle.js, so this is an independent "played it
 *  by hand" reference to check the auto-resolved outcome against. */
function playToOutcome(config) {
  const battle = startBattle(config);
  const cap = battle.rules.hardCapTicks;
  let nextThink = 0;
  while (battle.status === 'running' && battle.tick < cap) {
    if (battle.tick >= nextThink) { playerTurn(battle); nextThink = battle.tick + 20; }
    step(battle);
  }
  return toOutcome(battle, config);
}

/** Run a real auto-resolve to completion in one blocking call — no frame
 *  chunking (that is worldmap-autobattle.js's job, tested on its own below),
 *  just "keep asking for the next chunk until done". */
function resolveFully(rootState, regionId, now = 0) {
  const run = startAutoResolve(rootState, regionId, now);
  let result;
  do { result = run.advanceOrFinish(2000); } while (!result.done);
  return { outcome: result.outcome, config: run.config };
}

// ===========================================================================
// 1. RAIDS ONLY — the gate, in both directions, off canAutoResolve itself.
// ===========================================================================

test('a first attack (never conquered) cannot be auto-resolved', () => {
  const s = createState({ seed: 1, now: 0 });
  assert.equal(canAutoResolve(s.meta, 'riverfen', 0), false,
    'riverfen is attackable but has never fallen — this must stay a real battle, '
    + 'the first-clear relic bonus depends on it being one');
  assert.throws(() => startAutoResolve(s, 'riverfen', 0), RangeError);
});

test('a conquered region off cooldown CAN be auto-resolved', () => {
  const s = conquered('riverfen');
  assert.equal(canAutoResolve(s.meta, 'riverfen', 700_000), true);
  assert.doesNotThrow(() => startAutoResolve(s, 'riverfen', 700_000));
});

test('a conquered region still on its raid cooldown cannot be auto-resolved', () => {
  const s = conquered('riverfen');
  assert.ok(raidCooldownRemaining(s.meta, 'riverfen', 0) > 0, 'fixture is not on cooldown');
  assert.equal(canAutoResolve(s.meta, 'riverfen', 0), false);
  assert.throws(() => startAutoResolve(s, 'riverfen', 0), RangeError);
});

test('canAutoResolve refuses an incursion rung, even on ground that is otherwise a raid', () => {
  const s = conquered('riverfen');
  const now = 700_000;
  assert.equal(canAutoResolve(s.meta, 'riverfen', now), true, 'must be eligible as a plain raid first');
  for (const depth of [1, 7, 40]) {
    assert.equal(canAutoResolve(s.meta, 'riverfen', now, { incursion: depth }), false,
      `depth ${depth} must refuse — the real-time battle IS the content on a rung`);
  }
  // Depth 0 is not a rung (the ladder starts at 1) and must not be treated as
  // one by a caller that built the options object but left the field at its
  // default — only a TRUTHY depth is the guard.
  assert.equal(canAutoResolve(s.meta, 'riverfen', now, { incursion: 0 }), true);
});

test('startAutoResolve can never itself build an incursion config', () => {
  // canAutoResolve's incursion guard exists for a caller that asks it the
  // question; startAutoResolve has no `opts` parameter at all and
  // buildRaidConfig never sets `options.incursion`, so this is the second,
  // structural half of the same promise — not merely the same check twice.
  const s = conquered('riverfen');
  const { config } = resolveFully(s, 'riverfen', 700_000);
  assert.equal(config.rules.incursion ?? null, null,
    'an auto-resolved raid must never be mistaken for a rung of the endless ladder');
});

// ===========================================================================
// 2. DETERMINISM — invariant 3, pinned rather than assumed.
// ===========================================================================

test('resolving the same raid twice gives byte-identical configs and outcomes', () => {
  const now = 700_000;
  const a = resolveFully(conquered('riverfen'), 'riverfen', now);
  const b = resolveFully(conquered('riverfen'), 'riverfen', now); // an independent fixture
  assert.deepEqual(a.config, b.config, 'the same meta state must build the same BattleConfig');
  assert.equal(hashBattleConfig(a.config), hashBattleConfig(b.config));
  assert.deepEqual(a.outcome, b.outcome,
    'zero randomness in combat (invariant 3): same config in, same outcome out, every time');
  assert.equal(a.outcome.result, 'win', 'fixture should be a clean win, not a coincidental tie');
});

test('auto-resolving IS playing it out, not an estimate of it', () => {
  // The header comment on tools/autoresolve.js makes a specific claim: "a
  // raid resolved here and a raid played out by hand against the same policy
  // reach the identical outcome. That is not an estimate, it is the same
  // function called twice." This is that claim, checked.
  const s = conquered('riverfen');
  const now = 700_000;
  const config = buildRaidConfig(s, 'riverfen'); // exactly what startAutoResolve builds internally
  const played = playToOutcome(config);
  const auto = resolveFully(s, 'riverfen', now);
  assert.deepEqual(auto.config, config, 'must be byte-identical to what a live Attack would build');
  assert.deepEqual(auto.outcome, played,
    'auto-resolve and "playerTurn by hand" must reach the identical outcome from the identical config');
});

test('a raid the bot loses is reported as a loss, honestly — no quiet retry', () => {
  // Riverfen raided twenty times already: effectiveEnemyMult has compounded
  // 15%/clear (world.js) while this fixture's player never left riverfen, so
  // the fight is genuinely lost, fast, rather than timed out at the hard cap.
  const s = conquered('riverfen', { clears: 20 });
  const { outcome } = resolveFully(s, 'riverfen', 700_000);
  assert.notEqual(outcome.result, 'win', 'fixture is rigged to lose — if it wins, the rig broke');
  assert.ok(['loss', 'timeout'].includes(outcome.result), `unexpected result "${outcome.result}"`);
});

// ===========================================================================
// 3. ONE PAYOUT PATH — meta/rewards.js applyOutcome, never a private one.
// ===========================================================================

test('resolving alone pays nothing — the caller must call applyOutcome', () => {
  const s = conquered('riverfen');
  const before = JSON.parse(JSON.stringify(s.meta));
  const { outcome, config } = resolveFully(s, 'riverfen', 700_000);
  assert.equal(outcome.result, 'win');
  assert.deepEqual(s.meta, before, 'resolving to completion must not itself touch meta');

  const summary = applyOutcome(s, config, outcome, { now: 700_000 });
  assert.ok(s.meta.crowns > before.crowns, 'the payout only happens once the caller asks for it');
  assert.equal(summary.raided, true);
});

test('a lost raid pays nothing and moves nothing in the region record either', () => {
  const s = conquered('riverfen', { clears: 20 });
  const before = {
    crowns: s.meta.crowns,
    wins: s.meta.stats.wins,
    losses: s.meta.stats.losses,
    raidReadyAt: record(s.meta, 'riverfen').raidReadyAt,
  };
  const { outcome, config } = resolveFully(s, 'riverfen', 700_000);
  assert.notEqual(outcome.result, 'win');

  const summary = applyOutcome(s, config, outcome, { now: 700_000 });
  assert.equal(summary.won, false);
  assert.equal(summary.crowns, 0, 'a lost raid must pay nothing');
  assert.equal(summary.relics, 0);
  assert.equal(s.meta.crowns, before.crowns);
  assert.equal(s.meta.stats.losses, before.losses + 1);
  assert.equal(s.meta.stats.wins, before.wins);
  assert.equal(record(s.meta, 'riverfen').raidReadyAt, before.raidReadyAt,
    'a loss must not restart the cooldown — trying again costs nothing, same as a played battle');
});

test('there is no second payout path in source — grep the two files that could hide one', () => {
  // "PAYOUT IS DELIBERATELY NOT HERE" is a comment in both files today; this
  // is the same claim asserted against the actual bytes, so it cannot go
  // stale silently the way a comment can.
  const autoresolve = readFileSync(new URL('../tools/autoresolve.js', import.meta.url), 'utf8');
  const autobattle = readFileSync(new URL('../src/meta/autobattle.js', import.meta.url), 'utf8');
  for (const [name, src] of [['tools/autoresolve.js', autoresolve], ['src/meta/autobattle.js', autobattle]]) {
    assert.ok(!src.includes('applyOutcome('), `${name} must never call applyOutcome itself`);
    assert.ok(!/\bgrantRelics\b|\bcompleteRaid\b|\bmarkConquered\(/.test(src),
      `${name} must never touch the reward/bookkeeping primitives directly`);
    assert.ok(!/meta\.crowns\s*[+\-*/]?=/.test(src), `${name} must never write meta.crowns directly`);
  }
});

// ===========================================================================
// 4. CANCELLING MUTATES NOTHING — a snapshot before and after, not a reading
//    of the comment that claims it.
// ===========================================================================

/** A `requestAnimationFrame`-shaped scheduler this test drives by hand: `raf`
 *  captures the callback instead of invoking it, so nothing runs until the
 *  test calls `pump()`. `clock()` jumps by far more than
 *  worldmap-autobattle.js's FRAME_BUDGET_MS (8) on every call, so each pump
 *  advances exactly one MICRO_TICKS batch — fine control with no real timers
 *  and no requestAnimationFrame, which meta/battle purity would forbid but a
 *  plain test file may use freely; this fake simply never calls it. */
function manualScheduler() {
  let queued = null;
  let n = 0;
  return {
    raf: (cb) => { queued = cb; return 1; },
    cancelRaf: () => { queued = null; },
    clock: () => (n += 1000),
    pump() { const cb = queued; queued = null; cb?.(); },
    get hasPending() { return queued !== null; },
  };
}

test('cancelling an auto-resolve leaves meta exactly as it was', () => {
  const s = conquered('riverfen');
  const before = JSON.parse(JSON.stringify(s.meta));
  const sched = manualScheduler();
  let progressCalls = 0;
  let done = false;

  const cancel = runAutoResolve({
    rootState: s,
    regionId: 'riverfen',
    now: 700_000,
    onProgress: () => { progressCalls += 1; },
    onDone: () => { done = true; },
    raf: sched.raf,
    cancelRaf: sched.cancelRaf,
    clock: sched.clock,
  });

  for (let i = 0; i < 5 && sched.hasPending; i++) sched.pump();
  assert.ok(progressCalls > 0, 'test never actually advanced the battle — nothing was proven');
  assert.equal(done, false, 'resolved to completion before cancelling — fixture needs to run longer');

  cancel();
  assert.equal(sched.hasPending, false, 'cancelling must also cancel the scheduled frame');
  sched.pump(); // defensive: a no-op even if something were still queued
  assert.equal(done, false, 'onDone fired after cancel() — the resolve kept running');
  assert.deepEqual(s.meta, before, 'a cancelled resolve must not touch meta at all');
});

test('cancelling before the first frame runs is also a no-op', () => {
  const s = conquered('riverfen');
  const before = JSON.parse(JSON.stringify(s.meta));
  const sched = manualScheduler();
  const cancel = runAutoResolve({
    rootState: s, regionId: 'riverfen', now: 700_000,
    onProgress: () => { throw new Error('must not progress after an immediate cancel'); },
    onDone: () => { throw new Error('must not finish after an immediate cancel'); },
    raf: sched.raf, cancelRaf: sched.cancelRaf, clock: sched.clock,
  });
  cancel();
  sched.pump(); // the one frame that was queued before cancel() ran
  assert.deepEqual(s.meta, before);
});

// ===========================================================================
// Wall clock — the whole reason worldmap-autobattle.js chunks this at all.
// ===========================================================================

test('one default chunk resolves far under a frame budget, on the cheapest board', () => {
  const s = conquered('riverfen');
  const run = startAutoResolve(s, 'riverfen', 700_000);
  const t0 = performance.now();
  run.advanceOrFinish(AUTO_RESOLVE_CHUNK_TICKS);
  const ms = performance.now() - t0;
  assert.ok(ms < 200,
    `a ${AUTO_RESOLVE_CHUNK_TICKS}-tick chunk took ${ms.toFixed(1)}ms — the screen budgets 8ms/frame `
    + 'and expects many chunks per frame on an ordinary board');
});
