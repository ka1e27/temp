// Pure music theory for the generative score: scales, chords, the seeded "song" (key, mode,
// progression order, motifs) and the timing maths the scheduler uses. No WebAudio, no
// Math.random, no clock: everything is a function of its arguments, so it is unit-testable
// in Node (game/tests/audio.music.test.js). Tuning tables live in game/config/music.js.
import { MUSIC } from '../config/music.js';
import { createRng, hash32 } from '../core/rng.js';

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => clamp(v, 0, 1);
export const midiToFreq = (m) => 440 * 2 ** ((m - 69) / 12);
export const pcOf = (midi) => ((Math.round(midi) % 12) + 12) % 12;

/** Smallest midi note >= `lo` with pitch class `pc`. */
export function midiAtOrAbove(pc, lo) {
  return lo + ((pc - lo) % 12 + 12) % 12;
}

/** Semitones above the tonic of modal degree index `n` (any integer; wraps by octaves). */
export function degreeSemis(steps, n) {
  const len = steps.length;
  const oct = Math.floor(n / len);
  return steps[n - oct * len] + 12 * oct;
}

// --- the seeded song --------------------------------------------------------------------

/**
 * @typedef {Object} Song
 * @property {number} seed
 * @property {{id: string, tonicPc: number, mode: string}} key
 * @property {number[]} steps      semitones of the seven modal degrees
 * @property {number[]} penta      degree indexes the melody may use
 * @property {number} tempoScale
 * @property {number[]} progOrder  seeded order the mode's progressions are used in, section by section
 * @property {{A: object[], B: object[]}} motifs   two-bar figures: {b, len, i} (pool index i)
 * @property {number[]} patternOrder
 */

/** Builds one two-bar (8 beat) figure from a seeded stream. Rests are the gaps in the rhythm. */
function makeMotif(rng, cfg) {
  const m = cfg.motif;
  const rhythm = rng.pick(m.rhythms);
  let i = rng.pick(m.startPool);
  const notes = rhythm.map(([b, len], k) => {
    if (k > 0) i = clamp(i + rng.pick(m.stepChoices), m.poolLo, m.poolHi);
    return { b, len, i };
  });
  // End on a resting tone so every statement sounds finished.
  const last = notes[notes.length - 1];
  for (let d = 0; d < 4; d++) {
    const cand = [last.i - d, last.i + d].find((v) => v >= m.poolLo && v <= m.poolHi
      && m.stableMod.includes(((v % 5) + 5) % 5));
    if (cand !== undefined) { last.i = cand; break; }
  }
  return notes;
}

/**
 * The key, mode, tempo offset, progression order and motif set for one dynasty seed.
 * Deterministic: the same seed always returns a deeply equal song.
 * @returns {Song}
 */
export function createSong(seed, cfg = MUSIC) {
  const rng = createRng(hash32('hd-music', seed));
  const key = rng.pick(cfg.keys);
  const mode = cfg.modes[key.mode];
  const progCount = cfg.progressions[key.mode].length;
  const [tLo, tHi] = cfg.tempoScaleRange;
  return {
    seed,
    key: { id: key.id, tonicPc: key.tonicPc, mode: key.mode },
    steps: mode.steps.slice(),
    penta: mode.penta.slice(),
    tempoScale: tLo + rng.fork('tempo').next() * (tHi - tLo),
    progOrder: rng.fork('prog').shuffle([...Array(progCount).keys()]),
    motifs: { A: makeMotif(rng.fork('motifA'), cfg), B: makeMotif(rng.fork('motifB'), cfg) },
    patternOrder: rng.fork('arp').shuffle([...Array(cfg.pluck.patterns.length).keys()]),
  };
}

export const tonicMidi = (song, octave) => 12 * (octave + 1) + song.key.tonicPc;

/** Midi of pentatonic pool index `idx` (0 = tonic in `baseOctave`; negatives go below). */
export function poolMidi(song, idx, baseOctave) {
  const n = song.penta.length;
  const oct = Math.floor(idx / n);
  return tonicMidi(song, baseOctave) + song.steps[song.penta[idx - oct * n]] + 12 * oct;
}

