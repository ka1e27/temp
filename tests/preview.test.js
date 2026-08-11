// The outcome preview: the design's load-bearing promise under test.
//
// Combat contains no RNG at all, so what the player is shown before committing
// is a guarantee, not a prediction. That only holds because the HUD calls
// resolveField() and breachSeconds() DIRECTLY — the same functions the
// simulation calls. These tests pin the section 4 worked examples to the
// literal strings the player reads, so any drift shows up as a failing string
// rather than as a quiet lie in the UI.
import test from 'node:test';
import assert from 'node:assert/strict';

import { computePreview, previewLine, projectGarrison, travelSecondsFor }
  from '../src/screens/battle-hud.js';
import { createView, filterList, cmd } from '../src/screens/battle-input.js';
import { createBattleState } from '../src/battle/state.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { emptyComp } from '../src/battle/combat.js';
import { factionGoldPerSec, runEconomy } from '../src/battle/economy.js';
import { AI_TIERS, CENTIGOLD, UNIT_IDS } from '../src/content/balance.js';
import { TICK_HZ } from '../src/core/loop.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

// ---------------------------------------------------------------------------
// Outcome preview — the §4 worked examples, as literal player-facing strings
// ---------------------------------------------------------------------------

function fixture(sites, adjacency = []) {
  return createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: 'test',
    seed: 1,
    grid: { cols: 11, rows: 9, blocked: [] },
    sites,
    adjacency,
    player: makeMods({ expedition: emptyComp() }),
    enemy: makeMods({ expedition: emptyComp() }),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 480000, aiTier: 1 },
  });
}

const eta = () => 4.2;

test('preview: the raid — 4 raiders take a farm but cannot breach it fast', () => {
  const st = fixture([
    { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { raiders: 4 }, hp: 600, hpMax: 600 },
    { id: 'farm', kind: 'farm', hex: [1, 0], owner: 'enemy', garrison: { militia: 5 }, hp: 100, hpMax: 100 },
    { id: 'cas', kind: 'castle', hex: [4, 0], owner: 'enemy', garrison: {}, hp: 600, hpMax: 600 },
  ], [['camp', 'farm'], ['farm', 'cas']]);

  const pv = computePreview(st, 'camp', 'farm', { fraction: 1, travelSeconds: eta });
  near(pv.ap, 83.2, 1e-9);
  near(pv.dp, 15, 1e-9);
  assert.equal(pv.win, true);
  assert.equal(pv.survivors, 3);
  near(pv.breachSec, 250, 1e-9);
  assert.equal(pv.insufficient, false);
  assert.equal(previewLine(pv), 'AP 83.2 / DP 15.0 · WIN FIELD · 3 survive · BREACH 4:10 · ETA 4.2s');
});

test('preview: the siege two-punch — 12 militia + 1 ram lose the field', () => {
  const st = fixture([
    { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 12, rams: 1 }, hp: 600, hpMax: 600 },
    { id: 'hold', kind: 'stronghold', hex: [1, 0], owner: 'enemy', garrison: { spearmen: 6, militia: 4 }, hp: 340, hpMax: 340 },
    { id: 'cas', kind: 'castle', hex: [4, 0], owner: 'enemy', garrison: {}, hp: 600, hpMax: 600 },
  ], [['camp', 'hold'], ['hold', 'cas']]);

  const pv = computePreview(st, 'camp', 'hold', { fraction: 1, travelSeconds: eta });
  // AP = 12 militia (12*4*1.45, spearmen are 60% of the foe) + 1 ram (1*6*1.96)
  // = 69.6 + 11.76 = 81.36 — unaffected by the stronghold split, because AP
  // never reads a site's own numbers.
  near(pv.ap, 81.36, 1e-9);
  // DP = (6 spearmen*8*1.75 bulwark + 4 militia*3) * 1.55 defMult * 1.30
  // garrisonMult = 96 * 2.015 = 193.44 — the NEW term. A stronghold's garrison
  // now fights behind its walls AND dug in on its own ground, which is exactly
  // what makes it a different building from a training ground.
  near(pv.dp, 193.44, 1e-9);
  assert.equal(pv.win, false);
  assert.equal(pv.verdict, 'LOSE FIELD');
  assert.equal(previewLine(pv), 'AP 81.4 / DP 193.4 · LOSE FIELD · ETA 4.2s');
});

