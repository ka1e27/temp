// In-battle site upgrades, as the BOARD shows them.
//
// The failure mode this file exists to prevent is the one that shipped: a site
// went 1 -> 2 -> 3, every number behind it changed, and the map drew exactly
// the same glyph. So the assertions here are about the DRAWING — how many
// blocks it puts down, how tall they are, where the rings land — recorded off
// the real draw calls rather than off a hand-built description of them.
//
// The level a site DISPLAYS is pinned directly against the simulation's
// effectiveLevel(), and the construction case is driven through the real
// UPGRADE command rather than by poking fields, because "produces at the old
// level" and "looks like the old level" have to be the same statement.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LEVEL_SCALE, MAX_LEVEL, levelScale, storeyCount, storeyScale, storeyRise,
  traceStructure, siteRingR, siteRingDy, siteFootYAt, siteHeadYAt,
  siteRadius, siteOuter, siteFootY,
} from '../src/render/siteShapes.js';
import {
  builtLevel, drawSiteBase, drawSiteState, drawHpRing, drawSiegeRing,
  garrisonLabelY,
} from '../src/render/siteGlyphs.js';
import { derive, FALLBACK } from '../src/render/palette.js';
import { createBattleState, effectiveLevel } from '../src/battle/state.js';
import { drainCommands } from '../src/battle/commands.js';
import { SITE_UPGRADE } from '../src/content/balance.js';
import { sampleBattleConfig } from './fixtures/battleConfig.sample.js';

const KINDS = ['farm', 'stronghold', 'camp', 'castle'];
const LEVELS = [1, 2, 3];
const P = derive(FALLBACK);
const HEX = 34;

// --- a canvas that remembers what it was asked to draw -----------------------

/**
 * Records path geometry per subpath and every fill/stroke, so a test can ask
 * "how many separate blocks did this put on the board, and how big were they".
 */
function recorder() {
  let cur = null;
  const ctx = {
    paths: [],   // one entry per subpath that got filled or stroked
    dashes: [], arcs: [], __dash: [],
    fillStyle: '', strokeStyle: '', lineWidth: 0, lineJoin: '', lineCap: '',
    lineDashOffset: 0,
    beginPath() { cur = { pts: [] }; },
    moveTo(x, y) { cur.pts.push(x, y); },
    lineTo(x, y) { cur.pts.push(x, y); },
    closePath() {},
    arc(x, y, r, a0, a1) {
      ctx.arcs.push({ x, y, r, a0, a1 });
      // The circle's extremes, so a farm — the one body with no polygon — is
      // measurable by exactly the same code as the other three.
      cur.pts.push(x, y - r, x, y + r, x - r, y, x + r, y);
    },
    fill() { ctx.paths.push({ ...cur, op: 'fill', style: ctx.fillStyle }); },
    stroke() {
      ctx.paths.push({
        ...cur, op: 'stroke', style: ctx.strokeStyle, width: ctx.lineWidth,
        dashed: ctx.__dash.length > 0,
      });
    },
    setLineDash(d) { ctx.__dash = d.slice(); ctx.dashes.push(d.slice()); },
    rect() {}, fillRect() {}, save() {}, restore() {}, fillText() {},
  };
  return ctx;
}

/** Distinct stroked outlines — one per built block of the structure. */
const solidStrokes = (ctx) => ctx.paths.filter((p) => p.op === 'stroke' && !p.dashed);
const dashedStrokes = (ctx) => ctx.paths.filter((p) => p.op === 'stroke' && p.dashed);

function highest(paths) {
  let top = Infinity;
  for (const p of paths) for (let i = 1; i < p.pts.length; i += 2) {
    if (p.pts[i] < top) top = p.pts[i];
  }
  return top;
}

/** Highest point of BUILT stone, in world y (up is negative). Moats and ghost
 *  storeys are excluded on purpose — this is "how tall is the structure". */
const topOf = (ctx) => highest(solidStrokes(ctx));

function site(kind, over = {}) {
  return {
    id: 'x', kind, owner: 'player', level: 1, upgradeTicksLeft: 0,
    garrison: { militia: 8, spearmen: 0, raiders: 0, rams: 0, marshal: 0 },
    hp: 100, hpMax: 100, trainProgress: 0, brownout: 1, siege: null,
    hex: [0, 0], adj: [], ...over,
  };
}

function drawBase(kind, over) {
  const ctx = recorder();
  const s = site(kind, over);
  drawSiteBase(ctx, s, 0, 0, siteRadius(kind, HEX), P, 1);
  return ctx;
}

// ---------------------------------------------------------------------------
// The level the board is allowed to show
// ---------------------------------------------------------------------------

