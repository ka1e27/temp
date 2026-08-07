import test from 'node:test';
import assert from 'node:assert/strict';
import { think } from '../src/battle/ai.js';
import { startBattle, step } from '../src/battle/sim.js';
import { makeMods, CONTRACT_VERSION, assertBattleConfig } from '../src/battle/contract.js';
import { emptyComp, total } from '../src/battle/combat.js';
import { AI_TIERS, AI } from '../src/content/balance.js';

const comp = (o) => ({ ...emptyComp(), ...o });
const NO_EXPEDITION = emptyComp();
let n = 0;

/**
 *   camp -- pf -- es -- castle          pf is also reachable from es2, which
 *            \                          sits further away: any wave onto pf
 *             es2                       must therefore synchronize.
 */
const MAP = [
  { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 20 }, hp: 600, hpMax: 600 },
  { id: 'pf', kind: 'farm', hex: [3, 0], owner: 'player', garrison: { militia: 2 }, hp: 100, hpMax: 100 },
  { id: 'es', kind: 'stronghold', hex: [6, 0], owner: 'enemy', garrison: { militia: 20 }, hp: 250, hpMax: 250, trainType: 'spearmen' },
  { id: 'es2', kind: 'stronghold', hex: [1, 5], owner: 'enemy', garrison: { militia: 20 }, hp: 250, hpMax: 250, trainType: 'spearmen' },
  { id: 'castle', kind: 'castle', hex: [9, 0], owner: 'enemy', garrison: { militia: 20 }, hp: 600, hpMax: 600 },
];

function build(over = {}) {
  const state = startBattle(assertBattleConfig({
    contractVersion: CONTRACT_VERSION,
    battleId: `ai-${n++}`,
    seed: over.seed ?? 99,
    region: { id: 'test', name: 'Test', tier: 1 },
    grid: { cols: 11, rows: 9, blocked: [] },
    sites: (over.sites ?? MAP).map((s) => ({ ...s })),
    adjacency: over.adjacency
      ?? [['camp', 'pf'], ['pf', 'es'], ['pf', 'es2'], ['es', 'castle'], ['es2', 'castle']],
    player: makeMods({ startGold: 300, expedition: NO_EXPEDITION, ...(over.player ?? {}) }),
    enemy: makeMods({ startGold: 300, expedition: NO_EXPEDITION, ...(over.enemy ?? {}) }),
    boosters: {},
    rules: { victory: 'capture-castle', hardCapMs: 480000, aiTier: over.tier ?? 1 },
  }));
  return state;
}

const at = (s, id) => s.sites.find((x) => x.id === id);
const sends = (s, to) => s.commands.filter((c) => c.t === 'SEND' && (!to || c.to === to));

/** Fire the AI again immediately, however long its reaction time is. */
function rethink(s) {
  s.ai.nextThinkTick = s.tick;
  s.commands = [];
  think(s);
  return s.commands;
}

test('the AI pushes orders and never mutates the world directly', () => {
  const s = build();
  const snapshot = JSON.stringify({
    sites: s.sites, squads: s.squads, factions: s.factions,
    influence: s.influence, boosters: s.boosters, meta: s.meta, tick: s.tick,
  });
  think(s);
  assert.ok(s.commands.length > 0, 'it should have something to say');
  assert.equal(JSON.stringify({
    sites: s.sites, squads: s.squads, factions: s.factions,
    influence: s.influence, boosters: s.boosters, meta: s.meta, tick: s.tick,
  }), snapshot, 'the AI may only touch state.ai, state.rngState and state.commands');

  for (const c of s.commands) {
    assert.equal(c.by, 'enemy', 'it cannot issue orders as the player');
    assert.ok(['SEND', 'TRAIN', 'RETREAT', 'RETREAT_SQUAD', 'RALLY', 'UPGRADE'].includes(c.t));
  }
});

test('the free-lunch check punishes an undefended site at EVERY tier', () => {
  for (let tier = 1; tier <= AI_TIERS.length; tier++) {
    const s = build({ tier });
    think(s);
    const grab = sends(s, 'pf');
    assert.ok(grab.length > 0, `tier ${tier} left a farm on 2 militia alone`);
    assert.ok(grab.every((c) => c.fraction > 0 && c.fraction <= 1));
  }
});

test('a wave shares ONE arriveTick — the AI always strikes synchronized', () => {
  const s = build({ tier: 4 });
  think(s);
  const wave = sends(s, 'pf');
  assert.ok(wave.length >= 2, 'both neighbours should join in');
  assert.equal(new Set(wave.map((c) => c.arriveTick)).size, 1, 'one arrival tick for the wave');

  step(s); // orders execute
  const squads = s.squads.filter((sq) => sq.to === 'pf');
  assert.equal(squads.length, wave.length);
  assert.equal(new Set(squads.map((sq) => sq.arriveTick)).size, 1);
  const natural = squads.map((sq) => sq.arriveTick - sq.spawnTick);
  assert.notEqual(Math.min(...natural), 0);
  // The far squad sets the pace; the near one is held back, never sped up.
  assert.ok(squads.every((sq) => sq.arriveTick >= sq.spawnTick + 1));
});

