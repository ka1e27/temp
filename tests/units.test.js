// THE THREE SPECIALISTS — outriders, halberdiers, sappers.
//
// Each one owns a VERB the roster did not have, and each verb is a hook in the
// simulation rather than a bigger number on an existing one. That is the whole
// reason they are worth adding and it is also the whole risk: a unit whose
// special field nothing reads is this project's signature failure (dead
// boosters, an inert enemy Marshal, a `skirmish` that only ever fired for
// raiders because the UNIT was hardcoded even though the NUMBER came from the
// spec). So every lever here is asserted through the real sim path, and every
// one has a NEGATIVE CONTROL — the same fixture without the unit — because an
// assertion that passes with the mechanic deleted proves nothing.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  power, siegeDps, resolveField, sunderedDefMult, repairMult, siteRegen, breachSeconds,
  emptyComp, total,
} from '../src/battle/combat.js';
import { createBattleState } from '../src/battle/state.js';
import { step } from '../src/battle/sim.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { slowestSpeed } from '../src/battle/movement.js';
import { UNIT_IDS, UNITS, UNIT_SLOTS } from '../src/content/balance.js';
import { DEFAULT_COMPOSITION_WEIGHTS } from '../src/content/upgrades.data.js';
import { distributeExpedition, compositionSlots } from '../src/meta/composition.js';
import { UNITS_UI } from '../src/content/strings.js';

const comp = (x) => ({ ...emptyComp(), ...x });
/** As many of one unit as a budget buys, for the "is this a free pick?" test. */
const pureStack = (unit, budget) => comp({ [unit]: Math.floor(budget / UNIT_SLOTS[unit]) });
const foeOf = (unit) => comp({ [unit]: 10 });
const NEW = ['outriders', 'halberds', 'sappers'];

// ===========================================================================
// 0. They exist everywhere a unit has to exist
// ===========================================================================

test('units: each new troop is wired through every table a unit needs', () => {
  for (const u of NEW) {
    assert.ok(UNIT_IDS.includes(u), `${u} missing from UNIT_IDS`);
    assert.ok(UNITS[u], `${u} has no stat line`);
    assert.ok(Number.isInteger(UNIT_SLOTS[u]) && UNIT_SLOTS[u] >= 1, `${u} has no slot cost`);
    assert.ok(UNITS_UI[u]?.name && UNITS_UI[u]?.desc, `${u} has no player-facing copy`);
    assert.equal(emptyComp()[u], 0, `${u} is missing from emptyComp — it does not exist yet`);
  }
});

test('units: the specialists are OPT-IN, so the default army is untouched', () => {
  // The reason three units could ship at once without re-tuning twenty-one
  // regions: `distributeExpedition` is what the harness fields, and it only
  // spends on units with a weight. A non-zero weight here would silently
  // re-tune the whole campaign.
  for (const u of NEW) {
    assert.equal(DEFAULT_COMPOSITION_WEIGHTS[u] ?? 0, 0, `${u} must not be auto-picked`);
  }
  const all = distributeExpedition(200, UNIT_IDS);
  for (const u of NEW) {
    assert.equal(all[u], 0, `${u} turned up in a default spread that never asked for it`);
  }
  // ...and the default spread is still a real army, not an empty one.
  assert.ok(total(all) > 0);
});

// ===========================================================================
// 1. Outriders MOVE — and a failed grab rides home
// ===========================================================================

test('units: outriders cross a region far faster than anything else', () => {
  const speed = (u) => slowestSpeed(comp({ [u]: 10 }));
  const out = speed('outriders');
  for (const u of UNIT_IDS.filter((x) => x !== 'outriders')) {
    assert.ok(out > speed(u), `outriders are not faster than ${u}`);
  }
  // Not marginally faster — this is the unit's entire reason to exist, and the
  // campaign lands on maps that are 30-50% unclaimed.
  assert.ok(out / speed('militia') >= 2.5,
    `outriders march only ${(out / speed('militia')).toFixed(1)}x a militia`);
});

