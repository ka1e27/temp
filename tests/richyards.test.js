// IF YOU CANNOT SPEND YOUR INCOME, WHAT YOU ARE SHORT OF IS SOMEWHERE TO SPEND
// IT — the bot's fourth build rule.
//
// `WANT_YARDS` is flat at 3, so past its third yard the bot builds farms
// forever. Measured on thanescar at minute fifteen: 41 farms, 8 yards, nine
// places in the world to turn gold into a body, and 118,303 unspent gold
// against an 11.7/s training bill — 2.8 hours of training banked in a battle
// with fifteen minutes left on its cap. That is the same shape CLAUDE.md
// already records for `PRIORITY` at 17,000 gold, an order of magnitude larger.
//
// IT SHIPS ON, and `--norichyards` reverts it. It shipped OFF at first, not out
// of doubt but because the effect was too big to land mid-search. Re-measured at
// n=24 with matched seeds across four rows spanning tiers 3-6:
//
//     region        band     off    on     delta
//     gallowmoor   50-72     38%    75%     +37
//     thanescar    34-56     29%    58%     +29
//     ravensmarch  22-42     17%    54%     +37
//     widowsgate   18-36      4%    50%     +46
//
// Unanimous, and it changes the SHAPE of the re-tune rather than its level:
// those rows go from 5-14 points below their floors to 2-14 above their
// ceilings. The flag survives so every number older than that pass stays
// re-takeable.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cannotSpendIt, RICH_SEC, RESERVE_FLOOR, constructTurn, buildHexes,
} from '../tools/simbuild.js';
import { CENTIGOLD } from '../src/content/balance.js';
import { createBattleState } from '../src/battle/state.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { emptyComp } from '../src/battle/combat.js';
import { recomputeInfluence } from '../src/battle/influence.js';

let n = 0;
/**
 * A REAL battle state, not a stub. `cannotSpendIt` asks the sim's own
 * `factionTrainCostPerSec`, which walks `trainJob` and reads the roster off
 * `state.mods` — a hand-built object thin enough to look sufficient throws
 * inside it, which is exactly why this project's own note says to prefer real
 * `createBattleState` output over fixtures.
 */
function purse(gold, yards = 0, base = 'camp') {
  const sites = [
    { id: 'camp', kind: base, hex: [0, 0], owner: 'player',
      garrison: { militia: 4 }, hp: 480, hpMax: 480, trainType: null },
  ];
  for (let i = 0; i < yards; i++) {
    sites.push({
      id: `y${i}`, kind: 'trainingGround', hex: [2 + (i % 8), Math.floor(i / 8)],
      owner: 'player', garrison: {}, hp: 180, hpMax: 180, trainType: 'militia',
    });
  }
  sites.push({ id: 'castle', kind: 'castle', hex: [10, 6], owner: 'enemy',
    garrison: { militia: 10 }, hp: 900, hpMax: 900 });
  const state = createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: `rich-${n++}`, seed: 1,
    grid: { cols: 15, rows: 11, blocked: [] },
    sites,
    adjacency: [],
    player: makeMods({ expedition: emptyComp() }),
    enemy: makeMods({ expedition: emptyComp() }),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 600000, aiTier: 1 },
  });
  // `createBattleState` leaves the influence flood empty on purpose — `startBattle`
  // is what paints it — and `buildBlocker` reads that flood to answer "is this
  // your ground". Without this every hex on the board is `no-ground` and the bot
  // builds nothing, which reads exactly like a broken rule.
  recomputeInfluence(state);
  state.factions.player.goldCg = Math.round(gold * CENTIGOLD);
  return state;
}

test('a bot with nowhere to spend and money in hand is RICH', () => {
  // The measured case: nine yards, a six-figure treasury.
  assert.equal(cannotSpendIt(purse(118_303, 9)), true);
});

test('...and one spending what it earns is not', () => {
  // A working economy: the surplus is a normal buffer, not a backlog.
  const s = purse(200, 9);
  assert.equal(cannotSpendIt(s), false);
});

