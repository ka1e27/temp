// Phase 12 (PLAN-PHASE12) in the sim: sea-lane routing and its rules, lane squads (no clashes, coastal towers, the Admiral's shield),
// fords and Navigator, the Tide Fortress (telegraph, flood, the 30% loss, the Drowned Crown, sea reinforcements and the harbour that
// stops them), Broadside, the raider's longships, the Admiral and the Sea Queen. Synthetic arenas; archipelago arenas in the world test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, step, issue, routeFor, abilityState } from '../battle/sim.js';
import { think } from '../battle/ai.js';
import { towerIgnores } from '../battle/boons.js';
import { TIDE, LANE, SEA_FACTION } from '../config/sea.js';
import { CHAMPION_OF_FACTION } from '../config/generals.js';
import { abilityOf, commanderEffects, recruitChampion, ensureGenerals } from '../meta/generalsState.js';
import { passiveText, abilityText } from '../meta/generals.js';
import { championTitle, leaderFor } from '../meta/leaders.js';

const SQ3 = Math.sqrt(3);
const POW = Object.freeze({ rally: 0, firestorm: 0, bulwark: 0, march: 0, levy: 0 });
const BASE = Object.freeze({ atk: 1, def: 1, growth: 0, speed: 1, campTroops: 100, garrisonShare: 0.35, capBonus: 0, cooldownMult: 1, powers: POW });
const ENEMY = Object.freeze({ atk: 1, def: 1, growth: 0, speed: 1, troopMult: 1, thinkSec: 1, graceSec: 999, personality: 'raider', factionId: SEA_FACTION });

/**
 * A strip of land q = 0..10 (r = 0), fords at q = 4..6, and a sea row (r = -1) above it. Sites: [tile q, type, owner, troops, flags].
 * Every land tile is the player's halo except q = 10 (the target region). `lanes`: [a, b] site pairs joined along the sea row.
 */
function arena(sites, lanes = [], extra = {}) {
  const tiles = [];
  for (let q = 0; q <= 10; q++) {
    const ford = q >= 4 && q <= 6;
    const t = { i: q, q, r: 0, x: q * SQ3, y: 0, cost: ford ? 2.5 : 1, terrain: ford ? 'ford' : 'grass', region: q === 10 ? 0 : 1 };
    if (ford) t.ford = true;
    if (q !== 10) t.own = 0;
    tiles.push(t);
  }
  const seaAt = (q) => ({ i: 100 + q, q: q + 1, r: -1, x: (q + 0.5) * SQ3, y: -1.5, cost: LANE.tileCost, terrain: 'sea', sea: true });
  const list = sites.map(([q, type, owner, troops, flags = {}], id) => ({ id, settlement: id - 1, tile: q, type, owner, troops, ...flags }));
  const seaLanes = lanes.map(([a, b]) => {
    const qa = list[a].tile;
    const qb = list[b].tile;
    const qs = [];
    for (let q = Math.min(qa, qb); q < Math.max(qa, qb); q++) qs.push(100 + q);
    return { a, b, tiles: qa < qb ? qs : qs.reverse(), cost: qs.length * LANE.tileCost };
  });
  const seaTiles = [];
  for (let q = 0; q <= 10; q++) seaTiles.push(seaAt(q));
  return { regionId: 0, enemyFaction: SEA_FACTION, tiles, sites: list, focus: { minX: 0, maxX: 10 * SQ3, minY: -1.5, maxY: 0 }, marches: [],
    sea: { lanes: seaLanes, seaTiles, ...extra } };
}
const run = (b, sec, onEvents) => { const end = b.t + sec; while (!b.result && b.t < end - 1e-9) { step(b, 0.05); if (onEvents) onEvents(b.events); } };
const C = { coastal: true };
const P = { coastal: true, port: true };

test('lanes: the player sails only between two harbours it holds; the raider between any coastal sites while it holds a harbour', () => {
  const sites = [[0, 'camp', 0, 50], [1, 'village', 0, 20, P], [8, 'village', 0, 20, P], [9, 'village', 0, 5, C], [10, 'keep', SEA_FACTION, 40]];
  const b = createBattle(arena(sites, [[1, 2], [1, 3]]), BASE, ENEMY);
  const r = routeFor(b, 0, 1, 2);
  assert.equal(r.lane, true, 'harbour to harbour: by sea');
  assert.ok(r.cost < routeFor(b, 0, 0, 2).cost, 'the lane is the cheaper way');
  assert.equal(r.points.length, r.tiles.length + 1);
  assert.notEqual(routeFor(b, 0, 1, 3).lane, true, 'a harbour to a plain coastal site: overland');

  const raid = [[0, 'camp', 0, 50], [1, 'village', SEA_FACTION, 20, C], [8, 'village', SEA_FACTION, 20, C], [9, 'harbour', SEA_FACTION, 5, P], [10, 'keep', SEA_FACTION, 40]];
  const rb = createBattle(arena(raid, [[1, 2]]), BASE, ENEMY);
  assert.equal(routeFor(rb, SEA_FACTION, 1, 2).lane, true, 'longships between two coastal sites');
  const cut = createBattle(arena(raid.map((s, i) => (i === 3 ? [9, 'harbour', 0, 5, P] : s)), [[1, 2]]), BASE, ENEMY);
  assert.notEqual(routeFor(cut, SEA_FACTION, 1, 2)?.lane, true, 'taking their harbour cuts their lanes');
  assert.notEqual(routeFor(createBattle(arena(raid, [[1, 2]]), BASE, { ...ENEMY, personality: 'aggressive' }), SEA_FACTION, 1, 2)?.lane, true,
    'only the raider sails between non-harbours');
});

