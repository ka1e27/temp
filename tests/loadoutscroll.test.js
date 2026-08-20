// THE LOADOUT SCREEN MUST NOT HIDE THE PLAYER'S OWN ARMY.
//
// Measured in a real browser on the shipped layout: at a nine-unit roster on a
// 1440x800 laptop (`innerHeight` 661 after browser chrome), `.pb-body` had
// **210 pixels** of expedition below its own edge — two troop rows plus the free
// Marshal — and the platform draws an OVERLAY scrollbar, measured at 0px wide, so
// there was no scrollbar, no fade and no cue of any kind. The panel fits at
// 1440x900 with eight pixels to spare and clips at anything shorter, silently.
//
// This is the one screen whose entire job is "review what you are walking in
// with", so a truncation nothing announces is the worst place in the product for
// one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { moreBelow } from '../src/ui/dom.js';

const src = (rel) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');

test('a panel that fits claims nothing', () => {
  // The negative control, and the one that matters most: a permanent fade says
  // there is more when there is not, which is the same class of lie as saying
  // nothing when there is.
  assert.equal(moreBelow({ scrollHeight: 400, clientHeight: 400, scrollTop: 0 }), false);
  assert.equal(moreBelow({ scrollHeight: 400, clientHeight: 461, scrollTop: 0 }), false);
  assert.equal(moreBelow({}), false, 'an unmeasured element must not claim to overflow');
});

test('...and one that does not, does — at the measured numbers', () => {
  assert.equal(moreBelow({ scrollHeight: 671, clientHeight: 461, scrollTop: 0 }), true);
});

test('the fade clears at the end of the scroll, sub-pixel remainder and all', () => {
  assert.equal(moreBelow({ scrollHeight: 671, clientHeight: 461, scrollTop: 210 }), false);
  // Fractional layout heights leave a hair of remainder at the very bottom; a
  // strict `> 0` would leave the fade up forever on exactly those panels.
  assert.equal(moreBelow({ scrollHeight: 671.4, clientHeight: 461, scrollTop: 208 }), false);
  // ...but the slack must not swallow a real row. A `.pb-unit` is ~50px tall.
  assert.equal(moreBelow({ scrollHeight: 671, clientHeight: 461, scrollTop: 160 }), true);
});

test('the screen actually toggles it, and the stylesheet actually draws it', () => {
  // Both halves, because either alone is inert: a class nothing styles fades
  // nothing, and a style nothing sets is dead CSS. This is the `bindText` into
  // a detached node lesson — the writer exists, the rule exists, and they never
  // meet.
  const screen = src('screens/prebattle.js');
  assert.match(screen, /moreBelow\(/, 'the screen never measures the overflow');
  assert.match(screen, /classList\.toggle\('has-more'/, 'nothing sets the class');
  assert.match(screen, /addEventListener\('scroll'/, 'the fade never follows the scroll');
  assert.match(screen, /addEventListener\('resize'/,
    'the panel fits at 1440x900 and clips at 1440x800, so a resize crosses the '
    + 'boundary with nothing re-rendering');

  const css = src('styles/prebattle.css');
  assert.match(css, /\.pb-body\.has-more/, 'the class is set and styled by nothing');
  assert.match(css, /mask-image/, 'the has-more rule does not actually fade anything');
});

test('the scroll container is still a scroll container', () => {
  // The regression that would make every assertion above pass while the army is
  // once again unreachable: `overflow-y: auto` on `.pb-body` is what makes the
  // hidden rows reachable AT ALL, and the fade only advertises them.
  const css = src('styles/prebattle.css');
  assert.match(css, /\.pb-body \{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /scrollbar-gutter:\s*stable/,
    'without a stable gutter the three columns jump sideways when a ninth troop unlocks');
});
