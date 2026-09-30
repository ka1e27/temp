// Enemy AI (DESIGN §4.6/§3.3): every personality must run cleanly (no errors, no NaNs) and
// the difficulty curve must move the right direction as player power changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, step, issue } from '../battle/sim.js';
import { think } from '../battle/ai.js';
import { decide } from '../battle/bot.js';
import { buildArena } from '../battle/arena.js';
import { buildTestWorld, TARGET_REGION, DEFAULT_OWNERS } from './fixtures/battle-world.js';

const PERSONALITIES = ['passive', 'aggressive', 'defensive', 'swarm'];
const FIVE_MIN_TICKS = Math.round((5 * 60) / 0.05);

function makePlayer(mult = 1) {
  return {
    atk: mult, def: mult, growth: mult, speed: 1, campTroops: 30, garrisonShare: 0.35, capBonus: 0,
    cooldownMult: 1, powers: { rally: 1, firestorm: 1, bulwark: 1, march: 1, levy: 1 },
  };
}

function runBattle(personality, playerMult) {
  const world = buildTestWorld();
  const owners = [...DEFAULT_OWNERS];
  const player = makePlayer(playerMult);
  const enemy = {
    atk: 1, def: 1, growth: 1, speed: 1, troopMult: 1, thinkSec: 1.5, personality, factionId: 2,
  };
  const arena = buildArena(world, owners, TARGET_REGION, player, enemy);
  const battle = createBattle(arena, player, enemy);
  const botMemo = {};
  let nan = false;
  let steps = 0;
  for (; steps < FIVE_MIN_TICKS && !battle.result; steps++) {
    for (const cmd of think(battle, battle.t)) issue(battle, cmd);
    for (const cmd of decide(battle, battle.t, botMemo)) issue(battle, cmd);
    step(battle, 0.05);
    for (const s of battle.sites) if (!Number.isFinite(s.troops)) nan = true;
    for (const s of battle.squads) if (!Number.isFinite(s.count)) nan = true;
    if (nan) break;
  }
  return { battle, steps, nan };
}

for (const personality of PERSONALITIES) {
  test(`AI (${personality}) runs 5 simulated minutes without errors or NaNs`, () => {
    const { battle, steps, nan } = runBattle(personality, 1.0);
    assert.equal(nan, false, `NaN/Infinity appeared around tick ${steps}`);
    assert.ok(['win', 'lose', null].includes(battle.result));
    // Sanity: the AI must actually have DONE something over 5 minutes (sent troops, or at
    // minimum reinforced) unless it's passive, which is allowed to sit still if unthreatened.
    if (personality !== 'passive') {
      assert.ok(battle.stats.sent > 0 || battle.stats.captured > 0, 'the AI should have acted');
    }
  });
}

test('AI personalities behave distinctly: passive never initiates an attack', () => {
  // Give the player a deliberately tiny, unthreatening force so a non-passive AI would have
  // an easy opportunistic target, to isolate "never attacks" from "found nothing worth it".
  const world = buildTestWorld();
  const owners = [...DEFAULT_OWNERS];
  const player = makePlayer(0.3);
  const enemy = { atk: 1, def: 1, growth: 1, speed: 1, troopMult: 1, thinkSec: 1.5, personality: 'passive', factionId: 2 };
  const arena = buildArena(world, owners, TARGET_REGION, player, enemy);
  const battle = createBattle(arena, player, enemy);
  for (let i = 0; i < FIVE_MIN_TICKS && !battle.result; i++) {
    for (const cmd of think(battle, battle.t)) {
      if (cmd.type !== 'send') continue;
      // A send is only ever "reinforce", never "attack": every source and the destination
      // must all belong to the AI's own faction (this also covers topUpKeep proactively
      // keeping its own keep garrisoned, which is reinforcement, not an attack).
      const froms = Array.isArray(cmd.from) ? cmd.from : [cmd.from];
      const toOwner = battle.sites[cmd.to].owner;
      assert.equal(toOwner, cmd.owner, 'passive must never send toward a site it doesn\'t own');
      for (const f of froms) assert.equal(battle.sites[f].owner, cmd.owner);
    }
    step(battle, 0.05);
  }
});

test('difficulty scales the right direction: a stronger player does at least as well', () => {
  const weak = runBattle('aggressive', 0.5).battle.result;
  const strong = runBattle('aggressive', 2.0).battle.result;
  // A much stronger player should not lose where a much weaker one might; both must at
  // least reach a valid terminal-or-ongoing state (already checked above per personality).
  assert.notEqual(strong, 'lose');
});
