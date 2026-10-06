// The Living Frontier meta (DESIGN §10.1, §10.2, §10.10; ARCHITECTURE §10.4): the raid scheduler (grace, pace, caps, cooldowns,
// determinism), defense runs and rewards, occupation and retaking, and the away rules (one test per limit).
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/generate.js';
import { createGame } from '../meta/state.js';
import { conquer, difficulty, enemyBattleStats } from '../meta/progression.js';
import { incomePerSec } from '../meta/economy.js';
import { bounty } from '../meta/economy.js';
import {
  tickFrontier, defenseRunFor, defenseReward, occupy, retake, resolveAway, estimateDefense, ensureFrontier, inGrace,
  borderingRivals, raidRate, activeDefenses, sanitizeFrontier, sanitizeOccupation, defaultFrontier, attackArenaOpts,
  awayReportText, occupationOf, resetFrontier, busyFromState,
} from '../meta/frontier.js';
import { militiaFill } from '../meta/militia.js';
import { FRONTIER, FORTS } from '../config/frontier.js';
import { createBattle, step, issue } from '../battle/sim.js';
import { think } from '../battle/ai.js';
import { stewardDecide } from '../battle/steward.js';
import { TICK_SEC } from '../config/battle.js';

const HOUR = 3600 * 1000;
const worlds = new Map();
function worldOf(seed) {
  if (!worlds.has(seed)) worlds.set(seed, generateWorld(seed));
  return worlds.get(seed);
}

/** A realm holding every region of tier <= maxTier (seed 5: 18 regions, three bordering rivals). */
function realm(seed = 5, maxTier = 2, activeSec = FRONTIER.graceSec + 1) {
  const world = worldOf(seed);
  const state = createGame(seed, world, 0);
  for (const r of world.regions) if (r.tier <= maxTier) { state.owner[r.id] = 0; state.conqueredAt[r.id] = 0; }
  state.battles = [];
  ensureFrontier(state).activeSec = activeSec;
  state.frontier.nextCheckAt = activeSec;
  return { world, state };
}

/** Runs the scheduler for `sec` active seconds in 1 s ticks; arrived raids are dropped (nobody fights them). */
function runScheduler(state, world, sec, onTick) {
  const all = { announced: [], arrived: [] };
  for (let i = 0; i < sec; i++) {
    const r = tickFrontier(state, world, i * 1000, 1);
    all.announced.push(...r.announced);
    all.arrived.push(...r.arrived);
    if (onTick) onTick(r, i);
  }
  return all;
}

// --- state shapes --------------------------------------------------------------------------------------------------------

test('state: ensureFrontier creates and repairs; sanitizers turn junk into valid state', () => {
  const s = {};
  const f = ensureFrontier(s);
  assert.deepEqual(f, defaultFrontier());
  s.frontier.incoming = 'junk';
  ensureFrontier(s);
  assert.deepEqual(s.frontier.incoming, []);
  assert.deepEqual(sanitizeFrontier(null), defaultFrontier());
  const clean = sanitizeFrontier({
    seq: -4, rng: 'x', activeSec: 50, cooldown: { 3: 99, x: 1, 4: 'no' },
    incoming: [{ id: 2, faction: 3, fromRegionId: 1, toRegionId: 4, arriveAt: 60 }, { id: 3, faction: 1, fromRegionId: 1, toRegionId: 2 }, null],
    stats: { raids: 3.7, retakes: -2 }, extra: 1,
  });
  assert.equal(clean.seq, 1);
  assert.equal(clean.rng, 0);
  assert.deepEqual(clean.cooldown, { 3: 99 });
  assert.equal(clean.incoming.length, 1, 'a Free Folk raid and junk are dropped');
  assert.equal(clean.incoming[0].first, false);
  assert.deepEqual(clean.stats, { raids: 3, defensesWon: 0, defensesLost: 0, retakes: 0 });
  assert.equal('extra' in clean, false);
  const occ = sanitizeOccupation({ 5: { by: 3, at: 10, prosperity: 7, tenureMs: -1, forts: [{ type: 'walls', level: 2 }, { type: 'x', level: 1 }], works: [{ type: 'market', level: 1 }, { type: 'bad', level: 1 }] }, 6: { by: 'x' }, y: {} });
  assert.deepEqual(Object.keys(occ), ['5']);
  assert.equal(occ[5].prosperity, 3);
  assert.equal(occ[5].tenureMs, 0);
  assert.deepEqual(occ[5].forts, [{ type: 'walls', level: 2 }]);
  assert.deepEqual(occ[5].works, [{ type: 'market', level: 1 }]);
  const json = JSON.parse(JSON.stringify(clean));
  assert.deepEqual(sanitizeFrontier(json), clean, 'a sanitised frontier survives a round trip unchanged');
});

