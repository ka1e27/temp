// The difficulty label must tell the truth (docs/briefs/balance.md §3, DESIGN §5.3): small-n,
// generous-tolerance versions of what tools/balance.mjs measures with thousands of battles.
// Also pins the tutorial rules: surrender only after a first win, the first ring reads Easy but
// sits below the surrender ratio, and a first-timer's opening fight lasts about a minute.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/generate.js';
import { createGame } from '../meta/state.js';
import { difficulty, frontier, conquer, winChance, attackableFrontier } from '../meta/progression.js';
import { ECONOMY, DIFFICULTY } from '../config/meta.js';
import { sweepRows, tutorialRows } from '../../tools/balance.mjs';
import { runCampaign, runHumanHour } from '../../tools/campaign.mjs';

const winRate = (rows) => rows.filter((r) => r.win).length / Math.max(1, rows.length);

test('surrender is never offered before the first battle is won (DESIGN §5.3)', () => {
  const world = generateWorld(1);
  const state = createGame(1, world, 0);
  state.upgrades = { ...state.upgrades, muster: 400 }; // an absurdly big camp: ratio far above the surrender line
  const id = frontier(state, world)[0];
  const fresh = difficulty(state, world, id);
  assert.ok(fresh.ratio >= ECONOMY.surrenderRatio, `test setup: ratio ${fresh.ratio}`);
  assert.equal(fresh.surrender, false, 'no surrender before the first win');
  state.stats.battlesWon = 1;
  assert.equal(difficulty(state, world, id).surrender, true, 'the same army is offered one after a win');
});

// PLAN-PHASE15: surrender reads the raw ratio (power / strength); the label and the chance read the calibrated one (calibrateRatio)
test('first ring at game start: Easy, clearly below the surrender ratio (seeds 1-12)', () => {
  let easyPick = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const world = generateWorld(seed);
    const state = createGame(seed, world, 0);
    const ring = frontier(state, world).map((id) => ({ id, d: difficulty(state, world, id) }));
    for (const { id, d } of ring) {
      assert.ok(d.rawRatio < ECONOMY.surrenderRatio, `seed ${seed} ${world.regions[id].name}: raw ratio ${d.rawRatio.toFixed(2)} reaches the surrender line`);
      assert.equal(d.surrender, false);
    }
    const easiest = ring.reduce((a, b) => (b.d.ratio > a.d.ratio ? b : a));
    // a world whose only neighbours hold a fort or five sites may read Fair, never Hard
    assert.ok(easiest.d.ratio >= ECONOMY.difficultyLabels[1].min, `seed ${seed}: the tutorial region must read Easy or Fair (${easiest.d.ratio.toFixed(2)})`);
    if (easiest.d.label === 'Easy') easyPick++;
  }
  assert.ok(easyPick >= 10, `the tutorial region reads Easy on ${easyPick}/12 seeds`);
});

test('tutorial fight: a first-timer wins the easiest neighbour in about a minute', () => {
  const rows = tutorialRows([1, 2, 3, 4, 5, 6]);
  const picks = [];
  for (const seed of new Set(rows.map((r) => r.seed))) {
    picks.push(rows.filter((r) => r.seed === seed).sort((a, b) => b.ratio - a.ratio)[0]);
  }
  assert.ok(picks.every((r) => r.humanWin), 'the tutorial region is always won');
  const secs = picks.map((r) => r.humanSec).sort((a, b) => a - b);
  const median = secs[Math.floor(secs.length / 2)];
  assert.ok(median >= 35 && median <= 90, `median first-timer fight ${median.toFixed(0)}s`);
  assert.ok(secs[0] >= 20, `no tutorial fight shorter than 20 s (min ${secs[0].toFixed(0)}s)`);
  assert.ok(secs[Math.floor(secs.length * 0.8)] <= 120, `80% of tutorial fights fit the 2-minute first-conquest budget (p80 ${secs[Math.floor(secs.length * 0.8)].toFixed(0)}s)`);
  assert.ok(secs[secs.length - 1] <= 180, `and none drags past 3 minutes (max ${secs[secs.length - 1].toFixed(0)}s)`);
});

