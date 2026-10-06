// Phase 11 (PLAN-PHASE11, early flow): the scheduled first raid (game/meta/frontier.js firstRaidDueAt, FRONTIER.firstRaidAfterGraceSec),
// the upgrade cost ramp (game/config/meta.js UPGRADE_COST_RAMP), the map's labels crediting the card's commander (game/app/regionsList.js)
// and the human-paced first hour of tools/campaign.mjs (--policy=human).
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/generate.js';
import { createGame, resetRegions } from '../meta/state.js';
import { tickFrontier, ensureFrontier, firstRaidDueAt, sanitizeFrontier } from '../meta/frontier.js';
import { FRONTIER } from '../config/frontier.js';
import { UPGRADE_COST_RAMP, UPGRADE_COST_MULT, UPGRADE_TUNING, upgradeCostRamp } from '../config/meta.js';
import { UPGRADES, upgradeCost } from '../meta/upgrades.js';
import { regionsListData } from '../app/regionsList.js';
import { difficulty } from '../meta/progression.js';

/** A realm holding every region of tier <= 2 (seed 5: three bordering rivals), at `activeSec` of active play. */
function realm(seed = 5, activeSec = 0) {
  const world = generateWorld(seed);
  const state = createGame(seed, world, 0);
  for (const r of world.regions) if (r.tier <= 2) { state.owner[r.id] = 0; state.conqueredAt[r.id] = 0; }
  state.battles = [];
  ensureFrontier(state).activeSec = activeSec;
  state.frontier.nextCheckAt = activeSec;
  return { world, state };
}

/** Ticks the scheduler 1 s at a time until the first raid sets out (or `maxSec`); returns its announced raid and the active second. */
function untilFirstRaid(state, world, maxSec) {
  for (let i = 0; i < maxSec; i++) {
    const r = tickFrontier(state, world, 0, 1);
    if (r.announced.length) return { raid: r.announced[0], at: state.frontier.activeSec };
  }
  return null;
}

test('the first raid is scheduled: it sets out inside the window after the grace (arriving 2-5 min after it), weak, and never before', () => {
  const [lo, hi] = FRONTIER.firstRaidAfterGraceSec;
  assert.ok(lo + FRONTIER.telegraphSec >= 120 - 1e-9 && hi + FRONTIER.telegraphSec <= 300 + 1e-9, 'arrival 2-5 minutes after the grace');
  const sends = [];
  for (const seed of [5, 7, 11]) {
    const { world, state } = realm(seed, 0);
    const got = untilFirstRaid(state, world, FRONTIER.graceSec + hi + 60);
    assert.ok(got, `seed ${seed}: a first raid within the window`);
    const graceEnd = state.frontier.graceEndedAt;
    assert.ok(Math.abs(graceEnd - FRONTIER.graceSec) <= FRONTIER.checkSec, `seed ${seed}: the grace ended at ${graceEnd}`);
    const after = got.at - graceEnd;
    assert.ok(after >= lo - 1e-9 && after <= hi + FRONTIER.checkSec, `seed ${seed}: set out ${after} s after the grace`);
    assert.ok(Math.abs(got.at - firstRaidDueAt(state)) <= FRONTIER.checkSec, 'at the scheduled moment (to a scheduler check)');
    assert.equal(got.raid.first, true, 'the weak, forgiving first raid');
    sends.push(after);
  }
  assert.ok(new Set(sends.map((s) => Math.round(s))).size > 1, 'the moment is seeded per realm, not one fixed time');
});

test('the first raid waits for minRegions too: it is scheduled from the moment the grace really ends', () => {
  const world = generateWorld(5);
  const state = createGame(5, world, 0);
  state.battles = [];
  ensureFrontier(state);
  for (let i = 0; i < FRONTIER.graceSec + 600; i++) assert.equal(tickFrontier(state, world, 0, 1).announced.length, 0, 'one region held: still in grace');
  assert.equal(firstRaidDueAt(state), null);
  for (const r of world.regions) if (r.tier <= 2) { state.owner[r.id] = 0; state.conqueredAt[r.id] = 0; }
  const start = state.frontier.activeSec;
  const got = untilFirstRaid(state, world, 600);
  assert.ok(got && got.at - start >= FRONTIER.firstRaidAfterGraceSec[0] - FRONTIER.checkSec, 'a few minutes after the grace ended, not at once');
});

