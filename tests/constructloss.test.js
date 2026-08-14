// LOSING A BUILDING YOU RAISED, and what happens to the army counting on it.
//
// Split out of tests/construct.test.js for the 400-line cap. Same fixture and the
// same rule: every assertion drives a REAL battle through `state.commands` and
// `step()`, because the failure mode this project keeps hitting is a fixture that
// encodes the bug and passes forever. Both defects pinned here were live — razing
// used to hand the captor a finished building, and the "nowhere to run" fallback
// deleted the army its own comment said it held.
import test from 'node:test';
import assert from 'node:assert/strict';

import { startBattle, step } from '../src/battle/sim.js';
import { buildBlocker } from '../src/battle/commands.js';
import { generateBattleMap, gridHexes } from '../src/battle/mapgen.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { createState } from '../src/core/store.js';
import { markConquered, refreshUnlocks } from '../src/meta/world.js';
import { REGIONS } from '../src/content/regions.data.js';
import { total } from '../src/battle/combat.js';

// Copied verbatim from tests/construct.test.js rather than shared through a
// third file: these two are the whole fixture, and a helper module imported by
// two test files is a place for one of them to be silently re-tuned by a change
// aimed at the other.
/** A real battle for `id`, on the real path, with the enemy AI held off unless
 *  asked otherwise — most of these are about the BUILD, not about surviving it. */
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

const legalHexes = (b, faction = 'player') => gridHexes(b.grid.cols, b.grid.rows)
  .filter((h) => !buildBlocker(b, faction, h));

// ---------------------------------------------------------------------------
// Losing one
// ---------------------------------------------------------------------------

test('build: SCAFFOLDING YOU SEIZE IS RUBBLE — nobody inherits a half-built yard', () => {
  // `buildTicksLeft` is a timer on the SITE, not on its owner. Before this the
  // enemy could walk onto a half-dug yard and have the timer finish it for them:
  // observed on gallowmoor, the site went to 0 HP under an enemy siege and came
  // out the far side at 180/180 in enemy hands.
  const b = battleFor();
  const at = legalHexes(b)[0];
  b.commands.push({ t: 'BUILD', kind: 'trainingGround', hex: [at.q, at.r] });
  step(b);
  const site = b.sites.find((s) => s.hex[0] === at.q && s.hex[1] === at.r);
  const id = site.id;

  // The enemy walks onto it. At 1 HP the first tick of siege damage finishes it.
  site.siege = { owner: 'enemy', comp: { ...b.sites[0].garrison, militia: 20 } };
  step(b);

  assert.equal(b.sites.some((s) => s.id === id), false,
    'the site is still on the board — it changed hands instead of being razed');
  assert.ok(b.events.some((e) => e.type === 'site-razed' && e.siteId === id),
    'nothing announced it');
  assert.equal(b.events.some((e) => e.type === 'site-captured' && e.siteId === id), false,
    'a raze must never be reported as a capture: nobody holds it afterwards');
});

test('build: an army marching at a razed site turns around instead of vanishing', () => {
  // `resolveArrival` returns early when `siteById` finds nothing, and by then the
  // squads have already been taken off the board — so troops in the air toward a
  // razed site would simply cease to exist, with no event and no body count.
  const b = battleFor();
  const at = legalHexes(b)[0];
  b.commands.push({ t: 'BUILD', kind: 'trainingGround', hex: [at.q, at.r] });
  step(b);
  const site = b.sites.find((s) => s.hex[0] === at.q && s.hex[1] === at.r);

  // Reinforce it from wherever can reach, then raze it before they land.
  const from = b.sites.find((s) => s.owner === 'player' && total(s.garrison) > 10);
  b.commands.push({ t: 'SEND', from: from.id, to: site.id, fraction: 0.5 });
  step(b);
  const inAir = b.squads.filter((q) => q.to === site.id);
  assert.ok(inAir.length > 0, 'nothing was in the air — this proves nothing');
  const bodies = inAir.reduce((a, q) => a + total(q.comp), 0);

  site.siege = { owner: 'enemy', comp: { militia: 20 } };
  step(b);
  const stillFlying = b.squads.reduce((a, q) => a + total(q.comp), 0);
  assert.ok(stillFlying >= bodies,
    `${bodies} troops were marching on the razed site and ${stillFlying} are still on the board`);
});

test('build: ...and when it has nowhere to run it CAMPS rather than being deleted', () => {
  // THE OTHER HALF OF THE TEST ABOVE, and the half that was wrong. That one only
  // ever exercises the branch where `reverseSquad` SUCCEEDS, because the player
  // still holds their camp — so the fallback was never run by anything.
  //
  // The fallback read `sq.arriveTick = Infinity; // nowhere to run: it holds`,
  // and the very next statement filtered the squad list on
  // `Number.isFinite(sq.arriveTick)`. Infinity is not finite, so the sentinel
  // meaning "keep this one" was read as "remove it": the army vanished with no
  // event and no body count — precisely the bug the comment above it claims to
  // have fixed. When it was the ENEMY's last column in flight it also handed the
  // player an instant win through `endPhase`'s `!inFlight('enemy')`.
  const b = battleFor();
  const at = legalHexes(b)[0];
  b.commands.push({ t: 'BUILD', kind: 'trainingGround', hex: [at.q, at.r] });
  step(b);
  const site = b.sites.find((s) => s.hex[0] === at.q && s.hex[1] === at.r);

  const from = b.sites.find((s) => s.owner === 'player' && total(s.garrison) > 10);
  b.commands.push({ t: 'SEND', from: from.id, to: site.id, fraction: 0.5 });
  step(b);
  const inAir = b.squads.filter((q) => q.to === site.id);
  assert.ok(inAir.length > 0, 'nothing was in the air — this proves nothing');
  const bodies = inAir.reduce((a, q) => a + total(q.comp), 0);
  const ids = new Set(inAir.map((q) => q.id));

  // Take every scrap of friendly ground away, so there is genuinely nowhere to
  // retreat to, and mark the target razed directly. `siegePhase`'s raze block
  // keys on `s.razed` alone, so setting it is the honest way to construct the
  // precondition — driving a real siege into it cannot reach the fallback, because
  // a captured scaffolding keeps its old owner until after this loop and
  // `retreatTarget` then finds it. That is also exactly why the branch had never
  // once been executed by the suite.
  for (const s of b.sites) if (s.owner === 'player') s.owner = 'enemy';
  site.razed = true;
  step(b);

  const survivors = b.squads.filter((q) => ids.has(q.id));
  const stillThere = survivors.reduce((a, q) => a + total(q.comp), 0);
  assert.equal(stillThere, bodies,
    `${bodies} troops had nowhere to run and ${stillThere} are still on the board`);
  assert.ok(survivors.every((q) => q.camped),
    'a column with nowhere to run must HOLD the ground it stands on');
  assert.ok(survivors.every((q) => q.to === null),
    'a camped column points at no site — its destination is gone');
  assert.ok(survivors.every((q) => q.hex),
    'a camped column must know which hex it is holding, or it draws nowhere');
});
