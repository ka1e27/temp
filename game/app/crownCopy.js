// Crown copy numbers for the UI, derived from game/config/crowns.js so a balance pass never leaves a stale label behind.
// Every place that says "+25%" about crowns (the victory card's medals, the frontier card's "Crowns: +N% bounty each" and
// its phone "Par 1:00 · crowns +N% bounty each" line, the gallery) reads CROWN_BONUS_PCT; nothing types the number.
import { BOUNTY_FRACTION_PER_CROWN, CROWN_TEXT } from '../config/crowns.js';

/** The crown copy (labels and hints, game/config/crowns.js) the shell hands to the UI kit as plain data: `createResults({ crownTexts })`, `createRegionCard({ crownTexts })`. */
export const CROWN_TEXTS = CROWN_TEXT;

/**
 * The per-crown bounty bonus as the number the copy shows: 0.25 -> 25, 0.125 -> 12.5 (one decimal, so a fractional tuning
 * value is never silently rounded to a different number).
 */
export const CROWN_BONUS_PCT = Number((BOUNTY_FRACTION_PER_CROWN * 100).toFixed(1));
