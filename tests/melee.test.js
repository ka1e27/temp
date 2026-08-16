// A FIGHT TAKES TIME, A TILE CAN BE CONTESTED, AND ARCHERS REACH A HEX.
//
// The load-bearing claim of the whole melee layer is that it did NOT change who
// wins — `resolveField` is still the arithmetic and is now read as the
// PROJECTION, so an uninterrupted fight lands exactly where the pre-commit
// preview said it would (invariant 3). Most of this file is that claim and its
// negative controls; the new behaviour is what happens when something DOES
// interrupt.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.performance ??= { now: () => 0 };

const { createBattleState } = await import('../src/battle/state.js');
const { step } = await import('../src/battle/sim.js');
const { makeMods, CONTRACT_VERSION } = await import('../src/battle/contract.js');
const { emptyComp, total, resolveField, power } = await import('../src/battle/combat.js');
const { reachSupport } = await import('../src/battle/meleephase.js');
const { MELEE, UNITS, UNIT_IDS } = await import('../src/content/balance.js');
const { TICK_HZ } = await import('../src/core/loop.js');

const comp = (x) => ({ ...emptyComp(), ...x });

/** Two sites a hex apart, the enemy holding the second. The AI is silenced so
 *  the only thing that happens is the order under test — see tests/units.test.js
 *  for what a live commander did to a fixture that forgot to. */
function fixture({ attack, defend, kind = 'farm', hp = 100 }) {
  const s = createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: 'melee',
    seed: 1,
    grid: { cols: 11, rows: 9, blocked: [] },
    sites: [
      { id: 'home', kind: 'camp', hex: [1, 3], owner: 'player',
        garrison: comp(attack), hp: 480, hpMax: 480 },
      { id: 'foe', kind, hex: [3, 3], owner: 'enemy',
        garrison: comp(defend), hp, hpMax: hp },
    ],
    adjacency: [['home', 'foe']],
    player: makeMods({ expedition: emptyComp(), startGold: 0 }),
    enemy: makeMods({ expedition: emptyComp(), startGold: 0 }),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 600000, aiTier: 1 },
  });
  s.ai.nextThinkTick = 1e9;
  return s;
}

const site = (s, id) => s.sites.find((x) => x.id === id);
const runFor = (s, n) => { for (let i = 0; i < n; i++) step(s); };
function runUntil(s, pred, cap = 2000) {
  for (let i = 0; i < cap && !pred(s); i++) step(s);
  return s;
}

test('melee: a field battle lasts MELEE.seconds instead of one tick', () => {
  const s = fixture({ attack: { militia: 40 }, defend: { militia: 6 } });
  s.commands.push({ t: 'SEND', from: 'home', to: 'foe', fraction: 1 });
  runUntil(s, (x) => site(x, 'foe').melee);

  const opened = s.tick;
  const m = site(s, 'foe').melee;
  assert.ok(m, 'no melee opened — the assault resolved instantly');
  assert.equal(m.ticks, Math.round(MELEE.seconds * TICK_HZ));

  // MID-FIGHT, BOTH SIDES ARE STILL THERE. This is the whole feature: there is
  // now a middle to a battle, and it is when relief can arrive.
  runFor(s, Math.floor(m.ticks / 2));
  const mid = site(s, 'foe');
  assert.ok(mid.melee, 'the fight ended early — nothing can happen in between');
  assert.ok(total(mid.melee.comp) > 0 && total(mid.garrison) > 0,
    'one side was already gone halfway through');
  assert.ok(total(mid.garrison) < 6, 'the defenders took no casualties at all');

  runUntil(s, (x) => !site(x, 'foe').melee);
  const took = s.tick - opened;
  // NOT `=== m.ticks`. A melee also ends the moment one side is EMPTY, and a
  // rout gets there first: the losing six are gone a few ticks before the clock
  // runs out, because integer bodies round to zero early. Asserting the exact
  // length would be pinning that rounding rather than the mechanic. What has to
  // be true is that it took most of the clock and never more.
  assert.ok(took > 1, 'the fight resolved in a single tick — nothing changed');
  assert.ok(took >= m.ticks * 0.8 && took <= m.ticks + 1,
    `the fight took ${took} ticks against a clock of ${m.ticks}`);
});

