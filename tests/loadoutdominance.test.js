// THE LOADOUT HAS ONE ANSWER, AND UNTIL THIS FILE NOTHING ASKED ABOUT IT.
//
// Bring only militia and gallowmoor goes from a 56% fight to a **98%** walkover
// won in 2.3 minutes against a 5-minute advertised length (n=48, matched seeds,
// on the tuned table). That is wider than the entire difficulty range of the
// campaign, and it is four `-` clicks away on the loadout screen.
//
// THIS FILE PINS A DEFECT, NOT A DESIRED PROPERTY. Read the assertions that way:
// they encode the bug as it is currently measured, so that it cannot quietly get
// worse and cannot quietly get better without somebody noticing. Two failure
// directions, and both are informative:
//
//   - the gap WIDENS  -> a change made militia stronger, or the default spread
//                        weaker, and nobody measured the loadout screen.
//   - the gap CLOSES  -> somebody fixed it. Good. Re-take the numbers, retire
//                        this file's framing, and delete the bullet in CLAUDE.md.
//
// IT USED TO BE SPECIFICALLY MILITIA, AND IT IS NOT ANY MORE. At slot cost 1
// militia is the highest combined stat per slot in the game (atk 4 + def 3 =
// 7.00/slot, against spearmen 6.50, raiders 5.67, rams 1.60), and the original
// third test in this file was the control proving concentration alone bought
// nothing: mono-spearmen measured BELOW the default spread.
//
// That control FIRED, which is the whole reason it existed. Once marches were
// slowed (MOVEMENT.hexSecondsPerSpeed 38 -> 76) mono-spearmen measured 67%
// against the default's 58% on the same region -- every one-note army now wins.
// The mechanism is `slowestSpeed`, a MIN over the stack: the default spread
// marches at the pace of its 23 rams, and doubling the march doubled that
// penalty in absolute seconds. The dominant answer is no longer "bring militia",
// it is "leave the rams at home" -- a wider hole, and one that compounds with
// rams already measuring as a straight loss because `breachSeconds` stopped
// binding. The third test now pins that as arithmetic rather than as a win rate.
//
// ** DO NOT "FIX" THIS BY NERFING MILITIA. IT IS MEASURED, AND IT BACKFIRES. **
// Three probes on gallowmoor at n=24, matched seeds (default -> mono, gap):
//
//     baseline                       54% -> 100%   gap 46
//     counters.spearmen 0.75 -> 0    29% ->  83%   gap 54
//     atk 4->3 and def 3->2.25       38% ->  88%   gap 50
//
// Every nerf WIDENS the gap. The mixed army sits on the steep part of the win
// curve and the mono army sits on its flat top, so the same nerf costs the
// default spread 16-25 points and the exploit 12-17 -- and wrecks the campaign
// on the way past. This refutes the obvious fix; do not spend a re-tune on it.
//
// What the mechanism actually is: for one slot budget mono-militia buys ~2x the
// bodies (471 against 240) and 32% more field power, at EQUAL siege output --
// the default spread's 23 rams produce 276 siege DPS and 471 militia produce
// 283. So rams buy siege the militia already had, at the cost of a third of the
// field. And no mechanic in the game is sensitive to concentration: the enemy's
// counter-pick (battle/aiadapt.js) is an `argmax`, so it answers a 46%-militia
// army and a 98%-militia army with exactly the same production share. Measured
// against mono-militia, the enemy is down to ZERO training grounds by t=3min --
// it is not out-fought, it is out-raced before adaptation can matter.
//
// A per-type slot-share cap was built, measured and REVERTED once already: it
// took the exploit to 69% and left the default spread byte-identical, but it
// contradicts the `carryComposition` contract that ten tests encode. Do not
// re-spend that either.
//
// ** NOR IS IT SIEGE OUTPUT, and that was the standing prime suspect. **
// `SIEGE_FRONTAGE` caps what ordinary bodies can do to a structure and exempts
// engines, so a crowd now manages 24 structure dps against the default spread's
// 276 — siege is removed from the question entirely. The gap did not move: +8 /
// +36 / +61 / +63 on the four regions the re-tune left alone, against +10 / +40
// / +65 / +67 before it. A change that big moving nothing is worth more than a
// fix would have been. See CLAUDE.md "A wall has a frontage" for the half of
// that measurement that nearly went the other way — the harness stopped
// assaulting a throne it could have taken, and read as the exploit being fixed.
import test from 'node:test';
import assert from 'node:assert/strict';

