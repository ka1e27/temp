// Core simulation mechanics: determinism, JSON round-trip, the combat rule, interception,
// reinforcement, capture, towers, win/lose, retreat. See docs/ARCHITECTURE.md §6.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, step, issue, previewSend } from '../battle/sim.js';
import { resolveTowerVolleys } from '../battle/combat.js';
import { getRuntime } from '../battle/runtime.js';
import { buildArena } from '../battle/arena.js';
import { buildTestWorld, TARGET_REGION, DEFAULT_OWNERS } from './fixtures/battle-world.js';

const PLAYER = Object.freeze({
  atk: 1, def: 1, growth: 1, speed: 1, campTroops: 30, garrisonShare: 0.35, capBonus: 0,
  cooldownMult: 1, powers: { rally: 1, firestorm: 1, bulwark: 1, march: 1, levy: 1 },
});
const ENEMY = Object.freeze({
  atk: 1, def: 1, growth: 1, speed: 1, troopMult: 1, thinkSec: 2, personality: 'aggressive', factionId: 2,
});
// Zero-growth variants for precision tests of the combat rule itself: capture correctly
// resets a site's `growth` to its NEW owner's rate (a captured village should start growing
// again, not stay frozen), and that recompute happens mid-tick, before the same tick's
// applyGrowth call — so a manually-zeroed `site.growth` gets clobbered the instant a capture
// resolves. Zeroing growth on BOTH stat blocks instead means no site ever grows, regardless
// of who ends up owning it, so exact "instant rule" arithmetic holds with no epsilon needed.
const PLAYER_ZG = Object.freeze({ ...PLAYER, growth: 0 });
const ENEMY_ZG = Object.freeze({ ...ENEMY, growth: 0 });

function freshArena() {
  const world = buildTestWorld();
  return buildArena(world, DEFAULT_OWNERS, TARGET_REGION, PLAYER, ENEMY);
}

/** A minimal 2-tile, 2-site Arena, bypassing arena.js/world entirely, for tests that just
 * need tight control over a single fight (per ARCHITECTURE §6's Arena shape). */
function tinyArena({ campTroops = 30, enemyType = 'village', enemyTroops = 20, enemyFaction = 2 } = {}) {
  const tiles = [
    { i: 0, q: 0, r: 0, x: 0, y: 0, cost: 1, terrain: 'grass', region: 0 },
    { i: 1, q: 1, r: 0, x: Math.sqrt(3), y: 0, cost: 1, terrain: 'grass', region: 0 },
  ];
  const sites = [
    { id: 0, settlement: -1, tile: 0, type: 'camp', owner: 0, troops: campTroops },
    { id: 1, settlement: 0, tile: 1, type: enemyType, owner: enemyFaction, troops: enemyTroops },
  ];
  return {
    regionId: 0, enemyFaction, tiles, sites,
    focus: { minX: 0, maxX: Math.sqrt(3), minY: 0, maxY: 0 },
  };
}

function runToEnd(battle, maxSteps = 20000) {
  let steps = 0;
  while (!battle.result && steps < maxSteps) {
    step(battle, 0.05);
    steps++;
  }
  return steps;
}

/** For isolated single-fight tests against a non-keep site: `battle.result` only ever gets
 * set by a keep capture (win) or the player losing everything, so a test that attacks a
 * plain village/fort must stop once combat has actually settled — i.e. no squads left in
 * play — rather than waiting for `result`, or growth on the (possibly just-captured) site
 * keeps running for the rest of the step budget and the assertions below observe a much
 * later, growth-inflated troop count instead of the fight's true outcome. */
function runUntilSettled(battle, maxSteps = 20000) {
  // do/while: a freshly-queued `send` command hasn't spawned its squad yet on entry (that
  // only happens once `step` applies the queue), so the loop must always run at least once.
  let steps = 0;
  do {
    step(battle, 0.05);
    steps++;
  } while (!battle.result && battle.squads.length > 0 && steps < maxSteps);
  return steps;
}

test('determinism: replaying an identical command log gives identical final JSON', () => {
  const arena = freshArena();
  const keep = arena.sites.find((s) => s.type === 'keep' && s.owner !== 0);
  const log = [
    { tick: 0, cmd: { type: 'send', owner: 0, from: [0], to: keep.id, fraction: 0.3 } },
    { tick: 10, cmd: { type: 'power', owner: 0, power: 'rally', target: keep.id } },
    { tick: 25, cmd: { type: 'send', owner: 0, from: [0], to: keep.id, fraction: 1.0 } },
  ];
  function run() {
    const battle = createBattle(arena, PLAYER, ENEMY);
    for (let i = 0; i < 500 && !battle.result; i++) {
      for (const e of log) if (e.tick === i) issue(battle, e.cmd);
      step(battle, 0.05);
    }
    return battle;
  }
  const a = run();
  const b = run();
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.ok(a.tick > 0);
});

