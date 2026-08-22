// A BOOSTER FIRED INTO A FIGHT THAT IS ALREADY HAPPENING.
//
// This was proposed as a feature and turned out to be SHIPPED: the melee layer's
// `reprojectDefender` names BOMBARD in its own docblock as one of the five
// things it fixed ("the kill was erased; the charge was still spent"), and
// `siteMelees` re-projects whenever `site.garrison` differs from what the phase
// last wrote. So the six-second window is already a real decision.
//
// What it was NOT is guarded. Nothing in the suite fired a booster into an open
// melee, so the staleness test that makes it work — `sameComp(site.garrison,
// m.defWrote)`, an ID-set comparison rather than a headcount — could be
// refactored away and every test would stay green while the charge was spent for
// nothing. That is precisely the shape this project keeps finding, and it is the
// whole reason this file exists.
//
// Measured on the fixture below: without a bombard the assault leaves 8
// defenders standing; with one it leaves 5, off a garrison cut 30 -> 20 at the
// moment the charge lands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattleState } from '../src/battle/state.js';
import { step } from '../src/battle/sim.js';
import { drainCommands } from '../src/battle/commands.js';
import { spawnSquad, clearPathCache } from '../src/battle/movement.js';
import { emptyComp, total } from '../src/battle/combat.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';

const comp = (o) => ({ ...emptyComp(), ...o });
let n = 0;

function board() {
  clearPathCache();
  const s = createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: `meleeboost-${n++}`,
    seed: 3,
    grid: { cols: 13, rows: 11, blocked: [] },
    sites: [
      { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 40 }, hp: 600, hpMax: 600 },
      { id: 'hold', kind: 'stronghold', hex: [4, 0], owner: 'enemy', garrison: { militia: 30 }, hp: 340, hpMax: 340 },
      { id: 'castle', kind: 'castle', hex: [10, 0], owner: 'enemy', garrison: { militia: 5 }, hp: 900, hpMax: 900 },
    ],
    adjacency: [],
    player: makeMods({ expedition: emptyComp() }),
    enemy: makeMods({ expedition: emptyComp() }),
    boosters: [{ id: 'bombard', charges: 3 }],
    rules: { victory: 'capture-castle', hardCapMs: 600000, aiTier: 1 },
  });
  // The enemy commander stands still, so the only thing that can move a garrison
  // is the charge under test. Nulling `state.ai` outright throws in `think`.
  s.ai.nextThinkTick = Infinity;
  return s;
}

/** March on `hold`, wait for the melee to open, optionally bombard, run it out. */
function assault({ bombard = false } = {}) {
  const s = board();
  const hold = s.sites[1];
  spawnSquad(s, { owner: 'player', from: 'camp', to: 'hold', comp: comp({ militia: 34 }) });

  let opened = 0;
  for (let i = 0; i < 400 && !opened; i++) { step(s, 100); if (hold.melee) opened = s.tick; }
  const atOpen = { att: total(hold.melee.comp), def: total(hold.garrison) };

  if (bombard) {
    s.commands.push({ t: 'BOOSTER', id: 'bombard', site: 'hold' });
    drainCommands(s);
  }
  const afterCharge = total(hold.garrison);

  for (let i = 0; i < 400 && hold.melee; i++) step(s, 100);
  return { opened, atOpen, afterCharge, survivors: total(hold.garrison), owner: hold.owner };
}

test('melee: a bombard lands on the garrison that is actually fighting', () => {
  const plain = assault();
  const boosted = assault({ bombard: true });

  assert.ok(plain.opened > 0, 'premise: a melee has to be open for any of this to mean anything');
  assert.deepEqual(boosted.atOpen, plain.atOpen, 'both runs must reach the same fight');
  assert.ok(boosted.afterCharge < boosted.atOpen.def,
    'the charge did not reach the defenders at all');
});

test('melee: ...and it CHANGES THE OUTCOME, rather than being erased by the projection', () => {
  // THE ONE THAT MATTERS. `openSiteMelee` projects the whole fight when it opens
  // and interpolates toward that answer — so a kill applied to `site.garrison`
  // and no re-projection would leave the fight resolving toward the OLD number,
  // with the charge spent, the event fired and the board looking healthy.
  const plain = assault();
  const boosted = assault({ bombard: true });
  assert.ok(boosted.survivors < plain.survivors,
    `bombard left ${boosted.survivors} standing against ${plain.survivors} without it`
    + ' — the projection swallowed the charge');
});

test('melee: the control — an untouched fight resolves identically twice', () => {
  // Without this, the test above would pass just as happily on a simulation that
  // was simply noisy, and there is no randomness in combat for it to be.
  assert.deepEqual(assault(), assault());
});
