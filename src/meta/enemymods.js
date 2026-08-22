// THE ENEMY'S SIDE OF THE SEAM — one difficulty dial spread across ten fields.
//
// Split out of ./modifiers.js at the 400-line cap, along the seam that matters
// rather than at a line number: this file answers "what does the enemy get",
// which is a balance question with its own long-running argument in it, and
// modifiers.js answers "how is a BattleConfig assembled", which is plumbing.
// Re-exported from modifiers.js, so no importer has to know it moved.
//
// PURE, and a pure MOVE — the 288 real configs a snapshot takes across four
// empire sizes, twenty-four regions and three seeds are byte-identical either
// side of the split.
import { makeMods } from '../battle/contract.js';
import {
  ENEMY_SCALING, ENEMY_UNITS_BY_TIER, BATTLE_START,
} from '../content/regions.data.js';
import { atTier } from '../content/tiers.js';
import { zeroComposition } from './composition.js';
import { stack } from './stacking.js';

const zeroComp = zeroComposition;

/**
 * The enemy's single difficulty dial, `enemyMult`, spread across its mods by
 * the ENEMY_SCALING exponents. Per-AI-tier knobs ride the `multiplicative`
 * bucket; the region's dial rides `tier`, which is applied last.
 */
export function enemyMods(region, mult) {
  const t = (exp) => mult ** exp;
  return makeMods({
    startGold: stack(BATTLE_START.enemyGold, { tier: t(ENEMY_SCALING.gold) }),
    expedition: zeroComp(), // the enemy's head start is LAND, not a free army
    // `AI_TIERS[].economyMult` is DELIBERATELY ABSENT from these two.
    //
    // battle/economy.js `siteGoldPerSec` already multiplies every enemy site by
    // `economyMultFor(state, faction)`, which is the same AI_TIERS number. It
    // used to ride here as well — on goldRateMult AND on farmYieldMult — so an
    // enemy farm, which is multiplied by both, felt the handicap THREE times and
    // an enemy castle twice. At tier 4 that turned an advertised x1.35 into
    // x2.46 and the endgame enemy earned eighteen times what the player did
    // (obsidian, measured: 537 gold/s against 30). Two files each thought they
    // owned the knob. economy.js applies it; this file does not.
    goldRateMult: stack(1, { tier: t(ENEMY_SCALING.gold) }),
    trainSpeedMult: stack(1, { tier: t(ENEMY_SCALING.train) }),
    trainCostMult: stack(1),
    unitAtkMult: stack(1, { tier: t(ENEMY_SCALING.atk) }),
    unitDefMult: stack(1, { tier: t(ENEMY_SCALING.def) }),
    marchSpeedMult: stack(1),
    farmYieldMult: stack(1, { tier: t(ENEMY_SCALING.gold) }),
    garrisonCapBonus: stack(0),
    siegeDmgMult: stack(1, { tier: t(ENEMY_SCALING.atk) }),
    structureRegenMult: stack(1, { tier: t(ENEMY_SCALING.def) }),
    // Clamped to the LENGTH of the table, not to a literal 4. The hardcoded
    // number silently capped tier 5 at the tier-4 roster the moment a fifth
    // tier shipped — the same class of bug as `knobsFor` in battle/aicore.js,
    // which clamps to `AI_TIERS.length - 1` and is why that one was fine.
    unlockedUnits: [...atTier(ENEMY_UNITS_BY_TIER, region.tier)],
  });
}
