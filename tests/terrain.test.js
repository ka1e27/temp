// THE TERRAIN LAYER, asserted by its EFFECT — never by the presence of a field.
//
// The recurring failure mode in this repo is a test that codifies the bug: a
// fixture that happens to match a broken producer, or an assertion that a key
// exists rather than that anything happens. So nothing here checks
// `grid.rivers !== undefined`. Every test asks a question the player would ask:
//
//   does a fort in the mountains actually survive an attack that takes the same
//   fort on open ground?
//   does a river farm actually credit more gold through the real runEconomy?
//   does the preview still tell the truth about both?
//
// This file is the EFFECTS half. Generation and the seam are in
// tests/terrainmap.test.js; the shared fixture is tests/fixtures/terrainGround.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/core/store.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { startBattle, step } from '../src/battle/sim.js';
import { assertBattleConfig, CONTRACT_VERSION } from '../src/battle/contract.js';
import {
  groundOf, siteDefMultOf, terrainGoldMult, terrainName, isOpen,
} from '../src/battle/terrain.js';
import { resolveField, breachSeconds, siegeDps, power, emptyComp } from '../src/battle/combat.js';
import { runEconomy, goldOf, siteGoldPerSec } from '../src/battle/economy.js';
import { computePreview } from '../src/screens/battle-preview.js';
import { siteIntel, terrainLine } from '../src/screens/battle-econ.js';
import { TERRAIN, UNITS, SITES, CENTIGOLD } from '../src/content/balance.js';
import { TICK_HZ } from '../src/core/loop.js';
import { ground, basicMods, ringTwo, comp } from './fixtures/terrainGround.js';


// ---------------------------------------------------------------------------
// 1. THE ASK: a fort in the mountains survives an attack that takes it in the open
// ---------------------------------------------------------------------------

test('a fort in the mountains survives an assault that takes the same fort on open ground', () => {
  const open = ground();
  const hills = ground({ grid: { blocked: ringTwo(TERRAIN.mountainFull) } });
  const openFort = open.sites.find((s) => s.id === 'fort');
  const hillFort = hills.sites.find((s) => s.id === 'fort');

  assert.equal(groundOf(open, openFort).highland, 0, 'the control fort must be on open ground');
  assert.equal(groundOf(hills, hillFort).highland, 1, 'the test fort must be fully highland');

  // ONE attacking force, sized so it wins on the flat. Nothing else differs.
  const assault = comp({ militia: 16, raiders: 2 });
  const attack = (state, site) => resolveField(assault, site.garrison, {
    siteDefMult: siteDefMultOf(state, site),
    defenderOwnsSite: true,
    ground: groundOf(state, site),
  });

  const flat = attack(open, openFort);
  const rocky = attack(hills, hillFort);

  assert.equal(flat.win, true, 'the control assault must succeed — otherwise it proves nothing');
  assert.equal(rocky.win, false, 'the SAME force must fail against the same fort in the mountains');
  assert.ok(rocky.defPower > flat.defPower * 1.2,
    `mountains must matter: ${flat.defPower.toFixed(1)} -> ${rocky.defPower.toFixed(1)}`);
});

test('the mountain advantage grows with how ringed the fort is, and is worth most to a fort', () => {
  const at = (n) => {
    const s = ground({ grid: { blocked: ringTwo(n) } });
    return siteDefMultOf(s, s.sites.find((x) => x.id === 'fort'));
  };
  const flat = at(0);
  const partial = at(2);
  const full = at(TERRAIN.mountainFull);
  assert.ok(partial > flat && full > partial, `graded, not a step: ${flat} ${partial} ${full}`);
  assert.ok(Math.abs(full - SITES.stronghold.defMult * (1 + TERRAIN.highlandDef)) < 1e-9);

  // Multiplicative, so the terrain is worth the most where defence already was —
  // which is what makes this an advantage for FORTS rather than a flat bonus.
  const s = ground({ grid: { blocked: ringTwo(TERRAIN.mountainFull) } });
  const gainOf = (id) => {
    const site = s.sites.find((x) => x.id === id);
    return siteDefMultOf(s, site) - SITES[site.kind].defMult;
  };
  assert.equal(gainOf('castle'), 0, 'a fort outside the range gains nothing from it');
  const fort = s.sites.find((x) => x.id === 'fort');
  assert.ok(siteDefMultOf(s, fort) - SITES.stronghold.defMult
    > TERRAIN.highlandDef * SITES.farm.defMult,
  'a stronghold must gain more absolute defence from the same ground than a farm would');
});

