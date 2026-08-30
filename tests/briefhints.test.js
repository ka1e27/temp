// THE LOADOUT BRIEF MUST NOT PUT AN UNEXPLAINED NUMBER IN FRONT OF A PLAYER.
//
// "Hard cap" was developer jargon on a player-facing row, one line under
// "Typical length" — two numbers that mean opposite things (one is a promise,
// the other ENDS the battle) with no explanation on either. This is the same
// shape as the away-cap figure the first-session critic filed, and it is fixed
// the same way: a plain label plus a title on BOTH halves of the row, because a
// player hovers whichever their pointer is over.
//
// Pinned as PROPERTIES rather than as exact strings, so a copy rewrite that
// keeps the promise does not fail and one that drops the explanation does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UI } from '../src/content/strings.js';
import { REGIONS } from '../src/content/regions.data.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('the time-limit row is plain English, not "hard cap"', () => {
  assert.ok(UI.timeLimit, 'UI.timeLimit is missing');
  assert.doesNotMatch(UI.timeLimit, /hard cap/i,
    'the label is the jargon this exists to remove');
  // NEGATIVE CONTROL: the internal name is untouched — this is a copy fix, not
  // a rename of the mechanic. `hardCapMs` is what the region table and the
  // simrunner speak, and renaming it would be a much larger, riskier change.
  assert.ok(REGIONS.every((r) => Number.isFinite(r.hardCapMs)),
    'hardCapMs must still be the field the table carries');
});

test('both numbers carry an explanation, and each names what it is NOT', () => {
  // The confusion this fixes is between the two rows, so each hint has to
  // distinguish itself from its neighbour rather than merely describe itself.
  assert.match(UI.timeLimitHint, /not a target|whatever is happening/i,
    'the cap hint must say it is a wall rather than a goal');
  assert.match(UI.typicalLengthHint, /guide|not a deadline/i,
    'the length hint must say it is not the thing that ends the fight');
});

test('the cap hint tells the player what they still get, and that is TRUE', () => {
  // A timeout while ahead on territory pays — `HELD_FIELD` in payout.data.js,
  // via meta/rewards.js `heldFieldPay`. The hint says so, so the claim has to
  // be checked against the code rather than trusted: copy that promises a
  // payout the game does not make is worse than copy that says nothing.
  assert.match(UI.timeLimitHint, /still get paid|ground you hold/i);
  const rewards = read('../src/meta/rewards.js');
  assert.match(rewards, /heldFieldPay/,
    'the hint promises a held-field payout that rewards.js does not implement');
  // ...and it must not over-claim: the region is NOT taken.
  assert.match(UI.timeLimitHint, /not taken|region is not/i,
    'the hint must say the region is still not conquered');
});

test('the hints reach a screen', () => {
  // The guard tests/offlinenotice.test.js applies to the IDLE block: copy with
  // no reader goes stale silently. Named literally at the point of use, which
  // is what keeps this greppable — see CLAUDE.md on why injecting a strings
  // object would disable exactly this check.
  const brief = read('../src/screens/prebattle-brief.js');
  for (const key of ['timeLimit', 'timeLimitHint', 'typicalLengthHint']) {
    assert.match(brief, new RegExp(`UI\\.${key}\\b`), `UI.${key} reaches no screen`);
  }
  // The rows AND their renderer both live in prebattle-brief.js — checked
  // rather than assumed, because the first version of this test looked in
  // prebattle.js (the scene) and failed on a fix that was perfectly correct.
  assert.match(brief, /hint \? \{ title: hint \}/,
    'the third row slot must be rendered as a title, or the hints are dead copy');
});

test('the title lands on BOTH halves of the row', () => {
  // A title on one of two is a coin flip — the exact reason UI.offlineCapHint
  // titles its label and its value.
  const screen = read('../src/screens/prebattle-brief.js');
  const dl = screen.slice(screen.indexOf('pb-stats'), screen.indexOf('pb-stats') + 400);
  assert.equal((dl.match(/title: hint/g) || []).length, 2,
    'both dt and dd must carry the title');
});
