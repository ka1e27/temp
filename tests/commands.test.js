// Order validation and the five boosters.
// Owned by the battle engine, alongside src/battle/commands.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startBattle, step } from '../src/battle/sim.js';
import { assertBattleConfig, makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { emptyComp, total, siteMaxHp, power } from '../src/battle/combat.js';
import { siteGoldPerSec } from '../src/battle/economy.js';
import { SITES, CENTIGOLD, RALLY_MIN_GARRISON, SITE_UPGRADE } from '../src/content/balance.js';
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
    battleId: `cmd-${n++}`,
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
const runUntil = (s, pred, max = 4000) => {
  let i = 0;
  while (!pred(s) && i < max && s.status === 'running') { step(s); i++; }
  return s;
};
const events = (s, type) => s.events.filter((e) => e.type === type);

// --- orders -----------------------------------------------------------------

test('invalid orders are rejected silently, with a reason for the HUD', () => {
  const s = build();
  // camp->sh used to be refused as 'not-adjacent'; under free movement a hex
  // path exists (the grid here has nothing blocked) and cmdSend never checks
  // reach at all — that reason is cmdRally's alone now. An unknown site id is
  // still genuinely invalid, whatever the movement rule.
  s.commands.push({ t: 'SEND', from: 'camp', to: 'ghost', fraction: 1 });    // unknown site
  s.commands.push({ t: 'SEND', from: 'sh', to: 'castle', fraction: 1 });     // not yours
  s.commands.push({ t: 'TRAIN', site: 'camp', unit: 'rams' });               // locked
  s.commands.push({ t: 'UPGRADE', site: 'castle' });                         // not yours
  s.commands.push({ t: 'NONSENSE' });
  step(s);
  const reasons = events(s, 'command-rejected').map((e) => e.reason);
  assert.deepEqual(reasons,
    ['unknown-site', 'not-your-site', 'unit-locked', 'not-your-site', 'unknown-command']);
  assert.equal(s.squads.length, 0);
  assert.equal(at(s, 'camp').trainType, 'militia');
});

test('an upgrade is paid instantly, builds at the old rate, then pays more', () => {
  const s = build({ player: { trainSpeedMult: 0 } });
  const camp = at(s, 'camp');
  const gold = s.factions.player.goldCg;
  const rate = siteGoldPerSec(s, camp);
  s.commands.push({ t: 'UPGRADE', site: 'camp' });
  step(s);
  assert.equal(camp.level, 2);
  assert.ok(camp.upgradeTicksLeft > 0);
  assert.equal(s.factions.player.goldCg,
    gold - SITE_UPGRADE[0].gold * CENTIGOLD + (SITES.camp.gold * CENTIGOLD) / TICK_HZ);
  assert.equal(siteGoldPerSec(s, camp), rate, 'it produces at the OLD rate while building');
  assert.equal(camp.hpMax, siteMaxHp('camp', 1), 'HP only rises when the works finish');

  runUntil(s, (x) => at(x, 'camp').upgradeTicksLeft === 0);
  assert.equal(camp.hpMax, siteMaxHp('camp', 2));
  assert.ok(camp.hp > siteMaxHp('camp', 1));
  assert.ok(siteGoldPerSec(s, camp) > rate, 'and only then does it pay more');
});

test('a rally point turns a rear site into passive income', () => {
  const s = build();
  const camp = at(s, 'camp');
  s.commands.push({ t: 'RALLY', site: 'camp', target: 'f1' });
  step(s);
  assert.deepEqual(camp.rallyTargets, ['f1']);
  assert.equal(s.squads.length, 1, 'a garrison over the threshold ships out at once');
  assert.equal(total(camp.garrison), RALLY_MIN_GARRISON);
  s.commands.push({ t: 'RALLY', site: 'camp', target: null });
  step(s);
  assert.deepEqual(camp.rallyTargets, []);
});

test('Emergency Fortify is the siege-breaker it says it is', () => {
  const s = build({ boosters: [{ id: 'fortify', charges: 1 }] });
  const f1 = at(s, 'f1');
  f1.owner = 'player';
  f1.garrison = comp({ spearmen: 4 });
  f1.siege = { owner: 'enemy', comp: comp({ militia: 20 }) }; // 12 dps vs 2 regen
  s.commands.push({ t: 'BOOSTER', id: 'fortify', site: 'f1' });
  step(s);
  assert.ok(f1.shieldTicks > 0);
  assert.ok(f1.hp > f1.hpMax, 'the +100 HP survives the siege clamp');

  const dropPerTick = (f1.hpMax + 100 - f1.hp);
  assert.ok(dropPerTick > 0 && dropPerTick < 1.2, 'and it drains at the siege rate, not instantly');

  // ...and while the shield is up, an assault lands at half power.
  const raw = build({ boosters: [{ id: 'fortify', charges: 1 }] });
  const target = at(raw, 'f1');
  target.owner = 'player';
  target.garrison = comp({ spearmen: 4 });
  raw.commands.push({ t: 'BOOSTER', id: 'fortify', site: 'f1' });
  raw.commands.push({ t: 'SEND', by: 'enemy', from: 'sh', to: 'f1', fraction: 1 });
  runUntil(raw, (x) => x.events.some((e) => e.type === 'field-battle'));
  const fight = events(raw, 'field-battle')[0];
  assert.equal(fight.attacker, 'enemy');
  assert.equal(fight.attPower, power(comp({ militia: 6 }), comp({ spearmen: 4 })) * 0.5,
    'Emergency Fortify halves attacker power');
});

test('the HUD spelling of an order is accepted, not silently dropped', () => {
  const s = build({ boosters: [{ id: 'bombard', charges: 1 }] });
  s.commands.push({ t: 'RALLY', from: 'camp', to: 'f1' });          // site/target aliases
  s.commands.push({ t: 'BOOSTER', id: 'bombard', target: 'sh' });   // site alias
  step(s);
  assert.deepEqual(events(s, 'command-rejected'), []);
  assert.deepEqual(at(s, 'camp').rallyTargets, ['f1']);
  assert.ok(at(s, 'sh').hp < at(s, 'sh').hpMax);

  s.commands.push({ t: 'RALLY', from: 'camp', to: null });
  step(s);
  assert.deepEqual(at(s, 'camp').rallyTargets, []);

  const squad = s.squads[0];
  s.commands.push({ t: 'RETREAT', squad });                         // a squad by object
  step(s);
  assert.equal(squad.retreating, true);
  assert.deepEqual(events(s, 'command-rejected'), []);
});

test('boosters resolve before arrivals and respect charges', () => {
  const s = build({ boosters: [{ id: 'bombard', charges: 1 }, { id: 'tithe', charges: 1 }] });
  const sh = at(s, 'sh');
  sh.hp = 40;
  const gold = s.factions.player.goldCg;
  s.commands.push({ t: 'BOOSTER', id: 'bombard', site: 'sh' });
  s.commands.push({ t: 'BOOSTER', id: 'tithe' });
  s.commands.push({ t: 'BOOSTER', id: 'bombard', site: 'sh' }); // no charges left
  step(s);
  assert.ok(sh.hp >= 1, 'bombardment NEVER captures');
  assert.equal(total(sh.garrison), 4, '25% of the garrison is destroyed');
  assert.ok(s.factions.player.goldCg > gold + 20000);
  assert.ok(s.factions.player.trainBoostTicks > 0);
  assert.deepEqual(events(s, 'command-rejected').map((e) => e.reason), ['no-charges']);
  assert.equal(s.boosters.bombard.cdTicks > 0, true);
});
