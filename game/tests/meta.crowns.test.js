import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, resetRegions, defaultStats, defaultSettings, PLAYER_FACTION } from '../meta/state.js';
import { conquer, playerBattleStats, enemyBattleStats } from '../meta/progression.js';
import { bounty, regionIncome } from '../meta/economy.js';
import { ECONOMY } from '../config/meta.js';
import {
  parFor, parBandOf, createCrownTracker, trackerOf, trackEvents, trackBattle, summarize, crownsFor,
  crownsForSurrender, evaluateBattle, awardCrowns, crownBonus, crownCount, crownTotals, getCrowns,
  emptyCrowns,
} from '../meta/crowns.js';
import { PAR, BOUNTY_FRACTION_PER_CROWN, CROWN_KEYS } from '../config/crowns.js';
import { makeWorld, makeGame } from './meta.fixtures.js';
import { generateWorld } from '../world/generate.js';
import { buildArena } from '../battle/arena.js';
import { createBattle, step, issue } from '../battle/sim.js';
import { think } from '../battle/ai.js';
import { decide } from '../battle/bot.js';
import { TICK_SEC } from '../config/battle.js';

/** A thawed copy of the fixture world with `patch(region)` applied to the given region ids. */
function worldWith(patches) {
  const world = structuredClone(makeWorld());
  for (const [id, patch] of Object.entries(patches)) Object.assign(world.regions[id], patch);
  return world;
}

const cap = (site, from, to) => ({ type: 'capture', site, from, to, x: 0, y: 0 });

// --- par ---------------------------------------------------------------------------

const band = (id) => PAR.bands.find((b) => b.id === id).parSec; // par values are calibrated in config: read them, never restate them

test('parFor: every band reads its par from PAR; a capital beats its tier', () => {
  const world = worldWith({ 1: { tier: 1 }, 2: { tier: 2 }, 4: { tier: 3 }, 5: { tier: 8, isCapital: false } });
  assert.equal(parFor(world, 1), band('tier1'));            // tier 1
  assert.equal(parFor(world, 2), band('tier2'));            // tier 2: its own par, not the tier-1 one
  assert.equal(parFor(world, 4), band('mid'));              // tier 3, first mid tier
  assert.equal(parFor(world, 5), band('deep'));             // tier 8
  assert.equal(parFor(world, 3), PAR.capitalSec);           // tier 2 capital: capital band wins over tier
});

test('parFor / parBandOf: band edges and capital override at any tier', () => {
  const world = worldWith({ 1: { tier: 5 }, 2: { tier: 6 }, 4: { tier: 2 }, 5: { tier: 7 } });
  assert.equal(parBandOf(world, 4), 'tier2');
  assert.equal(parBandOf(world, 1), 'mid');                  // tier 5 = last mid tier
  assert.equal(parBandOf(world, 2), 'deep');                 // tier 6
  assert.equal(parBandOf(world, 5), 'capital');              // tier 7 capital
  assert.equal(parBandOf(world, 3), 'capital');
  assert.equal(parFor(world, 5), PAR.capitalSec);
});

test('PAR bands: tier 0-1, tier 2, mid and deep tile the tiers without gaps or overlap, tier 1 and tier 2 have separate pars', () => {
  const bands = PAR.bands;
  assert.deepEqual(bands.map((b) => b.id), ['tier1', 'tier2', 'mid', 'deep']);
  assert.equal(bands[0].minTier, 0);
  for (let i = 1; i < bands.length; i++) assert.equal(bands[i].minTier, bands[i - 1].maxTier + 1, `${bands[i].id} starts where ${bands[i - 1].id} ends`);
  assert.equal(bands[bands.length - 1].maxTier, Infinity);
  assert.ok(bands.every((b) => b.parSec > 0 && Number.isFinite(b.parSec)));
  assert.ok(band('tier1') < band('tier2'), 'the next ring takes longer than the first');
  const world = worldWith({ 1: { tier: 1 }, 2: { tier: 2 } });
  assert.notEqual(parFor(world, 1), parFor(world, 2));
  assert.equal(parBandOf(world, 0), 'tier1'); // tier 0 (the start region) shares the tier-1 band
});

