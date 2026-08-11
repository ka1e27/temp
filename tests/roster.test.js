// THE LOADOUT IS THE ROSTER: the five types you pick are the five you can build.
//
// `LOADOUT_TYPES_MAX` capped what you could BRING and nothing capped what you
// could then TRAIN, so the decision the cap exists to create — which answers am
// I bringing to this map — expired the moment you captured somebody's yard.
// You picked five types at the briefing and built the other three out of enemy
// strongholds, at no cost and with no message saying so.
//
// The gate is `unlockedUnits` on the player's side of the seam, which `cmdTrain`
// already enforced; nothing in the engine changed. So the assertions here run
// through the real `buildBattleConfig` and the real command drain, because a
// hand-built mods object would prove only that this file agrees with itself.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createState } from '../src/core/store.js';
import { markConquered, refreshUnlocks } from '../src/meta/world.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { battleRoster } from '../src/meta/composition.js';
import { unlockedUnits } from '../src/meta/upgrades.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { createBattleState } from '../src/battle/state.js';
import { drainCommands } from '../src/battle/commands.js';
import { trainableUnit, isTrainable } from '../src/battle/training.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { emptyComp } from '../src/battle/combat.js';
import { UNIT_IDS } from '../src/content/balance.js';

const ALL_UNLOCKED = {
  unlockRaiders: 1, unlockRams: 1, unlockMarshal: 1,
  unlockOutriders: 1, unlockHalberds: 1, unlockSappers: 1,
};

function world(conquered = [], upgrades = ALL_UNLOCKED) {
  const s = createState({ seed: 5, now: 0 });
  for (const id of conquered) markConquered(s.meta, id, { now: 0, durationMs: 0 });
  Object.assign(s.meta.upgrades, upgrades);
  refreshUnlocks(s.meta);
  return s;
}

const CONQUERED = ['riverfen', 'ashford', 'ironwood', 'saltmere', 'kaldan',
  'highmarch', 'greywater', 'thornmoor'];

// ---------------------------------------------------------------------------
// The rule itself
// ---------------------------------------------------------------------------

test('roster: only what the army actually carries, in roster order', () => {
  const unlocked = [...UNIT_IDS];
  assert.deepEqual(battleRoster(unlocked, { rams: 2, militia: 30 }), ['militia', 'rams'],
    'canonical order, not the order the object happens to list them in');
  assert.deepEqual(battleRoster(unlocked, { spearmen: 4, halberds: 1 }),
    ['spearmen', 'halberds']);
});

test('roster: a type you did not unlock cannot sneak in through the composition', () => {
  // The loadout screen cannot offer one, but a hand-edited params object or a
  // save written before an unlock was retired could still name it.
  assert.deepEqual(battleRoster(['militia', 'spearmen'], { militia: 5, sappers: 9 }),
    ['militia']);
});

test('roster: an empty army falls back rather than breaking the contract', () => {
  // `unlockedUnits` is required NON-EMPTY at the seam. A degenerate loadout is a
  // tuning problem; a contract violation is a crash, and the crash is worse.
  assert.deepEqual(battleRoster(['militia', 'raiders'], {}), ['militia', 'raiders']);
  assert.deepEqual(battleRoster(['militia'], null), ['militia']);
});

// ---------------------------------------------------------------------------
// Through the real seam
// ---------------------------------------------------------------------------

test('roster: the config narrows to the loadout even with everything unlocked', () => {
  const s = world(CONQUERED);
  assert.ok(unlockedUnits(s.meta).length >= 7, 'the shop really has sold the roster');

  const cfg = buildBattleConfig(s.meta, 'emberholt', [], generateBattleMap, {
    composition: { militia: 6, halberds: 2 },
  });
  const brought = UNIT_IDS.filter((u) => (cfg.player.expedition[u] ?? 0) > 0);
  assert.deepEqual(cfg.player.unlockedUnits, brought);
  assert.ok(!cfg.player.unlockedUnits.includes('sappers'),
    'unlocked and left at home is the same as not owned, once the ship sails');
});

