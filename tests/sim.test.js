import test from 'node:test';
import assert from 'node:assert/strict';
import { startBattle, step, runToEnd } from '../src/battle/sim.js';
import { toOutcome } from '../src/battle/outcome.js';
import {
  assertBattleConfig, assertBattleOutcome, makeMods, CONTRACT_VERSION,
} from '../src/battle/contract.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { emptyComp, total, siteMaxHp, power } from '../src/battle/combat.js';
import { siteGoldPerSec } from '../src/battle/economy.js';
import { ATTRITION } from '../src/content/balance.js';
import { TICK_HZ } from '../src/core/loop.js';

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
    battleId: `sim-${n++}`,
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
const events = (s, type) => s.events.filter((e) => e.type === type);

/** Every unit anywhere: garrisons, besieging stacks, and squads in flight. */
function countAll(state, owner) {
  let k = 0;
  for (const s of state.sites) {
    if (!owner || s.owner === owner) k += total(s.garrison);
    if (s.siege && (!owner || s.siege.owner === owner)) k += total(s.siege.comp);
  }
  for (const sq of state.squads) if (!owner || sq.owner === owner) k += total(sq.comp);
  return k;
}


// --- siege ------------------------------------------------------------------

test('beating the garrison starts a siege; capture happens at the walls', () => {
  const s = build();
  s.commands.push({ t: 'SEND', from: 'camp', to: 'f1', fraction: 1 });
  runUntil(s, (x) => at(x, 'f1').siege);
  const f1 = at(s, 'f1');
  assert.equal(f1.owner, 'neutral', 'winning the field does NOT capture');
  assert.equal(f1.siege.owner, 'player');
  assert.equal(total(f1.garrison), 0);
  assert.equal(f1.hp, f1.hpMax, 'the siege deals no damage on the tick it begins');

  runUntil(s, (x) => at(x, 'f1').owner === 'player');
  assert.equal(f1.owner, 'player');
  assert.equal(f1.siege, null);
  assert.ok(total(f1.garrison) > 0, 'the besiegers become the garrison');
  assert.ok(f1.hp < f1.hpMax * 0.15, `HP carries over at ${f1.hp}, not reset to max`);
  assert.equal(f1.level, 1);
  assert.equal(s.meta.lastFlipTick, s.tick);
  assert.equal(events(s, 'site-captured').length, 1);
  assert.equal(s.influence[`${f1.hex[0]},${f1.hex[1]}`], 'player', 'territory floods on capture');
});

test('a captured site is briefly fragile — a fast counterattack retakes it', () => {
  const s = build();
  s.commands.push({ t: 'SEND', from: 'camp', to: 'f1', fraction: 0.5 });
  runUntil(s, (x) => at(x, 'f1').owner === 'player');
  const f1 = at(s, 'f1');
  const fragile = f1.hp;
  assert.ok(fragile < 10);
  assert.ok(siteMaxHp('farm') - fragile > 80, 'the walls are still down');
});

test('a sub-threshold force can sit on a farm forever and never take it', () => {
  const s = build({
    sites: [LINE[0], { ...LINE[1], garrison: { militia: 1 } }, LINE[2], LINE[3]],
  });
  const camp = at(s, 'camp');
  camp.garrison = comp({ raiders: 2 });
  s.commands.push({ t: 'SEND', from: 'camp', to: 'f1', fraction: 1 });
  runUntil(s, (x) => at(x, 'f1').siege);
  stepN(s, 2000);
  const f1 = at(s, 'f1');
  assert.equal(f1.owner, 'neutral', 'walls repair faster than they break them');
  assert.ok(f1.siege, 'the raiders are still sitting there');
  assert.equal(f1.hp, f1.hpMax, 'and the wall is fully repaired');
});

test('a relieving force fights the besiegers and lifts the siege', () => {
  const s = build();
  const f1 = at(s, 'f1');
  f1.owner = 'player';
  f1.garrison = comp({ militia: 2 });
  f1.siege = { owner: 'enemy', comp: comp({ militia: 5 }) };
  s.commands.push({ t: 'SEND', from: 'camp', to: 'f1', fraction: 1 });
  runUntil(s, (x) => !at(x, 'f1').siege);
  assert.equal(f1.siege, null);
  assert.equal(f1.owner, 'player');
  assert.ok(total(f1.garrison) > 2, 'the survivors reinforce the garrison');
});

