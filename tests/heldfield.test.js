// C5 — a battle you led but did not finish.
//
// The measurement this exists for: 93% of every non-win in this campaign is a
// TIMEOUT, and 63% of those end AHEAD on territory — twelve defeats in five
// hundred and seventy-six battles. So the dominant way this game is failed is
// holding most of a map for twenty minutes and being told "Time expired".
//
// The properties that carry the fix, and each is a way it could ship broken:
// the verdict must be the one the SIM computed (it was already being computed
// and thrown away), it must PAY without WINNING (or every measured win rate
// moves), and it must not be farmable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heldFieldPay, applyOutcome, firstClearBonus } from '../src/meta/rewards.js';
import { HELD_FIELD, REGION_BY_ID, REGION_IDS } from '../src/content/regions.data.js';
import { RESULTS } from '../src/content/strings.js';
import { resultCopy, statRows } from '../src/screens/results.js';
import { toOutcome } from '../src/battle/outcome.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { startBattle, step } from '../src/battle/sim.js';
import { createMeta } from '../src/core/store.js';
import { markConquered, isConquered, record } from '../src/meta/world.js';

const outcomeOf = (o = {}) => ({
  result: 'timeout', timeoutWinner: 'player',
  stats: { sitesHeld: 8, sitesTotal: 12 }, ...o,
});

test('only a timeout the PLAYER led pays anything', () => {
  assert.ok(heldFieldPay(1000, outcomeOf()) > 0);
  assert.equal(heldFieldPay(1000, outcomeOf({ timeoutWinner: 'enemy' })), 0);
  assert.equal(heldFieldPay(1000, outcomeOf({ timeoutWinner: 'draw' })), 0);
  assert.equal(heldFieldPay(1000, outcomeOf({ timeoutWinner: null })), 0);
  // NEGATIVE CONTROLS on the other outcomes — a win pays through the real
  // branches and must never also collect this, and a defeat is a defeat.
  assert.equal(heldFieldPay(1000, outcomeOf({ result: 'win' })), 0);
  assert.equal(heldFieldPay(1000, outcomeOf({ result: 'loss' })), 0);
  assert.equal(heldFieldPay(1000, outcomeOf({ result: 'retreat' })), 0);
});

test('a lead too thin to be worth announcing pays nothing', () => {
  // The floor is a SECOND guard: `timeoutWinner` already required leading on
  // influence plus site count, and this catches the case where that lead came
  // from territory rather than from buildings. Sited against the real constant
  // so moving it fails here rather than silently widening the gate.
  const under = Math.max(0, HELD_FIELD.minShare - 0.05);
  const over = Math.min(1, HELD_FIELD.minShare + 0.05);
  const at = (share) => heldFieldPay(1000,
    outcomeOf({ stats: { sitesHeld: Math.round(share * 100), sitesTotal: 100 } }));
  assert.equal(at(under), 0, `a ${(under * 100).toFixed(0)}% share paid`);
  assert.ok(at(over) > 0, `a ${(over * 100).toFixed(0)}% share paid nothing`);
});

test('it scales with how much was HELD, not merely with having led', () => {
  const at = (held) => heldFieldPay(1000, outcomeOf({ stats: { sitesHeld: held, sitesTotal: 20 } }));
  const clear = at(14);    // 70%
  const rout = at(18);     // 90%
  assert.ok(rout > clear, 'a rout that ran out of clock pays no more than a squeaker');
  assert.equal(clear, 1000 * HELD_FIELD.frac * 0.7);
  // ...and below the floor it is zero rather than merely small, so there is no
  // dribble of crowns for a battle nobody would call led.
  assert.equal(at(Math.floor((HELD_FIELD.minShare - 0.05) * 20)), 0);
});

test('it is a FRACTION — it can never pay what taking the ground pays', () => {
  const full = heldFieldPay(1000, outcomeOf({ stats: { sitesHeld: 12, sitesTotal: 12 } }));
  assert.ok(full < 1000, `holding the whole map paid ${full} against a 1000 conquest`);
  assert.equal(full, 1000 * HELD_FIELD.frac);
});

test('the SIM computes the verdict and the outcome now carries it', () => {
  // The defect: `endPhase` has written `state.meta.timeoutWinner` for this
  // mechanic's whole life and nothing read it. Driven through the real pipeline
  // rather than asserted off a fixture.
  const meta = createMeta();
  const cfg = buildBattleConfig(meta, 'riverfen', [], generateBattleMap, { seed: 7 });
  const b = startBattle(cfg);
  b.rules.hardCapTicks = 30;
  while (b.status === 'running' && b.tick < 40) step(b);
  assert.equal(b.status, 'timeout');
  assert.ok(['player', 'enemy', 'draw'].includes(b.meta.timeoutWinner));
  const out = toOutcome(b, cfg);
  assert.equal(out.timeoutWinner, b.meta.timeoutWinner,
    'the outcome dropped the verdict the sim computed');
  // ...and it is NULL on anything that did not end on the clock, so nothing
  // downstream can read a territorial verdict into a real defeat.
  b.status = 'loss';
  assert.equal(toOutcome(b, cfg).timeoutWinner, null);
});

