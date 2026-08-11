// The retired-upgrade refund.
//
// Split out of ./store.js purely for the 400-line cap and re-exported from
// there, so `fromPersisted` still reads as one story and nothing downstream has
// to know this moved. It is a LOAD-PATH migration and nothing else: pure
// arithmetic over a frozen price table, no storage, no clock.
import { RETIRED_UPGRADES, SAFE_MAX_LEVEL } from '../content/upgrades.data.js';

/**
 * Refund every level of an upgrade this build no longer sells, and delete it.
 *
 * The shop collapsed twenty-six capped upgrades into six endless lines. Four of
 * the retired ones were worse than merged — Field Manual, Scout Report,
 * Standing Orders and Wrecking Crew were SOLD and did nothing at all, having no
 * consumer anywhere in the engine. Either way the player paid for a promise this
 * build does not keep, so they get the crowns back at exactly what they were
 * charged (content/upgrades.data.js `RETIRED_UPGRADES` keeps the old prices for
 * precisely this).
 *
 * It happens on LOAD and it is idempotent, because the key is deleted as it is
 * refunded: a save written after the refund has no retired ids left to find.
 * Mutates `upgrades` and returns the crowns owed.
 */
export function refundRetired(upgrades) {
  let owed = 0;
  for (const [id, spec] of Object.entries(RETIRED_UPGRADES)) {
    const level = upgrades[id];
    if (!(level > 0)) continue;
    // `sanitizeLevels` clamps to SAFE_MAX_LEVEL, so this loop is bounded at 64.
    // It is bounded here as well, deliberately: this ran at boot before the page
    // painted, so an unbounded count was an unrecoverable hang on every reload,
    // and one clamp two functions away is a thin guarantee for that. `rate > 1`
    // also drives `owed` to Infinity in about 900 iterations, which then became
    // 0 crowns on the next write — `toPersisted` JSON-round-trips, and Infinity
    // serialises to null.
    const levels = Math.min(level, SAFE_MAX_LEVEL);
    for (let l = 0; l < levels && Number.isFinite(owed); l++) {
      owed += Math.round(spec.base * spec.rate ** l);
    }
    delete upgrades[id];
  }
  return Number.isFinite(owed) ? owed : 0;
}
