// THE MEASURING INSTRUMENT ITSELF.
//
// tools/simplayer.js is not a test fixture, it is the bot every balance number
// in this project is taken with. So anything it silently fails to do is not a
// gap in a test — it is a systematic bias baked into content/balance.js and
// content/regions.data.js, and no amount of green suite will show it.
//
// It happened. The bot issued no `UPGRADE` command at all, so `SITE_LEVELS` and
// every one of the four `SITE_UPGRADE` steps were unexercised by every
// measurement ever taken here, while the enemy got the same ladder for free at
// mapgen via each region's `develop`. Levelling was tuned IN for the defender
// and tuned OUT for the attacker. Nothing failed, because nothing asked.
//
// So this file asks. Every assertion below is about the BOT'S BEHAVIOUR in a
// real battle — never a hand-built fixture, which is the failure mode
// CLAUDE.md warns about: a fixture that encodes the bug passes forever.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  playOne, startRun, playerTurn, frontDistance, advanceDistance, PRIORITY,
} from '../tools/simplayer.js';
import { step } from '../src/battle/sim.js';
import { distance as hexDistance } from '../src/core/hex.js';
import { REGIONS, REGION_IDS } from '../src/content/regions.data.js';
import { SITE_LEVELS, SITE_UPGRADE, SITES } from '../src/content/balance.js';

const before = (id) => REGION_IDS.slice(0, REGIONS.findIndex((r) => r.id === id));

/** One battle, recording every upgrade the bot buys and the board it bought it
 *  on. Reads `commands` straight after the think, which is the queue the sim is
 *  about to drain — so this observes the real order, not a re-derivation. */
function instrumented(regionId, seed, opts = {}) {
  const battle = startRun(regionId, seed, before(regionId), 10);
  const bought = [];
  let nextThink = 0;
  while (battle.status === 'running' && battle.tick < battle.rules.hardCapTicks) {
    if (battle.tick >= nextThink) {
      playerTurn(battle, opts);
      const front = frontDistance(battle);
      for (const c of battle.commands) {
        if (c.t !== 'UPGRADE') continue;
        const site = battle.sites.find((s) => s.id === c.site);
        bought.push({ id: c.site, kind: site.kind, from: site.level, front: front[c.site] });
      }
      nextThink = battle.tick + 20;
    }
    step(battle);
  }
  return { battle, bought };
}

// One region per tier: the gap was measured at +6 points in tier 2 and +38 in
// tier 4, so "the bot upgrades" has to be true at the END of the campaign too,
// not just where gold is easy.
const PER_TIER = ['riverfen', 'kaldan', 'karrowmere', 'obsidian', 'nightharrow', 'widowsgate'];

test('harness: the scripted player actually exercises the site-upgrade ladder', () => {
  // Behavioural, not a grep. The original investigation confirmed the gap by
  // instrumenting battles and finding level 1 in 32 of 32 runs; this is that
  // check, kept.
  for (const id of PER_TIER) {
    const tops = [1, 2, 3, 4].map((k) => playOne(id, 1000 + k * 7919, before(id), 10).topLevel);
    assert.ok(Math.max(...tops) > 1,
      `${id}: the bot finished four battles without buying a single site upgrade`
      + ` (best level reached: ${Math.max(...tops)}). Every balance number measured`
      + ' with it is therefore against a player who ignores the mechanic.');
  }
});

test('harness: it builds behind the line, never on it', () => {
  // Rule 1 of the policy. A site with `frontDistance` 0 borders something the
  // player does not hold; sinking 400 gold into it is not what an ordinary
  // player does, and a bot that did would measure the ladder as worth less
  // than it is.
  for (const id of ['kaldan', 'karrowmere']) {
    const { bought } = instrumented(id, 24601);
    assert.ok(bought.length > 0, `${id}: nothing bought, so nothing was measured`);
    for (const b of bought) {
      assert.notEqual(b.front, 0,
        `${id}: upgraded ${b.id} (${b.kind}) while it was on the front line`);
    }
  }
});

test('harness: it stops short of the top step — ordinary play, not optimal play', () => {
  // Rule 5, and the single clearest line between the two. L4 -> L5 costs 2200
  // gold and 65 seconds; max-levelling every safe site is how a solver plays,
  // and pricing the campaign against a solver is how you ship an endgame no
  // human can clear. If this cap is ever lifted, the whole table moves and the
  // change must be deliberate rather than incidental.
  const top = SITE_LEVELS.length;              // 5 rungs...
  const lastStep = SITE_UPGRADE.length;        // ...bought by 4 steps
  for (const id of ['kaldan', 'obsidian']) {
    const { battle, bought } = instrumented(id, 31337);
    for (const b of bought) {
      assert.ok(b.from < lastStep,
        `${id}: bought the top step on ${b.id} (L${b.from} -> L${b.from + 1})`);
    }
    for (const s of battle.sites) {
      if (s.owner !== 'player') continue;
      assert.ok(s.level < top,
        `${id}: ${s.id} reached L${s.level}, the top of the ladder`);
    }
  }
});