test('each dynasty schedules its own first raid, and the grace end survives a save', () => {
  const { world, state } = realm(5, 0);
  assert.ok(untilFirstRaid(state, world, FRONTIER.graceSec + 400));
  const saved = sanitizeFrontier(JSON.parse(JSON.stringify(state.frontier)));
  assert.equal(saved.graceEndedAt, state.frontier.graceEndedAt);
  const next = resetRegions(state, world, 0);
  assert.equal(firstRaidDueAt(next), null, 'a new dynasty starts its grace over');
  for (const r of world.regions) if (r.tier <= 2) { next.owner[r.id] = 0; next.conqueredAt[r.id] = 0; }
  next.battles = [];
  const got = untilFirstRaid(next, world, FRONTIER.graceSec + 400);
  assert.ok(got && got.raid.first, 'the new dynasty gets a scheduled first raid');
});

test('the cost ramp: level 0 is the base price, the multiplier climbs to UPGRADE_COST_MULT and holds there', () => {
  const [l0, m0] = UPGRADE_COST_RAMP[0];
  const [lEnd, mEnd] = UPGRADE_COST_RAMP[UPGRADE_COST_RAMP.length - 1];
  assert.equal(l0, 0);
  assert.equal(mEnd, UPGRADE_COST_MULT, 'the late levels keep the Phase 7 price');
  assert.ok(m0 < mEnd, 'the first levels are cheaper');
  assert.equal(upgradeCostRamp(0), 1);
  for (let l = 0; l < 40; l++) assert.ok(upgradeCostRamp(l + 1) >= upgradeCostRamp(l) - 1e-12, 'never falls');
  assert.ok(Math.abs(upgradeCostRamp(lEnd) - mEnd / m0) < 1e-12 && Math.abs(upgradeCostRamp(lEnd + 30) - mEnd / m0) < 1e-12);
  for (const id of Object.keys(UPGRADE_TUNING)) {
    assert.equal(upgradeCost(id, 0), UPGRADES[id].baseCost);
    assert.equal(upgradeCost(id, lEnd + 3), Math.round(UPGRADES[id].baseCost * UPGRADES[id].growth ** (lEnd + 3) * (mEnd / m0)));
  }
});

test('the Regions list reads the label the card reads when it is given the card\'s commander', () => {
  const { world, state } = realm(5, 0);
  const plain = regionsListData(state, world).filter((r) => r.kind === 'frontier');
  const cmd = state.generals && state.generals.roster && state.generals.roster[0] ? state.generals.roster[0].id : null;
  const credited = regionsListData(state, world, { commanderFor: () => cmd }).filter((r) => r.kind === 'frontier');
  assert.equal(plain.length, credited.length);
  for (const row of credited) assert.equal(row.label, difficulty(state, world, row.id, { commander: cmd }).label);
});

test('tools/campaign.mjs --policy=human: a human-paced first hour is deterministic and reports the Phase 11 measures', async () => {
  const { runHumanHour } = await import('../../tools/campaign.mjs');
  const a = runHumanHour(5, { minutes: 30 });
  const b = runHumanHour(5, { minutes: 30 });
  assert.deepEqual(a.metrics, b.metrics);
  assert.ok(a.metrics.battles > 0 && a.metrics.avail >= 0 && a.metrics.avail <= 1 && a.metrics.longestIdleSec >= 0);
  assert.ok(a.raids && a.raids.firstRaidSec > FRONTIER.graceSec, 'the scheduled first raid comes after the grace');
});

// --- Phase 11b: Unrest, Best value over Powers, the first raid's reserved slot -------------------------------------------------------------

