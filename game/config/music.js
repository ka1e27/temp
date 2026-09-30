// Music tuning: tempos, keys, progressions, layer thresholds, mix levels, stinger timing.
// Every number that shapes the score lives here (CLAUDE.md: "every tuning number lives in
// game/config/*.js"). game/audio/music*.js only interprets these tables. See docs/MUSIC.md.

// --- Why only three keys ------------------------------------------------------------
// Every pitch in game/audio/cues.js is a white-key note (C E G, and D F A for `defeat`).
// So every seeded key below is a mode of the C-major collection (D dorian, G mixolydian,
// A aeolian): the sound effects can never contain a note the music does not, and vice versa.
// Adding a key with accidentals (F# etc.) would put sfx and score a semitone apart.

export const MUSIC = Object.freeze({
  // --- engine timing ----------------------------------------------------------------
  tickMs: 25,                 // scheduler timer period
  lookaheadSec: 0.15,         // notes are handed to WebAudio this far ahead of currentTime
  startLeadSec: 0.12,         // first bar starts this long after the first tick
  minSwitchLeadSec: 0.4,      // a scene change lands on the first bar line at least this far ahead
  stallSec: 0.75,             // a tick gap longer than this (throttled tab) shifts the timeline, keeping bar phase
  lateNoteDropSec: 0.08,      // note events this far in the past (a stalled tab) are skipped, not burst
  defaultVolume: 0.4,         // music's own volume under master
  defaultSeed: 1,
  volumeSmoothSec: 0.05,

  // --- meter ------------------------------------------------------------------------
  beatsPerBar: 4,
  stepsPerBeat: 4,            // patterns are written on a 16-step bar
  phraseBars: 8,
  sectionPhrases: 4,          // the progression changes every N phrases (about 1.5-2 min in `world`)

  // Battle is exactly 3:2 against world, so a beat of one is two thirds of the other.
  scenes: {
    title:  { bpm: 66,  crossfadeSec: 2.6 },
    world:  { bpm: 72,  crossfadeSec: 2.6 },
    battle: { bpm: 108, crossfadeSec: 1.8 },
  },
  tempoScaleRange: [0.95, 1.03], // seeded, applied to every scene (battle stays inside 96-112)

  // --- keys, modes, harmony ---------------------------------------------------------
  keys: [
    { id: 'dDorian',     tonicPc: 2, mode: 'dorian' },
    { id: 'gMixolydian', tonicPc: 7, mode: 'mixolydian' },
    { id: 'aAeolian',    tonicPc: 9, mode: 'aeolian' },
  ],
  // `steps`: semitones of the 7 modal degrees. `penta`: which degrees the melody may use
  // (minor pentatonic / suspended pentatonic: no leading tone, no tritone).
  modes: {
    dorian:     { steps: [0, 2, 3, 5, 7, 9, 10], penta: [0, 2, 3, 4, 6] },
    mixolydian: { steps: [0, 2, 4, 5, 7, 9, 10], penta: [0, 1, 3, 4, 6] },
    aeolian:    { steps: [0, 2, 3, 5, 7, 8, 10], penta: [0, 2, 3, 4, 6] },
  },
  // Eight bars, one diatonic triad per bar, as degree indices. The diminished degree of each
  // mode is never used (dorian 5, mixolydian 2, aeolian 1). The last chord leads back home.
  progressions: {
    dorian: [
      [0, 3, 0, 3, 6, 3, 0, 4],
      [0, 6, 3, 0, 0, 6, 3, 4],
      [0, 0, 2, 2, 3, 3, 6, 4],
      [0, 2, 6, 3, 0, 2, 6, 4],
    ],
    mixolydian: [
      [0, 6, 3, 0, 0, 6, 3, 4],
      [0, 0, 3, 3, 6, 6, 0, 4],
      [0, 3, 6, 0, 0, 3, 6, 5],
      [0, 1, 3, 0, 0, 1, 6, 4],
    ],
    aeolian: [
      [0, 6, 5, 6, 0, 6, 5, 4],
      [0, 5, 2, 6, 0, 5, 6, 4],
      [0, 0, 3, 3, 5, 5, 6, 4],
      [0, 2, 6, 3, 0, 2, 6, 4],
    ],
  },
  // Pitch classes (0 = C) present in every cue in cues.js except the D-minor `defeat`.
  // The victory stinger's resolving chord is built only from these, so it sits inside the
  // C-major fanfare (C E G C) instead of rubbing against it.
  sfxSafePcs: [0, 2, 4, 7, 9],
  defeatPcs: [2, 5, 9],       // D minor: the same triad the defeat cue walks down

  // --- melody generation ------------------------------------------------------------
  motif: {
    // [startBeat, lengthBeats] over a two-bar (8 beat) figure. Rests are the gaps.
    rhythms: [
      [[0, 1.5], [1.5, 0.5], [2, 2], [4, 1.5], [5.5, 0.5], [6, 2]],
      [[0, 1], [1, 1], [2, 2], [4, 1], [5, 1], [6, 2]],
      [[0, 2], [2, 1], [3, 1], [4, 3], [7, 1]],
      [[0.5, 1], [1.5, 1], [2.5, 1.5], [4, 1], [5, 1], [6, 2]],
      [[0, 1], [1, 0.5], [1.5, 0.5], [2, 2], [4, 2], [6, 1.5]],
      [[0, 3], [3, 1], [4, 1.5], [5.5, 0.5], [6, 2]],
    ],
    startPool: [0, 3, 5],     // pool indexes a figure may open on (tonic, fifth, octave)
    stepChoices: [-2, -1, -1, 1, 1, 2, 3],
    poolLo: -2, poolHi: 7,
    stableMod: [0, 1, 3],     // pool index % 5 that count as stable resting tones
    // Four two-bar statements per phrase; the last one is always pulled onto the tonic.
    forms: [
      [['A', 'exact'], ['A', 'up'], ['B', 'exact'], ['A', 'exact']],
      [['A', 'exact'], ['B', 'exact'], ['A', 'orn'], ['B', 'exact']],
      [['A', 'orn'], ['A', 'exact'], ['B', 'up'], ['A', 'exact']],
      [['B', 'exact'], ['A', 'exact'], ['B', 'down'], ['A', 'exact']],
      [['A', 'exact'], ['A', 'down'], ['B', 'invert'], ['A', 'exact']],
      [['B', 'exact'], ['B', 'orn'], ['A', 'exact'], ['A', 'exact']],
      [['A', 'down'], ['B', 'exact'], ['A', 'exact'], ['B', 'exact']],
      [['A', 'exact'], ['B', 'orn'], ['A', 'up'], ['A', 'exact']],
    ],
    leadBaseOctave: 4,        // tonic of the recorder's pentatonic pool (D4 / G4 / A4): a warm, low flute register
    counterBaseOctave: 4,
    leadRange: [57, 88],
  },

  // --- world / title arrangement ----------------------------------------------------
  // Each phrase gets a "character" so a long session breathes: rest phrases, harp-only
  // phrases, and phrases with the recorder. Weights are rest / sparse / gentle / full.
  world: {
    charWeights: { rest: 0.14, sparse: 0.22, gentle: 0.36, full: 0.28 },
    leadChanceGentle: 0.22,
    restBarChance: 0.16,      // a harp bar inside a phrase that is left empty
    pluckDensity: { sparse: 0.3, gentle: 0.52, full: 0.72 },
    bassNoteChance: 0.7,
    padVel: 0.7,
    droneVel: 0.7,
  },
  title: {
    charWeights: { rest: 0, sparse: 0.05, gentle: 0.35, full: 0.6 },
    leadChanceGentle: 0.6,
    restBarChance: 0.05,
    pluckDensity: { sparse: 0.5, gentle: 0.78, full: 0.95 },
    bassNoteChance: 0.9,
    firstPhraseLeadMask: [1, 0, 1, 1],
    padVel: 0.71,
    droneVel: 0.7,
  },
  leadMasks: [[1, 0, 1, 0], [0, 1, 0, 1], [1, 0, 0, 1], [1, 1, 0, 0]],
  pluck: {
    // Indexes into the ascending chord-tone ladder; null = rest. Eight eighth-notes per bar.
    patterns: [
      [0, 1, 2, 3, 2, 1, 2, 1],
      [0, 2, 1, 3, 2, 4, 3, 2],
      [0, null, 2, 1, 3, null, 2, 1],
      [0, null, 1, null, 2, null, 1, null],
      [3, 2, 1, 0, 1, 2, 1, 0],
      [0, 2, 4, 2, 1, 3, 2, 1],
    ],
    lo: 55, hi: 84,
    startLo: 55, startSpan: 4, // ladder start is the first chord tone at or above lo + (0..span)
    bassLo: 38, bassHi: 50,
    humanizeSec: 0.006,
    susBarChance: 0.25,       // pad plays sus2 instead of the third
  },
  entryAttackSec: { pad: 0.5, drone: 1.0 }, // pad / drone attacks on the first bar after a scene change
  padRange: [46, 58],
  droneRange: [38, 50],

  // --- battle arrangement -----------------------------------------------------------
  // intensity -> drum density; density d plays every step whose priority p <= d.
  battle: {
    drumDensityBase: 0.06,
    drumDensitySlope: 0.94,
    drumJitter: 0.1,          // per-bar seeded jitter on optional steps' priority
    // [step, drum, priority, velocity]
    drumTemplates: [
      [[0, 'don', 0.0, 1.0], [8, 'don', 0.1, 0.85], [4, 'ka', 0.3, 0.6], [12, 'ka', 0.34, 0.62],
       [10, 'don', 0.5, 0.55], [14, 'don', 0.55, 0.6], [6, 'ka', 0.64, 0.42], [2, 'ka', 0.72, 0.4],
       [3, 'ka', 0.84, 0.28], [7, 'ka', 0.88, 0.28], [11, 'ka', 0.9, 0.3], [15, 'tom', 0.82, 0.5]],
      [[0, 'don', 0.0, 1.0], [8, 'don', 0.08, 0.8], [6, 'don', 0.32, 0.6], [4, 'ka', 0.24, 0.55],
       [12, 'ka', 0.28, 0.58], [14, 'ka', 0.5, 0.45], [3, 'don', 0.62, 0.5], [11, 'don', 0.66, 0.52],
       [10, 'ka', 0.7, 0.4], [7, 'ka', 0.86, 0.28], [15, 'tom', 0.78, 0.55], [13, 'tom', 0.9, 0.42]],
    ],
    fillSteps: [[12, 'tom', 0.9], [13, 'tom', 0.8], [14, 'tom', 1.0], [15, 'tom', 1.0]],
    fillBar: 7,               // bar index in the phrase that may carry a tom fill
    fillMinDensity: 0.55,
    // Layer thresholds as [switch on, switch off] on smoothed intensity (hysteresis).
    ostinatoQuarter: [0.16, 0.10],
    ostinatoEighth: [0.42, 0.34],
    counter: [0.6, 0.5],
    // Ostinato pitch patterns over 8 eighth-notes: 0 root, 1 fifth, 2 octave.
    ostinatoPitch: [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 0, 1, 0],
      [0, 0, 0, 1, 0, 0, 2, 0],
      [0, 2, 0, 1, 0, 2, 0, 1],
    ],
    counterCells: [
      [[0, 1.5], [1.5, 0.5], [2, 1], [3, 1]],
      [[0, 2], [2, 1], [3, 1]],
      [[0, 1], [1, 1], [2, 2]],
      [[0, 3], [3, 1]],
    ],
    counterRestBar: 7,
    counterRange: [57, 76],
    stringRange: [38, 50],
    padVel: 0.7,
    droneVel: 0.55,
  },

  // --- intensity smoothing ------------------------------------------------------------
  intensity: {
    attackTauSec: 2.2,        // one-pole smoothing when the target rises
    releaseTauSec: 5.5,       // and when it falls (a battle should cool slowly)
  },

  // How battle state becomes the 0..1 intensity the score follows (game/audio/musicIntensity.js).
  // I = base + wField*field + wContact*contact + wBalance*balance*(gate + (1-gate)*max(contact, field))
  //   field   share of all troops that are out marching, saturating at fieldSaturation
  //   contact squads fighting or assaulting, saturating at contactSaturation squads
  //   balance 1 when both sides hold equal troops, 0 when one is wiped out (a close fight is tense)
  intensityModel: {
    base: 0.1, wField: 0.3, fieldSaturation: 0.25, wContact: 0.35, contactSaturation: 3,
    wBalance: 0.27, balanceGate: 0.35,
    assaultSiteTypes: ['keep', 'camp'], // a siege on one of these sites raises the assault swell
  },

  // --- assault swell ------------------------------------------------------------------
  assault: {
    onDebounceSec: 0.5,       // must hold this long before the swell starts
    offDebounceSec: 1.0,      // must stay off this long before it resolves
    riseSec: 7.5,
    releaseSec: 1.6,
    tremoloHz: [3.5, 9.5],
    cutoffHz: [420, 2600],
    peakGain: 0.85,
    intensityBoost: 0.15,     // added to drum/layer intensity while the swell is up
  },

  // --- stingers -----------------------------------------------------------------------
  stinger: {
    defaultResolveSec: { victory: 3.0, defeat: 0.05 },
    minApproachSec: 0.25,
    approachSec: 2.4,         // length of the bVII lead-in before the resolve (shorter if resolveIn is)
    rollHits: 14,
    tailSec: { victory: 5.5, defeat: 6.0 },
    returnOverlapSec: 2.3,    // the automatic return to the world bed starts this long before the tail ends
    returnFadeSec: 1.6,       // and fades in faster than a normal crossfade
    duck: { victory: { depth: 0.6, sec: 1.8 }, defeat: { depth: 0.65, sec: 1.4 } },
    battleFadeSec: 1.2,
    autoReturnScene: 'world', // after the tail; null to stay silent until setScene()
    victoryHarp: [0.05, 0.4, 0.75, 1.1], // seconds after the resolve
    padRange: [48, 60],
  },

  // --- mix ------------------------------------------------------------------------------
  // One entry per instrument group; each scene gets its own copy so a scene can fade as a unit.
  // lp: lowpass Hz, gain: group level, send: reverb send, pan: stereo position.
  groups: {
    padL:    { lp: 1500, q: 0.4, gain: 0.095, send: 0.35, pan: -0.55 },
    padR:    { lp: 1500, q: 0.4, gain: 0.095, send: 0.35, pan: 0.55 },
    pluckL:  { lp: 7200, q: 0.5, gain: 0.8,   send: 0.42, pan: -0.28 },
    pluckR:  { lp: 7200, q: 0.5, gain: 0.8,   send: 0.42, pan: 0.28 },
    lead:    { lp: 5200, q: 0.5, gain: 0.16,  send: 0.55, pan: 0.12 },
    drone:   { lp: 340,  q: 0.5, gain: 0.09,  send: 0.08, pan: 0 },
    drums:   { lp: 6000, q: 0.5, gain: 0.365, send: 0.2,  pan: 0 },
    strings: { lp: 900,  q: 0.6, gain: 0.16,  send: 0.16, pan: 0 },
    counter: { lp: 2400, q: 0.5, gain: 0.165, send: 0.42, pan: -0.15 },
    assault: { lp: 2600, q: 0.6, gain: 0.33,  send: 0.3,  pan: 0 },
  },
  // Intensity 0..1 sweeps these group parameters (set once per bar, ramped over the bar).
  stringsCutoffHz: [700, 1700],
  padCutoffHz: [1100, 2100],
  drumsGain: [0.55, 0.75],
  stringsGain: [0.55, 0.75],
  reverb: {
    enabled: true,
    seconds: 1.8,
    decay: 3.2,               // larger = faster decay of the generated impulse response
    wet: 0.5,
    noiseSeed: 90210,
  },
  bus: { outputScale: 1.0 },

  // --- voice timbres ---------------------------------------------------------------------
  voices: {
    pad: { detuneCents: 7, attackSec: 1.1, releaseSec: 1.5, level: 0.5, padLfoHz: 0.045, padLfoDepthHz: 260 },
    drone: { detuneCents: 5, attackSec: 2.6, releaseSec: 2.6, level: 0.5 },
    pluck: { seconds: 2.4, t60At110: 5.0, t60Slope: -0.3, damp: 0.12, bright: 0.5, level: 0.5, seed: 4242, cacheMax: 32 },
    lead: {
      attackSec: 0.07, releaseSec: 0.22, level: 0.4, vibratoHz: 5.1, vibratoCents: 7, vibratoDelaySec: 0.28,
      harmonics: [0, 1, 0.06, 0.22, 0.03, 0.09], breath: 0.05,
    },
    strings: { detuneCents: 6, attackSec: 0.014, releaseSec: 0.07, level: 0.5 },
    counter: { attackSec: 0.05, releaseSec: 0.16, level: 0.42, detuneCents: 9 },
    drum: {
      donBase: 1.9,           // pitch multiple at the top of the drop
      donDropSec: 0.09,
      donDecaySec: 0.5,
      donLevel: 0.9,
      kaLevel: 0.5,
      tomLevel: 0.62,
      boomDecaySec: 1.6,
      noiseSeed: 777,
      noiseSeconds: 3,
      tuneLo: 38,             // drums are tuned to the tonic at or above this midi note
    },
    assault: { detuneCents: 8, level: 0.5, noiseLevel: 0.18 },
  },
});

/** Tempo/scene lookup used by the pure conductor and tests. */
export const SCENE_NAMES = Object.freeze(Object.keys(MUSIC.scenes));