test('a mountain fort blunts rams specifically, not everything equally', () => {
  const s = ground({ grid: { blocked: ringTwo(TERRAIN.mountainFull) } });
  const g = groundOf(s, s.sites.find((x) => x.id === 'fort'));

  // Same siege budget, two ways of spending it.
  const rams = comp({ rams: 3 });
  const bodies = comp({ militia: 60 });
  assert.ok(siegeDps(rams, 1, g) < siegeDps(rams) * 0.8, 'rams must lose bite in the rocks');
  assert.equal(siegeDps(bodies, 1, g), siegeDps(bodies), 'militia must not care about terrain');

  // ...and that shows up as a real breach time, which is what the HUD prints.
  const hp = SITES.stronghold.hp;
  assert.ok(breachSeconds(rams, hp, 'stronghold', 1, 1, 1, g)
    > breachSeconds(rams, hp, 'stronghold') * 1.2,
  'the walls must genuinely hold longer against engines dragged uphill');
});

// ---------------------------------------------------------------------------
// 2. THE ASK: a farm on a river makes more gold — through the REAL economy
// ---------------------------------------------------------------------------

test('a river farm credits more gold to the treasury over N ticks of runEconomy', () => {
  const make = (rivers) => startBattle(assertBattleConfig({
    contractVersion: CONTRACT_VERSION,
    battleId: 'river-farm',
    seed: 9,
    grid: { cols: 9, rows: 9, blocked: [], rivers },
    sites: [
      { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 2 }, hp: 480, hpMax: 480 },
      { id: 'farm', kind: 'farm', hex: [4, 4], owner: 'player', garrison: { militia: 2 }, hp: 100, hpMax: 100 },
      { id: 'castle', kind: 'castle', hex: [4, 8], owner: 'enemy', garrison: { militia: 2 }, hp: 480, hpMax: 480 },
    ],
    adjacency: [['camp', 'farm'], ['farm', 'castle']],
    player: basicMods(),
    enemy: basicMods(),
    rules: { victory: 'capture-castle', hardCapMs: 600000, aiTier: 1 },
  }));

  const dry = make([]);
  const wet = make([[4, 3], [4, 4], [4, 5]]); // a watercourse straight through it

  const TICKS = 600; // a full minute of battle
  const earn = (s) => {
    const before = goldOf(s.factions.player);
    for (let i = 0; i < TICKS; i++) runEconomy(s);
    return goldOf(s.factions.player) - before;
  };
  const dryGold = earn(dry);
  const wetGold = earn(wet);

  assert.ok(wetGold > dryGold, `the river farm must actually pay more: ${wetGold} vs ${dryGold}`);
  // The camp pays the same in both, so the DIFFERENCE is exactly the farm's bonus.
  const farmOnly = SITES.farm.gold * (TERRAIN.riverFarmGold - 1) * (TICKS / TICK_HZ) * CENTIGOLD;
  assert.ok(Math.abs((wetGold - dryGold) - farmOnly) < 1,
    `expected ~${farmOnly.toFixed(0)}cg of extra income, got ${(wetGold - dryGold).toFixed(0)}`);

  // ...and the number is credited by the SAME function the panel reads, so the
  // HUD and the treasury cannot disagree about which farms are the rich ones.
  const wetFarm = wet.sites.find((s) => s.id === 'farm');
  assert.equal(siteIntel(wet, wetFarm).gold, siteGoldPerSec(wet, wetFarm));
  assert.ok(siteGoldPerSec(wet, wetFarm) > siteGoldPerSec(dry, dry.sites.find((s) => s.id === 'farm')));
});

test('only farms take the river gold, and only when the water actually reaches them', () => {
  const s = ground({ grid: { rivers: [[3, 4]] } });
  const fort = s.sites.find((x) => x.id === 'fort');
  assert.equal(groundOf(s, fort).river, true);
  assert.equal(terrainGoldMult(s, fort), 1, 'a stronghold on a river earns no farm bonus');

  const far = ground({ grid: { rivers: [[8, 0]] } });
  assert.equal(groundOf(far, far.sites.find((x) => x.id === 'fort')).river, false);
});

