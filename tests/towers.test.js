// BUILDINGS THAT SHOOT — a stronghold at one hex, a watchtower at two.
//
// The two things this file exists to catch are both silent:
//
// 1. A TOWER THAT FIRES AND KILLS NOBODY. The damage is a fraction of a body
//    per tick by design, so a `Math.floor` anywhere in the chain makes the
//    whole feature inert while every event, every draw call and every log line
//    still looks live. This project has shipped six features that way and
//    refunded four upgrades for it.
// 2. A RANGE THAT IS NOT THE RANGE. "Within one hex" and "within two" are the
//    entire difference between the two armed kinds, and an off-by-one reads as
//    a balance opinion rather than as a bug.
//
// Every claim carries a negative control, because "the squad took no damage"
// is exactly what a fixture with no squads in it also reports.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createBattleState } from '../src/battle/state.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { emptyComp, total } from '../src/battle/combat.js';
import { spawnSquad, squadHexOf } from '../src/battle/movement.js';
import { asHex } from '../src/battle/influence.js';
import { distance } from '../src/core/hex.js';
import { towersPhase, projectMarchLosses } from '../src/battle/towers.js';
import { TOWERS, ARMED_KINDS, towerDamagePerTick } from '../src/content/balance.towers.js';
import { SITES, SITE_KINDS } from '../src/content/balance.js';
import { EVENTS } from '../src/battle/events.js';
import { TICK_HZ } from '../src/core/loop.js';

const comp = (o) => ({ ...emptyComp(), ...o });

/** A straight corridor with one enemy building beside it, at axial `at`. */
function board(kind, at, over = {}) {
  return createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: `tower-${kind}-${at.join(',')}`,
    seed: 3,
    grid: { cols: 20, rows: 4, blocked: [] },
    sites: [
      { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 200 }, hp: 600, hpMax: 600 },
      { id: 'gun', kind, hex: at, owner: 'enemy', garrison: {}, hp: 300, hpMax: 300, ...over },
      { id: 'far', kind: 'farm', hex: [18, 0], owner: 'enemy', garrison: { militia: 1 } },
    ],
    player: makeMods({}),
    enemy: makeMods({}),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 600000, aiTier: 1 },
  });
}

/**
 * Walk a squad's whole flight, charging EXACTLY the ticks `sim.js step()` charges.
 *
 * THE WINDOW LIVES HERE AND NOWHERE ELSE, because four copies of it is how this
 * file came to pass 7/7 while being one tick off the engine. Every loop used to
 * increment FIRST and run to `arriveTick` inclusive — which reproduced
 * `projectMarchLosses`'s own (also wrong) window, so the two agreed with each
 * other and neither agreed with the sim. A test that mirrors the thing under
 * test cannot falsify it.
 *
 * The real window is `spawnTick .. arriveTick - 1`, and it is a consequence of
 * `step()`'s phase order rather than of anything local: `drainCommands` spawns
 * the squad and `towersPhase` runs later in that same tick, so the SPAWN tick is
 * charged with the column still on its origin hex; `arrivalsPhase` runs BEFORE
 * `towersPhase` and takes an arrived squad off the board, so the ARRIVE tick
 * never is. Firing before the increment is what encodes both halves.
 *
 * @param {object} s battle state
 * @param {object} sq the squad, already spawned
 * @param {?function(?object, Array):void} onFire called per tick with the hex the
 *   column occupied and the events the guns pushed there
 */
function walkFlight(s, sq, onFire = null) {
  while (s.tick < sq.arriveTick) {
    s.events = [];
    const at = squadHexOf(s, sq);
    towersPhase(s);
    if (onFire) onFire(at, s.events);
    s.tick++;
  }
}

/**
 * March a column the whole length of the corridor and report what it lost.
 *
 * RUNS TO ARRIVAL, not for a fixed number of ticks. The first version of this
 * helper stopped at 60 and the squad had not reached the gun yet — so the
 * "out of range and it still fired" assertion passed because nothing had
 * happened at all. A fixture that is silently empty satisfies every
 * must-not-happen claim for free, which is this file's own opening warning
 * landing on the person who wrote it.
 *
 * It also reports the closest the route ever comes to the gun, so each test can
 * assert its own PREMISE before asserting behaviour.
 */
