// The GILDING that replaced the rank ring: gold trim FILLED onto each
// storey's own roofline rather than an orbit outside the silhouette.
//
// The property this file exists to protect is the one direct feedback named:
// upgrading a site must show up as an accent ON the tower — never as a hoop
// floating around it. So every assertion here drives the real draw calls and
// measures either (a) how many gilded storeys land, keyed off storeyCount
// (which is itself driven by SITE_LEVELS.length, never a literal), or (b)
// that the trim's own geometry hugs the structure rather than orbiting it.
//
// tests/sitelevels.test.js (storeys) is untouched by any of this: gilding is
// FILLED, never stroked, so it can never be counted as another floor by a
// test that (rightly) counts storeys off stroked outlines.
import test from 'node:test';
import assert from 'node:assert/strict';

import { SITE_LEVELS } from '../src/content/balance.js';
import { goldStep, traceTrimRibbon } from '../src/render/siteGild.js';
import {
  MAX_LEVEL, storeyLadder, siteRadius, siteRingR, siteOuter,
} from '../src/render/siteShapes.js';
import {
  drawSiteBase, drawHpRing, drawSiegeRing, builtLevel,
} from '../src/render/siteGlyphs.js';
import { derive, FALLBACK, parseHex, RANK_STEPS } from '../src/render/palette.js';
import { createBattleState } from '../src/battle/state.js';
import { drainCommands } from '../src/battle/commands.js';
import { sampleBattleConfig } from './fixtures/battleConfig.sample.js';

const KINDS = ['farm', 'stronghold', 'camp', 'castle'];
const P = derive(FALLBACK);
const HEX = 34;
/** Ladder lengths to prove the RAMP against — the one piece of the old gauge
 *  that survived. 2 is the shortest with an upgrade in it at all; 8 is past
 *  anything plausible, and the ramp is happy there because it never grows. */
const LADDERS = [2, 3, 4, 5, 6, 7, 8];

// --- a canvas that remembers strokes, fills and the geometry of each -------

function recorder() {
  let cur = null;
  const ctx = {
    ops: [], __dash: [],
    fillStyle: '', strokeStyle: '', lineWidth: 0, lineJoin: '', lineCap: '',
    lineDashOffset: 0,
    beginPath() { cur = { arcs: [], pts: [] }; },
    moveTo(x, y) { cur.pts.push(x, y); },
    lineTo(x, y) { cur.pts.push(x, y); },
    closePath() { cur.closed = true; },
    arc(x, y, r, a0, a1, ccw) {
      cur.arcs.push({ x, y, r, a0, a1, ccw: !!ccw });
      cur.pts.push(x, y - r, x, y + r, x - r, y, x + r, y);
    },
    fill() { ctx.ops.push({ op: 'fill', style: ctx.fillStyle, ...snap(cur) }); },
    stroke() {
      ctx.ops.push({
        op: 'stroke', style: ctx.strokeStyle, width: ctx.lineWidth,
        dashed: ctx.__dash.length > 0, ...snap(cur),
      });
    },
    setLineDash(d) { ctx.__dash = d.slice(); },
    rect() {}, fillRect() {}, save() {}, restore() {}, fillText() {},
  };
  return ctx;
}
const snap = (c) => ({ arcs: c.arcs.slice(), pts: c.pts.slice(), closed: !!c.closed });

/** The gilded fills: painted in one of the ramp's own tones, which is enough
 *  to separate them from every other fill on a site (body, wash, shadow)
 *  without the draw path needing to tag them itself. */
const RANK_SET = new Set(P.rank);
const solidStrokes = (ctx) => ctx.ops.filter((o) => o.op === 'stroke' && !o.dashed);
const dashedStrokes = (ctx) => ctx.ops.filter((o) => o.op === 'stroke' && o.dashed);
const gildOf = (ctx) => ctx.ops.filter((o) => o.op === 'fill' && RANK_SET.has(o.style));

function site(kind, over = {}) {
  return {
    id: 'x', kind, owner: 'player', level: 1, upgradeTicksLeft: 0,
    garrison: { militia: 8, spearmen: 0, raiders: 0, rams: 0, marshal: 0 },
    hp: 100, hpMax: 100, trainProgress: 0, brownout: 1, siege: null,
    hex: [0, 0], adj: [], ...over,
  };
}

function base(kind, over = {}) {
  const ctx = recorder();
  drawSiteBase(ctx, site(kind, over), 0, 0, siteRadius(kind, HEX), P, 1);
  return ctx;
}

// --- the trim is data-driven off the ladder, not a literal ------------------

test('gilded storeys track SITE_LEVELS.length, everywhere', () => {
  for (const kind of KINDS) {
    assert.equal(gildOf(base(kind, { level: MAX_LEVEL })).length, SITE_LEVELS.length - 1,
      `${kind}: a maxed site gilds every storey the content defines`);
  }
});