test('a river makes the ground it runs through SOFTER, which is what stops terrain being a tax', () => {
  const dry = ground();
  const wet = ground({ grid: { rivers: [[3, 4]] } });
  const a = siteDefMultOf(dry, dry.sites.find((x) => x.id === 'fort'));
  const b = siteDefMultOf(wet, wet.sites.find((x) => x.id === 'fort'));
  assert.ok(b < a, `walls on a watercourse must hold less well: ${a} -> ${b}`);

  // And it is a real outcome, not just a number: a force that bounces off the
  // dry fort takes the same fort on the river.
  const assault = comp({ militia: 13 });
  const go = (state) => {
    const site = state.sites.find((x) => x.id === 'fort');
    return resolveField(assault, site.garrison, {
      siteDefMult: siteDefMultOf(state, site),
      defenderOwnsSite: true,
      ground: groundOf(state, site),
    });
  };
  assert.equal(go(dry).win, false);
  assert.equal(go(wet).win, true, 'the ford is the way in');
});

// ---------------------------------------------------------------------------
// 3. THE ASK: unit types feel different on the same ground
// ---------------------------------------------------------------------------

test('the same ground helps one unit type and hurts another — it is not one number', () => {
  const hill = { highland: 1, river: false };
  const ford = { highland: 0, river: true };
  const flat = null;
  const p = (unit, g) => power(comp({ [unit]: 10 }), emptyComp(), { ground: g });

  // Highland: spearmen up, raiders down, rams down, militia untouched.
  assert.ok(p('spearmen', hill) > p('spearmen', flat), 'a spearwall holds a pass');
  assert.ok(p('raiders', hill) < p('raiders', flat), 'no room to ride in broken ground');
  assert.ok(p('rams', hill) < p('rams', flat), 'engines do not go uphill');
  assert.equal(p('militia', hill), p('militia', flat), 'militia is the unit that never cares');

  // River: the ordering INVERTS for the two specialists, which is the whole
  // point — the same army is right on one ground and wrong on the other.
  assert.ok(p('raiders', ford) > p('raiders', flat), 'raiders cross water at will');
  assert.ok(p('spearmen', ford) < p('spearmen', flat), 'no formation in the shallows');
  assert.equal(p('militia', ford), p('militia', flat));

  const rank = (g) => ['spearmen', 'raiders', 'rams']
    .map((u) => [u, p(u, g) / p(u, flat)])
    .sort((a, b) => b[1] - a[1]).map(([u]) => u).join(',');
  assert.notEqual(rank(hill), rank(ford),
    'if the three units ranked the same on both grounds, terrain would be one dial');
});

test('composition decides a mountain assault: the same headcount wins or loses on unit choice', () => {
  const s = ground({ grid: { blocked: ringTwo(TERRAIN.mountainFull) } });
  const fort = s.sites.find((x) => x.id === 'fort');
  const g = groundOf(s, fort);
  const go = (army) => resolveField(army, fort.garrison, {
    siteDefMult: siteDefMultOf(s, fort), defenderOwnsSite: true, ground: g,
  });
  // Equal SLOT budget, spent two ways (raiders cost 3 slots, militia 1).
  const light = comp({ raiders: 8 });
  const foot = comp({ militia: 24 });
  assert.ok(go(foot).attPower > go(light).attPower,
    'in the mountains, bodies must beat the same budget spent on horse');
});

// ---------------------------------------------------------------------------
// 4. Determinism — invariant 3 must survive the new layer
// ---------------------------------------------------------------------------

test('combat resolution stays free of randomness with terrain in play', () => {
  const s = ground({ grid: { blocked: ringTwo(3), rivers: [[3, 4]] } });
  const fort = s.sites.find((x) => x.id === 'fort');
  const g = groundOf(s, fort);
  const army = comp({ militia: 14, spearmen: 5, raiders: 3, rams: 2 });
  const once = JSON.stringify(resolveField(army, fort.garrison, {
    siteDefMult: siteDefMultOf(s, fort), defenderOwnsSite: true, ground: g,
  }));
  for (let i = 0; i < 50; i++) {
    assert.equal(JSON.stringify(resolveField(army, fort.garrison, {
      siteDefMult: siteDefMultOf(s, fort), defenderOwnsSite: true, ground: g,
    })), once, 'terrain must not have smuggled RNG into combat');
  }
  // Ground is a pure function of the map, so a rebuilt state agrees exactly.
  const twin = ground({ grid: { blocked: ringTwo(3), rivers: [[3, 4]] } });
  assert.deepEqual(groundOf(twin, twin.sites.find((x) => x.id === 'fort')), g);
});

test('a full battle over real terrain is byte-identical on a replay', () => {
  const run = (seed) => {
    const meta = createState({ seed, now: 0 }).meta;
    const cfg = buildBattleConfig(meta, 'kaldan', [], generateBattleMap, { seed });
    const s = startBattle(cfg);
    for (let i = 0; i < 400; i++) step(s);
    return JSON.stringify(s);
  };
  assert.equal(run(808), run(808));
  assert.notEqual(run(808), run(809));
});

