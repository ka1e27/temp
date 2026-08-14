// A WALL HAS A FRONTAGE, AND UNTIL THIS RULE IT DID NOT.
//
// `siegeDps` was linear in headcount, so a crowd was a siege train. Measured
// before the frontage existed: 700 militia broke a level-5 castle in FIVE
// SECONDS, and the same 700 slots spent on the default mixed spread produced
// almost exactly the same siege output (471 militia = 283 dps; the spread's 23
// rams = 276). That is the arithmetic behind two separate long-standing entries
// in CLAUDE.md — "`breachSeconds` stopped binding around region 8" and "rams
// measure as a straight loss" — and they were always one defect seen twice.
//
// The rule: ordinary BODIES past `SIEGE_FRONTAGE` of them contribute nothing,
// because they are queueing rather than digging. ENGINES (`engine: true`) are
// exempt. This file pins the four properties that make it shippable, and three
// of the four are NEGATIVE controls — the rule's value is as much in what it
// provably does NOT touch as in what it does.
import test from 'node:test';
import assert from 'node:assert/strict';

import { siegeDps, breachSeconds, emptyComp } from '../src/battle/combat.js';
import { SIEGE_FRONTAGE, UNITS, UNIT_IDS } from '../src/content/balance.js';

const comp = (x) => ({ ...emptyComp(), ...x });

test('frontage: below the line NOTHING changes, and that inertness is the point', () => {
  // THE REASON THIS IS THE FIRST TEST. A saturating curve would have shaved
  // every assault in the game and re-tuned all twenty-four regions; a hard cap
  // is provably inert on every force smaller than it, so every early-region
  // breach time is byte-identical and the change is isolated to the late stacks
  // that broke the mechanic. If this ever fails, the rule stopped being a cap.
  for (let n = 1; n <= SIEGE_FRONTAGE; n++) {
    assert.equal(siegeDps(comp({ militia: n })), n * UNITS.militia.siege,
      `${n} militia is under the frontage and must still be exactly linear`);
  }

  // The boundary itself is inclusive: `bodies > SIEGE_FRONTAGE` is the test, so
  // a stack standing exactly abreast of the wall all dig. One body more is the
  // first that queues.
  const at = siegeDps(comp({ militia: SIEGE_FRONTAGE }));
  const over = siegeDps(comp({ militia: SIEGE_FRONTAGE + 1 }));
  assert.equal(at, SIEGE_FRONTAGE * UNITS.militia.siege);
  assert.ok(over < at * (SIEGE_FRONTAGE + 1) / SIEGE_FRONTAGE,
    'one body past the frontage must not be paid in full');
});

test('frontage: bodies SATURATE — ten times the crowd digs exactly the same hole', () => {
  const a = siegeDps(comp({ militia: 400 }));
  const b = siegeDps(comp({ militia: 4000 }));
  assert.equal(a, b, 'past the frontage a bigger crowd is more men queueing, not more digging');
  assert.equal(a, SIEGE_FRONTAGE * UNITS.militia.siege,
    'a saturated one-type crowd digs exactly a full frontage of itself');
});

test('frontage: the MIX still matters, so this is not a headcount cap', () => {
  // The scaling is applied to the bodies' summed DAMAGE, not to a body count.
  // Forty halberds out-dig forty militia by exactly the ratio they always did,
  // saturated or not — otherwise the rule would have quietly flattened every
  // unit's siege stat into one number and made three `siege` columns dead data.
  const ratio = UNITS.halberds.siege / UNITS.militia.siege;
  const m = siegeDps(comp({ militia: 500 }));
  const h = siegeDps(comp({ halberds: 500 }));
  assert.ok(Math.abs(h / m - ratio) < 1e-9,
    `saturated halberds must out-dig saturated militia ${ratio}x, measured ${h / m}`);

  // And a mixed crowd is the share-weighted blend rather than either end of it.
  const mixed = siegeDps(comp({ militia: 250, halberds: 250 }));
  assert.ok(mixed > m && mixed < h, 'half a crowd of diggers must land between the two');
});

test('frontage: ENGINES are exempt, and that is the whole statement', () => {
  // Rams stay linear at any count. A siege train is what a wall is afraid of;
  // bodies get in each other's way.
  for (const n of [1, 10, 100, 1000]) {
    assert.equal(siegeDps(comp({ rams: n })), n * UNITS.rams.siege,
      `${n} rams must be exactly linear — engines do not queue`);
  }

  // The load-bearing half: adding engines to an ALREADY-SATURATED crowd is paid
  // in full. If engines were folded into the crowd instead, a big army could
  // never buy its way past the cap and rams would be worthless rather than
  // decisive — the opposite of the defect this rule exists to fix.
  const crowd = siegeDps(comp({ militia: 700 }));
  const withRams = siegeDps(comp({ militia: 700, rams: 23 }));
  assert.equal(withRams - crowd, 23 * UNITS.rams.siege,
    'engines added to a saturated crowd must be paid at their full rate');
});

test('frontage: exactly one unit is an engine, and sappers are deliberately not', () => {
  // A NEGATIVE CONTROL ON THE EXEMPTION ITSELF. `engine` is a one-word opt-out
  // of the only thing limiting siege damage in the game, so a second unit
  // acquiring it by accident would silently restore the defect — and nothing
  // else in the codebase would look wrong.
  const engines = UNIT_IDS.filter((u) => UNITS[u].engine);
  assert.deepEqual(engines, ['rams'],
    'if a unit gained `engine` on purpose, re-measure the loadout table before '
    + 'changing this list — it is the exemption that makes the frontage bite');

  // Sappers have the second-highest `siege` in the game and are the obvious
  // candidate. They are not engines: their verb is `repair`, they exist to HOLD
  // a wall, and exempting them would hand the crowd a second way in.
  assert.ok(!UNITS.sappers.engine);
  assert.equal(siegeDps(comp({ sappers: 4000 })), SIEGE_FRONTAGE * UNITS.sappers.siege);
});

test('frontage: breachSeconds binds again, which is why the rule was written', () => {
  // THE MEASUREMENT THAT FORCED IT. A late-campaign landing budget reaches ~700
  // slots, and one slot buys one militia — so this is a real army, not a
  // pathological fixture.
  const castleHp = 480 * 2.2; // castle base HP at level 5, SITE_LEVELS[4].hp
  const mono = breachSeconds(comp({ militia: 700 }), castleHp, 'castle', 5);
  const train = breachSeconds(comp({ militia: 111, spearmen: 67, raiders: 39, rams: 23 }),
    castleHp, 'castle', 5);

  assert.ok(mono > 120,
    `700 militia broke a level-5 castle in ${mono.toFixed(0)}s. Before the frontage `
    + 'that number was FIVE, which is what "breachSeconds stopped binding" meant');
  assert.ok(train * 10 < mono,
    `the default spread must break the same castle at least 10x faster than the `
    + `crowd — measured ${train.toFixed(0)}s against ${mono.toFixed(0)}s. This is `
    + 'the ratio that makes rams a purchase instead of a tax on your slots');

  // And the mechanism's original promise is untouched at the small end: a
  // handful of troops still cannot take a stronghold at all.
  assert.equal(breachSeconds(comp({ militia: 4 }), 340, 'stronghold'), Infinity);
});