test('parFor: dynasty level only moves par by PAR.perDynastySec (0 = not at all)', () => {
  const world = makeWorld();
  const state = makeGame(world, { dynasty: { level: 4 } });
  assert.equal(parFor(world, 1, state), band('tier1') + PAR.perDynastySec * 3);
  assert.equal(parFor(world, 1, undefined), band('tier1'));
});

// --- the tracker ---------------------------------------------------------------------

test('tracker: a fresh tracker is plain JSON and unbroken', () => {
  const tr = createCrownTracker();
  assert.deepEqual(JSON.parse(JSON.stringify(tr)), tr);
  assert.equal(tr.playerSitesLost, 0);
  assert.equal(tr.result, null);
});

test('tracker: only a capture whose from is the player breaks Unbroken', () => {
  const tr = createCrownTracker();
  trackEvents(tr, [cap(3, 2, 0), cap(4, 1, 0), { type: 'send', owner: 0 }, { type: 'assault', site: 1, owner: 2 }], 5);
  assert.equal(tr.playerSitesLost, 0, 'the player capturing sites is not a loss');
  trackEvents(tr, [cap(0, 0, 2)], 6);
  assert.equal(tr.playerSitesLost, 1);
  trackEvents(tr, [cap(0, 2, 0)], 7); // retaking it does not un-break the run
  trackEvents(tr, [cap(5, 0, 1), cap(6, 0, 2)], 8);
  assert.equal(tr.playerSitesLost, 3);
  assert.equal(tr.lastT, 8);
});

test('tracker: tolerates an empty/absent event list and a missing tracker', () => {
  const tr = createCrownTracker();
  assert.doesNotThrow(() => trackEvents(tr, undefined, 1));
  assert.doesNotThrow(() => trackEvents(tr, [], 2));
  assert.doesNotThrow(() => trackEvents(null, [cap(0, 0, 2)], 2));
  assert.equal(tr.lastT, 2);
});

test('tracker: the end event records the result and the battle second it happened', () => {
  const tr = createCrownTracker();
  trackEvents(tr, [cap(9, 2, 0), { type: 'surrender', sites: [1, 2] }, { type: 'end', result: 'win' }], 47.35);
  assert.equal(tr.result, 'win');
  assert.equal(tr.endT, 47.35);
});

test('trackerOf: creates once, lives on battle.crownTracker, survives a JSON round trip', () => {
  const battle = { t: 0, events: [], result: null, stats: {} };
  const tr = trackerOf(battle);
  assert.equal(trackerOf(battle), tr);
  trackBattle(tr, { events: [cap(1, 0, 2)], t: 3 });
  const saved = JSON.parse(JSON.stringify(battle));
  assert.equal(trackerOf(saved).playerSitesLost, 1);
});

test('Unbroken (DESIGN §4.8): only settlements held when the battle began count, not ones taken mid-fight', () => {
  const battle = {
    t: 0, events: [], result: null, stats: {},
    sites: [{ id: 0, owner: 0 }, { id: 1, owner: 0 }, { id: 2, owner: 2 }, { id: 3, owner: 2 }],
  };
  const tr = trackerOf(battle);
  assert.deepEqual(tr.held, [0, 1], 'the tracker remembers the two settlements the player started with');
  trackEvents(tr, [cap(2, 2, 0)], 10);         // the player takes site 2 ...
  trackEvents(tr, [cap(2, 0, 2)], 14);         // ... and the swarm takes it straight back: not a loss of anything held
  assert.equal(tr.playerSitesLost, 0);
  assert.equal(crownsFor(summarize(tr, { t: 30, result: 'win', stats: { durationSec: 30 } }), makeWorld(), 1).unbroken, true);
  trackEvents(tr, [cap(1, 0, 2)], 20);         // a village the player began with falls: Unbroken breaks
  assert.equal(tr.playerSitesLost, 1);
  assert.equal(crownsFor(summarize(tr, { t: 30, result: 'win', stats: { durationSec: 30 } }), makeWorld(), 1).unbroken, false);
});

