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

  // A MIXED CROWD DIGS AT THE RATE OF ITS BEST BODIES, because the frontage is a
  // queue and not an average. This assertion used to read `mixed > m && mixed < h`
  // — the share-weighted blend — and that is precisely the defect it was encoding:
  // averaging lets militia DISPLACE halberds at the wall instead of lining up
  // behind them, which made siege damage fall as a stack grew.
  const mixed = siegeDps(comp({ militia: 250, halberds: 250 }));
  assert.equal(mixed, h,
    'with 250 halberds available, the forty at the wall are all halberds');

  // The blend is real where it should be: too FEW good bodies to fill the
  // frontage, and the rest of it is made up by whoever else is standing there.
  // This is what keeps three `siege` columns live data rather than one number.
  const thin = siegeDps(comp({ halberds: 10, militia: 500 }));
  assert.ok(thin > m && thin < h, `ten diggers plus a crowd lands between: ${thin}`);
  assert.ok(Math.abs(thin - (10 * UNITS.halberds.siege
    + (SIEGE_FRONTAGE - 10) * UNITS.militia.siege)) < 1e-9,
    'ten halberds at the wall, thirty militia filling the rest of the frontage');
});

test('frontage: MORE TROOPS NEVER DIG SLOWER — the rule is a queue, not an average', () => {
  // THE REGRESSION GUARD, and the reason the assertion above changed. Scaling the
  // whole body force by `FRONTAGE / bodies` made siege damage NON-MONOTONIC in
  // headcount: 40 sappers dug at 100 dps, and 40 sappers with 400 militia behind
  // them dug at 30.9 — so relief arriving at a siege made the wall three times
  // harder, and `breachSeconds` could walk from a live countdown to Infinity as
  // help landed. `ai.js retreat()` reads that Infinity and abandons the siege, so
  // the AI could talk itself off a wall by reinforcing it.
  //
  // Monotonicity is the property that cannot be checked by looking at one stack,
  // which is why nothing caught this: every single-stack number was defensible.
  for (const filler of ['militia', 'spearmen', 'raiders']) {
    let prev = 0;
    for (let n = 0; n <= 600; n += 25) {
      const dps = siegeDps(comp({ sappers: 40, [filler]: n }));
      assert.ok(dps >= prev - 1e-9,
        `${n} ${filler} behind 40 sappers dug ${dps}, less than ${prev} with fewer men`);
      prev = dps;
    }
    // ...and the good bodies are never diluted at all: the forty diggers hold
    // the wall no matter how big the crowd behind them gets.
    assert.equal(siegeDps(comp({ sappers: 40, [filler]: 600 })),
      siegeDps(comp({ sappers: 40 })),
      `a crowd of ${filler} must not displace a full frontage of sappers`);
  }
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
