// THE SURFACES THAT WENT ON ANNOUNCING WHAT THE BOARD HAD LEARNED TO HIDE.
//
// tests/fogrender.test.js covers the board itself — the drawn flood, the ghost
// silhouettes, the veil. This file covers the three leaks found by review
// AFTER that pass, and they share a shape worth naming: each one is a surface
// that never asked about vision because, before fog, there was nothing to ask.
// Hiding a site on the canvas buys nothing while a floating "+3" over its yard
// announces every batch of troops it finishes.
//
// Every claim below is paired with a control that fails if the rule it pins is
// simply deleted — a gate that returned false for everything would satisfy the
// leak assertions on its own and be a mute button rather than fog.
import test from 'node:test';
import assert from 'node:assert/strict';

import { startBattle } from '../src/battle/sim.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { createState } from '../src/core/store.js';
import { markConquered, refreshUnlocks } from '../src/meta/world.js';
import { REGIONS } from '../src/content/regions.data.js';
import { canSee, perceivedSite } from '../src/battle/vision.js';
import { fxVisible } from '../src/render/fog.js';
import { drawRallies } from '../src/render/rallyLines.js';

/** A real battle on the real path — the same helper construct/vision use. */
function battleFor(id = 'gallowmoor') {
  const state = createState({ seed: 1, now: 0 });
  const i = REGIONS.findIndex((r) => r.id === id);
  for (const p of REGIONS.slice(0, i)) markConquered(state.meta, p.id, { now: 0, durationMs: 0 });
  refreshUnlocks(state.meta, null);
  const b = startBattle(buildBattleConfig(state.meta, id, [], generateBattleMap, { seed: 5 }));
  b.ai.nextThinkTick = 1e9;
  return b;
}

const unseenEnemy = (b) => b.sites
  .find((s) => s.owner === 'enemy' && !canSee(b, 'player', s.hex[0], s.hex[1]));

/** A canvas that records the calls the assertions care about and ignores the
 *  rest, so a stroke style or a dash pattern changing cannot break this. */
function stubCtx(log) {
  const noop = () => {};
  return {
    beginPath: noop,
    moveTo: noop,
    lineTo: (...a) => log.push(['lineTo', ...a]),
    stroke: () => log.push(['stroke']),
    setLineDash: noop,
    closePath: noop,
    save: noop,
    restore: noop,
    fill: noop,
    arc: noop,
    strokeStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
  };
}

// ---------------------------------------------------------------------------
// 1. An effect is a positional claim
// ---------------------------------------------------------------------------

test('fx: an effect fires only where the player can see, or where their own men are', () => {
  // MEASURED BEFORE THE GATE, gallowmoor, one whole battle: 85% of all combat
  // and economy effects fired on ground the player cannot see — 385 of them
  // gold "+N" floats over the enemy's training grounds, plus every siege,
  // field battle and capture. That is a live readout of the enemy's whole
  // economy and it tells you exactly where to look. It also defeats
  // `state.seen`, whose entire job is that you learn an owner by LOOKING.
  const b = battleFor();
  const dark = unseenEnemy(b);
  assert.ok(dark, 'no unseen enemy site — this proves nothing');

  assert.equal(
    fxVisible(b, 'player', { siteId: dark.id, owner: 'enemy', unit: 'militia', count: 3 }, dark),
    false, 'an enemy yard in the dark announced the troops it had just finished',
  );
  assert.equal(
    fxVisible(b, 'player', { siteId: dark.id, attacker: 'enemy', win: true }, dark),
    false, 'a battle the player cannot see drew a burst on the board',
  );
  assert.equal(
    fxVisible(b, 'player', { siteId: dark.id, kind: dark.kind, from: 'neutral', to: 'enemy' }, dark),
    false, 'a capture in the dark played, so state.seen never gets to be how you learn it',
  );

  // CONTROL 1 — the SAME site, once in sight, plays everything. Without this
  // the three above pass just as happily against a gate that returns false for
  // every event ever raised, which is a mute button rather than fog.
  const key = `${dark.hex[0]},${dark.hex[1]}`;
  const lit = { ...b, vision: { ...b.vision, player: { ...b.vision.player, [key]: 1 } } };
  assert.equal(fxVisible(lit, 'player', { siteId: dark.id, owner: 'enemy' }, dark), true,
    'an enemy site in plain sight went silent');
});