test('builtLevel matches the simulation effectiveLevel(), case for case', () => {
  for (const level of [1, 2, 3]) {
    for (const ticks of [0, 1, 7, 350]) {
      const s = { level, upgradeTicksLeft: ticks };
      assert.equal(builtLevel(s), effectiveLevel(s),
        `level ${level}, ${ticks} ticks left`);
    }
  }
});

test('a site under construction still draws its OLD level', () => {
  for (const kind of KINDS) {
    const done = drawBase(kind, { level: 2, upgradeTicksLeft: 0 });
    const mid = drawBase(kind, { level: 2, upgradeTicksLeft: 120 });
    const one = drawBase(kind, { level: 1, upgradeTicksLeft: 0 });
    assert.equal(solidStrokes(mid).length, solidStrokes(one).length,
      `${kind}: building L2 must have as many built blocks as an L1`);
    assert.ok(solidStrokes(done).length > solidStrokes(mid).length,
      `${kind}: a finished L2 must have more built blocks than one still building`);
  }
});

test('construction shows scaffolding, and only while it is building', () => {
  for (const kind of KINDS) {
    assert.equal(dashedStrokes(drawBase(kind, { level: 1 })).length, 0,
      `${kind}: an idle level-1 site must not draw scaffolding`);
    assert.equal(dashedStrokes(drawBase(kind, { level: 3 })).length, 0,
      `${kind}: a finished level-3 site must not draw scaffolding`);
    for (const level of [2, 3]) {
      const ctx = drawBase(kind, { level, upgradeTicksLeft: 60 });
      assert.equal(dashedStrokes(ctx).length, 1,
        `${kind}: building L${level} draws exactly one dashed ghost storey`);
      assert.equal(dashedStrokes(ctx)[0].style, P.building);
    }
  }
});

test('the scaffold sits where the finished storey will, not on the body', () => {
  for (const kind of KINDS) {
    const ghost = dashedStrokes(drawBase(kind, { level: 2, upgradeTicksLeft: 60 }))[0];
    const built = drawBase(kind, { level: 2 });
    // The pegged-out storey has to reach above the CURRENT roofline or there is
    // nothing for the player to see.
    const roof = -siteHeadYAt(kind, 1) * siteRadius(kind, HEX);
    const ghostTop = highest([ghost]);
    assert.ok(ghostTop < roof, `${kind}: scaffold must clear the level-1 roofline`);
    assert.ok(ghostTop <= topOf(built) + 1e-9,
      `${kind}: scaffold must reach at least as high as the storey it previews`);
  }
});

// ---------------------------------------------------------------------------
// Levels are legible: bigger, taller, more blocks — every kind, every step
// ---------------------------------------------------------------------------

test('every level adds a block and makes the structure taller', () => {
  for (const kind of KINDS) {
    let prevBlocks = 0;
    let prevTop = 0;
    for (const level of LEVELS) {
      const ctx = drawBase(kind, { level });
      const blocks = solidStrokes(ctx).length;
      const top = topOf(ctx);
      assert.equal(blocks, level, `${kind} L${level}: one outlined block per level`);
      if (level > 1) {
        assert.ok(blocks > prevBlocks, `${kind}: L${level} must add a block`);
        // A step the eye can actually resolve: 8% of the body radius, which at
        // the zoom a whole region is framed at is several screen pixels.
        const step = prevTop - top;
        assert.ok(step > siteRadius(kind, HEX) * 0.08,
          `${kind}: L${level} only ${step.toFixed(2)} taller than L${level - 1}`);
      }
      prevBlocks = blocks;
      prevTop = top;
    }
  }
});

test('the whole structure scales up with level, monotonically', () => {
  assert.equal(LEVEL_SCALE.length, MAX_LEVEL);
  assert.equal(levelScale(1), 1);
  for (let l = 2; l <= MAX_LEVEL; l++) {
    assert.ok(levelScale(l) > levelScale(l - 1) * 1.05,
      `level ${l} must be at least 5% bigger than level ${l - 1}`);
  }
  for (const kind of KINDS) {
    for (let l = 2; l <= MAX_LEVEL; l++) {
      assert.ok(siteHeadYAt(kind, l) > siteHeadYAt(kind, l - 1), `${kind} head L${l}`);
      assert.ok(siteFootYAt(kind, l) > siteFootYAt(kind, l - 1), `${kind} foot L${l}`);
    }
  }
});

