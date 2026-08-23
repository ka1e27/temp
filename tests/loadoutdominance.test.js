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
import { inBand, bandFor } from '../tools/winband.js';
import { TICK_HZ } from '../src/core/loop.js';

// TWO REGIONS, AND WHAT THE SECOND ONE IS FOR IS NOT WHAT IT LOOKS LIKE.
//
// This file measured gallowmoor alone and gallowmoor is mid-retune, so it now
// reports a ZERO gap — which reads as "somebody fixed the dominant loadout" and
// is not that. Its DEFAULT spread collapsed to 38% against a 50-72 band. **A gap
// is a difference between two numbers and says nothing when one of them is
// broken.** That is the real defect in this instrument, and a second region does
// not fix it on its own: measured by hand at n=24 on the same table,
//
//     region        band     default   mono   gap    medians          ratio
//     kaldan       66-84       73%      81%    +8    9.7m -> 8.2m      0.85
//     gallowmoor   50-72       38%      38%     0   24.6m -> 13.7m     0.56
//     thanescar    34-56       29%      33%    +4   17.3m -> 14.0m     0.81
//     ravensmarch  22-42       17%      13%    -4   26.2m -> 10.2m     0.39
//
// — every mid and late row is BELOW its own floor, so not one of their gaps is
// readable, and the only in-band row is kaldan, which is the documented CONTROL
// (ROADMAP.md lists it at `+0 / +8` beside the note that kaldan is what makes
// this a late-campaign hole rather than a global one). A critic proposed kaldan
// as the region to pin the exploit to, reporting +25; it reads +12 at n=24 and
// **+8 at n=48**, landing exactly on its recorded control value.
//
// So kaldan is here as the HEALTHY BASELINE — the row that proves the
// measurement is still live — and gallowmoor as the historical one every number
// in CLAUDE.md was taken on. Ravensmarch is the strongest surviving row and is
// deliberately NOT in the file: a tier-5 region at n=24 x 2 loadouts is minutes
// of wall clock on its own, and a test nobody will wait for is a test nobody
// runs. Its numbers are in the table above; re-take them by hand.
const CONTROL = 'kaldan';
const REGIONS_UNDER_TEST = [CONTROL, 'gallowmoor'];
const before = (id) => REGIONS.slice(0, REGIONS.findIndex((r) => r.id === id)).map((r) => r.id);
const tierOf = (id) => REGIONS.find((r) => r.id === id).tier;

// Matched seeds, the same arithmetic tools/simrunner.js uses, so a number taken
// here and a number taken at the CLI are the same number.
//
// ⚠ N WAS 24 AND THAT WAS TOO SMALL FOR THIS FILE'S OWN CLAIMS — measured twice,
// on both rows, in one afternoon. A win-rate GAP is a difference of two rates, so
// its standard error is `sqrt(2 * p * (1-p) / n)`: **12.5 points at n=24** and 8.8
// at n=48. Every assertion here was inside that.
//
//     row          n=24 (this file)      n=48 (by hand)     truth
//     kaldan       79->75   gap  -4      73->79   gap  +6   ~0, it is the CONTROL
//     gallowmoor   63->79   gap +16      54->81   gap +27   the defect
//
// So the file reported the control INVERTED (it had not) and the defect at half
// its size (it had not shrunk). Doubling n halves neither problem away, but it
// does make the thresholds below supportable rather than decorative — and this
// file already lives in the "run it alone with a long timeout" bucket, so its
// wall clock was never what bounded anybody's workflow.
const N = 48;
const SEED = (i) => 1000 + i * 7919;

const MONO_MILITIA = { militia: 1, spearmen: 0, raiders: 0, rams: 0 };

/** Win rate and win-median minutes over N matched seeds. */
function measure(region, weights) {
  const runs = [];
  for (let i = 0; i < N; i++) {
    runs.push(playOne(region, SEED(i), before(region), 10, weights ? { weights } : {}));
  }
  const wins = runs.filter((r) => r.status === 'win');
  const mins = wins.map((r) => r.ticks / TICK_HZ / 60).sort((a, b) => a - b);
  return {
    pct: Math.round((wins.length / runs.length) * 100),
    winMed: mins.length ? mins[Math.floor(mins.length / 2)] : NaN,
  };
}

/**
 * The whole army the player lands with, by unit, at tick 0.
 *
 * GALLOWMOOR EXPLICITLY, not "the first region under test". Defaulting to the
 * head of that list broke the moment kaldan joined it as the healthy baseline:
 * a tier-2 landing is 93 bodies, and the `> 100` floor below — which is there to
 * catch an expedition that was DISCARDED, not one that is merely small — fired on
 * a perfectly healthy army. The control needs a region with a budget big enough
 * that "nothing was fielded" and "this is an early region" cannot be confused.
 */
