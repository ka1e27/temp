// The battle HUD's controls, as pure functions plus one thin fake DOM.
//
// The bug these exist to prevent: a control that looks fine and does nothing.
// Three boosters, site upgrades, withdraw, pause, slow-mo and the speed control
// all shipped unreachable, and every test passed the whole time — because
// nothing asserted that an intent reached `state.commands[]` and came out the
// other side of the simulation.
//
// So each test here follows the same shape a player does: press the control,
// drain the command queue with the REAL commands.js, and check the simulation
// actually moved.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createBattleState } from '../src/battle/state.js';
import { drainCommands } from '../src/battle/commands.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { emptyComp } from '../src/battle/combat.js';
import { BOOSTERS, UNIT_IDS, SITE_UPGRADE, SITE_LEVELS, CENTIGOLD } from '../src/content/balance.js';
import { EVENTS } from '../src/battle/events.js';
import {
  BOOSTER_KEYS, FILTER_KEYS, BOOSTER_BY_KEY, FILTER_BY_KEY, SPEED_KEYS,
  TARGETED_BOOSTERS, needsTarget, SPEEDS, stepSpeedIndex, speedAllowed,
  NORMAL_SPEED_INDEX, FREE_SPEED_MAX, maxSpeedIndex, speedIndexOf,
} from '../src/screens/battle-keys.js';
import { createOrders, cmd } from '../src/screens/battle-orders.js';
import { createView } from '../src/screens/battle-input.js';
import { upgradeOffer, upgradeLabel, rejectionText, REJECTIONS }
  from '../src/screens/battle-panel.js';
import { effectiveSpeed, speedLabel } from '../src/screens/battle-speed.js';

const ALL_BOOSTERS = Object.keys(BOOSTERS).map((id) => ({ id, charges: 2 }));

function fixture(o = {}) {
  return createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: 'test',
    seed: 1,
    grid: o.grid ?? { cols: 11, rows: 9, blocked: [] },
    sites: o.sites ?? [
      { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 10 }, hp: 600, hpMax: 600 },
      { id: 'farm', kind: 'farm', hex: [1, 0], owner: 'player', garrison: { militia: 4 }, hp: 100, hpMax: 100 },
      { id: 'hold', kind: 'stronghold', hex: [2, 0], owner: 'enemy', garrison: { militia: 6 }, hp: 250, hpMax: 250 },
      { id: 'cas', kind: 'castle', hex: [4, 0], owner: 'enemy', garrison: {}, hp: 600, hpMax: 600 },
    ],
    adjacency: o.adjacency ?? [['camp', 'farm'], ['farm', 'hold'], ['hold', 'cas']],
    player: makeMods({ expedition: emptyComp(), startGold: o.gold ?? 1000, ...(o.mods ?? {}) }),
    enemy: makeMods({ expedition: emptyComp() }),
    boosters: o.boosters ?? ALL_BOOSTERS,
    rules: { victory: 'capture-castle', hardCapMs: 480000, aiTier: 1 },
  });
}

/** The two things battle-orders.js touches outside the sim. */
function harness(state, view = createView()) {
  const classes = new Set();
  const canvas = {
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
  };
  const board = {
    hexSize: 34,
    sitePos: (s, out) => { out.x = s.hex[0] * 51; out.y = s.hex[1] * 59; return out; },
    siteAt: () => null,
  };
  const events = [];
  const bus = { emit: (t, p) => events.push([t, p]) };
  const ord = createOrders({ canvas, board, view, getState: () => state, bus });
  return { ord, view, classes, events, board };
}

const reasons = (state) => state.events
  .filter((e) => e.type === EVENTS.COMMAND_REJECTED).map((e) => e.reason);

// ---------------------------------------------------------------------------
// Key tables — one source of truth, checked against the units and boosters
// ---------------------------------------------------------------------------

test('keys: every booster and every unit has exactly one key, and none collide', () => {
  assert.deepEqual(Object.keys(BOOSTER_KEYS), Object.keys(BOOSTERS));
  assert.deepEqual(Object.keys(FILTER_KEYS), UNIT_IDS);

  const all = [
    ...Object.keys(BOOSTER_BY_KEY),
    ...Object.keys(FILTER_BY_KEY),
    ...Object.keys(SPEED_KEYS),
    'escape', 'p', ' ', '1', '2', '3', '4',
  ];
  assert.equal(new Set(all).size, all.length, `key collision in ${all.join(',')}`);

  // The inverse tables must actually be inverses — that was the whole reason
  // two hand-maintained copies of these maps were a hazard.
  for (const [id, key] of Object.entries(BOOSTER_KEYS)) {
    assert.equal(BOOSTER_BY_KEY[key.toLowerCase()], id);
  }
  for (const [id, key] of Object.entries(FILTER_KEYS)) {
    assert.equal(FILTER_BY_KEY[key.toLowerCase()], id);
  }
});

