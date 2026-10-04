// World events (DESIGN §10.13): a seeded scheduler on active time, never in the opening, at most one pending; the Merchant's two
// deals, the Plague's weaker rival, the Duel's short no-powers battle; and the region-type rewards and income in the meta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/generate.js';
import { createGame } from '../meta/state.js';
import { conquer, enemyBattleStats, foundDynasty } from '../meta/progression.js';
import { incomePerSec, bounty } from '../meta/economy.js';
import { isScoutedOrFree } from '../meta/intel.js';
import { regionFortEffects } from '../meta/fortsEffects.js';
import {
  tickEvents, acceptEvent, declineEvent, pendingEvent, duelRunFor, duelReward, merchantFortPrice, sanitizeWorldEvents, plagueMult,
  defaultWorldEvents, ensureWorldEvents,
} from '../meta/events.js';
import { renownPoints } from '../meta/renownState.js';
import { EVENTS } from '../config/events.js';
import { FEATURES } from '../config/features.js';

const world = generateWorld(5);
function realm(seed = 5, maxTier = 2) {
  const s = createGame(seed, world, 0);
  for (const r of world.regions) if (r.tier <= maxTier) { s.owner[r.id] = 0; s.conqueredAt[r.id] = 0; }
  s.battles = [];
  s.gold = 1e6;
  return s;
}
function until(state, kind, max = 6 * 3600) {
  for (let i = 0; i < max; i++) {
    const r = tickEvents(state, world, 0, 1);
    if (r.offered) {
      if (r.offered.kind === kind) return r.offered;
      declineEvent(state);
    }
  }
  return null;
}

test('the scheduler: nothing in the opening; then about one offer per meanSec; at most one pending; offers expire', () => {
  const s = realm();
  for (let i = 0; i < EVENTS.graceSec - 1; i++) assert.equal(tickEvents(s, world, 0, 1).offered, null);
  let offers = 0;
  let pending = 0;
  let expired = 0;
  for (let i = 0; i < 5 * 3600; i++) {
    const r = tickEvents(s, world, 0, 1);
    if (r.offered) { offers += 1; pending += 1; assert.equal(pending, 1, 'one at a time'); }
    if (r.expired) { expired += 1; pending -= 1; }
  }
  assert.ok(offers >= 15 && offers <= 25, `about 20 offers in 5 h (${offers})`);
  assert.ok(expired >= offers - 1, 'unanswered offers lapse');
  const few = realm();
  for (const r of world.regions) if (r.id !== world.startRegion) few.owner[r.id] = r.faction;
  for (let i = 0; i < 2 * 3600; i++) assert.equal(tickEvents(few, world, 0, 1).offered, null, 'not before minRegions');
});

test('deterministic per seed and call sequence', () => {
  const play = () => { const s = realm(); const out = []; for (let i = 0; i < 4 * 3600; i++) { const r = tickEvents(s, world, 0, 1); if (r.offered) { out.push(r.offered); declineEvent(s); } } return out; };
  assert.deepEqual(play(), play());
});

test('the Merchant: Renown for gold, or a fortification level at the deal\'s price; a refused choice keeps the offer', () => {
  const s = realm();
  const ev = until(s, 'merchant');
  assert.ok(ev && ev.deals.length === 2);
  const deal = ev.deals.find((d) => d.deal === 'renown');
  const gold = s.gold;
  const r = acceptEvent(s, world, { deal: 'renown' });
  assert.deepEqual(r, { kind: 'merchant', deal: 'renown', gold: deal.gold, renown: EVENTS.merchant.renown });
  assert.equal(s.gold, gold - deal.gold);
  assert.equal(renownPoints(s), EVENTS.merchant.renown);
  assert.equal(pendingEvent(s), null);
  const t = realm();
  until(t, 'merchant');
  const regionId = world.regions.find((x) => x.tier === 1).id;
  assert.equal(acceptEvent(t, world, { deal: 'fort', regionId: world.regions.find((x) => t.owner[x.id] !== 0).id, type: 'walls' }), false);
  assert.ok(pendingEvent(t), 'still offered');
  const price = merchantFortPrice(t, world, regionId, 'walls');
  const g2 = t.gold;
  const f = acceptEvent(t, world, { deal: 'fort', regionId, type: 'walls' });
  assert.equal(f.level, 1);
  assert.equal(t.gold, g2 - price);
  assert.equal(regionFortEffects(t, regionId).wallsMult > 1, true);
});

test('the Plague: a rival\'s garrisons x0.8 for its duration', () => {
  const s = realm();
  const ev = until(s, 'plague');
  assert.ok(ev);
  const target = world.regions.find((r) => s.owner[r.id] === ev.faction && r.tier >= 2);
  assert.equal(plagueMult(s, ev.faction), EVENTS.plague.strength);
  const sick = enemyBattleStats(world, s, target.id).troopMult;
  for (let i = 0; i < EVENTS.plague.durationSec + 5; i++) tickEvents(s, world, 0, 1);
  assert.equal(plagueMult(s, ev.faction), 1);
  assert.ok(Math.abs(sick / enemyBattleStats(world, s, target.id).troopMult - EVENTS.plague.strength) < 1e-9);
});

