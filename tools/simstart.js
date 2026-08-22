// HOW A RUN BEGINS — the empire the bot walks in with, and the battle it walks
// into.
//
// Split out of ./simplayer.js at the 400-line cap, along the seam that matters
// rather than at a line number: that file is what the bot DOES, this is the
// state of the world before it does any of it. That distinction is not
// cosmetic here — CLAUDE.md's longest-running balance lesson is that the
// twenty-four measured win rates describe whatever player THIS file builds, so
// `metaFor` deserves to be findable rather than buried at the tail of the
// policy. Both are re-exported from simplayer.js, so no importer has to know.
import { createState } from '../src/core/store.js';
import { markConquered, refreshUnlocks } from '../src/meta/world.js';
import { recalcIncome, incomePerSec } from '../src/meta/idle.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { upgradeTurn } from './simbuild.js';
import { startBattle } from '../src/battle/sim.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { generateFrontierMap } from '../src/battle/frontier.js';
import { FRONTIER_ID } from '../src/content/endless.data.js';
import { spendCrowns, fieldedUnits, doctrineOpt } from './simshop.js';

/**
 * A meta state for a player who has taken `conquered` and idled `idleMinutes`.
 *
 * `legacy` IS A SECOND RUN, and it exists because the claim "abdicating makes the
 * next campaign a victory lap for ten regions and an ordinary fight by the last
 * three" was otherwise unmeasurable: every number this project has ever taken is
 * for a player with zero points, since `metaFor` never abdicates. A design claim
 * nobody can re-take is a design claim nobody will re-take.
 *
 * It is applied BEFORE the crowns are spent, deliberately — a legacy point raises
 * income, so a second-run player has more to spend as well as better troops, and
 * spending first would measure only half the effect.
 */
export function metaFor(conquered, idleMinutes = 0, seed = 1, fielded = null, legacy = 0,
  relics = 0) {
  const state = createState({ seed, now: 0 });
  for (const id of conquered) markConquered(state.meta, id, { now: 0, durationMs: 0 });
  if (legacy > 0) state.meta.legacy = { points: Math.floor(legacy), resets: 1 };
  // RELICS ARE ZERO UNLESS ASKED FOR, and that zero is what every number in
  // content/regions.data.js was measured against — `markConquered` above is why
  // it holds, since relics are paid by meta/rewards.js `applyOutcome` and this
  // function never calls it. `--relics=N` exists so the per-troop lines are
  // MEASURABLE rather than merely believed to be safe: a number nobody can
  // re-take is a number nobody will re-take.
  if (relics > 0) state.meta.relics = Math.floor(relics);
  refreshUnlocks(state.meta, null);
  recalcIncome(state.meta, null);
  if (idleMinutes > 0) {
    spendCrowns(state.meta, incomePerSec(state.meta) * idleMinutes * 60, fielded);
  }
  return state;
}

/**
 * Start one battle for that player. Exposed so a test can drive it tick by
 * tick and watch what the AI does, rather than only reading the verdict.
 *
 * `opts.weights` is a LOADOUT, and until it existed the harness could only ever
 * field one army. `buildBattleConfig` runs `options.composition` through
 * `fitComposition`, which reads the counts as RATIOS against whatever budget the
 * empire granted — so a weights object is a legitimate composition here, and
 * passing one exercises the same seam the pre-battle screen does rather than a
 * parallel path. Omitted, `distributeExpedition` spreads by
 * DEFAULT_COMPOSITION_WEIGHTS exactly as before: every balance number in
 * regions.data.js is measured on that branch and must stay on it.
 *
 * `opts.sightedAi` is the enemy's half of the same escape hatch: it flips
 * `state.ai.sighted` on the live battle object, the one field ai.js
 * `think()` reads for it and nothing else ever writes.
 */
export function startRun(regionId, seed, conquered, idleMinutes = 0, opts = {}) {
  const state = metaFor(conquered, idleMinutes, seed, fieldedUnits(opts.weights),
    opts.legacy ?? 0, opts.relics ?? 0);
  // THE FRONTIER IS A DIFFERENT GENERATOR, NOT A DIFFERENT BOT. The endless
  // mode is one enormous board whose difficulty rises with distance from the
  // camp (battle/frontier.js) — and every rule the bot plays by is unchanged,
  // so it arrives as a `mapGen` swap and nothing else. Same lesson as the
  // incursion ladder one flag along: a mechanic the harness cannot play is a
  // mechanic nobody has measured.
  const gen = regionId === FRONTIER_ID ? generateFrontierMap : generateBattleMap;
  const config = buildBattleConfig(state.meta, regionId, [], gen, {
    seed,
    composition: opts.weights ?? null,
    // `opts.incursion` is a DEPTH on the endless ladder, and the bot plays a rung
    // exactly as it plays a region — the mutators arrive as multipliers, a gate
    // and a smaller landing force, all of which `playerTurn` already reads off the
    // state. Nothing here special-cases them, which is the point: a mechanic the
    // harness cannot play is a mechanic nobody has measured.
    ...(opts.incursion ? { incursion: opts.incursion } : {}),
    // THE CAMPAIGN'S OWN HAND IS ON BY DEFAULT, and `--notwist` is what keeps
    // the delta re-takeable rather than remembered — the house pattern
    // `--noupgrades`/`--noconstruct`/`--noscout` already follow. It is
    // deliberately NOT inert for the harness the way `campaignReplayPlan` is
    // (that one is off because `metaFor` never abdicates): a mechanic the
    // harness cannot play is a mechanic nobody has measured, and regions 10-24
    // now carry mutators in the shipped game.
    ...(opts.noTwist ? { noTwist: true } : {}),
    // THE DOCTRINE, PICKED THE WAY A POPULATION PICKS ONE. The shipped loadout
    // screen offers three from region 2 on and preselects the first, so a bot
    // that took none would be measuring a player who does not exist — the
    // `upgradeTurn` lesson, which cost this project every balance number it had
    // taken up to that point. A SEED-KEYED rotation rather than a fixed pick,
    // so an n=96 sweep splits roughly evenly across the three on offer, which
    // is what a table of players does; `--doctrine=<id>` pins one for a
    // per-doctrine read and `--nodoctrine` reverts to a byte-identical
    // pre-doctrine baseline.
    ...doctrineOpt(regionId, seed, conquered.length, opts),
  });
  const battle = startBattle(config);
  if (opts.sightedAi) battle.ai.sighted = true;
  // `--nomuster` reverts to the enemy that never commits a host
  // (battle/setpiece.js). Set on the live battle rather than passed through the
  // config for the reason `sighted` is: it is a measurement hatch, not a rule
  // of the game, and it must not be able to reach a real player's blob.
  if (opts.noMuster) battle.ai.noMuster = true;
  return battle;
}