// The synthetic ladder (armies of every size against every region of a half-owned D1 map, no Generals) is not a campaign state: it
// judges the fitted estimate itself, the RAW label (PLAN-PHASE15). The calibrated card is judged on campaign states (the audit below).
test('labels tell the truth: bot win rate per label lands in its band (small sweep)', () => {
  const rows = sweepRows({
    seeds: [1, 2, 3, 4, 5, 6], own: 'half', regionStride: 2,
    ladder: [-3, 0, 2, 4, 5, 6, 7, 8, 9, 10, 12, 14, 17, 20, 24, 28],
  });
  const by = (label) => rows.filter((r) => r.rawLabel === label);
  const [easy, fair, hard, deadly] = ['Easy', 'Fair', 'Hard', 'Deadly'].map(by);
  for (const [name, set] of [['Easy', easy], ['Fair', fair], ['Hard', hard]]) assert.ok(set.length >= 15, `${name}: only ${set.length} samples`);
  assert.ok(winRate(easy) >= 0.85, `Easy won ${(winRate(easy) * 100).toFixed(0)}% (want >= 85%)`);
  // generous bands: the brief's are Fair 60-85 and Hard 35-60 at n in the thousands
  assert.ok(winRate(fair) >= 0.5 && winRate(fair) <= 0.93, `Fair won ${(winRate(fair) * 100).toFixed(0)}%`);
  assert.ok(winRate(hard) >= 0.25 && winRate(hard) <= 0.72, `Hard won ${(winRate(hard) * 100).toFixed(0)}%`);
  assert.ok(winRate(deadly) < 0.35, `Deadly won ${(winRate(deadly) * 100).toFixed(0)}%`);
  const sure = rows.filter((r) => r.rawRatio >= ECONOMY.surrenderRatio);
  assert.ok(winRate(sure) >= 0.95, `ratio >= ${ECONOMY.surrenderRatio} won ${(winRate(sure) * 100).toFixed(0)}% (a surrender must be a safe bet)`);
  // ordered: a better label never wins less than a worse one
  assert.ok(winRate(easy) > winRate(fair) && winRate(fair) > winRate(hard) && winRate(hard) > winRate(deadly));
});

// Aggressive rivals are judged on campaign states (next test), not here: this ladder sends level-3..24 armies at keeps of every
// depth, and against deep aggressive keeps the bot runs out of patience (config/battle.js PATIENCE_SEC) in a way no campaign ever
// presents (the card only offers them once the army has grown into them).
test('labels stay honest across faction personalities (synthetic ladder: defensive and swarm)', () => {
  const rows = sweepRows({ seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], own: 'half', regionStride: 3, ladder: [3, 5, 7, 9, 11, 14, 17, 20, 24] });
  for (const personality of ['defensive', 'swarm']) {
    const fairish = rows.filter((r) => r.personality === personality && (r.rawLabel === 'Fair' || r.rawLabel === 'Hard'));
    if (fairish.length < 12) continue; // too few samples in this small sweep to judge
    const w = winRate(fairish);
    assert.ok(w >= 0.3 && w <= 0.95, `${personality}: Fair/Hard fights won ${(w * 100).toFixed(0)}%`);
  }
});

