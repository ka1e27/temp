// Prosperity tuning (DESIGN §5.6). Read by game/meta/prosperity.js (pure), the region card,
// the welcome-back card and the prosperity decor (render/prosperityDecor.js).
//
// A region the player holds grows prosperous with wall-clock TENURE (time since it was
// conquered), also while the game is closed. Levels are never lost while the region is held.

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

export const PROSPERITY = Object.freeze({
  maxLevel: 3,
  // Tenure (ms) needed to reach level 1, 2, 3. Index 0 = level I.
  thresholdsMs: Object.freeze([30 * MIN, 2 * HOUR, 8 * HOUR]),
  // Each level adds this fraction of the region's own income (I +5 %, II +10 %, III +15 %).
  incomeBonusPerLevel: 0.05,
  // Roman numerals for UI text ("Prosperity II"); index = level. Level 0 has no label.
  labels: Object.freeze(['', 'I', 'II', 'III']),
  // Short flavour per level for the region card tooltip.
  blurbs: Object.freeze([
    'Newly held: nothing has grown yet.',
    'Fields spread around the villages.',
    'New cottages and a windmill.',
    'Paved roads and a market.',
  ]),
});
