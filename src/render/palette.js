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
  rank: '--c-rank',
  accent: '--c-accent',
  water: '--c-water',
  warn: '--c-warn',
  danger: '--c-danger',
};

import { UNIT_IDS } from '../content/balance.js';

const UNIT_VARS = {
  militia: '--c-militia',
  spearmen: '--c-spearmen',
  outriders: '--c-outriders',
  raiders: '--c-raiders',
  halberds: '--c-halberds',
  sappers: '--c-sappers',
  archers: '--c-archers',
  rams: '--c-rams',
  marshal: '--c-marshal',
};

const NUM_VARS = {
  floodAlpha: '--a-flood',
  floodStrongAlpha: '--a-flood-strong',
  gridAlpha: '--a-grid',
  blockedAlpha: '--a-blocked',
  riverAlpha: '--a-river',
};

/** Used headlessly (tests, node) and as the answer if a property is missing. */
export const FALLBACK = Object.freeze({
  bg: '#0b0d12', surface: '#262e3a', surface2: '#2e3849', line: '#3b475c',
  text: '#e7ebf3', textDim: '#93a0b8',
  player: '#3ddc97', enemy: '#ff5c5c', neutral: '#6b7688',
  gold: '#ffc857', rank: '#ffdd8f', accent: '#5aa9ff',
  water: '#6cc7f2', warn: '#f5a524', danger: '#f0463e',
  militia: '#e8e8ec', spearmen: '#5bd6a6', raiders: '#ffc857',
  rams: '#b07cff', marshal: '#ff8a3d',
  outriders: '#7fd8ff', halberds: '#ff6fa5', sappers: '#c9a227',
  archers: '#8be08b',
  floodAlpha: 0.2, floodStrongAlpha: 0.42, gridAlpha: 0.5, blockedAlpha: 0.9,
  riverAlpha: 0.5,
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
 * Ground shading bands.
 *
 * The old terrain had three near-identical tiers, which is exactly enough
 * banding to read as "slabs" and not nearly enough to read as a lit surface.
 * Seven steps over a wider range is the point where the quantisation stops
 * being visible as tiles and starts being visible as ground. It still costs
 * seven fills for the whole map, on a canvas that repaints ~once a second.
 */
export const PLATE_STEPS = 7;

/** Steps in the site-rank gold ramp. Fixed, and sampled by a site's position in
 *  the upgrade ladder, so lengthening SITE_LEVELS never touches a colour. */
export const RANK_STEPS = 8;

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
  // Built from UNIT_IDS rather than listed: a unit missing from either map is
  // one the renderer silently draws as `undefined`, which reads as a hole in a
  // garrison ribbon rather than as an error.
  p.units = Object.fromEntries(UNIT_IDS.map((u) => [u, c[u]]));
  // The same hues, pulled back for the composition ribbon on a garrison plaque.
  // At full strength militia-white was the brightest thing on the board and it
  // buried the number it was sitting under.
  const DIM = {
    militia: 0.5, spearmen: 0.6, outriders: 0.6, raiders: 0.6,
    halberds: 0.6, sappers: 0.65, rams: 0.7, marshal: 0.7,
  };
  p.unitsDim = Object.fromEntries(
    UNIT_IDS.map((u) => [u, withAlpha(c[u], DIM[u] ?? 0.6)]),
  );
  // Neutral is lifted off the token slightly: it has to carry a garrison
  // number on a near-black plaque, and #6b7688 at 11px does not.
  p.owner = {
    player: c.player, enemy: c.enemy,
    neutral: mix(c.neutral, c.text, 0.28), contested: c.warn,
  };

  // The ground ramp, dark end to lit end. Wide enough that a slope reads,
  // low-chroma enough that it never argues with a faction hue.
  // The dark end stops well short of black: a hex that reads as a HOLE in the
  // board is worse than a flat one, and the corners of a vignette are exactly
  // where that happens.
  const groundLo = mix(c.bg, '#000000', 0.16);
  const groundHi = mix(c.surface2, c.line, 0.78);
  p.plates = new Array(PLATE_STEPS);
  for (let i = 0; i < PLATE_STEPS; i++) {
    p.plates[i] = mix(groundLo, groundHi, i / (PLATE_STEPS - 1));
  }
  // Scrub marks scattered over unclaimed ground: the board has large empty
  // stretches and they need something to look at that is not a site.
  p.speck = withAlpha(c.textDim, 0.1);

  // Territory flood: low alpha so the near-black ground still dominates and
  // the faction hue reads as ownership rather than as furniture.
  p.flood = {
    player: withAlpha(c.player, c.floodAlpha),
    enemy: withAlpha(c.enemy, c.floodAlpha),
    neutral: withAlpha(c.neutral, c.floodAlpha * 0.75),
    contested: withAlpha(c.warn, c.floodAlpha * 0.5),
  };
  // Territory in THREE depths, keyed off how many neighbours share the owner.
  // A heartland is saturated and a frontier fades out, so held ground has a
  // direction and a gradient instead of being one flat slab of colour — and
  // the eye is pulled outward, toward the fighting, for free.
  p.floodT = {
    player: floodRamp(c.player, c.floodAlpha),
    enemy: floodRamp(c.enemy, c.floodAlpha),
    neutral: floodRamp(c.neutral, c.floodAlpha * 0.7),
  };
  // The front line: the outline where two FACTIONS meet, at high alpha.
  p.border = {
    player: withAlpha(c.player, c.floodStrongAlpha + 0.45),
    enemy: withAlpha(c.enemy, c.floodStrongAlpha + 0.45),
    neutral: withAlpha(c.neutral, c.floodStrongAlpha),
    contested: withAlpha(c.warn, c.floodStrongAlpha + 0.45),
  };
  // A wide, faint stroke laid under the front line along the SAME path, so the
  // border reads as hot without a shadowBlur (10-50x the cost of a fill).
  p.frontGlow = {
    player: withAlpha(c.player, 0.16),
    enemy: withAlpha(c.enemy, 0.16),
    neutral: withAlpha(c.neutral, 0.09),
    contested: withAlpha(c.warn, 0.16),
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
  // A dark moat ringing every site. The single cheapest way to make a piece sit
  // ON the board instead of being a patch OF it, and it is what lets an
  // adjacency line visibly terminate at a site rather than dissolve into it.
  p.siteShadow = withAlpha('#000000', 0.5);
  // The garrison core: the body fills with the owner's colour in proportion to
  // how full it is, so troop mass reads as AREA before any number is read.
  p.core = {
    player: withAlpha(c.player, 0.62),
    enemy: withAlpha(c.enemy, 0.62),
    neutral: withAlpha(c.neutral, 0.55),
  };
  p.coreEdge = {
    player: withAlpha(c.player, 0.95),
    enemy: withAlpha(c.enemy, 0.95),
    neutral: withAlpha(c.neutral, 0.9),
  };
  // The garrison plaque hanging under each site. Near-opaque, because the
  // number has to read identically over green ground, red ground and rock.
  p.plaque = withAlpha(mix(c.bg, '#000000', 0.25), 0.9);
  p.plaqueEdge = withAlpha(mix(c.line, c.textDim, 0.3), 0.95);
  // Structure walls. The track only appears on a site that is actually hurt.
  p.wall = withAlpha(c.line, 0.9);
  // Rock: mountains read as terrain with a lit face and a shadow face. The
  // contrast between the two is doing all the work — a flat silhouette at this
  // size is just a dark blob.
  p.rockLit = withAlpha(c.textDim, 0.42);
  p.rockDim = withAlpha('#000000', 0.5);
  // Contested ground is hatched in BOTH faction hues — a band that visibly
  // belongs to neither, which is exactly what a stalled front is.
  p.hatchA = withAlpha(c.player, 0.3);
  p.hatchB = withAlpha(c.enemy, 0.55);
  // OWNERSHIP'S SECOND CHANNEL (render/terrain.js makeOwnerHatch): the stripe
  // colour each faction's territory is woven with. NEUTRAL rather than the
  // faction hue — the whole point is a cue that survives when hue does not, and
  // striping green ground in green puts the signal straight back in the channel
  // that measured ΔE 1.8 under protanopia.
  //
  // LIGHT RATHER THAN DARK, AND THAT WAS MEASURED. The first cut was black at
  // 0.16, on the reasoning that darkening cannot tint. It is nearly invisible:
  // the flood is only `--a-flood` (0.2) over near-black ground and the fog veil
  // halves whatever is left, so a black stripe has no headroom to work in.
  // White has the whole dynamic range of a dark board.
  //
  // THE NUMBER THAT PROVES IT IS THE NEGATIVE CONTROL, not the raw contrast.
  // Measured off a real battle screenshot — clean faction-coloured patches,
  // gradient energy along one diagonal against the other — the board's own
  // plates, scrub and lattice already have a grain, and those patches lean
  // **-0.35** with the weave disabled. With it they lean **+0.40**. The sign
  // flip is the weave; the magnitude is how much other texture it competes
  // with. White at 0.10 / 0.14 / 0.22 all land in the same place, so this is
  // the middle of a flat optimum rather than a peak to defend.
  p.weave = withAlpha('#ffffff', 0.14);
  // The hex lattice is scaffolding, not content. Pulled well back from the
  // token's nominal alpha: at full strength it turned the board into a
  // spreadsheet and buried the one line that matters, the front.
  p.grid = withAlpha(mix(c.line, c.bg, 0.45), c.gridAlpha * 0.62);
  // What was the adjacency graph's colour. The graph itself is gone with the
  // rule it drew (see battleView.js), but `link` survives as routes.js's
  // fallback stroke for a squad whose owner has no colour — one live consumer,
  // and a neutral grey is exactly right for it.
  p.link = withAlpha(c.textDim, 0.55);
  p.plate = withAlpha(c.surface, 0.85);
  // --a-blocked controls how completely a mountain masks the territory
  // underneath: below 1 the flood bleeds through, so terrain still reads as
  // being INSIDE someone's ground.
  p.blocked = withAlpha(mix(c.bg, c.line, 0.8), c.blockedAlpha);
  p.blockedEdge = withAlpha(c.textDim, 0.55);
  // FOG OF WAR (render/fog.js): a flat dark wash over ground outside current
  // sight, no hue of its own — it must read as "unknown", never as a third
  // faction's colour, so it has to sit over the plate shading, the flood,
  // rivers and mountains without fighting any of them for attention.
  p.fogVeil = withAlpha('#000000', 0.5);
  // A FAILED ASSAULT'S MEMORY (render/fog.js `drawAssaultWash`). Unlike the
  // veil above, this one DOES carry a hue on purpose — it is a warning about a
  // specific piece of ground, not a statement that the ground is unknown, so
  // it borrows `danger` rather than mint a colour with no other meaning in
  // this palette. Low alpha: it rides on top of the veil, and the two
  // together should read as "dark, AND you have reason to be wary here",
  // never as a solid block that competes with the flood or a site glyph.
  p.assaultWash = withAlpha(c.danger, 0.30);
  // The stale garrison figure that sits beside it — legible on its own against
  // near-black ground (unlike the wash, which is deliberately too faint to
  // read text against), and coloured the same as the wash so the two are
  // obviously one fact rather than two unrelated marks near the same site.
  p.staleText = withAlpha(c.danger, 0.85);
  // WATER. ONE flat translucent fill, nothing else — the third pass at this
  // (see river.js for the full history). The first two both shaded it: a
  // four-layer stack of a darkened valley, a darkened bed, the water and a
  // lit core, plus a wash over the whole floodplain and a hairline shore.
  // Direct player feedback on that version: get rid of the shading, make the
  // river a translucent light blue, leave the rest of the tile its normal
  // colour. So there is exactly one river colour now — the raw hue at one
  // alpha, chosen so the hex's own ground and territory tint still show
  // through it plainly while the water itself stays unambiguously blue — and
  // nothing paints outside the ribbon shape river.js builds: no wash, no
  // shore, no second darker or lighter pass.
  p.river = withAlpha(c.water, c.riverAlpha);
  p.track = withAlpha(c.line, 0.95);
  p.shade = withAlpha(c.bg, 0.55);
  // Training progress. Dimmer than the selection accent it shares a hue with:
  // it is on nearly every non-farm site at once and must never out-shout a
  // thing the player actually picked.
  p.train = withAlpha(c.accent, 0.72);
  // A site being upgraded pegs out its next storey as dashed scaffolding. Same
  // accent as training, one notch brighter: both mean "paid for, not finished",
  // and the dashes are what keep the ghost from reading as built stone.
  p.building = withAlpha(c.accent, 0.85);
  // Site rank. The gauge is cut into one cell per upgrade step and the gold
  // WARMS toward ivory across them, so "nearly maxed" arrives as heat before a
  // single cell is counted. A fixed number of steps, sampled by position in the
  // ladder — the ramp never needs to know how many levels the content defines.
  p.rank = new Array(RANK_STEPS);
  for (let i = 0; i < RANK_STEPS; i++) {
    p.rank[i] = mix(c.rank, c.text, (i / (RANK_STEPS - 1)) * 0.42);
  }
  // Steps not yet bought: the rank hue sunk almost all the way into the ground,
  // so it reads as an empty rung rather than as a second, dimmer site. Drawn
  // wider than the cells, so it doubles as the casing that keeps gold legible
  // over a bright territory flood.
  p.rankTrack = withAlpha(mix(c.bg, c.rank, 0.15), 0.85);
  p.selection = withAlpha(c.accent, 0.9);
  p.selectionFill = withAlpha(c.accent, 0.12);
  // Hover gets its own value rather than borrowing the box-select fill: it is
  // a band of stroke over dark ground, not a wash over a large area, and at
  // 0.12 it was invisible — an affordance nobody can see is not an affordance.
  p.hover = withAlpha(c.accent, 0.26);
  return p;
}

/** Frontier -> heartland, three depths of one faction hue. */
function floodRamp(hue, a) {
  return [withAlpha(hue, a * 0.45), withAlpha(hue, a * 1.0), withAlpha(hue, a * 1.9)];
}

let cached = null;

/** Memoized boot-time palette. There is one theme and it is read once at
 *  boot; a `resetPalette` existed for a theme switcher that was never built,
 *  had no caller, and is gone. Reintroduce it with the switcher, not before. */
export function palette(el) {
  if (!cached) cached = readPalette(el);
  return cached;
}
