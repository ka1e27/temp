// Single home for every scene-flow / choreography timing constant (PLAYFEEL
// spec). Keeping them here means a designer pass is a one-file diff. Browser
// scene code only (no purity constraint) but this file itself touches
// nothing browser-specific, so it's safe to import from tests too.
import { FEATURES as MAP_FEATURES } from '../config/features.js';
import { ASHEN } from '../config/ashen.js';

const SHRINE_HOLD_SEC = MAP_FEATURES.shrine.holdSec; // tutorial V3's words

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
  cardPressSettleMs: 250, // a hint's room in the region card never opens or closes while a press is on the card, nor this long after it lifts (world.js hintRoom)
});

// Phase 10A: when hints may speak (game/app/tutorial.js, game/app/tutorialRules.js; facts from game/scenes/world.js)
export const HINT_PACE = Object.freeze({
  attackHintDelaySec: 2.5, // W3 "Attack!" only once the card has been open this long: a player who presses Attack on their own never needs it
  calmSec: 6,              // a `calm` step waits for this long on the map with no card, panel or dialog open (not on top of a return from battle)
  newHintGapSec: 10,       // a NEW step becomes current at most once per this many play seconds (urgent steps excepted): no hint storms
});

// Phase 10A: post-battle news posted with `digest: true` within this window is merged into one toast (main.js flushDigest)
export const TOASTS_DIGEST = Object.freeze({
  windowMs: 900,       // a battle's end posts its Renown, levels, Deeds and contracts within a few hundred ms of each other
  perExtraMs: 1500,    // each merged line adds this much reading time ...
  maxMs: 9000,         // ... up to this
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
 * @property {boolean} [urgent]  a war band, an offer, a battle twist: never waits for HINT_PACE.newHintGapSec (Phase 10A)
 * @property {boolean} [calm]  waits for HINT_PACE.calmSec of quiet on the map (Phase 10A)
 * @property {string} [intro]  the system this step introduces: it waits its turn (game/app/pacer.js, PACING.introGapSec; Phase 10A)
 * @property {string} text          the hint on a desktop
 * @property {string} [textTouch]   the hint for touch (tap, pinch, long-press instead of click, scroll, shift-drag)
 * @property {string} [textAim]     B5 only: what it says once Rally is armed and the player has to pick the target
 * @property {string} anchor        logical target key resolved by the scene that owns the step
 * @property {string[]} [after]     steps that must be seen before this one can show
 * @property {string[]} seenOn      the events that mark it seen (whether or not it is on screen: the player already knows it)
 * @property {number} [timeoutSec]  seen after this long ON SCREEN (never blocks the player)
 * @property {boolean} [activeOnly]  its events only mark it seen while it is the step on screen (B3: a capture before it showed should still show it)
 * @property {string} [needs]       a feature flag that must be on (supply lines, works, frontier): the step stays silent until that feature lands
 * @property {boolean} [afterDone] it may show after the first tutorial is done (founding a dynasty sets `tutorial.done`): Phase 5 features of later dynasties
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
  { id: 'M1', scene: 'world', calm: true, text: 'Spend gold in the War Council to grow stronger.', anchor: 'council', seenOn: ['councilOpened'] },
  { id: 'M2', scene: 'world', intro: 'scout', text: 'Scout a region to see its garrisons and weak point.', anchor: 'scout', after: ['M1'], seenOn: ['scouted'] },
  { id: 'M3', scene: 'world', calm: true, intro: 'works', text: 'Build Works in your regions: Barracks and Stables help the battles next to them.', anchor: 'worksRegion', after: ['M1'], seenOn: ['workBuilt'], needs: 'works' },
  { id: 'M4', scene: 'world', text: 'Found a Dynasty: start again, stronger, on a new continent.', anchor: 'realm', seenOn: ['realmOpened'] },
  // the Living Frontier (DESIGN 10.1, 10.3, 10.5): a war band is coming (on the map, or while you fight elsewhere); two battles at once; fortify the border
  {
    id: 'F1', scene: 'world', urgent: true, anchor: 'raidGo', seenOn: ['raidGo', 'defenseStarted'], needs: 'frontier',
    text: 'A war band is coming! Press Go to defend it yourself, or let your Captain hold it.',
  },
  {
    id: 'F2', scene: 'battle', urgent: true, anchor: 'raidGo', seenOn: ['raidGo', 'defenseStarted'], needs: 'frontier',
    text: 'A war band is coming! Press Go to defend it yourself, or let your Captain hold it.',
  },
  {
    id: 'F3', scene: 'battle', urgent: true, anchor: 'tray', seenOn: ['battleSwitched'],
    text: 'Two battles at once: press Tab or pick one in the tray to switch. The other keeps going.',
    textTouch: 'Two battles at once: tap one in the tray to switch. The other keeps going.',
  },
  {
    id: 'F4', scene: 'world', calm: true, intro: 'fortify', anchor: 'fortRegion', seenOn: ['fortBuilt'], needs: 'frontier',
    text: 'Fortify your border: Arrow Towers and Walls defend a region when it is attacked.',
  },
  // Generals and Renown (DESIGN 10.11, 10.12)
  {
    // after the second battle's own lessons (supply lines, pause and speed), and it steps aside after 12 s on screen: it must never crowd them out
    id: 'G1', scene: 'battle', anchor: 'ability', after: ['C3'], seenOn: ['abilityUsed'], needs: 'frontier', timeoutSec: 12,
    text: 'Your Marshal commands here: press G or tap the ability once per battle.',
    textTouch: 'Your Marshal commands here: tap the ability once per battle.',
  },
  { id: 'G2', scene: 'world', calm: true, intro: 'generals', anchor: 'generalsBtn', seenOn: ['generalsOpened', 'skillPicked'], needs: 'frontier', timeoutSec: 12, text: 'A General grew stronger: open Generals to choose a skill.' },
  { id: 'R1', scene: 'world', calm: true, intro: 'festival', anchor: 'festivalRegion', after: ['M1'], seenOn: ['festival'], needs: 'frontier', timeoutSec: 12, text: 'You have the Renown for a Festival: it raises a region’s prosperity at once.' },
  // A varied map (DESIGN 10.13; phase3-hookup §5): the first typed or twisted region on the frontier, the first Siege, the first Raid, the Dragon's
  // first warning and the first world event. Each steps aside after a few seconds on screen.
  { id: 'V1', scene: 'world', calm: true, intro: 'variety', anchor: 'featureRegion', after: ['M1'], seenOn: ['featureCardOpened'], needs: 'frontier', timeoutSec: 10, text: 'Some regions hold a treasure or a twist: the icon by the name says which. Open one to see.' },
  { id: 'V2', scene: 'battle', urgent: true, anchor: 'gate', seenOn: ['gateTaken'], needs: 'frontier', timeoutSec: 10, text: 'Take the Gate to open the keep.' },
  { id: 'V3', scene: 'battle', urgent: true, anchor: 'shrine', seenOn: ['shrinesHeld'], needs: 'frontier', timeoutSec: 10, text: `Hold all three Shrines for ${SHRINE_HOLD_SEC} s to win.` },
  { id: 'V4', scene: 'battle', urgent: true, anchor: 'telegraph', seenOn: ['bulwark'], needs: 'frontier', timeoutSec: 6, text: 'Bulwark the target!' },
  { id: 'V5', scene: 'world', urgent: true, anchor: 'eventToast', seenOn: ['eventAnswered'], needs: 'frontier', timeoutSec: 12, text: 'A world event: answer it before its time runs out.' },
  // Goals and Rivals (PLAN-PHASE4): the Bounty Board the moment it opens (after M1, so it never crowds the first lessons), and the first Vendetta's warning.
  // Last in the list: an earlier step that is due always goes first.
  { id: 'Q1', scene: 'world', calm: true, intro: 'board', anchor: 'regionsBtn', after: ['M1'], seenOn: ['boardOpened'], needs: 'frontier', timeoutSec: 12, text: 'New: the Bounty Board. Open Regions for three contracts that pay extra.' },
  { id: 'Q2', scene: 'world', urgent: true, anchor: 'vendettaGo', seenOn: ['vendettaGo', 'defenseStarted'], needs: 'frontier', timeoutSec: 12, text: 'A Vendetta! Their leader comes in person with a Champion. Beat it for a Trophy: press Go.' },
  // Dynasties that change the rules (PLAN-PHASE5): D1 is drawn INSIDE the founding ceremony (ui/ceremony.js setEdictHint; its rule is always false, so the coach never
  // picks it), the first time it opens; D2 points at Quick Conquest the first time an open card offers it (after M1, last in the list: never crowds earlier steps).
  { id: 'D1', scene: 'world', anchor: 'edicts', seenOn: ['edictPicked'], text: 'Your first Edict: pick the card that suits how you like to play. It lasts until the next founding, and the Realm panel always shows it.' },
  { id: 'D2', scene: 'world', intro: 'quick', anchor: 'quickBtn', after: ['M1'], seenOn: ['quickConquest'], timeoutSec: 12, afterDone: true, text: 'New: Quick Conquest. Your commander takes this Easy region at once, for the Victory crown.' },
  // The Ashen Host (PLAN-PHASE6 §6B): the first time one of its regions is on the frontier (Dynasty 2 on, so `afterDone`). Last in the list and after M1:
  // every earlier step that is due goes first; it steps aside after 12 s and is seen once its card is opened.
  { id: 'A1', scene: 'world', calm: true, intro: 'ashen', anchor: 'ashenRegion', after: ['M1'], seenOn: ['ashenCardOpened'], timeoutSec: 12, afterDone: true, text: ASHEN.copy.hint },
  // Phase 7 (PLAN-PHASE7): K1 lives inside the first Boon draft (a static line: the coach layer sits under dialogs, like D1); L1 is the first Relic on
  // the frontier (its label and chest), last in the list and after M1 like A1, so every earlier step that is due goes first; it steps aside after 12 s
  { id: 'K1', scene: 'world', anchor: 'boonDraft', seenOn: ['boonPicked'], text: 'Your first Boon: pick the card that suits how you fight. It lasts the dynasty.' },
  { id: 'L1', scene: 'world', calm: true, intro: 'relics', anchor: 'relicRegion', after: ['M1'], seenOn: ['relicCardOpened'], timeoutSec: 12, afterDone: true, text: 'A Relic lies in this region: conquer it to claim it for your dynasty. Click it to see what it does.', textTouch: 'A Relic lies in this region: conquer it to claim it for your dynasty. Tap it to see what it does.' },
  // Phase 8 (§8B): after the first battle, once the first-session steps have had their turn (last in the table, so any earlier step that is due wins)
  { id: 'H1', scene: 'world', calm: true, intro: 'codex', anchor: 'settingsBtn', after: ['M1'], seenOn: ['codexOpened'], timeoutSec: 10, text: 'Forgot how something works? Settings has a Codex that explains every system.' },
  // Phase 9: the Challenges open after the first conquest beyond home; the hint waits for the Codex hint (table order: H1 first) and is last in the table, so every
  // earlier step that is due goes first; it steps aside after 10 s and is seen once the hub is opened
  { id: 'J1', scene: 'world', calm: true, intro: 'challenges', anchor: 'settingsBtn', after: ['M1'], seenOn: ['challengesOpened'], timeoutSec: 10, afterDone: true, text: 'New: Challenges. A Daily puzzle everyone shares and handcrafted Scenarios, in Settings.' },
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
