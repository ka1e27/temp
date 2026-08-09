// "There needs to be a way to get stronger, and I maxed out the upgrades way
// too easily."
//
// Two separate claims, so two separate halves. Both are asserted through the
// production path: site levels are bought with the REAL UPGRADE command and
// checked against what the simulation then produces, and every shop line is
// checked by building a REAL BattleConfig and running a battle with it. A test
// that only read the content tables would pass on a number nobody consumes,
// which is how five purchasable upgrades once shipped doing nothing at all.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createState } from '../src/core/store.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { startBattle, step } from '../src/battle/sim.js';
import { createBattleState } from '../src/battle/state.js';
import { drainCommands } from '../src/battle/commands.js';
import { makeMods, CONTRACT_VERSION, assertBattleConfig } from '../src/battle/contract.js';
import { emptyComp, total, siteMaxHp, siteRegen } from '../src/battle/combat.js';
import { siteGoldPerSec, goldOf } from '../src/battle/economy.js';
import { garrisonCap, trainMultiplier, trainJob } from '../src/battle/training.js';
import { playerTurn } from '../tools/simplayer.js';
import { SITE_LEVELS, SITE_UPGRADE, CENTIGOLD } from '../src/content/balance.js';
import { UPGRADES, UPGRADE_BY_ID, upgradeCost } from '../src/content/upgrades.data.js';
import { buy, levelOf, costToMax, shopListing, isEndless } from '../src/meta/upgrades.js';
import { incomePerSec, offlineCapMs } from '../src/meta/idle.js';
import { OFFLINE } from '../src/content/upgrades.data.js';
import { REGION_IDS, REGIONS, fullConquestIncome } from '../src/content/regions.data.js';
import { metaFor } from '../tools/simplayer.js';

// ===========================================================================
// 1. More site levels
// ===========================================================================

function oneSite(kind = 'stronghold', gold = 100000) {
  return createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: 'prog',
    seed: 3,
    grid: { cols: 9, rows: 9, blocked: [] },
    sites: [
      { id: 'camp', kind: 'camp', hex: [1, 4], owner: 'player', garrison: { militia: 2 }, hp: 480, hpMax: 480 },
      { id: 'x', kind, hex: [3, 4], owner: 'player', garrison: { militia: 2 }, hp: 250, hpMax: 250 },
      { id: 'castle', kind: 'castle', hex: [7, 4], owner: 'enemy', garrison: { militia: 2 }, hp: 480, hpMax: 480 },
    ],
    adjacency: [['camp', 'x'], ['x', 'castle']],
    player: makeMods({ expedition: emptyComp(), startGold: gold }),
    enemy: makeMods({ expedition: emptyComp(), startGold: 0 }),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 900000, aiTier: 1 },
  });
}

/** Buy one level through the real command path and wait out the works. */
function upgradeOnce(state, id = 'x') {
  const site = state.sites.find((s) => s.id === id);
  const from = site.level;
  state.commands.push({ t: 'UPGRADE', site: id });
  drainCommands(state);
  assert.equal(site.level, from + 1, `UPGRADE to L${from + 1} was refused`);
  const wait = site.upgradeTicksLeft + 2;   // read ONCE: the field is counting down
  for (let i = 0; i < wait; i++) step(state);
  assert.equal(site.upgradeTicksLeft, 0, 'the works never finished');
  return site;
}

test('the two level arrays are the single source of truth and agree with each other', () => {
  assert.equal(SITE_UPGRADE.length, SITE_LEVELS.length - 1,
    'every drawable level must be a purchasable step');
  assert.ok(SITE_LEVELS.length > 3, 'the ladder was extended past the three it shipped with');
  for (let i = 1; i < SITE_LEVELS.length; i++) {
    const a = SITE_LEVELS[i - 1];
    const b = SITE_LEVELS[i];
    for (const k of ['gold', 'train', 'hp', 'regen']) {
      assert.ok(b[k] > a[k], `level ${i + 1} is not better than ${i} at ${k}`);
    }
    assert.ok(b.cap > a.cap, `level ${i + 1} holds no more than ${i}`);
    assert.ok(SITE_UPGRADE[i - 1].gold > (SITE_UPGRADE[i - 2]?.gold ?? 0),
      `step ${i} is not dearer than the one before it`);
    assert.ok(SITE_UPGRADE[i - 1].sec > 0);
  }
});

