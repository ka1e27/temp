// Economy and training: the gold clock behind every soldier.
// Owned by the battle engine, alongside src/battle/{economy,training}.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startBattle, step } from '../src/battle/sim.js';
import { assertBattleConfig, makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { emptyComp, total } from '../src/battle/combat.js';
import { garrisonCap } from '../src/battle/training.js';
import { SITES } from '../src/content/balance.js';

const comp = (o) => ({ ...emptyComp(), ...o });
const NO_EXPEDITION = emptyComp();
let n = 0;

const LINE = [
  { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 20 }, hp: 600, hpMax: 600 },
  { id: 'f1', kind: 'farm', hex: [3, 0], owner: 'neutral', garrison: { militia: 2 }, hp: 100, hpMax: 100 },
  { id: 'sh', kind: 'stronghold', hex: [6, 0], owner: 'enemy', garrison: { militia: 6 }, hp: 250, hpMax: 250 },
  { id: 'castle', kind: 'castle', hex: [9, 0], owner: 'enemy', garrison: { militia: 8 }, hp: 600, hpMax: 600 },
];

function build(over = {}) {
  const cfg = assertBattleConfig({
    contractVersion: CONTRACT_VERSION,
    battleId: `econ-${n++}`,
    seed: 11,
    region: { id: 'test', name: 'Test', tier: 1 },
    grid: { cols: 11, rows: 9, blocked: [] },
    sites: (over.sites ?? LINE).map((s) => ({ ...s })),
    adjacency: over.adjacency ?? [['camp', 'f1'], ['f1', 'sh'], ['sh', 'castle']],
    player: makeMods({ startGold: 300, expedition: NO_EXPEDITION, ...(over.player ?? {}) }),
    enemy: makeMods({ startGold: 200, expedition: NO_EXPEDITION, ...(over.enemy ?? {}) }),
    boosters: over.boosters ?? [],
    rules: { victory: 'capture-castle', hardCapMs: 480000, aiTier: 1, ...(over.rules ?? {}) },
  });
  const state = startBattle(cfg);
  if (over.quiet !== false) state.ai.nextThinkTick = 1e9; // silence the AI for focused tests
  return state;
}

const at = (s, id) => s.sites.find((x) => x.id === id);
const stepN = (s, k) => { for (let i = 0; i < k; i++) step(s); return s; };
const runUntil = (s, pred, max = 4000) => {
  let i = 0;
  while (!pred(s) && i < max && s.status === 'running') { step(s); i++; }
  return s;
};

// --- the tick ---------------------------------------------------------------

test('a tick runs economy then training, and gold is integer centigold', () => {
  const s = build();
  const before = s.factions.player.goldCg;
  step(s);
  assert.equal(s.tick, 1);
  assert.ok(Number.isInteger(s.factions.player.goldCg));
  assert.ok(s.factions.player.goldCg > before - 1, 'the camp pays its owner');
  assert.ok(at(s, 'camp').trainProgress > 0, 'and starts producing troops');
});

test('gold brownout scales training proportionally and never stalls', () => {
  const s = build({
    sites: [
      LINE[0],
      { id: 'sa', kind: 'stronghold', hex: [3, 0], owner: 'player', garrison: {}, hp: 250, hpMax: 250 },
      { id: 'sb', kind: 'stronghold', hex: [6, 0], owner: 'player', garrison: {}, hp: 250, hpMax: 250 },
      { id: 'castle', kind: 'castle', hex: [9, 0], owner: 'enemy', garrison: { militia: 8 }, hp: 600, hpMax: 600 },
    ],
    adjacency: [['camp', 'sa'], ['sa', 'sb'], ['sb', 'castle']],
  });
  s.factions.player.goldCg = 0;
  s.factions.player.goldFracCg = 0;
  step(s);

  const a = at(s, 'sa');
  const b = at(s, 'sb');
  assert.ok(a.brownout > 0 && a.brownout < 1, `expected a brownout, got ${a.brownout}`);
  assert.equal(a.brownout, b.brownout, 'the shortage is shared proportionally');
  assert.ok(a.trainProgress > 0, 'BROWNOUT, NEVER A STALL');
  assert.ok(s.factions.player.goldCg >= 0, 'gold never goes negative');

  const p0 = a.trainProgress;
  step(s);
  assert.ok(a.trainProgress > p0, 'progress keeps creeping forward while poor');

  s.factions.player.goldCg = 100000;
  step(s);
  assert.equal(a.brownout, 1, 'a solvent faction runs at full rate');
});

test('militia arrive two per cycle, and the garrison cap stops production', () => {
  const s = build();
  const camp = at(s, 'camp');
  runUntil(s, () => total(camp.garrison) > 20);
  assert.equal(total(camp.garrison), 22, 'militia train 2 per cycle');
  assert.equal(garrisonCap(s, camp), SITES.camp.cap);

  camp.garrison = comp({ militia: garrisonCap(s, camp) });
  const gold = s.factions.player.goldCg;
  stepN(s, 20);
  assert.equal(total(camp.garrison), garrisonCap(s, camp), 'a full site produces nothing');
  assert.ok(camp.trainBlocked);
  assert.ok(s.factions.player.goldCg > gold, 'and stops paying for it');
});

test('switching trainType keeps progress — reacting is never punished', () => {
  const s = build();
  stepN(s, 30);
  const camp = at(s, 'camp');
  const kept = camp.trainProgress;
  assert.ok(kept > 0);
  s.commands.push({ t: 'TRAIN', site: 'camp', unit: 'spearmen' });
  step(s);
  assert.equal(camp.trainType, 'spearmen');
  assert.ok(camp.trainProgress > kept * 0.9, 'progress carries across the switch');
});