import { playOne, startRun } from '../tools/simplayer.js';
import { REGIONS } from '../src/content/regions.data.js';
import { MOVEMENT, UNITS } from '../src/content/balance.js';
import { slowestSpeed } from '../src/battle/movement.js';
import { TICK_HZ } from '../src/core/loop.js';

// Gallowmoor: tier 3, mid-campaign, and the region every historical measurement
// of this defect has used, so the numbers below are comparable to the ones in
// CLAUDE.md rather than a fresh baseline nobody can line up against.
const REGION = 'gallowmoor';
const BEFORE = REGIONS.slice(0, REGIONS.findIndex((r) => r.id === REGION)).map((r) => r.id);

// Matched seeds, the same arithmetic tools/simrunner.js uses, so a number taken
// here and a number taken at the CLI are the same number.
const N = 24;
const SEED = (i) => 1000 + i * 7919;

const MONO_MILITIA = { militia: 1, spearmen: 0, raiders: 0, rams: 0 };
const MONO_SPEARMEN = { militia: 0, spearmen: 1, raiders: 0, rams: 0 };

/** Win rate and win-median minutes over N matched seeds. */
function measure(weights) {
  const runs = [];
  for (let i = 0; i < N; i++) {
    runs.push(playOne(REGION, SEED(i), BEFORE, 10, weights ? { weights } : {}));
  }
  const wins = runs.filter((r) => r.status === 'win');
  const mins = wins.map((r) => r.ticks / TICK_HZ / 60).sort((a, b) => a - b);
  return {
    pct: Math.round((wins.length / runs.length) * 100),
    winMed: mins.length ? mins[Math.floor(mins.length / 2)] : NaN,
  };
}

/** The whole army the player lands with, by unit, at tick 0. */
function landingForce(weights) {
  const battle = startRun(REGION, SEED(0), BEFORE, 10, weights ? { weights } : {});
  const total = {};
  for (const site of battle.sites) {
    if (site.owner !== 'player') continue;
    for (const [unit, n] of Object.entries(site.garrison ?? {})) {
      total[unit] = (total[unit] ?? 0) + n;
    }
  }
  return total;
}

test('loadout: a weights object really reaches the battle', () => {
  // THE LIVE NEGATIVE CONTROL, and it is not hypothetical. `fitComposition`
  // silently drops any unit missing from `unlocked`, and a harness run has
  // already shipped here that asked for sappers, landed ZERO of them, and
  // reported the default army's win rate under their name.
  //
  // Without this assertion every other test in the file could pass while
  // measuring the same default army three times -- the gap would collapse to
  // noise, which reads as "the defect is fixed" rather than "the measurement is
  // broken". Those are the two outcomes hardest to tell apart from a green suite.
  const mono = landingForce(MONO_MILITIA);
  const bodies = Object.values(mono).reduce((a, b) => a + b, 0);
  assert.ok(bodies > 100, `landing force was ${bodies} bodies -- nothing was fielded`);
  assert.ok(mono.militia / bodies > 0.95,
    `asked for militia only and got ${JSON.stringify(mono)} -- the loadout was `
    + 'discarded somewhere between the weights object and the board');

  // MAPGEN.garrison seeds a handful of bodies into the sites the player starts
  // holding, and those are not the expedition -- so "only militia" is 95%+, not
  // 100%, and asserting the stricter thing would fail for the wrong reason.
  const spread = landingForce(null);
  const kinds = Object.entries(spread).filter(([, n]) => n > 0).map(([k]) => k);
  assert.ok(kinds.length >= 4,
    `the DEFAULT spread is meant to be four troop types, landed ${kinds.join('/')} `
    + '-- if this shrank, every balance number in regions.data.js moved with it');
});