import { UNREST } from '../config/unrest.js';
import { tickUnrest, calmUnrest, unrestInfo, unrestThin, sanitizeUnrest, ensureUnrest } from '../meta/unrest.js';
import { attackableFrontier, conquer } from '../meta/progression.js';
import { bestValueUpgrade } from '../app/bestValue.js';
import { createPacer, firstRaidReserved } from '../app/pacer.js';
import { firstRaidPlannedAt } from '../meta/frontier.js';
import { PACING } from '../config/pacing.js';
import { bestFreeGeneral } from '../meta/generals.js';

/** A realm whose whole frontier reads Hard or Deadly (seed 5, every region of tier <= 2 held, no upgrades). */
function walled() {
  const { world, state } = realm(5, 0);
  const labels = attackableFrontier(state, world).map((id) => difficulty(state, world, id).label);
  assert.ok(labels.length && labels.every((l) => l === 'Hard' || l === 'Deadly'), `a walled frontier (${labels.join(', ')})`);
  return { world, state };
}

test('Unrest: after UNREST.idleSec with nothing Easy or Fair, the best-ratio region thins by perMin up to max, and its card reads it', () => {
  const { world, state } = walled();
  const ids = attackableFrontier(state, world);
  const card = (id) => { const g = bestFreeGeneral(state, world, id, 'attack', 0); return difficulty(state, world, id, g ? { commander: g.id } : {}); };
  const best = ids.slice().sort((a, b) => card(b).ratio - card(a).ratio)[0];
  const before = difficulty(state, world, best);
  let started = null;
  for (let t = 0; t < UNREST.idleSec - 5; t += 5) started = tickUnrest(state, world, 5).started ?? started;
  assert.equal(started, null, 'nothing before the idle time');
  for (let t = 0; t < 10 && started == null; t += 5) started = tickUnrest(state, world, 5).started;
  assert.equal(started, best, 'the weakest frontier region (the best ratio) falls into Unrest');
  for (let i = 0; i < 12; i++) tickUnrest(state, world, 5); // one more minute
  const thin = unrestThin(state, best);
  assert.ok(Math.abs(thin - Math.min(UNREST.max, UNREST.perMin * (65 / 60))) < 0.02, `thinned ${thin}`);
  const after = difficulty(state, world, best);
  assert.ok(after.strength < before.strength && after.ratio > before.ratio, 'the card (label and chance) counts the thinning');
  assert.ok(after.winChance >= before.winChance);
  for (let i = 0; i < 240; i++) tickUnrest(state, world, 5);
  assert.ok(unrestThin(state, best) <= UNREST.max + 1e-9 && unrestThin(state, best) > 0);
  const info = unrestInfo(state, best);
  assert.ok(info && /Unrest/.test(info.text) && info.pct > 0);
});

test('Unrest: attacking the region calms it (then it recovers slowly); an Easy or Fair region calms it too; a conquest clears it', () => {
  const { world, state } = walled();
  for (let i = 0; i < 60; i++) tickUnrest(state, world, 5);
  const u = ensureUnrest(state);
  const id = u.target;
  assert.ok(id != null);
  const t0 = unrestThin(state, id);
  calmUnrest(state, id);
  assert.equal(u.target, null);
  assert.equal(u.idleSec, 0, 'the wait starts over');
  tickUnrest(state, world, 60);
  const t1 = unrestThin(state, id);
  if (u.target !== id) assert.ok(Math.abs(t0 - t1 - UNREST.recoverPerMin) < 1e-6, `recovers ${UNREST.recoverPerMin} a minute (${t0} -> ${t1})`);
  conquer(state, world, id, 0);
  assert.equal(unrestThin(state, id), 0, 'conquered: gone');
  // a fresh realm has an Easy first ring: never any Unrest
  const w2 = generateWorld(7);
  const s2 = createGame(7, w2, 0);
  for (let i = 0; i < 120; i++) tickUnrest(s2, w2, 5);
  assert.equal(ensureUnrest(s2).target, null);
  assert.deepEqual(ensureUnrest(s2).thin, {});
});

