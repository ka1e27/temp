// RELICS: the currency that cannot be waited for, and the troop lines it buys.
//
// The whole reason this could ship without re-measuring a single region is one
// claim, and it is the claim this file exists to prove: THE HARNESS EARNS NONE.
// tools/simplayer.js shops cheapest-affordable-first straight off `shopListing`
// and would happily buy a 4-cost line at region one — but relics are paid by
// meta/rewards.js `applyOutcome`, and the harness builds its empire by calling
// `markConquered` directly. So every battle in content/regions.data.js is
// fought at zero relics, exactly as the Crown tier is fought behind a shut gate.
//
// tests/crownshop.test.js proves the same thing about the endgame gate by
// driving the bot's own shopping routine, and this file drives it the same way,
// for the same reason: a gate the LISTING respects and a purchase does not is
// worth nothing.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createState } from '../src/core/store.js';
import { markConquered, refreshUnlocks } from '../src/meta/world.js';
import { applyOutcome, conquestRelics, incursionRelics } from '../src/meta/rewards.js';
import { buy, canBuy, levelOf, shopListing, upgradeEffects, unitMults } from '../src/meta/upgrades.js';
import { buyCharge, canBuyCharge, countOf } from '../src/meta/boosters.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { abdicate } from '../src/meta/prestige.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { startBattle } from '../src/battle/sim.js';
import { toOutcome } from '../src/battle/outcome.js';
import { power } from '../src/battle/combat.js';
import { UPGRADES, BOOSTER_SHOP } from '../src/content/upgrades.data.js';
import { REGIONS, REGION_BY_ID } from '../src/content/regions.data.js';
import { spendCrowns, metaFor } from '../tools/simplayer.js';

const REGION_IDS = REGIONS.map((r) => r.id);
const RELIC_LINES = UPGRADES.filter((u) => u.currency === 'relics');

function world(conquered = [], { crowns = 0, relics = 0 } = {}) {
  const s = createState({ seed: 3, now: 0 });
  for (const id of conquered) markConquered(s.meta, id, { now: 0, durationMs: 0 });
  s.meta.crowns = crowns;
  s.meta.relics = relics;
  refreshUnlocks(s.meta);
  return s.meta;
}

// ---------------------------------------------------------------------------
// The negative control: the campaign was measured without these
// ---------------------------------------------------------------------------

test('relics: the harness never earns one, at any point in the campaign', () => {
  for (let n = 0; n <= REGIONS.length; n++) {
    const meta = metaFor(REGION_IDS.slice(0, n), 60).meta;
    assert.equal(meta.relics ?? 0, 0,
      `the harness player had relics with ${n} regions conquered`);
  }
});

test('relics: the bot cannot buy a relic line however rich it is', () => {
  // Driven through the harness's OWN shopping routine with a budget no campaign
  // could produce. If `spendCrowns` could reach these, every number in
  // regions.data.js would describe a different player than the one measured.
  for (let n = 0; n <= REGIONS.length; n += 6) {
    const meta = metaFor(REGION_IDS.slice(0, n)).meta;
    spendCrowns(meta, 1e12, null);
    for (const u of RELIC_LINES) {
      assert.equal(levelOf(meta, u.id), 0,
        `${u.id} was bought at ${n} conquests with a 10^12 crown budget`);
    }
  }
});

test('relics: ...and it DOES buy them once it has relics — the positive half', () => {
  // Without this the test above would pass just as happily against a line that
  // is unbuyable for some other reason, or against a `canBuy` that returns
  // false unconditionally.
  const meta = metaFor(REGION_IDS.slice(0, 12)).meta;
  meta.relics = 5000;
  spendCrowns(meta, 1e12, null);
  const bought = RELIC_LINES.filter((u) => levelOf(meta, u.id) > 0);
  assert.ok(bought.length > 0, 'a player WITH relics must be able to spend them');
});