test('the threshold is the empire\'s OWN bill, not a magic number', () => {
  // Same gold, different number of places to spend it: the one with more yards
  // is the one that can absorb it. Anything else would make the rule fire on
  // map size rather than on the actual bottleneck.
  const gold = 4000;
  assert.equal(cannotSpendIt(purse(gold, 1)), true, 'one yard cannot absorb this');
  assert.equal(cannotSpendIt(purse(gold, 40)), false, 'forty yards can');
});

test('no training bill at all is the complaint at its purest', () => {
  // Every site earns and none of them builds anything — the `PRIORITY` failure
  // in its original form. It must not divide by zero into "never rich".
  //
  // NOTE `trainType: null` does NOT silence the bill: `trainableUnit` falls
  // back to a buildable type, so anything whose kind trains is always training
  // something (a camp with a nulled type still bills 3.75/s). The only faction
  // with a zero bill is one that holds nothing that trains, which is why this
  // fixture opens on a farm rather than the camp every other test uses.
  assert.equal(cannotSpendIt(purse(RESERVE_FLOOR + 1, 0, 'farm')), true);
  assert.equal(cannotSpendIt(purse(RESERVE_FLOOR - 1, 0, 'farm')), false);
});

test('an empty purse is never rich, however little it can spend', () => {
  assert.equal(cannotSpendIt(purse(0, 0)), false);
  assert.equal(cannotSpendIt(purse(0, 9)), false);
});

test('RICH_SEC is generous enough to be a correction rather than a strategy', () => {
  // At a minute the bot would build a yard out of every ordinary surplus, and
  // this would stop being a fix for a backlog and start being a build order.
  assert.ok(RICH_SEC >= 90, `RICH_SEC ${RICH_SEC} is short enough to fire routinely`);
});

// ---------------------------------------------------------------------------
// ...and it is OFF unless asked for
// ---------------------------------------------------------------------------

/**
 * `constructTurn`'s other three rules, satisfied so the fourth can be read.
 *
 * `front` is hops-to-the-fighting per site: the camp is the line and the yards
 * are behind it, which is what `rearOf` needs to have anywhere to build at all
 * (handed `{}` it finds no finite value, calls every site the front, and
 * returns without building — a fixture that looks like a failing rule and is
 * actually a missing input). `hexes` is the real board, because legality is
 * `buildBlocker` and that reads the influence flood rather than distance.
 */
function turn(state, opts) {
  const front = {};
  for (const s of state.sites) if (s.owner === 'player') front[s.id] = s.kind === 'camp' ? 1 : 3;
  constructTurn(state, front, buildHexes(state), opts);
  return state.commands.filter((c) => c.t === 'BUILD');
}

test('a rich bot with three yards builds a FARM under --norichyards', () => {
  // The behaviour every measured number OLDER than the flip was taken against:
  // past `WANT_YARDS`, the kind is a farm however large the treasury. Kept so
  // that delta stays re-takeable rather than remembered.
  const built = turn(purse(118_303, 3), { richYards: false });
  assert.equal(built.length, 1, 'it should still build something');
  assert.equal(built[0].kind, 'farm');
});

test('...and a TRAINING GROUND by default, which is the shipped bot', () => {
  // Asserted with NO opts, because the default is the thing under test: a flip
  // back to opt-in would silently move every row in regions.data.js by 29-46
  // points, and this is what catches it.
  const built = turn(purse(118_303, 3), {});
  assert.equal(built.length, 1);
  assert.equal(built[0].kind, 'trainingGround',
    'the whole point: money it cannot spend buys somewhere to spend it');
});

test('the flag changes NOTHING for a bot that is not rich', () => {
  // The negative control. A working economy must build exactly what it always
  // built, or this stops being a correction and becomes a policy change.
  for (const opts of [{}, { richYards: true }, { richYards: false }]) {
    const built = turn(purse(600, 3), opts);
    assert.equal(built.length, 1, `opts ${JSON.stringify(opts)}`);
    assert.equal(built[0].kind, 'farm', `opts ${JSON.stringify(opts)}`);
  }
});
