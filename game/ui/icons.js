// Hand-made inline SVG icon set (DESIGN §7.5, §0 critique #1: v1's "thin
// line icons" read as a dashboard, not a world). Every icon is bold, filled
// silhouettes on a 0 0 24 24 grid, drawn with currentColor (plus
// fill-opacity/stroke-opacity for internal shading) so CSS alone controls
// colour and size. No external assets, no dependencies.

const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

const path = (d, attrs = {}) => el('path', { d, ...attrs });
const circle = (cx, cy, r, attrs = {}) => el('circle', { cx, cy, r, ...attrs });
const ellipse = (cx, cy, rx, ry, attrs = {}) => el('ellipse', { cx, cy, rx, ry, ...attrs });
const rect = (x, y, w, h, attrs = {}) => el('rect', { x, y, width: w, height: h, ...attrs });
const line = (x1, y1, x2, y2, attrs = {}) => el('line', { x1, y1, x2, y2, ...attrs });
const polygon = (pts, attrs = {}) => el('polygon', { points: pts.map((p) => p.join(',')).join(' '), ...attrs });
const group = (children, attrs = {}) => {
  const g = el('g', attrs);
  children.forEach((c) => g.appendChild(c));
  return g;
};

/** Points of a regular star/polygon centred at (cx,cy). `inner` alternates a shorter radius (star) when given. */
function starPoints(cx, cy, outerR, innerR, spikes, rotate = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = rotate + (i * Math.PI) / spikes;
    pts.push([+(cx + Math.cos(a) * r).toFixed(2), +(cy + Math.sin(a) * r).toFixed(2)]);
  }
  return pts;
}

// --- Icon builders: each returns an array of child SVG nodes -------------

