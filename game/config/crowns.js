// Battle crowns tuning (DESIGN §4.8). Every number the crown system uses lives here;
// game/meta/crowns.js reads it and hard-codes nothing. The balance harness calibrates the
// par times (goal: a competent bot earns Swift about half the time) — edit this file only.

/** The three crowns, in display order. Also the keys of every stored/returned crown object. */
export const CROWN_KEYS = Object.freeze(['victory', 'swift', 'unbroken']);

/**
 * Par time = battle seconds (`battle.t`, so 1x/2x/3x/pause never matter) a win must not exceed
 * to earn Swift. Resolved per region as: capital -> `capitalSec`, otherwise the first band whose
 * [minTier, maxTier] contains the region's `tier`.
 *
 * Bands (region.tier = graph distance from the start region, see world contract):
 *   early  tiers 0-2   the Free Folk ring and the first rival regions
 *   mid    tiers 3-5   the body of the campaign
 *   deep   tiers 6+    late regions; starts equal to mid, split out only so balance can lift
 *                      them without touching mid
 * A rival capital is always the capital band, whatever its tier.
 *
 * Calibrated (tools/campaign.mjs, 48 seeds, the 3-second-cadence bot): each par is the MEDIAN winning battle of its band,
 * so a competent player earns Swift about half the time in every band: early 90 s, mid 84 s, deep 92 s, capital 85 s.
 * A person takes roughly 1.5x the bot's time (tutorial fight: 61 s against 41 s), so expect Swift nearer a third for a
 * casual player; lift a band here to make it easier.
 */
export const PAR = Object.freeze({
  bands: Object.freeze([
    Object.freeze({ id: 'early', minTier: 0, maxTier: 2, parSec: 90 }),
    Object.freeze({ id: 'mid', minTier: 3, maxTier: 5, parSec: 85 }),
    Object.freeze({ id: 'deep', minTier: 6, maxTier: Infinity, parSec: 90 }),
  ]),
  capitalSec: 85,
  // Later dynasties fight tougher enemies; seconds added to every par per dynasty level above 1.
  // 0 = par does not move with the dynasty (starting value; a balance lever).
  perDynastySec: 0,
  // A win at exactly par must count even if summing 0.05 s ticks left 60.0000000001 s.
  toleranceSec: 0.001,
});

/** Each crown adds this fraction of the region's bounty (DESIGN §4.8: +25%). */
export const BOUNTY_FRACTION_PER_CROWN = 0.25;

/** Crowns granted by accepting a surrender (DESIGN §4.8: Victory only). */
export const SURRENDER_CROWNS = Object.freeze(['victory']);

/** Player-facing crown copy, shared by the UI and the hookup doc. `{par}` is filled by the UI. */
export const CROWN_TEXT = Object.freeze({
  victory: { label: 'Victory', hint: 'Win the battle.' },
  swift: { label: 'Swift', hint: 'Win within the par time (battle time, at any speed).' },
  unbroken: { label: 'Unbroken', hint: 'Win without losing a settlement you started the battle with.' },
});
