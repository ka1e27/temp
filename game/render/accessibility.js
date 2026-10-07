// Render-side options (PLAN-PHASE14 §14B): the colour-vision preset, the territory pattern overlay and the Effects level. One module-wide state
// that every renderer reads at draw time; main.js sets it from the player's options and invalidates the caches that baked the old look.
//
// The preset is applied by REPAINTING the faction records in place: the eight objects inside config/world.js FACTIONS (the array is frozen,
// its records are not) and the copies a World carries in `world.factions`. Every drawing path already reads `faction.color / colorDark /
// colorLight` at draw time, and every sprite cache keys on the colour, so nothing else needs to know a preset exists. The default colours are
// snapshotted at load and restored exactly by the Default preset. Colours never reach the simulation or the save.
import { FACTIONS } from '../config/world.js';
import { PALETTES, PATTERNS } from '../config/palettes.js';
import { EFFECTS } from '../config/options.js';

const DEFAULTS = FACTIONS.map((f) => ({ color: f.color, colorDark: f.colorDark, colorLight: f.colorLight }));
const CSS_VARS = ['--faction-player', '--faction-freefolk', '--faction-crimson', '--faction-violet', '--faction-amber', '--faction-ashen', '--faction-seakings', '--faction-usurper'];

let paletteId = 'default';
let patternsOn = false;
let effectsId = 'full';
let version = 0; // bumps on any change of look: caches keyed on it rebuild

/** The colours faction `id` wears under preset `pid` (the default record when the preset has none). */
export function presetColors(pid, id) {
  const p = PALETTES[pid];
  return (p && p.colors && p.colors[id]) || DEFAULTS[id] || null;
}

function paint(rec, id) {
  const c = presetColors(paletteId, id);
  if (!rec || !c) return;
  rec.color = c.color;
  rec.colorDark = c.colorDark;
  rec.colorLight = c.colorLight;
}

/** Repaints a World's faction copies in the current preset (call after every world change). */
export function paintWorld(world) {
  if (!world || !Array.isArray(world.factions)) return;
  for (const f of world.factions) if (f && Number.isInteger(f.id)) paint(f, f.id);
}

/**
 * Sets the colour-vision preset: repaints FACTIONS, the given world's factions and the CSS faction tokens. True when it changed.
 * @param {string} id 'default' | 'deutan' | 'tritan'
 */
export function setPalette(id, world) {
  const next = PALETTES[id] ? id : 'default';
  const changed = next !== paletteId;
  paletteId = next;
  FACTIONS.forEach((f, i) => paint(f, i));
  paintWorld(world);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    CSS_VARS.forEach((v, i) => { const c = presetColors(paletteId, i); if (c) root.style.setProperty(v, c.color); });
    root.dataset.palette = paletteId;
  }
  if (changed) version++;
  return changed;
}
export const getPalette = () => paletteId;

/** The territory pattern overlay. True when it changed. */
export function setPatterns(on) {
  const v = !!on;
  if (v === patternsOn) return false;
  patternsOn = v;
  version++;
  return true;
}
export const patternsEnabled = () => patternsOn;
/** The pattern faction `id` wears ('none' when the overlay is off). */
export const patternOf = (id) => (patternsOn ? PATTERNS[id] || 'none' : 'none');

/** Effects: 'full' | 'reduced' | 'minimal'. */
export function setEffects(id) {
  const next = EFFECTS[id] ? id : 'full';
  if (next === effectsId) return false;
  effectsId = next;
  return true;
}
export const getEffectsId = () => effectsId;
/** The current Effects table row (config/options.js EFFECTS). */
export const effects = () => EFFECTS[effectsId];

/** Bumps on every change of look (palette, patterns): a cache key part. */
export const lookVersion = () => version;
