// The expedition loadout: slot costs, the budget, and carry-over.
//
// Two features that are one number. Troops cost different numbers of slots, so
// "all marshals" stops being a free pick; and the picks carry into the next
// battle, with a grown budget arriving as militia rather than a rescale.
//
// EVERY assertion about what the player fields goes through the REAL path —
// buildBattleConfig -> startBattle -> the player camp's garrison. Nothing here
// hand-builds a config. That is deliberate: the recurring failure mode in this
// repo is a fixture that encodes the bug and a green suite that proves nothing.
// The camp garrison is the only thing that decides a battle, so it is the only
// thing worth asserting on.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createState } from '../src/core/store.js';
import { UNIT_IDS, UNIT_SLOTS, UNITS, EXPEDITION } from '../src/content/balance.js';
import { refreshUnlocks, markConquered } from '../src/meta/world.js';
import { recalcIncome } from '../src/meta/idle.js';
import {
  buildBattleConfig, expeditionSlots, compositionSlots, compositionTotal,
  distributeExpedition, carryComposition, overBudget, slotCost,
} from '../src/meta/modifiers.js';
import { nudgeComposition, canNudge } from '../src/meta/composition.js';
import { unlockedUnits } from '../src/meta/upgrades.js';
import { initialComposition, defaultComposition, budgetSummary }
  from '../src/screens/prebattle.js';
import { save, load, createMemoryStorage } from '../src/meta/save.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { startBattle } from '../src/battle/sim.js';
import { power, siegeDps } from '../src/battle/combat.js';

const world = (conquered = [], upgrades = {}) => {
  const s = createState({ seed: 77, now: 0 });
  for (const id of conquered) markConquered(s.meta, id, { now: 0, durationMs: 0 });
  Object.assign(s.meta.upgrades, upgrades);
  refreshUnlocks(s.meta);
  recalcIncome(s.meta);
  return s;
};
const ALL = { unlockRaiders: 1, unlockRams: 1, unlockMarshal: 1 };

/**
 * What the camp holds for a given CHOICE, once the free Marshal is accounted
 * for. Unlocking the marshal grants exactly one on every landing, outside the
 * slot budget (meta/modifiers.js `withFreeMarshal`), so "what you chose is what
 * lands" is now "what you chose, plus the commander you already paid for".
 */
const withFree = (state, comp) => (unlockedUnits(state.meta).includes('marshal')
  ? { ...comp, marshal: 1 } : comp);

/** Slots actually STANDING in the camp: the budget, plus the free marshal. The
 *  budget itself never buys one — `maxOf('marshal')` is 0. */
const landedSlots = (state) => expeditionSlots(state.meta)
  + (unlockedUnits(state.meta).includes('marshal') ? UNIT_SLOTS.marshal : 0);

/** THE assertion surface: what the player's camp actually holds at tick 0. */
function deployed(state, regionId, composition) {
  const config = buildBattleConfig(
    state, regionId, [], generateBattleMap, composition ? { composition } : undefined,
  );
  const battle = startBattle(config);
  const camp = battle.sites.find((s) => s.kind === 'camp' && s.owner === 'player');
  assert.ok(camp, 'the player must land in a camp');
  return camp.garrison;
}

/** As many of one unit as a budget buys, for the "is this a free pick?" tests. */
const pureStack = (unit, budget) => ({
  ...Object.fromEntries(UNIT_IDS.map((u) => [u, 0])),
  [unit]: Math.floor(budget / UNIT_SLOTS[unit]),
});
const foeOf = (unit) => ({ ...Object.fromEntries(UNIT_IDS.map((u) => [u, 0])), [unit]: 10 });

// ===========================================================================
// 1. Different values: the best unit is not a free pick
// ===========================================================================

test('slot costs are integers anchored on militia = 1, ordered by gold', () => {
  // Militia at exactly one slot is load-bearing, not cosmetic: it is what makes
  // every budget spendable to the last slot and every budget INCREASE have
  // somewhere to go without rescaling anything else.
  assert.equal(UNIT_SLOTS.militia, 1);
  const byGold = [...UNIT_IDS].sort((a, b) => UNITS[a].gold - UNITS[b].gold);
  for (let i = 1; i < byGold.length; i++) {
    const [prev, cur] = [byGold[i - 1], byGold[i]];
    assert.ok(Number.isInteger(UNIT_SLOTS[cur]) && UNIT_SLOTS[cur] >= 1, `${cur} slot cost`);
    assert.ok(
      UNIT_SLOTS[cur] > UNIT_SLOTS[prev],
      `${cur} costs more gold than ${prev} and must cost more slots`,
    );
  }
  // Compressed relative to raw gold, or a marshal (15x a militia) would cost
  // more than a whole starting expedition and never be a choice at all.
  const goldRatio = UNITS.marshal.gold / UNITS.militia.gold;
  assert.ok(UNIT_SLOTS.marshal < goldRatio, 'the curve must be compressed, not raw gold');
  assert.ok(UNIT_SLOTS.marshal > EXPEDITION.base / 3, 'a marshal must still be a real sacrifice');
});

