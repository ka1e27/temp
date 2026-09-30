// Low-level WebAudio synthesis primitives shared by every cue in
// `game/audio/cues.js`. Nothing here is a "sound" by itself — these are the
// building blocks (noise, sweeps, chords, bells, drum hits) that the cue
// table composes out of. Kept separate from `sfx.js` so the voice-management
// engine (gaps, voice cap, master chain, unlock) never has to know how a
// chord or a bell is built, and so a new cue is usually just new numbers in
// `cues.js` rather than new code here.
//
// Browser-only (WebAudio node types). `game/audio` is NOT one of the pure
// directories in docs/ARCHITECTURE.md §1 (only core/world/battle/meta are),
// so Math.random and AudioContext are both fine here.

const MIN_GAIN = 0.0001; // exponentialRampToValueAtTime never accepts exactly 0

/** Clamp `v` into `[lo, hi]`. */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Clamp `v` into `[0, 1]`. */
export function clamp01(v) {
  return clamp(v, 0, 1);
}

/**
 * A multiplier in `[1 - range, 1 + range]` — "no two clinks sound quite
 * identical" without ever landing on an unmusical interval. `rng` is
 * injectable so this stays testable in Node; real cues call it with the
 * default `Math.random`.
 */
export function jitter(range, rng = Math.random) {
  return 1 + (rng() * 2 - 1) * range;
}

/** A frequency ratio `n` semitones from unison (may be negative/fractional). */
export function semitoneRatio(n) {
  return 2 ** (n / 12);
}

/** Decibels to a linear gain multiplier. */
export function dbToGain(db) {
  return 10 ** (db / 20);
}

/**
 * One buffer of white noise, generated once per `AudioContext` by `sfx.js`
 * and reused by every noise-based cue (whooshes, thuds, drum hits, swells).
 * A fresh buffer per play call is the single most common source of
 * audio-thread jank in a hand-rolled synth, so nothing here ever makes one.
 */
export function createNoiseBuffer(ctx, seconds = 1.5) {
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/**
 * A gain node shaped like a short envelope (fast exponential attack,
 * exponential decay to silence), already connected to `dest`. Everything
 * upstream of a cue's audible tail connects into the returned node.
 */
export function envNode(ctx, dest, t, peak, dur, attack = 0.006) {
  const g = ctx.createGain();
  const p = Math.max(MIN_GAIN, peak);
  g.gain.setValueAtTime(MIN_GAIN, t);
  g.gain.exponentialRampToValueAtTime(p, t + attack);
  g.gain.exponentialRampToValueAtTime(MIN_GAIN, t + Math.max(attack + 0.012, dur));
  g.connect(dest);
  return g;
}

/** Filtered noise sweeping from `f0` to `f1` Hz — whooshes, thuds, rumbles. */
export function noiseSweep(ctx, dest, noiseBuf, t, {
  f0, f1 = f0, dur, gain, q = 1, type = 'bandpass', attack = 0.006,
}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const filt = ctx.createBiquadFilter();
  filt.type = type;
  filt.Q.value = q;
  filt.frequency.setValueAtTime(Math.max(20, f0), t);
  filt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  src.connect(filt);
  const g = envNode(ctx, dest, t, gain, dur, attack);
  filt.connect(g);
  src.start(t);
  src.stop(t + dur + 0.03);
}

/** A single oscillator sweeping from `f0` to `f1` Hz, optionally low-passed. */
export function toneSweep(ctx, dest, t, {
  wave = 'sine', f0, f1 = f0, dur, gain, attack = 0.006, lp,
}) {
  const osc = ctx.createOscillator();
  osc.type = wave;
  osc.frequency.setValueAtTime(Math.max(1, f0), t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  let node = osc;
  if (lp) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lp;
    osc.connect(f);
    node = f;
  }
  const g = envNode(ctx, dest, t, gain, dur, attack);
  node.connect(g);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

/** Several oscillators at once (a chord); slight `detune` (cents) = shimmer. */
export function chord(ctx, dest, t, {
  wave = 'triangle', freqs, dur, gain, attack = 0.02, detune = 0, lp,
}) {
  const n = freqs.length;
  freqs.forEach((f, i) => {
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.value = f;
    if (detune) osc.detune.value = (i - (n - 1) / 2) * detune;
    let node = osc;
    if (lp) {
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = lp;
      osc.connect(filt);
      node = filt;
    }
    const g = envNode(ctx, dest, t, gain / Math.sqrt(n), dur, attack);
    node.connect(g);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  });
}

/** A run of notes, each starting `noteDur * (1 - overlap)` after the previous. */
export function arpeggio(ctx, dest, t, {
  wave = 'triangle', freqs, noteDur, gain, attack = 0.004, overlap = 0.35, lp,
}) {
  const step = noteDur * (1 - overlap);
  freqs.forEach((f, i) => {
    toneSweep(ctx, dest, t + i * step, { wave, f0: f, dur: noteDur, gain, attack, lp });
  });
  return (freqs.length - 1) * step + noteDur;
}

/** An inharmonic-partial bell/chime: a fundamental plus a few detuned overtones. */
export function bell(ctx, dest, t, {
  f0, partials = [1, 2.4, 3.8], partialGains = [1, 0.5, 0.22], dur, gain, attack = 0.004,
}) {
  partials.forEach((mul, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f0 * mul;
    const g = envNode(ctx, dest, t, gain * (partialGains[i] ?? 0.3), dur * (1 - i * 0.12), attack);
    osc.connect(g);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  });
}

/** `hits` short filtered-noise hits — the basic unit of a snare/drum roll. */
export function drumRoll(ctx, dest, noiseBuf, t, {
  hits, hitDur, gain, spacing, lp = 3200, accel = 1,
}) {
  let at = t;
  let gap = spacing;
  for (let i = 0; i < hits; i++) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = lp;
    src.connect(filt);
    const hitGain = gain * (0.65 + 0.35 * (i / Math.max(1, hits - 1)));
    const g = envNode(ctx, dest, at, hitGain, hitDur, 0.002);
    filt.connect(g);
    src.start(at);
    src.stop(at + hitDur + 0.02);
    at += gap;
    gap *= accel;
  }
  return at - t;
}

/** A slow filtered-noise swell: long attack up, long fade down. */
export function noiseSwell(ctx, dest, noiseBuf, t, { f0, f1 = f0, dur, gain, attack, q = 0.7 }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const filt = ctx.createBiquadFilter();
  filt.type = 'bandpass';
  filt.Q.value = q;
  filt.frequency.setValueAtTime(f0, t);
  filt.frequency.linearRampToValueAtTime(f1, t + dur);
  src.connect(filt);
  const g = ctx.createGain();
  g.gain.setValueAtTime(MIN_GAIN, t);
  g.gain.exponentialRampToValueAtTime(Math.max(MIN_GAIN, gain), t + attack);
  g.gain.exponentialRampToValueAtTime(MIN_GAIN, t + dur);
  filt.connect(g);
  g.connect(dest);
  src.start(t);
  src.stop(t + dur + 0.05);
}

/** A single very short percussive blip — UI ticks and the like. */
export function blip(ctx, dest, t, { wave = 'sine', freq, dur, gain, attack = 0.002 }) {
  const osc = ctx.createOscillator();
  osc.type = wave;
  osc.frequency.value = freq;
  const g = envNode(ctx, dest, t, gain, dur, attack);
  osc.connect(g);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}