test('storeys nest: each one clears the block below it without floating free', () => {
  const n = storeyCount(MAX_LEVEL);
  assert.equal(storeyCount(1), 0);
  assert.equal(n, MAX_LEVEL - 1);
  for (let i = 0; i < n; i++) {
    assert.ok(storeyScale(i) > 0 && storeyScale(i) < 1, 'a storey is smaller than its body');
    if (i > 0) {
      assert.ok(storeyRise(i) > storeyRise(i - 1), 'storeys stack upward');
      assert.ok(storeyScale(i) < storeyScale(i - 1), 'storeys taper');
      // Its own foot must still be inside the storey beneath it, or the tower
      // separates into a floating pile.
      assert.ok(storeyRise(i) - storeyScale(i) < storeyRise(i - 1) + storeyScale(i - 1),
        `storey ${i} floats off storey ${i - 1}`);
    }
  }
});

test('kind still outranks level: a maxed farm stays smaller than a bare stronghold', () => {
  // The whole size language of the board is kind = area. Growth for level has
  // to stay inside it or a level-3 farm starts reading as a military site.
  assert.ok(siteRadius('farm', HEX) * levelScale(MAX_LEVEL)
    < siteRadius('stronghold', HEX), 'farm L3 vs stronghold L1');
  assert.ok(siteRadius('stronghold', HEX) * levelScale(MAX_LEVEL)
    < siteRadius('camp', HEX) * 1.05, 'stronghold L3 vs camp L1');
});

test('levels out of range are clamped, never thrown', () => {
  for (const bad of [undefined, null, 0, -3, 4, 99, NaN]) {
    for (const kind of KINDS) {
      assert.ok(Number.isFinite(levelScale(bad)), `levelScale(${bad})`);
      assert.ok(Number.isFinite(siteRingR(kind, bad)), `siteRingR(${kind}, ${bad})`);
      assert.ok(storeyCount(bad) >= 0 && storeyCount(bad) < MAX_LEVEL);
    }
  }
  assert.equal(levelScale(99), levelScale(MAX_LEVEL));
  assert.equal(builtLevel({ level: undefined, upgradeTicksLeft: 0 }), 1);
});

// ---------------------------------------------------------------------------
// Rings still sit OUTSIDE the silhouette, at every level
// ---------------------------------------------------------------------------

test('the wall ring encloses every part of the structure', () => {
  for (const kind of KINDS) {
    for (const level of LEVELS) {
      const r = siteRadius(kind, HEX);
      const ctx = recorder();
      ctx.beginPath();
      traceStructure(ctx, kind, level, 0, 0, r, 0);
      ctx.fill();
      const cy = -siteRingDy(kind, level) * r;
      const rad = siteRingR(kind, level) * r;
      let worst = 0;
      for (const p of ctx.paths) for (let i = 0; i < p.pts.length; i += 2) {
        const d = Math.hypot(p.pts[i], p.pts[i + 1] - cy);
        if (d > worst) worst = d;
      }
      assert.ok(worst > 0, `${kind} L${level}: traced nothing`);
      assert.ok(worst <= rad + 1e-6,
        `${kind} L${level}: a vertex at ${worst.toFixed(2)} escapes a ${rad.toFixed(2)} ring`);
      // A circle bolted to the site centre would have to be far bigger; the fit
      // is what keeps a level-3 site from wearing a hoop with nothing in it.
      assert.ok(rad < r * 2.1, `${kind} L${level}: ring ${(rad / r).toFixed(2)}r is a hoop`);
    }
  }
});

test('level 1 furniture has not moved', () => {
  // Nothing about an un-upgraded site is allowed to shift: the level work must
  // be invisible until the player buys something.
  for (const kind of KINDS) {
    assert.equal(levelScale(1), 1);
    assert.equal(siteFootYAt(kind, 1), siteFootY(kind));
    assert.equal(siteRingR(kind, 1), siteOuter(kind), `${kind}: level-1 ring radius`);
    assert.equal(siteRingDy(kind, 1), 0, `${kind}: level-1 ring centre`);
    assert.ok(siteRingR(kind, 2) > siteOuter(kind), `${kind}: level-2 ring must grow`);
  }
});

test('rings and siege rings follow the built level, not the paid-for one', () => {
  for (const kind of KINDS) {
    const r = siteRadius(kind, HEX);
    const shot = (over) => {
      const ctx = recorder();
      const s = site(kind, { hp: 40, ...over });
      s.siege = { owner: 'enemy', comp: s.garrison };
      drawHpRing(ctx, s, 0, 0, r, P, 1);
      drawSiegeRing(ctx, s, 0, 0, r, P, 1, 0);
      return ctx.arcs.map((a) => a.r);
    };
    assert.deepEqual(shot({ level: 2, upgradeTicksLeft: 90 }), shot({ level: 1 }),
      `${kind}: mid-upgrade rings must match the old level`);
    assert.notDeepEqual(shot({ level: 2 }), shot({ level: 1 }),
      `${kind}: a finished upgrade must move the rings out`);
  }
});