test('JSON round-trip mid-battle then continuing matches an uninterrupted run', () => {
  const arena = freshArena();
  const keep = arena.sites.find((s) => s.type === 'keep' && s.owner !== 0);
  function fresh() {
    const battle = createBattle(arena, PLAYER, ENEMY);
    issue(battle, { type: 'send', owner: 0, from: [0], to: keep.id, fraction: 1.0 });
    return battle;
  }
  const uninterrupted = fresh();
  const interrupted = fresh();
  for (let i = 0; i < 40; i++) { step(uninterrupted, 0.05); step(interrupted, 0.05); }

  const resumed = JSON.parse(JSON.stringify(interrupted)); // the "save/load" boundary
  // Sending against the keep at base stats fails (see battle.arena/bot smoke checks), so
  // this battle need not (and does not) reach a result — the point is that the two runs
  // stay bit-for-bit identical, whether or not either ever concludes.
  for (let i = 0; i < 3000 && !uninterrupted.result && !resumed.result; i++) {
    step(uninterrupted, 0.05);
    step(resumed, 0.05);
  }
  assert.equal(JSON.stringify(uninterrupted), JSON.stringify(resumed));
});

test('30 vs 20 at equal stats leaves 10 (the instant-rule invariant)', () => {
  const arena = tinyArena({ campTroops: 30, enemyType: 'village', enemyTroops: 20 });
  const battle = createBattle(arena, PLAYER_ZG, ENEMY_ZG); // isolate the rule from growth
  const village = battle.sites[1];
  const squad = {
    id: battle.nextId++, owner: 0, count: 30, from: 0, to: 1, path: [1], seg: 0, prog: 0.999,
    state: 'assault', foe: null,
  };
  battle.squads.push(squad);
  village.assault = { owner: 0, squads: [squad.id] };

  const steps = runUntilSettled(battle);
  assert.ok(steps < 20000, 'fight should resolve well within the step budget');
  assert.equal(village.owner, 0, 'the attacker should have captured the site');
  assert.ok(Math.abs(village.troops - 10) < 1e-6, `expected ~10 survivors, got ${village.troops}`);
});

test('site defence multiplier: the same 30 vs 20 fails against a fort (def 1.8)', () => {
  const arena = tinyArena({ campTroops: 30, enemyType: 'fort', enemyTroops: 20 });
  const battle = createBattle(arena, PLAYER_ZG, ENEMY_ZG);
  const fort = battle.sites[1];
  const squad = {
    id: battle.nextId++, owner: 0, count: 30, from: 0, to: 1, path: [1], seg: 0, prog: 0.999,
    state: 'assault', foe: null,
  };
  battle.squads.push(squad);
  fort.assault = { owner: 0, squads: [squad.id] };

  runUntilSettled(battle);
  assert.equal(fort.owner, 2, 'the fort should survive thanks to its defence multiplier');
  // Strength invariant: 30*1 - 20*1*1.8 = -6, so the defender ends with 6/1.8 troops.
  assert.ok(Math.abs(fort.troops - 6 / 1.8) < 1e-6, `expected ~${(6 / 1.8).toFixed(3)}, got ${fort.troops}`);
  assert.equal(battle.squads.length, 0, 'the attacking squad should have been wiped out');
});

test('interception: opposing marching squads within range fight, winner resumes marching', () => {
  const arena = tinyArena();
  const battle = createBattle(arena, PLAYER, ENEMY);
  const a = {
    id: battle.nextId++, owner: 0, count: 30, from: 0, to: 1, path: [1], seg: 0, prog: 0.5,
    state: 'march', foe: null,
  };
  const b = {
    id: battle.nextId++, owner: 2, count: 10, from: 1, to: 0, path: [0], seg: 0, prog: 0.5,
    state: 'march', foe: null,
  };
  battle.squads.push(a, b);

  step(battle, 0.05);
  assert.ok(battle.events.some((e) => e.type === 'clash'), 'a clash event should fire on contact');
  assert.equal(a.state, 'fight');
  assert.equal(b.state, 'fight');
  assert.equal(a.foe, b.id);

  for (let i = 0; i < 2000 && battle.squads.length > 1; i++) step(battle, 0.05);
  assert.equal(battle.squads.length, 1, 'the loser should be removed');
  const survivor = battle.squads[0];
  assert.equal(survivor.owner, 0);
  assert.ok(Math.abs(survivor.count - 20) < 1e-6);
  assert.equal(survivor.state, 'march', 'the winner should resume marching');
});

