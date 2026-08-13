// OWNERSHIP'S SECOND CHANNEL.
//
// Player-green against enemy-red measures dE 1.8 at 1.03:1 under protanopia —
// one continuous field of ground, on the surface the whole game is read from.
// Colour was the only ownership cue in the game until the outline gained a dash
// pattern per owner (render/ownerDash.js).
//
// The reason this file exists rather than a screenshot: a dash is invisible to
// every test this project already has, and the failure mode is silent. A stroke
// that forgets to set the pattern, or forgets to RESTORE it, still draws a
// perfectly plausible board — one where ownership is either single-channel
// again or where every site after the first inherits somebody else's dash.
import test from 'node:test';
import assert from 'node:assert/strict';

import { ownerDash } from '../src/render/ownerDash.js';
import { drawSiteBase } from '../src/render/siteGlyphs.js';
import { drawFlood, makeOwnerHatches } from '../src/render/hexRenderer.js';
import { derive, FALLBACK } from '../src/render/palette.js';

const P = derive(FALLBACK);

/** A canvas stub that records the dash pattern in force at each stroke. */
function recorder() {
  const strokes = [];
  let dash = [];
  const noop = () => {};
  return {
    strokes,
    ctx: {
      beginPath: noop,
      moveTo: noop,
      lineTo: noop,
      arc: noop,
      quadraticCurveTo: noop,
      bezierCurveTo: noop,
      closePath: noop,
      fill: noop,
      save: noop,
      restore: noop,
      translate: noop,
      rotate: noop,
      scale: noop,
      fillRect: noop,
      fillText: noop,
      measureText: () => ({ width: 10 }),
      setLineDash: (d) => { dash = [...d]; },
      getLineDash: () => dash,
      stroke: () => strokes.push([...dash]),
      set fillStyle(_v) {}, get fillStyle() { return ''; },
      set strokeStyle(_v) {}, get strokeStyle() { return ''; },
      set lineWidth(_v) {}, get lineWidth() { return 1; },
      set lineJoin(_v) {}, get lineJoin() { return ''; },
      set lineCap(_v) {}, get lineCap() { return ''; },
      set font(_v) {}, get font() { return ''; },
      set textAlign(_v) {}, get textAlign() { return ''; },
      set textBaseline(_v) {}, get textBaseline() { return ''; },
      set globalAlpha(_v) {}, get globalAlpha() { return 1; },
    },
  };
}

const site = (owner) => ({
  id: 's', kind: 'farm', hex: [3, 3], owner, level: 1,
  garrison: {}, hp: 100, hpMax: 100, upgradeTicksLeft: 0,
});

test('ownerDash: the three owners get three DIFFERENT patterns', () => {
  const lw = 2;
  const player = [...ownerDash('player', lw)];
  const enemy = [...ownerDash('enemy', lw)];
  const neutral = [...ownerDash('neutral', lw)];

  assert.deepEqual(player, [], 'your own ground is solid — the quietest to read');
  assert.ok(enemy.length > 0, 'enemy ground must not be solid');
  assert.ok(neutral.length > 0, 'unowned ground must not be solid');
  assert.notDeepEqual(enemy, neutral,
    'enemy and neutral share a pattern — that is two owners on one channel again');
});

test('ownerDash: a fogged ghost reads as unowned, not as the player', () => {
  // battle/vision.js `perceivedSite` gives a never-scouted site `owner: null`.
  // Falling through to the solid pattern would paint unknown ground as YOURS,
  // which is worse than no channel at all.
  const lw = 2;
  assert.deepEqual([...ownerDash(null, lw)], [...ownerDash('neutral', lw)],
    '"nobody\'s, as far as you know" is one statement, not two');
  assert.notDeepEqual([...ownerDash(null, lw)], [...ownerDash('player', lw)]);
});

test('ownerDash: the pattern scales with stroke width, so zoom cannot flatten it', () => {
  // A fixed pixel dash resolves into a solid line as the camera pulls out —
  // silently removing the channel at exactly the moment the board is hardest
  // to read.
  const thin = [...ownerDash('enemy', 1)];
  const thick = [...ownerDash('enemy', 4)];
  assert.ok(thick[0] > thin[0] && thick[1] > thin[1],
    `pattern did not scale with line width: ${thin} vs ${thick}`);
});

test('ownerDash: drawSiteBase strokes with the owner pattern AND restores it', () => {
  // The end-to-end claim, through the real draw path. Two failures are possible
  // and only one of them is obvious: never setting the dash (single channel
  // again), and never clearing it (every site drawn afterwards inherits it).
  for (const owner of ['player', 'enemy', 'neutral']) {
    const r = recorder();
    drawSiteBase(r.ctx, site(owner), 100, 100, 12, P, 1);
    assert.ok(r.strokes.length > 0, `${owner}: nothing stroked at all`);
    const want = [...ownerDash(owner, 1)].length > 0;
    const used = r.strokes.some((d) => d.length > 0);
    assert.equal(used, want,
      `${owner}: expected a ${want ? 'dashed' : 'solid'} outline, strokes were `
      + JSON.stringify(r.strokes));
    assert.deepEqual(r.ctx.getLineDash(), [],
      `${owner}: the dash was left on the context — every site drawn after this `
      + 'one would inherit it');
  }
});

