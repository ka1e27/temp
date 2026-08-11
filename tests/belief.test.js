// THE AI'S (AND THE HARNESS BOT'S) BELIEF — battle/belief.js.
//
// vision.test.js already pins that a raw ghost from battle/vision.js carries
// NOTHING that changes (no garrison, no hp, no level, no siege). This file is
// about the layer built on top of that: a DECISION-MAKER cannot do arithmetic
// on a ghost's missing garrison without crashing, so `beliefFor` fills those
// fields back in with a presumed, public-knowledge number. Every claim below
// is paired with a control that would fail if the rule it pins were deleted
// — the recurring failure mode here is a fixture that quietly encodes the bug.
import test from 'node:test';
import assert from 'node:assert/strict';

import { beliefFor, PRESUMED_GARRISON_FRAC } from '../src/battle/belief.js';
import { createBattleState } from '../src/battle/state.js';
import { think } from '../src/battle/ai.js';
import { step } from '../src/battle/sim.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { emptyComp, total, siteMaxHp } from '../src/battle/combat.js';
import { SITES } from '../src/content/balance.js';
import { startRun, playerTurn } from '../tools/simplayer.js';
import { REGION_IDS, REGIONS } from '../src/content/regions.data.js';

const before = (id) => REGION_IDS.slice(0, REGIONS.findIndex((r) => r.id === id));

/**
 * A wide, empty board so ordinary VISION_RADIUS (1) never reaches across it by
 * accident — everything is dark unless a fixture deliberately puts two sites
 * next to each other.
 */
function board(sites, o = {}) {
  return createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: 'belief-test',
    seed: 3,
    grid: { cols: 41, rows: 5, blocked: [] },
    sites,
    player: makeMods({ expedition: emptyComp(), startGold: 0 }),
    enemy: makeMods({ expedition: emptyComp(), startGold: 0 }),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 600000, aiTier: o.tier ?? 1 },
  });
}

const at = (b, id) => b.sites.find((s) => s.id === id);
const believed = (b, faction, id) => beliefFor(b, faction).sites.find((s) => s.id === id);

// ---------------------------------------------------------------------------
// Unseen differs from truth; visible matches truth exactly
// ---------------------------------------------------------------------------

test('belief: an unseen enemy site is reasoned about with FINITE, presumed numbers, not the truth', () => {
  const b = board([
    { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 10 } },
    // Far enough that nothing at VISION_RADIUS 1 reaches it — never seen by
    // the player, at any tick, from tick 0.
    {
      id: 'es', kind: 'stronghold', hex: [20, 0], owner: 'enemy',
      garrison: { spearmen: 24, militia: 6 }, hp: 140, level: 3,
    },
    { id: 'castle', kind: 'castle', hex: [25, 0], owner: 'enemy', garrison: { militia: 8 } },
  ]);
  const real = at(b, 'es');
  assert.equal(total(real.garrison), 30, 'the fixture must actually hold a real, non-trivial garrison');

  const ghost = believed(b, 'player', 'es');
  assert.equal(ghost.ghost, true, 'this must actually be exercising the fogged branch');

  // COMMON KNOWLEDGE survives untouched — decision 9. frontDistance-style
  // whole-map geometry reads exactly these three fields off every site.
  assert.deepEqual(ghost.hex, real.hex);
  assert.equal(ghost.kind, real.kind);
  assert.deepEqual(ghost.adj, real.adj);

  // THE LIVE HALF IS PRESUMED, NOT THE TRUTH, and never undefined — the NaN/
  // TypeError hazard this file exists to close.
  assert.notEqual(total(ghost.garrison), total(real.garrison),
    'the ghost read the true garrison straight through — fog is not applying');
  assert.equal(total(ghost.garrison), Math.max(1, Math.round(SITES.stronghold.cap * PRESUMED_GARRISON_FRAC)),
    'the presumption must be the documented share of the kind\'s cap, not an arbitrary number');
  assert.ok(total(ghost.garrison) > 0, '(a) presumes SOME typical holding — (b) presumes empty, and this is not (b)');
  assert.equal(ghost.level, 1, 'level is fogged too — an unseen wall is reasoned about as a fresh one');
  assert.notEqual(ghost.level, real.level);
  assert.equal(ghost.hp, siteMaxHp('stronghold', 1), 'hp presumes full health at the PRESUMED level');
  assert.notEqual(ghost.hp, real.hp);
  assert.equal(ghost.siege, null);
  assert.equal(ghost.upgradeTicksLeft, 0);

  // NEGATIVE CONTROL: nothing here crashes the arithmetic every scoring
  // function in ai.js/aicore.js actually runs.
  assert.doesNotThrow(() => total(ghost.garrison) + ghost.hp + ghost.level);
});

