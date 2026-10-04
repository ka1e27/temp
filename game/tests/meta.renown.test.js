// Renown (DESIGN §10.7, §10.12): earned from crowns, defenses won (+1 unbroken), retakes and capitals; spent on Festivals (a
// prosperity level now, tenure moved so growth continues), Training, Mercenaries, Muster, Heal and Respec; reset per dynasty.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/generate.js';
import { createGame } from '../meta/state.js';
import { conquer } from '../meta/progression.js';
import { awardCrowns } from '../meta/crowns.js';
import { prosperityLevel, updateProsperity } from '../meta/prosperity.js';
import {
  earnRenown, renownPoints, sanitizeRenown, defaultRenown, festival, festivalCost, festivalRefusal, train, trainRefusal, heal,
  healRefusal, respec, respecRefusal, hireMercenary, hireRefusal, muster, musterRefusal, renownSpends,
} from '../meta/renown.js';
import { ensureGenerals, generalById, wound } from '../meta/generals.js';
import { drainMilitia, militiaFill } from '../meta/militia.js';
import { occupy, defenseReward, defenseRunFor, ensureFrontier } from '../meta/frontier.js';
import { RENOWN } from '../config/renown.js';
import { PROSPERITY } from '../config/prosperity.js';
import { GENERALS } from '../config/generals.js';

const world = generateWorld(5);
function realm(points = 0) {
  const s = createGame(5, world, 0);
  for (const r of world.regions) if (r.tier <= 2) { s.owner[r.id] = 0; s.conqueredAt[r.id] = 0; }
  s.prosperity = world.regions.map(() => 0);
  ensureGenerals(s);
  if (points) earnRenown(s, points, 'crown');
  return s;
}
const ownedId = (s) => world.regions.find((r) => r.tier === 1 && s.owner[r.id] === 0).id;

test('earning: crowns pay 1 each, a capital 3, a retake 2, a defense won 2 (+1 unbroken)', () => {
  const s = realm();
  const target = world.regions.find((r) => r.tier === 3 && s.owner[r.id] !== 0 && !r.isCapital && !r.type); // a typed region pays its own Renown
  conquer(s, world, target.id, 10);
  const award = awardCrowns(s, world, target.id, { victory: true, swift: true, unbroken: false }, 100);
  assert.equal(award.renown, 2);
  assert.equal(renownPoints(s), 2 * RENOWN.earn.crown);
  assert.equal(awardCrowns(s, world, target.id, { victory: true, swift: true, unbroken: true }, 100).renown, 0, 'crowns are fixed once stored');
  occupy(s, world, target.id, 2, 20);
  const r = conquer(s, world, target.id, 30);
  assert.equal(r.renown, RENOWN.earn.retake);
  assert.equal(renownPoints(s), 2 + RENOWN.earn.retake);
  assert.equal(s.renown.log.retake, RENOWN.earn.retake);
  // a defense won
  ensureFrontier(s).activeSec = 2000;
  const raidRegion = world.regions.find((x) => s.owner[x.id] === 0 && x.neighbors.some((n) => s.owner[n] >= 2));
  const from = raidRegion.neighbors.find((n) => s.owner[n] >= 2);
  const run = defenseRunFor(s, world, { id: 1, faction: s.owner[from], fromRegionId: from, toRegionId: raidRegion.id, depth: 2, first: false }, null, { nowMs: 0 });
  const before = renownPoints(s);
  const reward = defenseReward(s, world, run, 'win', 0); // nothing happened: every site still held, so unbroken
  assert.equal(reward.renown, RENOWN.earn.defenseWon + RENOWN.earn.defenseUnbroken);
  assert.equal(renownPoints(s) - before, reward.renown);
  run.battle.sites.find((x) => x.owner === 0 && x.id !== run.battle.arena.keepSite).owner = 2;
  assert.equal(defenseReward(s, world, run, 'win', 0).renown, RENOWN.earn.defenseWon, 'a settlement lost: no bonus');
  assert.equal(earnRenown(s, -5), 0);
});

