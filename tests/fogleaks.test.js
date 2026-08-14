// THE SURFACES THAT WENT ON ANNOUNCING WHAT THE BOARD HAD LEARNED TO HIDE.
//
// tests/fogrender.test.js covers the board itself — the drawn flood, the ghost
// silhouettes, the veil. This file covers the leaks found by review AFTER that
// pass, and they share a shape worth naming: each one is a surface that never
// asked about vision because, before fog, there was nothing to ask. Hiding a
// site on the canvas buys nothing while a floating "+3" over its yard announces
// every batch of troops it finishes.
//
// THE FOURTH ONE (section 3) is the reason this file grew a hit-test section at
// all. The first three were surfaces that DREW something; the drag magnet is a
// surface that ANSWERS something, and it changed the order the player issued as
// well as naming the building. Review found the other three and no test drove
// this one, so it shipped — a hit-test is exactly as much of a fog surface as a
// draw call, and this file had no hit-test in it.
//
// AND THE FIFTH (section 4) is the coach, which is neither: it is the game
// SPEAKING. The beat table itself is pinned headlessly in tests/coach.test.js
// against a stub; the gate belongs here, against a real battle, beside the
// other four — because what it has in common with them is the surface, not the
// state machine.
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
import { canSee, perceivedSite, siteKnown } from '../src/battle/vision.js';
import { fxVisible } from '../src/render/fog.js';
import { drawRallies } from '../src/render/rallyLines.js';
import { createOrders } from '../src/screens/battle-orders.js';
import { castleTouchesPlayer, emptyLatch, observeState } from '../src/ui/coach.js';
import { hexCx, hexCy } from '../src/render/hexGeom.js';

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

