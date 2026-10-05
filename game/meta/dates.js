// Calendar dates as plain integers (yyyymmdd, e.g. 20261004) for the Daily (PLAN-PHASE9 §9A). Pure arithmetic: no Date anywhere,
// the app layer passes the player's LOCAL date in (`todayYYYYMMDD(new Date())` is an app helper, not this module's job).
// Day numbers use the proleptic Gregorian calendar (Howard Hinnant's days_from_civil), so any date maps to one integer and back.

/** True for a real calendar date written yyyymmdd (years 2000-2999). */
export function isDate(d) {
  if (!Number.isInteger(d) || d < 20000101 || d > 29991231) return false;
  const y = Math.floor(d / 10000);
  const m = Math.floor(d / 100) % 100;
  const day = d % 100;
  return m >= 1 && m <= 12 && day >= 1 && day <= daysInMonth(y, m);
}

function daysInMonth(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** Days since 1970-01-01 of a yyyymmdd date. */
export function dayIndex(d) {
  let y = Math.floor(d / 10000);
  const m = Math.floor(d / 100) % 100;
  const day = d % 100;
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** The yyyymmdd date of a day index (inverse of dayIndex). */
export function fromDayIndex(n) {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return y * 10000 + m * 100 + day;
}

/** `d` plus `k` days (k may be negative). */
export function addDays(d, k) {
  return fromDayIndex(dayIndex(d) + k);
}

/** Whole days from `a` to `b` (b - a). */
export function daysBetween(a, b) {
  return dayIndex(b) - dayIndex(a);
}

/** "2026-10-04" for a yyyymmdd date (labels and ids; the UI may format it its own way). */
export function dateLabel(d) {
  const s = String(d);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