test('a lane squad: marked, shot by a coastal tower unless the Admiral commands', () => {
  const sites = [[0, 'camp', 0, 50], [1, 'village', 0, 40, P], [9, 'village', 0, 5, P], [5, 'tower', SEA_FACTION, 30], [10, 'keep', SEA_FACTION, 40]];
  const go = (player) => {
    const b = createBattle(arena(sites, [[1, 2]]), player, ENEMY);
    issue(b, { type: 'send', owner: 0, from: [1], to: 2, fraction: 1 });
    const ev = [];
    run(b, 0.1, (e) => ev.push(...e));
    const squad = b.squads.find((q) => q.owner === 0);
    run(b, 20, (e) => ev.push(...e));
    return { b, ev, squad };
  };
  const plain = go(BASE);
  assert.equal(plain.squad.lane, true);
  assert.ok(plain.ev.some((e) => e.type === 'send' && e.lane));
  assert.ok(plain.ev.some((e) => e.type === 'arrow' && e.squad === plain.squad.id), 'the coastal tower shoots the boats');
  const shielded = go({ ...BASE, laneShield: true });
  assert.ok(!shielded.ev.some((e) => e.type === 'arrow' && e.squad === shielded.squad.id), 'the Admiral: no tower fire at sea');
  assert.ok(shielded.b.sites[2].troops > plain.b.sites[2].troops, 'more arrive unshot');
  assert.equal(towerIgnores(shielded.b, shielded.b.sites[3], { owner: 0, lane: true }), true);
  assert.equal(towerIgnores(shielded.b, shielded.b.sites[3], { owner: 0 }), false);
});

test('fords cost x2.5 to cross; Navigator makes it x1.5', () => {
  const sites = [[0, 'camp', 0, 50], [10, 'keep', SEA_FACTION, 1]];
  const arrive = (player) => {
    const b = createBattle(arena(sites), player, { ...ENEMY, personality: 'aggressive' });
    issue(b, { type: 'send', owner: 0, from: [0], to: 1, fraction: 0.5 });
    let at = null;
    run(b, 40, (ev) => { if (at == null && ev.some((e) => e.type === 'assault' || e.type === 'capture')) at = b.t; });
    return at;
  };
  const plain = arrive(BASE);
  const nav = arrive({ ...BASE, boons: { fordCostMult: 0.6 } });
  assert.ok(plain > 0 && nav > 0);
  assert.ok(nav < plain - 2, `Navigator ${nav.toFixed(1)} s vs ${plain.toFixed(1)} s`);
});

/** The Tide Fortress: the keep at q = 10 with its harbour at q = 9, the fords q = 4..6 flood. */
function fortress(player = BASE, harbourOwner = SEA_FACTION) {
  const sites = [[0, 'camp', 0, 50], [9, 'harbour', harbourOwner, 5, P], [10, 'keep', SEA_FACTION, 60]];
  const tide = { site: 2, harbour: 1, tiles: [4, 5, 6], keepTroops: 60 };
  return createBattle(arena(sites, [], { tide }), player, ENEMY);
}
/** Parks a squad on the ford at q = 5 (it barely moves: speedMult tiny). */
function park(b, owner, count, at = 5) {
  const squad = { id: b.nextId++, owner, count, from: 0, to: 2, path: [at, 6, 7, 8, 9, 10], seg: 0, prog: 0.6, state: 'march', foe: null, speedMult: 1e-6 };
  b.squads.push(squad);
  return squad;
}

test('the Tide: telegraphed 4 s ahead, floods the fords every 40 s for 10 s, squads caught lose 30%, the fortress is spared', () => {
  const b = fortress();
  const mine = park(b, 0, 50);
  const ev = [];
  run(b, TIDE.everySec - TIDE.telegraphSec - 0.2, (e) => ev.push(...e));
  assert.ok(!ev.some((e) => e.type === 'tideRising'));
  run(b, 0.4, (e) => ev.push(...e));
  const rising = ev.find((e) => e.type === 'tideRising');
  assert.ok(rising && rising.at === TIDE.everySec && rising.tiles.length === 3, 'the telegraph');
  const foe = park(b, SEA_FACTION, 50, 4); // a hex apart: no clash
  run(b, TIDE.telegraphSec + 0.2, (e) => ev.push(...e));
  assert.ok(ev.some((e) => e.type === 'tideFlood' && e.until === TIDE.everySec + TIDE.floodSec));
  const hit = ev.filter((e) => e.type === 'tideHit');
  assert.equal(hit.length, 1, 'once per flood, and never the fortress\'s own squad');
  assert.equal(hit[0].squad, mine.id);
  assert.ok(Math.abs(mine.count - 50 * (1 - TIDE.loss)) < 1e-6, `${mine.count}`);
  assert.equal(foe.count, 50);
  run(b, TIDE.floodSec, (e) => ev.push(...e));
  assert.ok(ev.some((e) => e.type === 'tideEbb'));
  run(b, TIDE.everySec, (e) => ev.push(...e));
  assert.equal(ev.filter((e) => e.type === 'tideFlood').length, 2, 'the next tide');
  // the Drowned Crown: never flooded
  const crown = fortress({ ...BASE, boons: { tideImmune: true } });
  const safe = park(crown, 0, 50);
  run(crown, TIDE.everySec + 1);
  assert.equal(safe.count, 50);
});