test('for one fixed budget, four different units are the right answer', () => {
  // The complaint this feature answers: "everyone would just start with as many
  // of the best troops as possible". With slot costs there is no "best" — the
  // argmax at a FIXED budget moves with the job in front of you.
  const budget = 60;
  const stacks = Object.fromEntries(
    ['militia', 'spearmen', 'raiders', 'rams'].map((u) => [u, pureStack(u, budget)]),
  );
  for (const [u, s] of Object.entries(stacks)) {
    assert.ok(compositionSlots(s) <= budget, `${u} stack must fit the budget`);
  }
  const best = (score) => Object.entries(stacks)
    .sort((a, b) => score(b[1]) - score(a[1]))[0][0];

  assert.equal(best((s) => power(s, foeOf('spearmen'))), 'militia',
    'militia counter a spearwall');
  assert.equal(best((s) => power(s, foeOf('militia'))), 'raiders',
    'raiders counter a militia mob');
  assert.equal(best((s) => power(s, foeOf('militia'), { defending: true, onOwnSite: true })),
    'spearmen', 'spearmen hold ground');
  assert.equal(best((s) => siegeDps(s)), 'rams', 'rams break walls');
});

test('a marshal pays for its eight slots in a big army and not a small one', () => {
  // The marshal is a +20% banner over the WHOLE force, so its worth scales with
  // what is standing next to it. That is the decision; a fixed price would make
  // it either an auto-include or a trap.
  const withMarshal = (budget) => {
    const c = pureStack('militia', budget - UNIT_SLOTS.marshal);
    return { ...c, marshal: 1 };
  };
  const foe = foeOf('militia');
  const gain = (b) => power(withMarshal(b), foe) - power(pureStack('militia', b), foe);

  assert.ok(gain(16) < 0, 'at 16 slots a marshal costs more army than it buys');
  assert.ok(gain(40) > 0, 'at 40 slots the banner has enough troops to multiply');
});

// ===========================================================================
// 2. The budget cannot be exceeded — through the real path
// ===========================================================================

test('an absurd ask is clamped to the budget by the time it reaches the camp', () => {
  const s = world(['riverfen', 'ashford'], ALL);
  const budget = expeditionSlots(s.meta);
  const greedy = { militia: 999, spearmen: 999, raiders: 999, rams: 999, marshal: 999 };

  const garrison = deployed(s, 'ironwood', greedy);
  assert.equal(compositionSlots(garrison), landedSlots(s),
    'the camp holds exactly the budget, plus the free marshal');
  assert.ok(garrison.marshal <= 1, 'maxPerSite survives the clamp');
  assert.ok(compositionTotal(garrison) > 0, 'and it is not an empty army');
});

test('a marshal-only ask cannot smuggle in more than the budget allows', () => {
  const s = world([], ALL);
  const budget = expeditionSlots(s.meta);
  const garrison = deployed(s, 'riverfen', { marshal: 40 });
  assert.equal(garrison.marshal, 1, 'one per site, always');
  // The loadout no longer sells marshals at all, so an ask for forty buys none
  // of them: the whole budget goes to troops and the free one rides on top.
  assert.equal(compositionSlots(garrison), landedSlots(s));
  assert.equal(garrison.militia, budget,
    'every slot a marshal would have cost comes back as militia');
});

test('the default spread spends the budget exactly and never overspends it', () => {
  for (const conquered of [[], ['riverfen'], ['riverfen', 'ashford', 'ironwood']]) {
    for (const upgrades of [{}, ALL, { ...ALL, standingArmy: 3 }]) {
      const s = world(conquered, upgrades);
      const budget = expeditionSlots(s.meta);
      const comp = defaultComposition(s.meta);
      assert.equal(compositionSlots(comp), budget, `${conquered.length} regions`);
      assert.equal(overBudget(comp, budget), false);
      // A fresh unlock is offered, never force-fed into the opening army.
      assert.equal(comp.marshal, 0, 'the default spread never spends 8 slots unasked');
    }
  }
});

test('no sequence of + and - presses can ever exceed the budget', () => {
  const s = world(['riverfen'], ALL);
  const budget = expeditionSlots(s.meta);
  const unlocked = unlockedUnits(s.meta);
  let comp = defaultComposition(s.meta);

  // Deterministic walk over every unit and both directions, repeatedly: the
  // control is the only way a player can move the army, so it is the only place
  // an over-budget state could be born.
  for (let round = 0; round < 12; round++) {
    for (const u of unlocked) {
      for (const delta of [+1, +1, -1]) {
        const next = nudgeComposition(comp, u, delta, unlocked, budget);
        assert.ok(compositionSlots(next) <= budget, `${u} ${delta} went over budget`);
        assert.ok(UNIT_IDS.every((x) => next[x] >= 0), 'no negative counts');
        comp = next;
      }
    }
  }
  assert.equal(compositionSlots(comp), budget, 'and the budget stays fully spent');
  assert.equal(compositionSlots(deployed(s, 'ashford', comp)), landedSlots(s));
});