test('labels tell the truth in campaign states, per rival personality (campaign bot, seeds 1-12)', () => {
  const rows = [];
  for (let seed = 1; seed <= 12; seed++) rows.push(...runCampaign(seed, {}).battleDurations);
  const wonShare = (xs) => xs.filter((r) => r.won).length / Math.max(1, xs.length);
  let judged = 0;
  for (const personality of ['passive', 'defensive', 'aggressive', 'swarm']) {
    const mine = rows.filter((r) => r.personality === personality);
    const easy = mine.filter((r) => r.label === 'Easy');
    const fair = mine.filter((r) => r.label === 'Fair');
    // the brief's bands are Easy >= 85% and Fair 60-85%; small n, so generous
    if (easy.length >= 20) { judged += 1; assert.ok(wonShare(easy) >= 0.68, `${personality}: Easy fights won ${(100 * wonShare(easy)).toFixed(0)}% of ${easy.length}`); }
    // swarm's ceiling is back at 0.92 (PLAN-PHASE5 §5E): a commander is credited x3 against the swarm (GENERALS.cardCredit.vs), so the
    // fights the campaign picks there now read Easy (tools/swarmcheck.mjs --probe judges every credited label: Fair 71%, Easy 94%, Hard 40%)
    const fairCeil = 0.92;
    if (fair.length >= 20) { judged += 1; assert.ok(wonShare(fair) >= 0.4 && wonShare(fair) <= fairCeil, `${personality}: Fair fights won ${(100 * wonShare(fair)).toFixed(0)}% of ${fair.length}`); }
  }
  assert.ok(judged >= 6, `only ${judged} personality/label cells had enough fights to judge`);
  const easyAll = rows.filter((r) => r.label === 'Easy');
  assert.ok(wonShare(easyAll) >= 0.8, `Easy fights won ${(100 * wonShare(easyAll)).toFixed(0)}% of ${easyAll.length}`);
});

// --- the chance of winning that the card's bar shows (DESIGN §5.3) -------------------------------------------------------------

const BANDS = [ // [label, lowest win chance, highest win chance (exclusive, except Easy's cap)]
  ['Easy', DIFFICULTY.winAtLabelEdge.Easy, DIFFICULTY.winChanceRange[1]],
  ['Fair', DIFFICULTY.winAtLabelEdge.Fair, DIFFICULTY.winAtLabelEdge.Easy],
  ['Hard', DIFFICULTY.winAtLabelEdge.Hard, DIFFICULTY.winAtLabelEdge.Fair],
  ['Deadly', DIFFICULTY.winChanceRange[0], DIFFICULTY.winAtLabelEdge.Hard],
];
const labelAt = (ratio) => (ECONOMY.difficultyLabels.find((l) => ratio >= l.min) || ECONOMY.difficultyLabels[ECONOMY.difficultyLabels.length - 1]).label;

test('winChance: the label bands are Easy >= 0.85, Fair 0.60-0.85, Hard 0.35-0.60, Deadly < 0.35, and winChance agrees at every boundary', () => {
  assert.deepEqual(BANDS.map(([l, lo]) => [l, lo]).slice(0, 3), [['Easy', 0.85], ['Fair', 0.6], ['Hard', 0.35]]);
  for (const [label, lo, hi] of BANDS) {
    const entry = ECONOMY.difficultyLabels.find((l) => l.label === label);
    if (entry.min > 0) {
      // exactly on the label's lower edge: that label, and its lowest chance
      assert.equal(labelAt(entry.min), label);
      assert.ok(winChance(entry.min) >= lo, `${label} edge: ${winChance(entry.min)} < ${lo}`);
      assert.ok(Math.abs(winChance(entry.min) - lo) < 1e-6, `${label}: the chance at its edge is the promised ${lo}`);
      // just under it: the worse label, and strictly under this label's lowest chance
      const under = entry.min * (1 - 1e-6);
      assert.notEqual(labelAt(under), label);
      assert.ok(winChance(under) < lo, `just under the ${label} edge: ${winChance(under)} should be under ${lo}`);
    }
    // a ratio well inside the band sits inside its chance band
    const inside = entry.min > 0 ? entry.min * 1.02 : 0.3;
    assert.equal(labelAt(inside), label);
    assert.ok(winChance(inside) >= lo && winChance(inside) <= hi, `${label}: ${winChance(inside)} outside [${lo}, ${hi}]`);
  }
  // every ratio on a fine grid lands in the band of its own label
  for (let ratio = 0.05; ratio < 6; ratio *= 1.01) {
    const [, lo, hi] = BANDS.find(([l]) => l === labelAt(ratio));
    const p = winChance(ratio);
    assert.ok(p >= lo - 1e-12 && p <= hi + 1e-12, `ratio ${ratio.toFixed(3)} (${labelAt(ratio)}): winChance ${p}`);
  }
});