test('it will not attack what it cannot beat, and never strips the castle bare', () => {
  const s = build({
    sites: MAP.map((x) => (x.id === 'pf' ? { ...x, garrison: { spearmen: 30 } } : { ...x })),
    tier: 4,
  });
  think(s);
  assert.equal(sends(s, 'pf').length, 0, 'a spearwall is not a free lunch');
  const fromCastle = sends(s).filter((c) => c.from === 'castle');
  for (const c of fromCastle) {
    assert.ok(c.fraction < 1, 'the castle is never emptied');
  }
});

test('it reinforces a threatened castle before anything else', () => {
  const s = build({ tier: 3 });
  at(s, 'pf').garrison = comp({ militia: 40 });
  s.squads.push({
    id: 999, owner: 'player', from: 'pf', to: 'castle', comp: comp({ militia: 40 }),
    spawnTick: 0, arriveTick: 30, retreating: false,
  });
  const cmds = rethink(s);
  const help = cmds.filter((c) => c.t === 'SEND' && c.to === 'castle');
  assert.ok(help.length > 0, 'a 40-strong stack inbound must be answered');
});

test('retreat discipline is what separates tier 1 from tier 4', () => {
  const count = (tier) => {
    const s = build({ tier });
    at(s, 'pf').siege = { owner: 'enemy', comp: comp({ militia: 2 }) }; // can never breach
    let retreats = 0;
    for (let i = 0; i < 60; i++) {
      const cmds = rethink(s);
      retreats += cmds.filter((c) => c.t === 'RETREAT' && c.site === 'pf').length;
      s.tick += 1;
    }
    return retreats;
  };
  const t1 = count(1);
  const t4 = count(4);
  assert.ok(t1 < t4, `T1 ${t1} should feed you its army, T4 ${t4} should not`);
  assert.ok(t1 <= 60 * AI_TIERS[0].retreatDiscipline * 3, `T1 retreated ${t1}/60 times`);
  assert.ok(t4 >= 60 * AI_TIERS[3].retreatDiscipline * 0.7, `T4 retreated only ${t4}/60 times`);
});

test('counter-training is OFF at tiers 1-2 and ON at 3-4', () => {
  const spearHeavy = MAP.map((x) => (x.id === 'camp'
    ? { ...x, garrison: { spearmen: 30 } } : { ...x }));
  for (const tier of [1, 2]) {
    const s = build({ tier, sites: spearHeavy });
    think(s);
    assert.equal(s.commands.filter((c) => c.t === 'TRAIN').length, 0,
      `tier ${tier} must never answer your counter`);
  }
  for (const tier of [3, 4]) {
    const s = build({ tier, sites: spearHeavy });
    think(s);
    const trains = s.commands.filter((c) => c.t === 'TRAIN');
    assert.ok(trains.length > 0, `tier ${tier} should adapt`);
    assert.ok(trains.every((c) => c.unit === AI.counterPick.spearmen),
      'militia is the answer to a spearwall');
    assert.ok(total(s.ai.seenPlayerComp) > 0, 'it samples what it saw');
  }
});

test('thinking is jittered, bounded, and deterministic', () => {
  const s = build({ tier: 2 });
  const knobs = AI_TIERS[1];
  const gaps = [];
  for (let i = 0; i < 20; i++) {
    s.ai.nextThinkTick = s.tick;
    think(s);
    gaps.push(s.ai.nextThinkTick - s.tick);
    s.tick = s.ai.nextThinkTick;
    s.commands = [];
  }
  assert.ok(Math.min(...gaps) >= Math.floor(knobs.reactionTicks * (1 - AI.thinkJitter)));
  assert.ok(Math.max(...gaps) <= Math.ceil(knobs.reactionTicks * (1 + AI.thinkJitter)));
  assert.ok(new Set(gaps).size > 1, 'it must never feel metronomic');

  const a = build({ tier: 2 });
  const b = build({ tier: 2 });
  think(a);
  think(b);
  assert.deepEqual(a.commands, b.commands, 'same state + same seed = same orders');
  assert.equal(a.rngState, b.rngState);
  assert.notEqual(a.rngState, a.seed, 'the rng state is written back');
});

test('it holds its fire until its reaction time has elapsed', () => {
  const s = build({ tier: 1 });
  think(s);
  const first = s.commands.length;
  s.commands = [];
  think(s);
  assert.equal(s.commands.length, 0, 'no thinking twice in the same window');
  assert.ok(first > 0);
  assert.ok(s.ai.nextThinkTick >= AI_TIERS[0].reactionTicks * (1 - AI.thinkJitter));
});

test('the AI plays a full battle through the ordinary order channel', () => {
  const s = build({ tier: 3 });
  for (let i = 0; i < 1500 && s.status === 'running'; i++) step(s);
  assert.ok(s.factions.enemy.unitsKilled + s.factions.enemy.unitsLost > 0,
    'a tier 3 AI that never fought anything is a punching bag');
  assert.ok(s.ai.nextThinkTick > 0);
});