test('Unbroken: the starting sites survive a JSON round trip, and an old saved tracker keeps the old rule', () => {
  const battle = { t: 0, events: [], result: null, stats: {}, sites: [{ id: 0, owner: 0 }, { id: 5, owner: 2 }] };
  trackerOf(battle);
  const saved = JSON.parse(JSON.stringify(battle));
  trackBattle(trackerOf(saved), { events: [cap(5, 2, 0), cap(5, 0, 2)], t: 4 });
  assert.equal(trackerOf(saved).playerSitesLost, 0, 'after a reload the set is still known');
  // A tracker saved before the set existed has no `held`: every player-held site counts, as it used to.
  const legacy = { t: 9, events: [], result: null, stats: {}, crownTracker: { v: 1, playerSitesLost: 0, result: null, endT: null, lastT: 9 } };
  trackBattle(trackerOf(legacy), { events: [cap(5, 0, 2)], t: 10 });
  assert.equal(trackerOf(legacy).playerSitesLost, 1);
  assert.equal(trackerOf(legacy).held ?? null, null);
});

// --- summarize / crownsFor ------------------------------------------------------------

test('summarize: win, lose and retreat', () => {
  const win = createCrownTracker();
  trackEvents(win, [{ type: 'end', result: 'win' }], 61.5);
  assert.deepEqual(summarize(win, { t: 61.5, result: 'win', stats: { durationSec: 61.5 } }),
    { won: true, durationSec: 61.5, playerSitesLost: 0 });

  const lose = createCrownTracker();
  trackEvents(lose, [cap(0, 0, 2), { type: 'end', result: 'lose' }], 33);
  assert.deepEqual(summarize(lose, { t: 33, result: 'lose' }), { won: false, durationSec: 33, playerSitesLost: 1 });

  const retreat = createCrownTracker();
  trackEvents(retreat, [{ type: 'end', result: 'retreat' }], 12);
  assert.equal(summarize(retreat).won, false);
});

test('summarize: a running battle reports battle.t; no tracker end falls back to the battle', () => {
  const tr = createCrownTracker();
  const running = { t: 20, result: null, stats: { durationSec: 0 } };
  assert.deepEqual(summarize(tr, running), { won: false, durationSec: 20, playerSitesLost: 0 });
  // tracker attached too late to see the end event (e.g. a legacy resumed battle)
  const ended = { t: 70, result: 'win', stats: { durationSec: 70 } };
  assert.deepEqual(summarize(createCrownTracker(), ended), { won: true, durationSec: 70, playerSitesLost: 0 });
});

test('crownsFor: Victory needs a win; Swift is <= par (inclusive); Unbroken needs zero losses', () => {
  const world = makeWorld(); // region 1 = tier 1, the tier-1 band
  const par = band('tier1');
  const at = (won, durationSec, playerSitesLost) => crownsFor({ won, durationSec, playerSitesLost }, world, 1);
  assert.deepEqual(at(true, par / 2, 0), { victory: true, swift: true, unbroken: true });
  assert.deepEqual(at(true, par, 0), { victory: true, swift: true, unbroken: true }, 'exactly par counts');
  assert.deepEqual(at(true, par + 0.0000000004, 0), { victory: true, swift: true, unbroken: true }, 'float noise from 0.05 s ticks');
  assert.deepEqual(at(true, par + 0.05, 0), { victory: true, swift: false, unbroken: true }, 'one tick over is over');
  assert.deepEqual(at(true, par / 2, 1), { victory: true, swift: true, unbroken: false });
  assert.deepEqual(at(true, par * 3, 4), { victory: true, swift: false, unbroken: false });
  assert.deepEqual(at(false, 5, 0), { victory: false, swift: false, unbroken: false }, 'no crowns without a win');
});

test('crownsFor: capitals use the capital par', () => {
  const world = makeWorld(); // region 3 = capital
  const c = crownsFor({ won: true, durationSec: PAR.capitalSec - 0.1, playerSitesLost: 0 }, world, 3);
  assert.equal(c.swift, true);
  assert.equal(crownsFor({ won: true, durationSec: PAR.capitalSec + 1, playerSitesLost: 0 }, world, 3).swift, false);
});

test('crownsForSurrender: Victory only, and a fresh object each call', () => {
  const a = crownsForSurrender();
  assert.deepEqual(a, { victory: true, swift: false, unbroken: false });
  a.swift = true;
  assert.equal(crownsForSurrender().swift, false);
});

