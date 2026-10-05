// Phase 8 (PLAN-PHASE8 §8C): the two new world events. Deserters (a rival's next raid x0.7, or a free Muster everywhere) and the
// Harvest Festival (prosperity twice as fast for 5 minutes, for gold); their offers, save, Chronicle lines and leader lines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/generate.js';
import { createGame } from '../meta/state.js';
import { tickEvents, acceptEvent, declineEvent, sanitizeWorldEvents, harvestActive, harvestBonusMs, harvestReachAt } from '../meta/events.js';
import { raidEnemyStats, tickFrontier } from '../meta/frontier.js';
import { militiaFill, drainMilitia } from '../meta/militia.js';
import { prosperityLevel, nextProsperityAt } from '../meta/prosperity.js';
import { chronicleEntries, chronicleText } from '../meta/chronicle.js';
import { EVENTS } from '../config/events.js';
import { PROSPERITY } from '../config/prosperity.js';
import { LEADER_LINES, LEADER_FACTIONS } from '../config/leaders.js';

const world = generateWorld(5);
const MIN = 60000;
function realm(seed = 5, maxTier = 2) {
  const s = createGame(seed, world, 0);
  for (const r of world.regions) if (r.tier <= maxTier) { s.owner[r.id] = 0; s.conqueredAt[r.id] = 0; }
  s.battles = [];
  s.gold = 1e6;
  return s;
}
function until(state, kind, max = 12 * 3600) {
  for (let i = 0; i < max; i++) {
    const r = tickEvents(state, world, 1e9 + i * 1000, 1);
    if (r.offered) { if (r.offered.kind === kind) return r.offered; declineEvent(state); }
  }
  return null;
}

test('both new kinds are offered by the scheduler, with their text from config', () => {
  const s = realm();
  const d = until(s, 'deserters');
  assert.ok(d, 'Deserters offered');
  assert.ok(d.faction > 1 && d.raidMult === EVENTS.deserters.raidMult);
  assert.match(d.text, new RegExp(world.factions[d.faction].name));
  assert.match(d.text, /30%/);
  declineEvent(s);
  const h = until(s, 'harvest');
  assert.ok(h, 'Harvest Festival offered');
  assert.ok(h.gold > 0 && h.durationSec === EVENTS.harvest.durationSec && h.mult === EVENTS.harvest.rateMult);
  assert.ok(!/[{}]/.test(h.text) && !/[{}]/.test(d.text));
});

test("Deserters 'raid': the rival's next raid is x0.7, once; declining does nothing", () => {
  const s = realm();
  const d = until(s, 'deserters');
  const raid = { faction: d.faction, fromRegionId: 0, toRegionId: world.startRegion, depth: 2 };
  const before = raidEnemyStats(s, world, raid).troopMult;
  const res = acceptEvent(s, world, { choice: 'raid' }, 1e9);
  assert.equal(res.choice, 'raid');
  assert.deepEqual(s.worldEvents.deserters, { faction: d.faction });
  assert.ok(Math.abs(raidEnemyStats(s, world, { ...raid, deserted: true }).troopMult - before * 0.7) < 1e-9);
  // the next announced raid from that faction takes the flag and clears it
  s.frontier.nextCheckAt = 0;
  let marked = null;
  for (let i = 0; i < 4000 && !marked; i++) {
    const { announced } = tickFrontier(s, world, 1e9, 5);
    marked = announced.find((r) => r.faction === d.faction) || null;
    for (const r of announced) if (r !== marked) s.frontier.incoming = s.frontier.incoming.filter((x) => x.id !== r.id);
  }
  assert.ok(marked, 'that rival raided');
  assert.equal(marked.deserted, true);
  assert.equal(s.worldEvents.deserters, null);
  const t = realm();
  until(t, 'deserters');
  declineEvent(t);
  assert.equal(t.worldEvents.deserters, null);
});

