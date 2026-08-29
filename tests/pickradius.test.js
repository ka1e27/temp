// HOW BIG A SITE IS TO POINT AT, which is not the same question as how big it
// is to look at — and the difference is the whole bug.
//
// A site's radius is in WORLD units and scales with the camera. That is right
// for a picture and wrong for a target: a fingertip and a cursor are the same
// size whatever the zoom, and the board AUTO-FITS, so a bigger region is a
// smaller one. Measured at 1440x761 before `MIN_PICK_PX` existed, ten of the
// twenty-four regions put a farm under the 44px minimum `tools/mobile.mjs`
// already enforced for every DOM control:
//
//     board    11x9   15x11   17x13   19x15   21x16
//     farm     59px    49px    41px    36px    34px
//     tower    55px    45px    38px    33px    31px
//
// The negative control is the important half here, and it is not hypothetical:
// `battle-input.js` calls `siteAt` with `slop = 1` to ask the PRECISE question
// — is the press actually ON this building, or was it only forgiven near it —
// and that answer is what lets a camped army win a press a farm would otherwise
// swallow. A floor applied there would make the tight call forgiving and take
// that gesture back.
import test from 'node:test';
import assert from 'node:assert/strict';

import { pickRadius, siteRadius, MIN_PICK_PX } from '../src/render/siteShapes.js';

const HEX = 34;                 // battleView.js HEX_SIZE; the camera does the zooming
const KINDS = ['farm', 'watchtower', 'trainingGround', 'stronghold', 'camp', 'castle'];
/** What the old rule gave, so "unchanged" can be asserted as equality. */
const noFloor = (kind, slop) => siteRadius(kind, HEX) * slop + HEX * 0.25;
const screenDiam = (kind, slop, zoom) => 2 * pickRadius(kind, HEX, slop, zoom) * zoom;

test('pick: no site is ever smaller than the 44px minimum, at any zoom', () => {
  // 0.683 is widowsgate's auto-fit at 1440x761 and 0.610 is the same board on a
  // 1280x700 laptop — the two that were worst. 0.35 is well past anything the
  // campaign produces and is here so the rule is pinned as a rule.
  for (const zoom of [0.35, 0.610, 0.683, 0.728, 0.837, 1.0, 1.195]) {
    for (const kind of KINDS) {
      const d = screenDiam(kind, 1.25, zoom);
      assert.ok(d >= MIN_PICK_PX - 1e-9,
        `${kind} is ${d.toFixed(1)}px at zoom ${zoom} — under the ${MIN_PICK_PX}px floor`);
    }
  }
});

test('pick: NEGATIVE CONTROL — the precise question is untouched at every zoom', () => {
  // If this ever starts passing through the floor, the camped-army-beats-a-near
  // -miss rule is gone and nothing else in the suite would say so.
  for (const zoom of [0.35, 0.610, 0.683, 1.0, 1.195]) {
    for (const kind of KINDS) {
      assert.equal(pickRadius(kind, HEX, 1, zoom), noFloor(kind, 1),
        `${kind} at zoom ${zoom}: slop=1 must never be floored`);
    }
  }
  // And the tight radius really is tighter, or the control proves nothing.
  assert.ok(pickRadius('farm', HEX, 1, 0.683) < pickRadius('farm', HEX, 1.25, 0.683));
});

test('pick: NEGATIVE CONTROL — inert wherever the site was already big enough', () => {
  // The floor is a floor, not a resize. On the small early boards every kind
  // already clears 44px, and those numbers are what the whole campaign was
  // measured with — a rule that quietly grew them would be a balance change
  // wearing an accessibility fix's clothes.
  let inert = 0;
  for (const zoom of [1.0, 1.195]) {
    for (const kind of KINDS) {
      if (screenDiam(kind, 1.25, zoom) <= MIN_PICK_PX + 1e-9) continue;
      assert.equal(pickRadius(kind, HEX, 1.25, zoom), noFloor(kind, 1.25),
        `${kind} at zoom ${zoom} already cleared the floor and must be unchanged`);
      inert++;
    }
  }
  assert.ok(inert >= 6,
    `only ${inert} kind/zoom pairs were above the floor — this control needs cases `
    + 'where the floor does NOT bind, or it is asserting nothing');
});

test('pick: it is a FLOOR, so a bigger site still has a bigger target', () => {
  // Flattening every kind to 44px would make a castle no easier to hit than a
  // watchtower, which is a different bug wearing the same fix.
  const zoom = 1.195;                       // riverfen, where nothing is floored
  const d = KINDS.map((k) => screenDiam(k, 1.25, zoom));
  for (let i = 1; i < d.length; i++) {
    if (KINDS[i] === 'watchtower') continue;   // deliberately the smallest body
    assert.ok(d[i] >= d[i - 1] - 1e-9,
      `${KINDS[i]} (${d[i].toFixed(1)}px) is not at least ${KINDS[i - 1]} (${d[i - 1].toFixed(1)}px)`);
  }
  assert.ok(d[KINDS.indexOf('castle')] > d[KINDS.indexOf('farm')] * 1.5,
    'a castle should be a much larger target than a farm');
});
