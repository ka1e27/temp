// The RANK GAUGE: the gold arc that says how far up the upgrade ladder a site
// has been taken.
//
// The one thing this file is really here to prevent is a renderer that knows
// there are three levels. `SITE_LEVELS` is content and it is expected to get
// longer; a gauge with a hand-written "3" in it would silently stop counting
// the day someone adds a fourth rung. So the assertions below drive the real
// draw calls with the ladder length as a PARAMETER and check the drawing
// follows it — N cells for an N-step ladder, at every N — rather than pinning
// whatever number balance.js happens to hold today.
//
// The storey system next door (tests/sitelevels.test.js) is untouched by any of
// this and must stay that way: the gauge is fills only, so nothing here can
// change how many blocks a site is counted as having.
import test from 'node:test';
import assert from 'node:assert/strict';

import { SITE_LEVELS } from '../src/content/balance.js';
import {
  drawRankGauge, rankBand, rankCells, hasRank,
} from '../src/render/siteRank.js';
import {
  MAX_LEVEL, levelRamp, storeyLadder, siteRadius, siteRingR, siteOuter, levelScale,
} from '../src/render/siteShapes.js';
import {
  drawSiteBase, drawHpRing, drawSiegeRing, builtLevel,
} from '../src/render/siteGlyphs.js';
import { derive, FALLBACK, parseHex, RANK_STEPS } from '../src/render/palette.js';
import { createBattleState } from '../src/battle/state.js';
import { drainCommands } from '../src/battle/commands.js';
import { sampleBattleConfig } from './fixtures/battleConfig.sample.js';

const TAU = Math.PI * 2;
const KINDS = ['farm', 'stronghold', 'camp', 'castle'];
const P = derive(FALLBACK);
const HEX = 34;
/** Ladder lengths to prove the GAUGE against. 2 is the shortest that has an
 *  upgrade in it at all; 8 is past anything plausible — and the gauge is happy
 *  there precisely because it does not grow. */
const LADDERS = [2, 3, 4, 5, 6, 7, 8];
/** How far the SHAPE ladder can go, which is a shorter distance — see the
 *  arithmetic in the levelRamp test below. */
const SHAPE_MAX = 7;

// --- a canvas that remembers the arcs, not just the paths --------------------

function recorder() {
  let cur = null;
  const ctx = {
    ops: [], dashes: [], __dash: [],
    fillStyle: '', strokeStyle: '', lineWidth: 0, lineJoin: '', lineCap: '',
    lineDashOffset: 0,
    beginPath() { cur = { arcs: [], pts: [] }; },
    moveTo(x, y) { cur.pts.push(x, y); },
    lineTo(x, y) { cur.pts.push(x, y); },
    closePath() {},
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
    setLineDash(d) { ctx.__dash = d.slice(); ctx.dashes.push(d.slice()); },
    rect() {}, fillRect() {}, save() {}, restore() {}, fillText() {},
  };
  return ctx;
}
const snap = (c) => ({ arcs: c.arcs.slice(), pts: c.pts.slice() });

/** An annular sector is the only thing on the board drawn as two arcs in one
 *  fill, which makes the gauge trivially separable from every other mark. */
const sectors = (ctx) => ctx.ops.filter((o) => o.op === 'fill' && o.arcs.length === 2);
const full = (s) => Math.abs(s.arcs[0].a1 - s.arcs[0].a0) >= TAU - 1e-9;
/** The unbought rungs: one closed ring behind the cells. */
const trackOf = (ctx) => sectors(ctx).filter(full);
/** The bought rungs, in draw order — the gold, plus the one being raised. */
const cellsOf = (ctx) => sectors(ctx).filter((s) => !full(s));
const goldOf = (ctx) => cellsOf(ctx).filter((s) => s.style !== P.building);
const solidStrokes = (ctx) => ctx.ops.filter((o) => o.op === 'stroke' && !o.dashed);
const dashedStrokes = (ctx) => ctx.ops.filter((o) => o.op === 'stroke' && o.dashed);

function site(kind, over = {}) {
  return {
    id: 'x', kind, owner: 'player', level: 1, upgradeTicksLeft: 0,
    garrison: { militia: 8, spearmen: 0, raiders: 0, rams: 0, marshal: 0 },
    hp: 100, hpMax: 100, trainProgress: 0, brownout: 1, siege: null,
    hex: [0, 0], adj: [], ...over,
  };
}

/** The gauge alone, at an ARBITRARY ladder length. */
function gauge(kind, level, max, over = {}) {
  const ctx = recorder();
  const s = site(kind, { level, ...over });
  drawRankGauge(ctx, s, builtLevel(s), 0, 0, siteRadius(kind, HEX), P, 1, max);
  return ctx;
}

