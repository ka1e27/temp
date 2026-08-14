// The coach machine, headless.
//
// The whole reason src/ui/coach.js is split into a pure decision function and a
// thin DOM strip is so this file exists: onboarding is a state machine, state
// machines are where "it fired twice" and "it fired in region 4" live, and
// neither is catchable by looking at a screenshot. Nothing here touches a DOM.
//
// The last test is the one that would have caught the real hazard: the player
// starts a battle holding 300 gold, so a naive `gold > 100` beat fires on tick
// 0, before the player has done anything at all. It is asserted against a
// battle built by the REAL buildBattleConfig, not a hand-written fixture.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BEATS, BEAT_IDS, COACH_REGION, createCoachMachine, nextBeat, readSignals,
  emptyLatch, noteEvent, observeState, castleTouchesPlayer, shouldMarkSeen,
} from '../src/ui/coach.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { startBattle } from '../src/battle/sim.js';
import { COACH } from '../src/content/strings.js';
import { createMeta } from '../src/core/store.js';

// --- a battle-shaped stub, only the fields the machine reads ---------------

function battle(over = {}) {
  return {
    regionId: COACH_REGION,
    status: 'running',
    factions: { player: { goldCg: 0 }, enemy: { goldCg: 0 } },
    squads: [],
    // `hex` and `seen` are here because the castle beat is FOG-GATED now
    // (ui/coach.js castleTouchesPlayer): a hint is speech about the board, so it
    // is bound by the same rule the board is. The default stub is a player who
    // has already looked at the throne, because every test in this file is about
    // the beat TABLE rather than about fog; the gate itself is pinned against a
    // REAL battle in tests/fogleaks.test.js, beside the other surfaces that used
    // to narrate what the board hides.
    sites: [
      { id: 'camp', kind: 'camp', owner: 'player', hex: [0, 0], adj: ['nf01'] },
      { id: 'nf01', kind: 'farm', owner: 'neutral', hex: [1, 0], adj: ['camp', 'castle'] },
      { id: 'castle', kind: 'castle', owner: 'enemy', hex: [2, 0], adj: ['nf01'] },
    ],
    vision: { player: {}, enemy: {} },
    seen: { player: { castle: 'enemy' }, enemy: {} },
    ...over,
  };
}

const gold = (n) => ({ factions: { player: { goldCg: Math.round(n * 100) } } });

/** Drive the machine and collect the beats it emitted, in order. `pump` runs
 *  before every step so the caller can advance the world; a step that returns
 *  nothing is normal and never ends the run. */
function drain(machine, world, pump, limit = 40) {
  const out = [];
  for (let i = 0; i < limit; i++) {
    pump?.(i);
    const beat = machine.step(world.battle, world.meta);
    if (beat) out.push(beat.id);
  }
  return out;
}

// --- the shape of the beat table -------------------------------------------

test('every beat has copy, a predicate, and a unique id', () => {
  // DERIVED, not a literal. This asserted a five-name list, which is exactly
  // why four beats could sit in strings.js unwired for the project's whole life
  // without a single test noticing: the suite iterated BEATS and so could only
  // ever check the beats that were already in it. What it must pin is that every
  // line of COACH copy reaches the script — the property that was violated.
  assert.equal(new Set(BEAT_IDS).size, BEAT_IDS.length);
  const scripted = new Set(BEATS.map((b) => b.text));
  for (const [key, line] of Object.entries(COACH)) {
    assert.ok(scripted.has(line),
      `COACH.${key} is written and never shown — no beat in coach.data.js uses it`);
  }
  assert.equal(BEAT_IDS[0], 'drag', 'the first thing a player is told must be the gesture');
  assert.equal(new Set(BEAT_IDS).size, BEAT_IDS.length);
  for (const b of BEATS) {
    assert.equal(typeof b.text, 'string', `${b.id} has no copy`);
    assert.ok(b.text.length > 10, `${b.id} copy looks empty: "${b.text}"`);
    assert.equal(typeof b.when, 'function', `${b.id} has no predicate`);
    if (b.after) assert.ok(BEAT_IDS.includes(b.after), `${b.id} depends on unknown "${b.after}"`);
  }
  // The beat that teaches the two-stage capture gets the longest read.
  const siege = BEATS.find((b) => b.id === 'fieldWon');
  assert.ok(siege.hold > BEATS.find((b) => b.id === 'captured').hold);
});

// --- fires once, and in order ----------------------------------------------