test("Deserters 'muster' (the default): every militia is full", () => {
  const s = realm();
  until(s, 'deserters');
  const mine = world.regions.filter((r) => s.owner[r.id] === 0).map((r) => r.id);
  for (const id of mine) drainMilitia(s, id, 1, 1e9);
  const res = acceptEvent(s, world, {}, 1e9);
  assert.equal(res.choice, 'muster');
  assert.equal(res.regions, mine.length);
  for (const id of mine) assert.equal(militiaFill(s, id, 1e9), 1);
  const e = chronicleEntries(s).find((x) => x.kind === 'deserters');
  assert.ok(e && e.data.variant === 'muster');
  assert.match(chronicleText(e), /militia/);
});

test('the Harvest Festival: costs its gold, then prosperity grows x3 for 10 minutes', () => {
  const s = realm();
  const h = until(s, 'harvest');
  const t0 = 2e9;
  s.gold = h.gold - 1;
  assert.equal(acceptEvent(s, world, {}, t0), false, 'not enough gold: the offer stays');
  s.gold = h.gold + 10;
  const res = acceptEvent(s, world, {}, t0);
  assert.equal(res.gold, h.gold);
  assert.equal(s.gold, 10);
  assert.equal(res.until, t0 + EVENTS.harvest.durationSec * 1000);
  assert.ok(harvestActive(s, t0 + MIN) && !harvestActive(s, t0 + EVENTS.harvest.durationSec * 1000 + MIN));
  const rid = world.regions.find((r) => s.owner[r.id] === 0).id;
  s.conqueredAt[rid] = t0 - 26 * MIN; // 26 min of tenure at the start; Prosperity I needs 30
  assert.equal(prosperityLevel(s, rid, t0 + MIN), 0, '26 + 1 + 2 extra = 29');
  assert.equal(prosperityLevel(s, rid, t0 + 2 * MIN), 1, '26 + 2 + 4 extra = 32');
  assert.ok(Math.abs(nextProsperityAt(s, rid, t0) - (t0 + (4 / 3) * MIN)) < 1e-6, 'the last 4 min at x3');
  assert.equal(chronicleEntries(s).filter((x) => x.kind === 'harvest').length, 1);
  const n = sanitizeWorldEvents(JSON.parse(JSON.stringify(s.worldEvents)));
  assert.deepEqual(n.harvests, s.worldEvents.harvests, 'saved');
});

test('harvestBonusMs / harvestReachAt are inverse, around and inside a window', () => {
  const s = { worldEvents: { harvests: [{ from: 100, until: 200, mult: 2 }, { from: 400, until: 500, mult: 3 }] } };
  assert.equal(harvestBonusMs(s, 0, 50), 0);
  assert.equal(harvestBonusMs(s, 0, 150), 50);
  assert.equal(harvestBonusMs(s, 150, 600), 50 + 200);
  for (const at of [0, 120, 250, 450]) {
    for (const target of [10, 80, 200, 400, 900]) {
      const T = harvestReachAt(s, at, target);
      assert.ok(Math.abs((T - at) + harvestBonusMs(s, at, T) - target) < 1e-9, `${at} ${target} -> ${T}`);
    }
  }
  assert.equal(harvestReachAt({}, 1000, PROSPERITY.thresholdsMs[0]), 1000 + PROSPERITY.thresholdsMs[0], 'no festival: plain tenure');
});

test('save: junk in the new fields is dropped; an old save gets none', () => {
  const n = sanitizeWorldEvents({ deserters: { faction: 'x' }, harvests: [{ from: 5, until: 1 }, null, { from: 0, until: 10, mult: 2 }], log: { merchant: 2 } });
  assert.equal(n.deserters, null);
  assert.deepEqual(n.harvests, [{ from: 0, until: 10, mult: 2 }]);
  assert.equal(n.log.deserters, 0);
  assert.equal(n.log.merchant, 2);
  const old = sanitizeWorldEvents({ seq: 3, pending: { kind: 'harvest', expiresAt: 9, gold: 5 } });
  assert.deepEqual(old.harvests, []);
  assert.equal(old.pending.kind, 'harvest');
});

test('every rival, the Ashen included, has lines for both new events', () => {
  for (const f of LEADER_FACTIONS) for (const k of ['deserters', 'harvest']) assert.ok(LEADER_LINES[f][k].length >= 4, `${f} ${k}`);
});
