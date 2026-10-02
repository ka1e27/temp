// Inline SVG icons for the five Region Works (DESIGN §5.8), in the same style as game/ui/icons.js: bold
// filled silhouettes on a 0 0 24 24 grid, drawn with currentColor (plus fill-opacity for internal shading), so
// CSS alone controls colour and size. They live here, not in icons.js, which belongs to the UI kit. Browser
// only; no game-logic imports.
//
//   worksIcon('barracks', 20)   -> <svg class="icon icon-works icon-works-barracks">
//
// The map marks (render/worksMarks.js) draw the same five buildings on canvas; the silhouettes are kept in
// step on purpose, so the icon on the card is the building on the map.

const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}
const path = (d, attrs = {}) => el('path', { d, ...attrs });
const rect = (x, y, w, h, attrs = {}) => el('rect', { x, y, width: w, height: h, ...attrs });
const circle = (cx, cy, r, attrs = {}) => el('circle', { cx, cy, r, ...attrs });
const polygon = (pts, attrs = {}) => el('polygon', { points: pts.map((p) => p.join(',')).join(' '), ...attrs });

const SHADE = { fill: '#000', 'fill-opacity': 0.34 };
const LIGHT = { fill: '#fff', 'fill-opacity': 0.5 };

const ICONS = {
  // A long low hall under a pitched roof with a banner on a pole: the place troops sleep.
  barracks: () => [
    rect(3.2, 11.2, 17.6, 9.8, { rx: 0.6 }),
    polygon([[1.6, 11.8], [12, 5.2], [22.4, 11.8]], { 'fill-opacity': 0.92 }),
    path('M12 5.4V.8', { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.3, 'stroke-linecap': 'round' }),
    polygon([[12, .9], [18, 2.6], [12, 4.3]]),
    rect(10, 14.2, 4, 6.8, { rx: 1.6, ...SHADE }),
    rect(5, 13.8, 2.6, 2.6, { rx: 0.4, ...SHADE }),
    rect(16.4, 13.8, 2.6, 2.6, { rx: 0.4, ...SHADE }),
  ],

  // A barn with the big X-braced doors and a horseshoe over them: the stables.
  stables: () => [
    rect(3.6, 10.6, 16.8, 10.4, { rx: 0.6 }),
    polygon([[1.8, 11.2], [6.4, 6.2], [12, 3.6], [17.6, 6.2], [22.2, 11.2]], { 'fill-opacity': 0.92 }),
    rect(7.4, 12.6, 9.2, 8.4, { rx: 0.5, ...SHADE }),
    path('M7.6 12.8 16.4 20.8M16.4 12.8 7.6 20.8', { fill: 'none', stroke: '#fff', 'stroke-opacity': 0.55, 'stroke-width': 1.1 }),
    path('M9.8 9.4a2.2 2.2 0 1 1 4.4 0', { fill: 'none', stroke: '#000', 'stroke-opacity': 0.4, 'stroke-width': 1.5, 'stroke-linecap': 'round' }),
  ],

  // A small pillared shrine with a flame burning between the columns.
  shrine: () => [
    rect(3.4, 19, 17.2, 2.6, { rx: 0.6 }),
    rect(5.2, 11.4, 2.8, 7.8, { rx: 0.5 }),
    rect(16, 11.4, 2.8, 7.8, { rx: 0.5 }),
    polygon([[2.6, 11.8], [12, 4.4], [21.4, 11.8]], { 'fill-opacity': 0.92 }),
    path('M12 9.4c1.5 1.9 3 3 3 5.3a3 3 0 0 1-6 0c0-1.2.5-2 1.2-2.7-.1.9.3 1.4.8 1.6-.3-1.6.1-2.7 1-4.2Z', { ...LIGHT, 'fill-opacity': 0.92 }),
  ],

  // A slim stone tower with a crenellated top, an arrow slit and a pennant.
  watchtower: () => [
    polygon([[7.4, 21.4], [8.6, 9.2], [15.4, 9.2], [16.6, 21.4]]),
    rect(6.4, 6.8, 11.2, 3.2, { rx: 0.4 }),
    rect(6.4, 3.8, 2.6, 3.4), rect(10.7, 3.8, 2.6, 3.4), rect(15, 3.8, 2.6, 3.4),
    rect(11.1, 12, 1.8, 4.6, { rx: 0.9, ...SHADE }),
    path('M12 3.8V.6', { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.2, 'stroke-linecap': 'round' }),
    polygon([[12, .7], [17.2, 2], [12, 3.3]]),
    rect(10.2, 18.4, 3.6, 3, { rx: 1.4, ...SHADE }),
  ],

  // A market stall: striped awning, posts, a counter and a coin.
  market: () => [
    path('M2 8.4 4.4 4h15.2L22 8.4Z'),
    polygon([[6.2, 4], [9.4, 4], [8.6, 8.4], [5.4, 8.4]], { fill: '#fff', 'fill-opacity': 0.55 }),
    polygon([[12.6, 4], [15.8, 4], [15.8, 8.4], [12.6, 8.4]], { fill: '#fff', 'fill-opacity': 0.55 }),
    polygon([[19.6, 4], [19.6, 4], [21, 6.6], [20.4, 8.4], [19, 8.4]], { fill: '#fff', 'fill-opacity': 0.55 }),
    rect(3.8, 8.4, 1.8, 12.6, { rx: 0.5 }),
    rect(18.4, 8.4, 1.8, 12.6, { rx: 0.5 }),
    rect(2.6, 15.6, 18.8, 5.4, { rx: 0.8 }),
    circle(12, 12.6, 2.6),
    circle(12, 12.6, 1.4, { fill: 'none', stroke: '#000', 'stroke-opacity': 0.42, 'stroke-width': 0.9 }),
  ],

  // Three dots: the row's overflow ("more") affordance, which leads to Demolish.
  more: () => [circle(5.2, 12, 2.3), circle(12, 12, 2.3), circle(18.8, 12, 2.3)],

  // A "+" in a ring: an empty slot, "build here".
  build: () => [
    circle(12, 12, 9.4, { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-dasharray': '3.4 2.6', 'stroke-linecap': 'round' }),
    rect(11, 6.8, 2, 10.4, { rx: 1 }),
    rect(6.8, 11, 10.4, 2, { rx: 1 }),
  ],
};

/** The five Works, in chooser order, then the extra glyph. */
export const WORKS_ICON_NAMES = Object.freeze(['barracks', 'stables', 'shrine', 'watchtower', 'market']);
export const WORKS_ICON_ALL = Object.freeze([...WORKS_ICON_NAMES, 'build', 'more']);

/**
 * @param {'barracks'|'stables'|'shrine'|'watchtower'|'market'|'build'|'more'} name
 * @param {number} [size] px
 * @returns {SVGSVGElement}
 */
export function worksIcon(name, size = 20) {
  const svg = el('svg', {
    viewBox: '0 0 24 24', width: size, height: size, fill: 'currentColor',
    class: `icon icon-works icon-works-${name}`, 'aria-hidden': 'true', focusable: 'false',
  });
  const build = ICONS[name];
  if (!build) {
    svg.appendChild(circle(12, 12, 8, { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }));
    return svg;
  }
  for (const node of build()) svg.appendChild(node);
  return svg;
}
