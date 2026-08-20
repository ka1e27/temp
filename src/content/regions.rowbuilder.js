// The region table's ROW BUILDER — split out of ./regions.rules.js when
// authoring the enemy's site MIX (rather than a flat count) needed room the
// table could not spare, the same reason BASE_GARRISON and friends split out
// to ./regions.fallback.js. `T()` has exactly one importer (regions.data.js),
// so unlike those constants there is no external re-export to keep resolving.
// PURE DATA. No logic reads a number that is not defined here or in balance.js.
import {
  DEVELOP_CLAMP, GATE_CLAMP, HARD_CAP_MIN_BY_TIER, HARD_CAP_RATIO,
} from './regions.rules.js';
// Clamped rather than indexed: `HARD_CAP_MIN_BY_TIER[tier - 1]` on a tier the
// table has no row for is `undefined`, and `Math.max(undefined, x)` is NaN — a
// cap of NaN minutes that reads downstream as an ordinary refusal rather than
// as a missing table row. See content/tiers.js.
import { atTier } from './tiers.js';

/**
 * THE ROW BUILDER. Every line of it is a statement about EVERY region — the
 * two clamps, and the hard cap being derived rather than authored — which is
 * why it lived beside them in regions.rules.js and still does, one file over.
 *
 * id, name, tier, hex, adjacentTo, enemyMult, cols, rows, siteCounts,
 * develop, castleGateFrac, rewardPerSec, targetLengthMin, flavour, shape
 *
 * `siteCounts` is `[enemyMix, neutral, player]`, and `enemyMix` is
 * `[forts, grounds, farms]` — the enemy's sites beyond the castle, split by
 * kind. THIS IS THE STRUCTURAL CHANGE: `siteCounts[0]` used to be a flat
 * count that battle/mapgen.js `planSites` turned into forts/yards/farms by
 * rounding two global shares (MAPGEN.enemyStrongholdShare, fortShareOfHolds),
 * and that derivation has a floor no global share can lift — riverfen's four
 * extra sites round to exactly one hold whatever the shares are, so "the
 * tier-1 enemy trains from two yards instead of one" was never expressible
 * without moving every other region's mix along with it. Authoring the mix
 * directly is what lets a tuner say that about ONE row; `battle/mapgen.js`
 * `planSites` uses it when a region supplies one and falls back to the old
 * derivation when it does not (a hand-built regionSpec — a test fixture, an
 * ad hoc `tools/simrunner.js` row — has no mix to read).
 *
 * `enemy` (the total, castle included) is DERIVED from the mix here —
 * `forts + grounds + farms + 1` — rather than authored alongside it: two
 * numbers that both claim the same fact are two numbers that can disagree,
 * and every existing reader of `siteCounts.enemy` (totalSites, the world map,
 * the non-decreasing checks in tests/campaign.test.js) keeps reading a plain
 * number and never has to learn the mix exists.
 *
 * `shape` is LAST and optional because it arrived last and because omitting it
 * means `open` — the rectangle every one of these rows was measured on. See
 * regions.rules.js SHAPE_RULE for what a shape is allowed to be and why the
 * table only spends it where the flavour text already promised it.
 */
export const T = (id, name, tier, hex, adjacentTo, enemyMult, cols, rows, siteCounts,
  develop, castleGateFrac, rewardPerSec, targetLengthMin, flavour, shape = 'open') => {
  const [enemyMix, neutral, player] = siteCounts;
  const [forts, grounds, farms] = enemyMix;
  return {
    id, name, tier, hex, adjacentTo, enemyMult,
    grid: { cols, rows },
    siteCounts: {
      enemy: forts + grounds + farms + 1,
      enemyMix: { forts, grounds, farms },
      neutral,
      player,
    },
    develop: DEVELOP_CLAMP(develop),
    castleGateFrac: GATE_CLAMP(castleGateFrac),
    rewardPerSec, targetLengthMin, flavour, shape,
    hardCapMs: Math.round(
      Math.max(atTier(HARD_CAP_MIN_BY_TIER, tier), targetLengthMin * HARD_CAP_RATIO) * 60 * 1000,
    ),
    startsUnlocked: false,
  };
};