test('units: a squad is only as fast as its slowest troop, so outriders ride alone', () => {
  // The decision the speed creates. Mixing one ram into an outrider column
  // throws the whole point away, and that is a real cost the player pays for
  // bringing a combined force.
  const pure = slowestSpeed(comp({ outriders: 10 }));
  const mixed = slowestSpeed(comp({ outriders: 10, rams: 1 }));
  assert.ok(mixed * 2 < pure, 'one ram should gut an outrider column’s speed');
});

test('units: a failed assault sends outriders home, not just raiders', () => {
  // THE GENERALISATION. `skirmishHome` read `sq.comp.raiders` with the fraction
  // pulled from the spec, so the hardcoding was invisible: a second skirmisher
  // would have escaped exactly nothing.
  const battle = attackFixture({ outriders: 6 });
  const events = runUntilResolved(battle);
  const escape = events.find((e) => e.type === 'skirmish-escape');
  assert.ok(escape, 'no outrider escaped a failed assault');
  assert.equal(escape.escaped.outriders,
    Math.floor(6 * UNITS.outriders.skirmish), 'the wrong number rode home');
});

test('units: NEGATIVE CONTROL — a troop without `skirmish` never escapes', () => {
  const battle = attackFixture({ militia: 6 });
  const events = runUntilResolved(battle);
  assert.equal(events.find((e) => e.type === 'skirmish-escape'), undefined,
    'militia escaped a failed assault — `skirmish` is being applied to everyone');
});

// ===========================================================================
// 2. Halberdiers BREAK the ground the defender is standing on
// ===========================================================================

test('units: halberds strip the defender’s site bonus, in proportion to the force', () => {
  const castle = 1.60;
  assert.equal(sunderedDefMult(comp({ militia: 10 }), castle), castle,
    'a force with no halberds must leave the bonus alone');
  const half = sunderedDefMult(comp({ halberds: 5, militia: 5 }), castle);
  const full = sunderedDefMult(comp({ halberds: 10 }), castle);
  assert.ok(full < half && half < castle, 'sunder must scale with the share of the force');
  // A pure halberd force strips exactly the unit's `sunder` share of the BONUS,
  // never of the base — a site bonus below 1.0 is not a thing, and an attacker
  // must never end up better off than on open ground.
  assert.ok(Math.abs(full - (1 + (castle - 1) * (1 - UNITS.halberds.sunder))) < 1e-9);
  assert.ok(full >= 1, 'sunder must never invert into an attacker bonus');
  assert.equal(sunderedDefMult(comp({ halberds: 10 }), 1), 1, 'nothing to strip on open ground');
});

test('units: that reaches a real field battle, and NOT via raw attack', () => {
  // The assertion that would catch "sunder is declared and nothing reads it":
  // resolveField is the only path a capture takes.
  const defenders = comp({ spearmen: 30 });
  const opts = { siteDefMult: 1.6, defenderOwnsSite: true };
  const withHalberds = resolveField(comp({ halberds: 20 }), defenders, opts);
  const noBonus = resolveField(comp({ halberds: 20 }), defenders, { ...opts, siteDefMult: 1 });
  assert.ok(withHalberds.defPower < noBonus.defPower * 1.6,
    'the castle bonus was applied in full despite a pure halberd assault');
  assert.ok(withHalberds.defPower > noBonus.defPower,
    'sunder is not a total cancel — half the bonus stands');

  // NEGATIVE CONTROL: the same assault made of militia pays the bonus in full.
  const withMilitia = resolveField(comp({ militia: 60 }), defenders, opts);
  const militiaNoBonus = resolveField(comp({ militia: 60 }), defenders, { ...opts, siteDefMult: 1 });
  assert.ok(Math.abs(withMilitia.defPower - militiaNoBonus.defPower * 1.6) < 1e-6,
    'militia are stripping a site bonus they have no business touching');
});

// ===========================================================================
// 3. Sappers HOLD — they can make a site literally unbreachable
// ===========================================================================