test('harness: --noupgrades really is the bot the old numbers were taken with', () => {
  // The delta is only worth recording if it stays re-measurable. This is the
  // guard on that escape hatch: `upgrades: false` has to be the OLD bot exactly,
  // or the comparison in CLAUDE.md quietly stops meaning anything.
  const { battle, bought } = instrumented('karrowmere', 24601, { upgrades: false });
  assert.equal(bought.length, 0, 'the opt-out still issued UPGRADE commands');
  for (const s of battle.sites) {
    if (s.owner === 'player') {
      assert.equal(s.level, 1, `${s.id} was levelled with upgrades switched off`);
    }
  }
});

test('harness: the enemy is deliberately NOT given the same button', () => {
  // A documented asymmetry, pinned so it cannot be "fixed" by accident. The
  // enemy already receives this exact ladder for free at mapgen through
  // `develop`, which is tuned into every region's difficulty. Teaching ai.js to
  // buy upgrades as well would double-count the same mechanic and silently
  // re-tune all twenty-one regions at once. If that is ever the intent, it is a
  // balance pass, not a bug fix — and this assertion is where it starts.
  // WATCHED THROUGHOUT, not sampled at the end. This read the final board, which
  // only works while the enemy survives to be read — and a clean win leaves none
  // standing, so the assertion quietly became "the battle ended" instead of
  // "the AI never built". It now records every enemy site that was ever mid-
  // upgrade, and separately proves the run was worth watching.
  const battle = startRun('obsidian', 31337, before('obsidian'), 10);
  let nextThink = 0;
  const built = new Set();
  let sawEnemy = 0;
  while (battle.status === 'running' && battle.tick < battle.rules.hardCapTicks) {
    if (battle.tick >= nextThink) { playerTurn(battle); nextThink = battle.tick + 20; }
    step(battle);
    const enemy = battle.sites.filter((s) => s.owner === 'enemy');
    sawEnemy = Math.max(sawEnemy, enemy.length);
    for (const s of enemy) if (s.upgradeTicksLeft > 0) built.add(s.id);
  }
  assert.ok(sawEnemy > 0, 'no enemy site existed at any point — the run proves nothing');
  assert.equal(built.size, 0,
    `enemy site(s) ${[...built].join(', ')} were mid-upgrade — the AI has learned to build`);
});

// ---------------------------------------------------------------------------
// Free movement removed two bounds the authored site graph used to supply by
// accident, and both showed up as the bot quietly declining to play the game.
// Neither failed anything: it took ground, it just took the wrong ground and
// never massed enough anywhere to finish.
// ---------------------------------------------------------------------------

/**
 * Drive one battle for `ticks`, recording every order the bot issued alongside
 * the board it issued it on.
 *
 * MID-BATTLE ON PURPOSE. The assertions below are about an army that is
 * fighting, and the end of a battle has none: a win leaves nothing to advance on
 * and a loss leaves the camp holding nine men. Three minutes in, the bot has
 * converted its beachhead and is pressing whatever the region's dial says — so
 * these stay true across a re-tune instead of quietly becoming assertions about
 * the balance table.
 */
function midBattle(id, seed, ticks = 1800) {
  const battle = startRun(id, seed, before(id), 10);
  let nextThink = 0;
  const column = [];   // every send from one player site to another
  while (battle.status === 'running' && battle.tick < ticks) {
    if (battle.tick >= nextThink) {
      playerTurn(battle);
      const adv = advanceDistance(battle);
      for (const c of battle.commands) {
        if (c.t !== 'SEND' || c.by) continue;
        const to = battle.sites.find((s) => s.id === c.to);
        if (to?.owner !== 'player') continue;   // an assault, not the column
        column.push({ tick: battle.tick, from: c.from, to: c.to, at: adv[c.from], onto: adv[c.to] });
      }
      nextThink = battle.tick + 20;
    }
    step(battle);
  }
  return { battle, column };
}

test('harness: the rear column marches TOWARD THE THRONE, every time', () => {
  // `advanceDistance` is a global gradient with one sink, and the sink is the
  // win condition. Before it, the column pushed toward a lower `frontDistance`
  // and picked the EMPTIEST forward neighbour — a load-balancer, which is right
  // across two or three graph neighbours and catastrophic across eight hexes'
  // worth. Measured on gallowmoor with the enemy AI switched off entirely, the
  // bot finished holding nineteen sites, a 128-man army, no pile bigger than 19,
  // and a castle two hexes away it had never once attacked. Seven of its sites
  // scored an identical `frontDistance`, so "forward" pointed nowhere.
  //
  // Asserted on the ORDERS rather than on where the troops ended up. The board
  // is the sum of the bot's orders and the enemy's, and a statistical claim
  // about the resulting distribution turned out not to survive contact: on
  // karrowmere the army's centre of mass sits BEHIND the mean of the ground it
  // holds at three minutes and ahead of it at six. What the code actually
  // guarantees is the direction of each send, and that is what is pinned.
  for (const id of ['gallowmoor', 'karrowmere', 'obsidian', 'widowsgate']) {
    const { column } = midBattle(id, 1000);
    assert.ok(column.length > 0,
      `${id}: the bot never once moved troops between its own sites — the column is dead code`);
    for (const c of column) {
      assert.ok(c.onto < c.at,
        `${id}: t${c.tick} sent ${c.from} (${c.at} hexes from the throne) -> ${c.to} `
        + `(${c.onto}) — the column moved the army sideways or backwards`);
    }
  }
});