test('belief: a VISIBLE site is the real object, every field intact', () => {
  const b = board([
    { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 10 } },
    // Adjacent to the camp now, so VISION_RADIUS 1 covers it from tick 0.
    {
      id: 'es', kind: 'stronghold', hex: [1, 0], owner: 'enemy',
      garrison: { spearmen: 24, militia: 6 }, hp: 140, level: 3,
    },
    { id: 'castle', kind: 'castle', hex: [25, 0], owner: 'enemy', garrison: { militia: 8 } },
  ]);
  const real = at(b, 'es');
  const seen = believed(b, 'player', 'es');
  assert.equal(seen, real, 'a visible site must be the SAME object, not a copy');
  assert.equal(seen.ghost, undefined);
  assert.equal(total(seen.garrison), 30);
  assert.equal(seen.hp, 140);
  assert.equal(seen.level, 3);
});

// ---------------------------------------------------------------------------
// A throne's allegiance is common knowledge — the ownership half only,
// never the garrison half
// ---------------------------------------------------------------------------

test('belief: the enemy castle is known to be the enemy\'s from tick 0, sight unseen', () => {
  const b = board([
    { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 10 } },
    // Thirty hexes from the camp — nothing at VISION_RADIUS 1 reaches it, so
    // this is exercising the SAME never-scouted-ghost branch every other test
    // in this file does, not some other path.
    {
      id: 'castle', kind: 'castle', hex: [30, 0], owner: 'enemy',
      garrison: { spearmen: 24, militia: 6 }, hp: 400, level: 3,
    },
  ]);
  const real = at(b, 'castle');
  const ghost = believed(b, 'player', 'castle');
  assert.equal(ghost.ghost, true, 'this must actually be exercising the never-scouted branch');

  // THE POSITIVE HALF: unlike an ordinary site (previous section), owner is
  // the TRUE current owner, not `state.seen[...] ?? null`. Without this, a
  // target scan filtering on `site.owner === FOE` never finds the castle at
  // all — measured: gallowmoor seed 8919, 1,741 player sends in a whole
  // battle and zero of them at the castle.
  assert.equal(ghost.owner, 'enemy');
  assert.equal(ghost.owner, real.owner);

  // THE NEGATIVE CONTROL, and the reason this is two assertions and not one:
  // "the AI can see the throne" would also make this pass if it crept in by
  // accident. Garrison, HP and level stay exactly as presumed as any other
  // ghost — you know whose flag flies over the castle, not what stands
  // behind the door.
  assert.notEqual(total(ghost.garrison), total(real.garrison),
    'the garrison must stay a presumption — knowing the OWNER is not knowing the ARMY');
  assert.equal(total(ghost.garrison), Math.max(1, Math.round(SITES.castle.cap * PRESUMED_GARRISON_FRAC)));
  assert.equal(ghost.level, 1);
  assert.notEqual(ghost.level, real.level);
  assert.equal(ghost.hp, siteMaxHp('castle', 1));
  assert.notEqual(ghost.hp, real.hp);
});

test('belief: the MIRROR case — the player\'s camp is known to be the player\'s, from the enemy\'s side', () => {
  // Same shape, viewed from the other faction, because `THRONE_KINDS` has to
  // work for whichever faction is asking: the enemy AI has to be able to
  // TARGET the player's camp exactly as the harness bot has to target the
  // enemy's castle, or the fix only helps one direction of the same battle.
  const b = board([
    // Total 30, deliberately NOT the presumed 16 (round(SITES.camp.cap * 0.20))
    // — a coincidental match here would make the negative control pass for
    // the wrong reason.
    { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { spearmen: 20, militia: 10 } },
    { id: 'castle', kind: 'castle', hex: [30, 0], owner: 'enemy', garrison: { militia: 8 } },
  ]);
  const real = at(b, 'camp');
  const ghost = believed(b, 'enemy', 'camp');
  assert.equal(ghost.ghost, true);
  assert.equal(ghost.owner, 'player');
  assert.equal(ghost.owner, real.owner);
  assert.notEqual(total(ghost.garrison), total(real.garrison),
    'the mirror case must keep the garrison presumption too, not just the ownership fix');
});

// ---------------------------------------------------------------------------
// Your own active siege is your own operation, not intelligence about theirs
// ---------------------------------------------------------------------------