test('the whole tutorial fires, each beat exactly once, in order', () => {
  const m = createCoachMachine();
  const world = { battle: battle(), meta: createMeta() };

  const fired = drain(m, world, (i) => {
    if (i === 1) m.note('squad-sent', { owner: 'player' });
    if (i === 2) m.note('siege-begun', { owner: 'player', siteId: 'nf01' });
    if (i === 3) m.note('site-captured', { to: 'player', from: 'neutral', siteId: 'nf01' });
    if (i === 4) Object.assign(world.battle, gold(180));
    if (i === 5) world.battle.sites[1].owner = 'player';
  });

  // The five beats this world actually satisfies, in order. The other four need
  // signals this fixture never produces (a stronghold taken, a stalled siege, a
  // site lost, rams affordable), so they stay pending — which is the point of
  // `after`/`when` and is asserted directly below.
  assert.deepEqual(fired, ['drag', 'fieldWon', 'captured', 'gold100', 'takeCastle']);

  // Nothing replays: keep stepping with every condition still true.
  for (let i = 0; i < 10; i++) assert.equal(m.step(world.battle, world.meta), null);
});

test('a beat never fires twice even if its condition keeps re-arriving', () => {
  const m = createCoachMachine();
  const b = battle();
  assert.equal(m.step(b, null).id, 'drag');
  m.note('siege-begun', { owner: 'player' });
  assert.equal(m.step(b, null).id, 'fieldWon');
  // Siege lifted, siege begun again — the second one must say nothing.
  m.note('siege-begun', { owner: 'player' });
  m.note('siege-begun', { owner: 'player' });
  assert.equal(m.step(b, null), null);
  // `notReached` is derived so a beat added later cannot silently break a test
  // that was never about it — the fixture below produces no stronghold capture,
  // no stalled siege, no lost site and no ram money.
  const notReached = ['strongholdTaken', 'siegeStalled', 'buildRams', 'retreat', 'firstIncome'];
  assert.deepEqual(m.pending.filter((id) => !notReached.includes(id)),
    ['captured', 'gold100', 'takeCastle']);
});

test('ordering: a later beat waits for its prerequisite, not for a timer', () => {
  const m = createCoachMachine();
  // Everything a late beat needs is true from tick 0 — 300 starting gold and a
  // castle already bordering the camp — but the player has captured nothing.
  const b = battle({
    ...gold(300),
    // `hex` for the same reason the default stub carries one: the castle beat
    // resolves the throne through `siteKnown` now, and the fixture's `seen` says
    // the player has looked at it. This test is about beat ORDER, not fog.
    sites: [
      { id: 'camp', kind: 'camp', owner: 'player', hex: [0, 0], adj: ['castle'] },
      { id: 'castle', kind: 'castle', owner: 'enemy', hex: [2, 0], adj: ['camp'] },
    ],
  });

  assert.equal(m.step(b, null).id, 'drag');
  // gold100 and takeCastle both depend on `captured`; only fieldWon is next.
  assert.equal(m.step(b, null), null, 'a beat jumped its prerequisite');

  m.note('siege-begun', { owner: 'player' });
  assert.equal(m.step(b, null).id, 'fieldWon');
  assert.equal(m.step(b, null), null);

  m.note('site-captured', { to: 'player' });
  assert.equal(m.step(b, null).id, 'captured');
  assert.equal(m.step(b, null).id, 'gold100');
  assert.equal(m.step(b, null).id, 'takeCastle');
});

test('a prerequisite that never arrives blocks only its own dependants', () => {
  const m = createCoachMachine();
  const b = battle({ ...gold(400) });
  assert.equal(m.step(b, null).id, 'drag');
  // The player is losing: no siege of theirs, no capture. Only beat 1 shows.
  for (let i = 0; i < 5; i++) assert.equal(m.step(b, null), null);
  assert.deepEqual(
    m.pending.filter((id) => !['strongholdTaken', 'siegeStalled', 'buildRams', 'retreat', 'firstIncome'].includes(id)),
    ['fieldWon', 'captured', 'gold100', 'takeCastle'],
  );
});

// --- only the enemy's events, only the player's beats ----------------------

test('enemy sieges and enemy captures fire nothing', () => {
  const m = createCoachMachine();
  const b = battle();
  m.step(b, null); // drag
  m.note('siege-begun', { owner: 'enemy', siteId: 'camp' });
  m.note('site-captured', { to: 'enemy', from: 'player', siteId: 'camp' });
  m.note('squad-sent', { owner: 'enemy' });
  assert.equal(m.step(b, null), null);
  assert.deepEqual(m.latch.siegeBegun, false);
  assert.deepEqual(m.latch.captured, false);
});

// --- region 1 only ----------------------------------------------------------