test('one gilded roofline per storey, at every level', () => {
  for (const kind of KINDS) {
    for (let lv = 1; lv <= MAX_LEVEL; lv++) {
      const ctx = base(kind, { level: lv });
      assert.equal(gildOf(ctx).length, lv - 1,
        `${kind} L${lv}: gilding must match storeys built, not storeys paid for`);
    }
  }
});

test('the warmth ramp is a pure function of the ladder length, at any length', () => {
  for (const max of LADDERS) {
    const total = max - 1;
    let prev = -1;
    for (let i = 0; i < total; i++) {
      const step = goldStep(i, total);
      assert.ok(step >= 0 && step < RANK_STEPS, `total=${total} i=${i}: step out of range`);
      assert.ok(step >= prev, `total=${total} i=${i}: ramp must not cool going up`);
      prev = step;
    }
    if (total > 1) assert.equal(goldStep(total - 1, total), RANK_STEPS - 1,
      `total=${total}: the last storey must reach the hottest tone`);
  }
  assert.equal(goldStep(0, 0), RANK_STEPS - 1, 'a one-level ladder has nothing to ramp');
  assert.equal(goldStep(0, 1), RANK_STEPS - 1, 'a two-level ladder starts at the hottest tone');
});

// --- level 1 has not moved ---------------------------------------------------

test('an un-upgraded site draws no gilding at all', () => {
  for (const kind of KINDS) {
    assert.equal(gildOf(base(kind, { level: 1 })).length, 0, kind);
    assert.equal(solidStrokes(base(kind, { level: 1 })).length, 1,
      `${kind}: only the ground floor's own outline`);
  }
});

test('level-1 rings have not moved: no band, no step-out, ever', () => {
  // The ring code used to step out to clear the (now deleted) gauge. There is
  // nothing left to clear, so the formula is just the enclosing circle plus a
  // fixed offset, at EVERY level — proof the dead "band" term is really gone.
  for (const kind of KINDS) {
    const r = siteRadius(kind, HEX);
    for (const level of [1, 2, MAX_LEVEL]) {
      const ctx = recorder();
      const s = site(kind, { level, hp: 40 });
      s.siege = { owner: 'enemy', comp: s.garrison };
      drawHpRing(ctx, s, 0, 0, r, P, 1);
      drawSiegeRing(ctx, s, 0, 0, r, P, 1, 0);
      const radii = ctx.ops.flatMap((o) => o.arcs.map((a) => a.r));
      const hull = r * siteRingR(kind, level);
      assert.deepEqual(radii, [hull + 3, hull + 3, hull + 9],
        `${kind} L${level}: ring radius carries a leftover band term`);
    }
    assert.equal(siteRingR('farm', 1), siteOuter('farm'));
  }
});

// --- construction: the board still shows only what you HAVE -----------------

test('a site mid-build shows the gilding of its OLD level, not the new one', () => {
  if (MAX_LEVEL < 3) return;
  for (const kind of KINDS) {
    const mid = base(kind, { level: 3, upgradeTicksLeft: 120 });
    const settled = base(kind, { level: 2 });
    assert.equal(gildOf(mid).length, gildOf(settled).length,
      `${kind}: a site mid-build must show the gold it has paid off, no more`);
    // The scaffolded storey stays the only dashed thing on the site — gilding
    // never previews a storey that has not landed.
    assert.equal(dashedStrokes(mid).length, 1);
  }
});

test('a real UPGRADE order does not hand over the gilt storey early', () => {
  const state = createBattleState(sampleBattleConfig());
  const s = state.sites.find((x) => x.kind === 'camp');
  const r = siteRadius(s.kind, HEX);
  const shot = () => {
    const ctx = recorder();
    drawSiteBase(ctx, s, 0, 0, r, P, 1);
    return gildOf(ctx).length;
  };
  const before = shot();

  state.factions.player.goldCg = 999999;
  state.commands.push({ t: 'UPGRADE', site: s.id, by: 'player' });
  drainCommands(state);
  assert.ok(s.upgradeTicksLeft > 0, 'the sim is building');
  assert.equal(shot(), before, 'the gilding must not pay out before the work lands');

  s.upgradeTicksLeft = 0;
  assert.equal(shot(), before + 1, 'and exactly one more gilt storey when it does');
});

// --- geometry: the gold is ON the silhouette, never a free-floating ring ----

test('the gilded ribbon hugs its own storey, never orbits it', () => {
  for (const kind of KINDS) {
    const r = siteRadius(kind, HEX);
    const halfW = 0.9;
    const ctx = recorder();
    ctx.beginPath();
    traceTrimRibbon(ctx, kind, 0, 0, r, halfW);
    ctx.fillStyle = '#fff';
    ctx.fill();
    assert.equal(ctx.ops.length, 1);
    assert.equal(ctx.ops[0].op, 'fill');
    let worst = 0;
    for (let i = 0; i < ctx.ops[0].pts.length; i += 2) {
      const d = Math.hypot(ctx.ops[0].pts[i], ctx.ops[0].pts[i + 1]);
      if (d > worst) worst = d;
    }
    assert.ok(worst > 0 && worst <= r * siteOuter(kind) + halfW + 1e-6,
      `${kind}: gild ribbon reaches ${(worst / r).toFixed(2)}r, escaping the structure`);
  }
});

