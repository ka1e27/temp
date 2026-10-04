// Phase 7 integration (PLAN-PHASE7): every Boon, Duo and Relic has its own drawn mark in the UI kit, and the glue's offer identity behaves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ICON_NAMES } from '../ui/icons.js';
import { BOON_LIST, DUO_LIST } from '../config/boons.js';
import { RELIC_LIST } from '../config/relics.js';
import { boonIcon, relicIcon, offerSig, BOON_ICONS, RELIC_ICONS } from '../app/boons.js';
import { boonFrame } from '../ui/boonDraft.js';

test('every Boon and Duo maps to an icon the kit draws', () => {
  for (const b of [...BOON_LIST, ...DUO_LIST]) {
    assert.ok(BOON_ICONS[b.id], `${b.id} has a mark of its own`);
    assert.ok(ICON_NAMES.includes(boonIcon(b.id, b.icon)), `${b.id} -> ${boonIcon(b.id, b.icon)}`);
  }
});

test('every Relic maps to an icon the kit draws', () => {
  for (const r of RELIC_LIST) {
    assert.ok(RELIC_ICONS[r.id], `${r.id} has a mark of its own`);
    assert.ok(ICON_NAMES.includes(relicIcon(r.id, r.icon)), `${r.id} -> ${relicIcon(r.id, r.icon)}`);
  }
  assert.ok(ICON_NAMES.includes('chest') && ICON_NAMES.includes('boonCard') && ICON_NAMES.includes('duoLink'));
});

test('unknown ids fall back to a drawable icon', () => {
  assert.equal(boonIcon('nope', 'not-an-icon'), 'boonCard');
  assert.equal(boonIcon('nope', 'flame'), 'flame');
  assert.equal(relicIcon('nope', 'not-an-icon'), 'chest');
});

test('a cursed Boon wears the cursed frame whatever its rarity', () => {
  assert.equal(boonFrame({ rarity: 'rare', cursed: true }), 'cursed');
  assert.equal(boonFrame({ rarity: 'legendary', cursed: false }), 'legendary');
  assert.equal(boonFrame({ rarity: 'common' }), 'common');
});

test('offerSig changes with a new draft and clears when taken', () => {
  const st = { boons2: { draws: 1, pending: { choices: ['a', 'b', 'c'], source: 'battle' } } };
  const s1 = offerSig(st);
  assert.ok(s1);
  st.boons2.draws = 2;
  st.boons2.pending = { choices: ['d', 'e', 'f'], source: 'battle' };
  assert.notEqual(offerSig(st), s1);
  st.boons2.pending = null;
  assert.equal(offerSig(st), '');
  assert.equal(offerSig({}), '');
});
