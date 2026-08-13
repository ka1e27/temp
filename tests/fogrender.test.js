// FOG ON THE BOARD: what the canvas draws once it may not assume everything
// is visible.
//
// battle/vision.js's own contract (perceivedSite/perceivedSquads) is taken as
// given — this file pins that the RENDERER actually threads it through: the
// drawn flood the background paints (render/fog.js), and the draw lists the
// per-frame canvas iterates (render/routes.js, render/rallyLines.js).
//
// Every claim carries its own NEGATIVE CONTROL — the fogged path must hide
// the thing AND the unfogged path must still show it — because a fixture
// that is silently empty passes a "must hide X" assertion for free and
// proves nothing. CLAUDE.md already has two features that shipped inert
// behind a green suite for exactly that reason.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createBattleState } from '../src/battle/state.js';
import { recomputeInfluence } from '../src/battle/influence.js';
import { perceivedSite, perceivedSquads } from '../src/battle/vision.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { emptyComp } from '../src/battle/combat.js';
import { hexIndex } from '../src/render/hexRenderer.js';
import {
  perceivedInfluence, computeVeil, drawVeil, GHOST_ALPHA,
} from '../src/render/fog.js';
import { drawSiteBase, builtLevel } from '../src/render/siteGlyphs.js';
import { siteRadius } from '../src/render/siteShapes.js';
import { drawSquads, drawSquadRoutes, drawSquadLabels } from '../src/render/routes.js';
import { drawRallies } from '../src/render/rallyLines.js';
import { derive, FALLBACK } from '../src/render/palette.js';

const P = derive(FALLBACK);

// ---------------------------------------------------------------------------
// A hand-placed board, distances chosen so the real influence/vision maths
// (content/balance.js INFLUENCE_RADIUS/VISION_RADIUS) resolve unambiguously:
//
//   camp [0,0]        player, INFLUENCE 3 / VISION 1
//   watchtower [5,0]  player, INFLUENCE 1 / VISION 4 — sees the farm, not the castle
//   farm [8,0]        enemy,  distance 3 from the tower (seen), 8 from the camp
//   castle [15,0]     enemy,  distance 10 from the tower, 15 from the camp — never seen
// ---------------------------------------------------------------------------
function fixture() {
  const s = createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: 'fog-render',
    seed: 1,
    grid: { cols: 17, rows: 5, blocked: [] },
    sites: [
      { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 4 } },
      { id: 'tower', kind: 'watchtower', hex: [5, 0], owner: 'player', garrison: {} },
      { id: 'farm', kind: 'farm', hex: [8, 0], owner: 'enemy', garrison: { militia: 6 } },
      { id: 'castle', kind: 'castle', hex: [15, 0], owner: 'enemy', garrison: { militia: 40 } },
    ],
    player: makeMods({ expedition: emptyComp() }),
    enemy: makeMods({ expedition: emptyComp() }),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 480000, aiTier: 1 },
  });
  // createBattleState populates occupancy/vision but not influence (that is
  // startBattle's extra step, in sim.js) — added here so state.influence is
  // the real thing perceivedInfluence is measured against.
  recomputeInfluence(s);
  return s;
}

const at = (s, id) => s.sites.find((x) => x.id === id);
const hexPos = (q, r, out) => { out.x = q * 40; out.y = r * 40; return out; };
const sitePos = (site, out) => hexPos(site.hex[0], site.hex[1], out);

/** Records only whether anything was actually painted — fill/stroke/text —
 *  which is all these claims need. Same shape as the recorders in
 *  sitegilding.test.js and buildbar.test.js, trimmed to this file's use. */
function recorder() {
  const ops = [];
  return {
    ops,
    fillStyle: '', strokeStyle: '', lineWidth: 0, lineJoin: '', lineCap: '',
    globalAlpha: 1, font: '', textAlign: '', textBaseline: '', lineDashOffset: 0,
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, quadraticCurveTo() {},
    arc() {}, setLineDash() {}, rect() {}, save() {}, restore() {},
    fill() { ops.push('fill'); },
    stroke() { ops.push('stroke'); },
    fillRect() { ops.push('fillRect'); },
    fillText() { ops.push('fillText'); },
  };
}

// ---------------------------------------------------------------------------
// The drawn flood
// ---------------------------------------------------------------------------

