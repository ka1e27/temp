// THE BOT'S HALTED COLUMNS — tools/simmarch.js `marchTurn`.
//
// `MOVE_SQUAD` was the largest of the eight command verbs nothing in `tools/`
// had ever issued, and it was not a rounding error. `battle/meleephase.js
// openHexMelee` camps every squad that walks onto a contested tile — that is
// the whole of "you cannot walk through an army" — and nothing clears `camped`
// again except `RETREAT_SQUAD` or `MOVE_SQUAD`. So a column that met one of the
// enemy's two-troop columns, won, and was left standing simply stopped being
// part of the war, and 59-81% of every body-second the bot spent off a site was
// spent stranded.
//
// This file pins the policy in real battles. Its negative controls are the half
// that matters: a `marchTurn` that re-tasked a squad in a melee, or one that
// fired on a board with nothing stranded, would both look healthy from outside.
import test from 'node:test';
import assert from 'node:assert/strict';

import { startRun, playerTurn } from '../tools/simplayer.js';
import { marchTurn } from '../tools/simmarch.js';
import { step } from '../src/battle/sim.js';
import { total, emptyComp } from '../src/battle/combat.js';
import { REGIONS, REGION_IDS } from '../src/content/regions.data.js';

const before = (id) => REGION_IDS.slice(0, REGIONS.findIndex((r) => r.id === id));

/** Play one real battle and report what happened to the field army. Shared by
 *  the pair below so the flag on/off runs are the same claim rather than two
 *  measurements that could drift apart. */
function run(id, seed, opts, ticks = 5400) {
  const battle = startRun(id, seed, before(id), 0, opts);
  let nextThink = 0;
  let moves = 0;
  while (battle.status === 'running' && battle.tick < Math.min(ticks, battle.rules.hardCapTicks)) {
    if (battle.tick >= nextThink) {
      const n0 = battle.commands.length;
      playerTurn(battle, opts);
      moves += battle.commands.slice(n0).filter((c) => c.t === 'MOVE_SQUAD').length;
      nextThink = battle.tick + 20;
    }
    step(battle);
  }
  const camped = battle.squads.filter((s) => s.owner === 'player' && s.camped);
  return { battle, moves, campedSquads: camped.length,
    campedBodies: camped.reduce((a, s) => a + total(s.comp), 0) };
}

test('march: the bot issues MOVE_SQUAD in a real battle, and only with the flag on', () => {
  // OPT-IN, so the flag is passed explicitly here. It ships off because it is
  // worth +8 and +13 points and would invalidate a table that is 22 of 24 in
  // band; the inertness of the DEFAULT is the next test's job.
  // THE VERB REACHES THE BATTLE. `grep -rn "t: 'MOVE_SQUAD'" tools/` found
  // nothing at all before this policy, so the first thing to assert is that it
  // does now — the `upgradeTurn` lesson is that a mechanic nobody can play is a
  // mechanic nobody has measured, and the way that failure LOOKS is a healthy
  // green suite over a bot quietly declining to act.
  const on = run('gallowmoor', 1000, { march: true });
  assert.ok(on.moves > 0,
    'the bot issued no MOVE_SQUAD at all — the verb is unreachable again');

  // NEGATIVE CONTROL, AND IT IS THE LOAD-BEARING ONE: the DEFAULT bot must be
  // the old bot exactly. Every win rate in regions.data.js was measured without
  // this policy, so a default that issued even one MOVE_SQUAD would silently
  // re-tune twenty-four regions.
  const off = run('gallowmoor', 1000, {});
  assert.equal(off.moves, 0, 'the default bot issued MOVE_SQUAD — the table is now stale');
});