test('nothing fires outside region 1', () => {
  for (const regionId of ['ashford', 'thornmoor', 'obsidian', null, undefined]) {
    const m = createCoachMachine();
    const b = battle({ regionId, ...gold(500) });
    m.note('siege-begun', { owner: 'player' });
    m.note('site-captured', { to: 'player' });
    b.sites[1].owner = 'player';
    assert.deepEqual(drain(m, { battle: b, meta: null }), [],
      `a beat fired in region "${regionId}"`);
    assert.deepEqual(m.pending, BEAT_IDS);
  }
});

test('a beat armed in region 1 does not leak into the next region', () => {
  const m = createCoachMachine();
  assert.equal(m.step(battle(), null).id, 'drag');
  m.note('siege-begun', { owner: 'player' });
  assert.equal(m.step(battle({ regionId: 'thornmoor' }), null), null);
  // ...and it is still waiting if the player comes back to riverfen.
  assert.equal(m.step(battle(), null).id, 'fieldWon');
});

// --- inert once seen --------------------------------------------------------

test('the machine is inert once meta.tutorialSeen is set', () => {
  const seen = { ...createMeta(), tutorialSeen: true };
  const m = createCoachMachine();
  const b = battle({ ...gold(999) });
  m.note('squad-sent', { owner: 'player' });
  m.note('siege-begun', { owner: 'player' });
  m.note('site-captured', { to: 'player' });
  b.sites[1].owner = 'player';
  assert.deepEqual(drain(m, { battle: b, meta: seen }), []);
  assert.equal(m.complete, false, 'nothing should have been marked fired');
});

test('tutorialSeen set mid-run stops the rest of the run', () => {
  const meta = createMeta();
  const m = createCoachMachine();
  const b = battle();
  assert.equal(m.step(b, meta).id, 'drag');
  meta.tutorialSeen = true;
  m.note('siege-begun', { owner: 'player' });
  assert.equal(m.step(b, meta), null);
});

test('skipAll retires every beat; reset re-arms the machine', () => {
  const m = createCoachMachine();
  m.skipAll();
  assert.equal(m.complete, true);
  assert.equal(m.step(battle(), null), null);
  m.reset();
  assert.equal(m.complete, false);
  assert.deepEqual(m.latch, emptyLatch());
  assert.equal(m.step(battle(), null).id, 'drag');
});

test('tutorialSeen is set by a full run, or by any run that reached the siege beat', () => {
  const all = Object.fromEntries(BEAT_IDS.map((id) => [id, true]));
  assert.equal(shouldMarkSeen(all), true, 'all five fired mid-battle');
  assert.equal(shouldMarkSeen({}), false);
  assert.equal(shouldMarkSeen({ drag: true }), false);

  // A player who LOSES region 1 never reaches the castle, so the last beat
  // never fires. Without this rule the whole tutorial replays on every retry.
  assert.equal(shouldMarkSeen({ drag: true, fieldWon: true, captured: true }, { ended: true }), true);
  // ...but quitting before the beat that teaches the game re-arms the coach.
  assert.equal(shouldMarkSeen({ drag: true }, { ended: true }), false);
  assert.equal(shouldMarkSeen({ drag: true, fieldWon: true }), false, 'not while still playing');
});

test('the seen rule follows a real losing run end to end', () => {
  const m = createCoachMachine();
  const b = battle();
  m.step(b, null);                                  // drag
  assert.equal(shouldMarkSeen(m.fired, { ended: true }), false);
  m.note('siege-begun', { owner: 'player' });
  m.step(b, null);                                  // fieldWon
  assert.equal(shouldMarkSeen(m.fired), false, 'mid-battle, still more to say');
  assert.equal(shouldMarkSeen(m.fired, { ended: true }), true, 'battle over, lesson landed');
});

test('beats already recorded as fired are not repeated on a fresh machine', () => {
  const m = createCoachMachine({ fired: { drag: true, fieldWon: true } });
  m.note('site-captured', { to: 'player' });
  assert.equal(m.step(battle(), null).id, 'captured');
});

// --- the pure pieces on their own ------------------------------------------

test('nextBeat is a pure function of (signals, fired)', () => {
  const latch = emptyLatch();
  observeState(latch, battle({ ...gold(50) }));
  const s = readSignals({ battle: battle(), latch });
  assert.equal(nextBeat(s, {}).id, 'drag');
  assert.equal(nextBeat(s, { drag: true }), null);
  // Calling it twice with the same arguments returns the same answer: the
  // function itself records nothing.
  assert.equal(nextBeat(s, {}).id, 'drag');
  assert.equal(nextBeat(null, {}), null);
  assert.equal(nextBeat(readSignals({}), {}), null, 'fired with no battle at all');
});