// --- grace, pace, caps, cooldowns -------------------------------------------------------------------------------------------

test('grace: no raids in the first graceSec of active play', () => {
  const { world, state } = realm(5, 2, 0);
  state.frontier.nextCheckAt = 0;
  const { announced } = runScheduler(state, world, FRONTIER.graceSec - 1);
  assert.equal(announced.length, 0);
  assert.equal(inGrace(state), true, 'still in grace a second before graceSec');
  const after = runScheduler(state, world, 1800);
  assert.ok(after.announced.length > 0, 'raids come once the grace is over');
  assert.ok(after.announced.every((r) => r.announcedAt >= FRONTIER.graceSec));
  assert.equal(inGrace(state), false);
});

test('grace: no raids before the player holds minRegions regions', () => {
  const { world, state } = realm(5, 2);
  const keep = world.regions.filter((r) => state.owner[r.id] === 0).slice(0, FRONTIER.minRegions - 1).map((r) => r.id);
  for (const r of world.regions) if (!keep.includes(r.id)) state.owner[r.id] = r.faction === 0 ? 1 : r.faction;
  assert.equal(inGrace(state), true);
  assert.equal(runScheduler(state, world, 3600).announced.length, 0);
});

test('pace: about one raid per bordering rival per raidMeanSec x its personality rate (measured over many realms)', () => {
  let expected = 0;
  let got = 0;
  for (const seed of [4, 5, 6, 7]) {
    for (let k = 0; k < 4; k++) {
      const { world, state } = realm(seed, 2);
      state.seed = seed * 100 + k; // a different stream per run
      for (const { faction } of borderingRivals(state, world)) expected += raidRate(state, world, faction) * 1800;
      // a raid in flight blocks a second one on its region and the two-raid cap; dropping arrivals keeps both honest
      got += runScheduler(state, world, 1800).announced.length;
    }
  }
  assert.ok(got > 0.6 * expected && got < 1.25 * expected, `raids ${got}, expected about ${expected.toFixed(1)} (caps and cooldowns trim it)`);
});

test('pace: personality, provocation and decapitation set the rate; Free Folk never raid', () => {
  const { world, state } = realm(5, 2);
  const byP = (p) => world.factions.findIndex((f) => f.personality === p);
  const base = 1 / FRONTIER.raidMeanSec;
  assert.ok(Math.abs(raidRate(state, world, byP('aggressive')) - base * FRONTIER.personalityRate.aggressive) < 1e-12);
  assert.ok(Math.abs(raidRate(state, world, byP('swarm')) - base * FRONTIER.personalityRate.swarm) < 1e-12);
  const def = byP('defensive');
  assert.ok(Math.abs(raidRate(state, world, def) - base * FRONTIER.personalityRate.defensive) < 1e-12);
  state.frontier.provoked[def] = state.frontier.activeSec - 60;
  assert.ok(Math.abs(raidRate(state, world, def) - base * FRONTIER.provokedRate) < 1e-12, 'provoked');
  state.frontier.provoked[def] = state.frontier.activeSec - FRONTIER.provokedSec - 1;
  assert.ok(raidRate(state, world, def) < base * FRONTIER.provokedRate, 'the grudge fades');
  assert.equal(raidRate(state, world, 1), 0, 'Free Folk');
  assert.equal(raidRate(state, world, 0), 0);
  const agg = byP('aggressive');
  state.owner[world.factions[agg].capitalRegion] = 0;
  assert.ok(Math.abs(raidRate(state, world, agg) - base * FRONTIER.personalityRate.aggressive * FRONTIER.decapitatedRate) < 1e-12, 'decapitated');
});

test('conquering a rival region provokes it', () => {
  const { world, state } = realm(5, 2);
  const rival = world.regions.find((r) => state.owner[r.id] >= 2);
  conquer(state, world, rival.id, 1000);
  assert.equal(state.frontier.provoked[rival.faction], state.frontier.activeSec);
});

