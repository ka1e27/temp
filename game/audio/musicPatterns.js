// Pure, seeded pattern generation: turns (song, scene, bar number, layer state) into note
// specs for one bar. Times are in beats inside the bar; the conductor converts to seconds.
// Every random draw comes from an rng keyed by (seed, purpose, phrase, bar), so a bar's notes
// depend only on its arguments, never on call history: replaying a phrase gives the same
// phrase, and the same seed gives the same music on any machine.
import { MUSIC } from '../config/music.js';
import { createRng, hash32 } from '../core/rng.js';
import {
  chordAt, chordDegreeAt, chordLadder, clamp, clamp01, dronePair, midiAtOrAbove, padVoicing,
  poolMidi, snapToChord,
} from './musicTheory.js';

const stepBeat = (s) => s / MUSIC.stepsPerBeat;

/** @typedef {{voice: string, beat: number, [k: string]: any}} NoteSpec */

// --- phrase character (world / title) -----------------------------------------------------

const charChains = new WeakMap(); // song -> Map(scene -> {cfg, list}): memoised, still a pure function of the song

function rawCharacter(song, scene, idx, cfg) {
  const sc = scene === 'title' ? cfg.title : cfg.world;
  const rng = createRng(hash32('char', song.seed, scene, idx));
  let r = rng.next();
  let mode = 'full';
  for (const m of ['rest', 'sparse', 'gentle', 'full']) {
    if (r < sc.charWeights[m]) { mode = m; break; }
    r -= sc.charWeights[m];
  }
  const lead = mode === 'full' || (mode === 'gentle' && rng.next() < sc.leadChanceGentle);
  const maskPool = mode === 'full' ? cfg.leadMasks.filter((m) => m.filter(Boolean).length >= 2) : cfg.leadMasks;
  const mask = rng.pick(maskPool);
  return { mode, lead, mask, pattern: rng.int(0, cfg.pluck.patterns.length - 1) };
}

function finalCharacter(song, scene, idx, prev, cfg) {
  const sc = scene === 'title' ? cfg.title : cfg.world;
  const c = rawCharacter(song, scene, idx, cfg);
  if (prev) {
    if (c.mode === 'rest' && prev.mode === 'rest') c.mode = 'sparse';
    if (c.lead && prev.lead) c.lead = false; // never two recorder phrases back to back
  }
  if (scene === 'title' && idx === 0) { c.mode = 'full'; c.lead = true; c.mask = sc.firstPhraseLeadMask; }
  const lead = c.lead && c.mode !== 'rest';
  return {
    mode: c.mode,
    lead,
    leadMask: lead ? c.mask : [0, 0, 0, 0],
    pluck: sc.pluckDensity[c.mode] ?? 0,
    pattern: song.patternOrder[(c.pattern + idx) % song.patternOrder.length],
    pad: true, // a rest phrase drops the harp and recorder, never the bed underneath
    restBarChance: sc.restBarChance,
    bassChance: c.mode === 'sparse' || c.mode === 'rest' ? 0 : sc.bassNoteChance,
  };
}

/**
 * What a phrase is: a rest (pad and drone only), sparse, gentle or full; whether the recorder plays
 * and in which of its four statements. Deterministic per (seed, scene, phrase): each phrase's
 * rules look at the phrase before it, so the chain is built from phrase 0 and memoised.
 */
export function phraseCharacter(song, scene, phraseIdx, cfg = MUSIC) {
  let byScene = charChains.get(song);
  if (!byScene) { byScene = new Map(); charChains.set(song, byScene); }
  let entry = byScene.get(scene);
  if (!entry || entry.cfg !== cfg) { entry = { cfg, list: [] }; byScene.set(scene, entry); }
  while (entry.list.length <= phraseIdx) {
    const k = entry.list.length;
    entry.list.push(finalCharacter(song, scene, k, k > 0 ? entry.list[k - 1] : null, cfg));
  }
  return entry.list[phraseIdx];
}

// --- melody -----------------------------------------------------------------------------------

