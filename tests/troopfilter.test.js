// THE TROOP RAIL OFFERS WHAT THE EXPEDITION BROUGHT, and nothing else.
//
// `LOADOUT_TYPES_MAX` is five and `meta/composition.js battleRoster` narrows the
// sim's roster to the types the expedition actually carries — but the filter
// rail was built from `UNIT_IDS`, all nine, and so was the keyboard. So the
// campaign opener (militia and spearmen) drew seven extra chips that toggled,
// lit up, and filtered a troop the army could not contain and could not train:
// `cmdTrain` gates on the same `unlockedUnits` field and answers `unit-locked`.
//
// The keyboard half is the worse one, because it leaves no trace. Pressing `U`
// in a battle with no halberds flipped `view.filter.halberds` to false and left
// it there — armed to silently exclude the troop the moment one was captured
// into the army, with no chip anywhere to show it had happened.
//
// The negative controls are the point: a battle carrying all nine must be
// exactly as it was, and a chip for a troop you DO carry must still toggle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { UNIT_IDS } from '../src/content/balance.js';
import { filterUnits, FILTER_KEYS } from '../src/screens/battle-keys.js';
import { battleRoster } from '../src/meta/composition.js';

const stateWith = (roster) => ({ mods: { player: { unlockedUnits: roster } } });

test('the rail is the expedition roster, in UNIT_IDS order', () => {
  // The roster's own order comes out of the shop; the chips' letters and
  // colours are learned positionally, so the rail must not reorder itself
  // because somebody bought halberds before outriders.
  const out = filterUnits(stateWith(['rams', 'militia', 'archers']));
  assert.deepEqual(out, ['militia', 'archers', 'rams']);
});

test('a battle carrying every troop is byte-identical to the old rail', () => {
  assert.deepEqual(filterUnits(stateWith([...UNIT_IDS])), UNIT_IDS);
});

test('a missing or empty roster falls back to the whole list, never to nothing', () => {
  // `assertBattleConfig` requires unlockedUnits non-empty, so this cannot fire
  // in a real battle — but an empty RAIL is the one failure mode that leaves the
  // player unable to filter anything at all, and showing too much is the safe
  // direction to be wrong in.
  assert.deepEqual(filterUnits(null), UNIT_IDS);
  assert.deepEqual(filterUnits({}), UNIT_IDS);
  assert.deepEqual(filterUnits(stateWith([])), UNIT_IDS);
  assert.deepEqual(filterUnits(stateWith('militia')), UNIT_IDS);
});

test('a troop unlocked in the shop but LEFT AT HOME gets no chip', () => {
  // This is the case the bug actually shipped in: `unlockedUnits` at the seam is
  // already `battleRoster(shopUnlocks, expedition)`, so the rail asking it is
  // asking about the expedition, not about the shop.
  const shop = ['militia', 'spearmen', 'raiders', 'rams', 'halberds'];
  const carried = { militia: 40, spearmen: 10 };
  const roster = battleRoster(shop, carried);
  assert.deepEqual(filterUnits(stateWith(roster)), ['militia', 'spearmen']);
});

test('every rail unit still has a key, and a key still exists for every unit', () => {
  // FILTER_KEYS stays complete over UNIT_IDS — narrowing the RAIL must not
  // narrow the table, or a troop unlocked later would have no letter.
  for (const u of UNIT_IDS) assert.ok(FILTER_KEYS[u], `no key for ${u}`);
  for (const u of filterUnits(stateWith(['militia', 'rams']))) assert.ok(FILTER_KEYS[u]);
});

// ---------------------------------------------------------------------------
// The keyboard asks the same question
// ---------------------------------------------------------------------------

import { createHotkeys } from '../src/screens/battle-hotkeys.js';

// `isControl` compares the event target against `document.body` to decide
// whether a focused button owns the letter. That is the only DOM this module
// touches, so the stub is exactly that much.
globalThis.document ??= { body: { tagName: 'BODY' } };
const BODY = globalThis.document.body;

function keys(roster) {
  const view = { filter: {}, selection: [], fraction: 0.5 };
  const state = stateWith(roster);
  const { onKey } = createHotkeys({
    view,
    ord: { retreatSelectedSquad: () => false, retreatSelection: () => {}, armBooster: () => {} },
    getState: () => state,
    clearDrag: () => {},
    cancelGestures: () => {},
  });
  return { view, press: (k) => onKey({ key: k, target: BODY }) };
}

test('a filter key for a troop the battle does not carry does nothing at all', () => {
  const { view, press } = keys(['militia', 'spearmen']);
  press(FILTER_KEYS.halberds);
  assert.equal(view.filter.halberds, undefined,
    'no chip on the rail, so no flag flipped behind it');
});

test('...and the key for a troop it DOES carry still toggles, both ways', () => {
  const { view, press } = keys(['militia', 'spearmen']);
  press(FILTER_KEYS.militia);
  assert.equal(view.filter.militia, true, 'first press flips it');
  press(FILTER_KEYS.militia);
  assert.equal(view.filter.militia, false, 'second press flips it back');
});

test('a battle carrying every troop binds every letter, exactly as before', () => {
  const { view, press } = keys([...UNIT_IDS]);
  for (const u of UNIT_IDS) press(FILTER_KEYS[u]);
  for (const u of UNIT_IDS) assert.equal(view.filter[u], true, `${u} did not toggle`);
});
