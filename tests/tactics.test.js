// THE THREE SPECIALISTS, AND A HARNESS THAT CAN NOW PLAY THEM.
//
// Sibling of harness.test.js, and it exists for the same reason: this bot is the
// instrument, so anything it cannot do is a bias in every number it produces.
// When outriders, halberds and sappers shipped, the harness fielded them the
// only way it knew how — dumped into an undifferentiated column — and reported
// that all three made it markedly WORSE. Every one of those figures measured the
// bot. A `filter: UNIT_IDS` send cannot use a verb; it can only pay the price.
//
// So this file asks the three questions that were never asked, each against real
// battles rather than a fixture, and each with the negative control that would
// have caught the original bug.
import test from 'node:test';
import assert from 'node:assert/strict';

import { startRun, playerTurn, fieldedUnits } from '../tools/simplayer.js';
import {
  RIDERS, HOLDERS, BREAKERS, FORTIFIED, COLUMN_FILTER, RIDER_FILTER,
  assaultFilter, hexSeconds,
} from '../tools/simtactics.js';
import { step } from '../src/battle/sim.js';
import { filterComp } from '../src/battle/commands.js';
import { slowestSpeed } from '../src/battle/movement.js';
import { siteDefMultOf } from '../src/battle/terrain.js';
import { UNIT_IDS, UNITS } from '../src/content/balance.js';
import { REGIONS, REGION_IDS } from '../src/content/regions.data.js';
import { DEFAULT_COMPOSITION_WEIGHTS } from '../src/content/upgrades.data.js';

const before = (id) => REGION_IDS.slice(0, REGIONS.findIndex((r) => r.id === id));
const withSpecialists = (extra) => ({ ...DEFAULT_COMPOSITION_WEIGHTS, ...extra });

/**
 * Play a battle, recording every squad the player launched and every SEND the
 * bot queued. Squads are read from `state.squads`, which is what the sim
 * actually built from the command — so a filter that failed to do what it says
 * shows up here rather than being re-derived from the same code under test.
 */
function observe(regionId, weights, seed = 1000, maxTicks = Infinity) {
  const battle = startRun(regionId, seed, before(regionId), 10, { weights });
  const squads = [];
  const sends = [];
  const seen = new Set();
  let nextThink = 0;
  const cap = Math.min(maxTicks, battle.rules.hardCapTicks);
  while (battle.status === 'running' && battle.tick < cap) {
    if (battle.tick >= nextThink) {
      playerTurn(battle);
      // DECISION-TIME state, deliberately. A destination can change hands inside
      // the very `step()` that launches the squad — commands drain, then combat
      // resolves — so reading the owner off the squad a tick later asks "did this
      // site stay yours", which is not a rule the bot can be held to. What these
      // tests are about is what it CHOSE, with the board it chose from.
      for (const c of battle.commands) {
        if (c.t !== 'SEND') continue;
        const from = battle.sites.find((s) => s.id === c.from);
        const to = battle.sites.find((s) => s.id === c.to);
        if (!from || !to) continue;
        sends.push({
          cmd: c,
          garrison: { ...from.garrison },
          sent: filterComp(from.garrison, c.filter),
          destId: to.id,
          destKind: to.kind,
          destOwner: to.owner,
          defMult: siteDefMultOf(battle, to),
        });
      }
      nextThink = battle.tick + 20;
    }
    step(battle);
    for (const q of battle.squads) {
      if (q.owner !== 'player' || seen.has(q.id)) continue;
      seen.add(q.id);
      squads.push({ comp: { ...q.comp } });
    }
  }
  return { battle, squads, sends };
}

const carrying = (squads, unit) => squads.filter((s) => (s.comp[unit] || 0) > 0);
/** Sends that actually put a body of `unit` on the road. */
const sending = (sends, unit) => sends.filter((s) => (s.sent[unit] || 0) > 0);
const attacks = (sends) => sends.filter((s) => s.destOwner !== 'player');