test('keys: TARGETED_BOOSTERS is exactly what the simulation demands a site for', () => {
  for (const id of Object.keys(BOOSTERS)) {
    const state = fixture();
    state.commands.push(cmd.booster(id, null));
    drainCommands(state);
    const refused = reasons(state).includes('needs-target');
    assert.equal(refused, needsTarget(id),
      `${id}: commands.js ${refused ? 'needs' : 'does not need'} a target, `
      + `TARGETED_BOOSTERS says ${needsTarget(id)}`);
  }
  assert.deepEqual([...TARGETED_BOOSTERS].sort(), ['bombard', 'fortify', 'rally']);
});

// ---------------------------------------------------------------------------
// Armed boosters — the fix for "3 of 5 boosters unreachable through every path"
// ---------------------------------------------------------------------------

test('boosters: an untargeted booster fires immediately and spends a charge', () => {
  const state = fixture();
  const { ord } = harness(state);
  assert.equal(ord.armBooster('tithe'), false, 'tithe must not arm');
  assert.deepEqual(state.commands[0], { t: 'BOOSTER', id: 'tithe', site: null });

  const gold0 = state.factions.player.goldCg;
  drainCommands(state);
  assert.deepEqual(reasons(state), []);
  assert.equal(state.boosters.tithe.charges, 1);
  assert.ok(state.factions.player.goldCg > gold0, 'War Tithe paid nothing');
});

test('boosters: a targeted booster arms, then the next site click fires it there', () => {
  const state = fixture();
  const { ord, view, classes, events } = harness(state);

  assert.equal(ord.armBooster('fortify'), true);
  assert.equal(view.armedBooster, 'fortify');
  assert.ok(classes.has('is-targeting'), 'the board gets no aiming affordance');
  assert.deepEqual(events.at(-1), ['ui:armed-booster', 'fortify']);
  assert.equal(state.commands.length, 0, 'arming must not issue a command');

  assert.equal(ord.fireBooster('farm'), true);
  assert.equal(view.armedBooster, null);
  assert.ok(!classes.has('is-targeting'));
  assert.deepEqual(state.commands[0], { t: 'BOOSTER', id: 'fortify', site: 'farm' });

  const hp0 = state.sites[1].hp;
  drainCommands(state);
  assert.deepEqual(reasons(state), []);
  assert.equal(state.boosters.fortify.charges, 1);
  assert.equal(state.sites[1].hp, hp0 + BOOSTERS.fortify.hp);
  assert.ok(state.sites[1].shieldTicks > 0);
});

test('boosters: every one of the five reaches the simulation through the HUD path', () => {
  for (const id of Object.keys(BOOSTERS)) {
    const state = fixture();
    // Something in flight so `march` has work to do, but only half the camp —
    // `rally` needs a garrison left behind to pull from.
    state.commands.push(cmd.send('camp', 'farm', 0.5, UNIT_IDS));
    drainCommands(state);
    state.events.length = 0;

    const { ord } = harness(state);
    const armed = ord.armBooster(id);
    if (armed) ord.fireBooster(id === 'bombard' ? 'hold' : 'farm');
    drainCommands(state);

    assert.deepEqual(reasons(state), [], `${id} was rejected`);
    assert.equal(state.boosters[id].charges, 1, `${id} spent no charge`);
  }
});

test('boosters: pressing the armed booster again cancels, and so does Esc', () => {
  const state = fixture();
  const { ord, view } = harness(state);

  ord.armBooster('rally');
  assert.equal(ord.armBooster('rally'), false, 'same key again must disarm');
  assert.equal(view.armedBooster, null);
  assert.equal(state.commands.length, 0, 'cancelling must not fire the booster');

  ord.armBooster('rally');
  ord.armBooster('bombard');          // a different booster re-aims
  assert.equal(view.armedBooster, 'bombard');

  assert.equal(ord.cancelBooster(), true);
  assert.equal(view.armedBooster, null);
  assert.equal(ord.cancelBooster(), false, 'cancelling nothing is a no-op');
  assert.equal(ord.fireBooster('farm'), false, 'firing nothing is a no-op');
  assert.equal(state.commands.length, 0);
});