// ---------------------------------------------------------------------------
// ...AND THE OTHER HALF: the territory flood, which is most of what the board
// actually IS
// ---------------------------------------------------------------------------
//
// `ownerDash` above fixed the site OUTLINE. A site is a 20px glyph; the flood
// is every hex on the map, so it is the surface the dE 1.8 measurement was
// really about. `hexRenderer.js drawFlood` now lays a stripe pattern over each
// faction's fill, leaning opposite ways, so ownership survives greyscale and
// every colour-vision deficiency.
//
// Same reason this is a test rather than a screenshot: the failure is SILENT.
// A weave that is built with the same lean for both factions, or that is drawn
// for neutral too, or that never gets fetched because the key does not match
// `CODE_KEY`, all still render a perfectly plausible board — one where the
// second channel is quietly absent again.

test('drawFlood: each faction gets its OWN weave, and nobody else does', () => {
  const fills = [];
  const ctx = {
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    fill() { fills.push(this.fillStyle); },
    fillStyle: null,
  };
  // Two hexes of each owner plus one contested, on a grid big enough to index.
  // 1 = PLAYER, 2 = ENEMY, 3 = NEUTRAL, 4 = CONTESTED (hexGeom.js codes).
  const owners = new Uint8Array(12);
  owners[0] = 1; owners[1] = 1;
  owners[2] = 2; owners[3] = 2;
  owners[4] = 3;
  owners[5] = 4;
  const weave = { player: { id: 'WEAVE-UP' }, enemy: { id: 'WEAVE-DOWN' } };
  drawFlood(ctx, {
    cols: 4, rows: 3, size: 10, owners, palette: P, hatch: null, zoom: 1,
    ownerHatch: weave,
  });

  assert.ok(fills.includes(weave.player), 'the player\'s ground got no weave');
  assert.ok(fills.includes(weave.enemy), 'the enemy\'s ground got no weave');
  assert.notEqual(weave.player, weave.enemy,
    'fixture: the two patterns must be distinguishable or this proves nothing');

  // ONE fill per faction, not one per hex — the batching every other pass in
  // this file holds itself to, and the reason the flood is affordable at all.
  assert.equal(fills.filter((f) => f === weave.player).length, 1);
  assert.equal(fills.filter((f) => f === weave.enemy).length, 1);
});

test('drawFlood: neutral ground is never woven, and a missing weave is a no-op', () => {
  const fills = [];
  const ctx = {
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    fill() { fills.push(this.fillStyle); },
    fillStyle: null,
  };
  const owners = new Uint8Array(12);
  owners[0] = 3; owners[1] = 3;   // neutral only
  const weave = { player: { id: 'UP' }, enemy: { id: 'DOWN' }, neutral: { id: 'NOPE' } };
  drawFlood(ctx, {
    cols: 4, rows: 3, size: 10, owners, palette: P, hatch: null, zoom: 1,
    ownerHatch: weave,
  });
  // "Nobody's" is the ABSENCE of a claim. Texturing it would make unclaimed
  // ground read as a third faction, which is the opposite of what the second
  // channel is for — so the key is deliberately not built, and a stray one
  // handed in here must still not be drawn.
  assert.equal(fills.includes(weave.neutral), false,
    'unclaimed ground was given a texture — it now looks like a third side');

  // NEGATIVE CONTROL, and it is what every headless fixture in this repo
  // relies on: `makeOwnerHatch` returns null without a `document`, so the
  // whole feature has to be inert rather than throwing when it is absent.
  const before = fills.length;
  drawFlood(ctx, {
    cols: 4, rows: 3, size: 10, owners, palette: P, hatch: null, zoom: 1,
  });
  assert.ok(fills.length > before, 'sanity: the flood itself still drew');
});

test('makeOwnerHatches keys by CODE_KEY and leans the two factions apart', () => {
  // Headless: `makeOwnerHatch` needs a document, so both come back null. What
  // is worth pinning without one is the SHAPE — the keys have to be exactly
  // the strings `drawFlood` looks up, or the weave silently never appears.
  const made = makeOwnerHatches({ createPattern: () => ({}) }, P);
  assert.deepEqual(Object.keys(made).sort(), ['enemy', 'player'],
    'the weave map must be keyed by CODE_KEY names, and must not include neutral');
  assert.ok(P.weave, 'the palette must carry a weave colour for these to use');
});
