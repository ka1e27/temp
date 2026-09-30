// The difficulty label must tell the truth (docs/briefs/balance.md §3, DESIGN §5.3): small-n,
// generous-tolerance versions of what tools/balance.mjs measures with thousands of battles.
// Also pins the tutorial rules: surrender only after a first win, the first ring reads Easy but
// sits below the surrender ratio, and a first-timer's opening fight lasts about a minute.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/generate.js';
import { createGame } from '../meta/state.js';
import { difficulty, frontier } from '../meta/progression.js';
import { ECONOMY } from '../config/meta.js';
import { sweepRows, tutorialRows } from '../../tools/balance.mjs';

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

test('first ring at game start: Easy, clearly below the surrender ratio (seeds 1-12)', () => {
  let easyPick = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const world = generateWorld(seed);
    const state = createGame(seed, world, 0);
    const ring = frontier(state, world).map((id) => ({ id, d: difficulty(state, world, id) }));
    for (const { id, d } of ring) {
      assert.ok(d.ratio < ECONOMY.surrenderRatio, `seed ${seed} ${world.regions[id].name}: ratio ${d.ratio.toFixed(2)} reaches the surrender line`);
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

test('labels tell the truth: bot win rate per label lands in its band (small sweep)', () => {
  const rows = sweepRows({
    seeds: [1, 2, 3, 4, 5, 6], own: 'half', regionStride: 2,
    ladder: [-3, 0, 2, 4, 5, 6, 7, 8, 9, 10, 12, 14, 17, 20, 24, 28],
  });
  const by = (label) => rows.filter((r) => r.label === label);
  const [easy, fair, hard, deadly] = ['Easy', 'Fair', 'Hard', 'Deadly'].map(by);
  for (const [name, set] of [['Easy', easy], ['Fair', fair], ['Hard', hard]]) assert.ok(set.length >= 15, `${name}: only ${set.length} samples`);
  assert.ok(winRate(easy) >= 0.85, `Easy won ${(winRate(easy) * 100).toFixed(0)}% (want >= 85%)`);
  // generous bands: the brief's are Fair 60-85 and Hard 35-60 at n in the thousands
  assert.ok(winRate(fair) >= 0.5 && winRate(fair) <= 0.93, `Fair won ${(winRate(fair) * 100).toFixed(0)}%`);
  assert.ok(winRate(hard) >= 0.25 && winRate(hard) <= 0.72, `Hard won ${(winRate(hard) * 100).toFixed(0)}%`);
  assert.ok(winRate(deadly) < 0.35, `Deadly won ${(winRate(deadly) * 100).toFixed(0)}%`);
  const sure = rows.filter((r) => r.ratio >= ECONOMY.surrenderRatio);
  assert.ok(winRate(sure) >= 0.95, `ratio >= ${ECONOMY.surrenderRatio} won ${(winRate(sure) * 100).toFixed(0)}% (a surrender must be a safe bet)`);
  // ordered: a better label never wins less than a worse one
  assert.ok(winRate(easy) > winRate(fair) && winRate(fair) > winRate(hard) && winRate(hard) > winRate(deadly));
});

test('labels stay honest across faction personalities', () => {
  const rows = sweepRows({ seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], own: 'half', regionStride: 3, ladder: [3, 5, 7, 9, 11, 14, 17, 20, 24] });
  for (const personality of ['aggressive', 'defensive', 'swarm']) {
    const fairish = rows.filter((r) => r.personality === personality && (r.label === 'Fair' || r.label === 'Hard'));
    if (fairish.length < 12) continue; // too few samples in this small sweep to judge
    const w = winRate(fairish);
    assert.ok(w >= 0.3 && w <= 0.95, `${personality}: Fair/Hard fights won ${(w * 100).toFixed(0)}%`);
  }
});
