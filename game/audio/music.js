// The generative score: `createMusic(sfx, opts)` builds a lookahead scheduler that renders the
// pure conductor's events (game/audio/musicConductor.js) as WebAudio notes. It shares the
// AudioContext and the master gain of `createSfx()`, so master volume and mute cover both.
// Nothing here creates an AudioContext: the score stays completely inert until sfx.unlock()
// has run (first user gesture), remembers what it was asked in the meantime, then applies it.
// See docs/MUSIC.md for the hookup and game/config/music.js for every tuning number.
import { MUSIC } from '../config/music.js';
import { createConductor } from './musicConductor.js';
import { clamp01, createSong, midiAtOrAbove, midiToFreq } from './musicTheory.js';
import { renderImpulseResponse, renderNoise, renderPluck } from './musicDsp.js';
import { buildNote, createAssaultVoice } from './musicVoices.js';

const lerp = (a, b, k) => a + (b - a) * k;

/**
 * @param {ReturnType<import('./sfx.js').createSfx>} sfx
 * @param {{config?: object, seed?: number, volume?: number, reverb?: boolean, startPhrase?: number,
 *   manual?: boolean, ignoreState?: boolean, only?: string[], timer?: {set: Function, clear: Function}}} [opts]
 *   `manual`: no internal timer, the caller invokes `tick()` (offline rendering, tests).
 *   `ignoreState`: schedule even when ctx.state is not 'running' (OfflineAudioContext).
 *   `only`: dev/calibration only, play just these voices (pad drone pluck lead string counter drum assault).
 */
