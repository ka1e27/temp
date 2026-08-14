// The words the game uses for its five troop types.
//
// The dock chips read `MIL Q` / `SPE W` / `RAI E` / `RAM R` / `MAR T`, which is
// only legible to somebody who has already read balance.js. They now carry the
// real name and a hover card, and this file holds that copy to two promises:
//
//   1. COMPLETENESS, driven off UNIT_IDS — adding a sixth unit must not be able
//      to ship a chip labelled `undefined` with an empty tooltip. That is not a
//      hypothetical: UNIT_LABEL already existed and a second table would have
//      drifted from it on the first rename, so the names are pinned to it too.
//
//   2. HONESTY. Every multiplier quoted in the copy is re-derived HERE from
//      UNITS in balance.js and asserted to appear in the text. So retuning a
//      raider's river bonus fails this file until the sentence describing it
//      moves with the number. A tooltip that confidently states the wrong
//      multiplier is worse than no tooltip: the player will believe it and lose
//      a battle to it.
import test from 'node:test';
import assert from 'node:assert/strict';

import { UNIT_IDS, UNITS, UNIT_SLOTS, SIEGE_FRONTAGE } from '../src/content/balance.js';
import { UNITS_UI } from '../src/content/strings.js';
import { UNIT_LABEL } from '../src/screens/prebattle.js';
import { FILTER_KEYS } from '../src/screens/battle-keys.js';

/** How the copy is expected to render a multiplier: `x1.20`, `x0.70`. */
const mult = (n) => n.toFixed(2);
/** How the copy is expected to render a counter bonus: `75%`, `260%`. */
const pct = (n) => `${Math.round(n * 100)}%`;

test('every unit the game can field has a name, a role and a description', () => {
  for (const id of UNIT_IDS) {
    const copy = UNITS_UI[id];
    assert.ok(copy, `no UNITS_UI entry for "${id}"`);
    assert.equal(typeof copy.name, 'string');
    assert.ok(copy.name.length >= 3, `"${id}" has no real name`);
    assert.ok(copy.role && copy.role.length >= 4, `"${id}" has no role`);
    assert.ok(copy.desc && copy.desc.length >= 60, `"${id}" has no description worth reading`);
  }
});

test('the names are the FULL names, never the three-letter stubs', () => {
  for (const id of UNIT_IDS) {
    const { name } = UNITS_UI[id];
    assert.notEqual(name.toUpperCase(), id.slice(0, 3).toUpperCase(), `"${id}" is still a stub`);
    assert.equal(name.toLowerCase(), id.toLowerCase(),
      'a unit is called what the simulation calls it, spelled out');
  }
});

test('one name per unit, shared with the loadout screen', () => {
  // Two tables of unit names is one table too many: the pre-battle screen and
  // the battle HUD have to say the same word for the same troop.
  for (const id of UNIT_IDS) assert.equal(UNITS_UI[id].name, UNIT_LABEL[id], `"${id}" disagrees`);
});

test('the copy carries no leftovers', () => {
  for (const id of UNIT_IDS) {
    const { name, role, desc } = UNITS_UI[id];
    for (const [what, text] of [['name', name], ['role', role], ['desc', desc]]) {
      assert.doesNotMatch(text, /TODO|TBD|undefined|NaN|\{|\}/, `${id}.${what}: ${text}`);
      assert.equal(text, text.trim(), `${id}.${what} has stray whitespace`);
    }
    assert.ok(desc.trim().endsWith('.'), `${id}.desc does not end in a full stop`);
    assert.ok(desc.length <= 300, `${id}.desc is ${desc.length} chars — too long to read on hover`);
  }
});

test('every unit is reachable by a hotkey the copy can quote', () => {
  for (const id of UNIT_IDS) assert.ok(FILTER_KEYS[id], `no filter key for "${id}"`);
});

// ---------------------------------------------------------------------------
// The copy against the tuning table
// ---------------------------------------------------------------------------

