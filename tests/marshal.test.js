// THE MARSHAL, and the two things that made a 4,000-crown unlock not worth using.
//
// Buying him used to buy the RIGHT to spend eight expedition slots on one body —
// 42% of a region-1 budget — or to retask a stronghold for forty seconds and
// remember to set it back. Both are a bill, not a reward.
//
// Now: the unlock grants exactly one on every landing, outside the budget, and
// more can be COMMISSIONED at a site for gold without touching what it trains.
// Every assertion here goes through the real seam or the real command drain,
// because "the upgrade crosses the seam and nothing reads it" is this project's
// signature failure and the marshal was already one instance of it.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createState } from '../src/core/store.js';
import { markConquered, refreshUnlocks } from '../src/meta/world.js';
import { buildBattleConfig, expeditionSlots } from '../src/meta/modifiers.js';
import { compositionSlots, maxOf, distributeExpedition } from '../src/meta/composition.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { createBattleState } from '../src/battle/state.js';
import { drainCommands } from '../src/battle/commands.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { emptyComp } from '../src/battle/combat.js';
import { goldOf } from '../src/battle/economy.js';
import { UNIT_SLOTS, UNITS, RECRUIT, CENTIGOLD } from '../src/content/balance.js';
import { TICK_HZ } from '../src/core/loop.js';
import { recruitOffer } from '../src/screens/battle-actions.js';

const world = (conquered = [], upgrades = {}) => {
  const s = createState({ seed: 7, now: 0 });
  for (const id of conquered) markConquered(s.meta, id, { now: 0, durationMs: 0 });
  Object.assign(s.meta.upgrades, upgrades);
  refreshUnlocks(s.meta);
  return s;
};
const campOf = (state, region, composition) => {
  const cfg = buildBattleConfig(state, region, [], generateBattleMap,
    composition ? { composition } : undefined);
  return cfg.player.expedition;
};

// ---------------------------------------------------------------------------
// Free at landing
// ---------------------------------------------------------------------------

test('marshal: unlocking one puts one in every expedition, at no slot cost', () => {
  const without = world(['riverfen']);
  const with_ = world(['riverfen'], { unlockMarshal: 1 });
  assert.equal(expeditionSlots(without.meta), expeditionSlots(with_.meta),
    'the unlock must not change the budget itself');

  assert.equal(campOf(without, 'ashford').marshal, 0);
  assert.equal(campOf(with_, 'ashford').marshal, 1);
});

test('marshal: the free one rides OUTSIDE the budget, so troops do not pay for it', () => {
  const s = world(['riverfen'], { unlockMarshal: 1 });
  const budget = expeditionSlots(s.meta);
  const camp = campOf(s, 'ashford');

  assert.equal(compositionSlots(camp), budget + UNIT_SLOTS.marshal);
  // The real regression this guards: an expedition of the same budget WITHOUT
  // the unlock must field exactly as many troops. If the marshal were inside
  // the budget, unlocking him would silently shrink the army by eight slots.
  const bare = campOf(world(['riverfen']), 'ashford');
  for (const u of ['militia', 'spearmen', 'raiders', 'rams']) {
    assert.equal(camp[u], bare[u], `${u} count changed when the marshal was unlocked`);
  }
});

test('marshal: the loadout cannot buy one, so its slots can never be wasted on it', () => {
  // `banner` is presence-based, so a second marshal in the same camp buys
  // literally nothing. Selling one in the loadout would be a trap rather than a
  // choice, which is why maxOf is 0 rather than 1.
  assert.equal(maxOf('marshal'), 0);
  const s = world([], { unlockMarshal: 1 });
  const budget = expeditionSlots(s.meta);

  const asked = campOf(s, 'riverfen', { marshal: 40 });
  assert.equal(asked.marshal, 1, 'exactly the free one, however many were asked for');
  assert.equal(asked.militia, budget,
    'every slot a marshal would have cost comes back as troops');

  // ...and the default spread never reaches for one either.
  assert.equal(distributeExpedition(budget, ['militia', 'marshal']).marshal, 0);
});

// ---------------------------------------------------------------------------
// Commissioning: the in-battle verb
// ---------------------------------------------------------------------------

