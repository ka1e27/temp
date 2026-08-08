// What a site earns, what it spends, and the HUD's NET gold per second.
//
// The bug these exist to prevent is the one this project keeps shipping: a
// readout that looks authoritative and is quietly wrong. It survives a green
// suite whenever the test checks a formula against a copy of itself.
//
// So nothing here does that. Every number the panel shows is checked against
// the gold the SIMULATION actually moved over a known number of ticks — if the
// readout and the treasury can disagree, one of these tests is wrong.
// The rally hold-back control lives in rallykeep.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createBattleState } from '../src/battle/state.js';
import { drainCommands } from '../src/battle/commands.js';
import { step } from '../src/battle/sim.js';
import { runEconomy, goldOf, siteGoldPerSec } from '../src/battle/economy.js';
import { runTraining, siteTrainRate, siteTrainCostPerSec } from '../src/battle/training.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { emptyComp, total } from '../src/battle/combat.js';
import { EVENTS } from '../src/battle/events.js';
import { AI_TIERS, CENTIGOLD, SITES, UNITS } from '../src/content/balance.js';
import { TICK_HZ } from '../src/core/loop.js';
import { siteIntel, goldLine, trainLine, goldFlow, flowLine }
  from '../src/screens/battle-econ.js';
import { createOrders } from '../src/screens/battle-orders.js';
import { createView } from '../src/screens/battle-input.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);
const at = (state, id) => state.sites.find((s) => s.id === id);
const reasons = (state) => state.events
  .filter((e) => e.type === EVENTS.COMMAND_REJECTED).map((e) => e.reason);

function fixture(o = {}) {
  return createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: 'intel',
    seed: 1,
    grid: { cols: 11, rows: 9, blocked: [] },
    sites: o.sites ?? [
      { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 4 }, hp: 600, hpMax: 600 },
      { id: 'f1', kind: 'farm', hex: [1, 0], owner: 'player', garrison: {}, hp: 100, hpMax: 100 },
      { id: 'hold', kind: 'stronghold', hex: [2, 0], owner: 'player', garrison: {}, hp: 250, hpMax: 250 },
      { id: 'cas', kind: 'castle', hex: [5, 0], owner: 'enemy', garrison: { militia: 6 }, hp: 600, hpMax: 600 },
    ],
    adjacency: o.adjacency ?? [['camp', 'f1'], ['f1', 'hold']],
    player: makeMods({
      expedition: emptyComp(), startGold: o.gold ?? 5000, unlockedUnits: o.unlocked,
    }),
    enemy: makeMods({ expedition: emptyComp() }),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 480000, aiTier: 1 },
  });
}

/** The two things battle-orders.js touches outside the simulation, so a change
 *  of unit here travels the same path a click on the train picker does. */
function harness(state) {
  const view = createView();
  const board = {
    hexSize: 34,
    sitePos: (s, out) => { out.x = s.hex[0] * 51; out.y = s.hex[1] * 59; return out; },
    siteAt: () => null,
  };
  const canvas = { classList: { toggle() {} } };
  const ord = createOrders({ canvas, board, view, getState: () => state, bus: null });
  return { ord, view };
}

// ---------------------------------------------------------------------------
// Gold in: what the panel says a site pays == what runEconomy() pays it
// ---------------------------------------------------------------------------

test('a site\'s gold/sec is the gold runEconomy actually credits', () => {
  const s = fixture();
  const ticks = 37;
  const before = goldOf(s.factions.player);
  const claim = siteIntel(s, at(s, 'camp')).gold + siteIntel(s, at(s, 'f1')).gold;
  assert.ok(claim > 0);
  for (let i = 0; i < ticks; i++) runEconomy(s);
  const paid = (goldOf(s.factions.player) - before) / CENTIGOLD;
  near(paid, (claim * ticks) / TICK_HZ, 1e-9);
});

test('the panel reads siteGoldPerSec rather than re-deriving it', () => {
  const s = fixture();
  for (const site of s.sites) near(siteIntel(s, site).gold, siteGoldPerSec(s, site));
});

test('a site mid-upgrade still shows the OLD rate, because that is what it pays', () => {
  const s = fixture();
  const farm = at(s, 'f1');
  const level1 = siteIntel(s, farm).gold;
  s.commands.push({ t: 'UPGRADE', site: 'f1' });
  drainCommands(s);
  assert.equal(farm.level, 2);
  assert.ok(farm.upgradeTicksLeft > 0);
  near(siteIntel(s, farm).gold, level1, 1e-12);

  const before = goldOf(s.factions.player);
  runEconomy(s);
  near((goldOf(s.factions.player) - before) / CENTIGOLD * TICK_HZ,
    goldFlow(s, 'player').income, 1e-9);
});

