// THE CASTLE GATE — the territory threshold on whether a siege of the castle
// can actually complete (see src/battle/state.js `castleSealed`, applied in
// src/battle/sim.js `siegePhase`).
//
// Everything here drives a REAL battle through commands and `step()`, the same
// path a human plays and tools/simplayer.js drives — not a hand-asserted
// number. "Sealed" means the siege runs and runs and the castle never falls,
// no matter how long you wait; "open" means the same siege completes in
// bounded time. Both are load-bearing: a gate that only LOOKS sealed (a flag
// nothing reads) or that never actually opens would both pass a test that
// merely checked `castleGateFrac` was set on the config.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startBattle, step } from '../src/battle/sim.js';
import { assertBattleConfig, makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { emptyComp } from '../src/battle/combat.js';
import { siteControlFraction, castleSealed } from '../src/battle/state.js';

let n = 0;
const NO_EXPEDITION = emptyComp();

/**
 * A small hand-built region: a camp two hexes from the enemy castle (so
 * "rushing the throne" costs nothing but the march), plus four neutral farms
 * off that path. Five non-castle sites in all, so "hold only the capital's
 * doorstep" (camp alone, 1/5 = 0.2) and "hold most of the countryside too"
 * (camp + 3 farms, 4/5 = 0.8) land cleanly on either side of a 0.6 gate — the
 * exact shape the design brief describes: beelining the throne is not enough,
 * the ground off that path has to flip too.
 *
 * EVERY HEX HERE MUST BE INSIDE THE DECLARED GRID, and that is a real
 * constraint rather than tidiness. `grid` is an OFFSET rectangle
 * (`axialFromOffset(col, row) = {q: col - floor(row/2), r: row}`), so a 9x9
 * grid holds no negative `r` at all and only a little negative `q`. This
 * fixture used to sit two farms at [0,-2] and [-2,0] — off-map — and passed
 * anyway, because a send was legal on an AUTHORED EDGE and `travelTicks` fell
 * back to raw hex distance when pathing failed. Free movement has no edges to
 * lie with: an off-map site is simply `no-route`, forever.
 *
 * The enemy is given no gold at all (`startGold: 0, goldRateMult: 0`) so its
 * garrison cannot regrow mid-test — the point here is the GATE, not whether a
 * scripted attacker can out-produce a live economy, which tools/simrunner.js
 * already covers at full scale.
 */
function buildConfig(castleGateFrac, hardCapMs = 999_999_000) {
  const site = (kind, id, hex, owner, garrison, hp) => (
    { id, kind, hex, owner, garrison, hp, hpMax: hp }
  );
  const cfg = {
    contractVersion: CONTRACT_VERSION,
    battleId: `castlegate-${n++}`,
    seed: 7,
    region: { id: 'test', name: 'Test', tier: 3 },
    grid: { cols: 9, rows: 9, blocked: [] },
    sites: [
      site('camp', 'camp', [0, 4], 'player', { militia: 80 }, 480),
      site('castle', 'castle', [2, 4], 'enemy', { militia: 6 }, 480),
      site('farm', 'f1', [0, 2], 'neutral', { militia: 2 }, 100),
      site('farm', 'f2', [0, 6], 'neutral', { militia: 2 }, 100),
      site('farm', 'f3', [-2, 4], 'neutral', { militia: 2 }, 100),
      site('farm', 'f4', [2, 2], 'neutral', { militia: 2 }, 100),
    ],
    adjacency: [
      ['camp', 'castle'], ['camp', 'f1'], ['camp', 'f2'], ['camp', 'f3'], ['camp', 'f4'],
    ],
    player: makeMods({ startGold: 300, expedition: NO_EXPEDITION }),
    enemy: makeMods({ startGold: 0, goldRateMult: 0, expedition: NO_EXPEDITION }),
    boosters: [],
    rules: {
      victory: 'capture-castle', hardCapMs, aiTier: 1, castleGateFrac,
    },
  };
  return assertBattleConfig(cfg);
}

const at = (s, id) => s.sites.find((x) => x.id === id);
const runUntil = (s, pred, max) => {
  let i = 0;
  while (!pred(s) && i < max && s.status === 'running') { step(s); i++; }
  return i;
};
/** Run `k` ticks flat out, ignoring any predicate — for "does it EVER flip". */
const runFlat = (s, k) => { for (let i = 0; i < k && s.status === 'running'; i++) step(s); return s; };

/** Take an off-path farm outright: send, win the field, wait out the siege. */
function takeFarm(s, id) {
  s.commands.push({ t: 'SEND', from: 'camp', to: id, fraction: 0.15 });
  const iters = runUntil(s, (x) => at(x, id).owner === 'player', 900);
  assert.ok(at(s, id).owner === 'player', `${id} should have fallen within the test budget (${iters} ticks)`);
}

/** Commit half the camp's garrison straight at the castle and wait for the
 *  field battle to resolve into a siege. */
function siegeCastle(s) {
  s.commands.push({ t: 'SEND', from: 'camp', to: 'castle', fraction: 0.5 });
  runUntil(s, (x) => at(x, 'castle').siege?.owner === 'player', 300);
  assert.ok(at(s, 'castle').siege, 'the field battle must resolve into a siege, same as any other site');
}

// ---------------------------------------------------------------------------
// The pure territory math
// ---------------------------------------------------------------------------

test('siteControlFraction counts non-castle sites only, and ignores nobody', () => {
  const s = startBattle(buildConfig(0));
  assert.equal(siteControlFraction(s, 'player'), 1 / 5, 'only the camp is player-held at tick 0');
  assert.equal(siteControlFraction(s, 'enemy'), 0, 'the enemy holds only the (excluded) castle');
  assert.equal(siteControlFraction(s, 'neutral'), 4 / 5, 'the four farms are neutral');
});

test('castleSealed is false with no threshold and false with no active siege', () => {
  const noGate = startBattle(buildConfig(0));
  assert.equal(castleSealed(noGate, at(noGate, 'castle')), false, 'a site with no siege is never sealed');

  const gated = startBattle(buildConfig(0.6));
  assert.equal(castleSealed(gated, at(gated, 'castle')), false,
    'castleGateFrac only matters once a siege actually exists');
});

// ---------------------------------------------------------------------------
// The real behaviour: a running battle, not an asserted number
// ---------------------------------------------------------------------------

test('a siege below the gate never completes, however long it runs', () => {
  // 0.6 needed; the camp alone is 1/5 = 0.2 — the doorstep, and nothing else.
  const s = startBattle(buildConfig(0.6));
  s.ai.nextThinkTick = 1e9; // isolate the gate from the enemy AI's own moves
  siegeCastle(s);
  const castle = at(s, 'castle');
  assert.equal(castle.owner, 'enemy', 'the field battle does not capture on its own');
  assert.equal(siteControlFraction(s, 'player'), 1 / 5);
  assert.ok(castleSealed(s, castle), 'below the gate, the castle must read as sealed');

  // Run flat out for a very long time — far past any hard cap a real region
  // would ship with — with no other path to a capture.
  runFlat(s, 18000); // 1800 sim-seconds = 30 minutes
  assert.equal(at(s, 'castle').owner, 'enemy', 'a sealed castle must never fall');
  assert.ok(at(s, 'castle').siege, 'the siege is still there, just unable to finish it');
  assert.ok(at(s, 'castle').hp >= 1, 'hp floors above zero instead of completing the capture');
  assert.equal(s.status, 'running', 'the battle itself has not resolved either way');
});

test('the same siege completes in bounded time once the gate is met', () => {
  // Same doorstep siege, plus two off-path farms first: 3/5 = 0.6 >= 0.6.
  const s = startBattle(buildConfig(0.6));
  s.ai.nextThinkTick = 1e9;
  takeFarm(s, 'f1');
  takeFarm(s, 'f2');
  assert.equal(siteControlFraction(s, 'player'), 3 / 5);
  siegeCastle(s);
  assert.ok(!castleSealed(s, at(s, 'castle')), 'the gate is met, so the castle must not read as sealed');

  runUntil(s, (x) => at(x, 'castle').owner === 'player', 6000); // 600 sim-seconds
  assert.equal(at(s, 'castle').owner, 'player', 'an unsealed siege must actually finish');
  assert.equal(s.status, 'win');
});

test('the gate is monotonic with tier and stays off for the frozen opening', async () => {
  const { REGIONS } = await import('../src/content/regions.data.js');
  for (const id of ['riverfen', 'ashford', 'ironwood', 'saltmere', 'kaldan']) {
    const r = REGIONS.find((x) => x.id === id);
    assert.equal(r.castleGateFrac, 0, `${id} is balance-frozen: rushing the castle must still work`);
  }
  for (const r of REGIONS) {
    assert.ok(r.castleGateFrac >= 0 && r.castleGateFrac < 1,
      `${r.id}: castleGateFrac must be a real fraction, not ${r.castleGateFrac}`);
  }
  const byTier = [1, 2, 3, 4].map((t) => Math.max(...REGIONS.filter((r) => r.tier === t)
    .map((r) => r.castleGateFrac)));
  for (let i = 1; i < byTier.length; i++) {
    assert.ok(byTier[i] >= byTier[i - 1], `tier ${i + 1}'s gate must not be lower than tier ${i}'s`);
  }
  assert.ok(byTier[3] > byTier[1], 'the endgame must actually require more ground than tier 2 does');
});