test('harness: advanceDistance measures the throne, and only for sites you hold', () => {
  // The negative control for the test above, and it needs one: "every send went
  // to a lower number" is trivially true if `advanceDistance` is measuring
  // something the sends already correlate with, or if it returns a constant.
  const { battle } = midBattle('gallowmoor', 1000, 600);
  const adv = advanceDistance(battle);
  const castle = battle.sites.find((s) => s.kind === 'castle');
  for (const s of battle.sites) {
    if (s.owner !== 'player') {
      assert.equal(adv[s.id], undefined, `${s.id} is not held, so it has no advance distance`);
      continue;
    }
    assert.equal(adv[s.id], hexDistance(
      { q: s.hex[0], r: s.hex[1] }, { q: castle.hex[0], r: castle.hex[1] },
    ), `${s.id}: advanceDistance disagrees with the hex distance to the throne`);
  }
  const vals = Object.values(adv);
  assert.ok(new Set(vals).size > 1,
    'every held site scored the same — a constant is not a gradient and the column '
    + 'would have nowhere to march');
});

test('harness: it never trades its production away for more farmland', () => {
  // Farms have `train: 0`. Every soldier comes out of a camp, a castle or a
  // training ground, so an economy with nothing to spend on is not an economy —
  // and an absolute "farms first" order at hex reach means there is ALWAYS
  // another farm and the bot never takes a yard. Measured on gallowmoor with the
  // AI off: thirteen farms, two training sites, 17,000 unspent gold, a 15
  // gold/second training bill and a 72-man army, against a pre-reach bot that
  // held six trainers, ran its treasury at zero and fielded 979.
  //
  // WHAT THIS CAN CLAIM TODAY IS DELIBERATELY THE WEAKER HALF, and the reason is
  // worth writing down rather than tuning around. Since the yard/wall split the
  // enemy's training grounds all sit in the ring around its throne, so there are
  // five or six on a whole map and the player lands nowhere near any of them:
  // measured on karrowmere, the bot holds the two it landed with for eight
  // minutes and reaches three at ten. "It should hold several" is therefore a
  // claim about a game that is not finished — in-battle construction is what
  // closes it, because you are meant to BUILD yards rather than only capture
  // them. When that lands, this test should get its teeth back.
  //
  // What it still catches is the original bug exactly: a bot that spends its
  // army on farmland loses the yards it landed with and never replaces them.
  const isTrainer = (s) => SITES[s.kind].train > 0;
  let gained = 0;
  for (const id of ['gallowmoor', 'karrowmere', 'obsidian']) {
    const opening = startRun(id, 1000, before(id), 10);
    const landed = opening.sites.filter((s) => s.owner === 'player' && isTrainer(s)).length;
    assert.ok(landed >= 1, `${id}: the landing itself has no production — mapgen is wrong`);

    const { battle } = midBattle(id, 1000, 3600);
    const mine = battle.sites.filter((s) => s.owner === 'player');
    const held = mine.filter(isTrainer).length;
    assert.ok(held >= landed,
      `${id}: landed holding ${landed} training site(s) and is down to ${held} six minutes `
      + `in, across ${mine.length} sites — it is spending its army on farmland`);
    if (held > landed) gained++;
  }
  assert.ok(gained > 0,
    'not one of the sampled regions saw the bot capture a single training ground — '
    + 'it is ignoring production entirely, not merely finding it scarce');
});

test('harness: the build order prefers production, and that is the whole rule', () => {
  // The negative control. `PRIORITY` is plain data, so a behavioural test that
  // the bot ends up holding yards proves nothing if the table quietly went back
  // to ranking farms first — which is exactly how a dead filter passes an
  // inertness test (see tools/simtactics.js).
  //
  // THE YARD, not the wall. Until the site kinds split those were one building,
  // so "prefer the fort" and "prefer the thing that makes soldiers" were the
  // same sentence; they are not any more, and a stronghold trains nothing.
  assert.ok(PRIORITY.trainingGround < PRIORITY.farm,
    'the yard must outrank the field, or every measured number here describes a farm belt');
  assert.ok(PRIORITY.trainingGround < PRIORITY.stronghold,
    'production before ground: a wall you can come back for, an army you cannot');
  assert.ok(PRIORITY.stronghold < PRIORITY.farm,
    'the wall between you and the throne still outranks another farm');
  // The castle stays ahead of all of them — `playerTurn` subtracts a flat bonus
  // for it — and your own camp is never a target.
  assert.ok(PRIORITY.camp > PRIORITY.farm && PRIORITY.camp > PRIORITY.stronghold,
    'your own camp is never a target worth ranking above the enemy country');
});