test('caps: never more than maxDefenses raids incoming or fought at once', () => {
  const { world, state } = realm(7, 2);
  let peak = 0;
  runScheduler(state, world, 3 * 3600, (r) => {
    // every arrived raid becomes a defense battle that lasts 100 s
    for (const raid of r.arrived) state.battles.push({ kind: 'defense', regionId: raid.toRegionId, battle: { result: null, arena: { sites: [] } }, endsAt: state.frontier.activeSec + 100 });
    state.battles = state.battles.filter((b) => b.endsAt > state.frontier.activeSec);
    peak = Math.max(peak, activeDefenses(state));
  });
  assert.ok(peak <= FRONTIER.maxDefenses, `peak ${peak}`);
  assert.equal(peak, FRONTIER.maxDefenses, 'and the cap is reached in a busy realm');
});

test('cooldown: a region is not raided again within regionCooldownSec of a raid arriving', () => {
  const { world, state } = realm(6, 2);
  const { announced } = runScheduler(state, world, 4 * 3600);
  assert.ok(announced.length > 10);
  const byRegion = new Map();
  for (const r of announced) {
    const prev = byRegion.get(r.toRegionId);
    if (prev) assert.ok(r.announcedAt >= prev.arriveAt + FRONTIER.regionCooldownSec - 1e-9, `region ${r.toRegionId} raided too soon`);
    byRegion.set(r.toRegionId, r);
  }
});

test('raids: telegraphed with a Beacon\'s extra warning, the realm\'s first is flagged, strength shown, targets your border', () => {
  const { world, state } = realm(5, 2);
  for (const r of world.regions) if (state.owner[r.id] === 0) state.forts = { ...(state.forts || {}), [r.id]: [{ type: 'beacon', level: 2 }] };
  const { announced } = runScheduler(state, world, 3600);
  assert.ok(announced.length >= 2);
  assert.equal(announced[0].first, true);
  assert.equal(announced[1].first, false);
  for (const r of announced) {
    assert.ok(Math.abs(r.arriveAt - r.announcedAt - (FRONTIER.telegraphSec + FORTS.effects.beacon.warnSec[1])) < 1e-9);
    assert.ok(r.strength > 0);
    assert.equal(state.owner[r.toRegionId], 0);
    assert.ok(world.regions[r.toRegionId].neighbors.includes(r.fromRegionId));
    assert.equal(state.owner[r.fromRegionId], r.faction);
  }
});

test('arrivals wait at the border while 3 battles run or the region is already being fought over', () => {
  const { world, state } = realm(5, 2);
  let first = null;
  for (let i = 0; i < 3600 && !first; i++) first = tickFrontier(state, world, 0, 1).announced[0] || null;
  assert.ok(first);
  const fake = (regionId) => ({ kind: 'attack', regionId, battle: { result: null, arena: { sites: [] } } });
  state.battles = [fake(900), fake(901), fake(902)];
  let arrived = [];
  for (let i = 0; i < 120; i++) arrived = arrived.concat(tickFrontier(state, world, 0, 1).arrived);
  assert.equal(arrived.filter((r) => r.id === first.id).length, 0, 'held while three battles run');
  state.battles = [fake(first.toRegionId)];
  for (let i = 0; i < 20; i++) arrived = arrived.concat(tickFrontier(state, world, 0, 1).arrived);
  assert.equal(arrived.filter((r) => r.id === first.id).length, 0, 'held while its region is in a battle');
  state.battles = [];
  for (let i = 0; i < 20; i++) arrived = arrived.concat(tickFrontier(state, world, 0, 1).arrived);
  assert.equal(arrived.filter((r) => r.id === first.id).length, 1, 'arrives once there is room');
});

test('a raid on a region that fell meanwhile is called off', () => {
  const { world, state } = realm(5, 2);
  let raid = null;
  for (let i = 0; i < 3600 && !raid; i++) raid = tickFrontier(state, world, 0, 1).announced[0] || null;
  state.owner[raid.toRegionId] = raid.faction;
  let arrived = [];
  for (let i = 0; i < 200; i++) arrived = arrived.concat(tickFrontier(state, world, 0, 1).arrived);
  assert.ok(!arrived.some((r) => r.id === raid.id));
  assert.ok(!state.frontier.incoming.some((r) => r.id === raid.id));
});