test('units: sappers multiply the repair rate of what they garrison', () => {
  assert.equal(repairMult(comp({ militia: 10 })), 1, 'a garrison without sappers repairs normally');
  const half = repairMult(comp({ sappers: 5, militia: 5 }));
  const full = repairMult(comp({ sappers: 10 }));
  assert.ok(full > half && half > 1, 'repair must scale with the share of the garrison');
  assert.ok(Math.abs(full - UNITS.sappers.repair) < 1e-9);
  assert.equal(repairMult(emptyComp()), 1, 'an empty garrison must not divide by zero');
});

test('units: and that is enough to make a wall a besieger cannot ever breach', () => {
  // The point of the unit, stated as the thing a player would notice. A siege
  // whose damage sits between the site's normal regen and its repaired regen
  // breaches one and never breaches the other — however long it sits there.
  const kind = 'stronghold';
  const level = 3;
  const bare = siteRegen(kind, level, 1);
  const held = siteRegen(kind, level, repairMult(comp({ sappers: 12 })));
  assert.ok(held > bare * 1.5, 'sappers barely changed the repair rate');

  // 20 militia is 12.0 siege DPS. Plain level-3 regen is 7.84 and sapper-repaired
  // is 14.90, so this besieger sits strictly inside the window.
  const besiegers = comp({ militia: 20 });
  const breach = (garrison) => breachSeconds(
    besiegers, 200, kind, level, 1, repairMult(garrison), null,
  );
  // THE EXACT CLAIM, on the pure function the AI and the preview both call:
  // not "tougher", but arithmetically unbreachable while they stand.
  assert.ok(Number.isFinite(breach(comp({ militia: 12 }))),
    'the control wall must be breachable, or the comparison says nothing');
  assert.equal(breach(comp({ sappers: 12 })), Infinity,
    'a sapper-held wall is merely slower to break, not unbreachable');

  // ...and the same thing happens in a running battle. Note the sapper wall is
  // not immortal: the garrison takes attrition, so `repairMult` decays with it
  // and the wall does eventually fall. What it buys is TIME measured in minutes
  // against a control that falls in seconds — which is the honest claim, and the
  // reason this asserts a window rather than "forever".
  const held2 = runSiege(comp({ sappers: 12 }), besiegers, level, 1200);
  const bare2 = runSiege(comp({ militia: 12 }), besiegers, level, 1200);
  assert.equal(bare2.owner, 'enemy',
    'the control siege never breached — the fixture proves nothing');
  assert.equal(held2.owner, 'player',
    'sappers did not hold the wall against a siege that took the identical control');
});

// ===========================================================================
// 4. The roster as a whole: no unit is a free pick
// ===========================================================================

