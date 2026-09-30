// Pure sample renderers for the score: a Karplus-Strong plucked string, a seeded noise
// buffer and a generated reverb impulse response. Plain Float32Array maths, no WebAudio and
// no Math.random, so every render is reproducible (same seed = same samples) and testable in
// Node. music.js wraps the results in AudioBuffers once per pitch and reuses them.
import { createRng, hash32 } from '../core/rng.js';

/**
 * A plucked-string tone. Karplus-Strong with a weighted two-point loop filter (the string's
 * damping) and a first-order all-pass for fractional tuning, so the pitch is right to a few
 * cents at any note. Loop gain is set from a target T60 so low notes ring longer than high ones.
 * @param {number} freq Hz
 * @param {number} sampleRate
 * @param {{seconds?: number, t60At110?: number, t60Slope?: number, damp?: number, bright?: number, position?: number, seed?: number}} [o]
 * @returns {Float32Array} peak-normalised to 1
 */
export function renderPluck(freq, sampleRate, o = {}) {
  const seconds = o.seconds ?? 2.6;
  const damp = o.damp ?? 0.16; // loop-filter weight of the previous sample: more = darker, faster
  const bright = o.bright ?? 0.5; // excitation smoothing: 1 = raw noise, lower = softer attack
  const position = o.position ?? 0.18; // pluck position along the string (comb notch)
  const t60 = (o.t60At110 ?? 3.0) * (freq / 110) ** (o.t60Slope ?? -0.32);
  const total = Math.floor(seconds * sampleRate);
  const P = sampleRate / freq;
  const N = Math.max(2, Math.floor(P - damp - 0.5));
  const frac = P - damp - N; // in [0.5, 1.5): all-pass delay
  const ap = (1 - frac) / (1 + frac);

  // Loop-filter magnitude at the fundamental, so the gain below hits the requested T60.
  const w = (2 * Math.PI * freq) / sampleRate;
  const hRe = 1 - damp + damp * Math.cos(w);
  const hIm = damp * Math.sin(w);
  const hMag = Math.hypot(hRe, hIm);
  const g = Math.min(0.99995, 10 ** (-3 / (t60 * freq)) / hMag);

  const rng = createRng(hash32('pluck', o.seed ?? 1, Math.round(freq * 100)));
  const line = new Float32Array(N);
  let prev = 0;
  for (let i = 0; i < N; i++) {
    prev += (rng.next() * 2 - 1 - prev) * bright;
    line[i] = prev;
  }
  const k = Math.max(1, Math.round(N * position));
  const shaped = new Float32Array(N);
  for (let i = 0; i < N; i++) shaped[i] = line[i] - line[(i - k + N) % N];
  let mean = 0;
  for (let i = 0; i < N; i++) mean += shaped[i];
  mean /= N;
  for (let i = 0; i < N; i++) line[i] = shaped[i] - mean;

  const out = new Float32Array(total);
  let idx = 0;
  let lpPrev = 0;
  let apX = 0;
  let apY = 0;
  for (let n = 0; n < total; n++) {
    const d = line[idx];
    out[n] = d;
    const lp = (1 - damp) * d + damp * lpPrev;
    lpPrev = d;
    const y = ap * lp + apX - ap * apY;
    apX = lp;
    apY = y;
    line[idx] = y * g;
    if (++idx === N) idx = 0;
  }
  let peak = 0;
  for (let n = 0; n < total; n++) peak = Math.max(peak, Math.abs(out[n]));
  const norm = peak > 0 ? 1 / peak : 1;
  const fade = Math.min(total, Math.floor(0.35 * sampleRate));
  for (let n = 0; n < total; n++) {
    let s = out[n] * norm;
    const left = total - n;
    if (left < fade) s *= Math.cos((1 - left / fade) * Math.PI * 0.5) ** 2;
    out[n] = s;
  }
  return out;
}

/** Seeded white noise in [-1, 1]. */
export function renderNoise(sampleRate, seconds, seed) {
  const rng = createRng(hash32('noise', seed));
  const out = new Float32Array(Math.ceil(sampleRate * seconds));
  for (let i = 0; i < out.length; i++) out[i] = rng.next() * 2 - 1;
  return out;
}

/**
 * A stereo reverb impulse response: decorrelated noise with an exponential decay and a
 * lowpass that darkens as the tail ages, plus a short pre-delay.
 * @returns {[Float32Array, Float32Array]}
 */
export function renderImpulseResponse(sampleRate, seconds, decay, seed) {
  const len = Math.ceil(sampleRate * seconds);
  const pre = Math.floor(0.008 * sampleRate);
  return [0, 1].map((ch) => {
    const rng = createRng(hash32('ir', seed, ch));
    const out = new Float32Array(len);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sampleRate;
      const k = 0.85 - 0.72 * Math.min(1, t / seconds); // bright early, dark late
      lp += (rng.next() * 2 - 1 - lp) * k;
      out[i] = lp * Math.exp(-decay * t);
    }
    return out;
  });
}

/** Estimated fundamental (Hz) by autocorrelation; used by tests to check the tuning. */
export function estimatePitch(samples, sampleRate, fMin, fMax, start = 0, length = 8192) {
  const lagMin = Math.floor(sampleRate / fMax);
  const lagMax = Math.ceil(sampleRate / fMin);
  let best = -Infinity;
  let bestLag = lagMin;
  const corr = new Float64Array(lagMax + 2);
  for (let lag = lagMin - 1; lag <= lagMax + 1; lag++) {
    let s = 0;
    for (let i = 0; i < length; i++) s += samples[start + i] * samples[start + i + lag];
    corr[lag] = s;
  }
  for (let lag = lagMin; lag <= lagMax; lag++) {
    if (corr[lag] > best && corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1]) { best = corr[lag]; bestLag = lag; }
  }
  // Parabolic interpolation around the peak for sub-sample resolution.
  const a = corr[bestLag - 1];
  const b = corr[bestLag];
  const c = corr[bestLag + 1];
  const denom = a - 2 * b + c;
  const shift = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
  return sampleRate / (bestLag + shift);
}
