// Number/time formatting for the simulation layer (gold amounts, rates,
// cooldowns, perk percentages). PURE — returns plain strings, touches nothing
// browser-specific. See the final report for how this differs from
// game/ui/format.js, built independently against DESIGN §7.5's prose examples.

const NAMED_SUFFIXES = ['', 'K', 'M', 'B', 'T'];

/** 'aa', 'ab', ..., 'az', 'ba', ... for magnitudes past T (3 sig figs each). */
function letterSuffix(tierPastNamed) {
  const first = Math.floor(tierPastNamed / 26);
  const second = tierPastNamed % 26;
  return String.fromCharCode(97 + (first % 26)) + String.fromCharCode(97 + second);
}

function suffixForTier(tier) {
  if (tier < NAMED_SUFFIXES.length) return NAMED_SUFFIXES[tier];
  return letterSuffix(tier - NAMED_SUFFIXES.length);
}

/**
 * Decimal places for `value` (already divided down into its tier) that keep
 * it readable: tier 0 (no suffix) shows one decimal only while under 10 and
 * non-integer; every suffixed tier keeps 3 significant digits throughout.
 */
function decimalsFor(tier, value) {
  if (tier === 0) return value < 10 && !Number.isInteger(value) ? 1 : 0;
  if (value < 10) return 2;
  if (value < 100) return 1;
  return 0;
}

/**
 * Short number formatting: below 1000 shows a plain integer (one decimal only
 * when the value is under 10 and not whole, e.g. "4.5"); at and above 1000,
 * scales by powers of 1000 with the suffix K/M/B/T, then two-letter suffixes
 * aa/ab/ac/... — always keeping 3 significant digits (1.23K, 12.3K, 123K).
 * @param {number} n
 */
export function formatNum(n) {
  if (!Number.isFinite(n)) return n > 0 ? '∞' : n < 0 ? '-∞' : 'NaN';
  const neg = n < 0;
  const x = Math.abs(n);

  let tier = 0;
  if (x >= 1000) {
    tier = Math.floor(Math.log(x) / Math.log(1000));
    // Floating-point guard: nudge `tier` until x/1000^tier lands in [1, 1000).
    while (x / 1000 ** tier >= 1000) tier++;
    while (tier > 1 && x / 1000 ** tier < 1) tier--;
  }

  let value = x / 1000 ** tier;
  let decimals = decimalsFor(tier, value);
  let rounded = Number(value.toFixed(decimals));

  // Rounding can carry across a tier boundary either way — up into the next
  // suffix (999.96 -> "1000" -> 1.00K) or, within a tier, across an internal
  // sig-fig boundary (99.99K -> 100K). Converge on a stable answer; each hop
  // strictly increases tier or coarsens decimals, so this terminates fast.
  for (let guard = 0; guard < 5; guard++) {
    if (rounded >= 1000) {
      tier++;
      value = x / 1000 ** tier;
      decimals = decimalsFor(tier, value);
      rounded = Number(value.toFixed(decimals));
      continue;
    }
    const newDecimals = decimalsFor(tier, rounded);
    if (newDecimals !== decimals) {
      decimals = newDecimals;
      rounded = Number(rounded.toFixed(decimals));
      continue;
    }
    break;
  }

  const out = tier === 0
    ? (decimals === 1 ? rounded.toFixed(1) : String(rounded))
    : rounded.toFixed(decimals) + suffixForTier(tier);
  return neg ? `-${out}` : out;
}

/** A per-second rate with an explicit sign, e.g. `formatRate(1.2)` -> "+1.2/s". */
export function formatRate(n) {
  const sign = n < 0 ? '-' : '+';
  return `${sign}${formatNum(Math.abs(n))}/s`;
}

/**
 * Duration as the largest one or two units, e.g. "12s", "4m 05s", "3h 12m",
 * "2d 4h". Seconds are always zero-padded when shown next to minutes;
 * minutes/hours are not padded when shown next to the unit above them.
 * @param {number} sec
 */
export function formatDuration(sec) {
  const total = Math.max(0, Math.floor(sec));
  if (total < 60) return `${total}s`;
  if (total < 3600) {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}m ${String(s).padStart(2, '0')}s`;
  }
  if (total < 86400) {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    return `${h}h ${m}m`;
  }
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  return `${d}d ${h}h`;
}

/**
 * A signed whole-number percentage, e.g. `formatPct(0.12)` -> "+12%".
 * `x` is a fraction (0.12 means 12%), matching how perk/upgrade bonuses are
 * stored (see game/meta/perks.js's PERK_PCT table).
 * @param {number} x
 */
export function formatPct(x) {
  const v = Math.round(x * 100);
  const sign = v < 0 ? '-' : '+';
  return `${sign}${Math.abs(v)}%`;
}