// ---------------------------------------------------------------------------
// Gold out: what the panel says training costs == what runTraining() spends
// ---------------------------------------------------------------------------

/** Stuff every training site except `keepId` past its cap, so the faction's
 *  whole training bill is attributable to that one site. */
function soloTrainer(s, keepId) {
  for (const site of s.sites) {
    if (site.owner === 'player' && site.id !== keepId) {
      site.garrison = { ...emptyComp(), militia: 500 };
    }
  }
}

test('a site\'s training spend is the gold runTraining actually takes', () => {
  const s = fixture();
  soloTrainer(s, 'hold');
  const hold = at(s, 'hold');
  const ticks = 30;
  const claim = siteTrainCostPerSec(s, hold);
  // militia: 12g x batch 2 over 8s = 3.0 gold/sec at a level-1 stronghold.
  near(claim, (UNITS.militia.gold * UNITS.militia.batch) / UNITS.militia.trainSec, 1e-12);

  const before = goldOf(s.factions.player);
  for (let i = 0; i < ticks; i++) runTraining(s);
  const spent = (before - goldOf(s.factions.player)) / CENTIGOLD;
  near(spent, (claim * ticks) / TICK_HZ, 1e-9);
  assert.equal(hold.brownout, 1, 'a rich faction never browns out');
});

test('the production rate is the units the site really delivers', () => {
  const s = fixture();
  const hold = at(s, 'hold');
  const intel = siteIntel(s, hold);
  near(intel.trainRate, siteTrainRate(s, hold));
  near(intel.cycleSec, UNITS.militia.trainSec, 1e-12);
  assert.equal(intel.batch, UNITS.militia.batch);
  // 0.25 units/sec x an 8s cycle == one batch of 2. The rate is a promise:
  near(intel.trainRate * intel.cycleSec, UNITS.militia.batch, 1e-9);

  // One cycle's worth of ticks (+1, because 80 x 0.0125 lands a float hair
  // under 1) must deliver exactly that batch and no more.
  for (let i = 0; i <= UNITS.militia.trainSec * TICK_HZ; i++) runTraining(s);
  assert.equal(total(hold.garrison), UNITS.militia.batch);
});

test('switching what a stronghold trains moves the spend the panel shows', () => {
  // Every unit is deliberately 3.0-4.5 gold/sec, and the two starting units are
  // both exactly 3.0 — so the readout can only be seen to move once the shop has
  // unlocked something dearer. rams are 4.0.
  const s = fixture({ unlocked: ['militia', 'spearmen', 'rams'] });
  soloTrainer(s, 'hold');
  const hold = at(s, 'hold');
  const { ord } = harness(s);
  const before = siteTrainCostPerSec(s, hold);
  const netBefore = goldFlow(s, 'player').net;

  ord.push({ t: 'TRAIN', site: 'hold', unit: 'rams' });
  drainCommands(s);
  assert.deepEqual(reasons(s), []);
  assert.equal(hold.trainType, 'rams');

  const after = siteTrainCostPerSec(s, hold);
  assert.notEqual(after, before);
  near(after, (UNITS.rams.gold * UNITS.rams.batch) / UNITS.rams.trainSec, 1e-12);
  assert.equal(siteIntel(s, hold).unit, 'rams');
  near(goldFlow(s, 'player').net, netBefore - (after - before), 1e-9);

  const purse = goldOf(s.factions.player);
  for (let i = 0; i < 20; i++) runTraining(s);
  near((purse - goldOf(s.factions.player)) / CENTIGOLD, (after * 20) / TICK_HZ, 1e-9);
});

test('a full garrison spends nothing, and the panel says FULL rather than a rate', () => {
  const s = fixture();
  soloTrainer(s, 'hold');
  const hold = at(s, 'hold');
  hold.garrison = { ...emptyComp(), militia: 500 };
  const intel = siteIntel(s, hold);
  assert.equal(intel.blocked, true);
  assert.equal(intel.spend, 0);
  assert.equal(intel.trainRate, 0);
  assert.match(trainLine(intel), /FULL/);
  assert.equal(goldFlow(s, 'player').spend, 0, 'a board of full sites bills nothing');

  const purse = goldOf(s.factions.player);
  runTraining(s);
  assert.equal(goldOf(s.factions.player), purse, 'not one centigold moved');
});

// ---------------------------------------------------------------------------
// The HUD's NET readout
// ---------------------------------------------------------------------------