function marchPast(s) {
  const sq = spawnSquad(s, {
    owner: 'player', from: 'camp', to: 'far', comp: comp({ militia: 100 }),
  });
  const gun = asHex(s.sites.find((x) => x.id === 'gun').hex);
  const before = total(sq.comp);
  let closest = Infinity;
  let fired = 0;
  walkFlight(s, sq, (at, events) => {
    if (at) closest = Math.min(closest, distance(gun, at));
    fired += events.filter((e) => e.type === EVENTS.TOWER_FIRED).length;
  });
  const live = s.squads.find((x) => x.id === sq.id);
  return { lost: before - (live ? total(live.comp) : 0), fired, before, closest };
}

test('the armed kinds are exactly the two that earn nothing', () => {
  // Not a restatement of the table: it pins the DESIGN rule. Arming a farm or a
  // training ground would make the economic buildings the military ones too,
  // which is the collapse the yard/wall split was made to undo.
  assert.deepEqual([...ARMED_KINDS].sort(), ['stronghold', 'watchtower']);
  for (const kind of ARMED_KINDS) {
    assert.equal(SITES[kind].gold, 0, `${kind} must earn nothing`);
    assert.equal(SITES[kind].train, 0, `${kind} must train nothing`);
    assert.ok(SITE_KINDS.includes(kind), `${kind} is not a real site kind`);
  }
  assert.ok(TOWERS.stronghold.rangeHexes < TOWERS.watchtower.rangeHexes,
    'the wall hits at its feet, the tower reaches — that is the whole difference');
  assert.ok(TOWERS.stronghold.dps > TOWERS.watchtower.dps,
    '...and the one with reach is the one that stings less');
});

test('a tower really kills — a fraction of a body per tick still adds up', () => {
  // THE INERT-FEATURE TEST. Per-tick damage is well under one body, so any
  // flooring in the chain makes this zero while the feature still looks alive.
  const perTick = towerDamagePerTick('stronghold', 1, TICK_HZ);
  assert.ok(perTick > 0 && perTick < 1,
    `the premise of this test is a sub-body tick (${perTick}) — re-take it if that changed`);

  const s = board('stronghold', [9, 1]);
  const { lost, fired, before, closest } = marchPast(s);
  assert.equal(closest, 1, 'the fixture must actually bring the column into reach');
  assert.ok(lost > 0, 'a column walked through a stronghold\'s reach and lost nobody');
  assert.ok(fired > 0, 'casualties happened with no event to draw them from');
  assert.ok(lost < before, 'a wall must not delete an army on its own');
});

test('range is exactly the range: 1 for a wall, 2 for a tower', () => {
  // The gun sits TWO hexes off a straight corridor. That one placement
  // discriminates the two kinds completely: a stronghold reaches one and must
  // miss, a watchtower reaches two and must hit. Each asserts the geometry it
  // depends on first, so neither can pass because the column went somewhere
  // else entirely.
  const wall = marchPast(board('stronghold', [9, 2]));
  assert.equal(wall.closest, 2, 'premise: the route passes exactly two hexes away');
  assert.equal(wall.lost, 0, 'a stronghold reached two hexes — that is the tower\'s job');
  assert.equal(wall.fired, 0);

  const tower = marchPast(board('watchtower', [9, 2]));
  assert.equal(tower.closest, 2, 'premise: the same route, the same two hexes');
  assert.ok(tower.lost > 0, 'a watchtower failed to reach two hexes');

  // NEGATIVE CONTROL for the wall's zero: brought to one hex it does fire, so
  // the miss above is the range binding and not a stronghold that never shoots.
  const adjacent = marchPast(board('stronghold', [9, 1]));
  assert.equal(adjacent.closest, 1);
  assert.ok(adjacent.lost > 0, 'a stronghold must hit what is touching it');
});

test('a tower never shoots its own side, and scaffolding never shoots at all', () => {
  const friendly = board('stronghold', [9, 1]);
  friendly.sites.find((x) => x.id === 'gun').owner = 'player';
  assert.equal(marchPast(friendly).lost, 0, 'a wall fired on its own column');

  // PRESENCE IS NOT PRODUCTION — the same rule that makes scaffolding blind and
  // makes it earn nothing. A foundation that opens fire the instant it is paid
  // for would make the build timer decorative.
  const building = board('stronghold', [9, 1]);
  building.sites.find((x) => x.id === 'gun').buildTicksLeft = 200;
  assert.equal(marchPast(building).lost, 0, 'a half-built wall opened fire');

  // NEGATIVE CONTROL: the identical board with the timer run out does fire, so
  // the two zeros above are the rules and not a broken fixture.
  const done = board('stronghold', [9, 1]);
  done.sites.find((x) => x.id === 'gun').buildTicksLeft = 0;
  assert.ok(marchPast(done).lost > 0);
});

