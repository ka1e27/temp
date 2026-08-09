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
import { SITE_LEVELS, SITE_UPGRADE, CENTIGOLD } from '../src/content/balance.js';
import { UPGRADES, UPGRADE_BY_ID, upgradeCost } from '../src/content/upgrades.data.js';
import { buy, levelOf, costToMax, shopListing } from '../src/meta/upgrades.js';
import { incomePerSec } from '../src/meta/idle.js';
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

const totalToMax = () => UPGRADES.reduce((sum, u) => {
  let c = 0;
  for (let l = 0; l < u.maxLevel; l++) c += upgradeCost(u, l);
  return sum + c;
}, 0);

test('the opening ladder is untouched — regions 1-5 are tuned against these exact costs', () => {
  // The endgame was added as NEW lines rather than extra levels on the old
  // ones, precisely so this stays true. If a level ever gets added to one of
  // these, the early campaign has to be re-measured.
  const frozen = {
    tithe: 5, warChest: 5, richSoil: 4, granary: 4, standingArmy: 6,
    drillYards: 4, veterancy: 5, bulwark: 5, sappers: 4,
  };
  for (const [id, maxLevel] of Object.entries(frozen)) {
    assert.equal(UPGRADE_BY_ID[id].maxLevel, maxLevel, `${id} maxLevel moved`);
  }
  const meta = richMeta(0);
  assert.equal(costToMax(meta, 'standingArmy'), 120 + 252 + 529 + 1111 + 2334 + 4901);
});

test('maxing the whole shop is an endgame project, not an afternoon', () => {
  const before = 59589; // what every upgrade in the game used to cost, in total
  const now = totalToMax();
  assert.ok(now > before * 50, `the shop still runs dry: ${now} crowns to max everything`);

  // The real test of "it runs out": a player who owns the entire world, has
  // bought everything they can, and idles for an hour must STILL have something
  // left on the board to buy.
  const meta = metaFor(REGION_IDS.slice(0, REGIONS.length - 1), 60).meta;
  meta.crowns += incomePerSec(meta) * 3600;
  const unbought = shopListing(meta).flatMap((g) => g.items)
    .filter((i) => i.level < i.maxLevel);
  assert.ok(unbought.length > 0, 'a full-conquest player has nothing left to buy');
  assert.ok(now > fullConquestIncome() * 3600,
    'one hour of full-conquest income must not buy the entire shop');
});

