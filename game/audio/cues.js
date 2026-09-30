// The cue table: one entry per sound `sfx.js` can play. This is deliberately
// the only file you should need to touch to retune or add a sound — every
// number that shapes a cue's tone lives here, and `build()` just composes the
// primitives in `synth.js`. Nothing here plays anything by itself; `sfx.js`
// calls `CUES[name].build(...)` inside its own gap/voice-cap/master-chain
// bookkeeping.
//
// Each `build(ctx, dest, noise, t, pitch, gain, rng)`:
//   ctx    the AudioContext
//   dest   where to connect (already the per-play pan node, upstream of the
//          master chain — a cue never touches master gain/mute/compressor)
//   noise  the shared 1-shot white noise buffer (see synth.js#createNoiseBuffer)
//   t      ctx.currentTime to start at
//   pitch  a frequency multiplier from `opts.pitch` (default 1)
//   gain   a loudness multiplier from `opts.volume` (default 1) — NOT master
//          volume, which is applied once downstream for the whole mix
//   rng    Math.random by default; only used for cue-internal variation
//          (coin pitch, clash wobble) so it stays swappable in a test
//
// `gap` (seconds) is a per-cue minimum retrigger interval: a busy battle tick
// can ask for a dozen `clash`es at once, and without a gap the mix turns to
// buzz rather than reading as "a battle". `cost` is the voice-cap weight
// (roughly the number of oscillator/noise nodes the cue schedules); `dur` is
// its audible length, used to release that cost back to the pool and to size
// fanfares in the gallery/report.
import * as S from './synth.js';

