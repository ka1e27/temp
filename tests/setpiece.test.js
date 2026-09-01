// C7 — the enemy's one set-piece.
//
// The properties that carry it, and each one is a way it could ship broken
// while looking healthy: it must fire ONCE, it must be able to fire AT ALL (the
// obvious source-gathering function is bounded to the target's neighbours and
// the player's camp has none, which would make the whole feature unreachable),
// it must leave the enemy's country genuinely thinner (that is the counter-play,
// and without it this is only a difficulty spike), and it must announce itself
// with numbers a player can act on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { muster, musterSources, musterWindow } from '../src/battle/setpiece.js';
import { MUSTER } from '../src/content/setpiece.data.js';
import { EVENTS } from '../src/battle/events.js';
import { total } from '../src/battle/combat.js';
import { CONTRACT_VERSION } from '../src/battle/contract.js';
import { RESULTS } from '../src/content/strings.js';
import { startRun } from '../tools/simplayer.js';
import { step } from '../src/battle/sim.js';
import { REGION_IDS } from '../src/content/regions.data.js';
import { TICK_HZ } from '../src/core/loop.js';

/** A real battle, wound forward to inside a muster window with nobody playing —
 *  so the enemy has developed and the player has not interfered. Defaults to
 *  the MIDDLE of whichever wave is next, rather than a hardcoded fraction: the
 *  windows moved once already when the single shot became a schedule, and a
 *  literal here is a test that silently stops being inside the thing it tests. */
function boardAt(region, before, waveIndex = 0) {
  const b = startRun(region, 1000, REGION_IDS.slice(0, before), 10, {});
  b.ai.musterWave = waveIndex;
  const w = MUSTER.waves[waveIndex];
  b.tick = Math.round(b.rules.hardCapTicks * (w.at + w.span / 2));
  return b;
}

test('every window is derived from the region, not from a per-row table', () => {
  const b = boardAt('gallowmoor', 9);
  for (let i = 0; i < MUSTER.waves.length; i++) {
    b.ai.musterWave = i;
    const w = musterWindow(b);
    assert.equal(w.index, i);
    assert.ok(w.from > 0 && w.to > w.from, `wave ${i + 1} has an empty window`);
    assert.equal(w.from, Math.round(b.rules.hardCapTicks * MUSTER.waves[i].at));
    // Every window must land INSIDE the battle: one scheduled past the cap can
    // never happen, and the last one must leave time to be ANSWERED, which is
    // the whole reason the old `lastFrac` existed.
    assert.ok(w.to < b.rules.hardCapTicks * 0.85,
      `wave ${i + 1} closes at ${(w.to / b.rules.hardCapTicks).toFixed(2)} of the cap`);
  }
  // The FIRST window opens comfortably after the slowest tier's warm-up (255s),
  // or the opening host is drawn from a country that has not developed yet.
  b.ai.musterWave = 0;
  const first = musterWindow(b);
  assert.ok(first.from > 255 * TICK_HZ, `opens at ${first.from / TICK_HZ}s, inside warm-up`);
  // ...and the schedule is spent rather than wrapping.
  b.ai.musterWave = MUSTER.waves.length;
  assert.equal(musterWindow(b), null, 'the schedule wrapped instead of ending');
});

test('the host is gathered from the WHOLE map, not the camp\'s neighbours', () => {
  // THE FAILURE THIS EXISTS TO CATCH. `aicore.js adjacentSources` — the obvious
  // function to reuse — is bounded to `site.adj`, everything within
  // MOVEMENT.reachHexes of the TARGET. The player's camp sits in the corner the
  // enemy does not hold, so that set is empty and a muster built on it could
  // never fire at all: built, documented, unreachable.
  const b = boardAt('gallowmoor', 9);
  const camp = b.sites.find((s) => s.kind === 'camp' && s.owner === 'player');
  const enemyAdj = camp.adj
    .map((id) => b.sites.find((s) => s.id === id))
    .filter((s) => s?.owner === 'enemy');
  const sources = musterSources(b, camp, new Set());
  assert.ok(sources.length > enemyAdj.length,
    `gathered ${sources.length} from a neighbourhood holding ${enemyAdj.length}`);
  assert.ok(sources.length <= MUSTER.maxSources);
  // Nearest the target first, so the wave is not held back by the far corner
  // any longer than it has to be.
  for (let i = 1; i < sources.length; i++) {
    assert.ok(sources[i].d >= sources[i - 1].d, 'sources are not nearest-first');
  }
});

test('a wave fires once, and the next one is not due yet', () => {
  const b = boardAt('gallowmoor', 9);
  const out = [];
  assert.equal(muster(b, out, new Set()), true, 'the set-piece never fired on a developed board');
  assert.ok(b.ai.musterTick > 0);
  assert.equal(b.ai.musterWave, 1, 'the schedule did not advance');
  const n = out.length;
  // Same tick, same wave index: the next window has not opened, so nothing.
  assert.equal(muster(b, out, new Set()), false, 'a wave fired twice in one window');
  assert.equal(out.length, n, 'a refused muster still pushed orders');
});

