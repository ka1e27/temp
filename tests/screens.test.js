// The pure half of the screens: boot routing, the briefing, and the four
// results branches. The expedition loadout has its own file, tests/loadout.js.
//
// None of these touch the DOM, which is the point — the decisions a screen
// makes are separable from the elements it builds, and they are exactly the
// parts that shipped broken (a dead 'Withdrawn' branch, an army the player
// could never change, a menu a new player had to read first).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createState, createMeta } from '../src/core/store.js';
import { UNIT_IDS } from '../src/content/balance.js';
import { REGION_IDS } from '../src/content/regions.data.js';
import { refreshUnlocks } from '../src/meta/world.js';
import { recalcIncome } from '../src/meta/idle.js';
import { isFreshCampaign, bootRoute, firstRegionId } from '../src/screens/mainmenu.js';
import { regionBrief, UNIT_LABEL, BOOSTER_LABEL } from '../src/screens/prebattle.js';
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

test('every unit and booster the game can offer has a label', () => {
  for (const u of UNIT_IDS) assert.ok(UNIT_LABEL[u], `no label for unit ${u}`);
  for (const b of ['rally', 'march', 'bombard', 'fortify', 'tithe']) {
    assert.ok(BOOSTER_LABEL[b], `no label for booster ${b}`);
  }
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

// ---------------------------------------------------------------------------
// A CONDITIONAL ROW UNDER A POSITIONAL SELECTOR
// ---------------------------------------------------------------------------

// worldmap.css styles the reward as the detail panel's hero figure and pulls it
// to the top. It did that with `.wm-stats dd:nth-of-type(6)` — correct while the
// list was a fixed six rows — and `Throne holds until` is CONDITIONAL, omitted
// where a region has no gate. So on every region that HAS one it took slot 6 and
// inherited the headline treatment: measured on gallowmoor, "you hold 55% of the
// map" rendered as a giant gold heading wrapped over three lines while the income
// it displaced sat in body text at the bottom. Tiers 1-2 ship no gate at all, so
// the panel looked correct exactly where anybody would have checked it.
//
// Asserted against SOURCE because that is where the rule lives: a DOM test would
// pass the moment the attribute was emitted and say nothing about the selector
// that made it necessary.
test('worldmap: the stats panel names its special rows instead of counting them', () => {
  const css = readFileSync(new URL('../src/styles/worldmap.css', import.meta.url), 'utf8');
  const stats = css.split('.wm-hint')[0];
  assert.doesNotMatch(stats, /\.wm-stats\s+d[dt]:nth-of-type/,
    'a positional selector over a list that can change length — name the row instead');

  const js = readFileSync(new URL('../src/screens/worldmap-detail.js', import.meta.url), 'utf8');
  for (const stat of ['reward', 'difficulty']) {
    assert.match(css, new RegExp(`\\[data-stat='${stat}'\\]`), `css never styles ${stat}`);
    assert.match(js, new RegExp(`'${stat}'`), `worldmap-detail.js never emits ${stat}`);
  }
  assert.match(js, /'data-stat'/, 'the attribute the CSS selects on is never set');
});