test('march: it un-strands the army, measured rather than asserted', () => {
  // The claim is not "it wins more" — that is a win rate and belongs to the
  // sweep. It is that troops stop being abandoned, which is a census.
  const on = run('riverfen', 1000, { march: true });
  const off = run('riverfen', 1000, {});
  assert.ok(off.campedBodies > 0,
    'riverfen seed 1000 stranded nothing without the policy — re-pick the fixture, '
    + 'because this pair proves nothing on a board with no halted columns');
  assert.ok(on.campedBodies < off.campedBodies,
    `expected fewer stranded bodies with the policy: ${on.campedBodies} against ${off.campedBodies}`);
});

test('march: a column in an open-ground melee is NEVER re-tasked', () => {
  // THE ONE RULE THAT IS NOT AN OPTIMISATION. `openHexMelee` sets `camped` AND
  // hangs a `melee` record on the same squad without taking it off
  // `state.squads`, so `cmdMoveSquad` would happily accept the order and march
  // a column straight out of a fight — a free disengage no player is offered,
  // since breaking off is RETREAT and RETREAT leaves with whatever survives to
  // the moment it is ordered.
  const view = {
    squads: [
      { id: 'a', owner: 'player', camped: true, comp: { ...emptyComp(), militia: 9 },
        hex: { q: 1, r: 1 }, melee: { foe: 'x' } },
      { id: 'b', owner: 'player', camped: true, comp: { ...emptyComp(), militia: 9 },
        hex: { q: 1, r: 1 } },
    ],
  };
  const mine = [{ id: 'p1', hex: [4, 4] }];
  const out = marchTurn(view, mine);
  assert.deepEqual(out.map((c) => c.squadId), ['b'],
    'a squad with a live melee record must be left alone');
});

test('march: it declines the cases where an order would be noise', () => {
  const mine = [{ id: 'p1', hex: [4, 4] }];
  const sq = (o) => ({ owner: 'player', camped: true, hex: { q: 1, r: 1 },
    comp: { ...emptyComp(), militia: 9 }, ...o });

  // A MARCHING column is not stranded; it is on its way somewhere.
  assert.deepEqual(marchTurn({ squads: [sq({ id: 'm', camped: false })] }, mine), []);
  // The ENEMY's stranded columns are not ours to move.
  assert.deepEqual(marchTurn({ squads: [sq({ id: 'e', owner: 'enemy' })] }, mine), []);
  // A single straggler is not worth an order.
  assert.deepEqual(
    marchTurn({ squads: [sq({ id: 's', comp: { ...emptyComp(), militia: 1 } })] }, mine), []);
  // Already standing on the site it would be sent to.
  assert.deepEqual(marchTurn({ squads: [sq({ id: 'z', hex: { q: 4, r: 4 } })] }, mine), []);
  // No friendly site left anywhere — an order with no destination.
  assert.deepEqual(marchTurn({ squads: [sq({ id: 'n' })] }, []), []);

  // POSITIVE CONTROL, so the four refusals above are not all passing because
  // the function returns nothing whatever it is handed.
  assert.deepEqual(marchTurn({ squads: [sq({ id: 'y' })] }, mine),
    [{ t: 'MOVE_SQUAD', squadId: 'y', to: 'p1', fraction: 1 }]);
});

test('march: the destination is the NEAREST friendly site, deterministically', () => {
  const sq = { id: 'a', owner: 'player', camped: true, hex: { q: 0, r: 0 },
    comp: { ...emptyComp(), militia: 9 } };
  const far = { id: 'far', hex: [9, 0] };
  const near = { id: 'near', hex: [1, 0] };
  assert.equal(marchTurn({ squads: [sq] }, [far, near])[0].to, 'near');
  // Order of the site list must not decide it — capture rewrites that array
  // mid-battle, and a policy that depended on it would be irreproducible.
  assert.equal(marchTurn({ squads: [sq] }, [near, far])[0].to, 'near');
  // A tie breaks on id, for the same reason.
  const a = { id: 'aaa', hex: [1, 0] };
  const b = { id: 'bbb', hex: [0, 1] };
  assert.equal(marchTurn({ squads: [sq] }, [a, b])[0].to, 'aaa');
  assert.equal(marchTurn({ squads: [sq] }, [b, a])[0].to, 'aaa');
});