test('reinforcement mid-fight changes the outcome', () => {
  // Baseline: 25 attackers vs 20 defenders alone -> attacker wins (25-20=5 survive).
  const baseline = tinyArena({ campTroops: 25, enemyType: 'village', enemyTroops: 20 });
  const bBattle = createBattle(baseline, PLAYER_ZG, ENEMY_ZG);
  const bSquad = {
    id: bBattle.nextId++, owner: 0, count: 25, from: 0, to: 1, path: [1], seg: 0, prog: 0.999,
    state: 'assault', foe: null,
  };
  bBattle.squads.push(bSquad);
  bBattle.sites[1].assault = { owner: 0, squads: [bSquad.id] };
  runUntilSettled(bBattle);
  assert.equal(bBattle.sites[1].owner, 0, 'baseline: the attack should succeed alone');

  // Same setup, but a same-owner reinforcement squad arrives mid-fight and saves the site.
  const arena = tinyArena({ campTroops: 25, enemyType: 'village', enemyTroops: 20 });
  const battle = createBattle(arena, PLAYER_ZG, ENEMY_ZG);
  const village = battle.sites[1];
  const attacker = {
    id: battle.nextId++, owner: 0, count: 25, from: 0, to: 1, path: [1], seg: 0, prog: 0.999,
    state: 'assault', foe: null,
  };
  battle.squads.push(attacker);
  village.assault = { owner: 0, squads: [attacker.id] };

  // Let the fight run for a few ticks so it's genuinely "mid-fight", then reinforce.
  for (let i = 0; i < 5; i++) step(battle, 0.05);
  assert.ok(village.owner === 2, 'should not have resolved yet');
  const reinforcement = {
    id: battle.nextId++, owner: 2, count: 15, from: 1, to: 1, path: [], seg: 0, prog: 0,
    state: 'march', foe: null,
  };
  battle.squads.push(reinforcement);
  // Simulate its arrival directly (reinforcement bookkeeping is arrival-triggered — see
  // movement.js's handleArrival): a same-owner arrival just adds troops to the site.
  village.troops += reinforcement.count;
  battle.squads = battle.squads.filter((s) => s.id !== reinforcement.id);

  runUntilSettled(battle);
  assert.equal(village.owner, 2, 'the reinforcement should have flipped the outcome');
  assert.equal(battle.squads.length, 0, 'the attacking squad should have been destroyed instead');
});

test('capture: a non-keep site flips owner and does not end the battle', () => {
  const arena = freshArena();
  const battle = createBattle(arena, PLAYER, ENEMY);
  const fort = battle.sites.find((s) => s.type === 'fort');
  fort.troops = 5; // make it trivial to take without needing a huge force
  const squad = {
    id: battle.nextId++, owner: 0, count: 30, from: 0, to: fort.id, path: [fort.tile], seg: 0, prog: 0.999,
    state: 'assault', foe: null,
  };
  battle.squads.push(squad);
  fort.assault = { owner: 0, squads: [squad.id] };

  const captureEvents = [];
  for (let i = 0; i < 2000 && fort.owner !== 0; i++) {
    step(battle, 0.05);
    captureEvents.push(...battle.events.filter((e) => e.type === 'capture'));
  }

  assert.equal(fort.owner, 0);
  assert.equal(battle.result, null, 'capturing a non-keep site should not end the battle');
  assert.equal(captureEvents.length, 1);
  assert.equal(captureEvents[0].site, fort.id);
  assert.equal(captureEvents[0].from, 2);
  assert.equal(captureEvents[0].to, 0);
  assert.equal(typeof captureEvents[0].x, 'number');
});