test('loadout: bringing only militia converts a real fight into a walkover', { timeout: 240_000 }, () => {
  const spread = measure(null);
  const mono = measure(MONO_MILITIA);

  // The recorded gap is +42 points at n=48 (56% -> 98%) and +33 at this n.
  // The floor is deliberately loose: it is here to say THE DEFECT IS STILL THE
  // DEFECT, not to pin a sampling artefact. n=24 on a region whose true rate sits
  // near 60% has a couple of points of slop in it either way.
  const gap = mono.pct - spread.pct;
  assert.ok(gap >= 20,
    `mono-militia beat the default spread by only ${gap} points `
    + `(${spread.pct}% -> ${mono.pct}%). Either somebody FIXED the dominant `
    + 'loadout -- in which case re-take these numbers, retire this framing and '
    + 'close the bullet in CLAUDE.md -- or the weights stopped reaching the '
    + 'battle, which the first test in this file would normally catch.');

  // The half that matters more than the win rate. A region advertised at five
  // minutes is won in two and a bit, so the exploit does not merely win more
  // often -- it deletes the battle. A win rate alone would miss this entirely:
  // a change that left the rate here and doubled the length would read as fine.
  const advertised = REGIONS.find((r) => r.id === REGION).targetLengthMin;
  assert.ok(mono.winMed < advertised * 0.75,
    `mono-militia win median ${mono.winMed.toFixed(1)}m against a ${advertised}m `
    + 'advertised length -- if this stopped being true the exploit changed shape');
});

test('the mixed spread marches at RAM speed — true, and measured NOT to be the exploit', () => {
  // THE ARITHMETIC BELOW HAS BEEN RIGHT THROUGH TWO REWRITES OF THIS COMMENT.
  // What keeps changing is what it was thought to EXPLAIN, and the current
  // answer is: nothing. Kept, because it is the exact fact that has to stay
  // true for the disproof below to keep meaning anything.
  //
  // `slowestSpeed` is a MIN over the stack, so the default spread marches at
  // the pace of its rams -- and `MOVEMENT.hexSecondsPerSpeed` was doubled to
  // make marches read as marches, doubling that penalty in absolute seconds.
  // Measured, seconds per hex:
  //
  //     default spread   2.53   (dragged to rams, speed 30)
  //     mono spearmen    1.69   1.5x faster
  //     mono militia     1.38   1.8x faster
  //     mono raiders     0.72   3.5x faster
  //
  // THIS TEST USED TO BE TITLED "...and that is now the exploit". IT IS NOT.
  // `slowestSpeed` was replaced with the slot-weighted harmonic mean of the
  // stack's speeds -- which makes the default spread 1.6x faster (2.53 ->
  // 1.59 s/hex) and, by construction, cannot move a one-type army at all, so
  // it was the one candidate fix that could not backfire the way the three
  // militia nerfs above did. Measured at n=48 on five regions it bought the
  // default spread a net +1 point and the mono gap went 43.6 -> 44.8 average.
  // Sixty percent more speed, no change in outcome. Reverted; see
  // battle/movement.js `slowestSpeed` for the table.
  //
  // So the ram's cost is entirely its SLOTS, which is the mechanism already
  // written above arriving from the other side: 23 rams make 276 siege DPS
  // where the 471 militia they displace make 283, at a third of the field
  // power. Dropping rams is worth +23 to +40 points on the campaign even with
  // the speed penalty weighted away. DO NOT RE-SPEND EITHER MEASUREMENT.
  //
  // Pinned as ARITHMETIC rather than as a win rate, because that is the part
  // that cannot be noise: the speed table is exact, where a win rate is a
  // claim about whatever dial the campaign happens to ship today.
  const spread = { militia: 111, spearmen: 67, raiders: 39, rams: 23 };
  const spreadPace = MOVEMENT.hexSecondsPerSpeed / slowestSpeed(spread);
  for (const unit of ['militia', 'spearmen', 'raiders']) {
    const pace = MOVEMENT.hexSecondsPerSpeed / slowestSpeed({ [unit]: 100 });
    assert.ok(pace < spreadPace,
      `mono-${unit} marches at ${pace.toFixed(2)}s/hex against the spread's `
      + `${spreadPace.toFixed(2)} -- if this stopped being true the exploit changed shape`);
  }
  assert.equal(slowestSpeed(spread), UNITS.rams.speed,
    'the whole point: one ram sets the pace for the entire army');

  // NEGATIVE CONTROL. Drop the rams and the same spread keeps up with a mono
  // army -- so the gap above is the ram, not "mixing units is slow".
  const noRams = { militia: 111, spearmen: 67, raiders: 39 };
  assert.equal(slowestSpeed(noRams), UNITS.spearmen.speed,
    'without rams the spread marches at its next-slowest unit, not at some blend');
  assert.ok(MOVEMENT.hexSecondsPerSpeed / slowestSpeed(noRams)
    <= MOVEMENT.hexSecondsPerSpeed / slowestSpeed({ spearmen: 100 }) + 1e-9,
    'a ram-free mixed army is exactly as quick as the mono army of its slowest type');
});