test('fx: a fight on OPEN GROUND names a hex, and a hex is just as positional', () => {
  // The leak the melee layer opened. Two hostile columns meeting on a bare tile
  // push a `field-battle` carrying `hex` and no `siteId` — and the drain's
  // shortcut was "no site id, so not a positional claim, let it through", so a
  // clash anywhere on the map was AUDIBLE through fog while drawing nothing.
  // Invisible and audible is the worst pair of the four.
  const b = battleFor();
  const dark = unseenEnemy(b);
  assert.ok(dark, 'no unseen ground — this proves nothing');
  const hex = { q: dark.hex[0], r: dark.hex[1] };

  assert.equal(fxVisible(b, 'player', { type: 'field-battle', siteId: null, hex, attacker: 'enemy' }, null),
    false, 'a clash on ground the player cannot see was reported to them');

  // CONTROL 1 — the same tile, lit, plays. Without it this passes against a
  // gate that refuses every hex event, which is a mute button rather than fog.
  const key = `${hex.q},${hex.r}`;
  const lit = { ...b, vision: { ...b.vision, player: { ...b.vision.player, [key]: 1 } } };
  assert.equal(fxVisible(lit, 'player', { type: 'field-battle', siteId: null, hex, attacker: 'enemy' }, null),
    true, 'a clash in plain sight went silent');

  // CONTROL 2 — your OWN column fighting in the dark still reaches you, for the
  // same reason your own farm falling does. The actor check runs first.
  assert.equal(fxVisible(b, 'player', { type: 'field-battle', siteId: null, hex, attacker: 'player' }, null),
    true, 'the player\'s own column was intercepted and they were never told');
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

// ---------------------------------------------------------------------------
// 3. The drag magnet is a hit-test, and nothing here ever asked it about fog
// ---------------------------------------------------------------------------

const HEX = 34;

/** The `board` bundle `createOrders` closes over, cut to the three members
 *  `snapTarget` actually uses.
 *
 *  `hit` stands in for render/battleView.js `siteAt`, and passing a BLIND one is
 *  the point rather than a shortcut: that function's own fog gate is what
 *  created the defect. It answers null for a building this faction has never
 *  looked at, and null is exactly what fell through to the magnet — so the one
 *  drag that reached the scan below was PRECISELY the one aimed at an unscouted
 *  site. A real drag reaches the same line whenever the pointer lands between
 *  two sites, which is what the magnet exists to forgive. */
function boardFor(hit = () => null) {
  return {
    hexSize: HEX,
    siteAt: hit,
    sitePos: (s, out) => {
      out.x = hexCx(s.hex[0], s.hex[1], HEX);
      out.y = hexCy(s.hex[0], s.hex[1], HEX);
      return out;
    },
  };
}

const centre = (s) => ({ x: hexCx(s.hex[0], s.hex[1], HEX), y: hexCy(s.hex[0], s.hex[1], HEX) });

/** Real `createOrders`, not a re-implementation of `snapTarget` — the whole
 *  reason the leak survived four fog passes is that no test drove this file. */
function ordersFor(b, hit) {
  return createOrders({
    canvas: null,
    board: boardFor(hit),
    view: { selection: [], filter: {}, fraction: 0.5, pointer: { x: 0, y: 0 } },
    getState: () => b,
  });
}

test('snap: the drag magnet refuses a building the player has never seen', () => {
  // THE FOURTH LEAK, and the only one that changes an ORDER rather than a
  // drawing. `snapTarget` magnets to the nearest site within ~1.4 hexes, and it
  // scanned `state.sites` raw. Two things came out of that. The preview panel
  // NAMED the site, and a site id encodes owner and kind (`es04` is an enemy
  // stronghold), so a player could read the enemy's layout by sweeping the dark
  // with a drag. And the SEND then went to that invisible building instead of
  // camping on the open ground the drag was actually aimed at — fog handing over
  // the map and quietly rewriting the order at the same time.
  const b = battleFor();
  const mine = b.sites.find((s) => s.owner === 'player');
  const orders = ordersFor(b);

  const hidden = b.sites.filter((s) => !siteKnown(b, 'player', s));
  assert.ok(hidden.length > 2, 'nothing on this board is unscouted — the test proves nothing');
  for (const dark of hidden) {
    const at = centre(dark);
    const got = orders.snapTarget(mine, at.x, at.y);
    assert.notEqual(got?.id, dark.id,
      `the magnet named ${dark.id}, a building the player has never looked at`);
    assert.ok(!got || siteKnown(b, 'player', got),
      'the magnet snapped to some other site the player has never looked at');
  }
});

test('snap: ...and still forgives a sloppy drag toward a site the player HAS seen', () => {
  // THE NEGATIVE CONTROL, and it is the half that matters: the assertions above
  // pass just as happily against a `snapTarget` that returns null for
  // everything, which is not fog — it is a magnet that stopped working, and
  // every drag released a few pixels off a site would silently become a march
  // onto bare ground. This project's documented recurring failure is a test that
  // asserts the wrong thing, so the gate has to be shown letting something
  // through as well as refusing something.
  const b = battleFor();
  const mine = b.sites.find((s) => s.owner === 'player');
  const orders = ordersFor(b);

  const known = b.sites.find((s) => s.id !== mine.id && siteKnown(b, 'player', s));
  assert.ok(known, 'no second known site — the control cannot be built');
  const at = centre(known);
  assert.equal(orders.snapTarget(mine, at.x, at.y)?.id, known.id,
    'the magnet no longer snaps to a site in plain sight');

  // ...and the direct hit-test still wins when it answers, so the gate did not
  // turn into a second, disagreeing rule about what the pointer is over.
  const seen = b.sites.find((s) => s.id !== mine.id && s.id !== known.id
    && siteKnown(b, 'player', s));
  assert.ok(seen, 'no third known site — the hand-off cannot be checked');
  const direct = ordersFor(b, () => seen);
  assert.equal(direct.snapTarget(mine, at.x, at.y)?.id, seen.id,
    'snapTarget ignored what the board said the pointer was over');
});

// ---------------------------------------------------------------------------
// 4. The coach is a surface too, and it is the game's own voice
// ---------------------------------------------------------------------------

test('coach: the castle beat does not name a throne the player has never seen', () => {
  // COACH.takeCastle names the throne and tells the player to take the
  // countryside before assaulting it, and `castleTouchesPlayer` fired it off the
  // raw site list. So the hint both announced that the building is there and
  // said where the war ends, about a castle fog has never shown anybody — the
  // same leak as a rally line drawn into the dark, except that this one is the
  // GAME talking, which reads as authoritative rather than as a guess.
  //
  // It is the ordinary case, not a corner one: `site.adj` means "within
  // MOVEMENT.reachHexes (4)" since free movement, and an ordinary building sees
  // radius 1 — so "the throne is in reach and nobody has looked at it" is most
  // of the approach. (The comment above the function said "borders" until this
  // pass, which is how the drift went unnoticed.)
  const b = battleFor();
  const castle = b.sites.find((s) => s.kind === 'castle');
  assert.ok(castle && castle.owner !== 'player', 'no enemy castle on this board');
  // Put the player on ground the castle counts as in reach, which is what the
  // beat is looking for. Nothing derived is read here, so no recompute is owed.
  const near = b.sites.find((s) => castle.adj.includes(s.id));
  assert.ok(near, 'the castle has nothing in reach — the fixture cannot be built');
  near.owner = 'player';
  assert.equal(siteKnown(b, 'player', castle), false, 'the castle is already scouted');
  assert.equal(castleTouchesPlayer(b), false,
    'the coach pointed at a castle the player has never laid eyes on');

  // ...and the latch is downstream of the same gate, or the beat simply fires on
  // the next poll instead.
  const latch = emptyLatch();
  observeState(latch, b);
  assert.equal(latch.castleAdjacent, false, 'the latch took the reading the gate refused');

  // CONTROL 1 — REMEMBERED. The same board with the throne in `state.seen` must
  // fire, or every assertion above is satisfied by a beat that never fires at
  // all, which is a mute tutorial rather than a fogged one.
  b.seen.player[castle.id] = 'enemy';
  assert.equal(castleTouchesPlayer(b), true, 'a castle the player HAS scouted stopped firing');

  // CONTROL 2 — IN SIGHT RIGHT NOW, through `vision` rather than through memory.
  // `siteKnown` has two independent limbs and one of them working is no evidence
  // about the other.
  delete b.seen.player[castle.id];
  b.vision.player[`${castle.hex[0]},${castle.hex[1]}`] = 1;
  assert.equal(castleTouchesPlayer(b), true, 'a castle in plain sight did not fire');
});
