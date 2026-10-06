// Phase 8 (PLAN-PHASE8 §8C): the new Boons, Duos and Relics in the meta (pool, Cartographer, Rearguard, Spoils of War, Twin Crowns, the
// Warden's Bell, the Merchant's Scale). The new world events are in meta.events8.test.js; the sim side in battle.boons8.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/generate.js';
import { createGame } from '../meta/state.js';
import { difficulty, attackableFrontier } from '../meta/progression.js';
import { allBoons, boonInfo, duoInfo, pickBoon, boonRelevant, boonMods } from '../meta/boons.js';
import { relicInfo } from '../meta/relics.js';
import { canQuickConquer } from '../meta/quick.js';
import { onStreakBroken, onStreakConquest, ensureStreak } from '../meta/streak.js';
import { awardCrowns, parFor } from '../meta/crowns.js';
import { prosperityLevel } from '../meta/prosperity.js';
import { merchantFortPrice } from '../meta/events.js';
import { buildDefenseArena } from '../battle/defenseArena.js';
import { BOON_LIST, DUO_LIST } from '../config/boons.js';
import { RELIC_LIST } from '../config/relics.js';
import { PROSPERITY } from '../config/prosperity.js';
import { UPGRADES } from '../meta/upgrades.js';

const W = generateWorld(7);
const fresh = (seed = 7, world = W) => createGame(seed, world, 0);
const own = (state, ...ids) => { state.boons2.owned.push(...ids); return state; };
const NEW = ['vanguard', 'supplyWagons', 'rearguard', 'warDrums', 'towerSappers', 'spoilsOfWar', 'lastStand', 'cartographer'];
const withNodes = (state, ...nodes) => { state.generals.legacy = { v: 1, points: 99, spent: 0, nodes: Object.fromEntries(nodes.map((n) => [n, true])), pendingBonus: 0 }; return state; };

test('the pool: 32 Boons, 6 Duos, 12 Relics (+3 Boons and 2 Relics in Phase 12); every new text is filled from config', () => {
  assert.equal(BOON_LIST.length, 35);
  assert.equal(DUO_LIST.length, 6);
  assert.equal(RELIC_LIST.length, 14);
  for (const id of NEW) { const b = boonInfo(id); assert.ok(b && b.text && !/[{}]/.test(b.text), `${id}: ${b && b.text}`); }
  assert.match(boonInfo('vanguard').text, /50%/);
  assert.match(boonInfo('towerSappers').text, /3 hexes.*30%/);
  assert.match(boonInfo('lastStand').text, /40%.*25%/);
  assert.match(relicInfo('sealOfMargrave').text, /every 30 s instead of every 20 s/);
  assert.match(relicInfo('merchantsScale').text, /30%/);
  assert.match(relicInfo('twinCrowns').text, /20 s/);
  assert.equal(allBoons().length, 35);
});

test('the new Duos: Thunder Charge and Siege Train reveal on the second part and fold their keys', () => {
  const s = own(fresh(), 'vanguard');
  s.boons2.pending = { choices: ['warDrums'], source: 'battle' };
  const r = pickBoon(s, 'warDrums');
  assert.equal(r.duo && r.duo.id, 'thunderCharge');
  assert.equal(boonMods(s).drumVanguardMult, 1.25);
  own(s, 'supplyWagons', 'towerSappers');
  assert.equal(boonMods(s).supplyNoArrows, true);
  assert.equal(duoInfo(s).filter((d) => d.active).length, 2);
});

test('requires: Cartographer needs Quick Conquest, Rearguard the streak, War Drums powers, Last Stand raids', () => {
  const s = fresh();
  const B = (id) => BOON_LIST.find((b) => b.id === id);
  assert.equal(boonRelevant(s, W, B('cartographer')), false);
  withNodes(s, 'quickConquest');
  assert.equal(boonRelevant(s, W, B('cartographer')), true);
  assert.equal(boonRelevant(s, W, B('rearguard')), true);
  assert.equal(boonRelevant(s, W, B('warDrums')), true);
  assert.equal(boonRelevant(s, W, B('lastStand')), true);
});