test('the Duel: a short, no-powers defense; a win pays Renown, a loss costs nothing', () => {
  const s = realm();
  const ev = until(s, 'duel');
  assert.ok(ev && ev.regionId != null && ev.leader);
  assert.ok(acceptEvent(s, world));
  const run = duelRunFor(s, world, ev, null, { nowMs: 0 });
  assert.equal(run.kind, 'duel');
  assert.equal(run.battle.arena.twist, 'holy');
  assert.equal(run.battle.siegeSec, EVENTS.duel.siegeSec);
  assert.deepEqual(duelReward(s, world, run, 'lose'), { renown: 0 });
  assert.equal(s.owner[ev.regionId], 0, 'the region is not lost');
  const won = duelReward(s, world, run, 'win');
  assert.equal(won.renown, EVENTS.duel.renown);
  assert.equal(won.grudge.faction, run.attackerFaction, 'a Duel won feeds the Grudge of the leader (PLAN-PHASE4 §4D)');
});

test('region types: Gold Mine bounty x3 and +25% income; Monastery scouts within 2; Renown; the Dragon\'s Dragonscale', () => {
  const s = realm(5, 1);
  const mine = world.regions.find((r) => r.type === 'goldmine');
  for (const n of mine.neighbors) s.owner[n] = 0;
  const b = bounty(s, world, mine.id);
  const income = incomePerSec(s, world);
  const r = conquer(s, world, mine.id, 1000);
  assert.ok(Math.abs(r.bounty - FEATURES.rewards.goldmine.bounty * b) < 1e-6);
  assert.ok(incomePerSec(s, world) > income);
  const mon = world.regions.find((x) => x.type === 'monastery');
  const t = realm(5, 1);
  for (const n of mon.neighbors) t.owner[n] = 0;
  const near = world.regions.find((x) => t.owner[x.id] !== 0 && x.neighbors.includes(mon.id) && x.id !== mon.id);
  const before = near ? isScoutedOrFree(t, world, near.id) : false;
  const res = conquer(t, world, mon.id, 1000);
  assert.equal(res.renown, FEATURES.rewards.monastery.renown);
  if (near && t.owner[near.id] !== 0) { assert.equal(before, false); assert.equal(isScoutedOrFree(t, world, near.id), true); }
  const lair = world.regions.find((x) => x.type === 'dragon');
  const u = realm(5, 1);
  for (const n of lair.neighbors) u.owner[n] = 0;
  const own = world.regions.find((x) => u.owner[x.id] === 0 && x.tier === 1);
  u.forts = { [own.id]: [{ type: 'walls', level: 1 }] };
  const plain = regionFortEffects(u, own.id).wallsMult;
  const d = conquer(u, world, lair.id, 1000);
  assert.equal(d.dragonscale, true);
  assert.equal(d.renown, FEATURES.rewards.dragon.renown);
  assert.ok(regionFortEffects(u, own.id).wallsMult > plain, 'every fortification counts one level higher');
  for (const x of world.regions) u.owner[x.id] = 0;
  const next = foundDynasty(u, 99);
  assert.equal(next.boons.dragonscale, false, 'Dragonscale is this dynasty\'s');
});

test('sanitizeWorldEvents: junk-proof', () => {
  assert.deepEqual(sanitizeWorldEvents(null), defaultWorldEvents());
  const c = sanitizeWorldEvents({ seq: 4, activeSec: 'x', plague: { faction: 1, until: 9 }, pending: { kind: 'evil', expiresAt: 3 }, log: { duel: 2 } });
  assert.equal(c.seq, 4);
  assert.equal(c.activeSec, 0);
  assert.equal(c.plague, null, 'not the Free Folk');
  assert.equal(c.pending, null);
  assert.equal(c.log.duel, 2);
  const s = realm();
  ensureWorldEvents(s);
  assert.ok(s.worldEvents.nextAt >= EVENTS.graceSec);
});

test('the Dragon\'s Lair is optional for founding a dynasty (with the world passed in); the old signature still wants every region', async () => {
  const { canFoundDynasty, foundDynasty } = await import('../meta/progression.js');
  const s = realm(5, 1);
  const lair = world.regions.find((r) => r.type === 'dragon');
  for (const r of world.regions) s.owner[r.id] = r.id === lair.id ? lair.faction : 0;
  assert.equal(canFoundDynasty(s), false, 'old signature: every region');
  assert.equal(canFoundDynasty(s, world), true, 'with the world: the unslain Lair does not count');
  const other = world.regions.find((r) => r.id !== lair.id && r.id !== world.startRegion);
  s.owner[other.id] = 2;
  assert.equal(canFoundDynasty(s, world), false, 'any other region still counts');
  s.owner[other.id] = 0;
  assert.equal(foundDynasty(s, 77), false);
  const next = foundDynasty(s, 77, undefined, world);
  assert.ok(next && next.dynasty.level === 2);
  assert.equal(next.boons.dragonscale, false, 'nothing gained, nothing lost but the Lair\'s rewards');
});