test('preview: a token force is told plainly that it cannot breach', () => {
  const st = fixture([
    { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 12 }, hp: 600, hpMax: 600 },
    { id: 'hold', kind: 'stronghold', hex: [1, 0], owner: 'neutral', garrison: {}, hp: 340, hpMax: 340 },
    { id: 'cas', kind: 'castle', hex: [4, 0], owner: 'enemy', garrison: {}, hp: 600, hpMax: 600 },
  ], [['camp', 'hold'], ['hold', 'cas']]);

  const pv = computePreview(st, 'camp', 'hold', { fraction: 1, travelSeconds: eta });
  assert.equal(pv.win, true);
  // 12 militia siege at 7.2/s against a stronghold repairing at 5.5/s: net 1.7
  // -> 340/1.7 = 200s. It does breach, but calling three minutes and twenty
  // seconds a breach is generous — it is barely above the threshold. Drop to a
  // quarter of that army and the walls simply win.
  assert.ok(Number.isFinite(pv.breachSec));
  near(pv.breachSec, 200, 1e-6);

  const pv2 = computePreview(st, 'camp', 'hold', { fraction: 0.25, travelSeconds: eta });
  assert.equal(pv2.sendN, 3);
  assert.equal(pv2.insufficient, true);
  assert.equal(pv2.breachSec, Infinity);
  assert.match(previewLine(pv2), /BREACH ∞/);
});

test('preview: the strength selector scales composition proportionally', () => {
  const st = fixture([
    { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 8, spearmen: 4 }, hp: 600, hpMax: 600 },
    { id: 'farm', kind: 'farm', hex: [1, 0], owner: 'enemy', garrison: { militia: 2 }, hp: 100, hpMax: 100 },
    { id: 'cas', kind: 'castle', hex: [4, 0], owner: 'enemy', garrison: {}, hp: 600, hpMax: 600 },
  ], [['camp', 'farm'], ['farm', 'cas']]);

  assert.equal(computePreview(st, 'camp', 'farm', { fraction: 0.5, travelSeconds: eta }).sendN, 6);
  assert.equal(computePreview(st, 'camp', 'farm', { fraction: 1, travelSeconds: eta }).sendN, 12);
  const half = computePreview(st, 'camp', 'farm', { fraction: 0.5, travelSeconds: eta }).send;
  assert.equal(half.militia, 4);
  assert.equal(half.spearmen, 2);
});

test('preview: unit filters keep the wall at home', () => {
  const st = fixture([
    { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 8, spearmen: 4 }, hp: 600, hpMax: 600 },
    { id: 'farm', kind: 'farm', hex: [1, 0], owner: 'enemy', garrison: { militia: 2 }, hp: 100, hpMax: 100 },
    { id: 'cas', kind: 'castle', hex: [4, 0], owner: 'enemy', garrison: {}, hp: 600, hpMax: 600 },
  ], [['camp', 'farm'], ['farm', 'cas']]);

  const pv = computePreview(st, 'camp', 'farm',
    { fraction: 1, filter: ['militia'], travelSeconds: eta });
  assert.equal(pv.send.spearmen, 0);
  assert.equal(pv.send.militia, 8);
});

test('preview: reinforcing a friendly site is not a battle', () => {
  const st = fixture([
    { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 10 }, hp: 600, hpMax: 600 },
    { id: 'farm', kind: 'farm', hex: [1, 0], owner: 'player', garrison: { militia: 2 }, hp: 100, hpMax: 100 },
    { id: 'cas', kind: 'castle', hex: [4, 0], owner: 'enemy', garrison: {}, hp: 600, hpMax: 600 },
  ], [['camp', 'farm'], ['farm', 'cas']]);

  const pv = computePreview(st, 'camp', 'farm', { fraction: 0.5, travelSeconds: eta });
  assert.equal(pv.kind, 'reinforce');
  assert.equal(previewLine(pv), 'REINFORCE +5 · ETA 4.2s');
});

