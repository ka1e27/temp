// The pure half of the screens: boot routing, the loadout's composition
// arithmetic, the briefing, and the four results branches.
//
// None of these touch the DOM, which is the point — the decisions a screen
// makes are separable from the elements it builds, and they are exactly the
// parts that shipped broken (a dead 'Withdrawn' branch, an army the player
// could never change, a menu a new player had to read first).
import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, createMeta } from '../src/core/store.js';
import { UNIT_IDS } from '../src/content/balance.js';
import { REGION_IDS } from '../src/content/regions.data.js';
import { refreshUnlocks } from '../src/meta/world.js';
import { recalcIncome } from '../src/meta/idle.js';
import { buildBattleConfig, expeditionSize, fallbackMapGen } from '../src/meta/modifiers.js';
import { isFreshCampaign, bootRoute, firstRegionId } from '../src/screens/mainmenu.js';
import {
  initialComposition, nudgeComposition, canNudge, compositionTotal, regionBrief,
  UNIT_LABEL, BOOSTER_LABEL,
} from '../src/screens/prebattle.js';
import { resultCopy, statRows } from '../src/screens/results.js';

const world = (conquered = [], upgrades = {}, crowns = 0) => {
  const s = createState({ seed: 99, now: 0 });
  for (const id of conquered) s.meta.regions[id].status = 'conquered';
  Object.assign(s.meta.upgrades, upgrades);
  s.meta.crowns = crowns;
  refreshUnlocks(s.meta);
  recalcIncome(s.meta);
  return s;
};

// ===========================================================================
// Boot routing. A first-time player must not have to read a menu.
// ===========================================================================

test('a brand-new save skips the menu; anything else has something to continue', () => {
  assert.equal(isFreshCampaign(createMeta()), true);
  assert.equal(bootRoute(world()), 'new-game');

  assert.equal(bootRoute(world(['riverfen'])), 'menu', 'a conquered region');
  assert.equal(bootRoute(world([], { tithe: 1 })), 'menu', 'a purchased upgrade');
  assert.equal(bootRoute(world([], {}, 250)), 'menu', 'crowns in the bank');

  // A battle FOUGHT and lost still counts: there is progress to come back to.
  const beaten = world();
  beaten.meta.stats.battles = 1;
  assert.equal(bootRoute(beaten), 'menu');

  // ...and so does an owned booster charge.
  const stocked = world();
  stocked.meta.boosters.march = 2;
  assert.equal(bootRoute(stocked), 'menu');
});

test('the skipped-to region is the one region an empty empire can reach', () => {
  assert.equal(firstRegionId(world()), 'riverfen');
  assert.equal(firstRegionId(world()), REGION_IDS[0]);
  // Once Riverfen falls it is no longer *attackable*, so the front moves on.
  assert.notEqual(firstRegionId(world(['riverfen'])), 'riverfen');
});

// ===========================================================================
// The loadout. fitComposition() was dead code; this is what now feeds it.
// ===========================================================================

test('the loadout opens pre-filled and never blank', () => {
  const s = world();
  const comp = initialComposition(s.meta);
  assert.equal(compositionTotal(comp), expeditionSize(s.meta));
  assert.ok(comp.militia > 0 && comp.spearmen > 0, 'the default spread uses both free units');
  for (const u of ['raiders', 'rams', 'marshal']) {
    assert.equal(comp[u], 0, `${u} is locked and must not be deployed`);
  }
});

test('re-opening on a previous army re-fits it to today’s budget', () => {
  const small = world();
  const chosen = initialComposition(small.meta);
  // Two more regions and a Standing Army level: a bigger budget, same shape.
  const big = world(['riverfen', 'ashford'], { standingArmy: 2 });
  const refit = initialComposition(big.meta, chosen);
  assert.equal(compositionTotal(refit), expeditionSize(big.meta));
  assert.ok(compositionTotal(refit) > compositionTotal(chosen));
  assert.ok(refit.militia > refit.spearmen, 'the militia-heavy ratio survived the refit');
});

test('a step moves exactly one troop and NEVER changes the total', () => {
  const unlocked = ['militia', 'spearmen', 'raiders'];
  let comp = { militia: 8, spearmen: 5, raiders: 3, rams: 0, marshal: 0 };
  const before = compositionTotal(comp);

  comp = nudgeComposition(comp, 'raiders', +1, unlocked);
  assert.equal(compositionTotal(comp), before);
  assert.equal(comp.raiders, 4);
  assert.equal(comp.militia, 7, 'taken from the largest other unit');

  comp = nudgeComposition(comp, 'raiders', -1, unlocked);
  assert.equal(compositionTotal(comp), before);
  assert.equal(comp.raiders, 3);
});

test('a step can never mint, steal or leak a soldier', () => {
  const unlocked = ['militia', 'spearmen'];
  // Everything on one unit: + is impossible, - is not.
  const all = { militia: 0, spearmen: 12, raiders: 0, rams: 0, marshal: 0 };
  assert.equal(canNudge(all, 'spearmen', +1, unlocked), false);
  assert.deepEqual(nudgeComposition(all, 'spearmen', +1, unlocked), all);
  assert.equal(canNudge(all, 'spearmen', -1, unlocked), true);
  assert.equal(compositionTotal(nudgeComposition(all, 'spearmen', -1, unlocked)), 12);

  // A locked unit is not adjustable at all.
  assert.equal(canNudge(all, 'rams', +1, unlocked), false);
  // Nor is the Marshal, which is granted as exactly one.
  assert.equal(canNudge({ ...all, marshal: 1 }, 'marshal', +1, [...unlocked, 'marshal']), false);

  // A single unlocked unit has nobody to trade with.
  assert.equal(canNudge({ militia: 9 }, 'militia', +1, ['militia']), false);
  assert.equal(canNudge({ militia: 9 }, 'militia', -1, ['militia']), false);
});

