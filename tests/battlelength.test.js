// WHAT THE GAME PROMISES A BATTLE WILL COST, as a shape rather than as values.
//
// `targetLengthMin` is the one column of the region table nothing has ever
// asserted anything about. `tests/campaign.test.js` pins `enemyMult`
// non-decreasing, total sites non-decreasing, the opening force ratio and the
// castle-gate ceiling — and is silent on how long the game says a region takes.
// So it drifted from 6-9 minutes to 16-20 without a single test noticing, and
// it derives `hardCapMs`, which means it is not a label: it is the clock the
// battle is actually played against.
//
// THE VALUES ARE MID-RETUNE AND THIS FILE DELIBERATELY DOES NOT PIN THEM. What
// it pins is the two things that are true whatever the retune settles on: there
// is a ceiling past which a browser game has stopped being one, and the longest
// fight in the campaign belongs at the END of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { REGIONS } from '../src/content/regions.data.js';
import { HARD_CAP_MIN_BY_TIER, HARD_CAP_RATIO } from '../src/content/regions.rules.js';

const TIERS = [...new Set(REGIONS.map((r) => r.tier))].sort((a, b) => a - b);
const maxOfTier = (t) => Math.max(...REGIONS.filter((r) => r.tier === t).map((r) => r.targetLengthMin));

/** The number a player is actually held to, not the one they are shown. */
const capMinutes = (r) =>
  Math.max(HARD_CAP_MIN_BY_TIER[r.tier - 1], r.targetLengthMin * HARD_CAP_RATIO);

test('every region advertises a real, finite length', () => {
  for (const r of REGIONS) {
    assert.ok(Number.isFinite(r.targetLengthMin) && r.targetLengthMin > 0,
      `${r.id} advertises ${r.targetLengthMin}`);
  }
});

test('no battle is advertised longer than a browser session', () => {
  // A CEILING, not a target. 20 minutes advertised is a 38-minute hard cap, and
  // this project's own design premise — quoted in CLAUDE.md and ROADMAP.md — is
  // "a battle is 7-15 undistracted minutes". The ceiling here is deliberately
  // set ABOVE that premise rather than at it, so this test is about the thing
  // nobody could defend rather than about the thing under discussion: if a
  // region ever wants more than twenty minutes, that is a product decision and
  // it should cost a conversation, not a one-character edit.
  for (const r of REGIONS) {
    assert.ok(r.targetLengthMin <= 20,
      `${r.id} (tier ${r.tier}) advertises ${r.targetLengthMin} minutes — over the 20 ceiling`);
  }
});

test('...and the hard cap it derives stays under an hour', () => {
  // `hardCapMs` is the real clock. A player who fights to the cap has spent this
  // much of their evening on ONE region, win or lose.
  for (const r of REGIONS) {
    assert.ok(capMinutes(r) <= 60,
      `${r.id} can run ${capMinutes(r).toFixed(0)} minutes before the cap`);
  }
});

test('THE LONGEST FIGHT IN THE CAMPAIGN IS IN THE LAST TIER', () => {
  // ⚠ THIS IS THE RETUNE'S ACCEPTANCE TEST, not separate work — the same
  // standing as `campaignplay`, `scout`, `tactics` and `loadoutdominance`, and
  // it fails today for the same root cause.
  //
  // The campaign currently peaks at TIER 3: gallowmoor, sunder and vaelstrand
  // are advertised at 20 minutes while every tier-6 region is 16-18. So a player
  // who just spent twenty minutes on gallowmoor is told the tier-6 opener is a
  // shorter fight, and nothing in the game explains that because it is not
  // explicable — it is an artifact of raising tier 3's promise to stop
  // `hardCapMs` pinning it to a clock it could not resolve inside.
  //
  // The rule is deliberately weak: not "non-decreasing by tier" (tier 1 at 10
  // and tier 2 at 9 is a one-minute wobble nobody would feel), just "the
  // campaign does not bulge in the middle".
  const last = TIERS[TIERS.length - 1];
  const peak = TIERS.reduce((best, t) => (maxOfTier(t) > maxOfTier(best) ? t : best), TIERS[0]);
  assert.equal(peak, last,
    `the longest advertised battle is in tier ${peak} (${maxOfTier(peak)} min), not the final `
    + `tier ${last} (${maxOfTier(last)} min). A later region promising a shorter fight than `
    + 'an earlier one is not something a player can be told; it reads as the game being '
    + 'wrong about itself. This is the campaign re-tune\'s to settle — see ROADMAP.md, '
    + 'the fun-and-playability pass.');
});