test('preview: relieving a besieged site fights the besiegers in the open', () => {
  const st = fixture([
    { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 20 }, hp: 600, hpMax: 600 },
    { id: 'farm', kind: 'farm', hex: [1, 0], owner: 'player', garrison: {}, hp: 40, hpMax: 100 },
    { id: 'cas', kind: 'castle', hex: [4, 0], owner: 'enemy', garrison: {}, hp: 600, hpMax: 600 },
  ], [['camp', 'farm'], ['farm', 'cas']]);
  st.sites[1].siege = { owner: 'enemy', comp: { ...emptyComp(), militia: 4 } };

  const pv = computePreview(st, 'camp', 'farm', { fraction: 1, travelSeconds: eta });
  assert.equal(pv.kind, 'relieve');
  assert.equal(pv.verdict, 'BREAK SIEGE');
  assert.equal(pv.win, true);
  // No walls and no bulwark: 4 militia defending in the open is 4*3 = 12.
  near(pv.dp, 12, 1e-9);
});

test('preview: an unknown or self-targeted order yields nothing to show', () => {
  const st = fixture([
    { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 4 }, hp: 600, hpMax: 600 },
    { id: 'cas', kind: 'castle', hex: [4, 0], owner: 'enemy', garrison: {}, hp: 600, hpMax: 600 },
  ], [['camp', 'cas']]);
  assert.equal(computePreview(st, 'camp', 'camp', {}), null);
  assert.equal(computePreview(st, 'nope', 'cas', {}), null);
  assert.equal(previewLine(null), '');
});

test('preview: in-progress training is projected forward deterministically', () => {
  // A STRONGHOLD DOES NOT TRAIN ANY MORE — a `trainingGround` does (see
  // content/balance.js SITES) — so this fixture uses the yard, the same way a
  // real garrison-in-training would.
  const st = fixture([
    { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 4 }, hp: 600, hpMax: 600 },
    { id: 'hold', kind: 'trainingGround', hex: [1, 0], owner: 'enemy', garrison: { militia: 2 }, hp: 180, hpMax: 180 },
    { id: 'cas', kind: 'castle', hex: [4, 0], owner: 'enemy', garrison: {}, hp: 600, hpMax: 600 },
  ], [['camp', 'hold'], ['hold', 'cas']]);
  const hold = st.sites[1];
  hold.trainType = 'militia';
  hold.trainProgress = 0.9;

  // The yard trains at 1.30x: 0.9 + (8*1.30)/8 = 2.2 cycles -> floor 2, and
  // militia arrive 2 per cycle, so +4.
  assert.equal(projectGarrison(st, hold, 8).militia, 6);
  assert.equal(projectGarrison(st, hold, 0).militia, 2);
  const pv = computePreview(st, 'camp', 'hold', { fraction: 1, travelSeconds: () => 8 });
  // 6 defenders * 3 def * 1.05 (the yard's defMult; no garrisonMult — that term
  // is the wall's alone) = 18.9.
  near(pv.dp, 6 * 3 * 1.05, 1e-9);
});

test('preview: hp regen while the squad is in flight is shown, not hidden', () => {
  const st = fixture([
    { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { rams: 3 }, hp: 600, hpMax: 600 },
    { id: 'farm', kind: 'farm', hex: [1, 0], owner: 'enemy', garrison: {}, hp: 40, hpMax: 100 },
    { id: 'cas', kind: 'castle', hex: [4, 0], owner: 'enemy', garrison: {}, hp: 600, hpMax: 600 },
  ], [['camp', 'farm'], ['farm', 'cas']]);
  const pv = computePreview(st, 'camp', 'farm', { fraction: 1, travelSeconds: () => 10 });
  near(pv.hp, 60, 1e-9);                       // 40 + 2.0/s * 10s
  near(pv.breachSec, 60 / (36 - 2), 1e-9);     // 3 rams = 36/s vs 2/s regen
});

// ---------------------------------------------------------------------------
// Economy readout + command shapes
// ---------------------------------------------------------------------------

test('hud: income sums only the sites a faction actually holds', () => {
  const st = fixture([
    { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: {}, hp: 600, hpMax: 600 },
    { id: 'f1', kind: 'farm', hex: [1, 0], owner: 'player', garrison: {}, hp: 100, hpMax: 100 },
    { id: 'f2', kind: 'farm', hex: [2, 0], owner: 'enemy', garrison: {}, hp: 100, hpMax: 100 },
    { id: 'cas', kind: 'castle', hex: [4, 0], owner: 'enemy', garrison: {}, hp: 600, hpMax: 600 },
  ], [['camp', 'f1'], ['f1', 'f2'], ['f2', 'cas']]);
  near(factionGoldPerSec(st, 'player'), 6);   // camp 4.0 + farm 2.0
  // NOT 6. This used to assert the enemy earned the same as the player, because
  // it went through a second, hand-rolled copy of the farm formula that knew
  // nothing about the AI's economy handicap. A tier-1 enemy really earns 0.65x,
  // and the treasury has always agreed with THIS number, not that one.
  near(factionGoldPerSec(st, 'enemy'), 6 * AI_TIERS[0].economyMult);
});

