// The build timer, as a BAR — on the board and in the panel.
//
// It replaced a `building · 12s left` line, and the interesting half is the
// DENOMINATOR. A site stores ticks REMAINING and nothing else, and `cmdUpgrade`
// raises `site.level` at the moment it starts the build — so the step being paid
// for is `SITE_UPGRADE[level - 2]`, not `[level - 1]`. Every assertion about the
// fraction here is driven through the real UPGRADE command and real sim ticks
// rather than by poking `upgradeTicksLeft`, because an off-by-one in that index
// produces a perfectly plausible-looking bar that is simply wrong.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createBattleState, upgradeProgress, buildProgress } from '../src/battle/state.js';
import { drainCommands, buildBlocker } from '../src/battle/commands.js';
import { step } from '../src/battle/sim.js';
import { drawBuildBar } from '../src/render/siteBuild.js';
import { derive, FALLBACK } from '../src/render/palette.js';
import { SITE_UPGRADE } from '../src/content/balance.js';
import { TICK_HZ } from '../src/core/loop.js';
import { recomputeInfluence } from '../src/battle/influence.js';
import { gridHexes } from '../src/battle/mapgen.js';
import { sampleBattleConfig } from './fixtures/battleConfig.sample.js';

const P = derive(FALLBACK);

const battle = () => createBattleState(sampleBattleConfig());
const at = (s, id) => s.sites.find((x) => x.id === id);

/** Start a real upgrade on `id`, with enough gold that it cannot be refused. */
function build(s, id) {
  s.factions.player.goldCg = 10_000_00;
  s.commands.push({ t: 'UPGRADE', site: id });
  drainCommands(s);
  const rejected = s.events.filter((e) => e.type === 'command-rejected');
  assert.deepEqual(rejected.map((e) => e.reason), [], 'the fixture must be able to build');
  return at(s, id);
}

/**
 * Raise a real new site, at a real legal hex, and return it. `createBattleState`
 * (unlike `startBattle`) never computes `state.influence` on its own — nothing
 * else in this file needs it, so it is only ever populated here, right before
 * the ground rule (buildBlocker) reads it.
 */
function raise(s, kind = 'trainingGround') {
  recomputeInfluence(s);
  const spot = gridHexes(s.grid.cols, s.grid.rows).find((h) => !buildBlocker(s, 'player', h));
  assert.ok(spot, 'no legal build hex on the fixture — this proves nothing');
  s.factions.player.goldCg = 10_000_00;
  s.commands.push({ t: 'BUILD', kind, hex: [spot.q, spot.r] });
  drainCommands(s);
  const rejected = s.events.filter((e) => e.type === 'command-rejected');
  assert.deepEqual(rejected.map((e) => e.reason), [], 'the fixture must be able to raise a site');
  return s.sites.find((x) => x.hex[0] === spot.q && x.hex[1] === spot.r);
}

/** Advance `n` sim ticks. The real loop, so the countdown is the real one. */
const tick = (s, n) => { for (let i = 0; i < n; i++) step(s); };

// --- the fraction ----------------------------------------------------------

test('build: nothing building is 0, and that is not "just started"', () => {
  const s = battle();
  const site = at(s, 'camp');
  assert.equal(site.upgradeTicksLeft, 0);
  assert.equal(upgradeProgress(site), 0);
  // The negative control that matters: 0 has to be distinguishable from 0, so
  // every consumer gates on upgradeTicksLeft rather than on the fraction.
  assert.equal(upgradeProgress(build(s, 'camp')), 0, 'a build that just began is also 0');
});

test('build: the denominator is the step actually being paid for', () => {
  const s = battle();
  const site = build(s, 'camp');
  // camp started at L1, so the step bought was SITE_UPGRADE[0] — and the site's
  // level ALREADY reads 2. Indexing [level - 1] here would silently price the
  // bar against the NEXT step, which is longer, and the bar would crawl.
  assert.equal(site.level, 2);
  assert.equal(site.upgradeTicksLeft, Math.round(SITE_UPGRADE[0].sec * TICK_HZ));

  const total = site.upgradeTicksLeft;
  tick(s, Math.floor(total / 2));
  const half = upgradeProgress(site);
  assert.ok(half > 0.45 && half < 0.55, `halfway should read ~0.5, got ${half}`);
});