test('a site can be built all the way up, and every step changes the simulation', () => {
  const state = oneSite('stronghold');
  const site = state.sites.find((s) => s.id === 'x');
  let gold = siteGoldPerSec(state, site);
  let train = trainMultiplier(state, site);
  let cap = garrisonCap(state, site);
  let hp = site.hpMax;
  let regen = siteRegen(site.kind, site.level);

  for (let lvl = 2; lvl <= SITE_LEVELS.length; lvl++) {
    upgradeOnce(state);
    assert.equal(site.level, lvl);
    assert.equal(site.hpMax, siteMaxHp(site.kind, lvl), 'HP did not follow the level');
    assert.ok(trainMultiplier(state, site) > train, `L${lvl} trains no faster`);
    assert.ok(garrisonCap(state, site) > cap, `L${lvl} holds no more`);
    assert.ok(site.hpMax > hp, `L${lvl} is no tougher`);
    assert.ok(siteRegen(site.kind, lvl) > regen, `L${lvl} repairs no faster`);
    train = trainMultiplier(state, site);
    cap = garrisonCap(state, site);
    hp = site.hpMax;
    regen = siteRegen(site.kind, lvl);
  }
  assert.equal(site.level, SITE_LEVELS.length);

  // ...and there is nothing past the top.
  state.commands.push({ t: 'UPGRADE', site: 'x' });
  drainCommands(state);
  assert.equal(site.level, SITE_LEVELS.length, 'the ladder has no step past its last entry');
  assert.ok(state.events.some((e) => e.reason === 'max-level'));

  // A farm is the one that pays: check the money, not just the multiplier.
  const farmState = oneSite('farm');
  const farm = farmState.sites.find((s) => s.id === 'x');
  gold = siteGoldPerSec(farmState, farm);
  for (let lvl = 2; lvl <= SITE_LEVELS.length; lvl++) {
    upgradeOnce(farmState);
    const now = siteGoldPerSec(farmState, farm);
    assert.ok(now > gold, `a level-${lvl} farm earns no more than a level-${lvl - 1} one`);
    gold = now;
  }
});

test('a fully built site is a real fortress: a token force can no longer breach it', () => {
  // The point of extending hp/regen rather than only gold: `breachSeconds`
  // returns Infinity when siege damage cannot out-pace repair, so the top of
  // the ladder buys immunity to small raids and nothing else does.
  const state = oneSite('stronghold');
  const site = state.sites.find((s) => s.id === 'x');
  const raid = { ...emptyComp(), militia: 8 };
  const raidDps = 8 * 0.6;
  assert.ok(raidDps > siteRegen('stronghold', 1), 'eight militia must crack a bare stronghold');
  for (let lvl = 2; lvl <= SITE_LEVELS.length; lvl++) upgradeOnce(state);
  assert.ok(raidDps < siteRegen('stronghold', site.level),
    'a fully built stronghold must out-repair a raiding party');
  assert.equal(total(raid), 8);
});

test('a captured site loses its levels — upgrades are an investment in ground you hold', () => {
  const state = oneSite('stronghold');
  const site = state.sites.find((s) => s.id === 'x');
  upgradeOnce(state);
  assert.equal(site.level, 2);
  site.owner = 'enemy';
  site.siege = { owner: 'player', comp: { ...emptyComp(), militia: 60 } };
  site.hp = 1;
  for (let i = 0; i < 5 && site.owner !== 'player'; i++) step(state);
  assert.equal(site.owner, 'player', 'the assault should have taken it');
  assert.equal(site.level, 1, 'a captured site must reset to level 1');
  assert.equal(site.hpMax, siteMaxHp('stronghold', 1));
});

