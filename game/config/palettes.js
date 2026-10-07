// Colour-vision presets and territory patterns (PLAN-PHASE14 §14B.1). The Default preset IS the faction colours of config/world.js FACTIONS
// (untouched); the other two remap all eight factions, the player's azure included, for one kind of colour vision. Identity never changes: names,
// emblems and patterns stay with their faction, only the paint moves.
//
// How the colours were chosen: a seeded annealing search over sRGB with game/core/colorDistance.js (CIEDE2000 under the Machado 2009 simulation,
// full severity), minimising the normal-vision distance to each faction's default colour (the player's weighted 3x) subject to every pair clearing
// the preset's bar under its targeted vision(s) with a margin, and 22 under normal vision. Dark = halfway to black; light = towards white until it
// reads as text on the solid panel (4.8:1 or better); the Ashen glow and the Usurper's rose keep their default light variants.
// Minimum pair distances (game/tests/ui.options.test.js asserts the bar):
//   deutan preset: deutan 27.5, protan 27.5, normal 26.1 (tritan 22.9)
//   tritan preset: tritan 28.0, normal 22.3
export const PALETTE_BAR = 25; // every pair of the eight factions, under the preset's targeted vision
export const PALETTE_NORMAL_BAR = 20; // and under normal vision (a friend at the same screen still tells them apart)

export const PALETTES = Object.freeze({
  default: Object.freeze({ id: 'default', name: 'Default', short: 'Default', targets: Object.freeze(['normal']), colors: null }),
  deutan: Object.freeze({
    id: 'deutan', name: 'Deuteranopia / Protanopia friendly', short: 'Red-green', targets: Object.freeze(['deutan', 'protan']),
    colors: Object.freeze([
      Object.freeze({ color: '#5284ff', colorDark: '#294280', colorLight: '#a0bbff' }), // Your Realm: a brighter azure
      Object.freeze({ color: '#9b976d', colorDark: '#4e4c37', colorLight: '#c8c6af' }), // Free Folk: khaki
      Object.freeze({ color: '#922403', colorDark: '#491202', colorLight: '#c38774' }), // Crimson Legion: brick
      Object.freeze({ color: '#1c00d2', colorDark: '#0e0069', colorLight: '#8273e6' }), // Violet Covenant: indigo
      Object.freeze({ color: '#ffe92e', colorDark: '#807517', colorLight: '#fff38c' }), // Amber Horde: sun yellow
      Object.freeze({ color: '#5f6369', colorDark: '#303235', colorLight: '#a9dfd6' }), // Ashen Host: slate
      Object.freeze({ color: '#81feee', colorDark: '#417f77', colorLight: '#bafef6' }), // Sea Kings: pale sea-green
      Object.freeze({ color: '#1a000b', colorDark: '#0d0006', colorLight: '#f2c4cf' }), // The Usurper: near-black wine
    ]),
  }),
  tritan: Object.freeze({
    id: 'tritan', name: 'Tritanopia friendly', short: 'Blue-yellow', targets: Object.freeze(['tritan']),
    colors: Object.freeze([
      Object.freeze({ color: '#2977fe', colorDark: '#153c7f', colorLight: '#89b4fe' }), // Your Realm
      Object.freeze({ color: '#a6b193', colorDark: '#53594a', colorLight: '#ced4c4' }), // Free Folk: sage
      Object.freeze({ color: '#d91439', colorDark: '#6d0a1d', colorLight: '#ea7e92' }), // Crimson Legion
      Object.freeze({ color: '#2a2387', colorDark: '#151244', colorLight: '#8a86bd' }), // Violet Covenant: deep indigo
      Object.freeze({ color: '#f4c291', colorDark: '#7a6149', colorLight: '#f9ddc3' }), // Amber Horde: peach
      Object.freeze({ color: '#605763', colorDark: '#302c32', colorLight: '#a9dfd6' }), // Ashen Host
      Object.freeze({ color: '#58ffd4', colorDark: '#2c806a', colorLight: '#a3ffe7' }), // Sea Kings
      Object.freeze({ color: '#350000', colorDark: '#1b0000', colorLight: '#f2c4cf' }), // The Usurper: oxblood
    ]),
  }),
});
export const PALETTE_IDS = Object.freeze(Object.keys(PALETTES));

// Territory pattern overlay (any preset, optional): one pattern per faction id, drawn over owned land in world space so it runs on across tiles.
// The player's land stays plain: the only unpatterned colour is yours.
export const PATTERNS = Object.freeze(['none', 'dots', 'stripes', 'crosshatch', 'backstripes', 'hlines', 'vlines', 'grid']);
export const PATTERN_LOOK = Object.freeze({
  spacing: 0.34, // world units between lines (a hex has a radius of 1 world unit)
  lineWidth: 0.055, // world units
  dotRadius: 0.07,
  alpha: 0.5, // the faction's dark variant over its land
  lightAlpha: 0.35, // the light variant, under dark factions whose dark would vanish
});