test('duration comes from battle seconds, so battle speed cannot matter', () => {
  // The same 40 battle-seconds whether the loop ran 800 steps at 1x or 200 frames of 4 steps at 3x.
  const world = makeWorld();
  const run = (stepsPerFrame, frames) => {
    const tr = createCrownTracker();
    let t = 0;
    for (let f = 0; f < frames; f++) {
      for (let s = 0; s < stepsPerFrame; s++) {
        t += 0.05;
        trackEvents(tr, s === stepsPerFrame - 1 && f === frames - 1 ? [{ type: 'end', result: 'win' }] : [], t);
      }
    }
    return crownsFor(summarize(tr, { t, result: 'win', stats: { durationSec: t } }), world, 1);
  };
  assert.deepEqual(run(1, 800), run(4, 200));
  const par = band('tier1');
  assert.equal(run(1, 800).swift, par >= 40);                          // 40 s against the par
  assert.equal(run(1, Math.round((par + 5) / 0.05)).swift, false);     // 5 s over par is over, at any speed
});

// --- rewards ------------------------------------------------------------------------------

test('awardCrowns: pays 25% of the bounty per crown on top of conquer(), never the base bounty again', () => {
  const world = makeWorld();
  const state = makeGame(world, { gold: 100 });
  const paid = conquer(state, world, 1, 1000).bounty;          // 45 gold at tier 1
  assert.equal(state.gold, 100 + paid);
  const goldAfterConquer = state.gold;
  const earnedAfterConquer = state.stats.goldEarned;

  const res = awardCrowns(state, world, 1, { victory: true, swift: true, unbroken: false }, paid);
  assert.equal(res.count, 2);
  assert.ok(Math.abs(res.bonusGold - 2 * BOUNTY_FRACTION_PER_CROWN * paid) < 1e-9);
  assert.ok(Math.abs(state.gold - (goldAfterConquer + res.bonusGold)) < 1e-9);
  assert.ok(Math.abs(state.stats.goldEarned - (earnedAfterConquer + res.bonusGold)) < 1e-9);
  assert.equal(state.stats.crownsEarned, 2);
  assert.deepEqual(state.crowns[1], { victory: true, swift: true, unbroken: false });
});

test('awardCrowns: baseBounty is optional and recomputed identically after conquer()', () => {
  const world = makeWorld();
  const a = makeGame(world);
  const b = makeGame(world);
  const paidA = conquer(a, world, 1, 0).bounty;
  conquer(b, world, 1, 0);
  const full = { victory: true, swift: true, unbroken: true };
  const withArg = awardCrowns(a, world, 1, full, paidA);
  const without = awardCrowns(b, world, 1, full);
  assert.ok(Math.abs(withArg.bonusGold - without.bonusGold) < 1e-9);
  assert.ok(Math.abs(without.bonusGold - 3 * 0.25 * paidA) < 1e-9);
});

test('awardCrowns: the conquered region\'s own Harbour perk must not inflate the bonus', () => {
  // Harbour = +20% bounty, but only once owned. conquer() pays the pre-ownership bounty; a naive
  // bounty() call afterwards would include the perk of the region just taken.
  const world = worldWith({ 1: { perk: 'harbour' } });
  const state = makeGame(world);
  const before = bounty(state, world, 1);
  const paid = conquer(state, world, 1, 0).bounty;
  assert.equal(paid, before);
  assert.ok(bounty(state, world, 1) > paid, 'sanity: bounty() after conquest does include Harbour');
  const res = awardCrowns(state, world, 1, { victory: true, swift: false, unbroken: false });
  assert.ok(Math.abs(res.bonusGold - 0.25 * paid) < 1e-9);
});

test('awardCrowns: bonus inherits plunder, perks and dynasty stars through the bounty', () => {
  const world = makeWorld();
  const state = makeGame(world, { upgrades: { plunder: 4 }, dynasty: { stars: 5 } });
  const paid = conquer(state, world, 2, 0).bounty;
  const res = awardCrowns(state, world, 2, { victory: true, swift: true, unbroken: true }, paid);
  assert.ok(Math.abs(res.bonusGold - 0.75 * paid) < 1e-9);
  assert.ok(paid > ECONOMY.bountySeconds * regionIncome(world.regions[2]), 'plunder and stars raised the base bounty');
});