function landingForce(weights, region = 'gallowmoor') {
  const battle = startRun(region, SEED(0), before(region), 10, weights ? { weights } : {});
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

test('loadout: bringing only militia converts a real fight into a walkover', { timeout: 900_000 }, () => {
  const rows = REGIONS_UNDER_TEST.map((id) => {
    const spread = measure(id, null);
    const mono = measure(id, MONO_MILITIA);
    const tier = tierOf(id);
    return {
      id,
      tier,
      spread,
      mono,
      gap: mono.pct - spread.pct,
      // The ratio of win medians, which is the TEMPO claim and the one that
      // survives a mid-retune baseline — see below.
      ratio: spread.winMed > 0 ? mono.winMed / spread.winMed : NaN,
      healthy: inBand(spread.pct, tier),
    };
  });
  const report = rows.map((r) => `${r.id}: ${r.spread.pct}% -> ${r.mono.pct}% (gap ${r.gap}, `
    + `band ${bandFor(r.tier).join('-')}, medians ${r.spread.winMed.toFixed(1)}m -> `
    + `${r.mono.winMed.toFixed(1)}m)`).join('; ');

  // THE WIN-RATE GAP IS ONLY READABLE AGAINST A HEALTHY BASELINE, and that is the
  // correction this test needed rather than a second region on its own.
  //
  // A gap is a difference between two numbers, and it says nothing about the
  // exploit when one of them is broken. Measured on the current mid-retune table:
  // gallowmoor's default spread is at 38% against a 50-72 band and its gap reads
  // ZERO; ravensmarch's is at 17% against 22-42 and its gap reads MINUS FOUR. The
  // mono army did not get worse on either — the honest army fell to where a mono
  // army cannot beat it by much, because both are losing.
  //
  // So the gap is asserted only where the default is inside its tier's band, and
  // where none is, the test SAYS SO rather than failing on the campaign's dial.
  // That is not a loophole: `tests/campaignplay.test.js` is what fails when the
  // campaign is out of band, and this file failing for the same reason would be
  // two tests reporting one problem in different vocabularies — which is exactly
  // how "the harness declined to play" once read as a balance win.
  const readable = rows.filter((r) => r.healthy);

  assert.ok(readable.length,
    `every default spread is outside its tier band, so nothing here can be read as a `
    + `loadout measurement at all. ${report}. That is the CAMPAIGN's problem and `
    + '`tests/campaignplay.test.js` is what should be failing for it — but this file '
    + 'refuses to assert into the dark, so fix the table before trusting a number here.');

  // ⚠ THE DIRECTION USED TO BE ASSERTED ON *EVERY* HEALTHY ROW, INCLUDING THE
  // CONTROL, AND THAT IS INCOHERENT — it demanded a sign from a quantity chosen
  // because it has none. kaldan is in this file precisely because the exploit is
  // ABSENT there (`+0 / +8` recorded), so `gap >= 0` was asking a coin which way
  // it had landed, and `ratio < 1` was asking the same of two medians a battle
  // apart. Both fail about half the time, on nothing.
  //
  // NOT AN ARGUMENT — THE SAME ROW, THE SAME TABLE, THE SAME AFTERNOON:
  //
  //     kaldan  n=24    79% -> 75%   gap  -4   ratio 1.01   <- this file, RED
  //     kaldan  n=48    73% -> 79%   gap  +6   ratio 1.02   <- by hand, and the
  //                                                            recorded control
  //
  // Ten points apart. At n=24 the standard error of a DIFFERENCE of two rates
  // near 0.75 is `sqrt(2 * 0.75 * 0.25 / 24)` ≈ 12.5 points, so a single seed
  // flipping is 4.2 points and the whole assertion lived inside the noise. No
  // sample size this test can afford rescues it: the true value is ~0.
  //
  // So the direction is asserted where a direction EXISTS — on the gradable rows,
  // where it is the weak form of the magnitude claim below and free — and the
  // control is asserted as a CONTROL: the exploit must stay absent from it. That
  // is the claim kaldan is actually here to make, and it is the one that fails if
  // the hole ever stops being late-campaign.
  //
  // ±2 SEM is what n=24 buys and it is admittedly wide — a +25 arriving on kaldan
  // would squeak past it. The SHARP form of the same claim is not an absolute
  // bound at all, it is the COMPARISON below: control against gradable, measured
  // on the same run over the same seeds, which is far better powered than either
  // number alone. The bound is the always-live floor; the comparison is the one
  // that means something, and it is only available when both rows are in band.
  const SAMPLING_STEP = 100 / N;
  const NOISE = 2 * Math.round(Math.sqrt(2 * 0.75 * 0.25 / N) * 100);
  for (const r of readable) {
    if (r.id === CONTROL) {
      assert.ok(Math.abs(r.gap) <= NOISE,
        `${CONTROL} is this file's CONTROL — the row that says the dominant loadout is a `
        + `late-campaign hole rather than a global one — and its gap has moved to `
        + `${r.gap} points, past the ±${NOISE} this sample can produce (n=${N}, one seed `
        + `is ${SAMPLING_STEP.toFixed(1)} points). Either the exploit reached tier 2, or `
        + `the control needs re-choosing. ${report}`);
      continue;
    }
    assert.ok(r.gap >= 0,
      `on ${r.id}, whose baseline IS healthy, the mono army did WORSE than the honest `
      + `one (${r.gap} points). The defect inverting is a bigger event than it `
      + `closing. ${report}`);
    assert.ok(!(r.ratio >= 1),
      `on ${r.id} the mono army is no faster than the honest one. ${report}`);
  }

  // THE MAGNITUDE, ONLY WHERE IT CAN BE READ. `+20` is the recorded shape of the
  // defect and asserting it against a collapsed baseline is what made this file
  // red for the wrong reason — see the table in the header.
  //
  // KALDAN IS EXCLUDED FROM THIS ONE, and it is the excluded row on purpose: it is
  // the control that says the hole is late-campaign, so demanding +20 there would
  // encode the opposite of the defect. Today that leaves nothing to assert, which
  // is the finding rather than a hole in the test — and it is REPORTED loudly so
  // it cannot pass quietly.
  const gradable = readable.filter((r) => r.id !== CONTROL);
  const control = readable.find((r) => r.id === CONTROL);
  if (gradable.length && control) {
    // THE LATE-CAMPAIGN CLAIM ITSELF, and the only form of it this file can
    // measure well. Both rows are played over the SAME seeds in the same run, so
    // this compares two gaps rather than asserting a bound on one — and it is the
    // sentence CLAUDE.md and ROADMAP.md both make in prose ("kaldan is the control
    // at +0/+8, so this is a late-campaign hole, not a global one"). If it ever
    // fails, that prose is what needs rewriting, not this line.
    const worst = Math.max(...gradable.map((r) => r.gap));
    assert.ok(worst > control.gap,
      `the dominant loadout is documented as a LATE-CAMPAIGN hole, but ${CONTROL} `
      + `(tier ${control.tier}) now reads a gap of ${control.gap} against the worst `
      + `gradable row's ${worst}. Either it spread down the campaign or the framing in `
      + `CLAUDE.md is stale. ${report}`);
  }
  if (gradable.length) {
    const best = Math.max(...gradable.map((r) => r.gap));
    // TWELVE, NOT TWENTY, AND THE ARITHMETIC IS THE WHOLE JUSTIFICATION. The
    // measured gap is +27 (gallowmoor, n=48). A threshold has to sit far enough
    // below the truth that ordinary sampling cannot cross it, or the test is a
    // coin: at n=48 the SEM of a gap is 8.8 points, so `>= 20` is 0.8 SEM under
    // +27 and would go red about one run in five WITH NOTHING WRONG. 12 is 1.7
    // SEM under, which is a claim rather than a coin — and it still fails flat if
    // the exploit closes (a fixed loadout reads ~0) or if the weights stop
    // reaching the battle. `+20` was a remembered number, never a supported one.
    assert.ok(best >= 12,
      `mono-militia beat the default spread by only ${best} points (floor 12, recorded `
      + `shape +27) on a region whose baseline is healthy. ${report}. Either somebody `
      + `FIXED the dominant loadout -- `
      + 'in which case re-take these numbers, retire this framing and close the bullet '
      + 'in CLAUDE.md -- or the weights stopped reaching the battle, which the first '
      + 'test in this file would normally catch.');
  } else {
    console.log(`  # magnitude unreadable: no gradable row is in band. ${report}`);
  }

  // THE HALF THAT SURVIVES A MID-RETUNE TABLE, AND IT IS THE BETTER CLAIM ANYWAY.
  // The exploit does not merely win more often, it DELETES THE BATTLE — and a
  // ratio of win medians is a comparison of the exploit against the honest army
  // on the SAME dial, so moving the dial moves both and cancels out. Measured on
  // the current table: ravensmarch 26.2m -> 10.2m, a ratio of 0.39, on the same
  // runs whose win-rate gap reads minus four.
  //
  // This is now the primary pin. If the win-rate gap ever has to be dropped for
  // good, this is what should remain.
  //
  // ⚠ AND THE MAGNITUDE OF *THIS* HALF HAS WEAKENED TOO, which is why it is
  // reported rather than pinned at a number. Measured: ravensmarch 0.39,
  // thanescar 0.81, kaldan 0.85. Only the deepest row still "deletes the
  // battle"; on the rest mono is merely quicker. Asserting `< 0.75` across the
  // board would fail on kaldan and gallowmoor for the same reason the win-rate
  // gap does — a claim about a table that is mid-retune.
  const timed = rows.filter((r) => Number.isFinite(r.ratio));
  assert.ok(timed.length, `no region produced a win median for both loadouts. ${report}`);
  console.log(`  # tempo ratios: ${timed.map((r) => `${r.id} ${r.ratio.toFixed(2)}`).join(', ')}`);
});
