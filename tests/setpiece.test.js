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

/** A real battle, wound forward to inside the muster window with nobody
 *  playing — so the enemy has developed and the player has not interfered. */
function boardAt(region, before, frac = 0.45) {
  const b = startRun(region, 1000, REGION_IDS.slice(0, before), 10, {});
  const to = Math.round(b.rules.hardCapTicks * frac);
  b.tick = to;
  return b;
}

test('the window is derived from the region, not from a per-row table', () => {
  const b = boardAt('gallowmoor', 9);
  const w = musterWindow(b);
  assert.ok(w.from > 0 && w.to > w.from);
  assert.equal(w.from, Math.round(b.rules.hardCapTicks * MUSTER.atFrac));
  // It must land INSIDE the battle, not past its own cap — a set-piece
  // scheduled after the hard cap is one that can never happen.
  assert.ok(w.to < b.rules.hardCapTicks, 'the window closes after the battle does');
  // ...and comfortably after the slowest tier's warm-up (255s), or the host is
  // drawn from a country that has not developed yet.
  assert.ok(w.from > 255 * TICK_HZ, `opens at ${w.from / TICK_HZ}s, inside warm-up`);
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

test('it fires once, and the second call is a no-op', () => {
  const b = boardAt('gallowmoor', 9);
  const out = [];
  const first = muster(b, out, new Set());
  assert.equal(first, true, 'the set-piece never fired on a developed board');
  assert.ok(b.ai.musterTick > 0);
  const n = out.length;
  assert.equal(muster(b, out, new Set()), false, 'it fired twice');
  assert.equal(out.length, n, 'a refused muster still pushed orders');
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
  assert.ok(ev.bodies >= MUSTER.minBodies, `announced ${ev.bodies} bodies`);
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

test('outside the window nothing happens, at either end', () => {
  for (const frac of [0.1, 0.95]) {
    const b = boardAt('gallowmoor', 9, frac);
    assert.equal(muster(b, [], new Set()), false, `fired at ${frac} of the cap`);
    assert.equal(b.ai.musterTick, 0);
  }
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
  assert.equal(CONTRACT_VERSION, 13);

  const b = boardAt('gallowmoor', 9);
  assert.equal(muster(b, [], new Set()), true);

  // A REAL SAVE/RESUME — the whole battle object through JSON, which is exactly
  // what meta/resume.js saveBattle/loadBattle does. The latch is plain data, so
  // it round-trips with no migration code and the resumed board does NOT muster
  // again. That is the v13 behaviour.
  const resumed = JSON.parse(JSON.stringify(b));
  assert.equal(resumed.ai.musterTick, b.ai.musterTick);
  assert.equal(muster(resumed, [], new Set()), false, 'a resumed board mustered twice');

  // ...and the same blob in its v12 SHAPE — no latch at all, which is what a
  // save written before this pass looks like. It raises a SECOND host. This is
  // the failure CONTRACT_VERSION exists to discard, asserted rather than argued:
  // the number tracks what the engine DOES with a blob, not its field list.
  const v12 = JSON.parse(JSON.stringify(b));
  delete v12.ai.musterTick;
  assert.equal(muster(v12, [], new Set()), true,
    'a v12-shaped blob did NOT double-fire — if this is now false the bump may be'
    + ' unnecessary, which is a finding rather than a passing test');
});