test('multiple assaulting squads are drained in deterministic id order', () => {
  // Two attackers (15 + 25 = 40 strength) vs a 20-strength defender: total attacker loss is
  // 40-20=20 troops (the same instant-rule invariant as the 30v20 test). The lower-id squad
  // must be fully drained before the higher-id one loses anything — not split proportionally.
  const arena = tinyArena({ campTroops: 30, enemyType: 'village', enemyTroops: 20 });
  const battle = createBattle(arena, PLAYER_ZG, ENEMY_ZG);
  const village = battle.sites[1];
  const lowerId = {
    id: battle.nextId++, owner: 0, count: 15, from: 0, to: 1, path: [1], seg: 0, prog: 0.999,
    state: 'assault', foe: null,
  };
  const higherId = {
    id: battle.nextId++, owner: 0, count: 25, from: 0, to: 1, path: [1], seg: 0, prog: 0.999,
    state: 'assault', foe: null,
  };
  assert.ok(lowerId.id < higherId.id);
  battle.squads.push(higherId, lowerId); // deliberately out of order in the array
  village.assault = { owner: 0, squads: [higherId.id, lowerId.id] }; // and here too

  // The FINAL garrison total (40-20=20) would be identical whether the loss were drained
  // in id order or split proportionally — that invariant is already covered by the 30v20
  // test. What's distinctive about id order is the INTERMEDIATE state: the lower-id squad
  // (only 15 strong) must be fully drained and removed, while the untouched higher-id squad
  // still has all 25, before the site itself (which needs a total of 20 absorbed) falls.
  let steps = 0;
  while (village.owner !== 0 && battle.squads.some((s) => s.id === lowerId.id) && steps < 20000) {
    step(battle, 0.05);
    steps++;
  }
  assert.ok(steps < 20000);
  assert.equal(village.owner, 2, 'only ~15 of the needed 20 total loss has been absorbed so far');
  assert.equal(battle.squads.find((s) => s.id === lowerId.id), undefined, 'lower id: fully drained');
  const survivor = battle.squads.find((s) => s.id === higherId.id);
  assert.ok(survivor, 'higher id squad should still be present');
  assert.ok(Math.abs(survivor.count - 25) < 1e-6, 'higher id: untouched while the lower id was draining');
  // lower dies the instant it crosses the 0.5 death threshold mid-tick, not at an idealised
  // exact 0 — so the village lands NEAR but not exactly at 20-15=5 (here it's whatever was
  // absorbed up to that crossing tick); a wide-but-bounded range confirms "meaningful
  // progress, not yet exhausted" without depending on the exact discretisation point.
  assert.ok(village.troops > 4.5 && village.troops < 6, `expected ~5, got ${village.troops}`);

  runUntilSettled(battle); // finish it: the survivor alone (~25) easily takes the rest
  assert.equal(village.owner, 0);
  assert.equal(battle.squads.length, 0, 'the survivor is consumed into the new garrison');
  // Bit-exact 40-20=20 (as in the single-squad 30v20 test) holds only up to DEATH_THRESHOLD
  // (0.5): applyStrengthTrade's "finish it off" correction tracks the TOTAL attacker troops,
  // but it can't see individual squad boundaries — when the lower-id squad died above, its
  // own final sub-0.5 sliver was discarded the same way (deliberately: DEATH_THRESHOLD
  // applies per squad, not to the assault's total), which nudges the running total by less
  // than 0.5. A known, tiny, and bounded characteristic of multi-squad assaults specifically
  // — see the final report — not a break of the invariant for the normal single-squad case.
  assert.ok(Math.abs(village.troops - 20) < 0.5, `expected ~20, got ${village.troops}`);
});

test('towers volley the nearest enemy squad in range on a fixed cadence', () => {
  const arena = freshArena();
  const battle = createBattle(arena, PLAYER, ENEMY);
  const tower = battle.sites.find((s) => s.type === 'tower');
  const towerTile = getRuntime(battle).byIndex.get(tower.tile);
  const squad = {
    id: battle.nextId++, owner: 0, count: 20, from: 0, to: 0, path: [tower.tile], seg: 0, prog: 1,
    state: 'march', foe: null,
  };
  battle.squads.push(squad);
  // Park the squad exactly on the tower's tile (well within range) and step in isolation.
  squad.from = tower.id; // squadPosition falls back to `sites[from].tile` when path is empty
  squad.path = [];

  const runtime = getRuntime(battle);
  resolveTowerVolleys(battle, runtime, 0);
  assert.equal(battle.events.filter((e) => e.type === 'arrow').length, 1);
  const expectedKill = 1 * ENEMY.atk; // volleyKills(1) * tower owner's atk
  assert.ok(Math.abs(squad.count - (20 - expectedKill)) < 1e-9);
  assert.equal(tower.nextVolley, 0.5);

  battle.events = [];
  resolveTowerVolleys(battle, runtime, 0.2); // still on cooldown
  assert.equal(battle.events.filter((e) => e.type === 'arrow').length, 0);

  battle.events = [];
  resolveTowerVolleys(battle, runtime, 0.5); // exactly due again
  assert.equal(battle.events.filter((e) => e.type === 'arrow').length, 1);
  assert.ok(Math.abs(squad.count - (20 - 2 * expectedKill)) < 1e-9);
  assert.equal(towerTile.i, tower.tile);
});

