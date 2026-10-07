// Play your way (PLAN-PHASE14 §14B): the player's options that belong to the DEVICE and the person, not to a realm. They are kept under their own
// storage key, so they survive New Realm, Reset Save, an import and a challenge, and a save code never carries one person's text size to another.
// (Sound, music and effects volume, Reduce Motion, hints, slow battles and leader voices stay in `state.settings`, game/meta/save.js, as before.)
// No DOM here: storage is injected. Every value is whitelisted and clamped on load.
import { PALETTE_IDS } from '../config/palettes.js';
import { TEXT_SIZE_IDS, EFFECTS_IDS } from '../config/options.js';
import { KEY_ACTIONS, defaultBindings, sanitizeBindings } from '../ui/keymap.js';

export const OPTIONS_KEY = 'hexdominion.options.v1';

export function defaultOptions() {
  return {
    palette: 'default', // config/palettes.js
    patterns: false, // the territory pattern overlay
    textSize: 'normal', // config/options.js TEXT_SIZES
    highContrast: false,
    effects: 'full', // config/options.js EFFECTS
    holdToConfirm: false, // Retreat, Reset Save, a New Realm over a save, Demolish: press and hold instead of a tap
    voicesVolume: 0.7, // the leader voices' murmur
    muteHidden: true, // silence while the tab is hidden
    keys: defaultBindings(), // action -> KeyboardEvent.code
  };
}

const oneOf = (v, list, d) => (list.includes(v) ? v : d);

/** @param {unknown} raw @returns {ReturnType<typeof defaultOptions>} */
export function sanitizeOptions(raw) {
  const d = defaultOptions();
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const bool = (k) => (typeof src[k] === 'boolean' ? src[k] : d[k]);
  const unit = (k) => (typeof src[k] === 'number' && Number.isFinite(src[k]) ? Math.min(1, Math.max(0, src[k])) : d[k]);
  return {
    palette: oneOf(src.palette, PALETTE_IDS, d.palette),
    patterns: bool('patterns'),
    textSize: oneOf(src.textSize, TEXT_SIZE_IDS, d.textSize),
    highContrast: bool('highContrast'),
    effects: oneOf(src.effects, EFFECTS_IDS, d.effects),
    holdToConfirm: bool('holdToConfirm'),
    voicesVolume: unit('voicesVolume'),
    muteHidden: bool('muteHidden'),
    keys: sanitizeBindings(src.keys),
  };
}

/** Reads the options (defaults when there are none, or when storage is off or holds junk). */
export function loadOptions(storage) {
  try {
    const text = storage && storage.getItem(OPTIONS_KEY);
    return sanitizeOptions(text ? JSON.parse(text) : null);
  } catch {
    return defaultOptions();
  }
}

/** Writes the options; false when storage refused (private mode, full). */
export function saveOptions(storage, options) {
  try {
    storage.setItem(OPTIONS_KEY, JSON.stringify(sanitizeOptions(options)));
    return true;
  } catch {
    return false;
  }
}

export { KEY_ACTIONS };
