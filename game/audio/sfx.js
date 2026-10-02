// The game's entire sound design: synthesised with WebAudio, no asset files
// (DESIGN.md §7.6). `createSfx()` owns the AudioContext, the master chain,
// per-cue rate limiting and a voice cap; `cues.js` owns what each named sound
// actually is; `synth.js` owns the oscillator/noise plumbing underneath that.
// See docs/DESIGN.md §7.4-7.6 and docs/ARCHITECTURE.md §6 (battle events) for
// which cue maps to which moment.
import { CUES } from './cues.js';
import { clamp01, createNoiseBuffer } from './synth.js';

const MAX_VOICE_COST = 28; // total in-flight cue "weight"; see cues.js `cost`
const VOICE_RELEASE_PAD = 0.12; // seconds of slack added to a cue's `dur`

function getAudioContextCtor() {
  if (typeof AudioContext !== 'undefined') return AudioContext;
  if (typeof globalThis !== 'undefined' && typeof globalThis.webkitAudioContext !== 'undefined') {
    return globalThis.webkitAudioContext;
  }
  return null;
}

/**
 * @returns {{
 *   unlock(): void,
 *   play(name: string, opts?: { volume?: number, pitch?: number, pan?: number }): void,
 *   setMuted(muted: boolean): void,
 *   isMuted(): boolean,
 *   setVolume(v: number): void,
 *   setEffectsLevel(v: number): void,
 *   getContext(): AudioContext|null,
 *   getBus(): GainNode|null,
 *   onUnlock(fn: (ctx: AudioContext) => void): () => void,
 * }}
 */
export function createSfx() {
  /** @type {AudioContext|null} */
  let ctx = null;
  let master = null; // master gain: overall volume + mute
  let compressor = null;
  let noiseBuf = null;
  let muted = false;
  let volume = 0.8;
  let effectsLevel = 1; // Settings > Effects volume: the sound effects only (the master volume also carries the score)
  let voiceCost = 0;
  const lastPlayedAt = Object.create(null); // cue name -> ctx.currentTime
  const unlockListeners = []; // music.js waits here for the context to exist

  function applyMasterGain() {
    if (!master) return;
    const target = muted ? 0 : volume;
    // A tiny ramp rather than a hard set avoids an audible click when the
    // player mutes mid-cue.
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setTargetAtTime(target, now, 0.01);
  }

  /** Call on the first user gesture (a click, tap or key press). Idempotent. */
  function unlock() {
    if (!ctx) {
      const AC = getAudioContextCtor();
      if (!AC) return; // WebAudio unavailable: every call below stays a no-op
      try {
        ctx = new AC();
      } catch {
        ctx = null;
        return;
      }
      master = ctx.createGain();
      master.gain.value = muted ? 0 : volume;
      compressor = ctx.createDynamicsCompressor();
      // Gentle bus-glue settings: only leans on the mix once several cues
      // stack in the same frame (a five-front battle), never on a lone cue.
      compressor.threshold.value = -18;
      compressor.knee.value = 12;
      compressor.ratio.value = 3;
      compressor.attack.value = 0.006;
      compressor.release.value = 0.25;
      master.connect(compressor);
      compressor.connect(ctx.destination);
      noiseBuf = createNoiseBuffer(ctx);
      for (const fn of unlockListeners.splice(0)) {
        try { fn(ctx); } catch { /* a listener must never break the sound effects */ }
      }
    }
    // Browsers start (or return to) a suspended context until a gesture asks
    // otherwise; calling this repeatedly on later gestures is harmless.
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  /**
   * @param {string} name one of the keys in `cues.js`'s `CUES`
   * @param {{volume?: number, pitch?: number, pan?: number}} [opts]
   */
  function play(name, opts = {}) {
    if (!ctx || ctx.state !== 'running' || muted || volume <= 0) return; // safe no-op
    const spec = CUES[name];
    if (!spec) return;

    const now = ctx.currentTime;
    if (now - (lastPlayedAt[name] ?? -Infinity) < spec.gap) return;
    if (voiceCost + spec.cost > MAX_VOICE_COST) return; // mix is already busy

    const callGain = Math.max(0, opts.volume ?? 1) * effectsLevel;
    if (callGain <= 0) return;
    const pitch = Math.max(0.1, opts.pitch ?? 1);

    let out = master;
    if (opts.pan && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, opts.pan));
      panner.connect(master);
      out = panner;
    }

    lastPlayedAt[name] = now;
    voiceCost += spec.cost;
    setTimeout(() => {
      voiceCost = Math.max(0, voiceCost - spec.cost);
    }, (spec.dur + VOICE_RELEASE_PAD) * 1000);

    spec.build(ctx, out, noiseBuf, now, pitch, callGain, Math.random);
  }

  function setMuted(v) {
    muted = !!v;
    applyMasterGain();
  }

  function isMuted() {
    return muted;
  }

  /** The level of the sound EFFECTS alone, 0..1 (the score has its own volume). */
  function setEffectsLevel(v) {
    effectsLevel = clamp01(v);
  }

  function setVolume(v) {
    volume = clamp01(v);
    applyMasterGain();
  }

  /** The shared AudioContext, or null until `unlock()` has run. Never creates one. */
  function getContext() {
    return ctx;
  }

  /**
   * The master gain node (before the bus compressor). Anything connected here is under the
   * master volume and mute, exactly like the sound effects. Null until `unlock()`.
   */
  function getBus() {
    return master;
  }

  /**
   * Calls `fn(ctx)` once the context exists: immediately if it already does, otherwise from
   * inside the first `unlock()`. Returns an unsubscribe function. Used by game/audio/music.js.
   */
  function onUnlock(fn) {
    if (ctx) {
      try { fn(ctx); } catch { /* see above */ }
      return () => {};
    }
    unlockListeners.push(fn);
    return () => {
      const i = unlockListeners.indexOf(fn);
      if (i >= 0) unlockListeners.splice(i, 1);
    };
  }

  return { unlock, play, setMuted, isMuted, setVolume, setEffectsLevel, getContext, getBus, onUnlock };
}