test('THE SCHEDULE: three waves, in order, each bigger than the last', () => {
  // The whole point of the change. One scripted commitment left 93% of every
  // non-win a TIMEOUT, because the ordinary attack phase cannot mass and one
  // moment is not enough weather to decide a battle.
  const b = boardAt('gallowmoor', 9);
  const fired = [];
  for (let i = 0; i < MUSTER.waves.length; i++) {
    const w = MUSTER.waves[i];
    b.tick = Math.round(b.rules.hardCapTicks * (w.at + w.span / 2));
    const out = [];
    assert.equal(muster(b, out, new Set()), true, `wave ${i + 1} never fired`);
    const ev = b.events.filter((e) => e.type === EVENTS.ENEMY_MUSTER).at(-1);
    assert.equal(ev.wave, i + 1, 'a wave announced the wrong number');
    assert.equal(ev.waves, MUSTER.waves.length);
    fired.push(ev.bodies);
  }
  assert.equal(b.ai.musterWave, MUSTER.waves.length, 'the schedule did not run out');
  // ...and it is genuinely SPENT: no fourth wave at any later tick.
  b.tick = b.rules.hardCapTicks - 1;
  assert.equal(muster(b, [], new Set()), false, 'a fourth wave fired');
  // Each wave commits a larger SHARE, which is what makes the last one read as
  // the enemy emptying its country rather than as the first one again.
  for (let i = 1; i < MUSTER.waves.length; i++) {
    assert.ok(MUSTER.waves[i].commit > MUSTER.waves[i - 1].commit,
      'the schedule does not escalate');
    assert.ok(MUSTER.waves[i].minBodies >= MUSTER.waves[i - 1].minBodies,
      'a later wave has a lower floor than an earlier one');
  }
  assert.ok(fired.every((n) => n > 0));
});

test('a window that closes without a host advances to the NEXT wave', () => {
  // An enemy too thin at minute six is not owed that moment at minute twelve;
  // it is owed the bigger one the schedule says comes next. Without this the
  // index sticks and the whole rest of the ladder never fires.
  const b = boardAt('riverfen', 0);
  b.ai.musterWave = 0;
  b.tick = Math.round(b.rules.hardCapTicks * (MUSTER.waves[0].at + MUSTER.waves[0].span)) + 1;
  assert.equal(muster(b, [], new Set()), false);
  assert.equal(b.ai.musterWave, 1, 'a lapsed window did not advance the schedule');
});

test('...and every order in it is one synchronized wave at the camp', () => {
  const b = boardAt('gallowmoor', 9);
  const camp = b.sites.find((s) => s.kind === 'camp' && s.owner === 'player');
  const out = [];
  assert.equal(muster(b, out, new Set()), true);
  assert.ok(out.length >= 2, `a host of ${out.length} column is not a set-piece`);
  const ticks = new Set(out.map((c) => c.arriveTick));
  assert.equal(ticks.size, 1, 'the wave arrives in pieces');
  for (const c of out) {
    assert.equal(c.t, 'SEND');
    assert.equal(c.by, 'enemy');
    assert.equal(c.to, camp.id, 'a musterer was aimed somewhere other than the camp');
  }
  // Distinct sources — one site sending twice is not a muster.
  assert.equal(new Set(out.map((c) => c.from)).size, out.length);
});

test('it announces itself with BOTH numbers a player needs', () => {
  const b = boardAt('gallowmoor', 9);
  assert.equal(muster(b, [], new Set()), true);
  const ev = b.events.find((e) => e.type === EVENTS.ENEMY_MUSTER);
  assert.ok(ev, 'the set-piece fired silently');
  assert.ok(ev.bodies >= MUSTER.waves[0].minBodies, `announced ${ev.bodies} bodies`);
  // WHICH of the schedule this is, so the alert can escalate its language and a
  // reader can tell the third host from the first without re-deriving a window.
  assert.equal(ev.wave, 1);
  assert.equal(ev.waves, MUSTER.waves.length);
  assert.ok(ev.arriveTick > ev.tick, 'it announced an arrival in the past');
  // The WARNING IS THE TRAVEL TIME. A host that lands the instant it is
  // announced cannot be answered, which is the whole feature.
  const secs = (ev.arriveTick - ev.tick) / TICK_HZ;
  assert.ok(secs >= 5, `only ${secs.toFixed(1)}s of warning`);
  // `to` is the field render/fog.js fxVisible actually reads — a defender named
  // under any other key leaves the burst gated on a canSee it does not need.
  assert.equal(ev.to, 'player');
  assert.equal(ev.siteId, b.sites.find((s) => s.kind === 'camp' && s.owner === 'player').id);
  assert.ok(RESULTS.muster(ev.bodies, Math.round(secs)).includes(String(ev.bodies)));
});