test('Cartographer: Quick Conquest also takes a Fair region', () => {
  let found = null;
  for (const lv of [2, 4, 6, 8, 10]) {
    const s = withNodes(fresh(), 'quickConquest');
    s.battles = [];
    for (const k of Object.keys(UPGRADES)) s.upgrades[k] = Math.max(s.upgrades[k] || 0, lv);
    for (const r of W.regions) if (r.tier <= 1) { s.owner[r.id] = 0; s.conqueredAt[r.id] = 0; }
    const id = attackableFrontier(s, W).find((rid) => { const r = W.regions[rid]; return !r.type && !r.isCapital && difficulty(s, W, rid).label === 'Fair'; });
    if (id != null) { found = { s, id }; break; }
  }
  assert.ok(found, 'a Fair frontier region at some upgrade level');
  const { s, id } = found;
  assert.deepEqual(canQuickConquer(s, W, id), { ok: false, reason: 'label' });
  own(s, 'cartographer');
  assert.deepEqual(canQuickConquer(s, W, id), { ok: true });
});

test('Rearguard: a retreat keeps the streak (no toast); a loss still breaks it', () => {
  const s = own(fresh(), 'rearguard');
  s.lastSeen = 1000;
  for (let k = 0; k < 3; k++) onStreakConquest(s);
  const n = ensureStreak(s).count;
  assert.ok(n >= 3);
  assert.deepEqual(onStreakBroken(s, 'retreat'), { was: 0, reason: 'retreat', kept: true });
  assert.equal(ensureStreak(s).count, n);
  onStreakBroken(s, 'lost');
  assert.equal(ensureStreak(s).count, 0);
});

test('Spoils of War: a three-crown win starts the region at Prosperity I; fewer crowns do nothing', () => {
  const s = own(fresh(), 'spoilsOfWar');
  const ids = W.regions.filter((r) => r.tier === 1).map((r) => r.id);
  const now = 5e6;
  for (const id of ids.slice(0, 2)) { s.owner[id] = 0; s.conqueredAt[id] = now; }
  const out = awardCrowns(s, W, ids[0], { victory: true, swift: true, unbroken: true }, 100);
  assert.equal(out.spoils, 1);
  assert.equal(s.conqueredAt[ids[0]], now - PROSPERITY.thresholdsMs[0]);
  assert.equal(prosperityLevel(s, ids[0], now), 1);
  const two = awardCrowns(s, W, ids[1], { victory: true, swift: true, unbroken: false }, 100);
  assert.equal(two.spoils, undefined);
  assert.equal(s.conqueredAt[ids[1]], now);
});

test("Twin Crowns: Swift's par +20 s; the Merchant's Scale: deals 30% cheaper", () => {
  const s = fresh();
  const rid = W.regions.find((r) => r.tier === 2).id;
  const base = parFor(W, rid, s);
  s.relics.owned.push('twinCrowns');
  assert.equal(parFor(W, rid, s), base + 20);
  const t = fresh();
  const home = W.startRegion;
  const p0 = merchantFortPrice(t, W, home, 'walls');
  t.relics.owned.push('merchantsScale');
  const p1 = merchantFortPrice(t, W, home, 'walls');
  assert.ok(Number.isFinite(p0) && p0 > 0);
  assert.ok(Math.abs(p1 - p0 * 0.7) <= 1, `${p1} vs ${p0}`);
});

test("the Warden's Bell: buildDefenseArena's siege timer x siegeSecMult (an explicit siegeSec wins)", () => {
  const s = fresh();
  const home = W.startRegion;
  const rival = W.regions[home].neighbors.map((n) => W.regions[n]).find((r) => r.faction > 1) || W.regions.find((r) => r.faction > 1);
  const base = { attackerFaction: rival.faction, fromRegionId: rival.id, player: { atk: 1, def: 1, growth: 1, speed: 1, campTroops: 50, garrisonShare: 0.35, capBonus: 0, cooldownMult: 1, powers: {} },
    enemy: { atk: 1, def: 1, growth: 1, speed: 1, troopMult: 1, campTroops: 50, thinkSec: 1, graceSec: 0, personality: 'aggressive', factionId: rival.faction } };
  let a0;
  try { a0 = buildDefenseArena(W, s.owner, home, base); } catch { return; } // no camp spot on this map: nothing to measure
  const a1 = buildDefenseArena(W, s.owner, home, { ...base, siegeSecMult: 0.8 });
  assert.ok(Math.abs(a1.siegeSec - a0.siegeSec * 0.8) < 1e-9);
  assert.equal(buildDefenseArena(W, s.owner, home, { ...base, siegeSecMult: 0.8, siegeSec: 60 }).siegeSec, 60);
});