// --- arrivals ---------------------------------------------------------------

test('same-tick arrivals merge into one force — synchronized strikes are rewarded', () => {
  const s = build({
    sites: [
      { ...LINE[0], garrison: { militia: 12 } },
      { ...LINE[1], garrison: { militia: 10 } },
      LINE[2], LINE[3],
    ],
  });
  s.commands.push({ t: 'SEND', from: 'camp', to: 'f1', fraction: 0.5 });
  s.commands.push({ t: 'SEND', from: 'camp', to: 'f1', fraction: 1 });
  step(s);
  assert.equal(s.squads.length, 2);
  assert.equal(s.squads[0].arriveTick, s.squads[1].arriveTick);

  runUntil(s, (x) => x.events.some((e) => e.type === 'field-battle'));
  const fights = events(s, 'field-battle');
  assert.equal(fights.length, 1, 'one merged battle, not two');
  assert.equal(fights[0].attPower, power(comp({ militia: 12 }), comp({ militia: 10 })));
  assert.equal(fights[0].win, true);
});

test('...and the same force arriving piecemeal is beaten in detail', () => {
  const s = build({
    sites: [
      { ...LINE[0], garrison: { militia: 12 } },
      { ...LINE[1], garrison: { militia: 10 } },
      LINE[2], LINE[3],
    ],
  });
  s.commands.push({ t: 'SEND', from: 'camp', to: 'f1', fraction: 0.5 });
  step(s);
  stepN(s, 6);
  s.commands.push({ t: 'SEND', from: 'camp', to: 'f1', fraction: 1 });
  runUntil(s, (x) => x.events.some((e) => e.type === 'field-battle'));
  const first = events(s, 'field-battle')[0];
  assert.equal(first.win, false, 'half the force alone bounces off');
});

test('a failed raid sends half the raiders home (skirmish)', () => {
  const s = build({
    sites: [
      { ...LINE[0], garrison: { raiders: 4 } },
      { ...LINE[1], kind: 'stronghold', garrison: { spearmen: 4 }, hp: 250, hpMax: 250 },
      LINE[2], LINE[3],
    ],
  });
  s.commands.push({ t: 'SEND', from: 'camp', to: 'f1', fraction: 1 });
  runUntil(s, (x) => x.events.some((e) => e.type === 'skirmish-escape'));
  const esc = events(s, 'skirmish-escape')[0];
  assert.equal(esc.raiders, 2, 'the probe costs 50%, not 100%');
  assert.equal(s.squads.length, 1);
  assert.equal(s.squads[0].retreating, true);
  runUntil(s, (x) => x.squads.length === 0);
  // THE RAIDERS THAT CAME HOME, not the camp's total headcount. This used to
  // read `total(garrison) === 2` and that stopped being the same statement when
  // field battles started taking `MELEE.seconds`: the camp goes on TRAINING
  // through the fight, so by the time the survivors are back it holds them plus
  // whatever it produced meanwhile. Asserting the total was only ever a proxy
  // for "half the probe came back", and the proxy is what broke.
  assert.equal(at(s, 'camp').garrison.raiders, 2, 'half the probe came home');
  assert.equal(s.factions.player.unitsLost, 2);
});

// --- retreat ----------------------------------------------------------------