test('Festival: +1 prosperity now, the tenure clock jumps to the threshold, cost rises per level and per festival', () => {
  const s = realm(100);
  const id = ownedId(s);
  const now = 5 * 60 * 1000;
  s.conqueredAt[id] = now - 60 * 1000; // held one minute
  assert.equal(festivalCost(s, id), RENOWN.cost.festivalPerLevel * 1);
  const a = festival(s, world, id, now);
  assert.deepEqual(a, { cost: 3, level: 1 });
  assert.equal(s.prosperity[id], 1);
  assert.equal(s.conqueredAt[id], now - PROSPERITY.thresholdsMs[0]);
  assert.equal(prosperityLevel(s, id, now), 1, 'the tenure agrees with the level');
  assert.equal(prosperityLevel(s, id, now + PROSPERITY.thresholdsMs[1] - PROSPERITY.thresholdsMs[0]), 2, 'natural growth continues from there');
  assert.equal(festivalCost(s, id), Math.ceil(3 * 2 * (1 + RENOWN.cost.festivalRise)));
  festival(s, world, id, now);
  festival(s, world, id, now);
  assert.equal(s.prosperity[id], 3);
  assert.equal(festivalRefusal(s, world, id), 'maxed');
  const ups = updateProsperity(s, world, now);
  assert.ok(!ups.some((u) => u.regionId === id), 'no second celebration from the clock');
  const foreign = world.regions.find((r) => s.owner[r.id] !== 0).id;
  assert.equal(festivalRefusal(s, world, foreign), 'notOwned');
  const poor = realm(0);
  assert.equal(festivalRefusal(poor, world, id), 'renown');
  assert.equal(festival(poor, world, id, now), false);
  // a region held longer than the threshold keeps its tenure
  const old = realm(10);
  old.conqueredAt[id] = 0;
  festival(old, world, id, 10 * 60 * 60 * 1000);
  assert.equal(old.conqueredAt[id], 0);
});

test('Training, Heal, Respec: costs, effects and refusals', () => {
  const s = realm(40);
  const m = generalById(s, 'marshal');
  assert.deepEqual(train(s, 'marshal'), { cost: RENOWN.cost.trainPerLevel * 1, level: 2 });
  assert.equal(trainRefusal(s, 'nobody'), 'unknown');
  m.level = GENERALS.maxLevel;
  assert.equal(trainRefusal(s, 'marshal'), 'maxed');
  assert.equal(healRefusal(s, 'marshal', 0), 'notWounded');
  wound(m, 0);
  const pts = renownPoints(s);
  assert.deepEqual(heal(s, 'marshal', 1), { cost: RENOWN.cost.heal });
  assert.equal(m.woundedUntil, null);
  assert.equal(renownPoints(s), pts - RENOWN.cost.heal);
  assert.equal(respecRefusal(s, 'marshal'), 'noSkills');
  m.skills = [0, 1, 1];
  s.battles = [{ commander: 'marshal', battle: { result: null } }];
  assert.equal(respecRefusal(s, 'marshal'), 'busy');
  s.battles = [];
  assert.deepEqual(respec(s, 'marshal'), { cost: RENOWN.cost.respec, picks: 5 });
  assert.deepEqual(m.skills, []);
});

test('Mercenaries: 12 Renown each, at most 2', () => {
  const s = realm(30);
  const a = hireMercenary(s);
  const b = hireMercenary(s);
  assert.ok(a && b && a.id !== b.id);
  assert.equal(renownPoints(s), 30 - 2 * RENOWN.cost.mercenary);
  earnRenown(s, 50, 'crown');
  assert.equal(hireRefusal(s), 'full');
  assert.equal(hireMercenary(s), false);
  assert.equal(hireRefusal(realm(1)), 'renown');
});

test('Muster refills a drained militia now', () => {
  const s = realm(5);
  const id = ownedId(s);
  assert.equal(musterRefusal(s, world, id, 0), 'full_militia');
  drainMilitia(s, id, 0.7, 0);
  assert.deepEqual(muster(s, world, id, 1), { cost: RENOWN.cost.muster });
  assert.equal(militiaFill(s, id, 1), 1);
});

test('renownSpends: every spend priced with a reason in words; sanitizeRenown is junk-proof', () => {
  const s = realm(2);
  const id = ownedId(s);
  const d = renownSpends(s, world, id, 0);
  assert.equal(d.renown, 2);
  assert.equal(d.region.festival.cost, 3);
  assert.equal(d.region.festival.can, false);
  assert.equal(d.region.festival.reason, 'Need 1 more Renown');
  assert.equal(d.region.muster.reason, RENOWN.copy.reasons.full_militia);
  assert.equal(d.generals[0].train.can, true);
  assert.deepEqual(sanitizeRenown(null), defaultRenown());
  const c = sanitizeRenown({ points: 5.7, earned: 2, spent: -1, festivals: 'x', log: { crown: 3, junk: 1 } });
  assert.equal(c.points, 5);
  assert.equal(c.earned, 5);
  assert.equal(c.spent, 0);
  assert.deepEqual(c.log, { crown: 3, defense: 0, retake: 0, capital: 0, feature: 0, bounty: 0, vendetta: 0, deed: 0 }); // + Phase 4's reasons
});
