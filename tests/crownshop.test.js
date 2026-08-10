// THE CROWN TIER — four endless lines that open when the campaign is finished.
//
// The only interesting question about them is whether they can move a measured
// number, and there are exactly two paths by which they could: the harness could
// BUY one (it shops cheapest-affordable-first straight off `shopListing`), or the
// gate could be enforced in the shop screen while `canBuy` let a purchase through
// anyway. Both are asserted here, and both are asserted as behaviour rather than
// as a property of the content table — a gate that is only true in the data is the
// same class of bug as an upgrade that crosses no seam.
import test from 'node:test';
import assert from 'node:assert/strict';

import { generateBattleMap } from '../src/battle/mapgen.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import {
  shopListing, buy, canBuy, levelOf, isAvailable, isEndless, upgradeEffects,
} from '../src/meta/upgrades.js';
import { UPGRADES, UPGRADE_BY_ID, UPGRADE_GROUPS } from '../src/content/upgrades.data.js';
import { abdicate } from '../src/meta/legacy.js';
import { incomePerSec } from '../src/meta/idle.js';
import { REGION_IDS } from '../src/content/regions.data.js';
import { metaFor, spendCrowns } from '../tools/simplayer.js';

const CROWN = UPGRADES.filter((u) => u.requires === 'endgame');
const finished = (idleMin = 30) => metaFor(REGION_IDS, idleMin, 4242).meta;
const midCampaign = () => metaFor(REGION_IDS.slice(0, 21), 30, 4242).meta;

test('crown: the tier exists, is endless, and is the only gated thing in the shop', () => {
  assert.equal(CROWN.length, 4);
  for (const u of CROWN) {
    assert.equal(u.group, 'crown');
    assert.ok(isEndless(u), `${u.id} is a gated ONE-OFF, which is a locked dead end`);
    assert.ok(u.cost.base >= 100000,
      `${u.id} costs ${u.cost.base} — the Crown tier is priced for an incursion economy`);
  }
  const gated = UPGRADES.filter((u) => u.requires);
  assert.deepEqual(gated.map((u) => u.id).sort(), CROWN.map((u) => u.id).sort());
  assert.equal(UPGRADE_GROUPS.filter((g) => g.requires).length, 1);
});

test('crown: locked for a player one region short, open the moment it falls', () => {
  const nearly = midCampaign();
  for (const u of CROWN) {
    assert.equal(isAvailable(nearly, u), false, `${u.id} is on sale with a region left`);
    const check = canBuy(nearly, u.id);
    assert.equal(check.ok, false);
    assert.equal(check.reason, 'locked');
    // The PRICE still reads, because the shop shows a locked line with what it
    // will cost. Infinity here would make that a lie about the ceiling instead.
    assert.ok(Number.isFinite(check.cost), `${u.id} hides its price while locked`);
  }
  const done = finished();
  for (const u of CROWN) assert.equal(isAvailable(done, u), true, `${u.id} never opened`);
});

test('crown: a locked line cannot be bought, however many crowns are thrown at it', () => {
  // THE PATH THAT MATTERS. The gate lives in `canBuy`, not in the screen, because
  // tools/simplayer.js never opens a screen — it calls `buy` directly.
  const meta = midCampaign();
  meta.crowns = 1e15;
  for (const u of CROWN) {
    const result = buy(meta, u.id, null);
    assert.equal(result.ok, false, `${u.id} was bought before the campaign ended`);
    assert.equal(levelOf(meta, u.id), 0);
  }
  assert.equal(meta.crowns, 1e15, 'a refused purchase still took the crowns');
});

test('crown: the harness cannot buy one at any point in the campaign', () => {
  // The negative control for the whole tier, driven through the bot's OWN shopping
  // routine at every stage of the campaign with a deliberately absurd budget. This
  // is the assertion that says the twenty-four measured win rates still describe
  // what ships.
  for (let n = 0; n <= 24; n += 4) {
    const meta = metaFor(REGION_IDS.slice(0, n), 0, 11).meta;
    spendCrowns(meta, 1e12);
    const bought = CROWN.filter((u) => levelOf(meta, u.id) > 0).map((u) => u.id);
    // n = 24 is the finished campaign, where the tier is SUPPOSED to be on sale —
    // so that case asserts the opposite, and the two together prove the gate is
    // the campaign rather than a constant `false`.
    if (n < 24) {
      assert.deepEqual(bought, [],
        `with ${n} regions taken the bot bought ${bought.join(', ')}`);
    } else {
      assert.ok(bought.length > 0,
        'with everything taken the bot bought no Crown line — the gate never opens');
    }
  }
});

