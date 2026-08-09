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

import { playOne, startRun, playerTurn, frontDistance } from '../tools/simplayer.js';
import { step } from '../src/battle/sim.js';
import { REGIONS, REGION_IDS } from '../src/content/regions.data.js';
import { SITE_LEVELS, SITE_UPGRADE } from '../src/content/balance.js';

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
const PER_TIER = ['riverfen', 'kaldan', 'karrowmere', 'obsidian', 'nightharrow'];

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
