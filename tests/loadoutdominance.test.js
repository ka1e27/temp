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
// WHY IT IS MILITIA AND NOT "MONO ARMIES ARE GOOD": at slot cost 1 it is the
// highest combined stat per slot in the game (atk 4 + def 3 = 7.00/slot, against
// spearmen 6.50, raiders 5.67, rams 1.60). Concentration itself buys nothing:
// mono-spearmen measures BELOW the default spread. The third test is that
// control, and without it this file would pass just as happily against a game
// where every one-note army won.
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
import test from 'node:test';
import assert from 'node:assert/strict';

import { playOne, startRun } from '../tools/simplayer.js';
import { REGIONS } from '../src/content/regions.data.js';
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

test('loadout: concentration is not the exploit -- militia is', { timeout: 240_000 }, () => {
  // THE CONTROL THAT MAKES THE FILE MEAN SOMETHING. If a one-note army simply
  // beat a mixed one -- fewer counters to spread thin, one training queue --
  // then the finding above would be a statement about `distributeExpedition`
  // and the fix would be in composition code. It is not: spearmen are the
  // enemy's own staple, they land in the same numbers, and they measure AT OR
  // BELOW the default spread.
  //
  // But the lever is NOT militia's stat line -- see the three probes at the head
  // of this file, where every nerf widened the gap. What separates the two arms
  // is tempo, and the only mechanisms that can bite one and not the other are
  // ones sensitive to CONCENTRATION rather than to the unit.
  const spread = measure(null);
  const spears = measure(MONO_SPEARMEN);
  assert.ok(spears.pct <= spread.pct + 5,
    `mono-spearmen measured ${spears.pct}% against the default's ${spread.pct}% `
    + '-- if EVERY one-note army now wins, the problem stopped being militia\'s '
    + 'stat line and became something about composition itself, and the fix in '
    + 'CLAUDE.md is aimed at the wrong file');
});
