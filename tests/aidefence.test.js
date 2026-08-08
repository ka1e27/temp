// The enemy commander's two new obligations: SPEND the army it has, and COME
// HOME when the castle is threatened.
//
// Every assertion here is made against a battle that actually runs. `think()`
// only pushes command objects; a test that stopped at "the right object was
// pushed" would pass just as happily if commands.js rejected every one of them,
// which is exactly how this project has shipped dead features before. So each
// test steps the real simulation and asserts on squads, sieges and garrisons —
// the things a player would see on the board.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createBattleState } from '../src/battle/state.js';
import { startBattle, step } from '../src/battle/sim.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { emptyComp, total } from '../src/battle/combat.js';
import { AI, AI_TIERS } from '../src/content/balance.js';
import { pressure, commitFor, encroachment, homeOf } from '../src/battle/aihome.js';
import { startRun, playerTurn } from '../tools/simplayer.js';
import { REGION_IDS, REGIONS } from '../src/content/regions.data.js';

/**
 * A deliberately shaped board:
 *
 *     camp(P) - pnear(P) - CASTLE(E) - mid(E) - rear(E) - neutral farm
 *        \                                        |
 *         ptarget(P, under enemy siege) ----------+
 *
 * `pnear` is the encroachment, `mid` is a hop the AI must route THROUGH rather
 * than draw from, and `ptarget` is the siege it has to give up.
 */
function board(o = {}) {
  const site = (id, kind, owner, garrison, hex) =>
    ({ id, kind, hex, owner, garrison, ...hpOf(kind) });
  const hpOf = (kind) => (kind === 'castle' || kind === 'camp'
    ? { hp: 480, hpMax: 480 } : kind === 'stronghold'
      ? { hp: 250, hpMax: 250 } : { hp: 100, hpMax: 100 });

  return createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: 'aidefence',
    seed: 7,
    grid: { cols: 21, rows: 9, blocked: [] },
    sites: [
      site('camp', 'camp', 'player', { militia: 4 }, [1, 4]),
      site('pnear', 'farm', 'player', o.pnear ?? { militia: 40 }, [4, 4]),
      site('castle', 'castle', 'enemy', o.castle ?? { militia: 4 }, [7, 4]),
      // Deliberately AT the AI's garrison floor, so it has nothing to spare and
      // the only relief available is two hops back.
      site('mid', 'stronghold', 'enemy', o.mid ?? { militia: 3 }, [10, 4]),
      site('rear', 'stronghold', 'enemy', o.rear ?? { militia: 40 }, [13, 4]),
      site('spoil', 'farm', 'neutral', { militia: 1 }, [16, 4]),
      site('ptarget', 'farm', 'player', { militia: 1 }, [13, 7]),
    ],
    adjacency: [
      ['camp', 'pnear'], ['pnear', 'castle'], ['castle', 'mid'],
      ['mid', 'rear'], ['rear', 'spoil'], ['rear', 'ptarget'],
    ],
    player: makeMods({ expedition: emptyComp(), startGold: 0 }),
    enemy: makeMods({ expedition: emptyComp(), startGold: 0 }),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 600000, aiTier: o.tier ?? 2 },
  });
}

const siteOf = (s, id) => s.sites.find((x) => x.id === id);
const run = (s, n) => { for (let i = 0; i < n; i++) step(s); return s; };
const squadsFrom = (s, from) => s.squads.filter((q) => q.owner === 'enemy' && q.from === from);

/** Every enemy squad that set out during `n` ticks. A snapshot of state.squads
 *  misses anything that has already landed, which is most of them. */