// ---------------------------------------------------------------------------
// The roster derives the rules, not a hardcoded list
// ---------------------------------------------------------------------------

test('tactics: the three roles are derived from the roster, not listed', () => {
  // A hardcoded list here is a rule that silently stops covering the next unit —
  // the exact failure that made four fixtures wrong when these three shipped.
  assert.deepEqual(RIDERS, ['outriders']);
  assert.deepEqual(HOLDERS, ['sappers']);
  assert.deepEqual(BREAKERS, ['halberds']);
  // And each is derived from the property that actually earns the role.
  assert.ok(UNITS.outriders.speed >= UNITS.militia.speed * 2);
  assert.ok(UNITS.sappers.repair > 1);
  assert.ok(UNITS.halberds.sunder > 0);
});

// ---------------------------------------------------------------------------
// 1. Riders ride alone
// ---------------------------------------------------------------------------

test('tactics: a rider detachment travels pure, at its own speed', () => {
  // THE ORIGINAL BUG, pinned. `slowestSpeed` takes the minimum over everything
  // present, so one militia in the stack drops a 165-speed outrider to 55 and
  // the unit's entire reason to exist is gone before it leaves the gate. The old
  // bot sent `filter: UNIT_IDS` every time, so it never once moved an outrider
  // at outrider speed — and then reported outriders as a 16-point loss.
  const { sends } = observe('gallowmoor', withSpecialists({ outriders: 0.3 }));
  const raids = sends.filter((s) => s.cmd.filter === RIDER_FILTER);
  assert.ok(raids.length >= 3, `only ${raids.length} rider detachments were dispatched`);
  for (const s of raids) {
    const others = UNIT_IDS.filter((u) => !RIDERS.includes(u) && (s.sent[u] || 0) > 0);
    assert.deepEqual(others, [],
      `a rider detachment also carried ${others.join(', ')} — it will march at their pace`);
    assert.equal(slowestSpeed(s.sent), UNITS.outriders.speed);
  }
});

test('tactics: a rider the raid turns down still marches with the column', () => {
  // The second half of the ordering, and the half that was wrong first. Holding
  // riders back for their own pass STRANDS everything that pass declines: 50
  // outriders landed on gallowmoor and nine squads' worth ever moved. Riding
  // along is free — `slowestSpeed` is a MIN, so a faster unit cannot slow a
  // slower stack — and standing in a rear camp is not.
  const { squads } = observe('gallowmoor', withSpecialists({ outriders: 0.3 }));
  const riding = carrying(squads, 'outriders');
  const mixed = riding.filter((s) => UNIT_IDS.some((u) => !RIDERS.includes(u) && s.comp[u] > 0));
  assert.ok(riding.length >= 10, `only ${riding.length} squads carried a rider at all`);
  assert.ok(mixed.length > 0,
    'every outrider travelled alone, so the ones no raid wanted were benched');
  // And the column they joined is no slower for having them.
  for (const s of mixed) {
    assert.ok(slowestSpeed(s.comp) < UNITS.outriders.speed);
    const withoutRiders = { ...s.comp };
    for (const u of RIDERS) withoutRiders[u] = 0;
    assert.equal(slowestSpeed(s.comp), slowestSpeed(withoutRiders),
      'adding a rider changed the column pace — slowestSpeed is supposed to be a MIN');
  }
});

test('tactics: NEGATIVE CONTROL — mixing one militia in cancels the whole verb', () => {
  // The claim above is only worth pinning if the alternative is genuinely bad.
  // This is what every outrider squad the old harness sent actually looked like.
  const pure = { ...Object.fromEntries(UNIT_IDS.map((u) => [u, 0])), outriders: 20 };
  const mixed = { ...pure, militia: 1 };
  assert.equal(slowestSpeed(pure), 165);
  assert.equal(slowestSpeed(mixed), UNITS.militia.speed);
  // One body, three times the march time, for the whole detachment.
  assert.ok(hexSeconds('militia') / hexSeconds('outriders') >= 2.9);
});