test('one press buys a raider by trading down, and giving it back is exact', () => {
  const unlocked = ['militia', 'spearmen', 'raiders'];
  const start = { militia: 9, spearmen: 5, raiders: 0, rams: 0, marshal: 0 };
  const budget = compositionSlots(start); // 19: fully committed already

  const bought = nudgeComposition(start, 'raiders', +1, unlocked, budget);
  assert.equal(bought.raiders, 1);
  assert.equal(bought.militia, 6, 'three militia paid for it, in one click');
  assert.equal(compositionSlots(bought), budget);

  const back = nudgeComposition(bought, 'raiders', -1, unlocked, budget);
  assert.deepEqual(back, start, 'and the trade is exactly reversible');
});

test('the Launch gate is what refuses an over-budget army', () => {
  const unlocked = ['militia', 'spearmen'];
  const legal = { militia: 9, spearmen: 5, raiders: 0, rams: 0, marshal: 0 };
  assert.equal(overBudget(legal, 19), false);
  assert.equal(overBudget(legal, 18), true, 'one slot over is over');
  assert.equal(budgetSummary(legal, 18).over, true);
  assert.equal(budgetSummary(legal, 19).free, 0);
  assert.equal(budgetSummary(legal, 25).free, 6);
  // The + control cannot build one either: with no free slots and nothing left
  // to trade, the press is refused rather than silently overspending.
  assert.equal(canNudge({ militia: 0, spearmen: 9 }, 'spearmen', +1, unlocked, 18), false);
});

// ===========================================================================
// 3. Carry-over, including a real save/load round trip
// ===========================================================================

test('a loadout survives save + load through the real persistence path', () => {
  const s = world(['riverfen'], ALL);
  const chosen = carryComposition(expeditionSlots(s.meta), unlockedUnits(s.meta), {
    militia: 4, spearmen: 3, raiders: 2, rams: 1, marshal: 1,
  });
  s.meta.loadout = { ...chosen };

  const storage = createMemoryStorage();
  assert.equal(save(s, storage, { now: 1000 }).ok, true);
  const back = load(storage, { now: 2000 });
  assert.equal(back.ok, true, back.reason);

  assert.deepEqual(back.state.meta.loadout, chosen, 'the picks came back intact');
  // And the screen re-opens on them, not on the default spread.
  const reopened = initialComposition(back.state.meta, back.state.meta.loadout);
  assert.deepEqual(reopened, chosen);
  assert.notDeepEqual(reopened, defaultComposition(back.state.meta), 'not the default');
  // ...and they are still what reaches the camp.
  assert.deepEqual(deployed(back.state, 'ashford', reopened), withFree(back.state, chosen));
});

test('a save written before loadouts existed loads to the default spread', () => {
  // meta gained a field; PERSISTED_KEYS already covered `meta` and fromPersisted
  // heals what is missing, so this must need no migration at all.
  const s = world(['riverfen']);
  const storage = createMemoryStorage();
  save(s, storage, { now: 10 });
  const raw = JSON.parse(storage.getItem('hexdominion.save'));
  delete raw.meta.loadout;
  storage.setItem('hexdominion.save', JSON.stringify(raw));

  const back = load(storage, { now: 20 });
  assert.equal(back.ok, true, back.reason);
  assert.equal(back.state.meta.loadout, null);
  assert.deepEqual(initialComposition(back.state.meta, back.state.meta.loadout),
    defaultComposition(back.state.meta));
});

test('a corrupt loadout in a save is healed, not trusted', () => {
  const s = world([]);
  const storage = createMemoryStorage();
  save(s, storage, { now: 10 });
  const raw = JSON.parse(storage.getItem('hexdominion.save'));
  raw.meta.loadout = { militia: -5, spearmen: 2.7, wyverns: 99, marshal: 'lots' };
  storage.setItem('hexdominion.save', JSON.stringify(raw));

  const healed = load(storage, { now: 20 }).state.meta.loadout;
  assert.deepEqual(healed, { militia: 0, spearmen: 2, raiders: 0, rams: 0, marshal: 0 });
  assert.equal(healed.wyverns, undefined, 'an unknown unit id never enters the state');
});

// ===========================================================================
// 4. A budget that grew becomes militia; the picks survive
// ===========================================================================