function transformMotif(notes, kind, cfg) {
  const { poolLo, poolHi } = cfg.motif;
  const c = (i) => clamp(i, poolLo, poolHi);
  const copy = notes.map((n) => ({ ...n }));
  if (kind === 'up') return copy.map((n) => ({ ...n, i: c(n.i + 2) }));
  if (kind === 'down') return copy.map((n) => ({ ...n, i: c(n.i - 2) }));
  if (kind === 'invert') {
    const pivot = notes[0].i;
    return copy.map((n) => ({ ...n, i: c(2 * pivot - n.i) }));
  }
  if (kind === 'orn') {
    const out = [];
    for (const n of copy) {
      if (n.len >= 2) {
        out.push({ b: n.b, len: 0.5, i: c(n.i + 1) });
        out.push({ b: n.b + 0.5, len: n.len - 0.5, i: n.i });
      } else out.push(n);
    }
    return out;
  }
  return copy;
}

/**
 * The recorder's whole eight-bar phrase: four two-bar statements of motif A/B with seeded
 * variation, the last one closing on the tonic. Notes are {beat 0..32, len, idx, stmt}.
 */
export function phraseMelody(song, phraseIdx, cfg = MUSIC) {
  const rng = createRng(hash32('mel', song.seed, phraseIdx));
  const form = rng.pick(cfg.motif.forms);
  const notes = [];
  form.forEach(([which, kind], k) => {
    const stmt = transformMotif(song.motifs[which], kind, cfg);
    if (k === form.length - 1) {
      const last = stmt[stmt.length - 1];
      last.i = Math.abs(last.i) <= Math.abs(last.i - 5) ? 0 : 5;
    }
    for (const n of stmt) notes.push({ beat: k * 8 + n.b, len: n.len, idx: n.i, stmt: k });
  });
  for (const n of notes) {
    const bar = Math.floor(n.beat / MUSIC.beatsPerBar);
    const strong = n.beat % 4 === 0 || n.beat % 4 === 2 || n.len >= 2;
    if (strong) n.idx = snapToChord(song, n.idx, chordAt(song, chordDegreeAt(song, phraseIdx * MUSIC.phraseBars + bar, cfg)));
  }
  return notes.sort((a, b) => a.beat - b.beat);
}

/** Fits a midi note into [lo, hi] by octaves. */
function foldInto(midi, [lo, hi]) {
  let m = midi;
  while (m > hi) m -= 12;
  while (m < lo) m += 12;
  return m;
}

// --- shared voices ------------------------------------------------------------------------------

function runLength(song, gb, maxBars, cfg) {
  const deg = chordDegreeAt(song, gb, cfg);
  let n = 1;
  while (n < maxBars && chordDegreeAt(song, gb + n, cfg) === deg) n++;
  return n;
}

function padAndDrone(out, song, gb, bip, segmentStart, opts, cfg) {
  const chord = chordAt(song, chordDegreeAt(song, gb, cfg));
  const barsLeft = cfg.phraseBars - bip;
  const change = chordDegreeAt(song, gb - 1, cfg) !== chord.degree;
  if (opts.pad && (bip === 0 || change || segmentStart)) {
    const rng = createRng(hash32('pad', song.seed, gb));
    // sus2 only where the 2nd is a whole tone above the root (Em with a natural F would grind E against F).
    const wholeTone = (chord.ninthPc - chord.rootPc + 12) % 12 === 2;
    const variant = rng.chance(cfg.pluck.susBarChance) && wholeTone ? 'sus2' : 'triad';
    const midis = padVoicing(song, chord, opts.padRange ?? cfg.padRange, variant);
    if (opts.padOctave) midis.push(midis[0] + 12);
    const pad = { voice: 'pad', beat: 0, durBeats: runLength(song, gb, barsLeft, cfg) * cfg.beatsPerBar, midis, vel: opts.padVel };
    if (segmentStart) pad.attack = cfg.entryAttackSec.pad; // a scene entry is already faded in by its bus
    out.push(pad);
  }
  if (opts.drone && (bip === 0 || segmentStart)) {
    const drone = { voice: 'drone', beat: 0, durBeats: barsLeft * cfg.beatsPerBar, midis: dronePair(song, chordAt(song, 0), cfg.droneRange), vel: opts.droneVel ?? 0.7 };
    if (segmentStart) drone.attack = cfg.entryAttackSec.drone;
    out.push(drone);
  }
}

// --- world / title bar ---------------------------------------------------------------------------