test('determinism: the same seed and the same calls announce the same raids (also with big time steps)', () => {
  const play = (stepSec) => {
    const { world, state } = realm(6, 2);
    const out = [];
    for (let t = 0; t < 7200; t += stepSec) out.push(...tickFrontier(state, world, t * 1000, stepSec).announced);
    return { out, f: state.frontier };
  };
  const a = play(1);
  const b = play(1);
  assert.deepEqual(a.out, b.out);
  assert.deepEqual(a.f, b.f);
  const big = play(300);
  assert.ok(big.out.length > 0, 'a long step still schedules raids window by window');
  assert.deepEqual(big.out.map((r) => r.announcedAt), a.out.map((r) => r.announcedAt).slice(0, big.out.length).map((x, i) => big.out[i].announcedAt), 'raids are stamped at their check window');
});

// --- defense runs, rewards, occupation, retake ---------------------------------------------------------------------------------

function firstRaid(seed = 5) {
  const { world, state } = realm(seed, 2);
  let raid = null;
  for (let i = 0; i < 7200 && !raid; i++) raid = tickFrontier(state, world, 0, 1).announced[0] || null;
  return { world, state, raid };
}

test('defenseRunFor: a BattleRun with a defense battle built from the region\'s militia and fortifications', () => {
  const { world, state, raid } = firstRaid();
  state.forts = { [raid.toRegionId]: [{ type: 'walls', level: 1 }] };
  const seq = state.frontier.seq;
  const run = defenseRunFor(state, world, raid, null, { nowMs: 5000 });
  assert.equal(run.id, seq);
  assert.equal(state.frontier.seq, seq + 1);
  assert.equal(run.kind, 'defense');
  assert.equal(run.regionId, raid.toRegionId);
  assert.equal(run.fromRegionId, raid.fromRegionId);
  assert.equal(run.attackerFaction, raid.faction);
  assert.equal(run.startedAt, 5000);
  assert.equal(run.auto, false);
  assert.equal(run.commander, null);
  assert.equal(run.battle.mode, 'defense');
  assert.ok(run.battle.siegeSec > 0);
  assert.equal(run.battle.arena.enemyFaction, raid.faction);
  assert.ok(run.battle.sites[run.battle.arena.keepSite].defMult > 1, 'Walls');
  assert.deepEqual(JSON.parse(JSON.stringify(run)), run, 'plain JSON');
});

test('defenseReward: a win pays a share of the bounty, drains the militia and counts; a loss pays nothing', () => {
  const { world, state, raid } = firstRaid();
  const run = defenseRunFor(state, world, raid, null, { nowMs: 0 });
  const expected = bounty(state, world, raid.toRegionId) * FRONTIER.reward.bountyShare;
  const gold = state.gold;
  assert.deepEqual(defenseReward(state, world, run, 'lose', 1000), { gold: 0, renown: 0 });
  assert.equal(state.gold, gold);
  const r = defenseReward(state, world, run, 'win', 1000);
  assert.ok(Math.abs(r.gold - expected) < 1e-9);
  assert.equal(r.renown, 3, 'Renown: 2 for the defense, +1 as no settlement fell (DESIGN §10.12)');
  assert.ok(Math.abs(state.gold - gold - expected) < 1e-9);
  assert.equal(state.frontier.stats.defensesWon, 1);
  assert.ok(militiaFill(state, raid.toRegionId, 1000) <= 1 - FRONTIER.militia.lossFloor + 1e-9, 'the militia marched');
  assert.equal(militiaFill(state, raid.toRegionId, 1000 + FRONTIER.militia.refillMs), 1, 'and refills');
});