/** The whole site base, at the ladder length the content actually defines. */
function base(kind, over = {}) {
  const ctx = recorder();
  drawSiteBase(ctx, site(kind, over), 0, 0, siteRadius(kind, HEX), P, 1);
  return ctx;
}

// --- the gauge is cut from the content, not from a literal -----------------

test('the ladder length comes from SITE_LEVELS, everywhere', () => {
  assert.equal(MAX_LEVEL, SITE_LEVELS.length);
  assert.equal(rankCells(), SITE_LEVELS.length - 1);
  assert.equal(levelRamp(MAX_LEVEL).length, SITE_LEVELS.length);
  // ...and the drawing that ships agrees with it, with no argument passed.
  for (const kind of KINDS) {
    assert.equal(goldOf(base(kind, { level: MAX_LEVEL })).length, SITE_LEVELS.length - 1,
      `${kind}: a maxed site fills every cell the content defines`);
  }
});

test('cell count follows the ladder length, at every ladder length', () => {
  for (const max of LADDERS) {
    for (const kind of KINDS) {
      for (let lv = 1; lv <= max; lv++) {
        const ctx = gauge(kind, lv, max);
        assert.equal(goldOf(ctx).length, lv - 1,
          `${kind} L${lv} of ${max}: one gold cell per step bought`);
        assert.equal(trackOf(ctx).length, lv > 1 ? 1 : 0,
          `${kind} L${lv} of ${max}: the unbought rungs are one closed track`);
      }
    }
  }
});

test('the ring is subdivided into exactly one cell per upgrade step', () => {
  // Measured off the ANGLES of the real draw calls: at max level every cell is
  // painted, so their spacing is the subdivision.
  for (const max of LADDERS) {
    const pitch = TAU / (max - 1);
    for (const kind of KINDS) {
      const cells = goldOf(gauge(kind, max, max));
      assert.equal(cells.length, max - 1);
      for (let i = 1; i < cells.length; i++) {
        const step = cells[i].arcs[0].a0 - cells[i - 1].arcs[0].a0;
        assert.ok(Math.abs(step - pitch) < 1e-9,
          `${kind} of ${max}: cell ${i} starts ${step.toFixed(4)} on, not ${pitch.toFixed(4)}`);
      }
      // Every cell is separated from its neighbour: a ring you cannot cut is a
      // ring you cannot count.
      for (const c of cells) {
        const span = c.arcs[0].a1 - c.arcs[0].a0;
        assert.ok(span > 0 && span < pitch, `${kind} of ${max}: cell span ${span}`);
      }
    }
  }
});

test('a longer ladder never makes the gauge bigger — only finer', () => {
  // The whole point of moving the count onto a gauge: adding levels must not
  // grow anything, or the board runs out of room at level six.
  for (const kind of KINDS) {
    const r = siteRadius(kind, HEX);
    let outer = null;
    for (const max of LADDERS) {
      for (let lv = 2; lv <= max; lv++) {
        const t = trackOf(gauge(kind, lv, max))[0];
        const gapOut = Math.max(t.arcs[0].r, t.arcs[1].r) - r * siteRingR(kind, lv);
        if (outer === null) outer = gapOut;
        assert.ok(Math.abs(gapOut - outer) < 1e-9,
          `${kind} L${lv} of ${max}: gauge sits ${gapOut} out, not ${outer}`);
      }
    }
    assert.ok(outer > 0, `${kind}: the gauge must clear the silhouette`);
  }
});

// --- level 1 has not moved --------------------------------------------------

test('an un-upgraded site draws no gauge and no extra orbit, at any ladder length', () => {
  for (const max of LADDERS) {
    assert.equal(hasRank(1, max), false);
    assert.equal(rankBand(1, max), 0);
    for (const kind of KINDS) {
      assert.equal(sectors(gauge(kind, 1, max)).length, 0, `${kind} of ${max}`);
    }
  }
  for (const kind of KINDS) assert.equal(sectors(base(kind, { level: 1 })).length, 0);
});

test('the wall and siege rings sit exactly where they always did at level 1', () => {
  // The pre-gauge formulae, written out: enclosing circle + 3px, + 9px.
  for (const kind of KINDS) {
    const r = siteRadius(kind, HEX);
    const ctx = recorder();
    const s = site(kind, { hp: 40 });
    s.siege = { owner: 'enemy', comp: s.garrison };
    drawHpRing(ctx, s, 0, 0, r, P, 1);
    drawSiegeRing(ctx, s, 0, 0, r, P, 1, 0);
    const radii = ctx.ops.flatMap((o) => o.arcs.map((a) => a.r));
    assert.deepEqual(radii, [
      r * siteOuter(kind) + 3, r * siteOuter(kind) + 3, r * siteOuter(kind) + 9,
    ], `${kind}: level-1 furniture moved`);
  }
});

// --- nothing orbiting a site may touch anything else orbiting it ------------

