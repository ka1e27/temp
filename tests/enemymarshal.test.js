// THE ENEMY MARSHAL — the unit that was in the roster for this project's whole
// life without ever existing.
//
// `ENEMY_UNITS_BY_TIER` has listed `marshal` at tier 4 since tier 4 shipped, and
// nothing produced one: no `MAPGEN.trainType` builds it, `AI.counterPick` maps
// marshal -> spearmen (what to field AGAINST one), and `BASE_GARRISON` never
// held one. Removing marshal from the tier-4 roster changed thanescar's win rate
// by exactly 0 points, which is how the gap was found — and Ironcrown's flavour
// text advertised an enemy Marshal the whole time.
//
// That is the SAME class of bug as the dead boosters and the unclickable UI: a
// finished-looking thing nothing ever asked about. So the negative control is
// the important half of this file — every assertion here fails against the old
// code, and the "does nothing" tests fail if the grant is ever made unconditional.
//
// Everything is driven off REAL buildBattleConfig output rather than hand-built
// site objects, per tests/seam.test.js: a marshal that only exists in a content
// table is exactly the bug being fixed.
//
// The PLAYER's marshal — the free grant at landing, the RECRUIT verb, the slot
// budget that may never buy one — is a separate mechanism and lives in
// ./marshal.test.js. The two grants mirror each other deliberately
// (`withFreeMarshal` / `withEnemyMarshal`) and are tested apart deliberately: it
// was the enemy's half that silently did nothing for years.
import test from 'node:test';
import assert from 'node:assert/strict';

import { generateBattleMap } from '../src/battle/mapgen.js';
import { buildBattleConfig, withEnemyMarshal } from '../src/meta/modifiers.js';
import { startBattle } from '../src/battle/sim.js';
import { power, total } from '../src/battle/combat.js';
import { trainMultiplier } from '../src/battle/training.js';
import {
  REGIONS, REGION_IDS, ENEMY_UNITS_BY_TIER, ENEMY_MARSHALS_BY_TIER,
} from '../src/content/regions.data.js';
import { UNITS } from '../src/content/balance.js';
import { metaFor } from '../tools/simplayer.js';

/** A real config for "the player who has taken every earlier region". */
function configFor(id, seed = 4242) {
  const i = REGIONS.findIndex((r) => r.id === id);
  const meta = metaFor(REGION_IDS.slice(0, i), 10, seed).meta;
  return buildBattleConfig(meta, id, [], generateBattleMap, { seed });
}

const enemyMarshals = (config) => config.sites
  .filter((s) => s.owner === 'enemy')
  .reduce((a, s) => a + (s.garrison.marshal || 0), 0);

// ===========================================================================
// 1. He turns up, exactly once, exactly where the tier says
// ===========================================================================

test('marshal: the enemy fields exactly what its tier says, and none before tier 4', () => {
  // Every region, not a sample: the count is per tier and the grant reads the
  // roster as well, so this is the assertion that keeps the two from drifting
  // apart. A tier listing `marshal` with a count of 0 — or the reverse — would be
  // the original bug in a new costume.
  for (const r of REGIONS) {
    const inRoster = ENEMY_UNITS_BY_TIER[
      Math.min(ENEMY_UNITS_BY_TIER.length, Math.max(1, r.tier)) - 1].includes('marshal');
    const expected = inRoster ? (ENEMY_MARSHALS_BY_TIER[r.tier - 1] ?? 1) : 0;
    const got = enemyMarshals(configFor(r.id));
    assert.equal(got, expected,
      `${r.id} (tier ${r.tier}) fielded ${got} enemy marshal(s), expected ${expected}`);
  }
});

test('marshal: tiers 4 and 5 still field exactly one — the count table changed nothing', () => {
  // THE NEGATIVE CONTROL ON THE PER-TIER COUNT. Every win rate in tiers 4 and 5
  // was measured with one marshal in the throne and nothing else, and
  // `ENEMY_MARSHALS_BY_TIER` reads 1 there precisely so those numbers still
  // describe what ships. A table that quietly handed tier 4 a second banner would
  // re-tune eight measured regions and nothing else in the suite would notice.
  for (const r of REGIONS.filter((x) => x.tier === 4 || x.tier === 5)) {
    assert.equal(enemyMarshals(configFor(r.id)), 1,
      `${r.id} is tier ${r.tier} and must field one marshal, as it was tuned with`);
  }
});

