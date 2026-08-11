// THE BOT'S ANSWER TO FOG — simbuild.js `scoutTurn`.
//
// Split out of ./harness.test.js for the line budget, same reason
// campaignplay.test.js split from campaign.test.js: this file's assertions
// are about ONE mechanic in real battles rather than a table's shape, and it
// earned its own file the moment a late-tier throne needed a second,
// longer-running check the tier 1-3 one could not also cover.
import test from 'node:test';
import assert from 'node:assert/strict';

import { startRun, playerTurn } from '../tools/simplayer.js';
import { step } from '../src/battle/sim.js';
import { REGIONS, REGION_IDS } from '../src/content/regions.data.js';

const before = (id) => REGION_IDS.slice(0, REGIONS.findIndex((r) => r.id === id));

/** Watchtowers actually raised across three battles at a fixed seed — shared
 *  by the pair below so they are the same claim with the flag flipped,
 *  rather than two independent measurements that could quietly drift apart. */
function countTowers(opts) {
  let towers = 0;
  for (const id of ['gallowmoor', 'riverfen', 'ashford']) {
    const battle = startRun(id, 8919, before(id), 10);
    let nextThink = 0;
    while (battle.status === 'running' && battle.tick < 4800) {
      if (battle.tick >= nextThink) { playerTurn(battle, opts); nextThink = battle.tick + 20; }
      step(battle);
      for (const e of battle.events) {
        if (e.type === 'site-built' && e.kind === 'watchtower') towers++;
      }
    }
  }
  return towers;
}

test('harness: it can raise a watchtower toward a throne it cannot see', () => {
  // The bot's own answer to fog (simbuild.js `scoutTurn`) — CLAUDE.md's
  // most-repeated lesson again: a mechanic the harness cannot play is a
  // mechanic nobody has measured.
  assert.ok(countTowers({}) > 0,
    'the bot never raised a single watchtower across three battles — `scoutTurn` '
    + 'is queuing nothing, or everything it queues is being refused');
});

test('harness: --noscout really is the bot with no answer to fog', () => {
  // The guard on the newest escape hatch, exactly as --noupgrades and
  // --noconstruct have one.
  assert.equal(countTowers({ scout: false }), 0, 'the opt-out still raised a watchtower');
});

test('harness: the watchtower answer also reaches a late-tier throne, not only an early one', () => {
  // The gap the first version of this file left: gallowmoor/riverfen/ashford
  // are tiers 1-3, and a mechanic proven only where the board is calm is not
  // proven at all — measured, `scoutTurn` raised zero completed towers on
  // any tier-5/6 region for a real reason (a fresh 1-HP scaffold razed and
  // rebuilt at the same hex every 20-90 ticks, never once surviving its own
  // 15-second timer), not a coincidence a small sample could paper over. A
  // longer window than the tier 1-3 check, because the same ground being
  // hotly contested is exactly what makes completion slower here, not absent.
  let towers = 0;
  for (const id of ['nightharrow', 'stormhalt', 'cinderwatch', 'widowsgate']) {
    for (const seed of [1000, 8919, 16838]) {
      const battle = startRun(id, seed, before(id), 10);
      let nextThink = 0;
      while (battle.status === 'running' && battle.tick < 9000) {
        if (battle.tick >= nextThink) { playerTurn(battle); nextThink = battle.tick + 20; }
        step(battle);
        for (const e of battle.events) {
          if (e.type === 'site-built' && e.kind === 'watchtower') towers++;
        }
      }
    }
  }
  assert.ok(towers > 0,
    'the bot never completed a single watchtower across twelve tier-5/6 battles — '
    + 'the fix for the razing loop did not hold on the ground it was measured against');
});
