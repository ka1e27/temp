// NOTHING ELSE MAY QUIETLY OVERWRITE THE DEFENDERS.
//
// The melee layer shipped writing `site.garrison` every tick from a frozen
// baseline, which made `site.garrison` a field only ONE system really owned
// while five others went on treating it as the truth. Every one of them had its
// work reverted on the next tick, and two of them then looped — a rally on a
// site under assault turned 300 troops into 10,084, which is an economy break
// and a determinism break rather than a nuisance.
//
// One mechanism fixes all five (battle/meleephase.js `reprojectDefender`): the
// melee notices the garrison moved under it, banks what has died, and
// re-projects from where both sides actually are. So these tests are all the
// same claim from five directions — `site.garrison` is the single source of
// truth for who is defending — plus the negative control that the fix did not
// buy that by breaking the pre-commit guarantee.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.performance ??= { now: () => 0 };

const { createBattleState } = await import('../src/battle/state.js');
const { step } = await import('../src/battle/sim.js');
const { makeMods, CONTRACT_VERSION } = await import('../src/battle/contract.js');
const { emptyComp, total, resolveField } = await import('../src/battle/combat.js');
const { UNIT_IDS } = await import('../src/content/balance.js');

const comp = (x) => ({ ...emptyComp(), ...x });
const site = (s, id) => s.sites.find((x) => x.id === id);
const runFor = (s, n) => { for (let i = 0; i < n; i++) step(s); };
function runUntil(s, pred, cap = 3000) {
  for (let i = 0; i < cap && !pred(s); i++) step(s);
  return s;
}

/** Everything alive on one side, wherever it is standing: garrisons, marching
 *  squads, a stack mid-melee and a stack mid-siege. Conservation is the only
 *  honest way to ask "did the game invent or lose troops", because every one of
 *  these bugs moved bodies BETWEEN containers. */
function troopsOf(s, faction) {
  let n = 0;
  for (const x of s.sites) {
    if (x.owner === faction) n += total(x.garrison);
    if (x.melee?.owner === faction) n += total(x.melee.comp);
    if (x.siege?.owner === faction) n += total(x.siege.comp);
  }
  for (const sq of s.squads) if (sq.owner === faction) n += total(sq.comp);
  return n;
}

/** Enemy holds `foe` next to its own `foe2`; the player attacks out of `home`.
 *  The AI is silenced so the only thing that happens is the order under test. */
function fixture({ attack, defend, spare = null, kind = 'castle', hp = 480 }) {
  const sites = [
    { id: 'home', kind: 'camp', hex: [1, 3], owner: 'player',
      garrison: comp(attack), hp: 480, hpMax: 480 },
    { id: 'foe', kind, hex: [3, 3], owner: 'enemy',
      garrison: comp(defend), hp, hpMax: hp },
  ];
  if (spare) {
    sites.push({ id: 'foe2', kind: 'farm', hex: [5, 3], owner: 'enemy',
      garrison: comp(spare), hp: 100, hpMax: 100 });
  }
  const s = createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: 'meleestate',
    seed: 1,
    grid: { cols: 13, rows: 9, blocked: [] },
    sites,
    adjacency: [['home', 'foe'], ['foe', 'foe2']],
    player: makeMods({ expedition: emptyComp(), startGold: 0 }),
    enemy: makeMods({ expedition: emptyComp(), startGold: 0 }),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 900000, aiTier: 1 },
  });
  s.ai.nextThinkTick = 1e9;
  return s;
}

/** Open a melee at `foe` by sending the player's whole camp at it. */
function assault(s) {
  s.commands.push({ t: 'SEND', from: 'home', to: 'foe', fraction: 1 });
  return runUntil(s, (x) => site(x, 'foe').melee);
}