test('terrain multipliers in the copy are the ones the simulation uses', () => {
  let checked = 0;
  for (const id of UNIT_IDS) {
    const ground = UNITS[id].ground;
    const { desc } = UNITS_UI[id];
    if (!ground) {
      // Militia and the marshal have no `ground` block, which combat.js reads
      // as exactly 1.0 everywhere — the deliberate "does not care what the map
      // looks like" unit. Militia is the one that has to SAY so.
      continue;
    }
    for (const [kind, m] of Object.entries(ground)) {
      assert.ok(desc.includes(mult(m)),
        `${id}: ${kind} is x${mult(m)} but the copy never says so — "${desc}"`);
      assert.ok(desc.toLowerCase().includes(kind),
        `${id}: the copy quotes x${mult(m)} without naming ${kind}`);
      checked++;
    }
  }
  assert.ok(checked >= 6, `only ${checked} terrain multipliers checked — is UNITS.ground gone?`);
});

test('militia is described as the unit terrain does nothing to', () => {
  assert.equal(UNITS.militia.ground, undefined, 'militia must stay terrain-proof');
  assert.ok(UNITS_UI.militia.desc.includes('1.00'),
    'the point of militia is that it is x1.00 everywhere, and the copy has to say it');
});

test('counter bonuses in the copy are the ones combat.js applies', () => {
  let checked = 0;
  for (const id of UNIT_IDS) {
    const { desc } = UNITS_UI[id];
    for (const [foe, bonus] of Object.entries(UNITS[id].counters ?? {})) {
      assert.ok(desc.includes(pct(bonus)),
        `${id} counters ${foe} for ${pct(bonus)} and the copy never says so — "${desc}"`);
      assert.ok(desc.toLowerCase().includes(foe), `${id}: ${pct(bonus)} quoted without naming ${foe}`);
      checked++;
    }
  }
  assert.ok(checked >= 5, `only ${checked} counters checked — did UNITS.counters move?`);
});

test('the spear bulwark and the marshal banner are quoted, not approximated', () => {
  assert.ok(UNITS_UI.spearmen.desc.includes(mult(UNITS.spearmen.bulwark)),
    `spearmen defend at x${mult(UNITS.spearmen.bulwark)} on their own ground`);
  assert.ok(UNITS_UI.marshal.desc.includes(pct(UNITS.marshal.banner)),
    `the banner is ${pct(UNITS.marshal.banner)} to the whole stack`);
  assert.ok(UNITS_UI.marshal.desc.includes(pct(UNITS.marshal.trainBuff)),
    `and ${pct(UNITS.marshal.trainBuff)} to training where it sits`);
  assert.ok(/one per site/i.test(UNITS_UI.marshal.desc),
    'maxPerSite is a hard engine rule and the copy has to state it');
  assert.equal(UNITS.marshal.maxPerSite, 1);
  assert.equal(UNIT_SLOTS.marshal, 8, 'the copy prices a marshal at eight militia');
  assert.equal(UNIT_SLOTS.militia, 1);
});

test('the ram is described by the two numbers that make it worth its slots', () => {
  const { desc } = UNITS_UI.rams;
  assert.ok(desc.includes(String(UNITS.rams.siege)), `siege is ${UNITS.rams.siege}`);
  assert.ok(desc.includes(mult(UNITS.rams.base)),
    `a ram is worth x${mult(UNITS.rams.base)} of a normal unit in a field fight`);

  // THE FRONTAGE IS A PLAYER-FACING RULE AND THIS IS THE ONLY PLACE IT IS SAID.
  // A player who brings a crowd and reads "BREACH IN 385s" off the HUD has no
  // other way to learn why: `SIEGE_FRONTAGE` caps ordinary bodies at one wall
  // and exempts engines, which is the entire reason a ram earns its slots. The
  // number is asserted against the constant so the copy cannot drift from the
  // rule the way four sold-but-dead upgrades once did.
  assert.ok(desc.includes(String(SIEGE_FRONTAGE)),
    `the copy must quote the frontage (${SIEGE_FRONTAGE}) — it is the rule that `
    + 'makes engines different from a bigger crowd, and nothing else states it');
  assert.equal(UNIT_SLOTS.rams, 3, 'if the price moved, re-read the copy');
});

test('the raider escape is quoted as the half it actually is', () => {
  assert.equal(UNITS.raiders.skirmish, 0.5);
  assert.match(UNITS_UI.raiders.desc, /half/i,
    'sim.js sends half of each raider contingent home from a failed assault');
});