test('crown: every line rides a channel that already reaches a battle', () => {
  // Four retired upgrades in this game's history were SOLD and did nothing, one of
  // them because `ramImpactHp` crossed the seam and no battle file read it. So each
  // Crown line has to move a real number on a real config.
  // A FINISHED empire rather than an abdicated one, deliberately: after a reset
  // nothing is conquered, so base income is 0 and Exchequer would have nothing to
  // multiply — the test would fail against a line that works perfectly. That the
  // gate survives a reset is a separate claim, asserted below and in
  // tests/legacy.test.js.
  const meta = finished();
  const before = buildBattleConfig(meta, 'riverfen', [], generateBattleMap, { seed: 5 });
  const incomeBefore = incomePerSec(meta);
  for (const u of CROWN) meta.upgrades[u.id] = 4;
  const after = buildBattleConfig(meta, 'riverfen', [], generateBattleMap, { seed: 5 });

  assert.ok(incomePerSec(meta) > incomeBefore, 'Exchequer does not raise income');
  assert.ok(after.player.unitAtkMult > before.player.unitAtkMult, 'War College: no attack');
  assert.ok(after.player.unitDefMult > before.player.unitDefMult, 'War College: no defence');
  assert.ok(after.player.trainSpeedMult > before.player.trainSpeedMult, 'War College: no training');
  assert.ok(after.player.siegeDmgMult > before.player.siegeDmgMult, 'Citadels: no siege');
  assert.ok(after.player.structureRegenMult > before.player.structureRegenMult,
    'Citadels: no repair');
  assert.ok(after.player.garrisonCapBonus > before.player.garrisonCapBonus,
    'Citadels: no garrison');
  assert.ok(after.player.marchSpeedMult > before.player.marchSpeedMult, 'Grand Army: no march');
  const bodies = (c) => Object.values(c.player.expedition).reduce((a, n) => a + (n || 0), 0);
  assert.ok(bodies(after) > bodies(before), 'Grand Army: no bigger landing force');
  // Offline cap too, which is the one effect that never reaches a config.
  assert.ok((upgradeEffects(meta).flat.offlineCapMs ?? 0) > 0);
});

test('crown: the tier is still on sale on a second run', () => {
  // The other half of the gate. Abdication winds every region back, so a gate that
  // asked only "is the campaign complete" would take the Crown tier away from the
  // player who has finished the game — on the run where they are relying on it.
  // `endgameOpen` is "finished it at least once" for exactly this reason.
  const meta = finished();
  abdicate(meta);
  for (const u of CROWN) {
    assert.equal(isAvailable(meta, u), true, `${u.id} closed again after abdicating`);
    assert.equal(canBuy({ ...meta, crowns: 1e15 }, u.id).reason, 'ok',
      `${u.id} cannot be bought on a second run`);
  }
});

test('crown: the shop lists the tier while it is shut, marked shut', () => {
  const groups = shopListing(midCampaign());
  const crown = groups.find((g) => g.id === 'crown');
  assert.ok(crown, 'the Crown group vanished instead of showing what it will hold');
  assert.equal(crown.open, false);
  for (const item of crown.items) {
    assert.equal(item.locked, true);
    assert.equal(item.affordable, false);
    assert.equal(item.requires, 'endgame');
  }
  // ...and the ungated groups are never marked shut, which is what stops a
  // future `requires` typo from quietly hiding the whole shop.
  for (const g of groups.filter((x) => x.id !== 'crown')) {
    assert.equal(g.open, true, `${g.id} reads as gated`);
    for (const item of g.items) assert.equal(item.locked, false);
  }
});

test('crown: an unknown requirement is refused rather than ignored', () => {
  // Content that asks for a gate meta/upgrades.js does not implement must not go
  // on sale by default. Asserted through the real predicate on a fake row.
  assert.equal(isAvailable(finished(), { id: 'x', requires: 'moon-phase' }), false);
  assert.equal(isAvailable(finished(), { id: 'y' }), true);
  assert.ok(UPGRADE_BY_ID.exchequer, 'the ids under test still exist');
});