// ===========================================================================
// 2. The shop no longer runs out
// ===========================================================================

const richMeta = (crowns) => {
  const s = createState({ seed: 5, now: 0 });
  s.meta.crowns = crowns;
  return s.meta;
};

const maxOut = (meta, id) => {
  for (let i = 0; i < 40; i++) if (!buy(meta, id, null).ok) break;
  assert.equal(levelOf(meta, id), UPGRADE_BY_ID[id].maxLevel, `${id} did not reach max`);
};

/** Crowns to take one line from nothing to `levels`. */
const costOf = (id, levels) => {
  let c = 0;
  for (let l = 0; l < levels; l++) c += upgradeCost(UPGRADE_BY_ID[id], l);
  return c;
};

test('the shop cannot run out, because none of the six lines has an end', () => {
  // It used to. Every upgrade in the game maxed for 59,589 crowns — about six
  // minutes of idling for a region-14 player — and the last four regions had
  // nothing left to buy at all. That is a strange thing for an idle game to do
  // to a player who idles.
  const endless = UPGRADES.filter(isEndless);
  assert.equal(endless.length, 6, 'six lines carry the whole late game');
  for (const u of endless) assert.equal(costToMax(richMeta(0), u.id), Infinity);

  // The real test of "it runs out": a player who owns the entire world, has
  // bought everything they can, and idles for an hour must STILL have something
  // left on the board to buy.
  const meta = metaFor(REGION_IDS.slice(0, REGIONS.length - 1), 60).meta;
  meta.crowns += incomePerSec(meta) * 3600;
  const unbought = shopListing(meta).flatMap((g) => g.items).filter((i) => i.affordable);
  assert.ok(unbought.length > 0, 'a full-conquest player has nothing left to buy');
});

test('the curve, not a ceiling, is what slows a line down', () => {
  // Power grows with the LOGARITHM of crowns spent, which is what lets a very
  // patient player get strong without making an ordinary one irrelevant.
  const levelsFor = (crowns) => {
    const meta = richMeta(crowns);
    let n = 0;
    while (buy(meta, 'treasury', null).ok) n++;
    return n;
  };
  const cheap = levelsFor(1e6);
  const rich = levelsFor(1e9);
  const absurd = levelsFor(1e12);
  assert.ok(cheap > 5, 'an early player still makes real progress');
  assert.ok(rich > cheap && absurd > rich, 'more crowns always buys more');
  assert.ok(absurd < cheap * 3,
    `a million times the crowns bought ${absurd} levels against ${cheap} — that is linear, not a curve`);
});

test('an hour of full-conquest income does not buy the whole late game', () => {
  // The old bound was "total to max"; with no max, the honest version is that
  // one hour cannot take a single line to a level that trivialises it.
  const hour = fullConquestIncome() * 3600;
  const meta = richMeta(hour);
  let n = 0;
  while (buy(meta, 'arms', null).ok) n++;
  assert.ok(n * 0.06 < 3,
    `one hour bought +${(n * 0.06 * 100).toFixed(0)}% attack — the curve is too flat`);
});

test('the opening is still affordable, so regions 1-5 stay reachable', () => {
  // The frozen-ladder test in a form that survives the collapse: what matters
  // for the early campaign is that a first purchase is within an early player's
  // reach, not that a particular id has a particular cap.
  const opening = metaFor([], 10).meta;                 // a region-1 player
  const firstCosts = UPGRADES.filter(isEndless).map((u) => u.cost.base);
  assert.ok(Math.min(...firstCosts) <= 60,
    'nothing in the opening shop is affordable at region 1');
  assert.ok(costOf('standingArmy', 3) < 700,
    'three levels of the most-felt line must be an early-campaign project');
  assert.equal(levelOf(opening, 'unlockMarshal'), 0, 'and the big unlocks stay out of reach');
});