test('win: capturing the enemy keep cascades a surrender and ends the battle', () => {
  const arena = freshArena();
  const strongPlayer = { ...PLAYER, atk: 5, def: 5 };
  const battle = createBattle(arena, strongPlayer, ENEMY);
  const keep = battle.sites.find((s) => s.type === 'keep' && s.owner !== 0);
  issue(battle, { type: 'send', owner: 0, from: [0], to: keep.id, fraction: 1.0 });

  const steps = runToEnd(battle);
  assert.ok(steps < 20000);
  assert.equal(battle.result, 'win');
  assert.ok(battle.sites.filter((s) => s.tile !== undefined).every((s) => {
    const tile = getRuntime(battle).byIndex.get(s.tile);
    return tile.region !== arena.regionId || s.owner === 0;
  }), 'every site in the target region should now be player-owned');
  assert.equal(battle.stats.durationSec, battle.t);
});

test('lose: the player has no sites and no squads left', () => {
  const arena = tinyArena({ campTroops: 5, enemyType: 'fort', enemyTroops: 30 });
  const battle = createBattle(arena, PLAYER, ENEMY);
  const camp = battle.sites[0];
  const squad = {
    id: battle.nextId++, owner: 2, count: 30, from: 1, to: 0, path: [0], seg: 0, prog: 0.999,
    state: 'assault', foe: null,
  };
  battle.squads.push(squad);
  camp.assault = { owner: 2, squads: [squad.id] };

  runToEnd(battle);
  assert.equal(battle.result, 'lose');
  assert.ok(battle.events.some((e) => e.type === 'end' && e.result === 'lose'));
});

test('retreat ends the battle immediately and further steps are no-ops', () => {
  const arena = freshArena();
  const battle = createBattle(arena, PLAYER, ENEMY);
  issue(battle, { type: 'retreat' });
  step(battle, 0.05);
  assert.equal(battle.result, 'retreat');
  assert.ok(battle.events.some((e) => e.type === 'end' && e.result === 'retreat'));

  // step() unconditionally clears `events` before checking `result` (per ARCHITECTURE §6:
  // "clears then fills battle.events" applies even to a no-op call), so a snapshot taken
  // right after the retreat still holds that tick's `end` event and would never match a
  // later no-op step — compare everything BUT events, which is what "no-op" actually means.
  const { events: _before, ...rest } = battle;
  const snapshot = JSON.stringify(rest);
  step(battle, 0.05);
  const { events: _after, ...restAfter } = battle;
  assert.equal(battle.events.length, 0);
  assert.equal(JSON.stringify(restAfter), snapshot);
});

test('previewSend predicts the actual outcome when nothing else changes', () => {
  // Deliberately tinyArena (no towers) and zero growth: previewSend is a fast, no-simulation
  // estimate of the arrival strength check ("assuming nothing else changes"). It does not
  // model en-route hazards like tower fire or interception, and it projects the defender's
  // growth up to ARRIVAL but not through the fight's own (multi-tick, progressive)
  // duration — both documented limitations (see the final report), not bugs. Growth is
  // zeroed here so this test isolates the part previewSend actually claims to predict.
  const arena = tinyArena({ campTroops: 30, enemyType: 'village', enemyTroops: 20 });
  const battle = createBattle(arena, PLAYER_ZG, ENEMY_ZG);
  const village = battle.sites[1];
  const preview = previewSend(battle, [0], village.id, 1.0);
  assert.ok(['capture', 'fail', 'reinforce'].includes(preview.outcome));
  assert.equal(preview.sending, Math.floor(battle.sites[0].troops * 1.0));

  issue(battle, { type: 'send', owner: 0, from: [0], to: village.id, fraction: 1.0 });
  runUntilSettled(battle, 3000);
  if (preview.outcome === 'capture') {
    assert.equal(village.owner, 0);
    assert.ok(Math.abs(village.troops - preview.remaining) < 1e-6,
      `preview said ~${preview.remaining}, actual was ${village.troops}`);
  } else if (preview.outcome === 'fail') {
    assert.equal(village.owner, 2);
  }
});