test('occupy and retake: income stops, prosperity freezes, forts and Works change hands and come back', () => {
  const { world, state, raid } = firstRaid();
  const id = raid.toRegionId;
  const T = 3 * HOUR;
  state.conqueredAt[id] = 0;
  state.prosperity = world.regions.map(() => 0);
  state.prosperity[id] = 2;
  state.forts = { [id]: [{ type: 'tower', level: 2 }, { type: 'walls', level: 1 }] };
  state.works = { [id]: [{ type: 'barracks', level: 1 }] };
  const income = incomePerSec(state, world);
  const before = difficulty(state, world, id); // reads 'owned', not meaningful; just exercises the call
  void before;
  const occ = occupy(state, world, id, raid.faction, T);
  assert.equal(state.owner[id], raid.faction);
  assert.equal(state.conqueredAt[id], null);
  assert.ok(incomePerSec(state, world) < income, 'its income stops');
  assert.equal(occ.prosperity, 2);
  assert.equal(occ.tenureMs, T);
  assert.deepEqual(occ.forts, [{ type: 'tower', level: 2 }, { type: 'walls', level: 1 }]);
  assert.deepEqual(occ.works, [{ type: 'barracks', level: 1 }]);
  assert.equal(state.forts[id], undefined);
  assert.equal(state.works[id], undefined);
  assert.equal(occupationOf(state, id).by, raid.faction);
  assert.equal(occupy(state, world, id, raid.faction, T), null, 'only a region the player holds can fall');
  // the occupier fights for it with the captured fortifications
  const enemy = enemyBattleStats(world, state, id);
  assert.equal(enemy.factionId, raid.faction);
  assert.equal(enemy.personality, world.factions[raid.faction].personality);
  const opts = attackArenaOpts(state, world, id);
  assert.deepEqual(opts.forts, occ.forts);
  const withForts = difficulty(state, world, id);
  const bare = structuredClone(state);
  bare.occupation[id].forts = [];
  assert.ok(withForts.strength > difficulty(bare, world, id).strength, 'the card counts the captured fortifications');
  // retake through conquer: a share of the bounty, not a new conquest
  const conquered = state.stats.regionsConquered;
  const expectGold = bounty(state, world, id) * FRONTIER.reward.retakeBountyShare;
  const res = conquer(state, world, id, T + HOUR);
  assert.equal(res.retaken, true);
  assert.ok(Math.abs(res.bounty - expectGold) < 1e-9);
  assert.equal(state.stats.regionsConquered, conquered, 'a retake is not a new conquest');
  assert.equal(state.owner[id], 0);
  assert.equal(state.conqueredAt[id], T + HOUR - T, 'tenure resumes where it stopped');
  assert.equal(state.prosperity[id], 2);
  assert.deepEqual(state.forts[id], [{ type: 'tower', level: 2 }, { type: 'walls', level: 1 }]);
  assert.deepEqual(state.works[id], [{ type: 'barracks', level: 1 }]);
  assert.equal(occupationOf(state, id), null);
  assert.equal(state.frontier.stats.retakes, 1);
  assert.ok(militiaFill(state, id, T + HOUR) <= FRONTIER.retakeMilitiaFill + 1e-9);
  assert.equal(retake(state, world, id, T), null, 'nothing to retake twice');
});

test('occupy calls off raids still marching on the region; resetFrontier clears everything', () => {
  const { world, state, raid } = firstRaid();
  assert.ok(state.frontier.incoming.some((r) => r.id === raid.id));
  occupy(state, world, raid.toRegionId, raid.faction, 0);
  assert.ok(!state.frontier.incoming.some((r) => r.toRegionId === raid.toRegionId));
  resetFrontier(state);
  assert.deepEqual(state.frontier, defaultFrontier());
  assert.deepEqual(state.occupation, {});
});

test('a full defense: the region\'s keep falls to a strong raid, occupy hands it over, and the arena would rebuild for a retake', () => {
  const { world, state, raid } = firstRaid(6);
  const run = defenseRunFor(state, world, { ...raid, mult: 6 }, null, { nowMs: 0 });
  const b = run.battle;
  while (!b.result) { for (const c of think(b, b.t)) issue(b, c); step(b, TICK_SEC); }
  assert.equal(b.result, 'lose');
  occupy(state, world, run.regionId, run.attackerFaction, 1000);
  assert.equal(state.owner[run.regionId], raid.faction);
  assert.deepEqual(busyFromState(state, world).regions.size, 0);
});

