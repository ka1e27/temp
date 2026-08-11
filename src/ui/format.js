// Number, duration and percentage formatting.
//
// PURE: no DOM, no clock. Every string the player reads goes through here, so
// "1.2K" means the same thing in the HUD, on the canvas and in the results
// screen. Widths are kept stable (see the tabular-nums rule in tokens.css) —
// in an idle game a digit that changes width reads as a bug.

/**
 * The suffix ladder, largest first.
 *
 * IT USED TO STOP AT `T`, AND THE GAME REACHES PAST IT. The Crown tier
 * (content/upgrades.data.js) bases at 350,000 and compounds at 1.60, so a level
 * in the fifties costs about 4e18 — which rendered as "4100000T": eight
 * characters, in a column sized for five, in a game whose whole formatting rule
 * is that a number must not change width. At 1e30 it was twenty characters.
 *
 * Past `T` the suffixes are the short-scale abbreviations the incremental genre
 * has settled on (Qa, Qi, Sx, Sp, Oc, No, Dc), which is worth more than being
 * clever: a player who has seen one idle game already knows them. `Dc` is 1e33,
 * comfortably past `SAFE_MAX_LEVEL` on every line in the shop, and anything
 * beyond it falls through to exponential rather than growing without bound.
 */
const UNITS = [
  [1e33, 'Dc'],
  [1e30, 'No'],
  [1e27, 'Oc'],
  [1e24, 'Sp'],
  [1e21, 'Sx'],
  [1e18, 'Qi'],
  [1e15, 'Qa'],
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'K'],
];

/**
 * Compact magnitude: 1.2K, 12K, 3.4M, 4.1Qi. Values under 1000 render whole.
 * One decimal only below 10 of a unit, so the string never exceeds 6 characters
 * — five for the single-letter suffixes, six for the two-letter ones — and never
 * grows with the magnitude. tests/format.test.js pins that bound across the
 * whole reachable range, because the old five-character promise was a comment
 * rather than a check and stopped being true somewhere nobody was looking.
 * @param {number} n
 * @returns {string}
 */
export function compact(n) {
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '—';
  const neg = n < 0;
  const v = Math.abs(n);
  let out;
  if (v < 1000) {
    out = String(Math.round(v));
  } else if (v >= 1e36) {
    // Past the ladder, say so in exponential rather than inventing suffixes: two
    // significant figures, still short, and unambiguous. Unreachable in normal
    // play — it is here so a hand-edited save cannot produce a 30-character cell.
    out = v.toExponential(1).replace('e+', 'e');
  } else {
    out = '';
    for (const [scale, suffix] of UNITS) {
      if (v < scale) continue;
      const x = v / scale;
      out = (x < 10 ? trimZero(x.toFixed(1)) : String(Math.round(x))) + suffix;
      break;
    }
  }
  return neg ? '-' + out : out;
}

const trimZero = (s) => (s.endsWith('.0') ? s.slice(0, -2) : s);

/** Fixed-decimal, used wherever the preview must be exact (AP 239.8). */
export function fixed(n, digits = 1) {
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '—';
  return n.toFixed(digits);
}

/** Whole number with thousands separators: 1,234. */
export function integer(n) {
  if (!Number.isFinite(n)) return '—';
  const s = String(Math.round(Math.abs(n)));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return (n < 0 ? '-' : '') + out;
}

/**
 * Durations the player reads as a decision: sub-10s gets a decimal because
 * 4.2s vs 4.9s changes whether you commit; above that it never matters.
 * Infinity is a real, meaningful answer here — a siege that cannot breach.
 */
export function duration(sec) {
  if (!Number.isFinite(sec)) return '∞';
  if (sec < 0) return '0s';
  if (sec < 10) return trimZero(sec.toFixed(1)) + 's';
  // Round to whole seconds BEFORE splitting: float siege maths lands on
  // 249.99999999999977, and truncating that to 4:09 is a visible lie.
  const whole = Math.round(sec);
  // ...and round before choosing the FORMAT as well, which is the same rule one
  // step earlier. `sec < 60` on the raw value printed 59.6 as "60s" — a reading
  // the m:ss band can never produce, so the display jumped 59s, 60s, 1:00.
  if (whole < 60) return whole + 's';
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  if (m < 60) return `${m}:${String(s).padStart(2, '0')}`;
  const h = Math.floor(m / 60);
  return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Clock readout for the battle timer — always m:ss, never a bare seconds count. */
export function clock(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

/** 0.5 -> "50%". */
export function percent(frac, digits = 0) {
  if (!Number.isFinite(frac)) return '—';
  return (frac * 100).toFixed(digits) + '%';
}

/** Income and drain lines: "+2.4/s", "-1.0/s". */
export function rate(n, digits = 1) {
  if (!Number.isFinite(n)) return '—';
  return (n >= 0 ? '+' : '-') + Math.abs(n).toFixed(digits) + '/s';
}

/** Explicit sign, for deltas. */
export function signed(n) {
  return (n >= 0 ? '+' : '-') + compact(Math.abs(n));
}

/** "3 survive" / "1 survives" — plural agreement without a template mess. */
export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * 'trainingGround' -> 'training Ground'. Site kind ids are camelCase; every
 * place that shows one to the player wants words, not a raw identifier run
 * together. Every kind id but this one is already a single lowercase word,
 * so this is a no-op for `farm`/`stronghold`/`camp`/`castle` — it only does
 * anything the day a second multi-word kind id exists. Casing is left to the
 * caller: the site panel title wants it upper, the HUD alert line wants it
 * lower, and both already apply their own case to the single-word kinds.
 */
export function spaceCase(id) {
  return String(id).replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

/**
 * Interned small-integer strings. `String(n)` inside a per-frame canvas text
 * loop is the last remaining allocation in the draw path; a lazy table removes
 * it for the range that garrison and squad counts ever occupy.
 */
const NUM_STR = [];
export function numStr(n) {
  if (!Number.isInteger(n) || n < 0 || n > 999) return String(n);
  return NUM_STR[n] || (NUM_STR[n] = String(n));
}