function pluckBar(out, song, gb, bip, ch, cfg) {
  const rng = createRng(hash32('pluck', song.seed, gb));
  const chord = chordAt(song, chordDegreeAt(song, gb, cfg));
  const restBar = rng.chance(ch.restBarChance * (bip === 3 || bip === 7 ? 2 : 1));
  const startOff = rng.int(0, cfg.pluck.startSpan);
  const bassRoll = rng.next();
  const humRolls = [];
  for (let s = 0; s < 8; s++) humRolls.push([rng.next(), rng.next(), rng.next()]);
  if (restBar || ch.pluck <= 0) return;
  const ladder = chordLadder(chord, cfg.pluck.lo, cfg.pluck.hi);
  const start = Math.max(0, ladder.findIndex((m) => m >= cfg.pluck.startLo + startOff));
  const pat = cfg.pluck.patterns[ch.pattern];
  pat.forEach((v, s) => {
    if (v === null) return;
    const [keep, velRoll, humRoll] = humRolls[s];
    if (s !== 0 && keep >= ch.pluck) return;
    let idx = start + v;
    while (idx > ladder.length - 1) idx -= 3;
    const accent = s === 0 ? 0.22 : s === 4 ? 0.1 : 0;
    out.push({
      voice: 'pluck', beat: s * 0.5, midi: ladder[Math.max(0, idx)],
      vel: clamp01(0.5 + accent + (velRoll - 0.5) * 0.16),
      jit: (humRoll - 0.5) * 2 * cfg.pluck.humanizeSec,
    });
  });
  if (bassRoll < ch.bassChance) {
    out.push({ voice: 'pluck', beat: 0, midi: midiAtOrAbove(chord.rootPc, cfg.pluck.bassLo), vel: 0.62, jit: 0, bass: true });
  }
}

function leadBar(out, song, phraseIdx, bip, ch, cfg) {
  if (!ch.lead) return;
  const lo = bip * cfg.beatsPerBar;
  for (const n of phraseMelody(song, phraseIdx, cfg)) {
    if (!ch.leadMask[n.stmt] || n.beat < lo || n.beat >= lo + cfg.beatsPerBar) continue;
    out.push({
      voice: 'lead', beat: n.beat - lo, durBeats: n.len * 0.92,
      midi: foldInto(poolMidi(song, n.idx, cfg.motif.leadBaseOctave), cfg.motif.leadRange),
      vel: clamp01(0.52 + (n.len >= 2 ? 0.1 : 0)),
    });
  }
}

/**
 * Notes for one bar of `title` or `world`.
 * @param {number} gb global bar number (drives chords and phrase position)
 * @param {{segmentStart?: boolean}} [state]
 * @returns {NoteSpec[]}
 */
export function planWorldBar(song, scene, gb, state = {}, cfg = MUSIC) {
  const out = [];
  const phraseIdx = Math.floor(gb / cfg.phraseBars);
  const bip = gb - phraseIdx * cfg.phraseBars;
  const ch = phraseCharacter(song, scene, phraseIdx, cfg);
  const sc = scene === 'title' ? cfg.title : cfg.world;
  padAndDrone(out, song, gb, bip, !!state.segmentStart, {
    pad: ch.pad, padVel: sc.padVel, padOctave: scene === 'title', drone: true, droneVel: sc.droneVel,
  }, cfg);
  pluckBar(out, song, gb, bip, ch, cfg);
  leadBar(out, song, phraseIdx, bip, ch, cfg);
  return out;
}

// --- battle bar ------------------------------------------------------------------------------------

/** Layer state for the next bar from smoothed intensity `x`, with hysteresis (see hysteresis()). */
export function nextBattleLayers(prev, x, hyst, cfg = MUSIC) {
  const b = cfg.battle;
  const quarter = hyst(prev.quarter, x, b.ostinatoQuarter);
  const eighth = hyst(prev.eighth, x, b.ostinatoEighth);
  return { quarter: quarter || eighth, eighth, counter: hyst(prev.counter, x, b.counter) };
}

export const ostinatoMode = (layers) => (layers.eighth ? 'eighth' : layers.quarter ? 'quarter' : 'half');

function drumBar(out, song, phraseIdx, bip, x, cfg) {
  const b = cfg.battle;
  const density = clamp01(b.drumDensityBase + b.drumDensitySlope * x);
  const tmpl = b.drumTemplates[createRng(hash32('tmpl', song.seed, phraseIdx)).int(0, b.drumTemplates.length - 1)];
  const rng = createRng(hash32('drum', song.seed, phraseIdx, bip));
  const gain = 0.55 + 0.45 * density;
  const hits = new Map();
  for (const [s, drum, p, v] of tmpl) {
    const jit = (rng.next() * 2 - 1) * b.drumJitter; // drawn for every step: stable as density moves
    if (p + (p > 0.2 ? jit : 0) <= density) hits.set(s, { drum, vel: clamp01(v * gain) });
  }
  if (bip === b.fillBar && density >= b.fillMinDensity) {
    for (const [s, drum, v] of b.fillSteps) hits.set(s, { drum, vel: clamp01(v * gain) });
  }
  for (const [s, h] of hits) out.push({ voice: 'drum', beat: stepBeat(s), drum: h.drum, vel: h.vel });
}

