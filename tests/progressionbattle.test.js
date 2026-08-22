// Section 3 of the progression suite: EVERY SHOP LINE REACHES THE BATTLE.
//
// Split out of ./progression.test.js purely for the 400-line cap. The other two
// sections ask whether the shop can be exhausted and whether it can be
// afforded; this one asks the question those two cannot — whether a line that
// was bought does anything at all once a battle starts.
//
// That is not a hypothetical. Four upgrades in this project's history were sold
// and did NOTHING, having no consumer anywhere in the engine, and every one of
// them passed a suite that only ever checked the shop.
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
// 3. ...and every new line reaches the battle
// ===========================================================================

const richMeta = (crowns) => {
  const st = createState({ seed: 5, now: 0 });
  st.meta.crowns = crowns;
  return st.meta;
};

/** Build a real config for a real region, with `ups` bought. */
function configWith(ups, regionId = 'kaldan', seed = 99) {
  const meta = richMeta(50_000_000);
  meta.relics = 100_000;              // both purses, so a fixture can buy either
  for (const [id, n] of Object.entries(ups)) {
    for (let i = 0; i < n; i++) assert.ok(buy(meta, id, null).ok, `could not buy ${id}`);
  }
  return assertBattleConfig(
    buildBattleConfig(meta, regionId, [], generateBattleMap, { seed }),
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
  // OVER SEVERAL SEEDS, and that is a strengthening rather than a hedge. One
  // seed's `unitsKilled` is a noisy way to ask this: measured across eight
  // seeds the armed army kills more on five of them, and the three it loses are
  // close (48 v 51, 30 v 31, 14 v 14) while the wins are not (111 v 39, 52 v
  // 28). So a single-seed strict inequality is close to a coin toss on the
  // rows where the two armies happen to fight the same battle — it passed for a
  // long time by luck, and the defender-reinforcement fix in
  // battle/meleephase.js (which changes both arms of the comparison equally)
  // was enough to tip seed 99 over. Summing is the same claim asked of a sample
  // big enough to answer it: 461 against 350 on those eight.
  const SEEDS = [99, 7, 21, 42, 123];
  let armedKills = 0;
  let bareKills = 0;
  for (const seed of SEEDS) {
    armedKills += kills(configWith({ arms: 10 }, 'kaldan', seed));
    bareKills += kills(configWith({}, 'kaldan', seed));
  }
  assert.ok(bareKills > 0, 'the fixture produced no combat at all — it measures nothing');
  assert.ok(armedKills > bareKills,
    `over ${SEEDS.length} seeds a +60% army killed ${armedKills} against a bare one's ${bareKills}`);
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

test('every CROWN line rides a contract field that already existed', () => {
  // The number tracks bumps this test is NOT about: v4 was rules.castleGateFrac,
  // v5 the rally target list and rules.rallyKeepDefault, v6 the incursion rung,
  // v7 the per-troop multipliers. The point of THIS test is that the ten endless
  // CROWN lines needed no field of their own.
  //
  // v7 is the exception that proves it, and it is worth being exact about
  // rather than quietly widening the claim: the per-troop lines could NOT ride
  // an existing field, because `unitAtkMult` is one number for the whole stack
  // and the entire feature is that militia and rams stop sharing it. So they
  // took a field — and took a version bump with it, which is what makes
  // meta/resume.js discard a mid-battle blob the current engine would step
  // wrongly. That is the process working, not a loophole in it.
  // ...and v8 is the exception to the EXCEPTION: a bump with no field change at
  // all, because `stronghold` stopped meaning what it meant. The rule everyone
  // checks is "changing a field requires a bump", and that one slips past it.
  // v9 is the same shape a second time — SITE_KINDS gained `watchtower` and
  // state gained `vision`/`seen`, and neither is a CROWN-line field either.
  // v10 is the same shape a THIRD time: a squad gained the `path` it walks, a
  // nullable `to` and a `camped` hex, so a v9 blob is a board whose columns are
  // nowhere — invisible to the renderer, to fog and to the towers that shoot at
  // positions, while still arriving on schedule. v11 is the FIRST of the recent
  // run to add a real field, `lastKnownGarrison` — and still not a CROWN line,
  // which is exactly what this assertion is here to keep true. v12 is back to
  // the v8 shape a fourth time: a field battle takes `MELEE.seconds`, so a site
  // and a squad each carry a `melee` record, and a v11 blob resumed here is a
  // board whose fights are not happening — not a CROWN line either. v13 is the
  // v8 shape a FIFTH time: `state.ai` gained `musterTick`, the latch for the
  // enemy's one set-piece (battle/setpiece.js), so a v12 blob resumed after its
  // host already landed raises a second one. Not a CROWN line either, which is
  // the whole point of counting them here.
  assert.equal(CONTRACT_VERSION, 13);
  const cfg = configWith({ arms: 3, warChest: 3, drill: 3, standingArmy: 2, siegeworks: 3 });
  for (const k of ['unitAtkMult', 'unitDefMult', 'goldRateMult', 'trainCostMult',
    'siegeDmgMult', 'structureRegenMult', 'marchSpeedMult', 'farmYieldMult']) {
    assert.equal(typeof cfg.player[k], 'number', `${k} is not a contract field`);
    assert.ok(Number.isFinite(cfg.player[k]) && cfg.player[k] > 0);
  }
  assert.ok(SITE_UPGRADE[0].gold * CENTIGOLD > 0);
});