test('winChance: monotonic, clamped to the configured range, safe on odd input, a surrender is a near-certainty', () => {
  const [floor, ceil] = DIFFICULTY.winChanceRange;
  let prev = -1;
  for (let ratio = 0; ratio < 12; ratio += 0.01) {
    const p = winChance(ratio);
    assert.ok(p >= prev - 1e-12, `not monotonic at ratio ${ratio.toFixed(2)}: ${p} after ${prev}`);
    assert.ok(p >= floor && p <= ceil, `out of range at ratio ${ratio.toFixed(2)}: ${p}`);
    prev = p;
  }
  assert.equal(winChance(0), floor);
  assert.equal(winChance(-3), floor);
  assert.equal(winChance(NaN), floor);
  assert.equal(winChance(undefined), floor);
  assert.equal(winChance(Infinity), ceil);
  assert.equal(winChance(1e9), ceil);
  assert.ok(winChance(ECONOMY.surrenderRatio) >= 0.98, `a surrender (ratio ${ECONOMY.surrenderRatio}) is a near-certainty: ${winChance(ECONOMY.surrenderRatio)}`);
  assert.ok(winChance(0.3) < 0.05, 'a hopeless fight reads hopeless');
});

test('difficulty() returns winChance, consistent with its own label, in real states (seeds 1-6, many decision points)', () => {
  let checked = 0;
  const seen = new Set();
  for (let seed = 1; seed <= 6; seed++) {
    const world = generateWorld(seed);
    const state = createGame(seed, world, 0);
    for (let step = 0; step < 30; step++) {
      const fr = frontier(state, world);
      if (!fr.length) break;
      for (const id of fr) {
        const d = difficulty(state, world, id);
        assert.equal(d.winChance, winChance(d.ratio));
        const [, lo, hi] = BANDS.find(([l]) => l === d.label);
        assert.ok(d.winChance >= lo - 1e-12 && d.winChance <= hi + 1e-12, `seed ${seed} region ${id}: ${d.label} with winChance ${d.winChance}`);
        seen.add(d.label);
        checked += 1;
      }
      state.upgrades = { ...state.upgrades, muster: step * 6 }; // a growing army moves regions through the bands
      const open = attackableFrontier(state, world);
      if (!open.length) break;
      conquer(state, world, open[step % open.length], 0);
    }
  }
  assert.ok(checked > 200 && seen.size >= 3, `${checked} cards over labels ${[...seen]}`);
});

// PLAN-PHASE15: both players the card serves, pooled: the optimal bot (it retreats at its patience and attacks the moment a region reads
// Fair, so it wins its picks about 10 points under the card) and the human policy (it fights on while ahead: about 10 points over)
test('winChance in the fights a campaign picks (bot + human, D1, seeds 1-12): within 12 points of what is achieved, per ratio bin', () => {
  const rows = [];
  for (let seed = 1; seed <= 12; seed++) rows.push(...runCampaign(seed, {}).battleDurations, ...runHumanHour(seed, { whole: true }).battleDurations);
  // the bot only picks fights the card reads Fair or better, so the bins start at the Fair edge
  const bins = [[1.1, 1.3], [1.3, 1.55], [1.55, 2.2], [2.2, Infinity]];
  let judged = 0;
  for (const [lo, hi] of bins) {
    const xs = rows.filter((r) => r.ratio >= lo && r.ratio < hi);
    if (xs.length < 25) continue;
    judged += 1;
    const won = xs.filter((r) => r.won).length / xs.length;
    const said = xs.reduce((s, r) => s + winChance(r.ratio), 0) / xs.length;
    assert.ok(Math.abs(won - said) <= 0.12, `ratio ${lo}-${hi}: the players won ${(100 * won).toFixed(0)}% of ${xs.length}, winChance says ${(100 * said).toFixed(0)}%`);
  }
  assert.ok(judged >= 4, `only ${judged} bins had enough fights`);
});