function departures(s, n) {
  const seen = new Set(s.squads.map((q) => q.id));
  const out = [];
  for (let i = 0; i < n; i++) {
    step(s);
    for (const q of s.squads) {
      if (q.owner === 'enemy' && !seen.has(q.id)) { seen.add(q.id); out.push(q); }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Come home
// ---------------------------------------------------------------------------

test('the AI reinforces a threatened castle from beyond its own adjacency', () => {
  const state = board();
  // Nothing is moving and nothing is besieged: the ONLY thing the AI can see is
  // a player army standing next door. Under the old commander that was not a
  // "threat" at all — defend() reads squads already in the air — so it did
  // nothing until the assault had already launched.
  assert.ok(total(encroachment(state, homeOf(state))) > 0, 'the build-up must register');

  run(state, 6);
  const relief = squadsFrom(state, 'rear').filter((q) => q.to === 'castle');
  assert.equal(relief.length, 1, 'the rear stronghold must march to the castle');
  assert.deepEqual(relief[0].route, ['rear', 'mid', 'castle'],
    'and it must chain THROUGH its own ground, the same order a player has');
  assert.ok(total(relief[0].comp) >= 10, `sent a token force: ${total(relief[0].comp)}`);

  // ...and it must actually arrive and be standing in the castle.
  const before = total(siteOf(state, 'castle').garrison);
  run(state, relief[0].arriveTick - state.tick + 1);
  assert.ok(total(siteOf(state, 'castle').garrison) > before + 9,
    'the relief never landed in the garrison');
});

test('the AI abandons a siege of its own to save its castle', () => {
  // A castle it cannot possibly hold with what is nearby: the only army left is
  // the one camped outside the player's farm.
  const state = board({ pnear: { militia: 120 }, rear: { militia: 3 } });
  siteOf(state, 'ptarget').siege = { owner: 'enemy', comp: { ...emptyComp(), militia: 30 } };

  run(state, 6);
  assert.equal(siteOf(state, 'ptarget').siege, null, 'the siege was not lifted');
  const home = state.squads.filter((q) => q.owner === 'enemy' && q.from === 'ptarget');
  assert.equal(home.length, 1, 'the besiegers must be marching somewhere');
  assert.equal(total(home[0].comp), 30, 'a recall keeps the army, it does not disband it');
});

test('an unthreatened castle is left alone — this is a response, not a permanent turtle', () => {
  const state = board({ pnear: { militia: 0 } });
  siteOf(state, 'ptarget').siege = { owner: 'enemy', comp: { ...emptyComp(), militia: 30 } };
  run(state, 8);
  assert.ok(siteOf(state, 'ptarget').siege, 'nothing was encroaching, so the siege must stand');
  assert.equal(squadsFrom(state, 'rear').filter((q) => q.to === 'castle').length, 0,
    'and the rear army must not be recalled for nothing');
});

test('holding the castle outranks taking a free farm next door', () => {
  // `mid` is the only site adjacent to the undefended neutral farm AND the only
  // hop on the road home. Both phases want it; home has to win.
  const state = board({ mid: { militia: 30 }, rear: { militia: 3 } });
  run(state, 6);
  const fromMid = squadsFrom(state, 'mid');
  assert.ok(fromMid.length > 0, 'mid must do something with 30 idle troops');
  assert.deepEqual([...new Set(fromMid.map((q) => q.to))], ['castle'],
    'it went shopping for a farm while its castle was being surrounded');
});

// ---------------------------------------------------------------------------
// 2. Spend the army
// ---------------------------------------------------------------------------

test('surplus opens the commit ratio, and a spare army is what defines surplus', () => {
  const idle = board({ pnear: { militia: 0 }, rear: { militia: 40 }, mid: { militia: 40 } });
  const p = pressure(idle);
  assert.ok(p > 0.5, `an untouched 80-troop garrison is spare army, got pressure ${p}`);

  const tier = AI_TIERS[1];
  assert.ok(commitFor(tier, p) > tier.commitRatio + 0.1,
    'the tier ratio must open when there is army going spare');
  assert.equal(commitFor(tier, 0), tier.commitRatio, 'and stay put when there is not');

  // Everything it owns is under attack: nothing is spare, whatever the total.
  const busy = board({ pnear: { militia: 400 }, rear: { militia: 40 }, mid: { militia: 40 } });
  for (const id of ['castle', 'mid', 'rear']) {
    busy.squads.push({
      id: 900 + busy.squads.length, owner: 'player', from: 'pnear', to: id,
      comp: { ...emptyComp(), militia: 200 }, spawnTick: 0, arriveTick: 5, retreating: false,
    });
  }
  assert.equal(pressure(busy), 0, 'an army that is all needed where it stands is not surplus');
});

/**
 * A quiet board with a DEEP rear: nothing threatens the castle, so home defence
 * cannot fire and the only phase that can move `edeep` is staging.
 *
 *     camp(P) - efront(E) - CASTLE(E) - edeep(E, stuffed)
 */
function deepBoard(tier) {
  const hp = (k) => (k === 'stronghold' ? 250 : 480);
  const s = (id, kind, owner, garrison, x) =>
    ({ id, kind, hex: [x, 4], owner, garrison, hp: hp(kind), hpMax: hp(kind) });
  return createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: 'aistage',
    seed: 11,
    grid: { cols: 15, rows: 9, blocked: [] },
    sites: [
      s('camp', 'camp', 'player', { militia: 30 }, 1),
      s('efront', 'stronghold', 'enemy', { militia: 20 }, 4),
      s('castle', 'castle', 'enemy', { militia: 10 }, 7),
      s('edeep', 'stronghold', 'enemy', { militia: 40 }, 10),
    ],
    adjacency: [['camp', 'efront'], ['efront', 'castle'], ['castle', 'edeep']],
    player: makeMods({ expedition: emptyComp(), startGold: 0 }),
    enemy: makeMods({ expedition: emptyComp(), startGold: 0 }),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 600000, aiTier: tier },
  });
}