test('awardCrowns: crowns are fixed once stored; a second call changes nothing', () => {
  const world = makeWorld();
  const state = makeGame(world);
  conquer(state, world, 1, 0);
  awardCrowns(state, world, 1, { victory: true, swift: false, unbroken: false });
  const snapshot = JSON.stringify(state);
  const again = awardCrowns(state, world, 1, { victory: true, swift: true, unbroken: true });
  assert.deepEqual(again, { bonusGold: 0, count: 0 });
  assert.equal(JSON.stringify(state), snapshot);
});

test('awardCrowns: no Victory, no award (a lost battle stores nothing)', () => {
  const world = makeWorld();
  const state = makeGame(world);
  const snapshot = JSON.stringify(state);
  assert.deepEqual(awardCrowns(state, world, 1, emptyCrowns()), { bonusGold: 0, count: 0 });
  assert.deepEqual(awardCrowns(state, world, 1, null), { bonusGold: 0, count: 0 });
  assert.equal(JSON.stringify(state), snapshot);
});

test('awardCrowns: surrender awards Victory only and pays one crown of bonus', () => {
  const world = makeWorld();
  const state = makeGame(world);
  const paid = conquer(state, world, 1, 0).bounty;
  const res = awardCrowns(state, world, 1, crownsForSurrender(), paid);
  assert.equal(res.count, 1);
  assert.ok(Math.abs(res.bonusGold - 0.25 * paid) < 1e-9);
  assert.deepEqual(getCrowns(state, 1), { victory: true, swift: false, unbroken: false });
});

test('awardCrowns: survives an old save with no crowns array, and stays plain JSON', () => {
  const world = makeWorld();
  const state = makeGame(world);
  delete state.crowns;
  conquer(state, world, 2, 0);
  awardCrowns(state, world, 2, { victory: true, swift: true, unbroken: true });
  assert.equal(state.crowns.length, world.regions.length);
  assert.equal(state.crowns[0], null);
  assert.deepEqual(JSON.parse(JSON.stringify(state.crowns)), state.crowns);
});

test('crownBonus: a pure preview, equal to what awardCrowns then pays', () => {
  const world = makeWorld();
  const state = makeGame(world);
  const crowns = { victory: true, swift: true, unbroken: false };
  const preview = crownBonus(state, world, 1, crowns); // before conquer(), the victory-card moment
  const snapshot = JSON.stringify(state);
  crownBonus(state, world, 1, crowns);
  assert.equal(JSON.stringify(state), snapshot, 'preview must not mutate');
  const paid = conquer(state, world, 1, 0).bounty;
  const res = awardCrowns(state, world, 1, crowns, paid);
  assert.ok(Math.abs(preview - res.bonusGold) < 1e-9);
});

test('crownCount / getCrowns are null-safe', () => {
  assert.equal(crownCount(null), 0);
  assert.equal(crownCount({ victory: true, swift: false, unbroken: true }), 2);
  assert.equal(getCrowns({ crowns: [] }, 3), null);
  assert.equal(getCrowns({}, 0), null);
});

// --- totals and state ------------------------------------------------------------------------

test('crownTotals: possible = 3 x every region you did not start with', () => {
  const world = makeWorld(); // 6 regions, start region excluded
  const state = makeGame(world);
  assert.deepEqual(crownTotals(state, world), { earned: 0, possible: 15 });
  awardCrowns(state, world, 1, { victory: true, swift: true, unbroken: true });
  awardCrowns(state, world, 3, { victory: true, swift: false, unbroken: true });
  assert.deepEqual(crownTotals(state, world), { earned: 5, possible: 15 });
});

test('state: fresh games have empty crowns, zero lifetime crowns, voices on', () => {
  const world = makeWorld();
  const state = createGame(1, world, 0);
  assert.equal(state.crowns.length, world.regions.length);
  assert.ok(state.crowns.every((c) => c === null));
  assert.deepEqual(state.metFactions, []);
  assert.equal(state.stats.crownsEarned, 0);
  assert.equal(state.settings.leaderVoices, true);
  assert.equal(defaultStats().crownsEarned, 0);
  assert.equal(defaultSettings().leaderVoices, true);
});