test('the Tide Fortress: boats land troops while it holds its harbour; holding the harbour stops them', () => {
  const b = fortress();
  const ev = [];
  run(b, TIDE.reinforce.everySec + 0.1, (e) => ev.push(...e));
  const land = ev.filter((e) => e.type === 'seaReinforce');
  assert.equal(land.length, 1);
  assert.equal(land[0].count, Math.max(TIDE.reinforce.minTroops, Math.round(TIDE.reinforce.growthSec * b.sites[2].growth)));
  assert.ok(b.sites[2].troops > 60);
  const held = fortress(BASE, 0);
  const ev2 = [];
  run(held, TIDE.reinforce.everySec * 2 + 0.1, (e) => ev2.push(...e));
  assert.ok(!ev2.some((e) => e.type === 'seaReinforce'));
  assert.equal(held.sites[2].troops, 60);
});

test('Broadside: every coastal enemy site loses 2% a second for 8 s; inland sites untouched', () => {
  const admiral = { ...BASE, ability: { id: 'broadside', duration: 8, perSec: 0.02 } };
  const sites = [[0, 'camp', 0, 50], [8, 'village', SEA_FACTION, 60, C], [10, 'keep', SEA_FACTION, 100]]; // under the caps: no bleed
  const b = createBattle(arena(sites), admiral, { ...ENEMY, personality: 'aggressive' });
  assert.equal(abilityState(b).id, 'broadside');
  assert.equal(abilityState(b).needsTarget, false);
  issue(b, { type: 'ability', owner: 0, ability: 'broadside' });
  const ev = [];
  run(b, 10, (e) => ev.push(...e));
  const ab = ev.find((e) => e.type === 'ability' && e.ability === 'broadside');
  assert.deepEqual(ab.sites, [1]);
  assert.ok(Math.abs(b.sites[1].troops - 60 * Math.exp(-0.16)) < 0.5, `${b.sites[1].troops}`);
  assert.equal(b.sites[2].troops, 100);
  assert.ok(ev.filter((e) => e.type === 'broadsideHit').reduce((n, e) => n + e.count, 0) >= 8);
});

test('longships: a raider coastal site that cannot hold evacuates by sea instead', () => {
  const sites = [[0, 'camp', 0, 80], [3, 'village', SEA_FACTION, 10, C], [9, 'harbour', SEA_FACTION, 10, P], [10, 'keep', SEA_FACTION, 40]];
  const b = createBattle(arena(sites, [[1, 2]]), BASE, { ...ENEMY, graceSec: 0 });
  issue(b, { type: 'send', owner: 0, from: [0], to: 1, fraction: 1 });
  run(b, 1.5);
  const cmds = think(b, b.t);
  const out = cmds.find((c) => c.type === 'send' && c.from.includes(1) && c.to === 2);
  assert.ok(out, JSON.stringify(cmds));
  assert.equal(routeFor(b, SEA_FACTION, 1, 2).lane, true);
});

test('the Admiral and the Sea Queen', () => {
  assert.equal(CHAMPION_OF_FACTION[SEA_FACTION], 'admiral');
  const state = { seed: 4, generals: null };
  ensureGenerals(state);
  const g = recruitChampion(state, SEA_FACTION);
  assert.equal(g.id, 'champion:6');
  assert.equal(g.style, 'swift');
  assert.equal(commanderEffects(g).laneShield, true);
  const a = abilityOf(g);
  assert.deepEqual(a, { id: 'broadside', duration: 8, perSec: 0.02 });
  assert.match(passiveText(g), /sea lanes/);
  assert.match(abilityText(g), /^Broadside: every coastal enemy site loses 2%/);
  g.level = 10;
  g.skills = [0, 0, 1, 0, 0];
  assert.equal(abilityOf(g).duration, 8 + 3 + 3);
  assert.ok(commanderEffects(g).laneSpeedMult > 1);
  assert.equal(championTitle(SEA_FACTION), 'Reaver Captain');
  const q = leaderFor(11, 3, SEA_FACTION);
  assert.equal(q.title, 'Queen');
  assert.equal(q.fullName, `Queen ${q.name} of the Grey Tide`);
});