test('perceivedInfluence hides an unscouted site\'s ground, and keeps a scouted one\'s', () => {
  const s = fixture();
  // The REAL flood paints both — the sim needs the true front line regardless
  // of who has looked at it.
  assert.equal(s.influence['15,0'], 'enemy', 'sanity: the real flood reaches the castle');
  assert.equal(s.influence['8,0'], 'enemy', 'sanity: the real flood reaches the farm');

  const seen = perceivedInfluence(s, 'player');
  // NEGATIVE CONTROL: the farm sits inside the watchtower's sight, so it is
  // NOT a ghost — the perceived flood must still show it, or this would only
  // prove the function returns {} for everything.
  assert.equal(seen['8,0'], 'enemy', 'a scouted site must still paint');
  // The castle has never been inside anyone's sight: state.seen.player has no
  // entry for it, perceivedSite hands back owner:null, and recomputeInfluence
  // already skips any owner that is not player/enemy/neutral — so the ground
  // nobody has scouted simply never gets a field entry.
  assert.equal(seen['15,0'], undefined, 'unscouted ground must not paint as enemy');
  // Also true one hex further out, at the castle's own claimed radius.
  assert.equal(seen['14,0'], undefined);

  // The REAL flood must be untouched — the whole point is a SEPARATE view.
  assert.equal(s.influence['15,0'], 'enemy', 'state.influence must not have been mutated');
});

test('perceivedInfluence matches state.influence exactly once nothing is fogged', () => {
  const s = fixture();
  // Strip the unscouted castle so every remaining site is either owned or
  // already inside someone's sight — a state with nothing left to fog.
  s.sites = s.sites.filter((x) => x.id !== 'castle');
  recomputeInfluence(s);
  const seen = perceivedInfluence(s, 'player');
  assert.deepEqual(seen, s.influence);
  // Sanity the fixture is not vacuous: the flood is not empty.
  assert.ok(Object.keys(seen).length > 0);
});

test('computeVeil marks every hex outside sight, and none inside it', () => {
  const s = fixture();
  const { cols, rows } = s.grid;
  const veil = computeVeil(s, 'player', cols, rows);
  assert.equal(veil[hexIndex(0, 0, cols, rows)], 0, 'the camp\'s own hex is owned, never veiled');
  assert.equal(veil[hexIndex(8, 0, cols, rows)], 0, 'inside the watchtower\'s sight');
  // NEGATIVE CONTROL: the castle is the one hex never inside anyone's sight —
  // proving the buffer is not simply all-clear.
  assert.equal(veil[hexIndex(15, 0, cols, rows)], 1, 'never scouted, must be veiled');
});

test('drawVeil paints only the fogged hexes, and paints nothing when none are', () => {
  const s = fixture();
  const { cols, rows } = s.grid;
  const veil = computeVeil(s, 'player', cols, rows);
  const ctx = recorder();
  drawVeil(ctx, veil, cols, rows, 34, P);
  assert.ok(ctx.ops.includes('fill'), 'the castle\'s ground must be veiled');

  const clear = new Uint8Array(cols * rows); // NEGATIVE CONTROL: nothing fogged
  const ctx2 = recorder();
  drawVeil(ctx2, clear, cols, rows, 34, P);
  assert.deepEqual(ctx2.ops, [], 'a fully-scouted board draws no veil at all');
});

// ---------------------------------------------------------------------------
// A ghost site carries no live numbers
// ---------------------------------------------------------------------------

test('perceivedSite: unscouted is a ghost with no live fields, scouted keeps them all', () => {
  const s = fixture();
  const castle = at(s, 'castle');
  const farm = at(s, 'farm');

  const ghost = perceivedSite(s, 'player', castle);
  assert.equal(ghost.ghost, true);
  assert.equal(ghost.owner, null, 'never seen: no last-known owner either');
  assert.equal(ghost.kind, 'castle', 'kind is common knowledge');
  assert.deepEqual(ghost.hex, castle.hex, 'position is common knowledge');
  for (const field of ['garrison', 'hp', 'hpMax', 'siege', 'trainProgress', 'level', 'upgradeTicksLeft']) {
    assert.equal(ghost[field], undefined, `a ghost must not carry ${field}`);
  }

  // NEGATIVE CONTROL: the farm is scouted, so the SAME function on the SAME
  // shape of site returns the real thing, numbers and all — proving the
  // castle was hidden because it is unseen, not because perceivedSite always
  // strips a site down to nothing.
  const real = perceivedSite(s, 'player', farm);
  assert.equal(real, farm, 'a visible site is the real object, not a copy');
  assert.equal(real.ghost, undefined);
  assert.ok(real.garrison.militia > 0, 'the visible site keeps its garrison');
  assert.equal(real.hp, farm.hp);
});

test('a ghost draws as a bare level-1 silhouette, never the true storeys', () => {
  const s = fixture();
  const castle = at(s, 'castle');
  castle.level = 3;               // pretend it was upgraded since it was last seen
  castle.upgradeTicksLeft = 0;
  const ghost = perceivedSite(s, 'player', castle);
  assert.equal(builtLevel(ghost), 1, 'level is not remembered, so a ghost always draws at L1');

  const ctxGhost = recorder();
  drawSiteBase(ctxGhost, ghost, 0, 0, siteRadius('castle', 34), P, 1);
  const ctxReal = recorder();
  drawSiteBase(ctxReal, castle, 0, 0, siteRadius('castle', 34), P, 1);
  // NEGATIVE CONTROL: the real L3 castle draws its extra storeys (more fills
  // and strokes); the ghost pinned at L1 must draw fewer — proving the ghost
  // is genuinely simplified, not merely a copy of the same draw.
  assert.ok(ctxGhost.ops.length < ctxReal.ops.length,
    'a remembered L3 castle must not out-draw a bare level-1 silhouette');
  assert.ok(ctxGhost.ops.length > 0, 'sanity: a ghost still draws SOMETHING (its kind)');
});

