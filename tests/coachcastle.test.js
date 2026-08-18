// THE CASTLE BEAT TELLS THE TRUTH ABOUT *THIS* REGION.
//
// One line fired on castle reach everywhere and described a gate holding the
// throne. Riverfen — the campaign opener, the one battle a first-timer is
// guaranteed to play — ships `castleGateFrac: 0`, where `battle/siteinfo.js
// castleSealed` imposes no territory requirement at all. So the one script
// written to be trustworthy taught a rule that is inert in the region teaching
// it, and the panel readout that would have contradicted it (`gateLine` ->
// "SEALED - holds X% of Y% needed") only renders when the gate is real, so
// nothing on screen could correct it.
//
// Split from coach.test.js at the 400-line cap, along the seam that matters:
// every other beat turns on something the PLAYER did, and this pair turns on a
// rule of the region.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoachMachine } from '../src/ui/coach.js';
import { createMeta } from '../src/core/store.js';
import { battle, drain } from './fixtures/coachWorld.js';

/** Play far enough for the throne to come into reach, on a region whose gate
 *  is whatever the caller says it is. */
const play = (rules) => {
  const m = createCoachMachine();
  const world = { battle: battle({ rules }), meta: createMeta() };
  return drain(m, world, (i) => {
    if (i === 1) m.note('squad-sent', { owner: 'player' });
    if (i === 2) m.note('siege-begun', { owner: 'player', siteId: 'nf01' });
    if (i === 3) m.note('site-captured', { to: 'player', from: 'neutral', siteId: 'nf01' });
    // The farm actually changing hands is what puts the throne in reach —
    // `castleTouchesPlayer` reads the board, not the capture event.
    if (i === 4) world.battle.sites[1].owner = 'player';
  });
};

test('a gated region hears about the gate, and an open one does not', () => {
  assert.ok(play({ castleGateFrac: 0.6 }).includes('takeCastle'));
  assert.equal(play({ castleGateFrac: 0.6 }).includes('takeCastleOpen'), false);

  assert.ok(play({ castleGateFrac: 0 }).includes('takeCastleOpen'));
  assert.equal(play({ castleGateFrac: 0 }).includes('takeCastle'), false,
    'the campaign opener must not be told about a gate it does not have');
});

test('...and exactly one of the two ever fires in a battle', () => {
  // They are mutually exclusive on one signal, so a change that made both
  // predicates true would double up on the approach to every throne.
  for (const frac of [0, 0.35, 0.6]) {
    const fired = play({ castleGateFrac: frac });
    const n = fired.filter((id) => id === 'takeCastle' || id === 'takeCastleOpen').length;
    assert.equal(n, 1, `gate ${frac} fired ${n} castle beats`);
  }
});

test('a missing rules block reads as no gate, not as a gate', () => {
  // The safe direction: an unknown gate must not produce a claim about one.
  // It is also what a hand-built fixture gets, which is how the pair could be
  // mis-tested while looking correct.
  assert.ok(play(undefined).includes('takeCastleOpen'));
});