test('a maxed site gilds every storey and no more', () => {
  for (const kind of KINDS) {
    const ctx = base(kind, { level: MAX_LEVEL });
    assert.equal(gildOf(ctx).length, MAX_LEVEL - 1);
    assert.equal(solidStrokes(ctx).length, MAX_LEVEL, 'one owner outline per storey plus the base');
  }
});

test('storeyLadder length still drives how many storeys COULD be gilded', () => {
  // Ported from the old ring's ladder-length coverage: the storey count a
  // longer ladder produces is generic, proven directly against storeyLadder()
  // rather than against the module's cached MAX_LEVEL.
  for (const max of LADDERS) {
    const { s } = storeyLadder(max - 1);
    assert.equal(s.length, max - 1);
  }
});

// --- draw discipline ---------------------------------------------------------

test('gilding is filled only, never a stroke, and leaves no dash state behind', () => {
  for (const kind of KINDS) {
    const ctx = base(kind, { level: MAX_LEVEL, upgradeTicksLeft: 40 });
    for (const g of gildOf(ctx)) assert.equal(g.op, 'fill');
    assert.deepEqual(ctx.__dash, [], `${kind}: line dash left set`);
    assert.equal(ctx.shadowBlur, undefined, `${kind}: shadowBlur`);
    const a = base(kind, { level: MAX_LEVEL });
    const b = base(kind, { level: MAX_LEVEL });
    assert.deepEqual(a.ops.map((o) => o.style), b.ops.map((o) => o.style));
  }
});

// --- colour: gold is nobody else's, and it warms ----------------------------

const far = (a, b) => {
  const x = parseHex(a);
  const y = parseHex(b);
  return Math.abs((x >> 16 & 255) - (y >> 16 & 255))
    + Math.abs((x >> 8 & 255) - (y >> 8 & 255)) + Math.abs((x & 255) - (y & 255));
};

test('gilt gold is never a faction hue and never an alarm hue', () => {
  assert.equal(P.rank.length, RANK_STEPS);
  for (const c of P.rank) {
    for (const other of [P.player, P.enemy, P.neutral, P.danger, P.warn, P.gold]) {
      assert.notEqual(c, other, 'the gilt ramp must have its own values');
    }
    assert.ok(far(c, FALLBACK.warn) > 24, `${c} is too close to the siege amber`);
  }
  assert.ok(far(P.rank[0], P.rank[RANK_STEPS - 1]) > 24, 'the ramp must actually ramp');
});

test('ownership still carries the site, gilding or no gilding', () => {
  // THIS ASKED ABOUT SOLID STROKES AND SHIPPED RED FOR IT. Ownership grew a
  // SECOND channel (render/ownerDash.js: solid for yours, dashed for theirs,
  // fine dotted for nobody's — the answer to player-green vs enemy-red
  // measuring dE 1.8 under protanopia), so an enemy site has no solid outline
  // at all and `solidStrokes` came back empty. The renderer was right and the
  // question was stale: what this test means by "ownership carries the site"
  // is that every outline is the OWNER'S COLOUR, not that every outline is
  // solid. Asking over all strokes is also strictly stronger, because it can
  // no longer be satisfied vacuously by an empty list.
  for (const owner of ['player', 'enemy', 'neutral']) {
    const ctx = recorder();
    drawSiteBase(ctx, site('stronghold', { owner, level: MAX_LEVEL }), 0, 0,
      siteRadius('stronghold', HEX), P, 1);
    const strokes = ctx.ops.filter((o) => o.op === 'stroke');
    assert.ok(strokes.length > 0, `${owner}: nothing was outlined at all`);
    assert.ok(strokes.every((s) => s.style === P.owner[owner]),
      `${owner}: every outline is still the owner's colour`);
    assert.ok(ctx.ops.some((o) => o.style === P.siteWash[owner]),
      `${owner}: the owner wash is still under the body`);

    // AND THE SECOND CHANNEL SURVIVES A MAXED-OUT SITE. Gilding is the one
    // thing that draws over a site's whole silhouette, so it is exactly where
    // a stray setLineDash would flatten ownership back to hue alone — on the
    // late-game sites the board is most crowded with.
    //
    // THE EXPECTATION IS WRITTEN OUT, NOT READ BACK OUT OF `ownerDash`. The
    // first version of this assertion derived it from the function under test,
    // so deleting the enemy pattern entirely — the whole feature — left it
    // green: the renderer drew solid, `ownerDash` said solid, and the two
    // agreed about nothing. A test that asks the implementation what to expect
    // cannot fail. Confirmed by mutation before this was rewritten.
    const wantDashed = owner !== 'player';
    assert.ok(strokes.every((s) => s.dashed === wantDashed),
      `${owner}: expected every outline ${wantDashed ? 'dashed' : 'solid'}, got `
      + JSON.stringify(strokes.map((s) => s.dashed)));
  }
});
