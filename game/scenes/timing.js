// Single home for every scene-flow / choreography timing constant (PLAYFEEL
// spec). Keeping them here means a designer pass is a one-file diff. Browser
// scene code only (no purity constraint) but this file itself touches
// nothing browser-specific, so it's safe to import from tests too.

export const BOOT = Object.freeze({
  fadeMs: 600,
});

export const TITLE = Object.freeze({
  // Lazy Lissajous drift across the continent (PLAYFEEL §1).
  driftSpeedX: 0.021, // radians/s for the x lobe
  driftSpeedY: 0.014, // radians/s for the y lobe (different ratio => Lissajous, not a circle)
  driftRadiusFrac: 0.28, // fraction of the fit-bounds half-extent
  zoomBreatheSpeed: 0.09, // radians/s
  zoomBreatheAmount: 0.06, // +/- fraction of base zoom
});

export const WORLD_SCENE = Object.freeze({
  minZoomFactor: 0.85, // × fitZoom(world.bounds)
  maxZoomDesktop: 70,
  maxZoomPhone: 50,
  panPaddingWorld: 2, // world units of pad beyond land bounds for pan clamp
  hoverBrighten: 0.08,
  frontierPulsePeriodSec: 2.2,
  frontierPulseAlphaMin: 0.35,
  frontierPulseAlphaMax: 0.85,
  labelFadeStartZoom: 32, // starts fading
  labelFadeEndZoom: 42, // fully gone
  idlePopMinSec: 2.5,
  idlePopMaxSec: 4,
  autosaveIntervalSec: 5,
  welcomeBackMinSec: 60,
});

export const BATTLE_ENTER = Object.freeze({
  cardSlideOutMs: 200,
  flyMs: 900,
  dimFadeMs: 400,
  dimBrightness: 0.45,
  campDropMs: 500,
  hudSlideMs: 300,
  totalMs: 900 + 400 + 500, // rough budget the caller can wait on before starting the sim
});

export const BATTLE_SCENE = Object.freeze({
  maxZoomDesktop: 70,
  maxZoomPhone: 50,
  minZoomFactor: 0.85,
});

export const VICTORY = Object.freeze({
  captureHitstopMs: 250,
  surrenderStaggerMs: 120,
  floodMsPerHex: 45,
  floodShimmerMs: 250,
  fanfareDelayMs: 300,
  pullBackMs: 1100,
  cloudPartMs: 1400,
  cloudPartStaggerMs: 150,
  coinCount: 12,
  coinStaggerMs: 70,
  coinFlightMs: 700,
});

export const DEFEAT = Object.freeze({
  bannerFallMs: 500,
});

/**
 * @typedef {Object} TutorialStep
 * @property {number} id
 * @property {string} text
 * @property {string} anchor  logical anchor key resolved by the scene that owns it
 * @property {'timeout'|'tap'|'regionSelected'|'battleStart'|'send'|'captureOrTimeout'
 *   |'powerUsed'|'councilOpened'} advance
 * @property {number} [timeoutSec]
 */

/** @type {TutorialStep[]} */
export const TUTORIAL_STEPS = Object.freeze([
  { id: 0, text: 'This is your realm. Its villages pay you gold every second.', anchor: 'gold', advance: 'timeoutOrTap', timeoutSec: 5 },
  { id: 1, text: 'Click a glowing region to see what it offers.', anchor: 'frontier', advance: 'regionSelected' },
  { id: 2, text: 'Attack! Battles take a minute or two.', anchor: 'attack', advance: 'battleStart' },
  { id: 3, text: "Drag from your War Camp to a settlement. The arrow tells you if you'll take it.", anchor: 'camp', advance: 'send' },
  { id: 4, text: 'Captured settlements grow troops for you. Take the enemy keep (the castle) to win.', anchor: 'enemyKeep', advance: 'captureOrTimeout', timeoutSec: 10 },
  { id: 5, text: 'Try Rally: every settlement sends half its troops at once.', anchor: 'rally', advance: 'powerUsed' },
  { id: 6, text: 'Spend gold in the War Council to grow stronger.', anchor: 'council', advance: 'councilOpened' },
]);

/** The live send arrow: saturated green when the send would capture, red when it would not (gold otherwise). Read by battle.js and tools/check.mjs. */
export const DRAG_ARROW = Object.freeze({ capture: '#2bd46b', fail: '#ff4545', neutral: '#f5c451' });

/**
 * The "Stuck?" coach hint (once per battle, hints on, never during the tutorial's battle steps): when this much battle time has passed since the
 * player last captured a site (or since the start) and a power is ready, point at that power. Only powers that are unlocked AND ready are named.
 */
export const STUCK_HINT = Object.freeze({
  afterSec: 60,
  showMs: 9000,
  text: Object.freeze({
    both: 'Stuck? Firestorm their strongest site, or Rally everything at once.',
    firestorm: 'Stuck? Firestorm their strongest site.',
    rally: 'Stuck? Rally everything at once.',
  }),
});

export const DIFFICULTY_COLORS = Object.freeze({
  Easy: '#6fcf97',
  Fair: '#f5c451',
  Hard: '#f2994a',
  Deadly: '#eb5757',
});

/** Quantised zoom buckets (px/world-unit) for the terrain/territory chunk caches. */
export const ZOOM_BUCKETS = Object.freeze([8, 11, 16, 22, 32, 45, 64, 90, 128]);

/** Nearest bucket to a raw zoom value. */
export function nearestBucket(zoom) {
  let best = ZOOM_BUCKETS[0];
  let bestD = Math.abs(zoom - best);
  for (let i = 1; i < ZOOM_BUCKETS.length; i++) {
    const d = Math.abs(zoom - ZOOM_BUCKETS[i]);
    if (d < bestD) {
      bestD = d;
      best = ZOOM_BUCKETS[i];
    }
  }
  return best;
}