test('estimateDefense: odds for the card, better with fortifications, a likely raider assumed when none is given', () => {
  const { world, state, raid } = firstRaid();
  const plain = estimateDefense(state, world, raid.toRegionId, raid, { nowMs: 0 });
  assert.ok(plain.winChance > 0 && plain.winChance < 1);
  assert.ok(['Easy', 'Fair', 'Hard', 'Deadly'].includes(plain.label));
  assert.ok(plain.theirs > 0 && plain.yours > 0);
  assert.ok(plain.inPerson >= plain.winChance);
  state.forts = { [raid.toRegionId]: [{ type: 'walls', level: 2 }, { type: 'tower', level: 2 }] };
  const walled = estimateDefense(state, world, raid.toRegionId, raid, { nowMs: 0 });
  assert.ok(walled.ratio > plain.ratio && walled.winChance >= plain.winChance);
  const guess = estimateDefense(state, world, raid.toRegionId, null, { nowMs: 0 });
  assert.ok(guess.winChance > 0 && !guess.none);
  const inner = world.regions.find((r) => state.owner[r.id] === 0 && r.neighbors.every((n) => state.owner[n] <= 1));
  if (inner) assert.equal(estimateDefense(state, world, inner.id, null).none, true, 'nobody can reach an inner region');
});

// --- the away rules (DESIGN §10.10), one test per limit ----------------------------------------------------------------------

const LOSE_ALL = { odds: () => 0 };

test('away: no region is lost unless the absence is longer than 3 h', () => {
  for (const seed of [4, 5, 6, 7]) {
    const { world, state } = realm(seed, 2);
    const away = FRONTIER.away.lossAfterMs; // exactly 3 h: still safe
    const report = resolveAway(state, world, away, 100 * HOUR, LOSE_ALL);
    assert.equal(report.lost.length, 0, `seed ${seed}`);
    assert.ok(report.raids.length > 0, 'raids still came');
    assert.ok(report.raids.every((r) => r.result === 'repelled'));
  }
});

test('away: at most one region per 4 h of absence, and never two within 4 h of each other', () => {
  for (const seed of [4, 5, 6, 7]) {
    const { world, state } = realm(seed, 2);
    const report = resolveAway(state, world, 3.5 * HOUR, 100 * HOUR, LOSE_ALL);
    assert.ok(report.lost.length <= 1, `3.5 h away, seed ${seed}: ${report.lost.length} lost`);
    const r2 = realm(seed, 2);
    const long = resolveAway(r2.state, r2.world, 7.9 * HOUR, 100 * HOUR, LOSE_ALL);
    const falls = long.raids.filter((r) => r.result === 'occupied').map((r) => r.atMs);
    for (let i = 1; i < falls.length; i++) assert.ok(falls[i] - falls[i - 1] >= FRONTIER.away.lossWindowMs, 'four hours apart');
    assert.ok(falls.length <= 2);
  }
});

test('away: at most two regions per absence, however long', () => {
  let sawTwo = false;
  for (const seed of [4, 5, 6, 7, 8]) {
    const { world, state } = realm(seed, 2);
    const report = resolveAway(state, world, 48 * HOUR, 100 * HOUR, LOSE_ALL);
    assert.ok(report.lost.length <= FRONTIER.away.maxLossesPerAbsence, `seed ${seed}: ${report.lost.length}`);
    if (report.lost.length === 2) sawTwo = true;
  }
  assert.ok(sawTwo, 'the limit is reached when every raid would win');
});

test('away: the home region is never lost', () => {
  // a realm of the home region and its first ring only, so raids land on home often
  for (const seed of [4, 5, 6, 7, 8]) {
    const { world, state } = realm(seed, 1);
    for (const r of world.regions) if (r.tier === 2 && r.faction === 1) state.owner[r.id] = 2; // rivals right next door
    const report = resolveAway(state, world, 48 * HOUR, 100 * HOUR, LOSE_ALL);
    assert.ok(!report.lost.includes(world.startRegion));
    assert.equal(state.owner[world.startRegion], 0);
  }
});

test('away: about one-fifth of the live raid rate', () => {
  let expected = 0;
  let got = 0;
  for (const seed of [4, 5, 6, 7]) {
    for (let k = 0; k < 6; k++) {
      const { world, state } = realm(seed, 2);
      state.seed = seed * 1000 + k;
      const awaySec = 2 * 3600;
      for (const { faction } of borderingRivals(state, world)) expected += raidRate(state, world, faction) * FRONTIER.away.rateMult * awaySec;
      got += resolveAway(state, world, awaySec * 1000, 100 * HOUR, { odds: () => 1 }).raids.length;
    }
  }
  assert.ok(got > 0.6 * expected && got < 1.3 * expected, `${got} raids, expected about ${expected.toFixed(1)}`);
});