test('every line is reachable in the campaign, and none of them early', () => {
  // The opposite failure to running dry: content nobody can afford. Each of the
  // six must be movable by the last region, and the expensive unlocks must not
  // be trivially affordable at Kaldan.
  const early = metaFor(REGION_IDS.slice(0, 4), 10).meta;   // the Kaldan player
  const late = metaFor(REGION_IDS.slice(0, REGIONS.length - 1), 60).meta;
  for (const u of UPGRADES.filter(isEndless)) {
    assert.ok(levelOf(late, u.id) > 0, `${u.id} is never reachable`);
  }
  assert.equal(levelOf(early, 'unlockMarshal'), 0,
    'the marshal is cheap enough to disturb the early game');
});

// ===========================================================================
// 3. ...and every new line reaches the battle
// ===========================================================================

/** Build a real config for a real region, with `ups` bought. */
function configWith(ups, regionId = 'kaldan') {
  const meta = richMeta(50_000_000);
  for (const [id, n] of Object.entries(ups)) {
    for (let i = 0; i < n; i++) assert.ok(buy(meta, id, null).ok, `could not buy ${id}`);
  }
  return assertBattleConfig(
    buildBattleConfig(meta, regionId, [], generateBattleMap, { seed: 99 }),
  );
}

test('Arms raises the attack AND defence the simulation actually fights with', () => {
  const base = configWith({});
  const armed = configWith({ arms: 10 });
  assert.ok(armed.player.unitAtkMult > base.player.unitAtkMult * 1.4);
  assert.ok(armed.player.unitDefMult > base.player.unitDefMult * 1.4);
  // The enemy must not inherit the player's shopping.
  assert.equal(armed.enemy.unitAtkMult, base.enemy.unitAtkMult);
  assert.equal(armed.enemy.unitDefMult, base.enemy.unitDefMult);

  // And it has to change a battle, not just a field on a config: the same seed,
  // the same map, more of the enemy dead.
  //
  // THE PLAYER HAS TO ACTUALLY ATTACK for this to measure anything. This used to
  // step the sim with no orders at all and rely on the enemy walking into the
  // player's starting ground — which stopped happening when the footprint was cut
  // to a beachhead behind a neutral buffer. Both sides then killed exactly zero
  // and the assertion compared 0 > 0. Driving the same scripted bot the balance
  // table is measured with is the fix, and it is the stronger test: it is a real
  // army fighting a real battle rather than a garrison being walked into.
  const kills = (cfg) => {
    const b = startBattle(cfg);
    let nextThink = 0;
    for (let i = 0; i < 2400 && b.status === 'running'; i++) {
      if (b.tick >= nextThink) { playerTurn(b); nextThink = b.tick + 20; }
      step(b);
    }
    return b.factions.player.unitsKilled;
  };
  const armedKills = kills(armed);
  const bareKills = kills(base);
  assert.ok(bareKills > 0, 'the fixture produced no combat at all — it measures nothing');
  assert.ok(armedKills > bareKills,
    `a +60% army killed ${armedKills} against a bare one's ${bareKills}`);
});

test('War Chest fills the treasury the battle actually spends', () => {
  const base = configWith({});
  const rich = configWith({ warChest: 8 });
  assert.equal(base.player.goldRateMult, 1, 'the baseline must be exactly 1.0');
  assert.ok(rich.player.goldRateMult > 1.5, 'goldRateMult never moved');
  assert.ok(rich.player.startGold > base.player.startGold + 900, 'nor did the opening purse');
  assert.equal(rich.enemy.goldRateMult, base.enemy.goldRateMult);

  const earned = (cfg) => {
    const b = startBattle(cfg);
    for (const s of b.sites) if (s.kind === 'farm') s.owner = 'player';
    const before = goldOf(b.factions.player);
    for (let i = 0; i < 100; i++) step(b);
    return goldOf(b.factions.player) - before;
  };
  assert.ok(earned(rich) > earned(base) * 1.2, 'the farms paid the same either way');
});