test('for one fixed budget, four different units are the right answer', () => {
  // The complaint this feature answers: "everyone would just start with as many
  // of the best troops as possible". With slot costs there is no "best" — the
  // argmax at a FIXED budget moves with the job in front of you.
  const budget = 60;
  const stacks = Object.fromEntries(
    ['militia', 'spearmen', 'raiders', 'rams'].map((u) => [u, pureStack(u, budget)]),
  );
  for (const [u, s] of Object.entries(stacks)) {
    assert.ok(compositionSlots(s) <= budget, `${u} stack must fit the budget`);
  }
  const best = (score) => Object.entries(stacks)
    .sort((a, b) => score(b[1]) - score(a[1]))[0][0];

  assert.equal(best((s) => power(s, foeOf('spearmen'))), 'militia',
    'militia counter a spearwall');
  assert.equal(best((s) => power(s, foeOf('militia'))), 'raiders',
    'raiders counter a militia mob');
  assert.equal(best((s) => power(s, foeOf('militia'), { defending: true, onOwnSite: true })),
    'spearmen', 'spearmen hold ground');
  assert.equal(best((s) => siegeDps(s)), 'rams', 'rams break walls');
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** An attack that is certain to FAIL, so the skirmish rule fires. */
function attackFixture(attackComp) {
  const s = createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: 'skirmish',
    seed: 1,
    grid: { cols: 9, rows: 7, blocked: [] },
    sites: [
      { id: 'home', kind: 'camp', hex: [1, 3], owner: 'player',
        garrison: comp(attackComp), hp: 480, hpMax: 480 },
      { id: 'wall', kind: 'stronghold', hex: [2, 3], owner: 'enemy',
        garrison: comp({ spearmen: 200 }), hp: 250, hpMax: 250 },
    ],
    adjacency: [['home', 'wall']],
    player: makeMods({ expedition: emptyComp(), startGold: 0 }),
    enemy: makeMods({ expedition: emptyComp(), startGold: 0 }),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 600000, aiTier: 1 },
  });
  // THE ENEMY MUST NOT SORTIE, or this stops being a test about assaulting a
  // wall. Once two hostile forces on one tile started fighting, the stronghold's
  // own counter-attack met the probe in the open and the assault never happened
  // — the run went quiet and the assertion read "no outrider escaped", which
  // looks like `skirmish` breaking rather than the fixture measuring something
  // else. The NEGATIVE CONTROL below would have gone on passing either way,
  // which is exactly why it cannot be the only thing watching this.
  s.ai.nextThinkTick = 1e9;
  s.commands.push({ t: 'SEND', from: 'home', to: 'wall', fraction: 1 });
  return s;
}

function runUntilResolved(battle) {
  const seen = [];
  for (let i = 0; i < 400; i++) {
    step(battle);
    seen.push(...battle.events);
    if (seen.some((e) => e.type === 'skirmish-escape' || e.type === 'attack-repelled')) break;
  }
  return seen;
}

/** Run one standing siege to completion and hand back the wall. */
function runSiege(garrison, besiegers, level, ticks = 2400) {
  const b = siegeFixture({ garrison, level });
  const wall = b.sites.find((s) => s.id === 'wall');
  // Re-planted every tick: the AI is free to call the siege off, and what is
  // being measured is the wall's repair rate, not the enemy's patience.
  for (let i = 0; i < ticks && wall.owner === 'player' && b.status === 'running'; i++) {
    wall.siege = { owner: 'enemy', comp: besiegers, ticks: 0 };
    step(b);
  }
  return wall;
}

/**
 * A player wall under a standing enemy siege that out-damages plain regen but
 * not a sapper-repaired one.
 *
 * The camp and the castle are not decoration: victory is capture-castle, so a
 * board with no player camp is an instant loss and `step()` returns early —
 * which froze the wall's HP at its starting value and made the first version of
 * this fixture look like "the siege does nothing" for both arms.
 */
function siegeFixture({ garrison, level }) {
  return createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: 'siege',
    seed: 1,
    grid: { cols: 11, rows: 7, blocked: [] },
    sites: [
      { id: 'camp', kind: 'camp', hex: [1, 3], owner: 'player',
        garrison: comp({ militia: 10 }), hp: 480, hpMax: 480 },
      { id: 'wall', kind: 'stronghold', hex: [3, 3], owner: 'player',
        garrison, level, hp: 40, hpMax: 250 * 1.96 },
      { id: 'foe', kind: 'camp', hex: [5, 3], owner: 'enemy',
        garrison: comp({ militia: 40 }), hp: 480, hpMax: 480 },
      { id: 'castle', kind: 'castle', hex: [7, 3], owner: 'enemy',
        garrison: comp({ spearmen: 30 }), hp: 480, hpMax: 480 },
    ],
    // The wall is deliberately NOT adjacent to anything the enemy holds. Sends
    // are adjacency-only, so this isolates the mechanic under test: the only
    // thing that can take this wall is the siege planted on it, and a field
    // assault cannot walk in and decide the result instead.
    adjacency: [['camp', 'wall'], ['foe', 'castle']],
    player: makeMods({ expedition: emptyComp(), startGold: 0 }),
    enemy: makeMods({ expedition: emptyComp(), startGold: 0 }),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 600000, aiTier: 1 },
  });
}