test('fx: YOU ALWAYS KNOW WHAT YOUR OWN MEN ARE DOING, wherever they are', () => {
  // This is the case the obvious implementation gets wrong. By the time events
  // are drained the capture has already happened, so a site the player has just
  // LOST belongs to the enemy — and a gate asking "is this mine" answers no to
  // the single event they most need. Reading the event's own actor fields
  // (`from`/`to`/`attacker`/`owner`) is what makes the answer right.
  const b = battleFor();
  const dark = unseenEnemy(b);
  assert.equal(fxVisible(b, 'player', { siteId: dark.id, from: 'player', to: 'enemy' }, dark), true,
    'the player was never told they had lost a site');
  assert.equal(fxVisible(b, 'player', { siteId: dark.id, attacker: 'player', win: false }, dark), true,
    'the player attacked into the dark and was never told what came of it');
  assert.equal(fxVisible(b, 'player', { siteId: dark.id, owner: 'player', count: 2 }, dark), true,
    'the player\'s own yard trained in silence');

  // CONTROL: the enemy as actor, same site, same shape of event — refused.
  // Otherwise this passes against a gate that returns true unconditionally.
  assert.equal(fxVisible(b, 'player', { siteId: dark.id, from: 'neutral', to: 'enemy' }, dark), false,
    'the actor check is waving everything through');
});

test('fx: an event that names no site is not a positional claim', () => {
  // A battle ending or a command refused has no hex to be judged against, and
  // gating those on one they do not have would silence them all. The screen
  // drain checks `ev.siteId == null` before it ever asks; this pins the reason
  // that check has to be there — `fxVisible` itself refuses, correctly, having
  // nothing to go on.
  const b = battleFor();
  assert.equal(fxVisible(b, 'player', { type: 'battle-ended' }, null), false,
    'fxVisible invented a location for an event that has none');
});

// ---------------------------------------------------------------------------
// 2. A rally line has two ends
// ---------------------------------------------------------------------------

test('rally: a line is checked at BOTH ends, not just at its source', () => {
  // `byId` resolves through `perceivedSite`, so an unscouted destination comes
  // back as a GHOST — which is TRUTHY, and the bare `!o` check therefore drew a
  // dashed line with two arrowheads pointing straight at ground the player had
  // never seen. That announces both that something is there and that the enemy
  // is reinforcing toward it. A rally is a live standing order, and live is
  // exactly the half fog hides.
  const b = battleFor();
  const dark = unseenEnemy(b);
  assert.equal(perceivedSite(b, 'player', dark).ghost, true, 'the fixture site is not hidden');

  const mine = b.sites.find((s) => s.owner === 'player');
  const g = {
    byId: (id) => {
      const raw = b.sites.find((s) => s.id === id);
      return raw ? perceivedSite(b, 'player', raw) : null;
    },
    pos: (s, out) => { out.x = s.hex[0] * 40; out.y = s.hex[1] * 40; return out; },
    palette: { border: { player: '#0f0', enemy: '#f00' } },
    hexSize: 30,
  };

  const log = [];
  mine.rallyTargets = [dark.id];
  mine.rallyCursor = 0;
  drawRallies(stubCtx(log), b, 'player', 1, g);
  assert.equal(log.filter((c) => c[0] === 'lineTo').length, 0,
    'a rally line was drawn from a site in plain sight into the fog');

  // CONTROL: the identical call with a destination the player CAN see must
  // draw — otherwise the assertion above holds against a drawRallies that
  // draws nothing at all, which is precisely the failure mode this repo keeps
  // hitting.
  const visible = b.sites.find((s) => s.id !== mine.id
    && canSee(b, 'player', s.hex[0], s.hex[1]));
  assert.ok(visible, 'no second visible site — the control cannot be built');
  mine.rallyTargets = [visible.id];
  log.length = 0;
  drawRallies(stubCtx(log), b, 'player', 1, g);
  assert.ok(log.filter((c) => c[0] === 'lineTo').length > 0,
    'a rally between two sites in plain sight drew nothing — the control is dead');
});