test('every unit and booster the game can offer has a label', () => {
  for (const u of UNIT_IDS) assert.ok(UNIT_LABEL[u], `no label for unit ${u}`);
  for (const b of ['rally', 'march', 'bombard', 'fortify', 'tithe']) {
    assert.ok(BOOSTER_LABEL[b], `no label for booster ${b}`);
  }
});

// ===========================================================================
// What the screen chooses is what actually lands.
// ===========================================================================

test('a chosen composition survives buildBattleConfig unchanged', () => {
  const s = world(['riverfen'], { unlockRaiders: 1 });
  const total = expeditionSize(s.meta);
  let comp = initialComposition(s.meta);
  const unlocked = ['militia', 'spearmen', 'raiders'];
  for (let i = 0; i < 4; i++) comp = nudgeComposition(comp, 'raiders', +1, unlocked);

  const config = buildBattleConfig(s, 'ashford', [], fallbackMapGen, { composition: comp });
  // The seam re-fits, so this is the assertion that matters: what the player
  // built is what the camp is handed, to the soldier.
  for (const u of UNIT_IDS) assert.equal(config.player.expedition[u], comp[u], u);
  assert.equal(compositionTotal(config.player.expedition), total);
});

test('omitting the composition still yields the default weighting', () => {
  const s = world();
  const a = buildBattleConfig(s, 'riverfen', [], fallbackMapGen);
  const b = buildBattleConfig(s, 'riverfen', [], fallbackMapGen, {
    composition: initialComposition(s.meta),
  });
  assert.deepEqual(b.player.expedition, a.player.expedition);
});

// ===========================================================================
// The briefing: difficulty, size, length and reward, all off the region record.
// ===========================================================================

test('the briefing reports the region a player is deciding on', () => {
  const s = world();
  const brief = regionBrief(s.meta, 'riverfen');
  assert.equal(brief.name, 'Riverfen');
  assert.equal(brief.tier, 1);
  assert.equal(brief.raid, false);
  assert.equal(brief.reward.kind, 'conquest');
  const labels = brief.rows.map(([k]) => k);
  for (const k of ['Difficulty', 'Battlefield', 'Enemy sites', 'Typical length']) {
    assert.ok(labels.includes(k), `the briefing must state ${k}`);
  }
  assert.ok(brief.rows.some(([k]) => k === 'Conquest pays'));
  assert.equal(regionBrief(s.meta, 'nowhere'), null);
});

test('a conquered region briefs as a raid, and gets harder every clear', () => {
  const s = world(['riverfen']);
  s.meta.regions.riverfen.clears = 3;
  const brief = regionBrief(s.meta, 'riverfen');
  assert.equal(brief.raid, true);
  assert.equal(brief.reward.kind, 'raid');
  assert.equal(brief.reward.incomeAdded, 0, 'a raid never adds permanent income');
  assert.ok(brief.enemyMult > 1, 'three clears made it harder');
  assert.ok(brief.rows.some(([k]) => k === 'Raid pays'));
});

// ===========================================================================
// Results. All FOUR outcomes, including the one that used to be unreachable.
// ===========================================================================

test('every battle result reads as itself', () => {
  const region = { name: 'Riverfen' };
  const win = resultCopy({ result: 'win' }, { raided: false }, region);
  assert.match(win.title, /Riverfen is yours/);

  const raid = resultCopy({ result: 'win' }, { raided: true }, region);
  assert.match(raid.title, /raided/i);
  assert.notEqual(raid.body, win.body, 'a raid is not a conquest');

  // The branch that was dead while Withdraw was unreachable.
  const out = resultCopy({ result: 'retreat' }, {}, region);
  assert.equal(out.title, 'Withdrawn');
  assert.match(out.body, /withdrew/i);

  const late = resultCopy({ result: 'timeout' }, {}, region);
  const lost = resultCopy({ result: 'loss' }, {}, region);
  assert.notEqual(late.title, lost.title);
  assert.match(lost.body, /expedition/i, 'a defeat points at the loadout screen');

  const titles = [win, raid, out, late, lost].map((c) => c.title);
  assert.equal(new Set(titles).size, titles.length, 'four outcomes, four headlines');
});

test('money rows appear only on a win; charges spent always do', () => {
  const outcome = {
    result: 'loss', durationMs: 61_000,
    stats: { sitesHeld: 2, sitesTotal: 11, unitsLost: 30, unitsKilled: 12 },
  };
  const applied = { crowns: 0, boostersConsumed: [{ id: 'march', count: 1 }] };
  const lost = statRows(outcome, applied, 1, 1).map(([k]) => k);
  assert.ok(!lost.includes('Crowns'), 'a defeat pays nothing');
  assert.ok(lost.includes('Charges spent'), 'but it still costs what you fired');

  const won = statRows(
    { ...outcome, result: 'win' },
    { crowns: 240, boostersConsumed: [], newBest: true }, 1, 2.5,
  );
  const map = Object.fromEntries(won);
  assert.equal(map.Crowns, '+240');
  assert.match(map.Income, /→/);
  assert.match(map.Duration, /best yet/);
});