test('an interior garrison marches to the front instead of standing there all battle', () => {
  // Sends are adjacency-only, so `edeep` borders nothing it can attack: every
  // troop it holds is unusable where it stands. This is the exploit in one
  // board — on kaldan it was a mean of 67 enemy troops, more than half of
  // everything the AI owned, parked behind its own line for the whole game.
  const state = deepBoard(2);
  const deep = siteOf(state, 'edeep');
  const held = total(deep.garrison);
  const moved = departures(state, 60).filter((q) => q.from === 'edeep' && q.to === 'castle');
  assert.ok(moved.length > 0, 'the interior stronghold never moved a man');
  assert.ok(total(deep.garrison) < held * 0.6, 'its garrison never went down');
  assert.ok(total(siteOf(state, 'castle').garrison) > 10, 'and it never arrived at the front');
});

test('tier 1 still keeps its rear army at home — the opening region is meant to be forgiving', () => {
  assert.equal(AI_TIERS[0].stagingRatio, 0);
  const state = deepBoard(1);
  const moved = departures(state, 60).filter((q) => q.from === 'edeep');
  assert.equal(moved.length, 0, 'tier 1 must not stage its rear army forward');
  assert.equal(total(siteOf(state, 'edeep').garrison), 40);
});

test('...and on a real region the enemy interior really does reach the fighting', () => {
  // The integrated version of the same claim, played out on the map and the
  // economy the balance table is measured against rather than on a fixture.
  const before = REGION_IDS.slice(0, REGIONS.findIndex((r) => r.id === 'kaldan'));
  const battle = startRun('kaldan', 4242, before, 10);
  const interior = (s, id) => {
    const site = s.sites.find((x) => x.id === id);
    return site && site.owner === 'enemy'
      && !site.adj.some((n) => s.sites.find((x) => x.id === n)?.owner !== 'enemy');
  };

  let departures = 0;
  let nextThink = 0;
  while (battle.status === 'running' && battle.tick < 4000) {
    if (battle.tick >= nextThink) { playerTurn(battle); nextThink = battle.tick + 20; }
    const seen = new Set(battle.squads.map((q) => q.id));
    step(battle);
    for (const q of battle.squads) {
      if (q.owner === 'enemy' && !seen.has(q.id) && interior(battle, q.from)) departures++;
    }
  }
  assert.ok(departures >= 30, `the interior never marched: ${departures} departures`);
});

// ---------------------------------------------------------------------------
// 3. It is still an opponent, not a script
// ---------------------------------------------------------------------------

test('the whole pass stays deterministic and issues only legal orders', () => {
  const play = (seed) => {
    const b = startRun('kaldan', seed, [], 0);
    for (let i = 0; i < 900; i++) {
      step(b);
      // Nothing the AI emitted may be rejected: an order the sim refuses is a
      // phase that silently does nothing.
      for (const e of b.events) {
        assert.notEqual(e.type, 'command-rejected', `AI order rejected: ${e.reason}`);
      }
      if (b.status !== 'running') break;
    }
    return { tick: b.tick, status: b.status, sites: b.sites.map((s) => s.owner).join('') };
  };
  assert.deepEqual(play(31337), play(31337), 'the same seed must produce the same battle');
});

test('the new knobs are wired to the tiers, not to a literal', () => {
  for (const t of AI_TIERS) {
    assert.ok(typeof t.stagingRatio === 'number' && t.stagingRatio >= 0);
    assert.ok(t.stagingKeep > 0 && t.stagingKeep <= 1);
  }
  assert.ok(AI.homeRadius >= 1 && AI.homeGuardMargin > 1 && AI.surplusPress > 0);
  // Tiers 3-4 keep the drain-to-the-floor staging they always had.
  assert.ok(AI_TIERS[2].stagingKeep < 0.2 && AI_TIERS[3].stagingKeep < 0.2);
});