test('Drill makes the same treasury buy more soldiers, faster, into a bigger site', () => {
  // One line, three channels — which is what collapsing four upgrades into it
  // was supposed to buy. All three have to actually reach the battle.
  const base = configWith({});
  const drilled = configWith({ drill: 12 });
  assert.equal(base.player.trainCostMult, 1);
  assert.ok(drilled.player.trainCostMult < 0.65, 'trainCostMult never moved');
  assert.ok(drilled.player.trainSpeedMult > 1.5, 'trainSpeedMult never moved');
  assert.ok(drilled.player.garrisonCapBonus >= 12 * 12, 'garrisonCapBonus never moved');
  assert.equal(drilled.enemy.trainCostMult, base.enemy.trainCostMult);

  const perCycle = (cfg) => {
    const b = startBattle(cfg);
    const site = b.sites.find((s) => s.owner === 'player' && trainJob(b, s));
    const job = trainJob(b, site);
    return job.cost / job.progress;   // centigold per training cycle
  };
  assert.ok(perCycle(drilled) < perCycle(base) * 0.7, 'training cost the same either way');
});

test('Standing Army keeps landing more troops, with no level at which it stops', () => {
  // This used to need a SECOND upgrade (Muster Field) to carry on past six
  // levels. One line does it now, and the point is that it never runs out.
  const few = configWith({ standingArmy: 4 });
  const many = configWith({ standingArmy: 14 });
  const n = (cfg) => total(cfg.player.expedition);
  assert.ok(n(many) > n(few) + 20, `expedition did not grow: ${n(few)} -> ${n(many)}`);
  assert.ok(many.player.marchSpeedMult > few.player.marchSpeedMult, 'and they arrive sooner');

  const b = startBattle(many);
  const camp = b.sites.find((s) => s.kind === 'camp');
  assert.equal(total(camp.garrison), n(many), 'the extra troops never deployed');
});

test('Treasury and Siegeworks reach the idle economy and the walls', () => {
  const meta = metaFor(REGION_IDS, 0).meta;   // the whole world conquered
  meta.crowns = 50_000_000;
  const income0 = incomePerSec(meta);
  assert.ok(income0 > 0, 'a conquered world must pay something to begin with');
  for (let i = 0; i < 6; i++) assert.ok(buy(meta, 'treasury', null).ok);
  assert.ok(incomePerSec(meta) > income0 * 1.5, 'Treasury pays nothing');
  assert.ok(offlineCapMs(meta) > OFFLINE.baseCapMs, 'and it did not extend an absence either');

  const base = configWith({});
  const shelled = configWith({ siegeworks: 8 });
  assert.ok(shelled.player.siegeDmgMult > base.player.siegeDmgMult * 1.5,
    'Siegeworks breaks nothing');
  assert.ok(shelled.player.structureRegenMult > base.player.structureRegenMult * 1.5,
    'nor does it hold anything');
});

test('the contract did not have to change: every line rides a field that already existed', () => {
  // The number tracks bumps this test is NOT about: v4 was rules.castleGateFrac,
  // v5 the rally target list and rules.rallyKeepDefault. The point of THIS test
  // is that the six endless lines needed no field of their own — they all ride
  // fields the contract already had.
  assert.equal(CONTRACT_VERSION, 5);
  const cfg = configWith({ arms: 3, warChest: 3, drill: 3, standingArmy: 2, siegeworks: 3 });
  for (const k of ['unitAtkMult', 'unitDefMult', 'goldRateMult', 'trainCostMult',
    'siegeDmgMult', 'structureRegenMult', 'marchSpeedMult', 'farmYieldMult']) {
    assert.equal(typeof cfg.player[k], 'number', `${k} is not a contract field`);
    assert.ok(Number.isFinite(cfg.player[k]) && cfg.player[k] > 0);
  }
  assert.ok(SITE_UPGRADE[0].gold * CENTIGOLD > 0);
});