test('marshal: he stands in the throne, not in the countryside', () => {
  // The whole design of the grant. `banner` is stack-local, so WHERE he is
  // decides what he buys: in the castle he buffs the garrison defending the win
  // condition. Anywhere else he is a rounding error on one farm.
  for (const id of ['thanescar', 'ironcrown', 'obsidian', 'nightharrow']) {
    const config = configFor(id);
    for (const s of config.sites) {
      const n = s.garrison.marshal || 0;
      if (n === 0) continue;
      assert.equal(s.owner, 'enemy', `${id}: a ${s.owner} site started with a marshal`);
      assert.equal(s.kind, 'castle', `${id}: the marshal is standing in a ${s.kind}`);
    }
  }
});

test('marshal: tier 6 fields two — the throne first, then one wall', () => {
  // The tier's step, and the reason it is a step rather than a cliff: `banner` is
  // stack-local, so the second marshal makes ONE line of the countryside
  // expensive instead of making the whole map slightly harder. Both halves matter
  // — the throne must still get the first one (it defends the win condition), and
  // the second must never end up in the same garrison, where `maxPerSite` would
  // reject it and the grant would silently be worth nothing.
  for (const r of REGIONS.filter((x) => x.tier === 6)) {
    const config = configFor(r.id);
    const held = config.sites.filter((s) => (s.garrison.marshal || 0) > 0);
    assert.equal(held.length, 2, `${r.id} fielded ${held.length} marshal-bearing sites`);
    for (const s of held) {
      assert.equal(s.owner, 'enemy', `${r.id}: a ${s.owner} site started with a marshal`);
      assert.equal(s.garrison.marshal, 1, `${r.id}: two marshals in one garrison (${s.id})`);
    }
    assert.equal(held.filter((s) => s.kind === 'castle').length, 1,
      `${r.id}: the throne is not one of the two — the win condition comes first`);
    const wall = held.find((s) => s.kind !== 'castle');
    assert.ok(wall.kind === 'stronghold' || wall.kind === 'camp',
      `${r.id}: the second banner is standing in a ${wall.kind}, not on a wall`);
  }
});

test('marshal: EXACTLY one, however hard the difficulty dial is turned', () => {
  // The reason the grant is applied after `normalizeSites` instead of through
  // `MAPGEN.garrison`: that table is multiplied by `enemyMult ^
  // ENEMY_SCALING.garrison` AND by the throne bonus, so a marshal placed there
  // would be scaled into two or three on the late regions. `maxPerSite` lives in
  // battle/training.js and never sees a garrison mapgen wrote, so nothing
  // downstream would have caught it.
  //
  // Raids are the sharp end: `effectiveEnemyMult` compounds 15% a clear, so a
  // farmed obsidian is the highest mult the game can produce.
  const i = REGIONS.findIndex((r) => r.id === 'obsidian');
  const meta = metaFor(REGION_IDS.slice(0, i), 10, 4242).meta;
  meta.regions.obsidian.status = 'conquered';
  for (const clears of [0, 5, 20]) {
    meta.regions.obsidian.clears = clears;
    const config = buildBattleConfig(meta, 'obsidian', [], generateBattleMap, { seed: 7 });
    assert.equal(enemyMarshals(config), 1,
      `after ${clears} clears the enemy fielded ${enemyMarshals(config)} marshals`);
  }
});

test('marshal: the grant is idempotent and never displaces a body', () => {
  // Called twice, it must not add a second — `banner` is presence-based, so a
  // second is worth nothing and would only be an invisible difficulty step.
  const roster = ['militia', 'spearmen', 'marshal'];
  const sites = [
    { id: 'castle', kind: 'castle', owner: 'enemy', garrison: { militia: 10, spearmen: 8 } },
    { id: 'ef01', kind: 'stronghold', owner: 'enemy', garrison: { spearmen: 4 } },
  ];
  const once = withEnemyMarshal(sites, roster);
  const twice = withEnemyMarshal(once, roster);
  assert.deepEqual(twice.find((s) => s.id === 'castle').garrison,
    { militia: 10, spearmen: 8, marshal: 1 });
  assert.deepEqual(twice.find((s) => s.id === 'ef01').garrison, { spearmen: 4 });
  // The troops he commands are still all there: he is granted OUTSIDE the
  // garrison the dial paid for, exactly like the player's free one is granted
  // outside the expedition budget.
  assert.equal(total(twice.find((s) => s.id === 'castle').garrison),
    total(sites[0].garrison) + 1);
});

