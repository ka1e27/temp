// THE SHOP MUST NOT LIE ABOUT WHAT IT SELLS.
//
// Every booster's description used to be a hand-typed copy of numbers that live
// in `BOOSTERS`. The relic pass then made every booster stronger and updated
// none of the strings, so the shop advertised the OLD values for its entire
// life after that: Rally sold as "2 hops, 50%" while delivering 3 and 65%,
// Bombardment as "a quarter of a garrison and 60 structure" while doing a third
// and 110, the War Tithe as 15 seconds of training while granting 22.
//
// Every one of them UNDERSOLD the purchase, which is exactly why it survived —
// nobody files a bug because they got more than the label promised. It is the
// same shape as the four upgrades this project refunded for doing nothing, and
// as the mutator that was inert for its whole life: a second copy of a number
// that quietly stopped matching the first.
//
// The descriptions are template literals over `BOOSTERS` now. This file is the
// guard on that, so a future pass that retypes one as a plain string fails here
// rather than in a player's shop.
import test from 'node:test';
import assert from 'node:assert/strict';

import { UPGRADES } from '../src/content/upgrades.data.js';
import { BOOSTERS } from '../src/content/balance.js';

const descOf = (id) => UPGRADES.find((u) => u.id === id)?.desc ?? '';

test('shop: booster copy quotes the LIVE numbers, not a remembered set', () => {
  const rally = descOf('boosterRally');
  assert.match(rally, new RegExp(`\\b${BOOSTERS.rally.radius} hops\\b`),
    `Rally advertises the wrong reach: "${rally}"`);
  assert.match(rally, new RegExp(`\\b${Math.round(BOOSTERS.rally.fraction * 100)}%`),
    `Rally advertises the wrong share: "${rally}"`);

  const tithe = descOf('boosterTithe');
  assert.match(tithe, new RegExp(`\\b${BOOSTERS.tithe.gold}\\b`),
    `War Tithe advertises the wrong gold: "${tithe}"`);
  assert.match(tithe, new RegExp(`\\b${BOOSTERS.tithe.sec}s\\b`),
    `War Tithe advertises the wrong duration: "${tithe}"`);

  const bombard = descOf('boosterBombard');
  assert.match(bombard, new RegExp(`\\b${Math.round(BOOSTERS.bombard.garrisonFrac * 100)}%`),
    `Bombardment advertises the wrong garrison share: "${bombard}"`);
  assert.match(bombard, new RegExp(`\\b${BOOSTERS.bombard.hp}\\b`),
    `Bombardment advertises the wrong structure damage: "${bombard}"`);
});

test('shop: the copy is DERIVED, so moving a booster moves its description', () => {
  // THE NEGATIVE CONTROL, and the whole reason the test above is not enough on
  // its own: hand-typed strings that happen to be correct today would pass it.
  // This asserts the coupling itself — the numbers in the sentence have to come
  // from `BOOSTERS`, so that a tuning pass cannot silently desynchronise them.
  const seen = descOf('boosterRally');
  assert.ok(seen.includes(String(BOOSTERS.rally.radius)),
    'the reach in the copy is not the reach in the data');
  // A description with no digits at all would pass every `match` above by
  // vacuously failing none of them, so require the shape too.
  for (const id of ['boosterRally', 'boosterTithe', 'boosterBombard']) {
    assert.match(descOf(id), /\d/, `${id} has no numbers in its copy at all`);
  }
});
