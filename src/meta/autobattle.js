// The ONE seam that lets the shipped game reuse the CLI harness's bot.
//
// Combat is deterministic (invariant 3) and `tools/autoresolve.js` drives the
// exact same `startBattle`/`step`/`playerTurn` that `tools/simplayer.js`
// measures every region in regions.data.js with — so a raid resolved here and
// a raid played out by hand against the same policy reach the identical
// outcome. That is not an estimate, it is the same function called twice; see
// `tests/autobattle.test.js` for the byte-identical assertion.
//
// `meta/**` may import `battle/**` only through `battle/contract.js` (see
// that file's header) — so the code that actually drives the sim lives
// OUTSIDE src/, in tools/autoresolve.js, which is the only thing this file
// imports from outside meta/**. That is exactly the bridge tools/simplayer.js
// already builds for the CLI; this file does not duplicate it, it reuses it.
//
// PAYOUT IS DELIBERATELY NOT HERE. This file hands a finished BattleOutcome
// back to its caller (a screen), which passes it to screens/results.js
// exactly as a played battle does — the SAME call to meta/rewards.js
// applyOutcome, not a second one that could drift from it.
//
// PURE: no clock, no DOM, no animation-frame scheduler. Spreading the work
// across frames is the caller's job (screens/worldmap-autobattle.js) — this
// file only ever counts ticks, never wall-clock time.
import { createResolver, buildRaidConfig } from '../../tools/autoresolve.js';
import { canRaid } from './world.js';

export { buildRaidConfig };

/** Ticks resolved per call to `advanceOrFinish` when the caller does not say
 *  otherwise. A screen chunking this across frames picks its own number based
 *  on how much wall-clock time a batch actually costs; this is just a sane
 *  size for a caller (a test, say) that does not care. */
export const AUTO_RESOLVE_CHUNK_TICKS = 40;

/**
 * Raids only. A region's FIRST conquest and any INCURSION rung are refused —
 * the real-time battle IS the content there, and a first clear alone pays the
 * relic bonus (meta/rewards.js `conquestRelics`) a raid never does.
 *
 * `canRaid` already excludes an unconquered region (never a raid) and a
 * region still on cooldown, so the only new rule here is the incursion guard:
 * `opts.incursion` mirrors `buildBattleConfig`'s own option, so a caller that
 * mistakenly carried a rung's depth through here is refused rather than
 * charged as a raid on the same ground.
 *
 * @param {object} meta  the meta SLICE (e.g. `ctx.state.meta`) — matches
 *   `canRaid`'s own convention. See `startAutoResolve` for why the function
 *   that builds the actual battle needs the ROOT state instead.
 * @param {string} regionId
 * @param {number} now
 * @param {{incursion?:number}} [opts]
 */
export function canAutoResolve(meta, regionId, now, opts = {}) {
  if (opts.incursion) return false;
  return canRaid(meta, regionId, now);
}

/**
 * Begin a raid's headless resolution against the player's real empire.
 *
 * @param {object} rootState  the ROOT game state (`ctx.state`), not the meta
 *   slice — `buildRaidConfig` needs the world seed, which lives at the root
 *   (see tools/autoresolve.js and meta/modifiers.js `buildBattleConfig` for
 *   the shipped bug this distinction already fixed once).
 * @param {string} regionId
 * @param {number} now
 * @throws {RangeError} if `canAutoResolve` would refuse this region — the
 *   caller is expected to have already checked, exactly as the world map only
 *   ever shows the Raid button when `canRaid` is true.
 * @returns {{config:object, advanceOrFinish:(n?:number)=>object}}
 */
export function startAutoResolve(rootState, regionId, now) {
  const meta = rootState?.meta ?? rootState;
  if (!canAutoResolve(meta, regionId, now)) {
    throw new RangeError(`startAutoResolve: "${regionId}" is not a raid right now`);
  }
  const config = buildRaidConfig(rootState, regionId);
  const resolver = createResolver(config);
  return {
    config,
    /**
     * Advance one chunk of the fight.
     * @returns {{done:boolean, tick:number, capTicks:number, outcome:?object}}
     *   `outcome` is null until `done` — facts only, meta/rewards.js turns it
     *   into money, and only the caller decides when to ask it to.
     */
    advanceOrFinish(n = AUTO_RESOLVE_CHUNK_TICKS) {
      const done = resolver.advance(n);
      return {
        done,
        tick: resolver.battle.tick,
        capTicks: resolver.battle.rules.hardCapTicks,
        outcome: done ? resolver.outcome() : null,
      };
    },
  };
}
