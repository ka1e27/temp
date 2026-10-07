// Play your way (PLAN-PHASE14 §14B): the tuning numbers of the options. The option state itself lives in game/app/options.js.

// Text size: the root font size (every UI size is in rem), as a share of the browser's own.
export const TEXT_SIZES = Object.freeze({ normal: 1, large: 1.125, larger: 1.25 });
export const TEXT_SIZE_IDS = Object.freeze(['normal', 'large', 'larger']);

// Effects (Full / Reduced / Minimal), alongside Reduce Motion (which still applies on top). Particles: a multiplier on every particle count
// (at least one speck survives: Minimal stays readable). Shake: on the strength. Wisps: on the Ashen wisps spawned and in flight. Pops: how many
// Boon pops may be on screen at once. Confetti: the victory confetti at all. Ambient: birds and the denser smoke on the map.
export const EFFECTS = Object.freeze({
  full: Object.freeze({ particles: 1, shake: 1, wisps: 1, pops: 6, confetti: true, ambient: true }),
  reduced: Object.freeze({ particles: 0.55, shake: 0.5, wisps: 0.6, pops: 4, confetti: true, ambient: true }),
  minimal: Object.freeze({ particles: 0.2, shake: 0, wisps: 0.3, pops: 2, confetti: false, ambient: false }),
});
export const EFFECTS_IDS = Object.freeze(['full', 'reduced', 'minimal']);

// Hold to confirm: how long the press must last (ms). Letting go earlier does nothing.
export const HOLD_CONFIRM_MS = 900;

// Leader voices: the short murmur under a leader's line (game/app/voiceSfx.js).
export const VOICE_SFX = Object.freeze({
  syllables: [3, 5], // how many blips
  syllableSec: 0.085,
  gapSec: 0.035,
  gain: 0.22,
  pitchBase: [150, 300], // Hz, chosen per faction from its id
});