test('retreat conserves every unit, from a garrison, a siege, or mid-flight', () => {
  const s = build({ player: { trainSpeedMult: 0 }, enemy: { trainSpeedMult: 0 } });
  const f1 = at(s, 'f1');
  f1.owner = 'player';
  f1.garrison = comp({ militia: 7 });
  const start = countAll(s);

  s.commands.push({ t: 'RETREAT', site: 'f1' });
  step(s);
  assert.equal(total(f1.garrison), 0, 'the ground is given up');
  assert.equal(s.squads.length, 1);
  assert.equal(s.squads[0].retreating, true);
  assert.equal(countAll(s), start, 'nobody is lost pulling back');

  runUntil(s, (x) => x.squads.length === 0);
  assert.equal(countAll(s), start);
  assert.equal(total(at(s, 'camp').garrison), 27);

  // ...now a besieging stack.
  s.commands.push({ t: 'SEND', from: 'camp', to: 'f1', fraction: 0.5 });
  runUntil(s, (x) => at(x, 'f1').siege || x.tick > 400);
  const mid = countAll(s);
  s.commands.push({ t: 'RETREAT', site: 'f1' });
  step(s);
  assert.equal(at(s, 'f1').siege, null, 'the siege is abandoned');
  assert.equal(countAll(s), mid, 'and the stack walks away whole');

  // ...and a squad in flight.
  runUntil(s, (x) => x.squads.length === 0);
  s.commands.push({ t: 'SEND', from: 'camp', to: 'f1', fraction: 0.5 });
  step(s);
  const flying = countAll(s);
  s.commands.push({ t: 'RETREAT_SQUAD', squadId: s.squads[0].id });
  step(s);
  assert.equal(s.squads[0].retreating, true);
  assert.equal(s.squads[0].to, 'camp');
  runUntil(s, (x) => x.squads.length === 0);
  assert.equal(countAll(s), flying);
});

test('retreating forces do not fight — they merge past an ongoing siege', () => {
  const s = build({ player: { trainSpeedMult: 0 }, enemy: { trainSpeedMult: 0 } });
  const f1 = at(s, 'f1');
  f1.owner = 'player';
  f1.garrison = comp({ militia: 4 });
  s.commands.push({ t: 'SEND', from: 'f1', to: 'sh', fraction: 1 });
  step(s);
  const sq = s.squads[0];
  s.commands.push({ t: 'RETREAT_SQUAD', squadId: sq.id });
  step(s);
  f1.siege = { owner: 'enemy', comp: comp({ militia: 30 }) }; // a hopeless fight
  const before = countAll(s, 'player');

  runUntil(s, (x) => x.squads.length === 0);
  assert.equal(countAll(s, 'player'), before, 'the retreat cannot be intercepted');
  assert.equal(total(f1.garrison), 4);
  assert.ok(f1.siege, 'the besiegers are still there, they just never got a fight');
  assert.equal(events(s, 'field-battle').length, 0);
});


// --- ending -----------------------------------------------------------------

test('taking the castle wins; losing the camp loses', () => {
  const win = build();
  at(win, 'castle').owner = 'player';
  step(win);
  assert.equal(win.status, 'win');
  assert.equal(toOutcome(win, { region: {} }).result, 'win');

  const lose = build();
  at(lose, 'camp').owner = 'enemy';
  step(lose);
  assert.equal(lose.status, 'loss');
  assert.equal(step(lose).tick, lose.tick, 'a finished battle stops ticking');
});

test('the hard cap decides on territory', () => {
  const s = build({ rules: { hardCapMs: 3000 } });
  runToEnd(s, 100);
  assert.equal(s.status, 'timeout');
  assert.equal(s.tick, s.rules.hardCapTicks);
  assert.ok(['player', 'enemy', 'draw'].includes(s.meta.timeoutWinner));
});

test('the attrition ladder bites a genuine stalemate and only then', () => {
  const s = build();
  const farm = at(s, 'f1');
  farm.owner = 'enemy';
  const healthy = siteGoldPerSec(s, farm);
  step(s);
  assert.equal(s.meta.attritionStage, 0, 'a healthy battle never sees the ladder');

  runUntil(s, (x) => x.meta.attritionStage === 1, ATTRITION[0].afterSec * TICK_HZ + 20);
  assert.equal(s.meta.attritionStage, 1);
  assert.ok(Math.abs(siteGoldPerSec(s, farm) - healthy * ATTRITION[0].farmMult) < 1e-9,
    'farms drop 25% once nothing has flipped for 150s');

  runUntil(s, (x) => x.meta.attritionStage === 3, ATTRITION[2].afterSec * TICK_HZ + 20);
  assert.equal(s.meta.attritionStage, 3);
  assert.equal(s.meta.lastFlipTick, 0);

  // A capture resets the clock: the ladder keys off OWNERSHIP, not the sim clock.
  farm.siege = { owner: 'player', comp: comp({ militia: 40 }) };
  runUntil(s, (x) => x.meta.attritionStage === 0);
  assert.equal(s.meta.attritionStage, 0);
});

