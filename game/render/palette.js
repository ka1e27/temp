// Colours and colour-math for the "tabletop diorama" art direction (DESIGN §7).
// Pure functions only: no canvas, no DOM, no randomness. Safe to import from
// anywhere under game/render/ (and from tools/gallery/).

import { FACTIONS } from '../config/world.js';

/** @typedef {'deep'|'ocean'|'shallows'|'beach'|'grass'|'meadow'|'forest'|'pine'|'hills'
 *   |'mountain'|'snow'|'savanna'|'desert'|'marsh'} Terrain */

/** Top-face colours per terrain (DESIGN §7.1). Keys match the `Terrain` contract exactly. */
export const TERRAIN_COLORS = Object.freeze({
  deep: '#1f4f6e',
  ocean: '#27668a',
  shallows: '#3b8fb0',
  beach: '#e3cf98',
  grass: '#86b46a',
  meadow: '#9cc46e',
  forest: '#5f9a55',
  pine: '#4f8a5a',
  // Darker/more saturated than grass on purpose (art-direction round 2): the
  // original DESIGN §7.1 swatch (`#a9b66c`) is actually LIGHTER than grass,
  // which read as pale, flat "puddles" rather than raised ground once the
  // hillside mounds and skirt shading were in place next to it.
  hills: '#7e9450',
  mountain: '#8d8478',
  snow: '#e8eef2',
  savanna: '#cdb96c',
  desert: '#e0c07e',
  marsh: '#6f9a7d',
});

export const SNOWCAP_COLOR = '#f4f6f8';
export const RIVER_COLOR = '#4fa6cc';
export const ROAD_COLOR = '#c9a66b';
export const ROAD_EDGE_COLOR = '#9c7c4a';
export const FOAM_COLOR = '#f2fbfa';
// Neutral stone used to tint the skirts of hills/mountains toward bare rock
// rather than a plain darkened copy of whatever grows on top of them.
export const ROCK_GREY = '#7d766c';
// DESIGN §7.2: settlement roofs are the owner colour, EXCEPT the Free Folk,
// whose personality is passive/rustic and whose roofs are warm brown regardless
// of their (stone-grey) banner colour.
export const FREE_FOLK_ROOF = '#8a5a35';

/** UI-matching accents (DESIGN §7.5), for gallery chrome and in-world HUD bits
 *  (troop badge text, selection rings, drag-arrow colour, etc). */
export const ACCENTS = Object.freeze({
  cream: '#f3ead7',
  muted: '#a3a9b6',
  gold: '#f5c451',
  goldSoft: '#f7d774',
  goldDeep: '#e0a82e',
  good: '#6fcf97',
  bad: '#eb5757',
  ink: '#2a1d05',
  panel: 'rgba(16,20,30,0.78)',
  panelBorder: 'rgba(255,255,255,0.08)',
});

// ---------------------------------------------------------------- colour math

function hexToRgb(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
function toHex2(v) { return clamp255(Math.round(v)).toString(16).padStart(2, '0'); }
function rgbToHex(r, g, b) { return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`; }

/**
 * Lighten (amount > 0) or darken (amount < 0) a hex colour toward white/black.
 * amount is roughly -1..1 (a fraction of the remaining distance to white/black).
 * @param {string} hex
 * @param {number} amount
 * @returns {string}
 */
export function shade(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const f = (c) => (amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
  return rgbToHex(f(r), f(g), f(b));
}

/**
 * Linearly interpolate two hex colours.
 * @param {string} a
 * @param {string} b
 * @param {number} t 0..1
 * @returns {string}
 */
export function mix(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const l = (x, y) => x + (y - x) * t;
  return rgbToHex(l(A.r, B.r), l(A.g, B.g), l(A.b, B.b));
}

/**
 * A hex colour as a canvas "rgba(r,g,b,a)" string.
 * @param {string} hex
 * @param {number} a 0..1
 * @returns {string}
 */
export function rgba(hex, a) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// ------------------------------------------------------- factions (world.js)

export { FACTIONS };

/** Accepts either a faction id (number) or an already-resolved faction object. */
export function faction(idOrFaction) {
  if (idOrFaction == null) return null;
  return typeof idOrFaction === 'number' ? FACTIONS[idOrFaction] : idOrFaction;
}

export function factionColor(idOrFaction) {
  return faction(idOrFaction)?.color ?? ACCENTS.muted;
}
export function factionColorDark(idOrFaction) {
  const f = faction(idOrFaction);
  return f?.colorDark ?? shade(factionColor(idOrFaction), -0.35);
}
export function factionColorLight(idOrFaction) {
  const f = faction(idOrFaction);
  return f?.colorLight ?? shade(factionColor(idOrFaction), 0.35);
}
export function factionEmblem(idOrFaction) {
  return faction(idOrFaction)?.emblem ?? 'star';
}

/**
 * Roof colour for a settlement: the owner colour, except the Free Folk
 * (personality 'passive'), who always get a warm brown roof (DESIGN §7.2).
 */
export function roofColor(idOrFaction) {
  const f = faction(idOrFaction);
  if (!f) return FREE_FOLK_ROOF;
  return f.personality === 'passive' ? FREE_FOLK_ROOF : f.color;
}