function battle({ gold = 1000, unlocked = ['militia', 'spearmen', 'marshal'] } = {}) {
  return createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: 'marshal',
    seed: 1,
    grid: { cols: 9, rows: 9, blocked: [] },
    sites: [
      { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 4 }, hp: 480, hpMax: 480 },
      // A `trainingGround`, not a `stronghold` — a wall trains nothing at all
      // now (content/balance.js SITES), and commissioning is gated on the same
      // `SITES[kind].train` check training is (battle/commands.js `cmdRecruit`).
      // A stronghold here would make every `order(s, 'hold')` below fail with
      // `site-cannot-train`, which is a real rejection, not the one under test.
      { id: 'hold', kind: 'trainingGround', hex: [1, 0], owner: 'player', garrison: { spearmen: 3 }, hp: 180, hpMax: 180 },
      { id: 'farm', kind: 'farm', hex: [2, 0], owner: 'player', garrison: { militia: 2 }, hp: 100, hpMax: 100 },
      { id: 'foe', kind: 'farm', hex: [3, 0], owner: 'enemy', garrison: { militia: 2 }, hp: 100, hpMax: 100 },
    ],
    adjacency: [['camp', 'hold'], ['hold', 'farm'], ['farm', 'foe']],
    player: makeMods({ expedition: emptyComp(), startGold: gold, unlockedUnits: unlocked }),
    enemy: makeMods({ expedition: emptyComp() }),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 480000, aiTier: 1 },
  });
}
const at = (s, id) => s.sites.find((x) => x.id === id);
const order = (s, site, unit = 'marshal') => {
  s.commands.push({ t: 'RECRUIT', site, unit });
  drainCommands(s);
};
const rejections = (s) => s.events.filter((e) => e.type === 'command-rejected')
  .map((e) => e.reason);

test('marshal: commissioning delivers one at once and charges for it', () => {
  const s = battle();
  const before = goldOf(s.factions.player);
  order(s, 'hold');

  assert.deepEqual(rejections(s), []);
  assert.equal(at(s, 'hold').garrison.marshal, 1, 'he is standing there this tick');
  assert.equal(before - goldOf(s.factions.player), RECRUIT.marshal.gold * CENTIGOLD);
});

test('marshal: commissioning does NOT disturb what the site trains', () => {
  // The whole point. Getting a marshal used to cost a stronghold's entire output
  // for forty seconds because retasking was the only route.
  const s = battle();
  at(s, 'hold').trainType = 'spearmen';
  at(s, 'hold').trainProgress = 0.6;
  order(s, 'hold');

  assert.equal(at(s, 'hold').trainType, 'spearmen', 'the wall keeps building spears');
  assert.equal(at(s, 'hold').trainProgress, 0.6, 'and does not lose its progress');
});

test('marshal: one per site still binds, and a farm cannot commission at all', () => {
  const s = battle();
  order(s, 'hold');
  order(s, 'hold');
  assert.deepEqual(rejections(s), ['already-commissioned']);
  assert.equal(at(s, 'hold').garrison.marshal, 1);

  s.events = [];
  order(s, 'farm');
  assert.deepEqual(rejections(s), ['site-cannot-train']);
});

test('marshal: it is refused when locked, unaffordable, or not yours', () => {
  const locked = battle({ unlocked: ['militia', 'spearmen'] });
  order(locked, 'hold');
  assert.deepEqual(rejections(locked), ['unit-locked']);

  const poor = battle({ gold: 10 });
  order(poor, 'hold');
  assert.deepEqual(rejections(poor), ['insufficient-gold']);
  assert.equal(at(poor, 'hold').garrison.marshal ?? 0, 0, 'and nothing was delivered');

  const theirs = battle();
  order(theirs, 'foe');
  assert.deepEqual(rejections(theirs), ['not-your-site']);
});

test('marshal: only units with a per-site cap can be commissioned', () => {
  // The cap is what makes "buy it outright" safe — there is no amount of gold
  // that turns into an army this way. Militia have no cap and no price.
  const s = battle();
  order(s, 'hold', 'militia');
  assert.deepEqual(rejections(s), ['not-commissionable']);
  assert.equal(UNITS.marshal.maxPerSite, 1);
});

// ---------------------------------------------------------------------------
// The cooldown
// ---------------------------------------------------------------------------