// --- the whole thing --------------------------------------------------------

function scan(value, path, out) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) out.push(`${path} = ${value}`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => scan(v, `${path}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    for (const k of Object.keys(value)) scan(value[k], `${path}.${k}`, out);
  }
}

function region(seed, over = {}) {
  const map = generateBattleMap({
    cols: 11, rows: 9, enemySites: 7, neutralSites: 2, playerSites: 2, enemyMult: 1, tier: 1,
  }, seed);
  return assertBattleConfig({
    contractVersion: CONTRACT_VERSION,
    battleId: `full-${seed}`,
    seed,
    region: { id: 'riverfen', name: 'Riverfen', tier: 1 },
    ...map,
    player: makeMods({ startGold: 300, expedition: { militia: 8 } }),
    enemy: makeMods({ startGold: 200, expedition: NO_EXPEDITION }),
    boosters: [{ id: 'rally', charges: 2 }],
    rules: { victory: 'capture-castle', hardCapMs: 480000, aiTier: 2 },
    ...over,
  });
}

test('a full headless battle terminates with a valid outcome and no NaN', () => {
  for (const seed of [3, 77, 1234]) {
    const cfg = region(seed);
    const s = startBattle(cfg);
    // Give the player a hand on the tiller: rally the camp at the front line.
    const camp = s.sites.find((x) => x.kind === 'camp');
    s.commands.push({ t: 'RALLY', site: 'camp', target: camp.adj[0] });

    runToEnd(s, 6000);
    assert.notEqual(s.status, 'running', `seed ${seed} never ended`);
    assert.ok(s.tick <= s.rules.hardCapTicks);

    const bad = [];
    scan(s, 'state', bad);
    assert.deepEqual(bad, [], `NaN/Infinity in the state tree (seed ${seed})`);
    assert.ok(s.events.length < 200, 'events are drained, not hoarded');
    assert.ok(s.squads.length < 100, 'no unbounded squad growth');
    for (const site of s.sites) {
      assert.ok(site.hp >= 0 && site.hp <= site.hpMax + 1);
      for (const u of Object.keys(site.garrison)) assert.ok(site.garrison[u] >= 0);
    }
    const outcome = toOutcome(s, cfg);
    assertBattleOutcome(outcome, cfg);
    assert.equal(outcome.rewards, undefined, 'battle reports facts, meta computes money');
    assert.ok(outcome.stats.goldEarned > 0);
    assert.ok(outcome.durationMs > 0);
  }
});

test('same seed and same orders produce a byte-identical battle', () => {
  const runOne = (seed) => {
    const s = startBattle(region(seed));
    for (let i = 0; i < 900; i++) {
      if (i === 5) s.commands.push({ t: 'RALLY', site: 'camp', target: s.sites.find((x) => x.kind === 'camp').adj[0] });
      step(s);
    }
    return JSON.stringify(s);
  };
  assert.equal(runOne(4242), runOne(4242));
  assert.notEqual(runOne(4242), runOne(4243), 'different seeds must diverge');
});

test('a siege event names the KIND of thing being besieged', () => {
  // The HUD banner reads `UNDER SIEGE — ${ev.kind}` and said "— undefined" for
  // as long as it has existed: SITE_CAPTURED carried a kind and SIEGE_BEGUN
  // never did. Nothing caught it because no test read the payload and no
  // screenshot was taken of a battle in trouble. Driven through the real sim
  // rather than by hand-building the event, since a hand-built fixture is
  // exactly what would have encoded the bug.
  const s = build({ quiet: false });
  s.commands.push({ t: 'SEND', from: 'camp', to: 'f1', frac: 1 });
  let ev = null;
  for (let i = 0; i < 600 && !ev; i++) {
    step(s);
    ev = s.events.find((e) => e.type === 'siege-begun') ?? null;
  }
  assert.ok(ev, 'the fixture must actually get a siege under way');
  assert.equal(typeof ev.kind, 'string');
  assert.ok(['farm', 'stronghold', 'camp', 'castle'].includes(ev.kind), `kind was ${ev.kind}`);
  assert.equal(ev.kind, at(s, ev.siteId).kind, 'and it is THAT site’s kind');
});
