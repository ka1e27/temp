// A FAILED ASSAULT LEAVES A MEMORY — split out of tests/squadvision.test.js
// purely for the 400-line cap, along the concern rather than at a line number.
//
// This is the one deliberate, narrow relaxation of "a ghost carries nothing
// that changes" (src/battle/assaultmemory.js). The objection to a remembered
// garrison is that it is a number nobody ever confirmed; a LOST assault is a
// different claim, because your own army stood on that ground and fought that
// garrison. `recordFailedAssault` has exactly one caller, and the negative
// control below — a WON assault records nothing — is what keeps it that way.
import test from 'node:test';
import assert from 'node:assert/strict';

import { perceivedSite, lastKnownGarrison } from '../src/battle/vision.js';
import { startBattle, step } from '../src/battle/sim.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { createState } from '../src/core/store.js';
import { markConquered, refreshUnlocks } from '../src/meta/world.js';
import { REGIONS } from '../src/content/regions.data.js';
import { total } from '../src/battle/combat.js';

/** A real battle, on the real path — same helper as tests/squadvision.test.js. */
function battleFor(id = 'gallowmoor', { quiet = true, gold = 200000 } = {}) {
  const state = createState({ seed: 1, now: 0 });
  const i = REGIONS.findIndex((r) => r.id === id);
  for (const p of REGIONS.slice(0, i)) markConquered(state.meta, p.id, { now: 0, durationMs: 0 });
  refreshUnlocks(state.meta, null);
  const b = startBattle(buildBattleConfig(state.meta, id, [], generateBattleMap, { seed: 5 }));
  b.factions.player.goldCg = gold;
  if (quiet) b.ai.nextThinkTick = 1e9;
  return b;
}

// ---------------------------------------------------------------------------
// A failed assault leaves a memory — the one deliberate, narrow relaxation
// of "a ghost carries nothing that changes"
// ---------------------------------------------------------------------------

test('vision: a failed assault records the garrison it fought, and only a failed one', () => {
  const b = battleFor();
  const home = b.sites.find((s) => s.kind === 'camp');
  // A FARM specifically — `SITES.farm.train` is 0, so nothing reinforces it
  // while the slow probe below is still in the air, and the number this test
  // predicts cannot drift out from under it before the fight happens.
  const target = b.sites.find((s) => s.owner === 'enemy' && s.kind === 'farm' && total(s.garrison) > 2);
  assert.ok(target, 'no defended enemy farm to attack — this proves nothing');
  assert.equal(lastKnownGarrison(b, 'player', target.id), undefined,
    'a memory existed before any assault ever happened');

  // STACK THE DEFENCE rather than shrink the probe. TWO things have to be true
  // at once here — the column must SURVIVE the march (`battle/towers.js` shoots
  // what passes within reach of a wall, and a 2% probe was wiped out before it
  // arrived; the loop below exits when the squad leaves `state.squads`, which
  // "shot to nothing en route" satisfies exactly as well as "arrived and
  // fought") and it must then LOSE. One send fraction cannot be tuned to
  // satisfy both against a generated map: 2% died on the way and 12% won.
  // Fixing the garrison instead makes the loss arithmetic rather than a guess,
  // and a farm trains nothing, so the number cannot drift while the probe is
  // still in the air.
  target.garrison = { ...target.garrison, militia: (target.garrison.militia ?? 0) + 400 };
  const defenders = total(target.garrison);
  b.commands.push({ t: 'SEND', from: home.id, to: target.id, fraction: 0.12 });
  step(b);
  const sq = b.squads.find((s) => s.owner === 'player' && s.to === target.id);
  assert.ok(sq, 'the probe never marched — this proves nothing');
  let fought = null;
  // A SQUAD LEAVING THE BOARD IS NO LONGER THE END OF THE FIGHT — it is the
  // start of one. Since battle/meleephase.js the column comes off `state.squads`
  // to OPEN a melee, and the memory is written when that RESOLVES.
  for (let i = 0; i < 2000 && (b.squads.some((x) => x.id === sq.id) || target.melee); i++) {
    step(b);
    fought = fought ?? b.events.find((e) => e.attPower !== undefined && e.siteId === target.id);
  }
  // ASSERT THE FIGHT, not the disappearance. This is the whole difference
  // between the two ways a squad can leave the board.
  assert.ok(fought, 'the probe never fought — it died on the way, so this proves nothing');
  assert.equal(fought.win, false, 'the probe was meant to LOSE; it won');

  assert.equal(lastKnownGarrison(b, 'player', target.id), defenders,
    'a failed assault must remember exactly the garrison it fought, not the survivors after it');

  // The ghost's strict contract is unbroken: the count is never smuggled
  // onto the object perceivedSite hands back — it is a deliberately separate,
  // narrower fact a caller asks for on purpose.
  const ghost = perceivedSite(b, 'player', target);
  assert.equal(ghost.garrison, undefined, 'the stale count leaked onto the ghost object itself');

  // NEGATIVE CONTROL 1: a different enemy site the player never attacked has
  // no memory — this is not populated for every enemy site by construction.
  const untouched = b.sites.find((s) => s.owner === 'enemy' && s.id !== target.id);
  if (untouched) assert.equal(lastKnownGarrison(b, 'player', untouched.id), undefined);

  // NEGATIVE CONTROL 2: the DEFENDER's own memory of the site it already
  // owns is untouched — this is the ATTACKER's stale intelligence, not a
  // general "garrison changed" log.
  assert.equal(lastKnownGarrison(b, 'enemy', target.id), undefined);
});

test('vision: recordFailedAssault is the only writer — a WIN records nothing', () => {
  const b = battleFor();
  const home = b.sites.find((s) => s.kind === 'camp');
  // Overwhelm a lightly-held site so the assault WINS.
  const target = b.sites.find((s) => s.owner === 'enemy' && total(s.garrison) < 20);
  assert.ok(target, 'no lightly-held enemy site — this proves nothing');
  b.commands.push({ t: 'SEND', from: home.id, to: target.id, fraction: 1 });
  step(b);
  const sq = b.squads.find((s) => s.owner === 'player' && s.to === target.id);
  assert.ok(sq, 'nothing marched — this proves nothing');
  for (let i = 0; i < 2000 && !b.sites.some((x) => x.id === target.id && x.owner === 'player'); i++) {
    step(b);
  }
  assert.equal(b.sites.find((x) => x.id === target.id)?.owner, 'player',
    'the assault never actually won — pick a weaker target or extend the loop');
  assert.equal(lastKnownGarrison(b, 'player', target.id), undefined,
    'a WON assault left a stale-garrison memory behind — recordFailedAssault has exactly one caller and this is not it');
});