test('belief: a site under the VIEWER\'S OWN siege stays real, however far from a building', () => {
  const b = board([
    { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 10 } },
    { id: 'castle', kind: 'castle', hex: [25, 0], owner: 'enemy', garrison: { militia: 8 } },
    // Neutral, far from every building on the map. createBattleState always
    // initializes `siege: null` regardless of what a config supplies (a siege
    // is something the SIM establishes, not something a battle starts with),
    // so the siege the player is grinding it down with is set directly on the
    // live state below, exactly the way tests/sim.test.js does it.
    { id: 'spoil', kind: 'farm', hex: [12, 0], owner: 'neutral', garrison: {} },
  ]);
  const real = at(b, 'spoil');
  // Currently being ground down by the PLAYER — an operation with no building
  // anywhere near it to grant vision the ordinary way.
  real.siege = { owner: 'player', comp: { militia: 20 } };
  real.hp = 30;

  const mine = believed(b, 'player', 'spoil');
  assert.equal(mine, real, 'the besieger must see its own siege as it truly is, not a ghost');
  assert.equal(mine.hp, 30);
  assert.equal(total(mine.siege.comp), 20);

  // NEGATIVE CONTROL, same fixture: the OTHER faction has no operation here
  // and no building nearby either, so it gets the ordinary ghost — this is
  // what proves the rule above is the SIEGE exception and not "neutral sites
  // are always real".
  const theirs = believed(b, 'enemy', 'spoil');
  assert.equal(theirs.ghost, true, 'the enemy has no building and no siege here — this must be fogged');
  assert.equal(theirs.siege, null,
    'an opponent\'s siege in progress leaked through to a faction with no way to know about it');
});

// ---------------------------------------------------------------------------
// learnedPlayerComp is deliberately NOT fogged (fog-design.md decision 11)
// ---------------------------------------------------------------------------

test('belief: learnedPlayerComp reads the TRUE army, not the belief view — positive control', () => {
  // Every player site is far outside every enemy building's VISION_RADIUS, so
  // a belief-filtered read of the player would see nothing but militia ghosts
  // (believedGhost's presumption is ALWAYS militia — see belief.js). The
  // player's real garrison here is pure SPEARMEN, a unit the presumption can
  // never produce, so any spearmen at all in the sample proves adapt() read
  // the truth rather than the fogged view.
  const b = board([
    { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { spearmen: 50 } },
    { id: 'castle', kind: 'castle', hex: [30, 0], owner: 'enemy', garrison: { militia: 8 } },
  ], { tier: 1 });
  think(b);
  assert.ok(total(b.ai.learnedPlayerComp) > 0, 'it must have sampled something at all');
  assert.ok(b.ai.learnedPlayerComp.spearmen > 0,
    'the sample has zero spearmen — adapt() is reading the fogged view instead of the truth');
});

// ---------------------------------------------------------------------------
// The silent-failure mode: a blinded AI must still act
// ---------------------------------------------------------------------------

test('belief: the enemy AI still emits SEND orders once blinded, on a real region', () => {
  // This project's own warning, verbatim: an AI that emits ZERO orders passes
  // every existing test. Played on a real generated map (not a fixture), with
  // fog on by default (no opts at all) — counted straight off state.commands,
  // the exact queue think() pushes onto, rather than an outcome event that
  // could go quiet for a reason that has nothing to do with the AI at all.
  for (const id of ['gallowmoor', 'karrowmere', 'obsidian']) {
    const battle = startRun(id, 4242, before(id), 10);
    let sends = 0;
    let nextThink = 0;
    while (battle.status === 'running' && battle.tick < 3600) {
      if (battle.tick >= nextThink) { playerTurn(battle); nextThink = battle.tick + 20; }
      step(battle);
      sends += battle.commands.filter((c) => c.t === 'SEND' && c.by === 'enemy').length;
    }
    assert.ok(sends > 0, `${id}: the blinded enemy never issued a single SEND order in a whole battle`);
  }
});

test('belief: a fully-sighted battle (state.ai.sighted) is unaffected by any of the above', () => {
  // The measurement escape hatch itself, pinned: with it set, the AI's view
  // IS state, so a site's believed data is the real data, unconditionally.
  const b = board([
    { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 10 } },
    {
      id: 'es', kind: 'stronghold', hex: [20, 0], owner: 'enemy',
      garrison: { spearmen: 24, militia: 6 }, hp: 140, level: 3,
    },
    { id: 'castle', kind: 'castle', hex: [25, 0], owner: 'enemy', garrison: { militia: 8 } },
  ]);
  b.ai.sighted = true;
  think(b);
  // Nothing in state.sites should have been replaced or mutated — sighted
  // think() reads `state` directly rather than a belief view at all.
  assert.equal(at(b, 'es').hp, 140);
  assert.equal(total(at(b, 'es').garrison), 30);
});
