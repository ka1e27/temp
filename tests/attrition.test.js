// THE ANTI-TURTLE LADDER, AND WHETHER ANYONE IS TOLD ABOUT IT.
//
// `battle/sim.js attritionPhase` applies real penalties after 150/210/270
// seconds without a capture ANYWHERE on the board — a quarter off farm income,
// then half wall repair and a garrison bleed, then half income with no repair at
// all and training at double price and half rate. It shipped that way, and for
// its whole life the only mention of it outside `battle/` and `content/` was a
// COMMENT in `battle-econ.js` noting that the HUD's income figure includes it.
//
// That is the exact "sold and did nothing" shape this project has already
// refunded four upgrades for, inverted: a mechanic that does a great deal and
// tells nobody. A tax you cannot see is not difficulty, it is the game appearing
// to break.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { startBattle, step } from '../src/battle/sim.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { createMeta } from '../src/core/store.js';
import { drainEvents } from '../src/battle/events.js';
import { attritionMods } from '../src/battle/economy.js';
import { ATTRITION } from '../src/content/balance.js';
import { RESULTS } from '../src/content/strings.js';

const src = (rel) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');

test('every rung of the ladder has a line, and every line has a rung', () => {
  // Both directions, because both failures are silent: a rung with no copy
  // fires and says nothing, and a line with no rung is dead copy going stale —
  // the `IDLE.awayCapped` shape that advertised a "Granary" upgrade for a
  // release after that upgrade stopped existing.
  assert.equal(RESULTS.attrition.length, ATTRITION.length,
    `${ATTRITION.length} rungs against ${RESULTS.attrition.length} lines`);
  for (const line of RESULTS.attrition) {
    assert.equal(typeof line, 'string');
    assert.ok(line.length > 30, `a rung's line looks empty: "${line}"`);
  }
});

test('a line names what its own rung actually does', () => {
  // The point of announcing it at all. A rung that halves repair must not be
  // described by a line that only mentions income.
  const [s1, s2, s3] = RESULTS.attrition;
  assert.match(s1, /farm/i, 'rung 1 cuts farm income and the line must say so');
  assert.ok(ATTRITION[1].regenMult < 1 && ATTRITION[1].garrisonBleed > 0);
  assert.match(s2, /repair/i, 'rung 2 halves wall repair');
  assert.ok(ATTRITION[2].regenMult === 0 && ATTRITION[2].trainCostMult > 1);
  assert.match(s3, /repair|train/i, 'rung 3 stops repair outright and doubles training cost');
});

test('the strip subscribes to it, and stage 0 says nothing', () => {
  // The half that was missing for the feature's whole life. Asserted against
  // source because the failure is an absent listener, which no behavioural test
  // of the listener can see.
  const strip = src('screens/battle-alert.js');
  assert.match(strip, /battle:attrition-stage/, 'nothing listens for the ladder');
  assert.match(strip, /RESULTS\.attrition/, 'the listener does not use the copy');
  // Stage 0 is the ladder RETIRING — ground changed hands — and indexes to
  // `undefined`, which the listener must read as silence rather than announce.
  assert.equal(RESULTS.attrition[-1], undefined);
  assert.equal(RESULTS.attrition[0 - 1], undefined);
});

test('...and the ladder really does fire, on a real battle', () => {
  // Driven through the actual pipeline rather than by poking `attritionStage`:
  // the trigger is `lastFlipTick`, which is sim state nothing else writes, and a
  // fixture that set the stage by hand would pass against a phase that never
  // ran. Measured on riverfen seed 1000 with nobody giving orders — rung 1 at
  // 321s and rung 2 at 381s.
  const b = startBattle(buildBattleConfig(createMeta(), 'riverfen', [], generateBattleMap,
    { seed: 1000 }));
  const seen = [];
  for (let i = 0; i < 4000; i++) {
    step(b);
    for (const ev of drainEvents(b)) {
      if (ev.type === 'attrition-stage') seen.push({ stage: ev.stage, mods: attritionMods(b) });
    }
  }
  assert.ok(seen.length >= 2, `the ladder never climbed: ${JSON.stringify(seen)}`);
  assert.equal(seen[0].stage, 1);
  // The event carries the stage the mods are ON, which is what lets one listener
  // pick one line — a stage that disagreed with `attritionMods` would announce
  // the wrong penalty with nothing failing.
  assert.equal(seen[0].mods.farmMult, ATTRITION[0].farmMult);
  assert.equal(seen[1].stage, 2);
  assert.equal(seen[1].mods.regenMult, ATTRITION[1].regenMult);
  // Every announced stage has a line to announce.
  for (const s of seen) assert.ok(RESULTS.attrition[s.stage - 1], `stage ${s.stage} is mute`);
});

test('it is a rule of the board, not a positional claim, so fog cannot eat it', () => {
  // The event names no site and no hex on purpose: attrition applies to BOTH
  // factions everywhere, so gating it the way a capture or a field battle is
  // gated would silence it outright. `screens/battle.js` passes an event with
  // neither through untouched — the clause this depends on.
  const b = startBattle(buildBattleConfig(createMeta(), 'riverfen', [], generateBattleMap,
    { seed: 1000 }));
  let ev = null;
  for (let i = 0; i < 4000 && !ev; i++) {
    step(b);
    ev = drainEvents(b).find((e) => e.type === 'attrition-stage') ?? null;
  }
  assert.ok(ev, 'no attrition event to check');
  assert.equal(ev.siteId, undefined);
  assert.equal(ev.hex, undefined);
});