test('build: it runs to 1 and then stops existing', () => {
  const s = battle();
  const site = build(s, 'camp');
  const total = site.upgradeTicksLeft;

  tick(s, total - 1);
  assert.ok(upgradeProgress(site) > 0.9, 'nearly there');
  tick(s, 1);
  assert.equal(site.upgradeTicksLeft, 0, 'the sim finished it');
  assert.equal(upgradeProgress(site), 0, 'and the bar is gone, not pinned full');
  assert.equal(site.level, 2, 'the level it was building toward is the one it kept');
});

test('build: the fraction only ever rises', () => {
  const s = battle();
  const site = build(s, 'camp');
  let last = -1;
  const total = site.upgradeTicksLeft;
  for (let i = 0; i < total + 5; i++) {
    if (site.upgradeTicksLeft <= 0) break;
    const now = upgradeProgress(site);
    assert.ok(now >= last, `progress went backwards at tick ${i}`);
    assert.ok(now >= 0 && now <= 1, `progress left 0..1 at tick ${i}: ${now}`);
    last = now;
    step(s);
  }
  assert.ok(last > 0.9, 'and it got most of the way there');
});

// --- the bar on the board --------------------------------------------------

/** Records fillRect AND arc/stroke — the bar and the ring are one draw call
 *  now (drawBuildBar calls drawBuildRing internally), so one recorder has to
 *  answer for both. Every test below that never constructs a site (the
 *  upgrade-only ones above) never calls arc/beginPath/stroke either, so
 *  adding them here changes nothing about what those tests already assert.
 *
 *  `strokeStyle` is captured at `stroke()`, not at `arc()` — a real canvas
 *  reads it only when the path is actually stroked, and drawBuildRing (like
 *  drawHpRing beside it) sets it AFTER building the path and BEFORE stroking,
 *  which a recorder that grabbed it at `arc()` time would see as empty. */
function recorder() {
  return {
    rects: [], arcs: [], fillStyle: '', strokeStyle: '', lineWidth: 0, lineCap: '',
    fillRect(x, y, w, h) { this.rects.push({ x, y, w, h, style: this.fillStyle }); },
    beginPath() {},
    arc(x, y, r, a0, a1) { this.arcs.push({ x, y, r, a0, a1, style: null }); },
    stroke() {
      const last = this.arcs[this.arcs.length - 1];
      if (last) last.style = this.strokeStyle;
    },
  };
}

test('build: an idle site draws no bar at all', () => {
  const s = battle();
  const ctx = recorder();
  drawBuildBar(ctx, at(s, 'camp'), 100, 100, 20, P, 1);
  assert.deepEqual(ctx.rects, [], 'a bar under every site would be noise');
});

test('build: a building site draws a track and a fill that grows with it', () => {
  const s = battle();
  const site = build(s, 'camp');
  const total = site.upgradeTicksLeft;

  const start = recorder();
  drawBuildBar(start, site, 100, 100, 20, P, 1);
  assert.equal(start.rects.length, 2, 'a track and a fill');
  const [track, fill] = start.rects;
  assert.equal(track.style, P.track);
  assert.equal(fill.style, P.gold, 'gold, so it cannot be read as the training bar');
  assert.equal(fill.w, 0, 'nothing done yet');
  assert.equal(track.y, fill.y, 'the fill sits in its own track');

  tick(s, Math.floor(total / 2));
  const mid = recorder();
  drawBuildBar(mid, site, 100, 100, 20, P, 1);
  assert.ok(mid.rects[1].w > track.w * 0.45 && mid.rects[1].w < track.w * 0.55,
    'the fill is halfway across the track');
  assert.equal(mid.rects[0].w, track.w, 'and the track itself never moves');
});