// ---------------------------------------------------------------------------
// 2. Halberds break walls, and only walls
// ---------------------------------------------------------------------------

test('tactics: halberds ride at everything, including soft targets', () => {
  // THE SUNK-COST RULE, and it is pinned because the opposite is so much more
  // tempting. Per slot a halberd IS a worse line unit than militia — atk 12 over
  // 4 slots against 4 over 1 — so an earlier version of this file held them back
  // from anything under `FORTIFIED`. Measured at n=48 that took gallowmoor from
  // 58% to 6%, and on thanescar the halberds did not join one assault all
  // battle. The slots were spent at the loadout screen; the only question left
  // is whether the body marches, and a benched third of the army drags every
  // remaining assault under ATTACK_MARGIN until the bot stops attacking at all.
  const { sends } = observe('thanescar', withSpecialists({ halberds: 0.3 }));
  const assaults = attacks(sending(sends, 'halberds'));
  assert.ok(assaults.length >= 3, `only ${assaults.length} halberd assaults launched`);
  assert.ok(assaults.some((s) => s.defMult < FORTIFIED),
    'halberds only ever attacked fortifications — the hold-back rule is back,'
    + ' and it is worth 50 points of win rate in the wrong direction');
});

test('tactics: no filter inspects the target — every version that did was worse', () => {
  // `assaultFilter` keeps its `target` parameter as a marker rather than a
  // decision. If a future change makes the filter target-dependent again, this
  // is the assertion that asks for the measurement first.
  const { battle } = observe('thanescar', withSpecialists({ halberds: 0.3 }), 1000, 5);
  const farm = battle.sites.find((s) => s.kind === 'farm');
  const hard = battle.sites.find((s) => s.kind === 'castle' || s.kind === 'stronghold');
  assert.ok(farm && hard, 'the map produced no farm or no fortification to compare');
  assert.deepEqual(assaultFilter(battle, farm), assaultFilter(battle, hard));
  for (const unit of [...BREAKERS, ...HOLDERS]) {
    assert.ok(assaultFilter(battle, farm).includes(unit), `${unit} was benched`);
  }
  // The gate constant is retained and still describes the roster it names.
  assert.ok(siteDefMultOf(battle, hard) >= FORTIFIED);
});

// ---------------------------------------------------------------------------
// 3. Sappers hold
// ---------------------------------------------------------------------------

test('tactics: a sapper attacks as well as holds', () => {
  // The other half of the sunk-cost rule, and the reasoning that made it look
  // wrong is worth keeping: `repair` only pays in a site you are standing in,
  // and a sapper is 3 slots of atk 3. But it is also `siege` 2.5 against a
  // militia's 0.6, which is BETTER siege per slot — and the site it ends up
  // repairing is the one it just helped take, which is exactly the one the
  // enemy comes back for. Keeping them home measured 17% against 58%.
  const { sends } = observe('nightharrow', withSpecialists({ sappers: 0.3 }));
  const moving = sending(sends, 'sappers');
  assert.ok(moving.length >= 3, `sappers never moved at all (${moving.length} sends)`);
  assert.ok(attacks(moving).length > 0,
    'no sapper was ever sent at a site the player did not hold — they are benched');
});

// ---------------------------------------------------------------------------
// 4. The loadout is actually fielded
// ---------------------------------------------------------------------------