test('Unrest: never in a challenge, and it survives a save', () => {
  const { world, state } = walled();
  for (let i = 0; i < 60; i++) tickUnrest(state, world, 5);
  const saved = sanitizeUnrest(JSON.parse(JSON.stringify(state.unrest)));
  assert.deepEqual(saved, state.unrest);
  assert.deepEqual(sanitizeUnrest({ thin: { a: 1, 2: -1, 3: 9 }, target: 'x' }).thin, { 3: UNREST.max });
  const id = state.unrest.target;
  state.challenge = { kind: 'daily' };
  assert.equal(unrestThin(state, id), 0, 'a challenge reads no thinning');
  const snap = JSON.stringify(state.unrest);
  tickUnrest(state, world, 600);
  assert.equal(JSON.stringify(state.unrest), snap, 'and the clock does not run');
});

test('Best value rates the Powers cards too (PLAN-PHASE11b)', () => {
  const { world, state } = realm(5, 0);
  const tabs = new Set();
  for (let i = 0; i < 80; i++) {
    const b = bestValueUpgrade(state, world);
    if (!b) break;
    tabs.add(UPGRADES[b.id].tab);
    state.upgrades[b.id] = (state.upgrades[b.id] || 0) + 1;
  }
  assert.ok(tabs.has('powers') && tabs.has('army'), `both tabs get the tag (${[...tabs].join(', ')})`);
  assert.ok(!tabs.has('realm'));
});

test('the pacer keeps a slot for the scheduled first raid: no other first appearance within firstRaidReserveSec of it', () => {
  const { state } = realm(5, 0);
  state.stats = { ...(state.stats || {}), playSec: 0 };
  const at = firstRaidPlannedAt(state);
  assert.ok(at >= FRONTIER.graceSec + FRONTIER.firstRaidAfterGraceSec[0] - 1e-9, 'planned before the grace ends (the realm holds minRegions)');
  state.frontier.graceEndedAt = FRONTIER.graceSec; // the scheduler's first check out of grace
  assert.ok(Math.abs(firstRaidPlannedAt(state) - at) < 1e-9, 'the same moment once the grace has ended');
  state.frontier.activeSec = at - PACING.firstRaidReserveSec - 1;
  assert.equal(firstRaidReserved(state), false);
  state.frontier.activeSec = at - 30;
  assert.equal(firstRaidReserved(state), true);
  const pacer = createPacer({ getState: () => state, gapSec: 0, hold: (n) => n !== 'raids' && firstRaidReserved(state) });
  assert.equal(pacer.ready('deeds'), false, 'another system waits');
  assert.equal(pacer.ready('raids'), true, 'the raid itself does not');
  state.frontier.activeSec = at + PACING.firstRaidReserveSec + 1;
  assert.equal(pacer.ready('deeds'), true);
  // once the raid has set out the slot is gone
  state.frontier.activeSec = at;
  state.frontier.stats.raids = 1;
  assert.equal(firstRaidReserved(state), false);

});

test('Best value names only a card within BEST_VALUE.horizonSec of income; with none in reach, the cheapest that raises power', async () => {
  const { BEST_VALUE } = await import('../config/meta.js');
  const { incomePerSec } = await import('../meta/economy.js');
  const { world, state } = realm(5, 0);
  for (let i = 0; i < 60; i++) { state.gold = 1e9; const b = bestValueUpgrade(state, world); if (!b) break; state.upgrades[b.id] = (state.upgrades[b.id] || 0) + 1; }
  state.gold = 0;
  const reach = incomePerSec(state, world) * BEST_VALUE.horizonSec;
  const b = bestValueUpgrade(state, world);
  assert.ok(b);
  const costs = Object.keys(UPGRADES).filter((id) => UPGRADES[id].tab !== 'realm').map((id) => upgradeCost(id, state.upgrades[id] || 0));
  if (costs.some((c) => c <= reach)) assert.ok(b.cost <= reach, `${b.id} costs ${b.cost}, reach ${reach}`);
  else assert.equal(b.cost, Math.min(...costs.filter((c) => c > 0)));
});