test('state: resetRegions (new dynasty) clears crowns and met factions, keeps lifetime crowns', () => {
  const world = makeWorld();
  const state = makeGame(world);
  conquer(state, world, 1, 0);
  awardCrowns(state, world, 1, { victory: true, swift: true, unbroken: true });
  state.metFactions.push(2);
  resetRegions(state, world, 500);
  assert.ok(state.crowns.every((c) => c === null));
  assert.deepEqual(state.metFactions, []);
  assert.equal(state.stats.crownsEarned, 3, 'lifetime total survives the reset');
});

test('state: crown keys are exactly victory / swift / unbroken', () => {
  assert.deepEqual([...CROWN_KEYS], ['victory', 'swift', 'unbroken']);
  assert.deepEqual(Object.keys(emptyCrowns()), [...CROWN_KEYS]);
});

// --- against the real simulation ------------------------------------------------------------------

function playRealBattle({ seed, tier, level }) {
  const world = generateWorld(seed);
  const region = world.regions.find((r) => r.tier === tier && !r.isCapital);
  const state = createGame(seed, world, 0);
  state.owner = world.regions.map((r) => (r.tier < region.tier ? PLAYER_FACTION : r.faction));
  state.upgrades = { rally: 3, recruitment: level, steel: level, armour: level, muster: level };
  const player = playerBattleStats(state, world);
  const enemy = enemyBattleStats(world, state, region.id);
  const battle = createBattle(buildArena(world, state.owner, region.id, player, enemy), player, enemy);
  const tracker = trackerOf(battle);
  const memo = {};
  let lostRaw = 0;
  let endSeen = 0;
  while (!battle.result && battle.t < 8 * 60) {
    for (const cmd of think(battle, battle.t)) issue(battle, cmd);
    for (const cmd of decide(battle, battle.t, memo)) issue(battle, cmd);
    step(battle, TICK_SEC);
    trackBattle(tracker, battle);
    for (const ev of battle.events) {
      if (ev.type === 'capture' && ev.from === PLAYER_FACTION) lostRaw += 1;
      if (ev.type === 'end') endSeen += 1;
    }
  }
  return { world, state, region, battle, tracker, lostRaw, endSeen };
}

for (const scenario of [
  { name: 'boosted player, tier 1', seed: 3, tier: 1, level: 30 },
  { name: 'unboosted player, tier 4 (may lose sites or the fight)', seed: 5, tier: 4, level: 0 },
]) {
  test(`real battle (${scenario.name}): tracker agrees with an independent count of raw events`, () => {
    const { world, state, region, battle, tracker, lostRaw, endSeen } = playRealBattle(scenario);
    if (battle.result) assert.equal(endSeen, 1, 'exactly one end event');
    const { summary, crowns, parSec } = evaluateBattle(tracker, battle, world, region.id, state);
    assert.equal(summary.won, battle.result === 'win');
    assert.equal(summary.playerSitesLost, lostRaw);
    if (battle.result) assert.equal(summary.durationSec, battle.stats.durationSec);
    assert.equal(parSec, parFor(world, region.id));
    assert.equal(crowns.victory, summary.won);
    assert.equal(crowns.unbroken, summary.won && lostRaw === 0);
    assert.equal(crowns.swift, summary.won && battle.stats.durationSec <= parSec + PAR.toleranceSec);
    // and it survives being saved mid-fight
    assert.deepEqual(JSON.parse(JSON.stringify(battle)).crownTracker, tracker);
  });
}

// --- purity ---------------------------------------------------------------------------------------

test('purity: crowns.js and config/crowns.js never touch DOM, time, randomness or storage', () => {
  for (const rel of ['../meta/crowns.js', '../config/crowns.js']) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
    for (const banned of ['document', 'window', 'Math.random', 'Date.now', 'performance', 'localStorage', 'requestAnimationFrame']) {
      assert.ok(!src.includes(banned), `${rel} mentions ${banned}`);
    }
  }
});
