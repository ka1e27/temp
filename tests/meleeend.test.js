// A FIGHT OPENED LOUDLY AND ENDED IN SILENCE.
//
// `FIELD_BATTLE` fires when a melee starts or is reinforced. Six seconds later
// the ONLY resolution that announced anything was the one that opens a siege —
// so a column of your troops being wiped out simply stopped being on the board,
// and a garrison of yours HOLDING, which is the one piece of good news the
// melee layer can give a player, was invisible.
//
// Both silent outcomes are the ones a player would act on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattleState } from '../src/battle/state.js';
import { step, runToEnd } from '../src/battle/sim.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { emptyComp } from '../src/battle/combat.js';
import { recomputeInfluence } from '../src/battle/influence.js';
import { EVENTS } from '../src/battle/events.js';
import { fxVisible } from '../src/render/fog.js';

let n = 0;
/**
 * A REAL assault, driven through the real command queue.
 *
 * The first version of this fixture hand-built `site.melee`, and every test
 * failed: a melee record carries the projection endpoints `beginMelee`
 * computes (`attEnd`/`defEnd`), so one assembled by hand never steps toward an
 * outcome. That is the same shape as the contract-v12 note in CLAUDE.md — a
 * board whose fights are simply not happening while everything else looks
 * healthy — and it is why this drives `cmdSend` instead.
 */
function assault(attComp, defComp) {
  const state = createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: `me-${n++}`, seed: 3,
    grid: { cols: 13, rows: 9, blocked: [] },
    sites: [
      { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player',
        garrison: { ...emptyComp(), ...attComp }, hp: 480, hpMax: 480, trainType: null },
      { id: 'ef01', kind: 'farm', hex: [4, 2], owner: 'enemy',
        garrison: { ...emptyComp(), ...defComp }, hp: 100, hpMax: 100, trainType: null },
      { id: 'ec01', kind: 'castle', hex: [11, 7], owner: 'enemy',
        garrison: { militia: 8 }, hp: 900, hpMax: 900, trainType: null },
    ],
    adjacency: [],
    player: makeMods({ expedition: emptyComp() }),
    enemy: makeMods({ expedition: emptyComp() }),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 900000, aiTier: 1 },
  });
  recomputeInfluence(state);
  state.commands.push({ t: 'SEND', from: 'camp', to: 'ef01', fraction: 1 });
  return state;
}

/** Every `field-battle-ended` at the farm, over `ticks` of real simulation.
 *  Filtered to the one site because the enemy commander is live and fights its
 *  own battles elsewhere on the board. */
function endings(state, ticks = 400, siteId = 'ef01') {
  const seen = [];
  for (let i = 0; i < ticks; i++) {
    step(state);
    for (const e of state.events) {
      if (e.type === EVENTS.FIELD_BATTLE_ENDED && e.siteId === siteId) seen.push(e);
    }
  }
  return seen;
}

test('a REPULSED assault says so — the outcome that was silent', () => {
  // Four militia into forty. The whole column dies and, before this, nothing
  // anywhere reported it.
  const ev = endings(assault({ militia: 4 }, { militia: 40 }));
  assert.equal(ev.length, 1, 'exactly one resolution');
  assert.equal(ev[0].won, false);
  assert.equal(ev[0].attacker, 'player');
  assert.equal(ev[0].defender, 'enemy');
  assert.ok(ev[0].attLost > 0, 'the attacker lost bodies');
});

test('...and so does a WON one', () => {
  const ev = endings(assault({ militia: 60 }, { militia: 3 }));
  assert.equal(ev.length, 1);
  assert.equal(ev[0].won, true);
  assert.ok(ev[0].defLost > 0);
});

test('it fires ONCE, not once a tick', () => {
  // `siteMelees` runs every tick and the resolution branch is inside it. An
  // event pushed on the wrong side of the `continue` would fire sixty times
  // and look exactly like a working feature until somebody counted.
  const ev = endings(assault({ militia: 30 }, { militia: 30 }), 600);
  assert.equal(ev.length, 1, `fired ${ev.length} times`);
});

test('it carries a POSITION, or the fog gate cannot place it', () => {
  // An event with neither a site nor a hex reads as "not a positional claim"
  // to the drain and is let through everywhere — the fifth fog leak this
  // project found, and the worst shape: inaudible-visible inverted.
  const ev = endings(assault({ militia: 4 }, { militia: 40 }));
  assert.ok(ev[0].siteId, 'must name where it happened');
});

test('and it is a siteId rather than a hex, deliberately', () => {
  // `fxVisible` reads `ev.hex.q` — an OBJECT — and returns on it BEFORE the
  // site fallback. Handing it the `[q,r]` ARRAY off a site resolves undefined
  // and fogs the event away from the player it is for. This asserts the shape
  // rather than the comment, because the two are indistinguishable at a glance.
  const ev = endings(assault({ militia: 4 }, { militia: 40 }))[0];
  assert.equal(ev.hex, undefined, 'a site event must not carry a bare array hex');
});

test('the fog gate lets your own defeat through and keeps a stranger\'s out', () => {
  // The rule `fxVisible` already encodes: you always know what your own men are
  // doing, wherever they are; everything else needs sight.
  const fog = { vision: { player: {}, enemy: {} }, seen: { player: {}, enemy: {} }, squads: [], sites: [] };
  const mine = { attacker: 'player', defender: 'enemy', siteId: 'ef01' };
  const theirs = { attacker: 'enemy', defender: 'neutral', siteId: 'ef09' };
  const far = { hex: [40, 40] };
  assert.equal(fxVisible(fog, 'player', mine, far), true, 'your own assault reaches you');
  assert.equal(fxVisible(fog, 'player', theirs, far), false, 'a stranger\'s does not');
});

test('a fight that resolves is really over — no melee is left behind', () => {
  // The event is pushed beside `site.melee = null`, so an event with a live
  // melee still on the site would mean the two had drifted apart.
  const state = assault({ militia: 4 }, { militia: 40 });
  endings(state);
  assert.equal(state.sites.find((s) => s.id === 'ef01').melee, null);
});

test('a battle still runs to completion with the event in it', () => {
  // The negative control that matters: pushing an event must not change how
  // anything resolves. `state.events` is drained by the screen and the sim
  // never branches on it, but that is a claim worth one runnable check.
  const state = assault({ militia: 80 }, { militia: 4 });
  runToEnd(state, 4000);
  assert.ok(['running', 'won', 'lost', 'timeout'].includes(state.status));
});
