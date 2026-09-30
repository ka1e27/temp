// Living-map ambient life tuning (DESIGN §7.7): caravans, chimney smoke, windmill sails, sailboats,
// bird flocks. Everything numeric that render/ambient.js, render/ambientSprites.js,
// render/prosperityDecor.js and world/caravanRoutes.js do lives here.
//
// Units: "world units" are hex-size units (centre to corner = 1; adjacent tile centres are
// sqrt(3) apart). `zoom` is CSS px per world unit (camera.zoom). {hide, full} pairs are alpha ramps:
// invisible at/below `hide`, fully visible at/above `full`.

const R3 = Math.sqrt(3);

export const AMBIENT = Object.freeze({
  /** Budget for ALL ambient life at 1440x900, per frame (DESIGN §7.7). The gallery checks it. */
  budgetMs: 1.0,

  /** Max ms per draw call spent baking NEW sprites (a zoom bucket seen for the first time is spread over frames). */
  spriteBudgetMs: 3,

  /** Cull margin (world units) around the visible bounds. */
  cullMargin: 2.5,

  /**
   * How far a land tile's top face is raised by elevation, in world units (water, lowland, hills,
   * mountain). MIRRORS `elevOffset(tile, 1)` in render/tiles.js (ELEV_SKIRT_FRAC); a test in
   * game/tests/world.caravanRoutes.test.js fails if the two ever drift apart.
   */
  elevLift: Object.freeze([0, 0.22, 0.34, 0.5]),

  hexPitch: R3,

  /** Quality 0..1 (`setQuality`): counts scale by `minFactor + (1 - minFactor) * quality`. */
  quality: Object.freeze({ minFactor: 0.5, noDustBelow: 0.34, noBirdShadowBelow: 0.34 }),

  /** Reduce Motion: no birds, static sails, half the smoke, caravans at 60 % speed. */
  reduceMotion: Object.freeze({ birds: false, sailsTurn: false, smokeFactor: 0.5, caravanSpeed: 0.6 }),

  caravans: Object.freeze({
    maxAlive: 40,
    speedHexPerSec: 0.6, // DESIGN §7.7 ("about 0.6 hex/s")
    speedJitter: 0.14, // +/- per cart, so two carts never travel glued together
    fadeUnits: 0.9, // fade-in / fade-out distance at the ends of a route (world units)
    // Visibility by zoom: nothing below `dots.hide`; tiny dots from there; cart sprites take over
    // (cross-fade) between `sprite.dot` and `sprite.full`.
    dots: Object.freeze({ hide: 8, full: 10.5 }),
    sprite: Object.freeze({ dot: 15, full: 19 }),
    // Spawn rate: carts/min for a route = rateBase * weight * (income / incomeRef) ^ incomeExp,
    // clamped. Income = the region's own `regionIncome` (tier based).
    incomeRef: 1,
    incomeExp: 0.4,
    rateBase: 3.4,
    rateMin: 0.7,
    rateMax: 9,
    // A route runs 1..maxLanes independent "lanes"; the lane period is chosen near this target.
    lanePeriodTargetSec: 30,
    maxLanes: 4,
    // Route weight by the settlement type the route starts at; trunk routes (keep to keep) carry the
    // region's whole surplus.
    sourceWeight: Object.freeze({ hamlet: 0.8, village: 1, town: 1.5, fort: 0.5, tower: 0.4, keep: 1 }),
    trunkWeight: 1.4,
    // Empty carts (bare bed, no cloth) come back along every route the other way at this share of the
    // loaded density: from the keep to the settlement, and from the next keep toward the outlying one.
    returnShare: 0.5,
    emptyDot: '#d8c9a3',
    // Sprite geometry (world units; whole train of animal + cart, side view).
    length: 0.58,
    bobAmp: 0.014,
    bobHz: 2.6,
    tiltFactor: 0.4, // share of the path slope the sprite tilts by (side-view art)
    maxTilt: 0.5, // rad
    dust: Object.freeze({ puffs: 3, spacing: 0.34, minZoom: 20, alpha: 0.2, radius: 0.13 }),
    dotRadius: 0.24, // world units, at least dotMinPx px
    dotMinPx: 2.5,
    // Carts never look smaller than this many px long: below the zoom where they reach it they are
    // drawn larger than true scale (up to spriteBoostMax), so a busy road still reads at 1440x900.
    spriteMinPx: 19,
    spriteBoostMax: 1.8,
    // keepProb thinning when more carts are in view than the cap allows.
    thinStep: 0.02,
  }),

  smoke: Object.freeze({
    zoom: Object.freeze({ hide: 12, full: 16 }),
    puffs: 12, // soft puffs streaming in one baked wisp; Reduce Motion / low quality / rival settlements draw the sparse one
    puffsSparse: 6, // half the smoke
    frames: 32, // frames in the baked wisp loop (one full life)
    variants: 2, // wisp shapes, picked per chimney
    maxPlumes: 160, // plumes drawn per frame at most (thinned by a stable per-chimney priority)
    periodSec: 3.9, // life of a puff
    rise: 1.15, // world units a puff climbs over its life
    drift: 0.4, // sideways wind drift over a life
    wobble: 0.07,
    radius0: 0.055,
    radius1: 0.28,
    alpha: 0.95,
    // Chimney anchors relative to the settlement tile's top-face centre (world units, y up = negative).
    // Measured against sprites-buildings.js so the plume leaves a real roof: see the gallery
    // "smoke and windmills" close-up when you change a building.
    chimneys: Object.freeze({
      hamlet: Object.freeze([{ dx: -0.5, dy: -0.66 }]),
      village: Object.freeze([{ dx: -0.66, dy: -0.58 }, { dx: 0.34, dy: -0.72 }]),
      town: Object.freeze([{ dx: -0.86, dy: -0.5 }, { dx: 0.62, dy: -0.48 }, { dx: -0.06, dy: -0.76 }]),
      keep: Object.freeze([{ dx: -0.24, dy: -1.02 }]),
    }),
    /** Tiny brick stub drawn under each plume so the smoke visibly leaves a chimney. */
    stub: Object.freeze({ w: 0.07, h: 0.11, zoomFrom: 18 }),
  }),

  windmill: Object.freeze({
    zoom: Object.freeze({ hide: 10, full: 14 }),
    // Geometry shared by the baked tower (prosperityDecor) and the live sails (ambient).
    towerH: 0.88, // top of the tower body above the tile top-face centre (world units)
    towerW: 0.34, // base width
    hubDx: 0.04, // sail hub relative to the tile top-face centre
    hubDy: -0.9,
    sailLen: 0.74,
    rpm: 5.5, // revolutions per minute
    frames: 24, // baked rotor frames over a quarter turn (the rotor is 4-fold symmetric)
    staticAngle: 0.35, // rad, for Reduce Motion
  }),

  boats: Object.freeze({
    zoom: Object.freeze({ hide: 11, full: 15 }),
    perHarbour: Object.freeze([1, 2]), // per Harbour region, by its coast length
    laneTiles: Object.freeze([3, 5]), // water tiles a boat drifts along
    speedHexPerSec: 0.11,
    length: 0.7,
    bobAmp: 0.028,
    bobHz: 0.55,
    rollAmp: 0.09, // rad
    otherSail: '#f6f1e3', // sails of boats off regions the player does not own
    hull: '#7a5432',
    maxShare: 24, // hard cap on boats drawn per frame
  }),

  birds: Object.freeze({
    zoom: Object.freeze({ hide: 10, full: 14 }),
    intervalSec: Object.freeze([20, 40]), // between flocks
    firstSec: Object.freeze([6, 14]), // before the first flock after load
    flock: Object.freeze([5, 7]),
    speed: 2.3, // world units / s
    pathLen: 30, // world units a flock travels (the view is the arena; it flies through it)
    span: 0.3, // wing half-span, world units
    minSpanPx: 6.5, // half-span never below this many px (the flock must read at mid zoom)
    altitude: 0.95, // how high above the ground they fly (world units), for the shadow offset
    flapHz: 3.4,
    color: '#2b3040',
    shadowAlpha: 0.13,
  }),
});