test('extra slots become militia and every other pick is left alone', () => {
  const small = world(['riverfen'], ALL);
  const chosen = carryComposition(expeditionSlots(small.meta), unlockedUnits(small.meta), {
    militia: 2, spearmen: 2, raiders: 3, rams: 1, marshal: 1,
  });

  const big = world(['riverfen', 'ashford', 'ironwood'], { ...ALL, standingArmy: 2 });
  const grown = expeditionSlots(big.meta) - expeditionSlots(small.meta);
  assert.ok(grown > 0, 'the empire must actually have grown for this to mean anything');

  const carried = initialComposition(big.meta, chosen);
  for (const u of UNIT_IDS) {
    if (u === 'militia') continue;
    assert.equal(carried[u], chosen[u], `${u} must be exactly what the player picked`);
  }
  assert.equal(carried.militia, chosen.militia + grown, 'the growth arrived as militia');
  assert.equal(compositionSlots(carried), expeditionSlots(big.meta));

  // NOT a rescale: a proportional re-fit would have bought more raiders too.
  const rescaled = distributeExpedition(expeditionSlots(big.meta), unlockedUnits(big.meta), chosen);
  assert.notEqual(rescaled.raiders, carried.raiders, 'a rescale is the thing we are not doing');

  // And the carried army is what the camp is handed, to the soldier — plus the
  // commander the unlock grants free.
  assert.deepEqual(deployed(big, 'saltmere', carried), withFree(big, carried));
});

test('a newly unlocked unit is offered, never force-fed into the carried army', () => {
  const before = world(['riverfen']);
  const chosen = defaultComposition(before.meta);
  assert.equal(chosen.raiders, 0, 'raiders are not unlocked yet');

  // Buy raiders and a marshal between battles. Neither may appear unasked.
  const after = world(['riverfen'], ALL);
  const carried = initialComposition(after.meta, chosen);
  assert.equal(carried.raiders, 0, 'the player opts in; the shop does not');
  assert.equal(carried.marshal, 0);
  assert.ok(unlockedUnits(after.meta).includes('raiders'), 'but they ARE available');
  assert.equal(canNudge(carried, 'raiders', +1, unlockedUnits(after.meta),
    expeditionSlots(after.meta)), true, 'and one press brings them in');

  assert.equal(deployed(after, 'ashford', carried).raiders, 0);
});

test('carrying into an unchanged budget changes nothing at all', () => {
  const s = world(['riverfen'], ALL);
  const budget = expeditionSlots(s.meta);
  const chosen = carryComposition(budget, unlockedUnits(s.meta), { militia: 5, rams: 2, marshal: 1 });
  assert.deepEqual(initialComposition(s.meta, chosen), chosen);
  // The seam re-fits everything it is handed; on an exactly-fitting army that
  // re-fit must be an identity, or carry-over would be undone in transit.
  assert.deepEqual(deployed(s, 'ashford', chosen), withFree(s, chosen));
});

// ===========================================================================
// 5. A locked unit never appears
// ===========================================================================

test('a locked unit never reaches the camp, however it got into the ask', () => {
  const s = world(['riverfen']); // militia + spearmen only
  const unlocked = unlockedUnits(s.meta);
  assert.deepEqual(unlocked, ['militia', 'spearmen']);

  // A stale save, a refunded unlock, a hand-edited params object: same answer.
  const stale = { militia: 3, spearmen: 2, raiders: 6, rams: 4, marshal: 1 };
  s.meta.loadout = stale;
  const carried = initialComposition(s.meta, s.meta.loadout);
  for (const u of ['raiders', 'rams', 'marshal']) assert.equal(carried[u], 0, u);
  assert.equal(compositionSlots(carried), expeditionSlots(s.meta));

  for (const ask of [stale, carried]) {
    const garrison = deployed(s, 'ashford', ask);
    for (const u of ['raiders', 'rams', 'marshal']) {
      assert.equal(garrison[u], 0, `${u} is locked but reached the camp`);
    }
    assert.equal(compositionSlots(garrison), expeditionSlots(s.meta));
  }
});

test('the config the seam validates agrees with the camp it produces', () => {
  // Belt and braces on the one hop this file cannot see inside: the expedition
  // in the BattleConfig and the garrison at tick 0 must be the same army.
  const s = world(['riverfen', 'ashford'], ALL);
  const comp = initialComposition(s.meta, { militia: 6, raiders: 4, marshal: 1 });
  const config = buildBattleConfig(s, 'ironwood', [], generateBattleMap, { composition: comp });
  const battle = startBattle(config);
  const camp = battle.sites.find((x) => x.kind === 'camp' && x.owner === 'player');
  assert.deepEqual(camp.garrison, config.player.expedition);
  assert.equal(compositionSlots(config.player.expedition), landedSlots(s));
  assert.equal(slotCost('marshal'), UNIT_SLOTS.marshal);
});
