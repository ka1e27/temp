// The bridge between tokens.css and the canvas.
//
// Every colour is read ONCE at boot from the CSS custom properties in
// tokens.css, so a canvas hue and a DOM hue can never drift apart — there is
// exactly one place a colour is written down. Derived strings (the low-alpha
// territory fills, the border tints) are precomputed here too, because the
// draw path is not allowed to allocate.

/** CSS custom property -> palette field. */
const VARS = {
  bg: '--c-bg',
  surface: '--c-surface',
  surface2: '--c-surface-2',
  line: '--c-line',
  text: '--c-text',
  textDim: '--c-text-dim',
  player: '--c-player',
  enemy: '--c-enemy',
  neutral: '--c-neutral',
  gold: '--c-gold',
  accent: '--c-accent',
  warn: '--c-warn',
  danger: '--c-danger',
};

const UNIT_VARS = {
  militia: '--c-militia',
  spearmen: '--c-spearmen',
  raiders: '--c-raiders',
  rams: '--c-rams',
  marshal: '--c-marshal',
};

const NUM_VARS = {
  floodAlpha: '--a-flood',
  floodStrongAlpha: '--a-flood-strong',
  gridAlpha: '--a-grid',
  blockedAlpha: '--a-blocked',
};

/** Used headlessly (tests, node) and as the answer if a property is missing. */
export const FALLBACK = Object.freeze({
  bg: '#0b0d12', surface: '#12151d', surface2: '#1a1f2b', line: '#263041',
  text: '#e7ebf3', textDim: '#93a0b8',
  player: '#3ddc97', enemy: '#ff5c5c', neutral: '#6b7688',
  gold: '#ffc857', accent: '#5aa9ff', warn: '#ffc857', danger: '#ff5c5c',
  militia: '#e8e8ec', spearmen: '#5bd6a6', raiders: '#ffc857',
  rams: '#b07cff', marshal: '#ff8a3d',
  floodAlpha: 0.2, floodStrongAlpha: 0.42, gridAlpha: 0.5, blockedAlpha: 0.9,
});

/** '#abc' | '#aabbcc' -> 0xrrggbb. Returns null for anything else. */
export function parseHex(color) {
  if (typeof color !== 'string') return null;
  const s = color.trim();
  if (s[0] !== '#') return null;
  if (s.length === 4) {
    const r = s[1], g = s[2], b = s[3];
    return parseInt(r + r + g + g + b + b, 16);
  }
  if (s.length === 7) return parseInt(s.slice(1), 16);
  return null;
}

/** Hex + alpha -> an 'rgba(...)' string canvas can use directly. */
export function withAlpha(color, alpha) {
  const n = parseHex(color);
  const a = Math.max(0, Math.min(1, alpha));
  if (n === null) return color;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${round3(a)})`;
}

/** Linear blend of two hex colours, t=0 -> a, t=1 -> b. */
export function mix(a, b, t) {
  const x = parseHex(a);
  const y = parseHex(b);
  if (x === null || y === null) return a;
  const k = Math.max(0, Math.min(1, t));
  const r = Math.round(((x >> 16) & 255) * (1 - k) + ((y >> 16) & 255) * k);
  const g = Math.round(((x >> 8) & 255) * (1 - k) + ((y >> 8) & 255) * k);
  const bl = Math.round((x & 255) * (1 - k) + (y & 255) * k);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * Read the live token values off an element's computed style.
 * @param {Element} [el] defaults to <html>
 */
export function readPalette(el) {
  const base = { ...FALLBACK };
  if (typeof getComputedStyle !== 'function') return derive(base);
  const cs = getComputedStyle(el || document.documentElement);
  const get = (name, fallback) => {
    const v = cs.getPropertyValue(name).trim();
    return v || fallback;
  };
  for (const [k, name] of Object.entries(VARS)) base[k] = get(name, base[k]);
  for (const [k, name] of Object.entries(UNIT_VARS)) base[k] = get(name, base[k]);
  for (const [k, name] of Object.entries(NUM_VARS)) {
    const v = parseFloat(get(name, ''));
    if (Number.isFinite(v)) base[k] = v;
  }
  return derive(base);
}

/**
 * Precompute every string the renderer will ask for. Building 'rgba(...)'
 * inside a draw call would allocate a string per hex per frame; here it costs
 * one object at boot.
 */
export function derive(c) {
  const p = { ...c };
  p.units = {
    militia: c.militia, spearmen: c.spearmen, raiders: c.raiders,
    rams: c.rams, marshal: c.marshal,
  };
  p.owner = { player: c.player, enemy: c.enemy, neutral: c.neutral, contested: c.warn };

  // Territory flood: low alpha so the near-black ground still dominates and
  // the faction hue reads as ownership rather than as furniture.
  p.flood = {
    player: withAlpha(c.player, c.floodAlpha),
    enemy: withAlpha(c.enemy, c.floodAlpha),
    neutral: withAlpha(c.neutral, c.floodAlpha * 0.75),
    contested: withAlpha(c.warn, c.floodAlpha * 0.5),
  };
  // The front line: the outline where two FACTIONS meet, at high alpha.
  p.border = {
    player: withAlpha(c.player, c.floodStrongAlpha + 0.45),
    enemy: withAlpha(c.enemy, c.floodStrongAlpha + 0.45),
    neutral: withAlpha(c.neutral, c.floodStrongAlpha),
    contested: withAlpha(c.warn, c.floodStrongAlpha + 0.45),
  };
  // The quiet edge against unclaimed ground — present, but never competing
  // with the front line for attention.
  p.edge = {
    player: withAlpha(c.player, 0.28),
    enemy: withAlpha(c.enemy, 0.28),
    neutral: withAlpha(c.neutral, 0.22),
    contested: withAlpha(c.warn, 0.28),
  };
  // Sites are objects sitting ON the terrain, so their bodies knock the flood
  // out underneath rather than tinting with it.
  p.siteFill = withAlpha(c.bg, 0.94);
  p.siteWash = {
    player: withAlpha(c.player, 0.22),
    enemy: withAlpha(c.enemy, 0.22),
    neutral: withAlpha(c.neutral, 0.22),
  };
  // Contested ground is hatched in BOTH faction hues — a band that visibly
  // belongs to neither, which is exactly what a stalled front is.
  p.hatchA = withAlpha(c.player, 0.3);
  p.hatchB = withAlpha(c.enemy, 0.55);
  p.grid = withAlpha(c.line, c.gridAlpha);
  // The adjacency graph. Visible enough to teach "sends go to adjacent sites
  // only" without a tutorial line, quiet enough not to compete with the flood.
  p.link = withAlpha(c.textDim, 0.18);
  p.plate = withAlpha(c.surface, 0.85);
  // --a-blocked controls how completely a mountain masks the territory
  // underneath: below 1 the flood bleeds through, so terrain still reads as
  // being INSIDE someone's ground.
  p.blocked = withAlpha(mix(c.bg, c.line, 0.8), c.blockedAlpha);
  p.blockedEdge = withAlpha(c.textDim, 0.55);
  p.track = withAlpha(c.line, 0.95);
  p.shade = withAlpha(c.bg, 0.55);
  p.selection = withAlpha(c.accent, 0.9);
  p.selectionFill = withAlpha(c.accent, 0.12);
  return p;
}

let cached = null;

/** Memoized boot-time palette. Call resetPalette() if a theme ever changes. */
export function palette(el) {
  if (!cached) cached = readPalette(el);
  return cached;
}

export function resetPalette() {
  cached = null;
}