test('relics: a treasury full of crowns buys none of it', () => {
  const meta = world(REGION_IDS.slice(0, 12), { crowns: 1e12, relics: 0 });
  for (const u of RELIC_LINES) {
    const check = canBuy(meta, u.id);
    if (check.reason === 'locked') continue;         // troop not unlocked yet
    assert.equal(check.ok, false, `${u.id} was affordable on crowns alone`);
    assert.equal(check.currency, 'relics');
    assert.equal(buy(meta, u.id, null).ok, false);
  }
  assert.equal(meta.crowns, 1e12, 'and nothing was deducted from the wrong purse');
});

// ---------------------------------------------------------------------------
// Where they come from
// ---------------------------------------------------------------------------

/** Play `regionId` to a real BattleOutcome by handing the castle over. */
function winOutcome(meta, regionId) {
  const config = buildBattleConfig(meta, regionId, [], generateBattleMap, { seed: 7 });
  const battle = startBattle(config);
  for (const s of battle.sites) s.owner = 'player';
  battle.status = 'win';        // `toOutcome` reports anything else as a timeout
  return { config, outcome: toOutcome(battle, config) };
}

test('relics: a first conquest pays its TIER, and a raid pays nothing', () => {
  const meta = world([], { crowns: 0 });
  const { config, outcome } = winOutcome(meta, 'riverfen');

  const first = applyOutcome(meta, config, outcome, { now: 1 });
  assert.equal(first.conquered, true);
  assert.equal(first.relics, conquestRelics(REGION_BY_ID.riverfen));
  assert.equal(meta.relics, first.relics);
  assert.equal(meta.stats.relicsEarned, first.relics);

  // ...and taking it AGAIN pays crowns and no relics. This is the whole reason
  // relics can be scarce: any per-clear source is a farm.
  const again = applyOutcome(meta, config, outcome, { now: 2 });
  assert.equal(again.raided, true);
  assert.ok(again.crowns > 0, 'a raid still pays crowns');
  assert.equal(again.relics, 0);
  assert.equal(meta.relics, first.relics, 'the total did not move');
});

test('relics: a whole campaign is worth 78, and it is back-loaded', () => {
  const total = REGIONS.reduce((a, r) => a + conquestRelics(r), 0);
  assert.equal(total, 78);
  const firstFour = REGIONS.slice(0, 4).reduce((a, r) => a + conquestRelics(r), 0);
  assert.equal(firstFour, 4,
    'tier 1 pays one each — a first-run player must not be levelling troops'
    + ' before the balance table has met them');
});

test('relics: a rung pays more the deeper it is, and never zero', () => {
  assert.equal(incursionRelics(1), 1);
  assert.equal(incursionRelics(4), 1);
  assert.equal(incursionRelics(5), 2);
  assert.equal(incursionRelics(40), 9);
  let prev = 0;
  for (let d = 1; d <= 60; d++) {
    const n = incursionRelics(d);
    assert.ok(n >= prev && n >= 1, `depth ${d} pays ${n}`);
    prev = n;
  }
});

// ---------------------------------------------------------------------------
// What they buy
// ---------------------------------------------------------------------------

test('relics: booster charges are billed to them, and the treasury is not touched', () => {
  const meta = world([], { crowns: 1e9, relics: 10 });
  meta.upgrades.boosterRally = 1;
  const cost = BOOSTER_SHOP.rally.chargeCost;

  assert.equal(canBuyCharge(meta, 'rally', 1).currency, 'relics');
  assert.equal(buyCharge(meta, 'rally', 2, null).ok, true);
  assert.equal(countOf(meta, 'rally'), 2);
  assert.equal(meta.relics, 10 - cost * 2);
  assert.equal(meta.crowns, 1e9);

  meta.relics = 0;
  assert.equal(buyCharge(meta, 'rally', 1, null).ok, false,
    'a billion crowns must not buy a single charge');
});

