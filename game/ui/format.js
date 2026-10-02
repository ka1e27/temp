// Number/time formatting for the UI kit (DESIGN §7.5). Pure and
// framework-free so it can also be unit-tested or reused by tools/gallery.
// game/meta never imports this — it only ever returns raw numbers.
//
// shortNumber delegates to game/core/format.js's formatNum so every screen
// in the game agrees on one number format (3 significant digits: 950,
// 1.23K, 12.3K, 123K, 1.20M, ...). That file is owned by the core module;
// this one re-exports it under the name the rest of game/ui already calls.
import { formatNum, toNumber, NO_VALUE } from '../core/format.js';

/**
 * @param {number} n
 */
export function shortNumber(n) {
  return formatNum(n);
}

/** `+950` / `-950` / `+1.2K` — for stat deltas (income change, troop losses). */
export function formatSigned(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return NO_VALUE;
  return n > 0 ? `+${shortNumber(n)}` : shortNumber(n);
}

/**
 * Gold/s rates need more than shortNumber's whole-number floor: the entire
 * early game lives between 1 and 10 gold/s, where "+1/s" for anything from
 * 1.0 to 1.9 would hide the one number idle players watch most closely.
 * Below 10, keep one decimal; from 10 up, fall back to shortNumber.
 */
export function formatRate(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return NO_VALUE; // never "NaN/s"
  const abs = Math.abs(n);
  if (abs < 10) return n.toFixed(1);
  if (abs < 1000) return Math.round(n).toString();
  return shortNumber(n);
}

/** `12%`, or `12.5%` with `decimals: 1`. `fraction` is 0..1 (0.12 → "12%"). */
export function formatPercent(fraction, decimals = 0) {
  if (typeof fraction !== 'number' || !Number.isFinite(fraction)) return NO_VALUE;
  return `${(fraction * 100).toFixed(decimals)}%`;
}

/** `m:ss`, or `h:mm:ss` once it runs past an hour. For battle timers/cooldowns. */
export function formatClock(totalSeconds) {
  if (typeof totalSeconds !== 'number' || !Number.isFinite(totalSeconds)) return '—'; // a NaN or Infinity must never print "NaN:NaN"
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** `4h 12m` / `12m 6s` / `45s` — for "time away" on the welcome-back card; "—" for a non-finite or non-numeric value. */
export function formatDurationWords(totalSeconds) {
  const secs = toNumber(totalSeconds);
  if (!Number.isFinite(secs)) return NO_VALUE;
  const s = Math.max(0, Math.round(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