test('tactics: a specialist named in the loadout is really landed', () => {
  // THE SECOND BUG THIS PASS FOUND, and the more dangerous of the two, because
  // it fails silently in the direction of looking fine. `fitComposition` drops
  // any unit missing from `unlocked`, and the bot shops cheapest-affordable-
  // first — so it bought the 400-crown outriders and the 1200-crown halberds but
  // never the 1800-crown sappers, and a sapper run landed ZERO sappers and
  // reported the default army's win rate under their name.
  // maxTicks was 5, sized against the old MOVEMENT.hexSecondsPerSpeed (38).
  // Doubled to slow marches down (see balance.engine.js), an outrider
  // detachment riding out alone from gallowmoor's camp now arrives around
  // tick 33 rather than well inside the old window — halberds and sappers
  // still read as landed at tick 1 (they start IN the camp's garrison and are
  // never the ones peeled off to ride out alone), so only the rider case was
  // ever this timing-sensitive. 80 keeps comfortable margin over the measured
  // arrival without turning the test into a full battle.
  for (const unit of ['outriders', 'halberds', 'sappers']) {
    const { battle } = observe('gallowmoor', withSpecialists({ [unit]: 0.3 }), 1000, 80);
    const landed = battle.sites
      .filter((s) => s.owner === 'player')
      .reduce((a, s) => a + (s.garrison[unit] || 0), 0);
    assert.ok(landed > 0,
      `--weights named ${unit} and none was landed: the loadout was silently discarded,`
      + ' so the run would report the default army under a specialist name');
  }
  assert.deepEqual(fieldedUnits({ militia: 1, sappers: 2, halberds: 0 }), ['militia', 'sappers']);
  assert.deepEqual(fieldedUnits(null), []);
});

// ---------------------------------------------------------------------------
// 5. Inert on the default army — the control that protects 21 tuned regions
// ---------------------------------------------------------------------------

test('tactics: the default army is sent EXACTLY as it was before the tactics existed', () => {
  // Every number in regions.data.js is measured against `distributeExpedition`,
  // which fields none of the three. If a filter narrowed a default send by even
  // one body, all twenty-one regions would quietly be measuring a different
  // player — which is precisely how the site-upgrade gap survived for years.
  //
  // Composition-level, not command-level: what matters is that the army that
  // leaves is identical, so this compares the filtered send against what
  // `UNIT_IDS` would have selected from the same garrison.
  for (const region of ['riverfen', 'gallowmoor', 'nightharrow']) {
    const { sends } = observe(region, null);
    assert.ok(sends.length > 5, `${region}: only ${sends.length} sends to check`);
    for (const { cmd, garrison } of sends) {
      assert.deepEqual(filterComp(garrison, cmd.filter), filterComp(garrison, UNIT_IDS),
        `${region}: a default send was narrowed by the specialist filters`);
      assert.notEqual(cmd.filter, RIDER_FILTER,
        `${region}: the rider pass dispatched a detachment on a run with no riders`);
    }
  }
});

test('tactics: NEGATIVE CONTROL — the rider filter does bite, and nothing else does', () => {
  // Without this the inertness test above would pass just as happily if every
  // filter were dead code — which is the exact shape of the bug that started
  // all this. RIDER_FILTER must genuinely narrow; the other two must not.
  const garrison = Object.fromEntries(UNIT_IDS.map((u) => [u, 4]));
  const { battle } = observe('gallowmoor', null, 1000, 5);
  const farm = battle.sites.find((s) => s.kind === 'farm');

  const raid = filterComp(garrison, RIDER_FILTER);
  assert.equal(raid.militia, 0, 'RIDER_FILTER is dead code — the raid is not pure');
  for (const u of RIDERS) assert.equal(raid[u], 4, `${u} missing from its own detachment`);

  // Everyone marches with the column and the assault. Benching measured 6%.
  for (const f of [COLUMN_FILTER, assaultFilter(battle, farm)]) {
    const kept = filterComp(garrison, f);
    for (const u of UNIT_IDS) {
      assert.equal(kept[u], 4,
        `${u} was benched — a body that does not march is worth nothing at any rate`);
    }
  }
  assert.equal(filterComp(garrison, COLUMN_FILTER)[HOLDERS[0]], 4,
    'the column must carry sappers forward — one that never reaches the line is wasted');
  assert.equal(filterComp(garrison, COLUMN_FILTER)[BREAKERS[0]], 4);
});
