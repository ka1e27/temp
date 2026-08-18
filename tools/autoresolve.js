// The REAL GAME's headless raid resolver — not the CLI harness's synthetic
// player. `tools/simplayer.js` measures every region in regions.data.js by
// building a THROWAWAY meta state (`metaFor`) and driving it with
// `playerTurn`; this file drives the exact same `startBattle`/`step`/
// `playerTurn` off a REAL BattleConfig instead — the player's actual seed,
// actual upgrades, actual unlocks, built through the same
// `meta/modifiers.js buildBattleConfig` a live Attack uses.
//
// KEPT OUTSIDE src/ ON PURPOSE. `src/battle/**` and `src/meta/**` may not
// import each other except through `src/battle/contract.js` (see that file),
// so the actual bridge — build a config, step the sim, hand back the facts —
// lives here, exactly where `tools/simplayer.js` already has to put it for
// the CLI. `src/meta/autobattle.js` is the ONLY file under src/ that imports
// this one; that is the whole seam, and `grep -rn "tools/autoresolve" src/`
// finds exactly one IMPORT (four lines, the other three being prose in that
// same file). The count is written out because an "exactly N" claim nobody can
// reproduce from the command beside it is worse than no claim — this one said
// "one line" and reading it literally makes the seam look broken.
import { startBattle, step } from '../src/battle/sim.js';
import { toOutcome } from '../src/battle/outcome.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { playerTurn } from './simplayer.js';

/** Ticks between bot re-think — identical to `tools/simplayer.js` `playOne`,
 *  so a chunked resolve and a CLI `playOne` issue commands on the exact same
 *  ticks and cannot diverge on that account. */
const THINK_EVERY_TICKS = 20;

/**
 * The config a raid actually fights.
 *
 * The real meta state (so the real world seed, the real upgrades, the real
 * unlocked units all apply) — NOT the harness's throwaway `metaFor()`. No
 * composition override: the default spread is the one every win rate in
 * regions.data.js was measured against (see src/meta/autobattle.js for why
 * that is the right default and not merely a shortcut). No boosters: the
 * harness never fires one either, so this keeps "the same player" true all
 * the way down to the one thing a bot cannot use for itself.
 *
 * @param {object} rootState  the ROOT game state, not the meta slice —
 *   `buildBattleConfig` reads the world seed off the root only
 *   (meta/modifiers.js; screens/battle.js makes the identical choice for the
 *   identical reason).
 */
export function buildRaidConfig(rootState, regionId) {
  return buildBattleConfig(rootState, regionId, [], generateBattleMap, {});
}

/**
 * A battle driven by the harness bot, advanceable in small tick batches
 * instead of run to completion in one call. The caller (a screen) decides how
 * much wall-clock time to spend before asking for the next batch — this file
 * has no notion of frames, wall time or a scheduler at all, which is what
 * keeps it callable from a plain unit test as easily as from a browser.
 *
 * @param {object} config  a BattleConfig, already validated
 *   (`buildBattleConfig` asserts it before returning)
 */
export function createResolver(config) {
  const battle = startBattle(config);
  const cap = battle.rules.hardCapTicks;
  let nextThink = 0;
  const finished = () => battle.status !== 'running' || battle.tick >= cap;
  return {
    get battle() { return battle; },
    get done() { return finished(); },
    /**
     * Advance up to `n` ticks, stopping early if the battle ends first.
     * Mirrors `tools/simplayer.js` `playOne`'s own loop exactly — the same
     * think cadence, the same step order — so calling this in one batch of
     * 20,000 or two thousand batches of 10 reaches the identical state.
     * @returns {boolean} true once the battle has ended
     */
    advance(n) {
      for (let i = 0; i < n && !finished(); i++) {
        if (battle.tick >= nextThink) {
          playerTurn(battle);
          nextThink = battle.tick + THINK_EVERY_TICKS;
        }
        step(battle);
      }
      return finished();
    },
    /** Facts only, meaningful once `done`. meta/rewards.js `applyOutcome` is
     *  what turns this into money — deliberately not called from anywhere in
     *  this file, so there is exactly one payout path, not a second one that
     *  merely LOOKS like the first. */
    outcome() { return toOutcome(battle, config); },
  };
}