// ===========================================================================
// 2. The negative control. The original bug was a unit nothing asked about.
// ===========================================================================

test('marshal: without the unlock in the roster, nothing is granted at all', () => {
  const sites = [{ id: 'castle', kind: 'castle', owner: 'enemy', garrison: { militia: 4 } }];
  const out = withEnemyMarshal(sites, ['militia', 'spearmen', 'raiders', 'rams']);
  assert.equal(out, sites, 'the array should not even be copied when there is no unlock');
  assert.equal(out[0].garrison.marshal ?? 0, 0);
});

test('marshal: a region with no enemy castle is left alone rather than crashing', () => {
  const sites = [{ id: 'pf01', kind: 'farm', owner: 'player', garrison: { militia: 3 } }];
  assert.equal(withEnemyMarshal(sites, ['marshal']), sites);
});

// ===========================================================================
// 3. He is worth something. A grant that reaches the battle and does nothing
//    is the bug it replaced, wearing different clothes.
// ===========================================================================

test('marshal: the throne actually fights 25% harder for having him', () => {
  const battle = startBattle(configFor('ironcrown'));
  const castle = battle.sites.find((s) => s.kind === 'castle');
  assert.ok((castle.garrison.marshal || 0) > 0, 'ironcrown fielded no marshal');

  const attacker = { militia: 60, spearmen: 30 };
  const opts = { defending: true, onOwnSite: true };
  const withHim = power(castle.garrison, attacker, opts);
  const without = power({ ...castle.garrison, marshal: 0 }, attacker, opts);

  // He COMMANDS and he fights, so simply deleting him costs his own body as
  // well as the banner — which is why the naive ratio reads 27%, not 25%. Divide
  // his own contribution back out to isolate the multiplier. (`power({marshal:1})`
  // has the banner applied to it too, hence the correction.)
  const solo = power({ marshal: 1 }, attacker, opts) / (1 + UNITS.marshal.banner);
  const banner = withHim / (without + solo);
  assert.ok(Math.abs(banner - (1 + UNITS.marshal.banner)) < 0.005,
    `the banner is worth ${((banner - 1) * 100).toFixed(1)}%, not`
    + ` ${(UNITS.marshal.banner * 100).toFixed(0)}% — flavour text lies again`);

  // And the headline claim, in the form a player would check it: one body in a
  // hundred-body garrison is worth vastly more than a body, because the banner
  // multiplies the whole stack.
  assert.ok(withHim / without > 1 + UNITS.marshal.banner,
    'removing the marshal cost less than the banner — he is being counted as a troop');
  assert.ok(total(castle.garrison) > 50,
    'this assertion is only meaningful on a large garrison');
});

test('marshal: and the throne refills 40% faster, which is what makes a stall cost you', () => {
  const battle = startBattle(configFor('nightharrow'));
  const castle = battle.sites.find((s) => s.kind === 'castle');
  const withHim = trainMultiplier(battle, castle);
  const without = trainMultiplier(battle, { ...castle, garrison: { ...castle.garrison, marshal: 0 } });
  assert.ok(Math.abs(withHim / without - (1 + UNITS.marshal.trainBuff)) < 1e-9,
    `training buff measured ${(withHim / without).toFixed(3)}x`);
});

test('marshal: he cannot be marched off and picked up cheaply in a field', () => {
  // battle/ai.js filters `kind === 'castle'` out of the launch pool, which is
  // what makes "until you kill it" mean "take the castle". If that filter is
  // ever relaxed, the marshal becomes a body the player can farm in the open and
  // the throne quietly loses its buff — so this pins the consequence, not the
  // implementation.
  const battle = startBattle(configFor('obsidian'));
  const castle = battle.sites.find((s) => s.kind === 'castle');
  for (const c of battle.commands) {
    assert.notEqual(c.t === 'SEND' && c.from, castle.id,
      'the enemy launched an attack out of its own throne');
  }
});