test('marshal: the cooldown is FACTION-WIDE, not per site', () => {
  // The negative control is the shape of the test itself: two DIFFERENT sites,
  // so `already-commissioned` cannot be what refuses the second one. Without a
  // faction-wide cooldown this passes trivially, which is the point.
  const s = battle({ gold: 100000 });
  order(s, 'hold');
  assert.deepEqual(rejections(s), []);

  s.events = [];
  order(s, 'camp');
  assert.deepEqual(rejections(s), ['recruit-cooling']);
  assert.equal(at(s, 'camp').garrison.marshal ?? 0, 0, 'and nothing was delivered');
});

test('marshal: the cooldown is paid in gold ONCE — a refusal charges nothing', () => {
  const s = battle({ gold: 100000 });
  order(s, 'hold');
  const after = goldOf(s.factions.player);
  order(s, 'camp');
  assert.equal(goldOf(s.factions.player), after, 'a refused order is free');
});

test('marshal: it comes back when the cooldown runs out', () => {
  const s = battle({ gold: 100000 });
  order(s, 'hold');
  const readyAt = s.factions.player.recruitReadyTick.marshal;
  assert.equal(readyAt, Math.round(RECRUIT.marshal.cooldownSec * TICK_HZ),
    'stamped in SIM state, so it survives a resume and replays from a command log');

  s.tick = readyAt - 1;
  s.events = [];
  order(s, 'camp');
  assert.deepEqual(rejections(s), ['recruit-cooling'], 'one tick short is still short');

  s.tick = readyAt;
  s.events = [];
  order(s, 'camp');
  assert.deepEqual(rejections(s), []);
  assert.equal(at(s, 'camp').garrison.marshal, 1);
});

test('marshal: the cooldown does not follow him from one battle to the next', () => {
  // Every faction starts a fight able to commission. A cooldown that leaked
  // across battles would be a meta resource wearing sim state's clothes.
  const s = battle({ gold: 100000 });
  order(s, 'hold');
  assert.ok(s.factions.player.recruitReadyTick.marshal > 0);
  assert.deepEqual(battle().factions.player.recruitReadyTick, {});
});

// ---------------------------------------------------------------------------
// The button that fires it
// ---------------------------------------------------------------------------

test('marshal: the panel offers Recruit exactly where it is legal', () => {
  const s = battle();
  assert.equal(recruitOffer(s, at(s, 'hold')).shown, true);
  assert.equal(recruitOffer(s, at(s, 'hold')).can, true);
  assert.equal(recruitOffer(s, at(s, 'farm')).shown, false, 'farms cannot train');
  assert.equal(recruitOffer(s, at(s, 'foe')).shown, false, 'not your site');
  assert.equal(recruitOffer(battle({ unlocked: ['militia'] }), at(s, 'hold')).shown, false,
    'the action does not exist before the unlock');
});

test('marshal: the button explains itself rather than just going dead', () => {
  const poor = battle({ gold: 10 });
  const offer = recruitOffer(poor, at(poor, 'hold'));
  assert.equal(offer.shown, true, 'still shown, so the price is discoverable');
  assert.equal(offer.can, false);
  assert.match(offer.why, /gold/i);
  assert.match(offer.label, new RegExp(`${RECRUIT.marshal.gold}`));

  const s = battle();
  order(s, 'hold');
  assert.match(recruitOffer(s, at(s, 'hold')).why, /already/i);
});

test('marshal: the button counts the cooldown down instead of just going dead', () => {
  const s = battle({ gold: 100000 });
  order(s, 'hold');

  // At a site that could otherwise take one — so this is the cooldown talking,
  // not the per-site cap.
  const cooling = recruitOffer(s, at(s, 'camp'));
  assert.equal(cooling.shown, true);
  assert.equal(cooling.can, false);
  assert.equal(cooling.label, `Marshal · ${RECRUIT.marshal.cooldownSec}s`);

  s.tick = s.factions.player.recruitReadyTick.marshal - TICK_HZ * 4;
  assert.equal(recruitOffer(s, at(s, 'camp')).label, 'Marshal · 4s');

  s.tick = s.factions.player.recruitReadyTick.marshal;
  const ready = recruitOffer(s, at(s, 'camp'));
  assert.equal(ready.can, true);
  assert.match(ready.label, new RegExp(`${RECRUIT.marshal.gold}g`),
    'and goes back to showing the price');
});
