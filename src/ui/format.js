// Number, duration and percentage formatting.
//
// PURE: no DOM, no clock. Every string the player reads goes through here, so
// "1.2K" means the same thing in the HUD, on the canvas and in the results
// screen. Widths are kept stable (see the tabular-nums rule in tokens.css) —
// in an idle game a digit that changes width reads as a bug.

const UNITS = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'K'],
];

/**
 * Compact magnitude: 1.2K, 12K, 3.4M. Values under 1000 render whole.
 * One decimal only below 10 of a unit, so the string never exceeds 5 chars.
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
  if (sec < 60) return Math.round(sec) + 's';
  // Round to whole seconds BEFORE splitting: float siege maths lands on
  // 249.99999999999977, and truncating that to 4:09 is a visible lie.
  const whole = Math.round(sec);
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
 * Interned small-integer strings. `String(n)` inside a per-frame canvas text
 * loop is the last remaining allocation in the draw path; a lazy table removes
 * it for the range that garrison and squad counts ever occupy.
 */
const NUM_STR = [];
export function numStr(n) {
  if (!Number.isInteger(n) || n < 0 || n > 999) return String(n);
  return NUM_STR[n] || (NUM_STR[n] = String(n));
}