test('every shop line is affordable in the campaign it is meant for', () => {
  // The opposite failure: content nobody can ever reach. Each new line must be
  // out of reach at Kaldan and within reach by the last region.
  const early = metaFor(REGION_IDS.slice(0, 4), 10).meta;   // the Kaldan player
  const late = metaFor(REGION_IDS.slice(0, REGIONS.length - 1), 60).meta;
  for (const id of ['armoury', 'musterField', 'quartermaster', 'levyReform', 'mintage', 'ordnance']) {
    assert.equal(levelOf(early, id), 0, `${id} is cheap enough to disturb the early game`);
    assert.ok(levelOf(late, id) > 0, `${id} is never reachable`);
  }
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

test('Armoury raises the attack AND defence the simulation actually fights with', () => {
  const base = configWith({});
  const armed = configWith({ armoury: UPGRADE_BY_ID.armoury.maxLevel });
  assert.ok(armed.player.unitAtkMult > base.player.unitAtkMult * 1.4);
  assert.ok(armed.player.unitDefMult > base.player.unitDefMult * 1.4);
  // The enemy must not inherit the player's shopping.
  assert.equal(armed.enemy.unitAtkMult, base.enemy.unitAtkMult);
  assert.equal(armed.enemy.unitDefMult, base.enemy.unitDefMult);

  // And it has to change a battle, not just a field on a config: the same seed,
  // the same map, more of the enemy dead.
  const kills = (cfg) => {
    const b = startBattle(cfg);
    for (let i = 0; i < 1200 && b.status === 'running'; i++) step(b);
    return b.factions.player.unitsKilled;
  };
  assert.ok(kills(armed) > kills(base), 'a +60% army killed no more than a bare one');
});

test('Quartermaster fills the treasury the battle actually spends', () => {
  const base = configWith({});
  const rich = configWith({ quartermaster: UPGRADE_BY_ID.quartermaster.maxLevel });
  assert.equal(base.player.goldRateMult, 1, 'the baseline must be exactly 1.0');
  assert.ok(rich.player.goldRateMult > 1.5, 'goldRateMult never moved');
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

test('Levy Reform makes the same treasury buy more soldiers', () => {
  const base = configWith({});
  const cheap = configWith({ levyReform: UPGRADE_BY_ID.levyReform.maxLevel });
  assert.equal(base.player.trainCostMult, 1);
  assert.ok(cheap.player.trainCostMult < 0.6, 'trainCostMult never moved');
  assert.equal(cheap.enemy.trainCostMult, base.enemy.trainCostMult);

  const perCycle = (cfg) => {
    const b = startBattle(cfg);
    const site = b.sites.find((s) => s.owner === 'player' && trainJob(b, s));
    const job = trainJob(b, site);
    return job.cost / job.progress;   // centigold per training cycle
  };
  assert.ok(perCycle(cheap) < perCycle(base) * 0.65, 'training cost the same either way');
});

test('Muster Field lands more troops on the beach than Standing Army alone can', () => {
  const capped = configWith({ standingArmy: UPGRADE_BY_ID.standingArmy.maxLevel });
  const more = configWith({
    standingArmy: UPGRADE_BY_ID.standingArmy.maxLevel,
    musterField: UPGRADE_BY_ID.musterField.maxLevel,
  });
  const n = (cfg) => total(cfg.player.expedition);
  assert.ok(n(more) > n(capped) + 20, `expedition did not grow: ${n(capped)} -> ${n(more)}`);
  const b = startBattle(more);
  const camp = b.sites.find((s) => s.kind === 'camp');
  assert.equal(total(camp.garrison), n(more), 'the extra troops never deployed');
});

test('Royal Mint and Ordnance Yard reach the idle economy and the walls', () => {
  const meta = metaFor(REGION_IDS, 0).meta;   // the whole world conquered
  meta.crowns = 50_000_000;
  const income0 = incomePerSec(meta);
  assert.ok(income0 > 0, 'a conquered world must pay something to begin with');
  maxOut(meta, 'mintage');
  assert.ok(incomePerSec(meta) > income0 * 1.5, 'Royal Mint pays nothing');

  const siege0 = configWith({}).player.siegeDmgMult;
  const shelled = configWith({ ordnance: UPGRADE_BY_ID.ordnance.maxLevel });
  assert.ok(shelled.player.siegeDmgMult > siege0 * 1.5, 'Ordnance Yard breaks nothing');
});

test('the contract did not have to change: every new line rides a field that already existed', () => {
  // The number tracks bumps this test is NOT about: v4 was rules.castleGateFrac,
  // v5 the rally target list and rules.rallyKeepDefault. The point of THIS test
  // is that armoury/quartermaster/levyReform/musterField/ordnance did not need
  // one of their own — they all ride fields the contract already had.
  assert.equal(CONTRACT_VERSION, 5);
  const cfg = configWith({
    armoury: 3, quartermaster: 3, levyReform: 3, musterField: 2, ordnance: 3,
  });
  for (const k of ['unitAtkMult', 'unitDefMult', 'goldRateMult', 'trainCostMult', 'siegeDmgMult']) {
    assert.equal(typeof cfg.player[k], 'number', `${k} is not a contract field`);
    assert.ok(Number.isFinite(cfg.player[k]) && cfg.player[k] > 0);
  }
  assert.ok(SITE_UPGRADE[0].gold * CENTIGOLD > 0);
});