export function scalePcs(song) {
  return song.steps.map((s) => (song.key.tonicPc + s) % 12);
}

export const isInScale = (song, midi) => scalePcs(song).includes(pcOf(midi));

// --- harmony ------------------------------------------------------------------------------

/** The eight-bar progression (degree indexes) in force during a given global bar. */
export function progressionFor(song, globalBar, cfg = MUSIC) {
  const section = Math.max(0, Math.floor(globalBar / (cfg.phraseBars * cfg.sectionPhrases)));
  const list = cfg.progressions[song.key.mode];
  return list[song.progOrder[section % song.progOrder.length]];
}

export function chordDegreeAt(song, globalBar, cfg = MUSIC) {
  const prog = progressionFor(song, globalBar, cfg);
  return prog[((globalBar % prog.length) + prog.length) % prog.length];
}

/**
 * A diatonic triad on modal degree `degree`.
 * @returns {{degree: number, rootPc: number, thirdPc: number, fifthPc: number, ninthPc: number, pcs: number[]}}
 */
export function chordAt(song, degree) {
  const pc = (n) => (song.key.tonicPc + degreeSemis(song.steps, n)) % 12;
  const rootPc = pc(degree);
  const thirdPc = pc(degree + 2);
  const fifthPc = pc(degree + 4);
  return { degree, rootPc, thirdPc, fifthPc, ninthPc: pc(degree + 1), pcs: [rootPc, thirdPc, fifthPc] };
}

/** Close-position pad voicing: root in [lo, lo+12), the rest stacked above it. */
export function padVoicing(song, chord, [lo], variant = 'triad') {
  const root = midiAtOrAbove(chord.rootPc, lo);
  const mid = variant === 'sus2' ? chord.ninthPc : chord.thirdPc;
  const second = root + ((mid - chord.rootPc + 12) % 12 || 12);
  const third = second + ((chord.fifthPc - mid + 12) % 12 || 12);
  return [root, second, third];
}

/** Root and fifth as a drone pair, root in [lo, lo+12). */
export function dronePair(song, chord, [lo]) {
  const root = midiAtOrAbove(chord.rootPc, lo);
  return [root, root + ((chord.fifthPc - chord.rootPc + 12) % 12 || 7)];
}

/** Ascending ladder of chord tones inside [lo, hi] (what a harp arpeggio walks up). */
export function chordLadder(chord, lo, hi) {
  const out = [];
  for (let m = lo; m <= hi; m++) if (chord.pcs.includes(pcOf(m))) out.push(m);
  return out;
}

/** Moves a pentatonic pool index (up to +-2) onto the nearest chord tone, if one is that close. */
export function snapToChord(song, idx, chord) {
  for (const off of [0, -1, 1, -2, 2]) {
    if (chord.pcs.includes(pcOf(poolMidi(song, idx + off, 4)))) return idx + off;
  }
  return idx;
}

// --- timing maths ---------------------------------------------------------------------------

export const secondsPerBeat = (bpm) => 60 / bpm;
export const barSeconds = (bpm, beatsPerBar = MUSIC.beatsPerBar) => (60 / bpm) * beatsPerBar;

/**
 * First bar line of a grid (`t0 + k * barDur`, integer k >= 0) at or after `time`.
 * Returned as the same expression the scheduler uses for bar starts, so equality is exact.
 */
export function firstBarLineAtOrAfter(t0, barDur, time) {
  const k = Math.max(0, Math.ceil((time - t0) / barDur - 1e-9));
  return t0 + k * barDur;
}

/** Same as above for beats (the assault resolve and the stinger cut land on beats). */
export function firstBeatAtOrAfter(t0, spb, time) {
  const k = Math.max(0, Math.ceil((time - t0) / spb - 1e-9));
  return t0 + k * spb;
}

/** One-pole smoothing with separate rise/fall time constants; exact for any dt. */
export function smoothToward(current, target, dt, tauUp, tauDown) {
  if (dt <= 0) return current;
  const tau = target > current ? tauUp : tauDown;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

/** Schmitt trigger: turns on above `on`, off below `off`, otherwise keeps `prev`. */
export function hysteresis(prev, x, [on, off]) {
  if (prev) return x > off;
  return x >= on;
}