test('the readout is the simulation\'s own number, not a second copy of it', () => {
  // The bug this replaces shipped because the HUD re-derived farm income. Tie
  // the readout to what runEconomy actually credits, so any future divergence
  // fails here instead of quietly misreporting the treasury for a release.
  const st = fixture([
    { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: {}, hp: 600, hpMax: 600 },
    { id: 'f1', kind: 'farm', hex: [1, 0], owner: 'player', garrison: {}, hp: 100, hpMax: 100 },
    { id: 'cas', kind: 'castle', hex: [4, 0], owner: 'enemy', garrison: {}, hp: 600, hpMax: 600 },
  ], [['camp', 'f1'], ['f1', 'cas']]);
  const rate = factionGoldPerSec(st, 'player');
  const before = st.factions.player.goldEarnedCg;
  for (let i = 0; i < TICK_HZ; i++) runEconomy(st);
  const credited = (st.factions.player.goldEarnedCg - before) / CENTIGOLD;
  near(credited, rate, 0.05);
});

test('hud: the ETA comes from movement.js, so one ram slows the whole column', () => {
  const st = fixture([
    { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: {}, hp: 600, hpMax: 600 },
    { id: 'cas', kind: 'castle', hex: [4, 0], owner: 'enemy', garrison: {}, hp: 600, hpMax: 600 },
  ], [['camp', 'cas']]);
  const [from, to] = st.sites;
  const fast = travelSecondsFor(st, from, to, { ...emptyComp(), militia: 5 });
  const slow = travelSecondsFor(st, from, to, { ...emptyComp(), militia: 5, rams: 1 });
  assert.ok(fast > 0);
  assert.ok(slow > fast, 'one ram must slow the whole column');
});

test('hud: an un-injected preview still produces a finite, sane ETA', () => {
  const st = fixture([
    { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 8 }, hp: 600, hpMax: 600 },
    { id: 'farm', kind: 'farm', hex: [2, 0], owner: 'enemy', garrison: { militia: 2 }, hp: 100, hpMax: 100 },
    { id: 'cas', kind: 'castle', hex: [4, 0], owner: 'enemy', garrison: {}, hp: 600, hpMax: 600 },
  ], [['camp', 'farm'], ['farm', 'cas']]);
  const pv = computePreview(st, 'camp', 'farm', { fraction: 1 });
  assert.ok(Number.isFinite(pv.eta) && pv.eta > 0, `eta was ${pv.eta}`);
  assert.match(pv.line, /ETA \d/);
});

test('input: the view starts at the documented defaults', () => {
  const v = createView();
  assert.equal(v.fraction, 0.5);
  // Every unit on by default: a filter that silently omitted a troop would send
  // an army the player did not order. Driven off UNIT_IDS so a new one cannot
  // ship switched off.
  assert.deepEqual(filterList(v.filter), [...UNIT_IDS]);
  v.filter.spearmen = false;
  assert.deepEqual(filterList(v.filter), UNIT_IDS.filter((u) => u !== 'spearmen'));
});

test('input: commands are plain serializable data', () => {
  const c = cmd.send('a', 'b', 0.5, ['militia']);
  assert.deepEqual(c, { t: 'SEND', from: 'a', to: 'b', fraction: 0.5, filter: ['militia'] });
  assert.equal(JSON.stringify(c), '{"t":"SEND","from":"a","to":"b","fraction":0.5,"filter":["militia"]}');
  assert.deepEqual(cmd.rally('a', 'b'), { t: 'RALLY', site: 'a', target: 'b' });
  assert.deepEqual(cmd.rally('a', null), { t: 'RALLY', site: 'a', target: null });
  assert.deepEqual(cmd.retreat('a'), { t: 'RETREAT', site: 'a' });
  assert.deepEqual(cmd.retreatSquad(7), { t: 'RETREAT_SQUAD', squadId: 7 });
  assert.deepEqual(cmd.booster('rally'), { t: 'BOOSTER', id: 'rally', site: null });
  assert.deepEqual(cmd.train('a', 'rams'), { t: 'TRAIN', site: 'a', unit: 'rams' });
});