test('net gold/sec is the gold a real step() adds to the treasury', () => {
  const s = fixture();
  const flow = goldFlow(s, 'player');
  near(flow.net, flow.income - flow.spend, 1e-12);
  assert.ok(flow.income > 0 && flow.spend > 0);

  const owners = s.sites.map((x) => x.owner).join(',');
  const before = goldOf(s.factions.player);
  const ticks = 25;
  for (let i = 0; i < ticks; i++) step(s);
  // If anything flipped, `net` was not constant and the arithmetic below would
  // be meaningless — fail loudly rather than pass on a number that drifted.
  assert.equal(s.sites.map((x) => x.owner).join(','), owners);
  near((goldOf(s.factions.player) - before) / CENTIGOLD, (flow.net * ticks) / TICK_HZ, 1e-9);
});

test('training more than you earn shows a NEGATIVE net, not a hidden one', () => {
  const s = fixture();
  // Two more strongholds on rams: 4 g/s each against 6 g/s of income.
  for (const id of ['camp', 'hold']) at(s, id).trainType = 'rams';
  const flow = goldFlow(s, 'player');
  assert.ok(flow.spend > flow.income, 'this loadout must actually be a loss');
  assert.ok(flow.net < 0);
  assert.match(flowLine(flow), /^\+[\d.]+\/s income · -[\d.]+\/s training$/);

  const before = goldOf(s.factions.player);
  for (let i = 0; i < 20; i++) { runEconomy(s); runTraining(s); }
  const moved = (goldOf(s.factions.player) - before) / CENTIGOLD;
  assert.ok(moved < 0, 'the treasury really is being run down');
  near(moved, (flow.net * 20) / TICK_HZ, 1e-9);
});

test('a brownout is reported at the rate the site is really running', () => {
  const s = fixture({ gold: 0 });
  const hold = at(s, 'hold');
  runEconomy(s);
  runTraining(s);
  assert.ok(hold.brownout > 0 && hold.brownout < 1, 'a broke faction must brown out');

  // The readout follows the brownout down, so it never claims a spend the
  // treasury cannot fund.
  const claimed = siteTrainCostPerSec(s, hold);
  near(claimed, (siteIntel(s, hold).spend), 1e-12);
  const full = (UNITS.militia.gold * UNITS.militia.batch) / UNITS.militia.trainSec;
  assert.ok(claimed < full);
  near(claimed, full * hold.brownout, 1e-9);
});

test('an enemy site is priced with the AI economy handicap the sim applies', () => {
  const s = fixture();
  const cas = at(s, 'cas');
  const before = goldOf(s.factions.enemy);
  const claim = siteIntel(s, cas).gold;
  runEconomy(s);
  near((goldOf(s.factions.enemy) - before) / CENTIGOLD * TICK_HZ, claim, 1e-9);
  near(claim, goldFlow(s, 'enemy').income, 1e-12);
  // Not the naive castle rate: a tier-1 AI really is handicapped, and a readout
  // that quietly dropped the multiplier would agree with itself while lying.
  near(claim, SITES.castle.gold * AI_TIERS[0].economyMult, 1e-12);
  assert.notEqual(claim, SITES.castle.gold);
});

// ---------------------------------------------------------------------------
// The strings the player actually reads
// ---------------------------------------------------------------------------

test('the panel lines say the numbers out loud', () => {
  const s = fixture();
  // A farm only earns; a stronghold only spends; a camp does both, so only the
  // camp needs the net spelled out.
  assert.equal(goldLine(siteIntel(s, at(s, 'f1'))), '+2.0/s gold');
  assert.equal(goldLine(siteIntel(s, at(s, 'hold'))), '-3.0/s training');
  assert.equal(goldLine(siteIntel(s, at(s, 'camp'))),
    '+4.0/s gold · -3.8/s training · net +0.3/s');
  assert.equal(trainLine(siteIntel(s, at(s, 'hold'))), 'militia x2 every 8s · 0.25/s');
  assert.equal(trainLine(siteIntel(s, at(s, 'camp'))), 'militia x2 every 6.4s · 0.31/s');
  assert.equal(trainLine(siteIntel(s, at(s, 'f1'))), '', 'a farm trains nothing');
  // camp 4.0 + farm 2.0 in; camp 3.75 + stronghold 3.0 out.
  assert.equal(flowLine(goldFlow(s, 'player')), '+6.0/s income · -6.8/s training');
  near(goldFlow(s, 'player').net, 6 - 6.75, 1e-9);
});

