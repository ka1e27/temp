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
    boosters: [],
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

test('counter-training is a per-tier LADDER, not a switch', () => {
  // `adaptComposition: boolean` became `counterShare: number` because the
  // boolean was the largest single difficulty step in the campaign and it sat
  // on a tier boundary: at n=96, switching it off was worth +17 points of win
  // rate on gallowmoor and +32 on karrowmere. Every dial in
  // content/regions.data.js is required to be non-decreasing, so a step that
  // big at the tier-2/tier-3 boundary is one no region can be tuned past —
  // either tier 2 stays a walkover or tier 3 falls through the harness floor.
  //
  // This is the guard on the shape, not on the values: a share may be re-tuned,
  // but it may not collapse back into "off at 2, fully on at 3".
  for (const t of AI_TIERS) {
    assert.equal(typeof t.counterShare, 'number', 'counterShare must be a share');
    assert.ok(t.counterShare >= 0 && t.counterShare <= 1);
    assert.equal(t.adaptComposition, undefined,
      'the boolean is gone; two fields for one knob is how they drift apart');
  }
  const shares = AI_TIERS.map((t) => t.counterShare);
  for (let i = 1; i < shares.length; i++) {
    assert.ok(shares[i] >= shares[i - 1],
      `tier ${i + 1} counter-trains less than tier ${i}`);
  }
  // A ladder has more than one rung above zero. [0, 0, 1, 1] would pass every
  // assertion above and be exactly the boolean this replaced.
  const rungs = new Set(shares.filter((s) => s > 0));
  assert.ok(rungs.size >= 2,
    `counter-training has ${rungs.size} setting(s) above zero — that is a switch`);
});

/** camp -- pf -- es1..esN -- castle: every wall reachable from both ends. */
function wallMap(walls) {
  const sites = [
    { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 40 }, hp: 600, hpMax: 600 },
    { id: 'pf', kind: 'farm', hex: [3, 0], owner: 'player', garrison: { militia: 2 }, hp: 100, hpMax: 100 },
    { id: 'castle', kind: 'castle', hex: [9, 0], owner: 'enemy', garrison: { militia: 20 }, hp: 600, hpMax: 600 },
  ];
  const adjacency = [['camp', 'pf']];
  for (let i = 0; i < walls; i++) {
    sites.push({
      id: `es${i}`, kind: 'stronghold', hex: [6, i], owner: 'enemy',
      garrison: { militia: 20 }, hp: 250, hpMax: 250, trainType: 'spearmen',
    });
    adjacency.push(['pf', `es${i}`], [`es${i}`, 'castle']);
  }
  return { sites, adjacency };
}

test('the enemy always keeps a spear backbone, at every tier and every wall count', () => {
  // The ram appetite and the counter share are two passes over the SAME
  // strongholds. Filtering the second only on the orders issued THIS think let
  // them claim the same walls twice over: once a stronghold is ALREADY building
  // rams the ram pass issues no order for it, so it stayed in the counter pool
  // and got handed to the counter-pick as well. On a four-wall map that is two
  // for rams and two for the counter — every wall in the region held by def-2
  // rams and def-4 raiders behind no bulwark at all, which is the exact
  // self-disarming `adapt` was rewritten to stop, one layer further down.
  //
  // Four walls up: that is what a tier-3 or tier-4 region actually generates
  // (12-15 enemy sites at MAPGEN.enemyStrongholdShare), and it is the same
  // floor tests/campaign.test.js applies. Below it the deliberate
  // `Math.max(1, ...)` on each pass can legitimately claim the whole map.
  for (let walls = 4; walls <= 8; walls++) {
    for (let tier = 1; tier <= AI_TIERS.length; tier++) {
      const { sites, adjacency } = wallMap(walls);
      // The enemy has to actually own the units: rams for the siege pass and
      // raiders as the answer to the camp's militia. Without the roster both
      // passes return early and the fixture asserts nothing at all.
      const s = build({
        tier, sites, adjacency,
        enemy: { unlockedUnits: ['militia', 'spearmen', 'raiders', 'rams'] },
      });
      // A live enemy siege, so the ram appetite is switched on: that is the
      // pass the counter share has to share the strongholds with.
      s.sites.find((x) => x.id === 'pf').siege = { owner: 'enemy', comp: comp({ militia: 8 }) };
      // The steady state a real battle reaches: the yards it wanted on rams are
      // ALREADY on rams, so this think issues no ram order for them at all.
      const forts = s.sites.filter((x) => x.kind === 'stronghold');
      const wantRams = Math.max(1, Math.round(forts.length * AI.ramTrainShare
        * AI_TIERS[tier - 1].ramAppetite));
      for (const f of forts.slice(forts.length - wantRams)) f.trainType = 'rams';

      think(s);
      const kind = Object.fromEntries(forts.map((f) => [f.id, f.trainType]));
      for (const c of s.commands) if (c.t === 'TRAIN' && kind[c.site]) kind[c.site] = c.unit;
      const spears = Object.values(kind).filter((u) => u === 'spearmen').length;
      assert.ok(spears >= 1,
        `tier ${tier} with ${walls} walls left ${spears} on spearmen`
        + ` (${Object.values(kind).join(',')}) — the enemy disarmed itself`);
    }
  }
});

test('a counter-pick the player has stopped fielding is walked back', () => {
  // `retrain` only ever walks back the ONE unit it was asked about, so when the
  // player switches army the previous answer is orphaned and that yard keeps
  // building it for the rest of the battle. Measured on obsidian: two captured
  // forts sat on militia long after the spearmen they answered were gone, and
  // between them and the ram appetite the region had no spearwall left at all.
  const { sites, adjacency } = wallMap(4);
  const s = build({
    tier: 4, sites, adjacency,
    enemy: { unlockedUnits: ['militia', 'spearmen', 'raiders', 'rams'] },
  });
  // Every wall is already answering a SPEARWALL (counterPick.spearmen is
  // militia) — a long earlier phase of the battle, plus captured neutral forts
  // that were converted while they were still the enemy's answer. This is the
  // shape the real obsidian battle reaches, and it is more than the counter
  // quota, which is what leaves orphans behind when the pick changes.
  const walls = () => s.sites.filter((x) => x.kind === 'stronghold');
  for (const w of walls()) w.trainType = 'militia';

  // Now the player is all militia; the answer to that is raiders, and the
  // militia yards are a dead counter. Give it long enough for the exponential
  // sample to actually turn over.
  s.sites.find((x) => x.id === 'camp').garrison = comp({ militia: 60 });
  for (let pass = 0; pass < 8; pass++) {
    for (const c of rethink(s)) {
      if (c.t !== 'TRAIN') continue;
      const site = s.sites.find((x) => x.id === c.site);
      if (site) site.trainType = c.unit;
    }
    s.tick += 1;
  }
  assert.equal(walls().filter((x) => x.trainType === AI.counterPick.spearmen).length, 0,
    `a wall is still building ${AI.counterPick.spearmen} against an army of militia`
    + ` (${walls().map((x) => x.trainType).join(',')})`);
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