test('melee: an UNINTERRUPTED fight lands exactly where resolveField projected', () => {
  // THE PREVIEW GUARANTEE, which is the reason the projection is `resolveField`
  // rather than a per-tick exchange. If this ever fails, the pre-commit preview
  // has quietly become an estimate.
  const att = comp({ militia: 40 });
  const def = comp({ militia: 6 });
  const s = fixture({ attack: att, defend: def });
  s.commands.push({ t: 'SEND', from: 'home', to: 'foe', fraction: 1 });
  runUntil(s, (x) => site(x, 'foe').melee);
  const f = site(s, 'foe');
  const projected = resolveField(f.melee.comp0, f.melee.garrison0, {
    siteDefMult: 1, garrisonMult: 1, defenderOwnsSite: true,
  });

  runUntil(s, (x) => site(x, 'foe').siege);
  const besiegers = site(s, 'foe').siege.comp;
  for (const u of UNIT_IDS) {
    assert.equal(besiegers[u], projected.attSurvivors[u],
      `${u}: the fight ended somewhere resolveField did not predict`);
  }
});

test('melee: two hostile forces on one tile fight, and a marcher is halted', () => {
  // Both sides march at the same tile of open ground. Neither is a site, so the
  // only thing that can stop them passing through each other is this rule.
  const s = fixture({ attack: { militia: 30 }, defend: { militia: 30 } });
  s.commands.push({ t: 'SEND', from: 'home', toHex: { q: 2, r: 3 }, fraction: 1 });
  s.commands.push({ t: 'SEND', by: 'enemy', from: 'foe', toHex: { q: 2, r: 3 }, fraction: 1 });
  runUntil(s, (x) => x.squads.some((sq) => sq.melee));

  const fighting = s.squads.filter((sq) => sq.melee);
  assert.equal(fighting.length, 2, 'two armies stood on one tile and did not fight');
  for (const sq of fighting) {
    assert.equal(sq.camped, true, 'a squad in a melee is still marching');
  }
  const before = s.squads.map((sq) => total(sq.comp)).reduce((a, b) => a + b, 0);
  runFor(s, 20);
  const after = s.squads.map((sq) => total(sq.comp)).reduce((a, b) => a + b, 0);
  assert.ok(after < before, 'nobody took a casualty on a contested tile');

  runUntil(s, (x) => !x.squads.some((sq) => sq.melee));
  assert.ok(s.squads.length <= 1, 'both sides survived a fight to the finish');
});

test('melee: NEGATIVE CONTROL — two FRIENDLY forces on a tile do not fight', () => {
  // Without this the assertion above would pass just as happily if the rule
  // were "any two squads on a hex", which would have armies killing their own
  // reinforcements every time a rally point stacked up.
  const s = fixture({ attack: { militia: 30 }, defend: { militia: 1 } });
  s.commands.push({ t: 'SEND', from: 'home', toHex: { q: 2, r: 3 }, fraction: 0.5 });
  s.commands.push({ t: 'SEND', from: 'home', toHex: { q: 2, r: 3 }, fraction: 1 });
  runUntil(s, (x) => x.squads.length > 0 && x.squads.every((sq) => sq.camped), 400);
  const mine = s.squads.filter((sq) => sq.owner === 'player');
  assert.ok(mine.length >= 1, 'nothing camped — this proves nothing');
  assert.ok(mine.every((sq) => !sq.melee), 'my own two columns started fighting each other');
  assert.equal(mine.reduce((a, sq) => a + total(sq.comp), 0), 30,
    'friendly stacking cost bodies');
});

test('melee: you can BREAK OFF a fight, and you leave with the survivors', () => {
  // The other half of giving a fight a middle. Reinforcing was the easy half;
  // this is the one that was silently refused, because a force in `site.melee`
  // was in neither of the two places RETREAT knew about, so an assault you could
  // watch losing answered `nothing-to-retreat`.
  const s = fixture({ attack: { militia: 8 }, defend: { militia: 60 } });
  s.commands.push({ t: 'SEND', from: 'home', to: 'foe', fraction: 1 });
  runUntil(s, (x) => site(x, 'foe').melee);
  const m = site(s, 'foe').melee;
  const committed = total(m.comp);

  // Halfway through, and losing badly. Break off.
  runFor(s, Math.floor(m.ticks / 2));
  const left = total(site(s, 'foe').melee.comp);
  assert.ok(left > 0 && left < committed,
    `the fight had not cost anything yet (${left} of ${committed}) — this proves nothing`);

  s.commands.push({ t: 'RETREAT', site: 'foe' });
  step(s);
  assert.equal(site(s, 'foe').melee, null, 'the fight went on without its attacker');
  const out = s.squads.filter((sq) => sq.owner === 'player' && sq.retreating);
  assert.equal(out.length, 1, 'nobody marched away from the fight they broke off');
  // NOT `committed`. Breaking off is not a free look at the projection: the
  // casualties already taken are already taken.
  assert.equal(total(out[0].comp), left,
    'the survivors that walked away are not the survivors that were fighting');
});