test('away: raids still marching when the game closed are resolved first; the report reads well and is stored', () => {
  const { world, state, raid } = firstRaid(5);
  assert.ok(state.frontier.incoming.length > 0);
  const report = resolveAway(state, world, 30 * 60 * 1000, 100 * HOUR);
  assert.equal(state.frontier.incoming.length, 0);
  assert.equal(report.raids[0].toRegionId, raid.toRegionId);
  assert.equal(report.raids[0].atMs, 100 * HOUR - 30 * 60 * 1000);
  assert.equal(state.frontier.lastAwayReport, report);
  const text = awayReportText(report, world);
  assert.match(text, /^While you were away: \d+ attacks? repelled at /);
  const fell = { raids: [{ faction: 3, toRegionId: 2, result: 'occupied' }, { faction: 4, toRegionId: 3, result: 'repelled' }, { faction: 4, toRegionId: 4, result: 'repelled' }] };
  assert.equal(awayReportText(fell, world),
    `While you were away: 2 attacks repelled at ${world.regions[3].name} and ${world.regions[4].name}. ${world.regions[2].name} was occupied by the ${world.factions[3].name}: retake it.`);
  assert.equal(awayReportText({ raids: [] }, world), '');
});

test('away: deterministic, and nothing happens during the grace or for a zero absence', () => {
  const a = realm(6, 2);
  const b = realm(6, 2);
  assert.deepEqual(resolveAway(a.state, a.world, 9 * HOUR, 50 * HOUR), resolveAway(b.state, b.world, 9 * HOUR, 50 * HOUR));
  assert.deepEqual(a.state.owner, b.state.owner);
  const g = realm(6, 2, 0);
  assert.equal(resolveAway(g.state, g.world, 9 * HOUR, 50 * HOUR).raids.length, 0, 'grace');
  const z = realm(6, 2);
  assert.equal(resolveAway(z.state, z.world, 0, 50 * HOUR).raids.length, 0);
});

test('a defense played by the steward ends, and the run can be settled either way', () => {
  const { world, state, raid } = firstRaid(4);
  const run = defenseRunFor(state, world, raid, null, { nowMs: 0 });
  const b = run.battle;
  const battle2 = createBattle(b.arena, b.player, b.enemy, { mode: 'defense', siegeSec: b.siegeSec });
  const memo = {};
  while (!battle2.result) {
    for (const c of think(battle2, battle2.t)) issue(battle2, c);
    for (const c of stewardDecide(battle2, battle2.t, memo, 'captain')) issue(battle2, c);
    step(battle2, TICK_SEC);
  }
  assert.ok(['win', 'lose'].includes(battle2.result));
  if (battle2.result === 'win') assert.ok(defenseReward(state, world, { ...run, battle: battle2 }, 'win', 0).gold > 0);
  else assert.ok(occupy(state, world, run.regionId, run.attackerFaction, 0));
});

test('the campaign tool plays raids end to end, deterministically (tools/campaign.mjs)', async () => {
  const { runCampaign } = await import('../../tools/campaign.mjs');
  const a = runCampaign(5, { maxRegions: 18 }); // PLAN-PHASE11: the faster early ladder takes 14 regions before the grace and the scheduled first raid
  const b = runCampaign(5, { maxRegions: 18 });
  assert.ok(a.raids && a.raids.announced > 0, 'raids happened');
  assert.deepEqual(a.raids, b.raids);
  assert.deepEqual(a.timeline.map((r) => r.wallSec), b.timeline.map((r) => r.wallSec));
  assert.ok(a.raids.defenses.every((d) => d.atSec >= FRONTIER.graceSec), 'never during the grace');
  assert.equal(runCampaign(5, { maxRegions: 18, raids: 'off' }).raids, null);
});

test('Phase 10A: holdRaids keeps any new raid from setting out (the first raid waits its turn), and lifting it lets them come', () => {
  const { world, state } = realm(5, 2);
  let held = 0;
  for (let i = 0; i < 3600; i++) held += tickFrontier(state, world, 0, 1, { holdRaids: true, holdVendettas: true }).announced.length;
  assert.equal(held, 0, 'an hour of active play: none while held');
  let got = 0;
  for (let i = 0; i < 3600 && !got; i++) got += tickFrontier(state, world, 0, 1).announced.length;
  assert.ok(got > 0, 'they come once released');
});