test('gauge, wall ring and siege ring are three separate orbits', () => {
  for (const max of LADDERS) {
    for (const kind of KINDS) {
      for (let lv = 2; lv <= max; lv++) {
        const r = siteRadius(kind, HEX);
        const hull = r * siteRingR(kind, lv);
        const t = trackOf(gauge(kind, lv, max))[0];
        const gIn = Math.min(t.arcs[0].r, t.arcs[1].r);
        const gOut = Math.max(t.arcs[0].r, t.arcs[1].r);
        assert.ok(gIn > hull, `${kind} L${lv}: the gauge cuts into the structure`);

        // The rings, measured at the SAME level so the band is the real one.
        const band = rankBand(lv, max);
        const wall = hull + 3 + band;      // centreline; 3.5px wide
        const siege = hull + 9 + band;     // 2px wide
        assert.ok(wall - 1.75 > gOut + 1,
          `${kind} L${lv}: the wall ring lands on the gauge`);
        assert.ok(siege - 1 > wall + 1.75,
          `${kind} L${lv}: the siege ring lands on the wall ring`);
      }
    }
  }
});

test('the wall and siege rings really do step out over the gauge', () => {
  if (MAX_LEVEL < 2) return;
  for (const kind of KINDS) {
    const shot = (lv) => {
      const ctx = recorder();
      const s = site(kind, { level: lv, hp: 40 });
      s.siege = { owner: 'enemy', comp: s.garrison };
      drawHpRing(ctx, s, 0, 0, siteRadius(kind, HEX), P, 1);
      drawSiegeRing(ctx, s, 0, 0, siteRadius(kind, HEX), P, 1, 0);
      return ctx.ops.flatMap((o) => o.arcs.map((a) => a.r));
    };
    const one = shot(1);
    const two = shot(2);
    one.forEach((rad, i) => assert.ok(two[i] > rad + rankBand(2),
      `${kind}: ring ${i} did not clear the gauge`));
  }
});

// --- construction: the board still shows what you HAVE ----------------------

test('the gauge counts the built level, and previews the one being raised', () => {
  if (MAX_LEVEL < 3) return;
  for (const kind of KINDS) {
    const mid = base(kind, { level: 3, upgradeTicksLeft: 120 });
    const settled = base(kind, { level: 2 });
    assert.equal(goldOf(mid).length, goldOf(settled).length,
      `${kind}: a site mid-build must show the gold it has paid off, no more`);
    const pending = cellsOf(mid).filter((c) => c.style === P.building);
    assert.equal(pending.length, 1, `${kind}: exactly one cell is under construction`);
    // ...and it is the next one round, not a random one.
    const last = goldOf(mid).at(-1);
    assert.ok(pending[0].arcs[0].a0 > last.arcs[0].a0,
      `${kind}: the pending cell must follow the gold`);
    // The scaffolded storey is still the only dashed thing on the site.
    assert.equal(dashedStrokes(mid).length, 1);
    assert.equal(cellsOf(settled).filter((c) => c.style === P.building).length, 0);
  }
});

test('a real UPGRADE order does not hand over the gold cell early', () => {
  const state = createBattleState(sampleBattleConfig());
  const s = state.sites.find((x) => x.kind === 'camp');
  const r = siteRadius(s.kind, HEX);
  const shot = () => {
    const ctx = recorder();
    drawSiteBase(ctx, s, 0, 0, r, P, 1);
    return goldOf(ctx).length;
  };
  const before = shot();

  state.factions.player.goldCg = 999999;
  state.commands.push({ t: 'UPGRADE', site: s.id, by: 'player' });
  drainCommands(state);
  assert.ok(s.upgradeTicksLeft > 0, 'the sim is building');
  assert.equal(shot(), before, 'the gauge must not pay out before the work lands');

  s.upgradeTicksLeft = 0;
  assert.equal(shot(), before + 1, 'and exactly one cell when it does');
});

// --- draw discipline --------------------------------------------------------

test('the gauge is fills only, so a cell can never pass for a storey', () => {
  for (const kind of KINDS) {
    for (let lv = 1; lv <= MAX_LEVEL; lv++) {
      const ctx = base(kind, { level: lv });
      assert.equal(solidStrokes(ctx).length, lv, `${kind} L${lv}: one block per level`);
      for (const s of sectors(ctx)) assert.equal(s.op, 'fill');
    }
    // No dash left set for the next site to inherit, no shadowBlur ever, and
    // two identical calls produce identical output — the cheap proxy for "this
    // draw path allocates nothing".
    const a = base(kind, { level: MAX_LEVEL, upgradeTicksLeft: 40 });
    const b = base(kind, { level: MAX_LEVEL, upgradeTicksLeft: 40 });
    assert.deepEqual(a.__dash, [], `${kind}: line dash left set`);
    assert.equal(a.shadowBlur, undefined, `${kind}: shadowBlur`);
    assert.deepEqual(a.ops.map((o) => o.style), b.ops.map((o) => o.style));
  }
});