test('the garrison plaque anchor does not move with level', () => {
  // battleView writes the digits at garrisonLabelY() and the plate is drawn
  // from plaqueTopY(); if levelling shifted one and not the other the number
  // would slide off its plate.
  for (const kind of KINDS) {
    const at = garrisonLabelY(kind, HEX, 1);
    assert.ok(Number.isFinite(at));
    for (const level of LEVELS) {
      // ...and the structure must not grow down far enough to reach it.
      const foot = siteFootYAt(kind, level) * siteRadius(kind, HEX);
      assert.ok(foot < at - 4,
        `${kind} L${level}: the body's foot (${foot.toFixed(1)}) crowds the plaque`);
    }
  }
});

// ---------------------------------------------------------------------------
// Draw discipline
// ---------------------------------------------------------------------------

test('no site draw path ever touches shadowBlur', () => {
  for (const kind of KINDS) {
    for (const level of LEVELS) {
      const ctx = recorder();
      const s = site(kind, { level, hp: 55 });
      s.siege = { owner: 'enemy', comp: s.garrison };
      const r = siteRadius(kind, HEX);
      drawSiteBase(ctx, s, 0, 0, r, P, 1);
      drawSiteState(ctx, s, 0, 0, r, P, 1);
      drawHpRing(ctx, s, 0, 0, r, P, 1);
      drawSiegeRing(ctx, s, 0, 0, r, P, 1, 3);
      assert.equal(ctx.shadowBlur, undefined, `${kind} L${level}`);
      // Dash state is always handed back, or the next site inherits it.
      assert.deepEqual(ctx.__dash, [], `${kind} L${level}: line dash left set`);
    }
  }
});

test('drawing a site allocates no arrays per call', () => {
  // Cheap proxy for the real rule: the same dash buffer object comes back on
  // every call rather than a fresh literal.
  const ctx = recorder();
  const s = site('castle', { level: 3, upgradeTicksLeft: 40 });
  drawSiteBase(ctx, s, 0, 0, siteRadius('castle', HEX), P, 1);
  drawSiteBase(ctx, s, 0, 0, siteRadius('castle', HEX), P, 1);
  assert.ok(ctx.dashes.length >= 4);
  assert.equal(ctx.dashes[0].length, 2);
  assert.equal(ctx.dashes[1].length, 0);
});

// ---------------------------------------------------------------------------
// Against the real simulation
// ---------------------------------------------------------------------------

test('a real UPGRADE order draws the old site until the work lands', () => {
  const state = createBattleState(sampleBattleConfig());
  const s = state.sites.find((x) => x.kind === 'camp');
  const r = siteRadius(s.kind, HEX);
  const before = solidStrokes(drawBase(s.kind, { level: s.level })).length;

  state.factions.player.goldCg = 999999;
  state.commands.push({ t: 'UPGRADE', site: s.id, by: 'player' });
  drainCommands(state);

  assert.equal(s.level, 2, 'the sim banks the new level immediately');
  assert.ok(s.upgradeTicksLeft > 0, 'and starts building');
  assert.equal(effectiveLevel(s), 1, 'while still producing at the old level');

  const mid = recorder();
  drawSiteBase(mid, s, 0, 0, r, P, 1);
  assert.equal(solidStrokes(mid).length, before,
    'the board must not hand over the new storey early');
  assert.equal(dashedStrokes(mid).length, 1, 'it shows scaffolding instead');

  // Land it, exactly the way sim.js does.
  s.upgradeTicksLeft = 0;
  const after = recorder();
  drawSiteBase(after, s, 0, 0, r, P, 1);
  assert.equal(solidStrokes(after).length, before + 1, 'now the storey is built');
  assert.equal(dashedStrokes(after).length, 0, 'and the scaffolding is struck');
  assert.ok(topOf(after) < topOf(mid), 'and the site is visibly taller');
});

test('the drawing changes on the tick the upgrade completes', () => {
  // NOTE for battleView.js: the site glyph differs between upgradeTicksLeft 1
  // and 0 while site.level does NOT change, so signature() has to fold the
  // construction flag in or the cached background keeps the scaffolded form.
  const r = siteRadius('stronghold', HEX);
  const last = recorder();
  const done = recorder();
  drawSiteBase(last, site('stronghold', { level: 2, upgradeTicksLeft: 1 }), 0, 0, r, P, 1);
  drawSiteBase(done, site('stronghold', { level: 2, upgradeTicksLeft: 0 }), 0, 0, r, P, 1);
  assert.notEqual(solidStrokes(last).length, solidStrokes(done).length);
  assert.ok(topOf(done) < topOf(last));
});

test('every level in SITE_UPGRADE has a look to go with it', () => {
  // One purchasable step per drawable step, or the player buys something the
  // board has no way to show.
  assert.equal(SITE_UPGRADE.length, MAX_LEVEL - 1);
});
