// THE FIRST TWO MINUTES, WHICH WERE A BANKRUPTCY TIMER.
//
// Measured on a genuinely wiped save with no input at all: gold 294 -> 244 ->
// 194 -> 145 -> 95 across two minutes, under a headline `GOLD 294 / -1.7/s`
// with the rate in red and the whole panel edged in the danger colour from tick
// ONE. Every booster button read `–` for the entire battle, because charges are
// bought with relics and relics are paid only for a region already beaten.
//
// Two fixes, and only one of them is a first-battle concession. The alarm rule
// is a rule of the whole game.
import test from 'node:test';
import assert from 'node:assert/strict';
import { goldFlow, runwayOf, isDraining, DRAIN_WARN_SEC } from '../src/screens/battle-econ.js';
import { withFirstBattleCharge, FIRST_BATTLE_BOOSTER } from '../src/meta/boosters.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { createState } from '../src/core/store.js';
import { metaFor } from '../tools/simplayer.js';
import { REGION_IDS } from '../src/content/regions.data.js';

const flow = (gold, net) => ({ gold, net, runwaySec: runwayOf(gold, net) });

// ---------------------------------------------------------------------------
// The alarm fires on running OUT, not on spending
// ---------------------------------------------------------------------------

test('opening: a full treasury spending faster than it earns is not an alarm', () => {
  // THE DEFECT ITSELF. Region 1 opens on 300 gold at -1.65/s — 180 seconds of
  // runway — and used to paint that red immediately, before the player had been
  // told what to do about it or had a chance to do it.
  assert.equal(isDraining(flow(300, -1.65)), false);
  assert.ok(runwayOf(300, -1.65) > 120, 'premise: the opening has real runway');
});

test('opening: a treasury about to run out IS an alarm', () => {
  // ...and the rule earns its keep in the other direction too: a late battle
  // bleeding out at ten seconds notice used to look identical to a healthy one
  // that happened to be training.
  assert.equal(isDraining(flow(20, -5)), true);
  assert.equal(isDraining(flow(0, -5)), true);
});

test('opening: a growing treasury is never an alarm, at any size', () => {
  // The negative control on the sign. `runwayOf` returns Infinity rather than a
  // negative number, which is what makes the comparison one-sided.
  assert.equal(runwayOf(0, +1), Infinity);
  assert.equal(isDraining(flow(0, +0.01)), false);
  assert.equal(isDraining(flow(1e6, 0)), false, 'break-even is not draining either');
});

test('opening: the threshold is the only thing that decides it', () => {
  const net = -10;
  assert.equal(isDraining(flow((DRAIN_WARN_SEC + 1) * -net, net)), false);
  assert.equal(isDraining(flow((DRAIN_WARN_SEC - 1) * -net, net)), true);
});

test('opening: goldFlow still reports the real numbers it always did', () => {
  // Information kept, emphasis corrected — the rate is still exact and still
  // negative, it simply is not painted as an emergency.
  const state = {
    factions: { player: { goldCg: 30000 } },
    sites: [], squads: [], tick: 0, rules: {}, mods: {},
  };
  const f = goldFlow({ ...state, sites: [] }, 'player');
  assert.equal(f.gold, 300);
  assert.equal(typeof f.net, 'number');
  assert.equal(f.runwaySec, runwayOf(f.gold, f.net));
});

// ---------------------------------------------------------------------------
// One charge, on a genuine first battle
// ---------------------------------------------------------------------------

test('opening: a brand new player lands with one booster charge', () => {
  const fresh = createState({ seed: 1, now: 0 }).meta;
  const cfg = buildBattleConfig(fresh, 'riverfen', [], undefined, { seed: 1 });
  assert.deepEqual(cfg.boosters, [{ id: FIRST_BATTLE_BOOSTER, charges: 1 }]);
});

test('opening: and nobody else does — the gate is "nothing has happened yet"', () => {
  // THE CONTROL THAT MATTERS, and the reason the gate is not `stats.battles`
  // alone: `metaFor` builds its empire with `markConquered`, which never touches
  // that counter, so a battles-only gate would have handed this to every harness
  // config for every region in the game.
  const played = metaFor(REGION_IDS.slice(0, 4), 0, 1).meta;
  assert.deepEqual(buildBattleConfig(played, 'kaldan', [], undefined, { seed: 1 }).boosters, []);

  const fought = createState({ seed: 1, now: 0 }).meta;
  fought.stats.battles = 1;
  assert.deepEqual(buildBattleConfig(fought, 'riverfen', [], undefined, { seed: 1 }).boosters, [],
    'a retry after losing the first battle is not a first battle');
});

test('opening: the grant never duplicates or displaces what was chosen', () => {
  const fresh = createState({ seed: 1, now: 0 }).meta;
  const already = [{ id: FIRST_BATTLE_BOOSTER, charges: 3 }];
  assert.deepEqual(withFirstBattleCharge(fresh, already), already,
    'a player who already fielded it keeps their own charges');
  const other = [{ id: 'tithe', charges: 2 }];
  const out = withFirstBattleCharge(fresh, other);
  assert.equal(out.length, 2);
  assert.ok(out.some((b) => b.id === 'tithe' && b.charges === 2), 'the chosen one survives');
});