// --- colour: rank is gold, and gold is nobody else --------------------------

const far = (a, b) => {
  const x = parseHex(a);
  const y = parseHex(b);
  return Math.abs((x >> 16 & 255) - (y >> 16 & 255))
    + Math.abs((x >> 8 & 255) - (y >> 8 & 255)) + Math.abs((x & 255) - (y & 255));
};

test('rank gold is never a faction hue and never an alarm hue', () => {
  assert.equal(P.rank.length, RANK_STEPS);
  for (const c of P.rank) {
    for (const other of [P.player, P.enemy, P.neutral, P.danger, P.warn, P.gold]) {
      assert.notEqual(c, other, 'rank must have its own value');
    }
    // Far enough from the amber a wall ring turns under siege to survive being
    // seen next to it.
    assert.ok(far(c, FALLBACK.warn) > 24, `${c} is too close to the siege amber`);
  }
  // ...and it warms as the ladder is climbed, so "nearly maxed" reads as heat.
  assert.ok(far(P.rank[0], P.rank[RANK_STEPS - 1]) > 24, 'the ramp must actually ramp');
});

test('ownership still carries the site, gauge or no gauge', () => {
  for (const owner of ['player', 'enemy', 'neutral']) {
    const ctx = recorder();
    drawSiteBase(ctx, site('stronghold', { owner, level: MAX_LEVEL }), 0, 0,
      siteRadius('stronghold', HEX), P, 1);
    assert.ok(solidStrokes(ctx).every((s) => s.style === P.owner[owner]),
      `${owner}: every outline is still the owner's colour`);
    assert.ok(ctx.ops.some((o) => o.style === P.siteWash[owner]),
      `${owner}: the owner wash is still under the body`);
  }
});

// --- the shape ladder underneath, at any length -----------------------------

test('levelRamp: monotone, capped, and kind still outranks level at any length', () => {
  // The ceiling on the SHAPE ladder is arithmetic, not taste. Every level has
  // to be at least 5% bigger than the last (tests/sitelevels.test.js) and a
  // maxed farm has to stay under a bare stronghold, so 1.05^(n-1) must fit
  // inside 0.54/0.38. Nine levels cannot be drawn under those two rules at all;
  // eight fits with 1% to spare, which is not room worth claiming.
  const room = siteRadius('stronghold', HEX) / siteRadius('farm', HEX);
  assert.ok(1.05 ** SHAPE_MAX < room, `${SHAPE_MAX} levels must fit`);
  assert.ok(1.05 ** (SHAPE_MAX + 2) > room, 'and the ninth cannot');

  for (let n = 1; n <= SHAPE_MAX; n++) {
    const ramp = levelRamp(n);
    assert.equal(ramp.length, n);
    assert.equal(ramp[0], 1, `n=${n}: level 1 never moves`);
    for (let i = 1; i < n; i++) {
      assert.ok(ramp[i] > ramp[i - 1] * 1.05, `n=${n}: step ${i} is under 5%`);
    }
    // A maxed farm has to stay smaller than a bare stronghold, forever.
    assert.ok(siteRadius('farm', HEX) * ramp[n - 1] < siteRadius('stronghold', HEX),
      `n=${n}: a level-${n} farm outgrew a stronghold`);
    assert.ok(siteRadius('stronghold', HEX) * ramp[n - 1] < siteRadius('camp', HEX) * 1.05,
      `n=${n}: a level-${n} stronghold outgrew a camp`);
  }
  // The three-level ramp the board was drawn against is untouched.
  assert.deepEqual([...levelRamp(3)], [1, 1.16, 1.34]);
  assert.equal(levelScale(1), 1);
});

test('storeyLadder: converges, so the silhouette stays bounded however long', () => {
  for (let n = 0; n <= 12; n++) {
    const { s, y } = storeyLadder(n);
    assert.equal(s.length, n);
    for (let i = 0; i < n; i++) {
      assert.ok(s[i] > 0 && s[i] < 1, `n=${n}: storey ${i} scale ${s[i]}`);
      if (i > 0) {
        assert.ok(s[i] < s[i - 1], `n=${n}: storey ${i} does not taper`);
        assert.ok(y[i] > y[i - 1], `n=${n}: storey ${i} does not rise`);
        assert.ok(y[i] - s[i] < y[i - 1] + s[i - 1], `n=${n}: storey ${i} floats free`);
      }
    }
    // Bounded: a twelve-storey site is not twelve times as tall as a one-storey
    // one, which is exactly why the gauge exists.
    if (n > 0) assert.ok(y[n - 1] + s[n - 1] < 2.4, `n=${n}: the tower ran away`);
  }
});