test('a higher-level wall hits harder, and a column shot to nothing is removed', () => {
  const l1 = towerDamagePerTick('stronghold', 1, TICK_HZ);
  const l4 = towerDamagePerTick('stronghold', 4, TICK_HZ);
  assert.ok(l4 > l1, 'the upgrade ladder must reach the guns too');
  assert.equal(towerDamagePerTick('farm', 5, TICK_HZ), 0, 'an unarmed kind deals nothing');

  // A squad whittled to zero must leave state.squads rather than linger as an
  // army of nobody — every consumer downstream would otherwise need to learn
  // that an empty comp is not a force.
  const s = board('stronghold', [4, 1]);
  const sq = spawnSquad(s, {
    owner: 'player', from: 'camp', to: 'far', comp: comp({ militia: 1 }),
  });
  for (let i = 0; i < 2000 && s.squads.some((x) => x.id === sq.id); i++) {
    s.tick++; s.events = []; towersPhase(s);
  }
  assert.equal(s.squads.some((x) => x.id === sq.id), false,
    'a column shot to nothing stayed on the board as an empty army');
});

test('the projection and the simulation agree exactly, body for body', () => {
  // THE ONE THAT KEEPS THE PREVIEW HONEST. The pre-commit preview is a
  // guarantee rather than an estimate, and towers broke that the moment they
  // landed: a column arrives smaller than it set off, and the DEFENDER's power
  // is a function of the attacker's composition, because `counters` scale by
  // the share of the foe that is the countered type.
  //
  // `projectMarchLosses` is what the preview uses to describe the force that
  // will actually arrive. It shares `gunsOf` and the damage arithmetic with
  // `towersPhase`, but it walks the flight in one pass instead of a tick at a
  // time — which is exactly the shape of a second implementation that drifts.
  // So: run both over the same march and demand the same survivors.
  const s = board('stronghold', [9, 1]);
  const sq = spawnSquad(s, {
    owner: 'player', from: 'camp', to: 'far', comp: comp({ militia: 100, raiders: 20 }),
  });
  const projected = projectMarchLosses(s, {
    path: sq.path, owner: 'player', comp: comp({ militia: 100, raiders: 20 }),
    spawnTick: sq.spawnTick, arriveTick: sq.arriveTick, toId: 'far',
  });
  walkFlight(s, sq);
  const live = s.squads.find((x) => x.id === sq.id);

  assert.ok(total(projected) < 120, 'sanity: the march must actually cost something');
  assert.deepEqual(projected, live.comp,
    'the preview would have promised a different army than the one that arrived');
});

test('...and they agree over EVERY gun placement, not just one fixture', () => {
  // THE SWEEP, and the reason it exists is that the single fixture above passed
  // for the whole life of the feature while the projection was a tick out of
  // step with the sim. One placement cannot find a window bug: the two windows
  // differ only at the ends, so they disagree only when a gun happens to sit in
  // reach of the ORIGIN hex or of the DESTINATION hex, and a fixture with its gun
  // in the middle of the corridor agrees perfectly either way.
  //
  // Every placement along and beside the corridor, against three compositions,
  // for both armed kinds. Run against the pre-fix engine this reports
  // disagreements at `gun=[18,1]` — beside the destination, the case the old
  // window invented a tax for — and passes everywhere else, which is exactly how
  // it stayed hidden.
  let checked = 0;
  let inRange = 0;
  const sent = [comp({ militia: 41 }), comp({ militia: 102, raiders: 20 })];
  for (const kind of ARMED_KINDS) {
    for (let q = 1; q <= 18; q++) {
      for (const r of [0, 1, 2]) {
        for (const c of sent) {
          const s = board(kind, [q, r]);
          const sq = spawnSquad(s, { owner: 'player', from: 'camp', to: 'far', comp: { ...c } });
          const proj = projectMarchLosses(s, {
            path: sq.path, owner: 'player', comp: { ...c },
            spawnTick: sq.spawnTick, arriveTick: sq.arriveTick, toId: 'far',
          });
          walkFlight(s, sq);
          const live = s.squads.find((x) => x.id === sq.id);
          const arrived = live ? live.comp : emptyComp();
          assert.deepEqual(arrived, proj,
            `${kind} at [${q},${r}] with ${total(c)} sent: the preview promised `
            + `${total(proj)} and ${total(arrived)} arrived`);
          checked += 1;
          if (total(arrived) < total(c)) inRange += 1;
        }
      }
    }
  }
  // NEGATIVE CONTROL on the sweep itself: most of these placements have to
  // actually cost the column men, or this is 200-odd assertions about a gun that
  // never fires — which is this file's opening warning, one more time.
  assert.ok(checked > 100, `the sweep must cover real ground, covered ${checked}`);
  assert.ok(inRange > checked / 3,
    `only ${inRange} of ${checked} marches took any damage — the sweep is mostly empty`);
});