test('relics: a troop line is on sale only once you own the troop', () => {
  const meta = world([], { relics: 1000 });
  assert.equal(canBuy(meta, 'vetMilitia').ok, true, 'militia are free from the start');
  assert.equal(canBuy(meta, 'vetSappers').reason, 'locked');
  assert.equal(buy(meta, 'vetSappers', null).ok, false);

  // ...and the row is HIDDEN rather than shown locked, unlike a Crown line.
  const shown = shopListing(meta).find((g) => g.id === 'troops').items.map((i) => i.id);
  assert.deepEqual(shown, ['vetMilitia', 'vetSpearmen']);

  meta.upgrades.unlockSappers = 1;
  refreshUnlocks(meta);
  assert.equal(canBuy(meta, 'vetSappers').ok, true);
  assert.ok(shopListing(meta).find((g) => g.id === 'troops').items
    .some((i) => i.id === 'vetSappers'));
});

test('relics: a troop line raises THAT troop and no other', () => {
  const meta = world([], { relics: 1000 });
  for (let i = 0; i < 4; i++) assert.ok(buy(meta, 'vetMilitia', null).ok);
  const mult = unitMults(upgradeEffects(meta));

  assert.equal(mult.militia, 1 + 0.06 * 4);
  assert.equal(mult.spearmen, undefined, 'sparse: an unlevelled troop has no entry');
  assert.deepEqual(Object.keys(mult), ['militia']);
});

test('relics: it reaches the simulation, on the exact unit bought', () => {
  // Through `power` itself, the function the sim and the pre-commit preview both
  // call — an upgrade that crosses the seam and is never read is this project's
  // signature bug, and four of them shipped that way.
  const comp = { militia: 20, spearmen: 20 };
  const foe = { militia: 10 };
  const base = power(comp, foe, {});
  const withVets = power(comp, foe, { unitMult: { militia: 1.24 } });
  assert.ok(withVets > base);

  // The negative control: the SAME multiplier on a unit the army does not field
  // changes nothing at all.
  assert.equal(power(comp, foe, { unitMult: { rams: 3 } }), base);
});

test('relics: it crosses the seam sparse, and is EMPTY for an ordinary player', () => {
  const bare = world(REGION_IDS.slice(0, 8), { crowns: 1e9 });
  const cfg = buildBattleConfig(bare, 'gallowmoor', [], generateBattleMap, { seed: 4 });
  assert.deepEqual(cfg.player.unitMult, {},
    'every measured region is fought with an empty map — that is the guarantee');
  assert.deepEqual(cfg.enemy.unitMult, {}, 'and the enemy has no troop lines at all');

  const vet = world(REGION_IDS.slice(0, 8), { crowns: 1e9, relics: 1000 });
  for (let i = 0; i < 3; i++) buy(vet, 'vetMilitia', null);
  const cfg2 = buildBattleConfig(vet, 'gallowmoor', [], generateBattleMap, { seed: 4 });
  assert.ok(cfg2.player.unitMult.militia > 1);
});

// ---------------------------------------------------------------------------
// What survives a reset
// ---------------------------------------------------------------------------

test('relics: they survive abdication, and so do the lines they bought', () => {
  // The point of a hard currency is that what it buys sticks. Crowns and the
  // Empire ladder are the run's; relics and the troop lines are the PLAYER's,
  // exactly like the incursion ladder they are half-earned from.
  const meta = world(REGION_IDS, { crowns: 500000, relics: 40 });
  for (let i = 0; i < 3; i++) assert.ok(buy(meta, 'vetMilitia', null).ok);
  meta.upgrades.arms = 5;
  const relicsBefore = meta.relics;
  const vetBefore = levelOf(meta, 'vetMilitia');

  const res = abdicate(meta, { now: 0 });
  assert.equal(res.ok, true);
  assert.equal(meta.crowns, 0, 'the treasury is the run\'s and it goes');
  assert.equal(levelOf(meta, 'arms'), 0, 'and so does the crown-bought ladder');
  assert.equal(meta.relics, relicsBefore, 'relics are the player\'s and they stay');
  assert.equal(levelOf(meta, 'vetMilitia'), vetBefore, 'and so is what they bought');
});