/** A sawtooth through a bandpass "formant" — reads as a small horn/brass call. */
function hornNote(ctx, dest, t, freq, dur, gain) {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(freq, t);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq * 2.1;
  bp.Q.value = 3.2;
  osc.connect(bp);
  const g = S.envNode(ctx, dest, t, gain, dur, 0.018);
  bp.connect(g);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

export const CUES = Object.freeze({
  send: {
    gap: 0.06, cost: 1, dur: 0.19,
    build(ctx, dest, noise, t, pitch, gain) {
      S.noiseSweep(ctx, dest, noise, t, { f0: 950 * pitch, f1: 340 * pitch, dur: 0.17, gain: 0.17 * gain, q: 1.1 });
    },
  },

  clash: {
    gap: 0.08, cost: 2, dur: 0.13,
    build(ctx, dest, noise, t, pitch, gain, rng) {
      const wob = S.jitter(0.05, rng);
      S.toneSweep(ctx, dest, t, { wave: 'sine', f0: 170 * pitch * wob, f1: 74 * pitch, dur: 0.11, gain: 0.55 * gain, attack: 0.002 });
      S.noiseSweep(ctx, dest, noise, t + 0.006, { f0: 3200 * pitch, f1: 2100 * pitch, dur: 0.05, gain: 0.20 * gain, q: 2.4, type: 'highpass' });
    },
  },

  capture: {
    gap: 0.15, cost: 2, dur: 0.23,
    build(ctx, dest, noise, t, pitch, gain) {
      const notes = [523.25 * pitch, 783.99 * pitch];
      S.arpeggio(ctx, dest, t, { wave: 'triangle', freqs: notes, noteDur: 0.14, overlap: 0.45, gain: 0.22 * gain });
      S.arpeggio(ctx, dest, t, { wave: 'triangle', freqs: notes.map((f) => f * 2), noteDur: 0.14, overlap: 0.45, gain: 0.06 * gain });
    },
  },

  lost: {
    gap: 0.15, cost: 1, dur: 0.40,
    build(ctx, dest, noise, t, pitch, gain) {
      S.toneSweep(ctx, dest, t, { wave: 'sawtooth', f0: 300 * pitch, f1: 110 * pitch, dur: 0.38, gain: 0.24 * gain, lp: 750 });
    },
  },

  arrow: {
    gap: 0.05, cost: 1, dur: 0.14,
    build(ctx, dest, noise, t, pitch, gain, rng) {
      const j = S.jitter(0.06, rng);
      S.toneSweep(ctx, dest, t, { wave: 'triangle', f0: 500 * pitch * j, f1: 1450 * pitch * j, dur: 0.07, gain: 0.16 * gain, attack: 0.003 });
      S.toneSweep(ctx, dest, t + 0.055, { wave: 'triangle', f0: 1450 * pitch * j, f1: 820 * pitch * j, dur: 0.08, gain: 0.11 * gain, attack: 0.002 });
      S.noiseSweep(ctx, dest, noise, t, { f0: 2200 * pitch, f1: 1200 * pitch, dur: 0.13, gain: 0.045 * gain, q: 1.5 });
    },
  },

  fireball: {
    gap: 0.30, cost: 3, dur: 1.06,
    build(ctx, dest, noise, t, pitch, gain) {
      S.noiseSweep(ctx, dest, noise, t, { f0: 760 * pitch, f1: 220 * pitch, dur: 0.28, gain: 0.15 * gain, q: 1 });
      const impact = t + 0.24;
      S.toneSweep(ctx, dest, impact, { wave: 'sine', f0: 100 * pitch, f1: 34 * pitch, dur: 0.5, gain: 0.65 * gain, attack: 0.003 });
      S.noiseSweep(ctx, dest, noise, impact, { f0: 240 * pitch, f1: 55 * pitch, dur: 0.8, gain: 0.20 * gain, q: 0.5, type: 'lowpass' });
    },
  },

  rally: {
    gap: 0.40, cost: 2, dur: 0.42,
    build(ctx, dest, noise, t, pitch, gain) {
      hornNote(ctx, dest, t, 392.0 * pitch, 0.22, 0.22 * gain);
      hornNote(ctx, dest, t + 0.18, 523.25 * pitch, 0.24, 0.24 * gain);
    },
  },

  bulwark: {
    gap: 0.40, cost: 4, dur: 0.67,
    build(ctx, dest, noise, t, pitch, gain) {
      S.chord(ctx, dest, t, {
        wave: 'triangle',
        freqs: [261.63, 329.63, 392.0, 523.25].map((f) => f * pitch),
        dur: 0.65, gain: 0.18 * gain, attack: 0.06, detune: 7,
      });
    },
  },

  march: {
    gap: 0.25, cost: 2, dur: 0.25,
    build(ctx, dest, noise, t, pitch, gain) {
      S.drumRoll(ctx, dest, noise, t, { hits: 8, hitDur: 0.035, gain: 0.30 * gain, spacing: 0.034, lp: 3200 * pitch, accel: 0.9 });
    },
  },

  levy: {
    gap: 0.40, cost: 3, dur: 0.87,
    build(ctx, dest, noise, t, pitch, gain) {
      S.bell(ctx, dest, t, { f0: 660 * pitch, partials: [1, 2.4, 3.8], partialGains: [1, 0.45, 0.22], dur: 0.85, gain: 0.22 * gain });
    },
  },

  coin: {
    gap: 0.03, cost: 1, dur: 0.10,
    build(ctx, dest, noise, t, pitch, gain, rng) {
      const j = S.jitter(0.16, rng);
      S.bell(ctx, dest, t, { f0: 2300 * pitch * j, partials: [1, 1.6], partialGains: [1, 0.35], dur: 0.09, gain: 0.18 * gain });
    },
  },

  upgrade: {
    gap: 0.20, cost: 2, dur: 0.28,
    build(ctx, dest, noise, t, pitch, gain) {
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5].map((f) => f * pitch);
      S.arpeggio(ctx, dest, t, { wave: 'triangle', freqs: notes, noteDur: 0.075, overlap: 0.4, gain: 0.17 * gain });
      S.noiseSweep(ctx, dest, noise, t + 0.19, { f0: 6200 * pitch, f1: 5200 * pitch, dur: 0.06, gain: 0.05 * gain, q: 2, type: 'highpass' });
    },
  },

  click: {
    gap: 0.04, cost: 1, dur: 0.03,
    build(ctx, dest, noise, t, pitch, gain) {
      S.blip(ctx, dest, t, { wave: 'sine', freq: 1000 * pitch, dur: 0.02, gain: 0.11 * gain, attack: 0.002 });
    },
  },

  hover: {
    gap: 0.08, cost: 1, dur: 0.03,
    build(ctx, dest, noise, t, pitch, gain) {
      S.blip(ctx, dest, t, { wave: 'sine', freq: 700 * pitch, dur: 0.018, gain: 0.035 * gain, attack: 0.002 });
    },
  },

  victory: {
    gap: 0.50, cost: 5, dur: 1.55,
    build(ctx, dest, noise, t, pitch, gain) {
      const run = [523.25, 659.25, 783.99, 1046.5].map((f) => f * pitch);
      S.arpeggio(ctx, dest, t, { wave: 'sawtooth', freqs: run, noteDur: 0.16, overlap: 0, gain: 0.22 * gain, attack: 0.006, lp: 2600 });
      S.chord(ctx, dest, t + 0.56, {
        wave: 'sawtooth', freqs: [1046.5, 1318.5, 1568.0].map((f) => f * pitch),
        dur: 0.92, gain: 0.24 * gain, attack: 0.02, detune: 5, lp: 3200,
      });
    },
  },

  defeat: {
    gap: 0.50, cost: 2, dur: 1.05,
    build(ctx, dest, noise, t, pitch, gain) {
      const notes = [440.0, 349.23, 293.66].map((f) => f * pitch);
      S.arpeggio(ctx, dest, t, { wave: 'triangle', freqs: notes, noteDur: 0.34, overlap: 0.12, gain: 0.20 * gain, attack: 0.01, lp: 1200 });
    },
  },

  reveal: {
    gap: 0.50, cost: 1, dur: 1.15,
    build(ctx, dest, noise, t, pitch, gain) {
      S.noiseSwell(ctx, dest, noise, t, { f0: 500 * pitch, f1: 1300 * pitch, dur: 1.1, gain: 0.15 * gain, attack: 0.4, q: 0.6 });
    },
  },

  error: {
    gap: 0.20, cost: 1, dur: 0.24,
    build(ctx, dest, noise, t, pitch, gain) {
      S.toneSweep(ctx, dest, t, { wave: 'square', f0: 190 * pitch, f1: 170 * pitch, dur: 0.09, gain: 0.14 * gain, attack: 0.003, lp: 1200 });
      S.toneSweep(ctx, dest, t + 0.11, { wave: 'square', f0: 160 * pitch, f1: 140 * pitch, dur: 0.11, gain: 0.14 * gain, attack: 0.003, lp: 1200 });
    },
  },
});

/** Cue names in the order they read best in a demo/gallery listing. */
export const CUE_NAMES = Object.freeze(Object.keys(CUES));