test('boosters: a booster aimed at an illegal site is REFUSED, out loud', () => {
  const state = fixture();
  const { ord } = harness(state);
  ord.armBooster('bombard');
  ord.fireBooster('camp');            // your own camp is not a bombard target
  drainCommands(state);
  assert.deepEqual(reasons(state), ['not-a-target']);
  assert.equal(state.boosters.bombard.charges, 2, 'a refused booster must cost nothing');
});

// ---------------------------------------------------------------------------
// Site panel + in-battle upgrades — a mechanic neither side could use
// ---------------------------------------------------------------------------

test('upgrade: the offer names the cost and build time from balance.js', () => {
  const state = fixture({ gold: 1000 });
  const camp = state.sites[0];
  const o = upgradeOffer(state, camp);
  assert.deepEqual(o, { level: 1, cost: SITE_UPGRADE[0].gold, sec: SITE_UPGRADE[0].sec, can: true, why: '' });
  assert.equal(upgradeLabel(o), `Upgrade → L2 · ${SITE_UPGRADE[0].gold}g · ${SITE_UPGRADE[0].sec}s`);
});

test('upgrade: the action is refused when unaffordable, foreign, busy or maxed', () => {
  const poor = fixture({ gold: 10 });
  assert.equal(upgradeOffer(poor, poor.sites[0]).can, false);
  assert.equal(upgradeOffer(poor, poor.sites[0]).why, 'insufficient-gold');

  const state = fixture({ gold: 5000 });
  assert.equal(upgradeOffer(state, state.sites[2]).why, 'not-your-site');

  state.sites[0].upgradeTicksLeft = 20;
  assert.equal(upgradeOffer(state, state.sites[0]).why, 'already-upgrading');

  state.sites[0].upgradeTicksLeft = 0;
  // The TOP of the ladder, not the literal 3: how many levels there are is
  // content (SITE_LEVELS), and this assertion is about what happens when there
  // is no step left to buy.
  const top = SITE_LEVELS.length;
  state.sites[0].level = top;
  const maxed = upgradeOffer(state, state.sites[0]);
  assert.equal(maxed.why, 'max-level');
  assert.equal(maxed.can, false);
  assert.equal(upgradeLabel(maxed), `Level ${top} · max`);
});

test('upgrade: the panel button raises the level and spends the gold, for real', () => {
  const state = fixture({ gold: 5000 });
  const spend = SITE_UPGRADE[0].gold * CENTIGOLD;
  const gold0 = state.factions.player.goldCg;

  state.commands.push(cmd.upgrade('farm'));   // exactly what input.upgrade() pushes
  drainCommands(state);

  assert.deepEqual(reasons(state), []);
  assert.equal(state.sites[1].level, 2);
  assert.equal(state.factions.player.goldCg, gold0 - spend);
  assert.ok(state.sites[1].upgradeTicksLeft > 0, 'the build takes time');
});

test('panel: a farm is a selectable site like any other', () => {
  const state = fixture();
  const { ord, view } = harness(state);
  ord.selectOnly('farm');
  assert.deepEqual(view.selection, ['farm']);
  // Farms cannot train, so the fan picker stays shut — the site panel is what
  // opens for them, and it hangs off `selection`, which every site sets.
  assert.equal(view.trainPickerFor, null);
  assert.equal(upgradeOffer(state, state.sites[1]).can, true);
});

// ---------------------------------------------------------------------------
// Rejection feedback
// ---------------------------------------------------------------------------

test('rejections: every reason commands.js can produce has player-facing words', () => {
  // Scraped from battle/commands.js: if a reason is added there without a line
  // here, the player sees a raw slug. This list is the contract.
  const produced = [
    'unknown-site', 'not-your-site', 'no-route', 'same-site', 'not-adjacent',
    'bad-fraction', 'empty-send',
    'site-cannot-train', 'unknown-unit', 'unit-locked', 'already-upgrading', 'max-level',
    'insufficient-gold', 'unknown-target', 'nowhere-to-retreat', 'nothing-to-retreat',
    'unknown-squad', 'not-your-squad', 'already-retreating', 'not-your-battle',
    'boosters-are-the-players', 'booster-unavailable', 'no-charges', 'unknown-booster',
    'needs-target', 'no-sources', 'nothing-in-flight', 'not-a-target',
    'malformed', 'unknown-command',
  ];
  for (const r of produced) assert.ok(REJECTIONS[r], `no message for "${r}"`);
});

