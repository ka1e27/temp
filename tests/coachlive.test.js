// THE COACH AGAINST THE REAL ENGINE.
//
// Split out of tests/coach.test.js at the 400-line cap, along the seam that
// matters rather than at a line number: everything in that file drives the pure
// machine over hand-built fixtures, and everything here builds a REAL region-1
// battle through `buildBattleConfig`/`startBattle` and reads the coach's signals
// off it. That is the half that catches a field being renamed under the machine,
// which no fixture can.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCoachMachine, COACH_REGION, emptyLatch, observeState, readSignals,
  castleTouchesPlayer,
} from '../src/ui/coach.js';
import { createMeta } from '../src/core/store.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { startBattle } from '../src/battle/sim.js';


test('a REAL region-1 battle: gold starts at 300, so gold100 must not jump the queue', () => {
  const meta = createMeta();
  const config = buildBattleConfig(meta, COACH_REGION, [], generateBattleMap);
  const live = startBattle(config);

  assert.equal(live.regionId, COACH_REGION, 'coach gates on battle.regionId');
  assert.ok(live.factions.player.goldCg / 100 > 100,
    'this test is pointless if the player no longer starts above 100 gold');
  assert.ok(live.sites.some((s) => s.kind === 'castle'), 'no castle to point at');

  const m = createCoachMachine();
  assert.equal(m.step(live, meta).id, 'drag');
  // 300 gold in hand and the beat still holds its tongue: it is gated on the
  // player having captured something, not on the number alone.
  assert.equal(m.step(live, meta), null);
  assert.equal(m.signals(live, meta).gold > 100, true);
  assert.deepEqual(
    m.pending.filter((id) => !['strongholdTaken', 'siegeStalled', 'buildRams', 'retreat', 'firstIncome'].includes(id)),
    ['tookGround', 'fieldWon', 'captured', 'gold100', 'takeCastle', 'takeCastleOpen'],
  );
  // AND THIS IS WHY THE PAIR EXISTS. Read off the real region-1 config, not
  // asserted from the table: the campaign opener has NO castle gate, so the
  // beat that describes one is the unreachable half here and the plain line is
  // the one a first-timer will actually be shown.
  assert.equal(live.rules.castleGateFrac, 0,
    'if region 1 ever grows a gate, the coach pair below flips and this is the tell');
  assert.equal(m.signals(live, meta).castleGated, false);
});

test('the coach reads a real battle through the same fields the sim writes', () => {
  const meta = createMeta();
  const live = startBattle(buildBattleConfig(meta, COACH_REGION, [], generateBattleMap));
  const latch = emptyLatch();
  observeState(latch, live);
  const s = readSignals({ battle: live, meta, latch });
  assert.equal(s.regionId, COACH_REGION);
  assert.equal(s.started, true);
  assert.equal(s.tutorialSeen, false);
  assert.equal(Number.isFinite(s.gold), true);
  assert.equal(s.castleAdjacent, castleTouchesPlayer(live));
});