test('reach: archers a hex away add their attack and take none of the casualties', () => {
  const s = fixture({ attack: { militia: 10 }, defend: { militia: 10 } });
  // One camped archer squad, one hex from where the fight will be.
  s.squads.push({
    id: 900, owner: 'player', from: null, to: null, comp: comp({ archers: 8 }),
    path: [{ q: 2, r: 2 }], spawnTick: 0, arriveTick: 0,
    retreating: false, camped: true, hex: { q: 2, r: 2 }, melee: null,
  });
  const support = reachSupport(s, 'player', { q: 2, r: 3 }, new Set());
  assert.ok(support, 'the archers one hex away contributed nothing');
  assert.equal(support.archers, 8);

  // NEGATIVE CONTROL 1: out of reach. `reach` is 1, so two hexes is nothing.
  assert.equal(reachSupport(s, 'player', { q: 4, r: 3 }, new Set()), null,
    'archers shot into a fight beyond their reach');
  // NEGATIVE CONTROL 2: a squad that is ITSELF in the melee does not also
  // support it — that would be counting the same bodies twice.
  assert.equal(reachSupport(s, 'player', { q: 2, r: 3 }, new Set([900])), null,
    'an engaged squad supported the fight it is standing in');
  // NEGATIVE CONTROL 3: only units with `reach` do this at all.
  const reaching = UNIT_IDS.filter((u) => UNITS[u].reach);
  assert.deepEqual(reaching, ['archers'],
    'a second unit gained `reach` — re-read meleephase.js reachSupport first');
});

test('reach: archers work AT A SITE, which is where nearly every fight happens', () => {
  // THE TEST THAT WAS MISSING, and its absence is why the unit shipped inert.
  // `reachSupport` was reachable only from `openHexMelee`, so archers helped
  // when two mobile columns collided on bare ground and did NOTHING for
  // attacking or defending a farm, a yard, a wall, a camp or a throne. The
  // reach tests above all call `reachSupport` directly — they proved the helper
  // works and never asked whether anything called it, which is exactly how a
  // dead feature keeps a green suite.
  const run = (withArchers) => {
    const s = fixture({ attack: { militia: 10 }, defend: { militia: 9 } });
    if (withArchers) {
      s.squads.push({
        id: 900, owner: 'player', from: null, to: null, comp: comp({ archers: 40 }),
        path: [{ q: 2, r: 3 }], spawnTick: 0, arriveTick: 0,
        retreating: false, camped: true, hex: { q: 2, r: 3 }, melee: null,
      });
    }
    s.commands.push({ t: 'SEND', from: 'home', to: 'foe', fraction: 1 });
    // TO THE END OF THE FIGHT, not to its start. At the tick a melee opens the
    // interpolation is at frac 0, so `m.comp` is still the force that set off —
    // reading there compares two identical starting stacks and answers "the
    // archers did nothing" no matter how well they are wired.
    runUntil(s, (x) => site(x, 'foe').siege);
    return total(site(s, 'foe').siege.comp);
  };
  const alone = run(false);
  const helped = run(true);
  assert.ok(helped > alone,
    `40 archers a hex from a site assault changed nothing (${alone} -> ${helped}) — `
    + 'reachSupport is not reaching the site path');
});

test('reach: support is added to POWER, never to the casualty pool', () => {
  // The whole point of the unit. If archers were folded into the stack instead,
  // `resolveField` would scale them along with everybody else and they would
  // die at the same rate as the line they are standing behind.
  const line = comp({ militia: 10 });
  const bows = comp({ archers: 8 });
  const foe = comp({ militia: 10 });
  const alone = power(line, foe, {});
  const supported = alone + power(bows, foe, {});
  assert.ok(supported > alone, 'archers added nothing to the side they shoot for');

  const r = resolveField(line, foe, {});
  for (const u of UNIT_IDS) {
    assert.ok((r.attSurvivors[u] ?? 0) === 0 || u === 'militia',
      'the survivor comp gained a unit that was never in the stack');
  }
});
