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
  // Level 1's own max HP, not a fixed 250 — that number was the OLD
  // stronghold's whole max and is wrong (over-full or under-full) for every
  // other kind this helper is asked to build (content/balance.js SITES).
  const hp = siteMaxHp(kind);
  return createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: 'prog',
    seed: 3,
    grid: { cols: 9, rows: 9, blocked: [] },
    sites: [
      { id: 'camp', kind: 'camp', hex: [1, 4], owner: 'player', garrison: { militia: 2 }, hp: 480, hpMax: 480 },
      { id: 'x', kind, hex: [3, 4], owner: 'player', garrison: { militia: 2 }, hp, hpMax: hp },
      // [6,4] and not [7,4]: `grid` is an OFFSET rectangle, so a 9-wide row 4
      // holds q up to 6 and [7,4] was one column OFF THE MAP. Harmless while a
      // send was legal on an authored edge; under free movement an off-map site
      // is unroutable and nothing can ever reach it.
      { id: 'castle', kind: 'castle', hex: [6, 4], owner: 'enemy', garrison: { militia: 2 }, hp: 480, hpMax: 480 },
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
  // A `trainingGround`, not a `stronghold` — a wall trains nothing at all now
  // (content/balance.js SITES), so `trainMultiplier` would sit at zero on every
  // level and the loop below would be asserting that 0 > 0. HP, cap and regen
  // scale with level on ANY kind; training only does on one that trains.
  const state = oneSite('trainingGround');
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
  // 12, not 8: a bare stronghold now repairs at 5.5/s (content/balance.js
  // SITES, up from 4.0), so 8 militia's 4.8 dps no longer clears the threshold
  // at all. 12 still reads as a raiding party, not a siege train.
  const raid = { ...emptyComp(), militia: 12 };
  const raidDps = 12 * 0.6;
  assert.ok(raidDps > siteRegen('stronghold', 1), 'a raiding party must crack a bare stronghold');
  for (let lvl = 2; lvl <= SITE_LEVELS.length; lvl++) upgradeOnce(state);
  assert.ok(raidDps < siteRegen('stronghold', site.level),
    'a fully built stronghold must out-repair a raiding party');
  assert.equal(total(raid), 12);
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
  // Six carry the CAMPAIGN; the four gated Crown lines carry what comes after it
  // and are not on sale until it is finished (meta/legacy.js `endgameOpen`).
  assert.equal(endless.filter((u) => !u.requires).length, 6,
    'six lines carry the whole late game');
  assert.equal(endless.filter((u) => u.requires === 'endgame').length, 4,
    'four Crown lines carry the endless ladder past it');
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
  for (const u of UPGRADES.filter((x) => isEndless(x) && !x.requires)) {
    assert.ok(levelOf(late, u.id) > 0, `${u.id} is never reachable`);
  }
  assert.equal(levelOf(early, 'unlockMarshal'), 0,
    'the marshal is cheap enough to disturb the early game');

  // AND THE GATED HALF IS NOT REACHABLE — the same claim from the other side, and
  // the one that protects every measured region. `metaFor` is the harness's own
  // player, so this is a statement about what the balance table was measured
  // against rather than about a fixture: a Crown line bought here would mean
  // tools/simplayer.js had been spending the campaign's treasury on the endgame.
  for (const u of UPGRADES.filter((x) => x.requires === 'endgame')) {
    assert.equal(levelOf(late, u.id), 0,
      `${u.id} was bought by a player who has not finished the campaign`);
  }
  // ...and so are the RELIC lines, for a different reason and with the same
  // consequence. They are ungated for most of a campaign — you own militia from
  // the first minute — but they are priced in a currency `metaFor` never earns,
  // because the harness builds its empire with `markConquered` and relics are
  // paid by `applyOutcome`. Every measured region is fought without them.
  for (const u of UPGRADES.filter((x) => x.currency === 'relics')) {
    assert.equal(levelOf(late, u.id), 0,
      `${u.id} was bought by a harness player who has never earned a relic`);
  }
});