const ICONS = {
  // A real coin, not a plain disc: darker rim (depth), an inner groove ring
  // (embossed edge), a currency mark, and a small offset highlight (shine) —
  // this one is used for every gold amount in the game, so it has to read
  // as money at a glance, not as a generic button.
  coin: () => [
    circle(12, 12, 9.3),
    circle(12, 12, 9.3, { fill: 'none', stroke: '#000', 'stroke-opacity': 0.4, 'stroke-width': 1.3 }),
    circle(12, 12, 6.9, { fill: 'none', stroke: '#000', 'stroke-opacity': 0.28, 'stroke-width': 1 }),
    path('M12 7.4v9.2M9.9 9.6c0-1.1 1-1.8 2.1-1.8s2.1.6 2.1 1.6c0 2.2-4.4 1.3-4.4 3.5 0 1 .9 1.7 2.1 1.7s2.3-.6 2.3-1.7',
      { fill: 'none', stroke: '#000', 'stroke-opacity': 0.4, 'stroke-width': 1.15, 'stroke-linecap': 'round' }),
    ellipse(9, 8.7, 2.7, 1.5, { fill: '#fff', 'fill-opacity': 0.4, transform: 'rotate(-30 9 8.7)' }),
  ],

  sword: () => [
    group([
      rect(-1.1, -9.5, 2.2, 12, { rx: 0.6 }),
      polygon([[-1.1, -9.5], [1.1, -9.5], [0, -12.6]]),
      rect(-3.6, 2, 7.2, 1.8, { rx: 0.5 }),
      rect(-1, 3.6, 2, 5.4, { rx: 0.5 }),
      ellipse(0, 9.6, 1.7, 1.1),
    ], { transform: 'translate(12,12) rotate(45)' }),
  ],

  shield: () => [
    path('M12 2.4 19.5 5v6.2c0 5-3.2 8.7-7.5 10.4-4.3-1.7-7.5-5.4-7.5-10.4V5L12 2.4Z'),
    path('M12 4.5v15.4', { stroke: 'currentColor', 'stroke-opacity': 0.3, 'stroke-width': 1 }),
  ],

  boot: () => [
    path('M9 2.5h5v8.6l4.6 3.2c1 .7 1.6 1.8 1.6 3v1.2a1 1 0 0 1-1 1H5.2a1 1 0 0 1-1-1v-3c0-1 .4-2 1.1-2.7L9 9.5V2.5Z'),
    line(9, 6.5, 14, 6.5, { stroke: 'currentColor', 'stroke-opacity': 0.35, 'stroke-width': 1 }),
  ],

  // A curved war horn: SMALL round mouthpiece, a tube that visibly widens
  // (a mid-taper bump, not a uniform phone-cord thickness) into a big
  // flared bell with a dark interior — the mouthpiece/bell size contrast is
  // what keeps this from reading as a telephone handset.
  horn: () => [
    path('M4.6 4.8 A10.6 10.6 0 0 0 17.8 17.7', { fill: 'none', stroke: 'currentColor', 'stroke-width': 3, 'stroke-linecap': 'round' }),
    circle(4.6, 4.8, 1.7),
    circle(15.2, 15.9, 3.4),
    ellipse(19.2, 19.1, 5.2, 3.6, { transform: 'rotate(35 19.2 19.1)' }),
    ellipse(19.2, 19.1, 2.7, 1.7, { transform: 'rotate(35 19.2 19.1)', fill: '#000', 'fill-opacity': 0.45 }),
  ],

  // Three overlapping tongues (a proper bonfire silhouette), not one blob —
  // reads as "fire" at a glance, side tongues dimmer so the tall centre one
  // still reads as the dominant flame.
  flame: () => [
    path('M6.2 12.6c1.1 1.7 2.7 2.6 2.7 4.9a2.7 2.7 0 1 1-5.4 0c0-1 .4-1.7 1-2.3-.1.8.3 1.2.8 1.3-.4-1.9.5-2.9 1.9-3.9Z', { 'fill-opacity': 0.8 }),
    path('M17.8 13c1.1 1.7 2.5 2.5 2.5 4.6a2.5 2.5 0 1 1-5 0c0-.9.3-1.6.9-2.1-.1.7.3 1.1.7 1.2-.3-1.8.5-2.7 1.9-3.7Z', { 'fill-opacity': 0.8 }),
    path('M12 1.6c1.9 3.5 5 5.8 5 10.4a5 5 0 1 1-10 0c0-1.6.5-2.7 1.4-3.7-.2 1.4.3 2.3 1.2 2.6C8.9 6.6 10.3 4.1 12 1.6Z'),
  ],

  bell: () => [
    path('M12 2.6a1.3 1.3 0 0 1 1.3 1.3v.6c2.7.6 4.7 3 4.7 6v3.2l1.6 2.6a.9.9 0 0 1-.8 1.4H5.2a.9.9 0 0 1-.8-1.4L6 13.7v-3.2c0-3 2-5.4 4.7-6v-.6A1.3 1.3 0 0 1 12 2.6Z'),
    path('M9.3 19.6a2.7 2.7 0 0 0 5.4 0Z'),
  ],

  crown: () => [
    path('M3.5 18.5 2.2 8.7a.6.6 0 0 1 1-.5l4 3 3.9-6a1 1 0 0 1 1.8 0l3.9 6 4-3a.6.6 0 0 1 1 .5l-1.3 9.8H3.5Z'),
    rect(3.3, 18.5, 17.4, 2.2, { rx: 0.6 }),
    circle(12, 12.2, 1.1, { 'fill-opacity': 0.5 }),
  ],

  star: () => [polygon(starPoints(12, 12, 9.4, 3.8, 5))],

  clock: () => [
    circle(12, 12, 9.2, { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 }),
    path('M12 6.8v5.6l4 2.3', { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
  ],

  castle: () => [
    rect(3, 10.5, 18, 10.5),
    rect(3, 7.4, 3.2, 3.4), rect(9.3, 7.4, 3.4, 3.4), rect(15.8, 7.4, 3.2, 3.4),
    path('M9.6 21v-4.4a2.4 2.4 0 1 1 4.8 0V21Z', { fill: '#000', 'fill-opacity': 0.32 }),
  ],

  tower: () => [
    path('M8.4 21V9.6L6.8 6h10.4l-1.6 3.6V21Z'),
    rect(7.6, 3, 2.2, 3), rect(11, 3, 2, 3), rect(14.2, 3, 2.2, 3),
    line(8.4, 14.6, 15.6, 14.6, { stroke: '#000', 'stroke-opacity': 0.25, 'stroke-width': 1 }),
    rect(10.3, 16.6, 3.4, 4.4, { rx: 1.6, fill: '#000', 'fill-opacity': 0.32 }),
  ],

  // A proper pavilion, not a bare triangle: a peaked flag, a ridge + wall
  // seams (visible canvas panels), and a shadowed door flap.
  tent: () => [
    polygon([[12, 4], [21, 20.5], [3, 20.5]]),
    path('M12 4v16.5', { stroke: '#000', 'stroke-opacity': 0.22, 'stroke-width': 1 }),
    path('M12 8.6 16.6 20.5M12 8.6 7.4 20.5', { fill: 'none', stroke: '#000', 'stroke-opacity': 0.16, 'stroke-width': 1 }),
    polygon([[12, 9.4], [15.2, 20.5], [8.8, 20.5]], { fill: '#000', 'fill-opacity': 0.32 }),
    line(12, 4, 12, 0.8, { stroke: 'currentColor', 'stroke-width': 1.3 }),
    polygon([[12, 0.8], [17.2, 2.3], [12, 3.8]]),
  ],

  gear: () => {
    const teeth = [];
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      teeth.push(rect(-1.5, -11, 3, 4.4, { rx: 0.8, transform: `rotate(${(a * 180) / Math.PI})` }));
    }
    return [
      group(teeth, { transform: 'translate(12,12)' }),
      circle(12, 12, 7.4),
      circle(12, 12, 3, { fill: '#000', 'fill-opacity': 0.4 }),
    ];
  },

  'sound-on': () => [
    polygon([[3, 9.5], [7.5, 9.5], [12.5, 5], [12.5, 19], [7.5, 14.5], [3, 14.5]]),
    path('M16 8.5a5 5 0 0 1 0 7', { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round' }),
    path('M18.6 5.8a9 9 0 0 1 0 12.4', { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-opacity': 0.6 }),
  ],

  'sound-off': () => [
    polygon([[3, 9.5], [7.5, 9.5], [12.5, 5], [12.5, 19], [7.5, 14.5], [3, 14.5]]),
    line(16.2, 9, 21, 15, { stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round' }),
    line(21, 9, 16.2, 15, { stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round' }),
  ],

  pause: () => [rect(5.5, 4, 4.4, 16, { rx: 1 }), rect(14.1, 4, 4.4, 16, { rx: 1 })],
  play: () => [polygon([[6, 3.5], [20, 12], [6, 20.5]])],

  // A supply line: a source, chevrons flowing along the road, a destination. Symmetric about x = 12 so it sits centred in a round button.
  supply: () => [
    circle(3.8, 12, 2.8),
    circle(20.2, 12, 2.8),
    path('M7.6 7.8 11 12l-3.4 4.2', { fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    path('M12.6 7.8 16 12l-3.4 4.2', { fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-opacity': 0.7 }),
  ],

  speed: () => [
    polygon([[2.5, 5], [11, 12], [2.5, 19]]),
    polygon([[12, 5], [20.5, 12], [12, 19]], { 'fill-opacity': 0.65 }),
  ],

  close: () => [
    line(5.5, 5.5, 18.5, 18.5, { stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round' }),
    line(18.5, 5.5, 5.5, 18.5, { stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round' }),
  ],

  // Padlock, used to replace a power's own icon when it's not unlocked yet.
  lock: () => [
    rect(5.5, 10.5, 13, 10.5, { rx: 2 }),
    path('M8 10.5V7.6a4 4 0 1 1 8 0v2.9', { fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }),
    circle(12, 15, 1.7, { fill: '#000', 'fill-opacity': 0.45 }),
    rect(11.2, 15.6, 1.6, 2.8, { fill: '#000', 'fill-opacity': 0.45, rx: 0.6 }),
  ],

  flag: () => [
    rect(4.6, 2.5, 1.8, 19, { rx: 0.6 }),
    path('M6.4 4 19 6.7 6.4 12.3Z'),
  ],

  map: () => [
    polygon([[3, 5], [9, 3], [15, 5], [21, 3], [21, 18], [15, 20], [9, 18], [3, 20]]),
    line(9, 3.3, 9, 18, { stroke: '#000', 'stroke-opacity': 0.25, 'stroke-width': 1, 'stroke-dasharray': '2,2' }),
    line(15, 5, 15, 20, { stroke: '#000', 'stroke-opacity': 0.25, 'stroke-width': 1, 'stroke-dasharray': '2,2' }),
  ],

  // Renown (DESIGN 10.12): a laurel wreath, two leafy branches curving up from a tied stem; nothing like the Realm trophy or a crown
  laurel: () => {
    // leaves along a circle of radius 7.6 round (12, 12.4), from near the tied stem at the bottom to the open top; each leaf points along the branch, tilted out
    const out = [];
    for (const side of [-1, 1]) {
      out.push(path(side < 0 ? 'M10.6 20.6A7.8 7.8 0 0 1 5.4 7.2' : 'M13.4 20.6A7.8 7.8 0 0 0 18.6 7.2', { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.2, 'stroke-linecap': 'round' }));
      for (const deg of [34, 66, 98, 130]) {
        const t = (deg * Math.PI) / 180;
        const x = 12 + side * -7.6 * Math.sin(t) * -1 * -1;
        const y = 12.4 + 7.6 * Math.cos(t);
        const cx = 12 + side * 7.6 * Math.sin(t);
        // the leaf's long axis along the branch (its tangent), tilted 25 degrees outward; mirrored on the right
        const along = (Math.atan2(Math.cos(t), -Math.sin(t)) * 180) / Math.PI;
        const rot = side < 0 ? along + 55 : -along - 55;
        void x;
        out.push(el('ellipse', { cx: cx.toFixed(2), cy: y.toFixed(2), rx: 1.55, ry: 3.1, transform: `rotate(${rot.toFixed(1)} ${cx.toFixed(2)} ${y.toFixed(2)})` }));
      }
    }
    out.push(path('M10.4 20.4 12 21.8l1.6-1.4', { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    return out;
  },
  trophy: () => [
    path('M8 3h8v6.4A4 4 0 0 1 12 13.4 4 4 0 0 1 8 9.4V3Z'),
    path('M8 4.4H4.8v1.8A3.6 3.6 0 0 0 8 9.8', { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 }),
    path('M16 4.4h3.2v1.8A3.6 3.6 0 0 1 16 9.8', { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 }),
    rect(10.6, 13, 2.8, 4), rect(7.8, 19, 8.4, 2, { rx: 0.6 }),
  ],

  scroll: () => [
    rect(4.5, 5.2, 15, 13.6, { rx: 1.2 }),
    ellipse(4.5, 6.4, 1.6, 1.6), ellipse(4.5, 17.6, 1.6, 1.6),
    ellipse(19.5, 6.4, 1.6, 1.6), ellipse(19.5, 17.6, 1.6, 1.6),
    line(7.5, 9.4, 16.5, 9.4, { stroke: '#000', 'stroke-opacity': 0.28, 'stroke-width': 1.1 }),
    line(7.5, 12, 16.5, 12, { stroke: '#000', 'stroke-opacity': 0.28, 'stroke-width': 1.1 }),
    line(7.5, 14.6, 13.5, 14.6, { stroke: '#000', 'stroke-opacity': 0.28, 'stroke-width': 1.1 }),
  ],

  // A sealed letter (PLAN-PHASE4 §4E): the HUD pip that reopens a world event's offer. Envelope body, the flap's V, a wax seal on the point.
  envelope: () => [
    rect(2.6, 5.4, 18.8, 13.6, { rx: 1.6 }),
    path('M3.4 6.4 12 13l8.6-6.6', { fill: 'none', stroke: '#000', 'stroke-opacity': 0.38, 'stroke-width': 1.5, 'stroke-linejoin': 'round' }),
    path('M3.4 18.2 9.6 12.2M20.6 18.2l-6.2-6', { fill: 'none', stroke: '#000', 'stroke-opacity': 0.2, 'stroke-width': 1.1 }),
    circle(12, 13.2, 3.1),
    circle(12, 13.2, 3.1, { fill: 'none', stroke: '#000', 'stroke-opacity': 0.45, 'stroke-width': 1.1 }),
    circle(12, 13.2, 1.2, { fill: '#000', 'fill-opacity': 0.35 }),
  ],

  // The Bounty Board (PLAN-PHASE4 §4A): a contract scroll hanging from its rod, with a ribboned wax seal at the foot.
  bounty: () => [
    rect(3.5, 2.6, 17, 2.4, { rx: 1.2 }),
    path('M5.4 5h13.2v11.4l-2.2-1.2-2.2 1.2H5.4Z'),
    line(7.8, 8.2, 16.2, 8.2, { stroke: '#000', 'stroke-opacity': 0.3, 'stroke-width': 1.1 }),
    line(7.8, 10.8, 13.8, 10.8, { stroke: '#000', 'stroke-opacity': 0.3, 'stroke-width': 1.1 }),
    path('M10 17.2 8.6 22l2.1-1 1.3 1.5.4-4.4ZM14 17.2l1.4 4.8-2.1-1-1.3 1.5-.4-4.4Z'),
    circle(12, 16.6, 3.4),
    circle(12, 16.6, 3.4, { fill: 'none', stroke: '#000', 'stroke-opacity': 0.45, 'stroke-width': 1.1 }),
    polygon(starPoints(12, 16.6, 1.8, 0.8, 5), { fill: '#000', 'fill-opacity': 0.35 }),
  ],

  // A swallow-tailed pennant on a lance (PLAN-PHASE4 §4D): a rival's Trophy banner and the Champion's mark.
  pennant: () => [
    rect(4.2, 2.4, 1.9, 19.4, { rx: 0.7 }),
    circle(5.15, 2.6, 1.5),
    path('M6.1 4.2h13.4l-3.6 4.4 3.6 4.4H6.1Z'),
    path('M6.1 6.2h10.6', { stroke: '#000', 'stroke-opacity': 0.22, 'stroke-width': 1.1 }),
  ],

  // --- Deed medals (PLAN-PHASE4 §4C; config/deeds.js names them) ---------------
  // Conqueror: a war banner hanging from a crossbar, with a notched foot
  banner: () => [
    rect(4, 3, 16, 2, { rx: 1 }),
    circle(4, 4, 1.5), circle(20, 4, 1.5),
    path('M6.5 5h11v15l-5.5-3.4L6.5 20Z'),
    path('M9.5 9.5h5M9.5 12.5h5', { stroke: '#000', 'stroke-opacity': 0.3, 'stroke-width': 1.3, 'stroke-linecap': 'round' }),
  ],
  // Dragonslayer: a horned dragon's head in profile, jaw open
  dragon: () => [
    path('M3 13.2c1.4-3.4 4.6-5.8 8.6-6.2l2.4-3.6.9 3.7 3-2.5-.5 4c1.6.9 2.8 2.4 3.4 4.2l-3.6.3 2.2 2.4c-1.4.6-3 .7-4.5.3l-2.8 3.6-1.2-3.4-4.6 1.6 1-3.2Z'),
    circle(15.2, 10.2, 1.1, { fill: '#000', 'fill-opacity': 0.55 }),
    path('M5.6 13.4h5.6', { stroke: '#000', 'stroke-opacity': 0.3, 'stroke-width': 1.1, 'stroke-linecap': 'round' }),
  ],
  // Duellist: two swords crossed
  swords: () => [
    group([
      rect(-0.95, -9.8, 1.9, 13, { rx: 0.5 }), polygon([[-0.95, -9.8], [0.95, -9.8], [0, -12]]),
      rect(-3.2, 3, 6.4, 1.6, { rx: 0.5 }), rect(-0.85, 4.5, 1.7, 4.2, { rx: 0.5 }), circle(0, 9.4, 1.3),
    ], { transform: 'translate(12,12) rotate(-42)' }),
    group([
      rect(-0.95, -9.8, 1.9, 13, { rx: 0.5 }), polygon([[-0.95, -9.8], [0.95, -9.8], [0, -12]]),
      rect(-3.2, 3, 6.4, 1.6, { rx: 0.5 }), rect(-0.85, 4.5, 1.7, 4.2, { rx: 0.5 }), circle(0, 9.4, 1.3),
    ], { transform: 'translate(12,12) rotate(42)' }),
  ],
  // Nemesis: a skull
  skull: () => [
    path('M12 2.8c-4.9 0-8.4 3.4-8.4 7.9 0 2.6 1.2 4.5 3 5.6v3.1c0 .9.7 1.6 1.6 1.6h7.6c.9 0 1.6-.7 1.6-1.6v-3.1c1.8-1.1 3-3 3-5.6 0-4.5-3.5-7.9-8.4-7.9Z'),
    circle(8.6, 11.2, 2.2, { fill: '#000', 'fill-opacity': 0.6 }),
    circle(15.4, 11.2, 2.2, { fill: '#000', 'fill-opacity': 0.6 }),
    path('M12 13.6l-1.3 2.4h2.6Z', { fill: '#000', 'fill-opacity': 0.55 }),
    path('M9.6 18.2v2.4M12 18.2v2.4M14.4 18.2v2.4', { stroke: '#000', 'stroke-opacity': 0.45, 'stroke-width': 1 }),
  ],

  // --- Faction emblems (DESIGN §3.3) not already covered above -------------
  eye: () => [
    path('M2 12c2.7-4.6 6.3-7 10-7s7.3 2.4 10 7c-2.7 4.6-6.3 7-10 7s-7.3-2.4-10-7Z'),
    circle(12, 12, 3.6, { fill: '#000', 'fill-opacity': 0.35 }),
    circle(12, 12, 1.6, { fill: 'currentColor' }),
  ],

  sun: () => {
    const rays = [];
    for (let i = 0; i < 8; i++) {
      rays.push(rect(-0.9, -11.2, 1.8, 3.4, { rx: 0.6, transform: `rotate(${i * 45})` }));
    }
    return [group(rays, { transform: 'translate(12,12)' }), circle(12, 12, 5.6)];
  },

  // The Ashen Host (Phase 6): a skull wearing a five-pointed iron crown. Bounding box x 4.6..19.4, y 2..22.4 (centred on 12,12.2).
  skullCrown: () => [
    path('M12 8.4c-4.3 0-7.1 2.8-7.1 6.5 0 2 .9 3.5 2.4 4.4v1.9c0 .7.5 1.2 1.2 1.2h7c.7 0 1.2-.5 1.2-1.2v-1.9c1.5-.9 2.4-2.4 2.4-4.4 0-3.7-2.8-6.5-7.1-6.5Z'),
    path('M5.4 9.4 4.6 3.4l3.7 2.7L12 2l3.7 4.1 3.7-2.7-.8 6Z'),
    rect(5.2, 8.2, 13.6, 1.9, { rx: 0.5, fill: '#000', 'fill-opacity': 0.35 }),
    circle(12, 5.9, 0.95, { fill: '#000', 'fill-opacity': 0.45 }),
    circle(9.2, 14.6, 1.9, { fill: '#000', 'fill-opacity': 0.62 }),
    circle(14.8, 14.6, 1.9, { fill: '#000', 'fill-opacity': 0.62 }),
    path('M12 16.4l-1.1 2h2.2Z', { fill: '#000', 'fill-opacity': 0.55 }),
    path('M10.1 20.1v2M12 20.1v2M13.9 20.1v2', { stroke: '#000', 'stroke-opacity': 0.45, 'stroke-width': 0.9 }),
  ],

  // --- Perk icons -----------------------------------------------------------
  wheat: () => {
    const grains = [];
    for (let i = 0; i < 5; i++) {
      const y = 5 + i * 2.6;
      grains.push(ellipse(12 - 2.6, y, 1.9, 1.1, { transform: `rotate(-25 ${12 - 2.6} ${y})` }));
      grains.push(ellipse(12 + 2.6, y + 1.3, 1.9, 1.1, { transform: `rotate(25 ${12 + 2.6} ${y + 1.3})` }));
    }
    return [line(12, 4.5, 12, 21, { stroke: 'currentColor', 'stroke-width': 1.4 }), ...grains];
  },

  tree: () => [
    rect(10.8, 15, 2.4, 6, { fill: 'currentColor', 'fill-opacity': 0.9 }),
    circle(12, 9.5, 6.4),
    circle(7.6, 12, 4.2, { 'fill-opacity': 0.85 }),
    circle(16.4, 12, 4.2, { 'fill-opacity': 0.85 }),
  ],

  pick: () => [
    group([
      rect(-1.3, -8.5, 2.6, 15, { rx: 1.1 }),
      path('M-8.4 -8.6 Q 0 -13.4 8.4 -8.6 Q 0 -10.4 -8.4 -8.6 Z'),
    ], { transform: 'translate(12,12) rotate(38)' }),
  ],

  // Stacked quarry blocks (not a boulder cluster): two staggered courses
  // with visible mortar gaps, each block a slightly different shade so they
  // read as separate cut stones.
  stone: () => [
    rect(2.6, 13.4, 8.2, 7.2, { rx: 1 }),
    rect(12.6, 13, 8.8, 7.6, { rx: 1, 'fill-opacity': 0.85 }),
    rect(7, 5.8, 9.4, 7.2, { rx: 1, 'fill-opacity': 0.95 }),
  ],

  horse: () => [
    path('M6 21v-5.4c0-1 .3-1.9 1-2.6l1-1V9.6c0-3.2 2.5-6.4 6-6.9 1.7-.3 2.6 1.7 1.4 2.8l-1.2 1.1 2.4 1c1.2.5 2 1.7 2 3v2.2l1.6 1a1 1 0 0 1-.5 1.8h-2.3l-.7 1.6 1 3.8h-3l-.8-3H11l-1.4 3H6Z'),
    circle(15.4, 7.3, 0.9, { fill: '#000', 'fill-opacity': 0.5 }),
  ],

  anchor: () => [
    circle(12, 5, 2.1, { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 }),
    line(12, 7, 12, 19.5, { stroke: 'currentColor', 'stroke-width': 1.8 }),
    line(7.5, 10.5, 16.5, 10.5, { stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round' }),
    path('M5 14.5c0 3 2.8 5.3 6.2 5.8M19 14.5c0 3-2.8 5.3-6.2 5.8', { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round' }),
  ],

  // A candle ON a holder: saucer base + a small cup the candle sits in,
  // not just a floating stick of wax.
  candle: () => [
    ellipse(12, 21.6, 6.2, 1.5),
    rect(10.4, 16.8, 3.2, 4.6, { rx: 0.6 }),
    rect(9.5, 9, 5, 8.4, { rx: 0.9 }),
    rect(9.5, 9, 5, 1.8, { 'fill-opacity': 0.4 }),
    path('M12 8v1.6', { stroke: 'currentColor', 'stroke-width': 1, 'stroke-linecap': 'round' }),
    path('M12 1.4c1.1 1.7 2.3 3 2.3 4.6a2.3 2.3 0 1 1-4.6 0c0-1.6 1.2-2.9 2.3-4.6Z'),
  ],

  throne: () => [
    rect(6.4, 12.4, 11.2, 2.2, { rx: 0.5 }),
    rect(6.4, 14.6, 2, 6.4, { rx: 0.5 }), rect(15.6, 14.6, 2, 6.4, { rx: 0.5 }),
    path('M7.4 3.4h9.2l-1 9h-7.2Z'),
    circle(12, 3, 1.6),
  ],

  // --- Phase 5 (docs/PLAN-PHASE5.md): Edict crests, Legacy branch medallions, Challenge marks ---------------
  // Every Edict crest is the same heater shield (a soft fill and a firm rim) with the Edict's own symbol struck on it, so the family reads at a glance.
  edictIron: () => crest([
    rect(7.2, 6.4, 7.6, 3.4, { rx: 0.6 }), polygon([[14.8, 6.4], [17.2, 8.1], [14.8, 9.8]]),
    rect(10.3, 9.6, 2, 8.2, { rx: 0.7 }),
  ]),
  edictMerchant: () => crest([
    circle(12, 11.6, 4.6),
    path('M12 8.6v6M10.6 10.2c0-.8.6-1.2 1.4-1.2s1.4.4 1.4 1c0 1.5-2.9.9-2.9 2.4 0 .7.6 1.1 1.5 1.1s1.5-.4 1.5-1.1', { fill: 'none', stroke: '#000', 'stroke-opacity': 0.45, 'stroke-width': 1, 'stroke-linecap': 'round' }),
  ]),
  edictWinter: () => crest([
    path('M12 5.8v11.6M7 8.7l10 5.8M17 8.7 7 14.5', { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round' }),
    path('M10.5 6.6 12 8l1.5-1.4M10.5 16.6 12 15.2l1.5 1.4', { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
  ]),
  edictFrontier: () => crest([
    path('M8 17.6V9.4h1.6V7.6h1.5v1.8h1.8V7.6h1.5v1.8H16v8.2Z'),
    path('M11 17.6v-3a1 1 0 0 1 2 0v3', { fill: '#000', 'fill-opacity': 0.45 }),
  ]),
  edictPeace: () => crest([
    path('M7.4 16.6c2.6-1.2 5.8-4.4 9.2-9.6', { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round' }),
    ellipse(9.6, 12.6, 1.2, 2.4, { transform: 'rotate(-40 9.6 12.6)' }), ellipse(12.4, 13.4, 1.2, 2.4, { transform: 'rotate(60 12.4 13.4)' }),
    ellipse(12.2, 9.6, 1.2, 2.4, { transform: 'rotate(-30 12.2 9.6)' }), ellipse(15, 10, 1.2, 2.4, { transform: 'rotate(70 15 10)' }),
  ]),
  edictDragons: () => crest([
    path('M12 5.6c.4 2.2 2.6 3.4 3.4 5.6.9 2.6-.6 5.8-3.4 6.2-2.8-.4-4.3-3.6-3.4-6.2.4-1.2 1.2-1.9 1.7-2.9.4 1.1.3 2 .9 2.8.4-1.8.4-3.6.8-5.5Z'),
    path('M12 17.2c-1.2-.4-1.8-1.6-1.4-2.8.3-.8 1-1.2 1.4-2 .4.8 1.1 1.2 1.4 2 .4 1.2-.2 2.4-1.4 2.8Z', { fill: '#000', 'fill-opacity': 0.35 }),
  ]),
  edictBounty: () => crest([
    circle(12, 11.8, 5, { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }),
    circle(12, 11.8, 2.6, { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }),
    circle(12, 11.8, 1),
  ]),
  edictFestival: () => crest([
    path('M8.6 6.8h6.8l-.6 3.4a2.8 2.8 0 0 1-5.6 0Z'),
    rect(11.2, 12.6, 1.6, 3.2), rect(9.2, 15.6, 5.6, 1.6, { rx: 0.6 }),
  ]),
  edictWarriors: () => crest([
    path('M8 6.6l8 9.6M16 6.6l-8 9.6', { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round' }),
    path('M7.4 13.4l3 2.6M16.6 13.4l-3 2.6', { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round' }),
  ]),
  edictRoads: () => crest([
    path('M10.4 6.4 7.6 17.4h8.8L13.6 6.4Z'),
    path('M12 8v1.8M12 11.4v1.8M12 14.8v1.8', { fill: 'none', stroke: '#000', 'stroke-opacity': 0.5, 'stroke-width': 1.1, 'stroke-linecap': 'round' }),
  ]),

  // the three Legacy branches: a round medallion (a soft disc and a rim) with War's sword, the Realm's keep, the Court's crown
  legacyWar: () => medallion([
    rect(11.1, 5.4, 1.8, 9.2, { rx: 0.5 }), polygon([[11.1, 5.4], [12.9, 5.4], [12, 3.8]]),
    rect(8.6, 14.2, 6.8, 1.6, { rx: 0.5 }), rect(11.2, 15.6, 1.6, 3.4, { rx: 0.5 }),
  ]),
  legacyRealm: () => medallion([
    path('M7 18V10.4h1.8V8.6h1.6v1.8h3.2V8.6h1.6v1.8H17V18Z'),
    path('M11 18v-3.4a1 1 0 0 1 2 0V18', { fill: '#000', 'fill-opacity': 0.45 }),
  ]),
  legacyCourt: () => medallion([
    path('M6.8 15.6 6 8.6l3.4 2.8L12 6.6l2.6 4.8L18 8.6l-.8 7Z'),
    rect(6.8, 16.4, 10.4, 1.8, { rx: 0.6 }),
  ]),

  // the Challenge marks, shown inside a laurel in the Realm panel and on the ceremony's toggles
  challengeIronWill: () => [
    path('M13.6 2.6 6.4 13.2h4.8l-1.2 8.2 7.6-11h-4.8Z'),
    line(4.6, 19.6, 19.4, 4.4, { stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' }),
  ],
  challengeOverrun: () => [
    path('M4.4 11.4 12 5.6l7.6 5.8v3.2L12 8.8l-7.6 5.8Z'),
    path('M4.4 17.4 12 11.6l7.6 5.8v3.2L12 14.8l-7.6 5.8Z'),
  ],
  challengeLoneBanner: () => [
    rect(6, 2.6, 2, 19, { rx: 0.7 }), circle(7, 2.8, 1.5),
    path('M8 4.4h11l-2.8 3.6L19 11.6H8Z'),
  ],
};

// the names config/edicts.js gives (keys only: app/dynasty.js maps each Edict and Challenge to its own crest or mark; these keep a raw config name drawable)
ICONS.snowflake = ICONS.edictWinter;
ICONS.road = ICONS.edictRoads;
ICONS.fist = ICONS.challengeIronWill;
ICONS.horde = ICONS.challengeOverrun;
// the Ashen Host's emblem under the spellings a config may use
ICONS['skull-crown'] = ICONS.skullCrown;
ICONS.crownSkull = ICONS.skullCrown;

/** An Edict crest: the shared heater shield behind a symbol. */
function crest(symbol) {
  const d = 'M12 1.8 20.4 4.6v6.6c0 5.4-3.5 9.4-8.4 11.2-4.9-1.8-8.4-5.8-8.4-11.2V4.6Z';
  return [path(d, { 'fill-opacity': 0.26 }), path(d, { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.3, 'stroke-linejoin': 'round' }), ...symbol];
}
/** A Legacy branch medallion: a round disc behind a symbol. */
function medallion(symbol) {
  return [circle(12, 12, 10.2, { 'fill-opacity': 0.24 }), circle(12, 12, 10.2, { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.3 }), ...symbol];
}

/**
 * @param {keyof typeof ICONS} name
 * @param {number} [size]
 * @returns {SVGSVGElement}
 */
export function icon(name, size = 20) {
  const svg = el('svg', {
    viewBox: '0 0 24 24', width: size, height: size, fill: 'currentColor',
    class: `icon icon-${name}`, 'aria-hidden': 'true', focusable: 'false',
  });
  const build = ICONS[name];
  if (!build) {
    console.warn(`[ui/icons] unknown icon "${name}"`);
    svg.appendChild(circle(12, 12, 8, { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }));
    return svg;
  }
  for (const node of build()) svg.appendChild(node);
  return svg;
}

/** Every icon name this module can build (for the gallery). */
export const ICON_NAMES = Object.keys(ICONS);
