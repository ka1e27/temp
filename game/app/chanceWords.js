// "about 1 in 5": a win chance (0..1) said in a few plain words for the region card's bar (DESIGN 5.3) and the Regions list. Pure: no DOM, no state.
// The chance is rounded to the nearest of a few fractions people read at a glance, so the words never claim more precision than the estimate has.

const ODDS = [
  [1 / 20, 'about 1 in 20'], [1 / 10, 'about 1 in 10'], [1 / 8, 'about 1 in 8'], [1 / 6, 'about 1 in 6'], [1 / 5, 'about 1 in 5'],
  [1 / 4, 'about 1 in 4'], [1 / 3, 'about 1 in 3'], [1 / 2, 'about even'], [2 / 3, 'about 2 in 3'], [3 / 4, 'about 3 in 4'],
  [4 / 5, 'about 4 in 5'], [5 / 6, 'about 5 in 6'], [9 / 10, 'about 9 in 10'],
];

/**
 * @param {number} p chance of winning, 0..1
 * @returns {string} e.g. "about 1 in 5", "about even", "almost certain"; "unknown" for a non-number
 */
export function chanceWords(p) {
  if (typeof p !== 'number' || !Number.isFinite(p)) return 'unknown';
  if (p <= 0.03) return 'almost no chance';
  if (p >= 0.95) return 'almost certain';
  let best = ODDS[0];
  for (const o of ODDS) if (Math.abs(o[0] - p) < Math.abs(best[0] - p)) best = o;
  return best[1];
}