test('melee state: a RALLY out of a besieged site cannot print troops', () => {
  // THE WORST OF THE FIVE. The garrison was revived every tick from the frozen
  // baseline, so the rally saw the same "excess" over and over and sent it
  // again: 63 sends, 300 troops becoming 10,084.
  const s = fixture({ attack: { militia: 60 }, defend: { militia: 300 }, spare: { militia: 1 } });
  assault(s);
  const before = troopsOf(s, 'enemy');
  s.commands.push({ t: 'RALLY', by: 'enemy', from: 'foe', to: 'foe2', keep: 10 });
  runFor(s, 120);

  const after = troopsOf(s, 'enemy');
  assert.ok(after <= before,
    `the enemy ended with MORE troops than it started with (${before} -> ${after}) — `
    + 'a rally on a site in melee is printing men');
  // ...and it is not "fixed" by the rally silently doing nothing: the men that
  // left are really at the destination.
  assert.ok(total(site(s, 'foe2').garrison) > 1, 'the rally moved nobody at all');
});

test('melee state: reinforcing a defended site actually defends it', () => {
  // Measured before the fix: 200 troops arrived, SQUAD_ARRIVED fired, and the
  // final outcome was byte-identical to sending nobody.
  const bare = fixture({ attack: { militia: 300 }, defend: { militia: 60 }, spare: { militia: 200 } });
  assault(bare);
  runUntil(bare, (x) => !site(x, 'foe').melee);
  const aloneLeft = total(site(bare, 'foe').garrison);

  const helped = fixture({ attack: { militia: 300 }, defend: { militia: 60 }, spare: { militia: 200 } });
  assault(helped);
  helped.commands.push({ t: 'SEND', by: 'enemy', from: 'foe2', to: 'foe', fraction: 1 });
  runUntil(helped, (x) => !site(x, 'foe').melee && !x.squads.length);

  const withHelpLeft = total(site(helped, 'foe').garrison)
    + (site(helped, 'foe').melee ? total(site(helped, 'foe').melee.comp) : 0);
  assert.ok(withHelpLeft > aloneLeft,
    `200 defenders arrived mid-fight and changed nothing (${aloneLeft} -> ${withHelpLeft})`);
});

test('melee state: RETREATing the defenders ends the fight instead of cloning them', () => {
  // The men used to walk away intact AND stay in the melee, which both
  // duplicated them and silently defeated the retreat.
  const s = fixture({ attack: { militia: 40 }, defend: { militia: 150 }, spare: { militia: 1 } });
  assault(s);
  const before = troopsOf(s, 'enemy');
  s.commands.push({ t: 'RETREAT', by: 'enemy', site: 'foe' });
  runFor(s, 3);

  assert.ok(total(site(s, 'foe').garrison) === 0,
    'the garrison was ordered out and is still standing there');
  assert.ok(troopsOf(s, 'enemy') <= before,
    'retreating out of a melee duplicated the garrison');
});

test('melee state: NEGATIVE CONTROL — an untouched fight still lands on resolveField', () => {
  // The whole fix is "re-project when something moved the garrison". If the
  // staleness check ever fires when NOTHING moved it, every fight re-projects
  // every tick and the pre-commit preview quietly stops being a guarantee —
  // which is exactly the bug the melee layer already found once, from the
  // attacker's side, and it looked like a slow campaign rather than a defect.
  const s = fixture({ attack: { militia: 200 }, defend: { militia: 30 }, kind: 'farm', hp: 100 });
  assault(s);
  const m = site(s, 'foe').melee;
  const projected = resolveField(m.comp0, m.garrison0, {
    siteDefMult: 1, garrisonMult: 1, defenderOwnsSite: true,
  });
  const openedAt = s.tick;
  const clock = m.ticks;

  runUntil(s, (x) => site(x, 'foe').siege);
  const besiegers = site(s, 'foe').siege.comp;
  for (const u of UNIT_IDS) {
    assert.equal(besiegers[u], projected.attSurvivors[u],
      `${u}: an uninterrupted fight no longer lands where the preview promised`);
  }
  assert.ok(s.tick - openedAt <= clock + 1,
    `the fight ran ${s.tick - openedAt} ticks against a ${clock}-tick clock — it is re-projecting`);
});