// ---------------------------------------------------------------------------
// An enemy squad out of vision contributes nothing to any draw list
// ---------------------------------------------------------------------------

/** An enemy column marching from the (scouted) farm to the (unscouted)
 *  castle, ten ticks end to end. */
function withMarchingSquad(s) {
  s.squads.push({
    id: 1, owner: 'enemy', from: 'farm', to: 'castle',
    comp: { ...emptyComp(), militia: 20 }, spawnTick: 0, arriveTick: 10, retreating: false,
    // A squad carries the route it walks. Written out here because the fixture
    // is hand-built; in a real battle spawnSquad fills it from the same A* the
    // travel time is priced by. Farm [8,0] -> castle [15,0], one hex a tick.
    path: Array.from({ length: 8 }, (_, i) => ({ q: 8 + i, r: 0 })),
    camped: false, hex: null,
  });
  return s;
}

test('perceivedSquads: the same column shows at the farm and vanishes at the castle', () => {
  const s = withMarchingSquad(fixture());
  s.tick = 0;
  assert.equal(perceivedSquads(s, 'player').length, 1, 'at the farm, inside the tower\'s sight');
  s.tick = 10;
  assert.equal(perceivedSquads(s, 'player').length, 0, 'at the castle, never scouted, no trace');
});

test('drawSquads/drawSquadRoutes/drawSquadLabels paint nothing for a squad out of vision', () => {
  const s = withMarchingSquad(fixture());
  s.tick = 10; // standing at the unscouted castle
  const g = { pos: sitePos, hexPos, byId: (id) => at(s, id), hexSize: 34, palette: P };

  // NEGATIVE CONTROL: fed the raw, UNfiltered list (what these functions used
  // to receive), the same squad draws — proving the fogged call is quiet
  // because it was filtered, not because nothing here ever draws anything.
  const rawSquads = recorder();
  drawSquads(rawSquads, s.squads, s.tick, 1, g);
  assert.ok(rawSquads.ops.length > 0, 'sanity: the unfiltered list really draws the column');
  const rawRoutes = recorder();
  drawSquadRoutes(rawRoutes, s.squads, 1, g);
  assert.ok(rawRoutes.ops.length > 0, 'sanity: the unfiltered list really draws the route');
  const rawLabels = recorder();
  drawSquadLabels(rawLabels, s.squads, s.tick, 1, g, 'enemy');
  assert.ok(rawLabels.ops.length > 0, 'sanity: a 20-strong column is over the label threshold');

  const seen = perceivedSquads(s, 'player');
  const foggedSquads = recorder();
  drawSquads(foggedSquads, seen, s.tick, 1, g);
  assert.deepEqual(foggedSquads.ops, [], 'fogged: the column must draw nothing at all');
  const foggedRoutes = recorder();
  drawSquadRoutes(foggedRoutes, seen, 1, g);
  assert.deepEqual(foggedRoutes.ops, [], 'fogged: no route line either');
  const foggedLabels = recorder();
  drawSquadLabels(foggedLabels, seen, s.tick, 1, g, 'enemy');
  assert.deepEqual(foggedLabels.ops, [], 'fogged: no head-count label either');
});

test('drawRallies hides an unscouted site\'s rally line, and keeps a scouted one\'s', () => {
  const sHidden = fixture();
  at(sHidden, 'castle').rallyTargets = ['farm']; // the ghost's own standing order
  const gHidden = { pos: sitePos, byId: (id) => at(sHidden, id), palette: P, hexSize: 34 };
  const hidden = recorder();
  drawRallies(hidden, sHidden, 'player', 1, gHidden);
  assert.deepEqual(hidden.ops, [], 'an unscouted site\'s rally line must not draw');

  // NEGATIVE CONTROL: the SAME shape of order on the SCOUTED farm instead —
  // proving drawRallies can draw an enemy rally line at all, and that the
  // castle's was hidden for being unseen, not because nothing here ever
  // draws one.
  const sShown = fixture();
  at(sShown, 'farm').rallyTargets = ['castle'];
  const gShown = { pos: sitePos, byId: (id) => at(sShown, id), palette: P, hexSize: 34 };
  const shown = recorder();
  drawRallies(shown, sShown, 'player', 1, gShown);
  assert.ok(shown.ops.includes('stroke'), 'a scouted site\'s rally line must still draw');
});