test('gold latches at its high-water mark and survives being spent', () => {
  const latch = emptyLatch();
  observeState(latch, battle({ ...gold(140) }));
  observeState(latch, battle({ ...gold(9) }));
  assert.equal(latch.gold, 140);
  assert.equal(readSignals({ battle: battle(), latch }).gold, 140);
});

test('castle adjacency is read from the live site graph, then latched', () => {
  const b = battle();
  assert.equal(castleTouchesPlayer(b), false);
  b.sites[1].owner = 'player';
  assert.equal(castleTouchesPlayer(b), true);

  const latch = emptyLatch();
  observeState(latch, b);
  b.sites[1].owner = 'enemy';        // the player loses it again
  assert.equal(castleTouchesPlayer(b), false);
  observeState(latch, b);
  assert.equal(latch.castleAdjacent, true, 'adjacency should stay latched');
});

test('castle adjacency ignores a castle with no player neighbour and no castle', () => {
  assert.equal(castleTouchesPlayer(null), false);
  assert.equal(castleTouchesPlayer({ sites: [] }), false);
  assert.equal(castleTouchesPlayer({ sites: [{ id: 'a', kind: 'farm', owner: 'player', adj: [] }] }), false);
  // A castle the player already owns means the battle is over, not a hint.
  assert.equal(castleTouchesPlayer({
    sites: [
      { id: 'camp', kind: 'camp', owner: 'player', adj: ['castle'] },
      { id: 'castle', kind: 'castle', owner: 'player', adj: ['camp'] },
    ],
  }), false);
});

test('noteEvent only latches the player half of each event', () => {
  const latch = emptyLatch();
  noteEvent(latch, 'siege-begun', { owner: 'enemy' });
  noteEvent(latch, 'site-captured', { to: 'enemy' });
  noteEvent(latch, 'squad-sent', { owner: 'enemy' });
  noteEvent(latch, 'units-trained', { owner: 'player' });
  noteEvent(latch, 'site-captured', undefined);
  assert.deepEqual(latch, emptyLatch());

  noteEvent(latch, 'siege-begun', { owner: 'player' });
  noteEvent(latch, 'site-captured', { to: 'player' });
  noteEvent(latch, 'squad-sent', { owner: 'player' });
  assert.deepEqual(latch, { ...emptyLatch(), siegeBegun: true, captured: true, sentSquad: true });
});

test('the drag beat retires itself once a squad is in flight', () => {
  const dragBeat = BEATS[0];
  const m = createCoachMachine();
  const b = battle();
  m.step(b, null);
  assert.equal(m.retired(dragBeat, b, null), false);
  b.squads = [{ id: 1, owner: 'player', from: 'camp', to: 'nf01' }];
  m.observe(b);
  assert.equal(m.retired(dragBeat, b, null), true);
  // A beat with no `until` is never retired early.
  assert.equal(m.retired(BEATS[1], b, null), false);
});

// --- against the real engine ------------------------------------------------

test('a REAL region-1 battle: gold starts at 300, so gold100 must not jump the queue', () => {
  const meta = createMeta();
  const config = buildBattleConfig(meta, COACH_REGION, [], generateBattleMap);
  const live = startBattle(config);

  assert.equal(live.regionId, COACH_REGION, 'coach gates on battle.regionId');
  assert.ok(live.factions.player.goldCg / 100 > 100,
    'this test is pointless if the player no longer starts above 100 gold');
  assert.ok(live.sites.some((s) => s.kind === 'castle'), 'no castle to point at');

  const m = createCoachMachine();
  assert.equal(m.step(live, meta).id, 'drag');
  // 300 gold in hand and the beat still holds its tongue: it is gated on the
  // player having captured something, not on the number alone.
  assert.equal(m.step(live, meta), null);
  assert.equal(m.signals(live, meta).gold > 100, true);
  assert.deepEqual(
    m.pending.filter((id) => !['strongholdTaken', 'siegeStalled', 'buildRams', 'retreat', 'firstIncome'].includes(id)),
    ['fieldWon', 'captured', 'gold100', 'takeCastle'],
  );
});

test('the coach reads a real battle through the same fields the sim writes', () => {
  const meta = createMeta();
  const live = startBattle(buildBattleConfig(meta, COACH_REGION, [], generateBattleMap));
  const latch = emptyLatch();
  observeState(latch, live);
  const s = readSignals({ battle: live, meta, latch });
  assert.equal(s.regionId, COACH_REGION);
  assert.equal(s.started, true);
  assert.equal(s.tutorialSeen, false);
  assert.equal(Number.isFinite(s.gold), true);
  assert.equal(s.castleAdjacent, castleTouchesPlayer(live));
});