test('build: the bar sits BELOW the training bar, not on top of it', () => {
  // The two run at once on a stronghold that is upgrading while it trains, and
  // one drawn over the other is worse than not drawing it: it reads as a single
  // bar jumping between two values.
  const s = battle();
  const site = build(s, 'camp');
  const ctx = recorder();
  drawBuildBar(ctx, site, 100, 100, 20, P, 1);
  // drawTrainBar occupies +px*2 .. +px*4.5 from the same foot; this starts at
  // +px*5.5, so with px=1 the gap is a whole pixel.
  assert.ok(ctx.rects[0].h > 0);
  assert.ok(ctx.rects[0].y > 100, 'below the site centre');
});

// --- the ring: a site being RAISED, not one being upgraded -----------------

const TOP = -Math.PI / 2;
const TAU = Math.PI * 2;

test('build: an upgrading site draws no ring at all', () => {
  // The ring is for something being RAISED — an upgrade already has an
  // established silhouette and its own HP ring meaning something, so it never
  // gets a second one here. NEGATIVE CONTROL for the tests below: without the
  // `constructing` gate, this would draw one too.
  const s = battle();
  const site = build(s, 'camp');
  const ctx = recorder();
  drawBuildBar(ctx, site, 100, 100, 20, P, 1);
  assert.deepEqual(ctx.arcs, [], 'an upgrade must not draw the construction ring');
});

test('build: the instant it is raised, only the track shows — no fill sliver yet', () => {
  // Same shape as `upgradeProgress`'s own "0 has to be distinguishable from
  // 0" boundary above: `buildProgress` reads exactly 0 the tick a site is
  // raised (ticksLeft === total), and the ring mirrors drawHpRing's own
  // convention of skipping an empty fill arc rather than drawing a
  // zero-length one — one fewer draw call for the commonest possible state.
  const s = battle();
  const site = raise(s);
  assert.equal(buildProgress(site), 0);
  const ctx = recorder();
  drawBuildBar(ctx, site, 100, 100, 20, P, 1);
  assert.equal(ctx.arcs.length, 1, 'the track only — nothing built yet to fill it');
  assert.equal(ctx.arcs[0].a0, 0);
  assert.equal(ctx.arcs[0].a1, TAU, 'the track is the whole circle');
  assert.equal(ctx.arcs[0].style, P.track);
});

test('build: once it has moved, a site going up draws a ring closing clockwise from 12 o\'clock', () => {
  const s = battle();
  const site = raise(s);
  tick(s, 1);
  const ctx = recorder();
  drawBuildBar(ctx, site, 100, 100, 20, P, 1);
  assert.equal(ctx.arcs.length, 2, 'a full track and a progress arc, same shape as the bar');
  const [track, fill] = ctx.arcs;
  assert.equal(track.a0, 0);
  assert.equal(track.a1, TAU, 'the track is the whole circle');
  assert.equal(track.style, P.track);
  assert.equal(fill.a0, TOP, 'starts at 12 o\'clock, same origin the HP ring sweeps from');
  assert.ok(fill.a1 > fill.a0, 'the end angle is GREATER — increasing angle reads clockwise on a canvas');
  assert.ok(fill.a1 - fill.a0 < 0.05, 'one tick in, so barely a sliver');
  assert.equal(fill.style, P.building, 'the same accent the scaffolding ghost already uses');
});

test('build: the ring is driven by buildProgress(), not a second guess at it', () => {
  const s = battle();
  const site = raise(s);
  const total = site.buildTicksLeft;
  tick(s, Math.floor(total / 2));

  const frac = buildProgress(site);
  assert.ok(frac > 0.45 && frac < 0.55, 'sanity: this really is about halfway');
  const ctx = recorder();
  drawBuildBar(ctx, site, 100, 100, 20, P, 1);
  const [, fill] = ctx.arcs;
  assert.ok(Math.abs((fill.a1 - fill.a0) - TAU * frac) < 1e-9,
    'the swept angle must be exactly TAU * buildProgress(site) — a re-derived fraction is the bug class this bar already fixed once');
});

test('build: a finished site draws no ring — nothing left to count down', () => {
  const s = battle();
  const site = raise(s);
  tick(s, site.buildTicksLeft);
  assert.equal(site.buildTicksLeft, 0, 'sanity: it really finished');
  const ctx = recorder();
  drawBuildBar(ctx, site, 100, 100, 20, P, 1);
  assert.deepEqual(ctx.arcs, [], 'a completed site is not "still building at 100%"');
});