test('it PAYS and does not WIN — the region is untouched', () => {
  const meta = createMeta();
  const region = REGION_BY_ID.riverfen;
  const cfg = buildBattleConfig(meta, 'riverfen', [], generateBattleMap, { seed: 7 });
  const b = startBattle(cfg);
  b.rules.hardCapTicks = 30;
  while (b.status === 'running' && b.tick < 40) step(b);
  const out = toOutcome(b, cfg);
  // Force the led case so the assertion is about the PAYOUT rule rather than
  // about which way one seeded battle happened to fall.
  out.timeoutWinner = 'player';
  out.stats.sitesHeld = out.stats.sitesTotal;

  const before = meta.crowns;
  const s = applyOutcome(meta, cfg, out, { now: 0 });

  assert.equal(s.result, 'timeout', 'a led timeout was reported as something else');
  assert.equal(s.won, false);
  assert.equal(s.conquered, false);
  assert.equal(s.heldField, true);
  assert.equal(s.relics, 0, 'a relic is for ground you have BEATEN');
  assert.equal(s.incomeAdded, 0, 'a timeout granted permanent income');
  assert.equal(isConquered(meta, 'riverfen'), false);
  assert.equal(record(meta, 'riverfen').clears, 0, 'a timeout advanced the raid ladder');
  assert.ok(s.crowns > 0 && meta.crowns > before);
  assert.equal(s.crowns, firstClearBonus(region) * HELD_FIELD.frac);
});

test('...and a timeout the player LOST still pays nothing at all', () => {
  const meta = createMeta();
  const cfg = buildBattleConfig(meta, 'riverfen', [], generateBattleMap, { seed: 7 });
  const b = startBattle(cfg);
  b.rules.hardCapTicks = 30;
  while (b.status === 'running' && b.tick < 40) step(b);
  const out = toOutcome(b, cfg);
  out.timeoutWinner = 'enemy';
  const before = meta.crowns;
  const s = applyOutcome(meta, cfg, out, { now: 0 });
  assert.equal(s.heldField, false);
  assert.equal(s.crowns, 0);
  assert.equal(meta.crowns, before);
});

test('a rung that ran out of clock pays against the RUNG, and never clears it', () => {
  const meta = createMeta();
  for (const id of REGION_IDS) markConquered(meta, id);
  const cfg = buildBattleConfig(meta, 'widowsgate', [], generateBattleMap,
    { seed: 5, incursion: 3 });
  const b = startBattle(cfg);
  b.rules.hardCapTicks = 30;
  while (b.status === 'running' && b.tick < 40) step(b);
  const out = toOutcome(b, cfg);
  out.timeoutWinner = 'player';
  out.stats.sitesHeld = out.stats.sitesTotal;
  const s = applyOutcome(meta, cfg, out, { now: 0 });
  assert.equal(s.heldField, true);
  assert.ok(s.crowns > 0);
  // THE RULE THE WHOLE INCURSION BRANCH EXISTS FOR: a rung that was not cleared
  // must not advance the ladder, whatever it paid.
  assert.equal(meta.incursion?.cleared ?? 0, 0, 'a timeout cleared a rung');
});

test('the copy names what was achieved, and branches on what was PAID', () => {
  const o = { result: 'timeout' };
  assert.equal(resultCopy(o, { heldField: true }, REGION_BY_ID.riverfen).title,
    RESULTS.heldField);
  assert.equal(resultCopy(o, { heldField: false }, REGION_BY_ID.riverfen).title,
    RESULTS.timeout);
  // Branching on the PAYOUT rather than on the verdict is what stops the
  // headline and the Crowns row disagreeing — the same rule the loss branch
  // follows for a fired booster charge.
  assert.notEqual(RESULTS.heldField, RESULTS.timeout);
  assert.ok(RESULTS.heldFieldBody.length > 0);
});

test('...and the screen SAYS it paid — the row is gated on the payout', () => {
  // Found in a real browser: the headline read "You held the field" over a stat
  // block with no Crowns row, because the row sat inside `result === 'win'`.
  // A payout the screen does not mention is the same disagreement as a headline
  // that over-claims, pointing the other way.
  const outcome = {
    result: 'timeout', durationMs: 1000,
    stats: { sitesHeld: 10, sitesTotal: 11, unitsLost: 0, unitsKilled: 0 },
  };
  const rows = statRows(outcome, { heldField: true, crowns: 33, incomePerSec: 0 });
  const crowns = rows.find((r) => r[0] === 'Crowns');
  assert.ok(crowns, `no Crowns row in ${JSON.stringify(rows)}`);
  assert.ok(String(crowns[1]).includes('33'));
  // NEGATIVE CONTROL: a timeout that paid nothing must not grow an empty row.
  const none = statRows(outcome, { heldField: false, crowns: 0, incomePerSec: 0 });
  assert.equal(none.find((r) => r[0] === 'Crowns'), undefined);
});