test('rejections: the message names the booster that failed', () => {
  assert.equal(rejectionText({ reason: 'no-charges', cmd: { t: 'BOOSTER', id: 'rally' } }),
    'RALLY: No charges left.');
  assert.match(rejectionText({ reason: 'no-route' }), /blocks every route/);
  assert.match(rejectionText({ reason: 'brand-new-reason' }), /brand-new-reason/);
  assert.match(rejectionText(null), /unknown/);
});

test('rejections: a silently dropped order really does leave a reason behind', () => {
  // A WALL, not a missing edge. This used to send `camp -> cas` and rely on the
  // two not being adjacent; armies march anywhere now, so the only thing that
  // refuses a send is a base standing in the way — which is what this builds.
  // The corridor is one hex tall, so `hold` at [1,0] seals it completely.
  const state = fixture({
    sites: [
      { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 10 }, hp: 600, hpMax: 600 },
      { id: 'hold', kind: 'stronghold', hex: [1, 0], owner: 'enemy', garrison: { militia: 6 }, hp: 250, hpMax: 250 },
      { id: 'cas', kind: 'castle', hex: [2, 0], owner: 'enemy', garrison: {}, hp: 600, hpMax: 600 },
    ],
    grid: { cols: 3, rows: 1, blocked: [] },
  });
  state.commands.push(cmd.send('camp', 'cas', 1, UNIT_IDS));
  drainCommands(state);
  const ev = state.events.find((e) => e.type === EVENTS.COMMAND_REJECTED);
  assert.equal(ev.reason, 'no-route');
  assert.match(rejectionText(ev), /blocks every route/);

  // The negative control, and it is the whole point: the SAME send to the base
  // that is doing the blocking is legal, because a goal hex is always reachable.
  state.events = [];
  state.commands.push(cmd.send('camp', 'hold', 1, UNIT_IDS));
  drainCommands(state);
  assert.equal(state.events.filter((e) => e.type === EVENTS.COMMAND_REJECTED).length, 0);
});

// ---------------------------------------------------------------------------
// Withdraw and squad retreat — the last two unreachable verbs
// ---------------------------------------------------------------------------

test('withdraw: the HUD button ends the battle in retreat', () => {
  const state = fixture();
  state.commands.push(cmd.withdraw());
  drainCommands(state);
  assert.deepEqual(reasons(state), []);
  assert.equal(state.status, 'retreat');
  assert.ok(state.events.some((e) => e.type === EVENTS.BATTLE_ENDED && e.result === 'retreat'));
});

test('squads: clicking an in-flight squad selects it, and R turns it around', () => {
  const state = fixture();
  state.commands.push(cmd.send('camp', 'farm', 1, UNIT_IDS));
  drainCommands(state);
  const squad = state.squads[0];
  assert.ok(squad, 'no squad to click');

  const { ord, view, board } = harness(state);
  // Halfway along the route is the worst case for arc bow, so aim there.
  const a = board.sitePos(state.sites[0], { x: 0, y: 0 });
  const b = board.sitePos(state.sites[1], { x: 0, y: 0 });
  state.tick = Math.round((squad.spawnTick + squad.arriveTick) / 2);
  const hit = ord.squadAt(state, (a.x + b.x) / 2, (a.y + b.y) / 2);
  assert.equal(hit?.id, squad.id, 'the squad was not hit-testable');

  ord.selectSquad(hit);
  assert.equal(view.selectedSquad, squad.id);
  assert.deepEqual(view.selection, [], 'selecting a squad clears the site selection');

  state.commands.push(cmd.retreatSquad(view.selectedSquad));
  drainCommands(state);
  assert.deepEqual(reasons(state), []);
  assert.equal(state.squads[0].retreating, true);
});

test('squads: empty board with nothing in flight still just deselects', () => {
  const state = fixture();
  const { ord } = harness(state);
  assert.equal(ord.squadAt(state, 9999, 9999), null);
});

test('squads: a squad that has already arrived is forgotten, not ordered', () => {
  const state = fixture();
  state.commands.push(cmd.send('camp', 'farm', 1, UNIT_IDS));
  drainCommands(state);
  const { ord, view } = harness(state);
  ord.selectSquad(state.squads[0]);

  state.squads.length = 0;              // it landed
  assert.equal(ord.retreatSelectedSquad(), false);
  assert.equal(view.selectedSquad, null, 'a landed squad must be forgotten');
  assert.equal(state.commands.length, 0, 'no order for a squad that no longer exists');
});