// ---------------------------------------------------------------------------
// 5. The preview keeps its promise
// ---------------------------------------------------------------------------

test('the preview reports the terrain-adjusted fight, not the flat-ground one', () => {
  const build = (grid) => {
    const s = ground({ grid });
    const camp = s.sites.find((x) => x.id === 'camp');
    camp.garrison = comp({ militia: 30, raiders: 6 });
    return s;
  };
  const flat = build({});
  const hills = build({ blocked: ringTwo(TERRAIN.mountainFull) });
  const opts = { fraction: 1, travelSeconds: () => 0 };

  const a = computePreview(flat, 'camp', 'fort', opts);
  const b = computePreview(hills, 'camp', 'fort', opts);
  assert.ok(b.dp > a.dp, 'the preview must show the mountains it is about to walk into');
  assert.ok(b.ap < a.ap, 'and that its raiders are worth less up there');

  // The promise: the preview is the SAME function the sim runs. Send the army
  // for real and the field battle lands on the preview's numbers exactly.
  hills.commands.push({ t: 'SEND', from: 'camp', to: 'fort', fraction: 1 });
  const fought = [];
  for (let i = 0; i < 60 && !fought.length; i++) {
    step(hills);
    fought.push(...hills.events.filter((e) => e.type === 'battle:field' || e.siteId === 'fort'));
  }
  const field = fought.find((e) => e.attPower !== undefined);
  assert.ok(field, 'the assault must actually have resolved');
  assert.ok(Math.abs(field.defPower - b.dp) < 1e-6,
    `preview promised DP ${b.dp}, the simulation fought ${field.defPower}`);
  assert.equal(field.win, b.win);
});

test('the site panel says WHY a site is hard, and stays silent on open ground', () => {
  const flat = ground();
  const hills = ground({ grid: { blocked: ringTwo(TERRAIN.mountainFull) } });
  const fortOf = (s) => s.sites.find((x) => x.id === 'fort');

  assert.equal(terrainLine(siteIntel(flat, fortOf(flat))), '',
    'open ground has no explanation to give');

  const line = terrainLine(siteIntel(hills, fortOf(hills)));
  assert.match(line, /HIGHLAND/, `expected the ground named, got "${line}"`);
  assert.match(line, /defence/, 'the number the fight will actually use must be stated');
  assert.ok(/rams|raiders/.test(line), `expected the unit worst hit to be named: "${line}"`);
  // Whatever multiplier it prints has to be the one the simulation resolves with.
  const shown = Number(line.match(/defence ([\d.]+)x/)[1]);
  assert.ok(Math.abs(shown - siteDefMultOf(hills, fortOf(hills))) < 0.005);

  const wetFarm = (() => {
    const s = ground({ grid: { rivers: [[3, 4]] } });
    s.sites.find((x) => x.id === 'fort').kind = 'farm';
    return { s, site: s.sites.find((x) => x.id === 'fort') };
  })();
  assert.match(terrainLine(siteIntel(wetFarm.s, wetFarm.site)), /RIVER.*gold \+/);
});

// ---------------------------------------------------------------------------
// 6. The neutral case — a map with no terrain must be the old game exactly
// ---------------------------------------------------------------------------

test('a battle with no terrain behaves exactly as it did before the layer existed', () => {
  const s = ground();
  for (const site of s.sites) {
    const g = groundOf(s, site);
    assert.ok(isOpen(g));
    assert.equal(terrainName(g), '');
    assert.equal(siteDefMultOf(s, site), SITES[site.kind].defMult);
    assert.equal(terrainGoldMult(s, site), 1);
  }
  const army = comp({ militia: 10, spearmen: 4, raiders: 2, rams: 1 });
  assert.equal(power(army, army, { ground: groundOf(s, s.sites[0]) }), power(army, army));
  assert.equal(siegeDps(army, 1, groundOf(s, s.sites[0])), siegeDps(army));
});

test('every unit with a ground block is genuinely different on the two terrains', () => {
  const named = Object.entries(UNITS).filter(([, u]) => u.ground);
  assert.ok(named.length >= 3, 'the ask was raiders, spearmen and rams — at least three');
  for (const [id, spec] of named) {
    assert.notEqual(spec.ground.highland, spec.ground.river,
      `${id} scales the same way on rock and water, which is one dial wearing two hats`);
    assert.ok(spec.ground.highland > 0 && spec.ground.river > 0, `${id} has a nonsense multiplier`);
  }
});
