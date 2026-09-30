import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regionIncome, incomePerSec, tickIncome, offlineEarnings, bounty } from '../meta/economy.js';
import { ECONOMY, DYNASTY, UPGRADE_TUNING } from '../config/meta.js';
import { PROSPERITY } from '../config/prosperity.js';
import { makeWorld, makeGame } from './meta.fixtures.js';

function close(actual, expected, msg) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${msg}: expected ${expected}, got ${actual}`);
}

test('regionIncome: start region uses the flat override, not the tier formula', () => {
  const world = makeWorld();
  close(regionIncome(world.regions[0]), ECONOMY.startRegionIncome, 'start region income');
});

test('regionIncome: tier formula baseIncome × incomePerTier^(tier-1), capitals × capitalIncomeMult', () => {
  const world = makeWorld();
  const { baseIncome, incomePerTier: r, capitalIncomeMult: cap } = ECONOMY;
  close(regionIncome(world.regions[1]), baseIncome, 'tier 1 non-capital'); // r^0
  close(regionIncome(world.regions[4]), baseIncome * r, 'tier 2 non-capital'); // r^1
  close(regionIncome(world.regions[3]), baseIncome * r * cap, 'tier 2 capital'); // r^1 × cap
  close(regionIncome(world.regions[5]), baseIncome * r * r * cap, 'tier 3 capital'); // r^2 × cap
});

test('incomePerSec: fresh game only earns from the owned start region, boosted by its own perk', () => {
  const world = makeWorld();
  const state = makeGame(world); // owns only region 0, which carries the 'fertile' (+12% income) perk
  close(incomePerSec(state, world), ECONOMY.startRegionIncome * 1.12, 'fresh income/s');
});

test('incomePerSec: taxes, dynasty stars and region perks all multiply the total', () => {
  const world = makeWorld();
  const state = makeGame(world, { upgrades: { taxes: 2 }, dynasty: { stars: 3 } });
  const expected = ECONOMY.startRegionIncome * (1 + 2 * UPGRADE_TUNING.taxes.magnitude) * 1.12 * (1 + 3 * DYNASTY.incomePerStar);
  close(incomePerSec(state, world), expected, 'taxed/starred income/s');
});

test('incomePerSec: owning more regions sums each one\'s own income', () => {
  const world = makeWorld();
  const state = makeGame(world);
  state.owner[3] = state.owner[0]; // also take the Crimson capital (tier-2 capital income, throne perk +25% income, +15% atk)
  const capitalIncome = ECONOMY.baseIncome * ECONOMY.incomePerTier * ECONOMY.capitalIncomeMult;
  const expected = (ECONOMY.startRegionIncome + capitalIncome) * 1 * (1 + 0.12 + 0.25) * 1;
  close(incomePerSec(state, world), expected, 'multi-region income/s');
});

test('tickIncome: adds exactly incomePerSec × dtSec to gold and stats.goldEarned', () => {
  const world = makeWorld();
  const state = makeGame(world);
  const perSec = incomePerSec(state, world);
  const gained = tickIncome(state, world, 10);
  close(gained, perSec * 10, 'tick return value');
  close(state.gold, perSec * 10, 'gold after tick');
  close(state.stats.goldEarned, perSec * 10, 'goldEarned after tick');
});

test('tickIncome: never goes backwards for a zero or negative dt', () => {
  const world = makeWorld();
  const state = makeGame(world, { gold: 50 });
  tickIncome(state, world, -5);
  close(state.gold, 50, 'gold unchanged for negative dt');
});

test('offlineEarnings: uncapped when the gap is under the Treasury cap', () => {
  const world = makeWorld();
  const state = makeGame(world, {}, 0);
  const oneHourMs = 3600 * 1000;
  const { seconds, gold } = offlineEarnings(state, world, oneHourMs);
  close(seconds, 3600, 'seconds uncapped');
  close(gold, incomePerSec(state, world) * 3600, 'gold uncapped');
  assert.equal(state.lastSeen, oneHourMs, 'lastSeen advances to now');
});

test('offlineEarnings: capped at ECONOMY.offlineCapHours plus Treasury levels, and mutates gold', () => {
  const world = makeWorld();
  const state = makeGame(world, { upgrades: { treasury: 5 } }, 0);
  const perSec = incomePerSec(state, world);
  const hundredHoursMs = 100 * 3600 * 1000;
  const { seconds, gold } = offlineEarnings(state, world, hundredHoursMs);
  const capHours = ECONOMY.offlineCapHours + 5; // treasury magnitude is 1h/level
  close(seconds, capHours * 3600, 'seconds capped at treasury-extended cap');
  close(gold, perSec * capHours * 3600, 'gold capped');
  close(state.gold, gold, 'state.gold actually received the capped amount');
  close(state.stats.goldEarned, gold, 'goldEarned tracks offline gold too');
});

test('offlineEarnings: calling twice in a row does not double-count', () => {
  const world = makeWorld();
  const state = makeGame(world, {}, 0);
  const first = offlineEarnings(state, world, 1000 * 1000);
  const second = offlineEarnings(state, world, 1000 * 1000); // now == lastSeen already
  assert.ok(first.gold > 0, 'first call earns something');
  close(second.gold, 0, 'immediate second call earns nothing');
});

test("bounty: DESIGN §5.1 — bountySeconds of the realm's TOTAL income, whichever region falls", () => {
  const world = makeWorld();
  const state = makeGame(world);
  const expected = ECONOMY.bountySeconds * incomePerSec(state, world);
  close(bounty(state, world, 3), expected, 'base bounty for the Crimson capital');
  close(bounty(state, world, 1), expected, 'the same for a tier-1 region: it is the realm that pays');
});

test('bounty: plunder upgrade and dynasty stars both scale it up', () => {
  const world = makeWorld();
  const state = makeGame(world, { upgrades: { plunder: 2 }, dynasty: { stars: 1 } });
  const expected = ECONOMY.bountySeconds * incomePerSec(state, world) * (1 + 2 * UPGRADE_TUNING.plunder.magnitude) * (1 + 1 * DYNASTY.bountyPerStar);
  close(bounty(state, world, 3), expected, 'boosted bounty');
});

test('bounty: grows with the realm, read before the new region joins it', () => {
  const world = makeWorld();
  const state = makeGame(world);
  const small = bounty(state, world, 3);
  state.owner[1] = state.owner[0]; // take Millbrook: the realm now pays more
  assert.ok(bounty(state, world, 3) > small, 'a bigger realm pays a bigger bounty');
  close(bounty(state, world, 3), ECONOMY.bountySeconds * incomePerSec(state, world), 'still the total income at that moment');
});

test('incomePerSec: prosperity grows each held region by its stored level (DESIGN §5.6)', () => {
  const world = makeWorld();
  const state = makeGame(world);
  const base = incomePerSec(state, world);
  state.prosperity = world.regions.map((r) => (r.id === 0 ? 2 : 0));
  close(incomePerSec(state, world), base * (1 + 2 * PROSPERITY.incomeBonusPerLevel), 'level II on the only region');
  state.prosperity = [];
  close(incomePerSec(state, world), base, 'a missing table is level 0');
  // regionIncome itself never includes prosperity: the bounty and the ambient caravans read it for regions you do not own yet
  close(regionIncome(world.regions[0]), ECONOMY.startRegionIncome, 'regionIncome is prosperity-free');
});

test('offline cap: ECONOMY.offlineCapHours plus one hour per Treasury level', () => {
  const world = makeWorld();
  const cap = (treasury) => {
    const st = makeGame(world, { upgrades: { treasury } });
    st.lastSeen = 0;
    const off = offlineEarnings(st, world, 100 * 3600 * 1000);
    return off.seconds / 3600;
  };
  close(cap(0), ECONOMY.offlineCapHours, 'base cap');
  close(cap(3), ECONOMY.offlineCapHours + 3 * UPGRADE_TUNING.treasury.magnitude, 'Treasury adds an hour per level');
});
