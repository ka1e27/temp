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
  maxZoomPhone: 28, // a region should not fill a phone screen (it used to reach 50)
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
 * The tutorial (DESIGN §6, PLAYFEEL §4): one hint at a time, each pointing exactly at what it talks about, each marked SEEN when the player does
 * the thing (or dismisses it, or its timeout runs out). Steps are a set of seen ids, not a counter: the order below is the priority when several
 * are eligible, `after` lists steps that must be seen first, and the rules that say WHEN a step is eligible live in game/app/tutorialRules.js.
 * @typedef {Object} TutorialStep
 * @property {string} id
 * @property {'world'|'battle'} scene
 * @property {string} text          the hint on a desktop
 * @property {string} [textTouch]   the hint for touch (tap, pinch, long-press instead of click, scroll, shift-drag)
 * @property {string} [textAim]     B5 only: what it says once Rally is armed and the player has to pick the target
 * @property {string} anchor        logical target key resolved by the scene that owns the step
 * @property {string[]} [after]     steps that must be seen before this one can show
 * @property {string[]} seenOn      the events that mark it seen (whether or not it is on screen: the player already knows it)
 * @property {number} [timeoutSec]  seen after this long ON SCREEN (never blocks the player)
 * @property {boolean} [activeOnly]  its events only mark it seen while it is the step on screen (B3: a capture before it showed should still show it)
 * @property {string} [needs]       a feature flag that must be on (supply lines, works): the step stays silent until that feature lands
 */

/** @type {TutorialStep[]} */
export const TUTORIAL_STEPS = Object.freeze([
  { id: 'W0', scene: 'world', text: 'This is your realm. Its villages pay you gold every second.', anchor: 'gold', seenOn: ['tap'], timeoutSec: 5 },
  { id: 'W1', scene: 'world', text: 'Drag to move the map. Scroll (or pinch) to zoom.', textTouch: 'Drag to move the map. Pinch to zoom.', anchor: 'mapCard', after: ['W0'], seenOn: ['panAndZoom'], timeoutSec: 30 },
  { id: 'W2', scene: 'world', text: 'Click a glowing region to see what it offers.', textTouch: 'Tap a glowing region to see what it offers.', anchor: 'region', after: ['W1'], seenOn: ['regionSelected'] },
  { id: 'W3', scene: 'world', text: 'Attack! Battles take a minute or two.', anchor: 'attack', seenOn: ['battleStart'] },
  { id: 'B1', scene: 'battle', text: "Drag from your War Camp to a settlement. The arrow turns green and says 'capture' if you'll take it.", textTouch: "Drag from your War Camp to a settlement. The arrow turns green and says 'capture' if you'll take it.", anchor: 'camp', seenOn: ['send'] },
  { id: 'B2', scene: 'battle', text: 'Choose how much to send: press 1–4 or tap the bar.', textTouch: 'Choose how much to send: tap the bar.', anchor: 'sendBar', after: ['B1'], seenOn: ['sizeChanged'] },
  { id: 'B3', scene: 'battle', text: 'Captured settlements grow troops for you. Take their keep (the castle) to win.', anchor: 'enemyKeep', after: ['B1'], seenOn: ['capture'], activeOnly: true, timeoutSec: 10 },
  {
    id: 'B4', scene: 'battle', anchor: 'twoSites', after: ['B1'], seenOn: ['multiSend'],
    text: 'Click your settlements to select several (or shift-drag to lasso, A for all), then click a target.',
    textTouch: 'Tap your settlements to select several, then tap a target.',
  },
  {
    id: 'B5', scene: 'battle', anchor: 'rally', after: ['B1'], seenOn: ['rally'],
    text: 'Rally: every settlement you own sends half its troops to one place at once. Press Q or tap Rally, then pick the target.',
    textTouch: 'Rally: every settlement you own sends half its troops to one place at once. Tap Rally, then tap the target.',
    textAim: 'Now pick where everyone goes: click a settlement.',
  },
  {
    id: 'C1', scene: 'battle', anchor: 'supply', after: ['B1'], seenOn: ['supplyCreated'], needs: 'supply',
    text: 'Set up a supply line: Ctrl-drag (or long-press, or switch on Auto) and troops keep flowing on their own.',
    textTouch: 'Set up a supply line: long-press a settlement, then drag. Or switch on Auto.',
  },
  { id: 'C2', scene: 'battle', text: 'You can only attack where your land touches theirs. Take the near settlements first.', anchor: 'blocked', after: ['B1'], seenOn: [], needs: 'supply', timeoutSec: 6 },
  {
    id: 'C3', scene: 'battle', anchor: 'pauseSpeed', after: ['B1'], seenOn: ['pauseOrSpeed'],
    text: 'Space pauses. The speed button runs the battle faster.',
    textTouch: 'Tap pause to stop the battle. The speed button runs it faster.',
  },
  {
    id: 'P1', scene: 'battle', anchor: 'firestorm', seenOn: ['firestorm'],
    text: 'Firestorm: press W (or tap it), then click where it should land. Powers recharge; watch the ring.',
    textTouch: 'Firestorm: tap it, then tap where it should land. Powers recharge; watch the ring.',
  },
  {
    id: 'P2', scene: 'battle', anchor: 'selection', after: ['B4'], seenOn: ['selectionCleared'],
    text: 'Right-click or Esc clears your selection.',
    textTouch: 'Tap an empty spot to clear your selection.',
  },
  { id: 'M1', scene: 'world', text: 'Spend gold in the War Council to grow stronger.', anchor: 'council', seenOn: ['councilOpened'] },
  { id: 'M2', scene: 'world', text: 'Scout a region to see its garrisons and weak point.', anchor: 'scout', after: ['M1'], seenOn: ['scouted'] },
  { id: 'M3', scene: 'world', text: 'Build Works in your regions: Barracks and Stables help the battles next to them.', anchor: 'worksRegion', after: ['M1'], seenOn: ['workBuilt'], needs: 'works' },
  { id: 'M4', scene: 'world', text: 'Found a Dynasty: start again, stronger, on a new continent.', anchor: 'realm', seenOn: ['realmOpened'] },
]);

/** The live send arrow: saturated green when the send would capture, red when it would not (gold otherwise), grey when there is no route (front lines). Read by battle.js and tools/check.mjs. */
export const DRAG_ARROW = Object.freeze({ capture: '#2bd46b', fail: '#ff4545', neutral: '#f5c451', blocked: '#8d96a5' });

/** The words for a send or supply order that has no route (DESIGN 4.4). One string, shared by the drag tooltip, the refusal and the tutorial. */
export const NO_ROUTE_TEXT = 'No route: take a closer settlement first';

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