test('the counter-play is REAL: their country is measurably thinner after', () => {
  // Not a scripted opening — it falls out of `launch()` debiting every source.
  // If this ever stops being true the set-piece is a pure difficulty spike.
  const b = boardAt('gallowmoor', 9);
  const before = b.sites.filter((s) => s.owner === 'enemy')
    .reduce((n, s) => n + total(s.garrison), 0);
  const out = [];
  assert.equal(muster(b, out, new Set()), true);
  // The orders are drained by the sim, so apply them the way a tick would.
  for (const c of out) b.commands.push(c);
  step(b);
  const after = b.sites.filter((s) => s.owner === 'enemy')
    .reduce((n, s) => n + total(s.garrison), 0);
  assert.ok(after < before, `garrisons did not fall (${before} -> ${after})`);
});

test('a thin enemy raises no host, and does NOT burn its one chance', () => {
  const b = boardAt('gallowmoor', 9);
  for (const s of b.sites) {
    if (s.owner === 'enemy') for (const k of Object.keys(s.garrison)) s.garrison[k] = 0;
  }
  assert.equal(muster(b, [], new Set()), false);
  // THE HALF THAT MATTERS. Latching on a failed attempt would spend the whole
  // feature on whichever think happened to land first — an enemy that is thin
  // at minute eight and rich at minute eleven must still get its moment.
  assert.equal(b.ai.musterTick, 0, 'a failed muster latched anyway');
});

test('outside the window nothing happens, and only the LATE end burns a wave', () => {
  const waves = MUSTER.waves;

  // TOO EARLY. Nothing fires and — the half worth asserting — the index does
  // NOT move: a think before the first window must not spend a wave the enemy
  // never got, or the schedule would be exhausted by the opening minute.
  const early = boardAt('gallowmoor', 9);
  early.tick = Math.round(early.rules.hardCapTicks * (waves[0].at - 0.05));
  assert.equal(muster(early, [], new Set()), false, 'fired before the first window');
  assert.equal(early.ai.musterTick, 0);
  assert.equal(early.ai.musterWave, 0, 'an early think burned a wave');

  // TOO LATE, on the last wave. Nothing fires, and the index advances PAST the
  // schedule so `musterWindow` answers null rather than retrying the same
  // window for the rest of the battle.
  const late = boardAt('gallowmoor', 9, waves.length - 1);
  const last = waves[waves.length - 1];
  late.tick = Math.round(late.rules.hardCapTicks * (last.at + last.span + 0.02));
  assert.equal(muster(late, [], new Set()), false, 'fired after the last window');
  assert.equal(late.ai.musterTick, 0);
  assert.equal(late.ai.musterWave, waves.length, 'a lapsed window did not retire');
  assert.equal(musterWindow(late), null);
});

test('--nomuster reverts it completely', () => {
  const b = boardAt('gallowmoor', 9);
  b.ai.noMuster = true;
  const out = [];
  assert.equal(muster(b, out, new Set()), false);
  assert.equal(out.length, 0);
  assert.equal(b.ai.musterTick, 0);
  assert.equal(b.events.filter((e) => e.type === EVENTS.ENEMY_MUSTER).length, 0);
});

test('the contract is bumped, and here is the blob that proves it was needed', () => {
  assert.equal(CONTRACT_VERSION, 14);

  const b = boardAt('gallowmoor', 9);
  assert.equal(muster(b, [], new Set()), true);

  // A REAL SAVE/RESUME — the whole battle object through JSON, which is exactly
  // what meta/resume.js saveBattle/loadBattle does. The latch is plain data, so
  // it round-trips with no migration code and the resumed board does NOT muster
  // again. That is the v13 behaviour.
  const resumed = JSON.parse(JSON.stringify(b));
  assert.equal(resumed.ai.musterTick, b.ai.musterTick);
  assert.equal(muster(resumed, [], new Set()), false, 'a resumed board mustered twice');

  // ...and the same blob in its v13 SHAPE — `musterTick` and NO `musterWave`,
  // which is exactly what a save written before this pass looks like. The
  // missing index reads as 0, so wave ONE is due again at a tick still inside
  // its own window, and the enemy raises a second host of the wave it already
  // spent. That is the engine stepping a blob differently rather than merely
  // reading a missing field, which is what the number tracks — asserted rather
  // than argued.
  const v13 = JSON.parse(JSON.stringify(b));
  delete v13.ai.musterWave;
  assert.equal(v13.ai.musterTick, b.ai.musterTick, 'the v13 blob lost the wrong field');
  assert.equal(muster(v13, [], new Set()), true,
    'a v13-shaped blob did NOT re-raise wave 1 — if this is now false the bump may'
    + ' be unnecessary, which is a finding rather than a passing test');
});