export function createMusic(sfx, opts = {}) {
  const cfg = opts.config ?? MUSIC;
  const timer = opts.timer ?? { set: (fn, ms) => setInterval(fn, ms), clear: (id) => clearInterval(id) };
  const reverbOn = opts.reverb ?? cfg.reverb.enabled;
  const only = opts.only ? new Set(opts.only) : null;

  const desired = {
    scene: null, intensity: 0, assault: false, paused: false,
    seed: opts.seed ?? cfg.defaultSeed, volume: clamp01(opts.volume ?? cfg.defaultVolume),
  };
  const conductor = createConductor({
    config: cfg, song: createSong(desired.seed, cfg), startBar: (opts.startPhrase ?? 0) * cfg.phraseBars,
  });

  let ctx = null;
  let started = false;
  let destroyed = false;
  let timerId = null;
  let unsubscribe = null;
  let errors = 0;
  let peakVoices = 0;
  let out = null; // music volume -> sfx master
  let duck = null; // dips the whole score under a big sound effect
  let mixBus = null;
  let conv = null;
  let noiseBuf = null;
  let leadWave = null;
  let assaultVoice = null;
  let pluckSide = false;
  let noiseCounter = 0;
  const persistent = []; // nodes that live as long as the music does
  const scenes = new Map(); // scene name -> { dry, wetIn, groups: Map }
  const plucks = new Map(); // midi -> AudioBuffer (LRU, bounded)
  /** @type {Array<{end: number, nodes: any[], kill: Function}>} */
  let active = [];

  const live = () => started && !destroyed;
  const audible = () => desired.volume > 0 && !(sfx.isMuted && sfx.isMuted());

  // --- graph ---------------------------------------------------------------------------

  function keep(node) {
    persistent.push(node);
    return node;
  }

  function buffer(data, channels = 1) {
    const b = ctx.createBuffer(channels, channels === 1 ? data.length : data[0].length, ctx.sampleRate);
    if (channels === 1) b.getChannelData(0).set(data);
    else data.forEach((d, i) => b.getChannelData(i).set(d));
    return b;
  }

  function buildGraph() {
    const bus = sfx.getBus();
    out = keep(ctx.createGain());
    out.gain.value = desired.paused ? 0 : desired.volume * cfg.bus.outputScale;
    out.connect(bus);
    duck = keep(ctx.createGain());
    duck.connect(out);
    mixBus = keep(ctx.createGain());
    mixBus.connect(duck);
    if (reverbOn) {
      const r = cfg.reverb;
      conv = keep(ctx.createConvolver());
      conv.buffer = buffer(renderImpulseResponse(ctx.sampleRate, r.seconds, r.decay, r.noiseSeed), 2);
      const wet = keep(ctx.createGain());
      wet.gain.value = r.wet;
      conv.connect(wet);
      wet.connect(mixBus);
    }
    const d = cfg.voices.drum;
    noiseBuf = buffer(renderNoise(ctx.sampleRate, d.noiseSeconds, d.noiseSeed));
    const h = cfg.voices.lead.harmonics;
    leadWave = ctx.createPeriodicWave(new Float32Array(h.length), Float32Array.from(h));
  }

  function getScene(name) {
    let s = scenes.get(name);
    if (s) return s;
    const dry = keep(ctx.createGain());
    dry.gain.value = 0;
    dry.connect(mixBus);
    let wetIn = null;
    if (conv) {
      wetIn = keep(ctx.createGain());
      wetIn.gain.value = 0;
      wetIn.connect(conv);
    }
    s = { dry, wetIn, groups: new Map() };
    scenes.set(name, s);
    return s;
  }

  function group(sceneName, name) {
    const sc = getScene(sceneName);
    let g = sc.groups.get(name);
    if (g) return g;
    const spec = cfg.groups[name];
    const lp = keep(ctx.createBiquadFilter());
    lp.type = 'lowpass';
    lp.frequency.value = spec.lp;
    lp.Q.value = spec.q;
    const vol = keep(ctx.createGain());
    vol.gain.value = spec.gain;
    lp.connect(vol);
    let tail = vol;
    if (spec.pan && ctx.createStereoPanner) {
      tail = keep(ctx.createStereoPanner());
      tail.pan.value = spec.pan;
      vol.connect(tail);
    }
    tail.connect(sc.dry);
    if (sc.wetIn && spec.send > 0) {
      const send = keep(ctx.createGain());
      send.gain.value = spec.send;
      vol.connect(send);
      send.connect(sc.wetIn);
    }
    if (name.startsWith('pad')) { // the pad breathes: a very slow filter sweep, different per side
      const v = cfg.voices.pad;
      const lfo = keep(ctx.createOscillator());
      lfo.frequency.value = v.padLfoHz * (name === 'padR' ? 1.17 : 1);
      const depth = keep(ctx.createGain());
      depth.gain.value = v.padLfoDepthHz;
      lfo.connect(depth);
      depth.connect(lp.frequency);
      lfo.start();
    }
    g = { input: lp, lp, vol, spec, mix: {} };
    sc.groups.set(name, g);
    return g;
  }

  function fadeScene(name, target, t, dur) {
    const sc = getScene(name);
    const tau = Math.max(0.02, dur / 3);
    sc.dry.gain.setTargetAtTime(target, t, tau);
    if (sc.wetIn) sc.wetIn.gain.setTargetAtTime(target, t, tau);
  }

  function pluck(midi) {
    let b = plucks.get(midi);
    if (b) {
      plucks.delete(midi);
      plucks.set(midi, b);
      return b;
    }
    const c = cfg.voices.pluck;
    b = buffer(renderPluck(midiToFreq(midi), ctx.sampleRate, c));
    plucks.set(midi, b);
    if (plucks.size > c.cacheMax) plucks.delete(plucks.keys().next().value);
    return b;
  }

  const rig = {
    cfg,
    get ctx() { return ctx; },
    get noise() { return noiseBuf; },
    get leadWave() { return leadWave; },
    get tune() {
      return midiToFreq(midiAtOrAbove(conductor.getSong().key.tonicPc, cfg.voices.drum.tuneLo));
    },
    group,
    pluck,
    noiseOffset() {
      noiseCounter += 1;
      return ((noiseCounter * 0.6180339887) % 1) * Math.max(0, noiseBuf.duration - 1);
    },
    nextPluckSide() {
      pluckSide = !pluckSide;
      return pluckSide;
    },
  };

  // --- events ----------------------------------------------------------------------------

  function ramp(holder, key, param, to, t, dur) {
    param.setValueAtTime(holder.mix[key] ?? to, t);
    param.linearRampToValueAtTime(to, t + dur);
    holder.mix[key] = to;
  }

  /** Intensity sweeps a few group parameters once per bar, ramped across the bar. */
  function applyBar(e, t) {
    if (e.scene !== 'battle') return;
    const x = e.x;
    const s = group('battle', 'strings');
    ramp(s, 'lp', s.lp.frequency, lerp(cfg.stringsCutoffHz[0], cfg.stringsCutoffHz[1], x), t, e.dur);
    ramp(s, 'vol', s.vol.gain, s.spec.gain * lerp(cfg.stringsGain[0], cfg.stringsGain[1], x), t, e.dur);
    const d = group('battle', 'drums');
    ramp(d, 'vol', d.vol.gain, d.spec.gain * lerp(cfg.drumsGain[0], cfg.drumsGain[1], x), t, e.dur);
    for (const name of ['padL', 'padR']) {
      const p = group('battle', name);
      ramp(p, 'lp', p.lp.frequency, lerp(cfg.padCutoffHz[0], cfg.padCutoffHz[1], x), t, e.dur);
    }
    if (assaultVoice && e.assaultMidis) assaultVoice.retune(e.assaultMidis, t);
  }

  function track(v) {
    if (!v) return;
    active.push(v);
    if (active.length > peakVoices) peakVoices = active.length;
  }

  function handle(e, now, hear) {
    const t = Math.max(e.t, now);
    switch (e.type) {
      case 'note':
        if (hear && e.t >= now - cfg.lateNoteDropSec && (!only || only.has(e.voice))) track(buildNote(rig, e, t));
        break;
      case 'bar':
        applyBar(e, t);
        break;
      case 'scene':
        if (e.from) fadeScene(e.from, 0, t, e.fadeOut);
        if (e.scene) fadeScene(e.scene, 1, t, e.fadeIn);
        break;
      case 'bus':
        fadeScene(e.scene, e.to, t, e.dur);
        break;
      case 'assault':
        if (e.on) {
          if (hear && !assaultVoice && (!only || only.has('assault'))) {
            assaultVoice = createAssaultVoice(rig, 'battle', t, e.midis);
            track(assaultVoice);
          }
        } else if (assaultVoice) {
          assaultVoice.release(t);
          assaultVoice = null;
        }
        break;
      case 'duck':
        duck.gain.setTargetAtTime(e.depth, t, 0.03);
        duck.gain.setTargetAtTime(1, t + e.sec, 0.35);
        break;
      default:
    }
  }

  function dispose(v) {
    for (const n of v.nodes) {
      try { n.disconnect(); } catch { /* already gone */ }
    }
  }

  function reap(now) {
    let w = 0;
    for (let i = 0; i < active.length; i++) {
      const v = active[i];
      if (v.end < now - 0.05) dispose(v);
      else active[w++] = v;
    }
    active.length = w;
  }

  /** One scheduling pass. Called by the timer; public for offline rendering and tests. */
  function tick() {
    if (!live() || desired.paused) return;
    if (!opts.ignoreState && ctx.state !== 'running') return;
    try {
      const now = ctx.currentTime;
      const events = conductor.advance(now, now + cfg.lookaheadSec);
      const hear = audible();
      for (const e of events) handle(e, now, hear);
      reap(now);
      errors = 0;
    } catch (err) {
      errors += 1;
      if (errors === 1 && typeof console !== 'undefined') console.warn('[music] scheduler error', err);
      if (errors > 50) stopTimer(); // never let the score spam or stall the game
    }
  }

  function startTimer() {
    if (opts.manual || timerId !== null || destroyed) return;
    timerId = timer.set(tick, cfg.tickMs);
  }

  function stopTimer() {
    if (timerId === null) return;
    timer.clear(timerId);
    timerId = null;
  }

  // --- unlock ------------------------------------------------------------------------------

  function start() {
    if (started || destroyed) return;
    ctx = sfx.getContext();
    if (!ctx || !sfx.getBus()) return;
    buildGraph();
    started = true;
    const now = ctx.currentTime;
    conductor.setIntensity(desired.intensity);
    conductor.setAssault(desired.assault, now);
    if (desired.scene) conductor.setScene(desired.scene, now);
    if (!desired.paused) startTimer();
  }

  if (typeof sfx.onUnlock === 'function') unsubscribe = sfx.onUnlock(start);
  else {
    // An older sfx without onUnlock(): poll (cheaply) until its context appears.
    const poll = timer.set(() => {
      if (sfx.getContext && sfx.getContext()) { timer.clear(poll); start(); }
    }, 250);
    unsubscribe = () => timer.clear(poll);
  }

  // --- public api -----------------------------------------------------------------------------

  function setScene(kind) {
    if (kind !== null && kind !== undefined && !cfg.scenes[kind]) return;
    desired.scene = kind ?? null;
    if (live()) conductor.setScene(desired.scene, ctx.currentTime);
  }

  function setIntensity(v) {
    desired.intensity = clamp01(Number.isFinite(v) ? v : 0);
    conductor.setIntensity(desired.intensity);
  }

  function setAssault(on) {
    desired.assault = !!on;
    if (live()) conductor.setAssault(desired.assault, ctx.currentTime);
  }

  /**
   * @param {'victory'|'defeat'} kind
   * @param {{resolveInSec?: number}} [o] seconds from now until the cadence lands
   * @returns {{resolveInSec: number, tailSec: number}|null} null when inert/paused
   */
  function stinger(kind, o = {}) {
    if (!live() || desired.paused) return null;
    const r = conductor.stinger(kind, ctx.currentTime, o);
    if (!r) return null;
    return { resolveInSec: r.resolveAt - ctx.currentTime, tailSec: r.endAt - r.resolveAt };
  }

  function setSeed(seed) {
    desired.seed = seed;
    conductor.setSong(createSong(seed, cfg));
  }

  function applyOut() {
    if (!live()) return;
    out.gain.setTargetAtTime(desired.paused ? 0 : desired.volume * cfg.bus.outputScale, ctx.currentTime, cfg.volumeSmoothSec);
  }

  function setVolume(v) {
    desired.volume = clamp01(Number.isFinite(v) ? v : cfg.defaultVolume);
    applyOut();
  }

  function setPaused(p) {
    const v = !!p;
    if (v === desired.paused) return;
    desired.paused = v;
    if (!live()) return;
    const now = ctx.currentTime;
    if (v) {
      stopTimer();
      for (const voice of active) voice.kill(now + 0.03);
      assaultVoice = null;
    } else {
      conductor.resume();
      startTimer();
    }
    applyOut();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    stopTimer();
    if (unsubscribe) unsubscribe();
    if (started) {
      for (const v of active) { v.kill(ctx.currentTime); dispose(v); }
      active = [];
      for (const n of persistent) {
        try { if (typeof n.stop === 'function') n.stop(); } catch { /* not a source, or already stopped */ }
        try { n.disconnect(); } catch { /* already gone */ }
      }
      persistent.length = 0;
      scenes.clear();
      plucks.clear();
    }
    assaultVoice = null;
    ctx = null;
  }

  return {
    setScene, setIntensity, setAssault, stinger, setSeed, setVolume, setPaused, destroy, tick,
    getKey() {
      const s = conductor.getSong();
      return {
        ...s.key,
        bpm: Object.fromEntries(Object.entries(cfg.scenes).map(([k, v]) => [k, v.bpm * s.tempoScale])),
      };
    },
    getDebug() {
      return {
        started, paused: desired.paused, destroyed, errors, peakVoices,
        activeVoices: active.length, persistentNodes: persistent.length, pluckBuffers: plucks.size,
        volume: desired.volume, desired: { ...desired }, ...conductor.getState(),
      };
    },
  };
}