function ostinatoBar(out, song, gb, phraseIdx, mode, cfg) {
  const b = cfg.battle;
  const chord = chordAt(song, chordDegreeAt(song, gb, cfg));
  const root = midiAtOrAbove(chord.rootPc, b.stringRange[0]);
  const fifth = root + ((chord.fifthPc - chord.rootPc + 12) % 12 || 7);
  const pitchPat = b.ostinatoPitch[createRng(hash32('ost', song.seed, phraseIdx)).int(0, b.ostinatoPitch.length - 1)];
  const pitch = (k) => [root, fifth, root + 12][pitchPat[k]];
  if (mode === 'half') {
    out.push({ voice: 'string', beat: 0, durBeats: 1.9, midi: root, vel: 0.7 });
    out.push({ voice: 'string', beat: 2, durBeats: 1.9, midi: root, vel: 0.55 });
  } else if (mode === 'quarter') {
    for (let j = 0; j < 4; j++) out.push({ voice: 'string', beat: j, durBeats: 0.85, midi: pitch(j * 2), vel: j === 0 ? 0.9 : j === 2 ? 0.72 : 0.58 });
  } else {
    for (let k = 0; k < 8; k++) out.push({ voice: 'string', beat: k * 0.5, durBeats: 0.42, midi: pitch(k), vel: k === 0 ? 1 : k === 4 ? 0.8 : k % 2 === 0 ? 0.66 : 0.5 });
  }
}

function counterBar(out, song, gb, phraseIdx, bip, cfg) {
  const b = cfg.battle;
  if (bip === b.counterRestBar) return;
  const rng = createRng(hash32('ctr', song.seed, gb));
  const chord = chordAt(song, chordDegreeAt(song, gb, cfg));
  const cell = rng.pick(b.counterCells);
  let idx = 2 + rng.int(-1, 2);
  for (const [beat, len] of cell) {
    idx = clamp(idx + rng.pick([-1, 0, 1, 1, -1, 2, -2]), -1, 5);
    const strong = beat === 0 || beat === 2 || len >= 2;
    const use = strong ? snapToChord(song, idx, chord) : idx;
    out.push({
      voice: 'counter', beat, durBeats: len * 0.95,
      midi: foldInto(poolMidi(song, use, cfg.motif.counterBaseOctave), b.counterRange),
      vel: clamp01(0.55 + (len >= 2 ? 0.12 : 0)),
    });
  }
}

/** Root / fifth / octave the assault swell sustains, following the bar's chord. */
export function assaultChord(song, gb, cfg = MUSIC) {
  const chord = chordAt(song, chordDegreeAt(song, gb, cfg));
  const root = midiAtOrAbove(chord.rootPc, cfg.battle.stringRange[0]) + 12;
  const fifth = root + ((chord.fifthPc - chord.rootPc + 12) % 12 || 7);
  return [root, fifth, root + 12];
}

/**
 * Notes for one bar of `battle`.
 * @param {number} x effective intensity 0..1 (smoothed, plus the assault boost)
 * @param {{quarter: boolean, eighth: boolean, counter: boolean}} layers from nextBattleLayers()
 * @returns {NoteSpec[]}
 */
export function planBattleBar(song, gb, x, layers, state = {}, cfg = MUSIC) {
  const out = [];
  const phraseIdx = Math.floor(gb / cfg.phraseBars);
  const bip = gb - phraseIdx * cfg.phraseBars;
  padAndDrone(out, song, gb, bip, !!state.segmentStart, {
    pad: true, padVel: cfg.battle.padVel, drone: true, droneVel: cfg.battle.droneVel,
  }, cfg);
  ostinatoBar(out, song, gb, phraseIdx, ostinatoMode(layers), cfg);
  drumBar(out, song, phraseIdx, bip, x, cfg);
  if (layers.counter) counterBar(out, song, gb, phraseIdx, bip, cfg);
  return out;
}