test('a building never shoots the assault that is coming for it', () => {
  // The rule that keeps this a tax on marching PAST rather than a second
  // defence stacked on the siege. Measured before it existed: a short hop that
  // spends its whole flight inside a stronghold's reach lost 43% of the force
  // before the fight started, which charges for one attack twice and makes the
  // siege — the mechanic the design rests on — decorative.
  const s = board('stronghold', [9, 1]);
  const gun = s.sites.find((x) => x.id === 'gun');
  const before = comp({ militia: 60 });
  const at = spawnSquad(s, { owner: 'player', from: 'camp', to: gun.id, comp: before });
  walkFlight(s, at);
  const live = s.squads.find((x) => x.id === at.id);
  assert.deepEqual(live.comp, before, 'the target shot the column marching at it');

  // NEGATIVE CONTROL: the identical column marching PAST the same wall to a
  // different destination does lose men — so the zero above is the rule and not
  // a stronghold that never fires.
  const past = board('stronghold', [9, 1]);
  const by = spawnSquad(past, { owner: 'player', from: 'camp', to: 'far', comp: comp({ militia: 60 }) });
  walkFlight(past, by);
  const survivors = past.squads.find((x) => x.id === by.id);
  assert.ok(total(survivors.comp) < 60, 'a column marching past a wall must pay for it');
});

test('tower fire is VISIBLE, and throttled to one spark per column', async () => {
  // A WHOLE SHIPPED MECHANIC WITH NO PLAYER-FACING SIGNAL. `TOWER_FIRED` carried
  // everything needed — squad, owner, site, kind, hex, losses — and grepping
  // render/, ui/ and screens/ found no consumer at all, so a column walking past
  // a wall just quietly shrank. The lesson it exists to teach (route around
  // walls) cannot be learned from an invisible tax.
  //
  // It also cannot map one-to-one onto an effect: measured over single battles
  // it fires 347 times on riverfen, 1012 on duskfell and 1408 on ravensmarch.
  const { createFx, fxFromEvent } = await import('../src/render/fx.js');
  const fx = createFx();
  const p = { danger: '#f00', accent: '#fff', owner: { player: '#0f0', enemy: '#f00' } };

  // The spark exists at all.
  fxFromEvent(fx, { type: 'tower-fired', x: 10, y: 10, owner: 'player' }, p, 34);
  assert.equal(fx.live(), 1, 'tower fire drew nothing — the mechanic is still invisible');

  // ...and the throttle is per COLUMN, on wall-clock time.
  fx.clear();
  assert.equal(fx.towerFxDue(7, 1000), true, 'the first shot at a column must show');
  assert.equal(fx.towerFxDue(7, 1100), false, 'ten a second is a strobe, not a tell');
  assert.equal(fx.towerFxDue(8, 1100), true, 'a DIFFERENT column is its own signal');
  assert.equal(fx.towerFxDue(7, 3000), true, 'still being shot at, and still worth saying');

  // NEGATIVE CONTROL: clearing the layer forgets the cooldowns too, or a new
  // battle would start with every column already muffled.
  fx.clear();
  assert.equal(fx.towerFxDue(7, 3050), true, 'a fresh battle inherited a stale cooldown');
});