test('roster: the free Marshal is still in it, because he still lands', () => {
  // He rides outside the budget (meta/marshals.js), so he is in the expedition,
  // so he is in the roster — which is what keeps RECRUIT working. A narrowing
  // that dropped him would have silently retired a 4,000-crown unlock.
  const s = world(CONQUERED);
  const cfg = buildBattleConfig(s.meta, 'emberholt', [], generateBattleMap, {
    composition: { militia: 10 },
  });
  assert.equal(cfg.player.expedition.marshal, 1);
  assert.ok(cfg.player.unlockedUnits.includes('marshal'));
});

test('roster: the ENEMY is untouched — its roster is its tier, not a loadout', () => {
  const s = world(CONQUERED);
  const cfg = buildBattleConfig(s.meta, 'emberholt', [], generateBattleMap, {
    composition: { militia: 10 },
  });
  assert.ok(cfg.enemy.unlockedUnits.length >= 2);
  assert.equal(cfg.enemy.expedition.militia ?? 0, 0, 'the enemy lands no army at all');
});

// ---------------------------------------------------------------------------
// What the engine does with it
// ---------------------------------------------------------------------------

function battle(roster) {
  return createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: 'roster',
    seed: 1,
    grid: { cols: 9, rows: 9, blocked: [] },
    sites: [
      { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 4 }, hp: 480, hpMax: 480 },
      { id: 'hold', kind: 'stronghold', hex: [1, 0], owner: 'player', garrison: {}, hp: 250, hpMax: 250, trainType: 'raiders' },
      { id: 'foe', kind: 'farm', hex: [2, 0], owner: 'enemy', garrison: { militia: 2 }, hp: 100, hpMax: 100 },
    ],
    adjacency: [['camp', 'hold'], ['hold', 'foe']],
    player: makeMods({ expedition: emptyComp(), startGold: 2000, unlockedUnits: roster }),
    enemy: makeMods({ expedition: emptyComp() }),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 480000, aiTier: 1 },
  });
}
const order = (s, unit) => {
  s.commands.push({ t: 'TRAIN', site: 'hold', unit });
  drainCommands(s);
  return s.events.filter((e) => e.type === 'command-rejected').map((e) => e.reason);
};

test('roster: a stronghold refuses a troop the army did not bring', () => {
  const s = battle(['militia', 'spearmen']);
  s.sites[1].trainType = 'militia';        // the fixture's alien type is the OTHER test's
  assert.deepEqual(order(s, 'raiders'), ['unit-locked']);
  assert.equal(s.sites[1].trainType, 'militia', 'and the order did not land anyway');

  // The negative control, and it is the whole point: the SAME command on a
  // roster that carries the type is accepted. Without this the test would pass
  // just as happily against a gate that refused everything.
  s.events = [];
  assert.deepEqual(order(s, 'spearmen'), []);
  assert.equal(s.sites[1].trainType, 'spearmen');
});

test('roster: a captured yard building an alien type falls back to a legal one', () => {
  // mapgen hands every site a trainType and the enemy's is routinely something
  // the taker did not bring — the common case now, not the rare one.
  const s = battle(['militia', 'spearmen']);
  assert.equal(s.sites[1].trainType, 'raiders', 'the fixture really is set to an alien type');
  assert.equal(trainableUnit(s.sites[1], s.mods.player), 'militia');
});

test('roster: the fallback is never the Marshal, however the roster is ordered', () => {
  // He is commissioned, not built. A site parked on him would produce nothing
  // at all, forever, and look busy doing it.
  const site = { trainType: 'raiders' };
  assert.equal(trainableUnit(site, { unlockedUnits: ['marshal', 'spearmen'] }), 'spearmen');
  assert.equal(trainableUnit(site, { unlockedUnits: ['marshal'] }), null);
  assert.equal(isTrainable('marshal'), false);
});
