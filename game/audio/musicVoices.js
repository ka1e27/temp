// WebAudio voice builders for the score. Each builder takes the engine's `rig`
// ({ctx, cfg, group(scene, name), pluck(midi), noise, noiseOffset(), leadWave, tune,
// nextPluckSide()}) and one note event from the conductor, wires a handful of nodes into the
// right instrument group and returns a voice record { nodes, srcs, envs, end, kill(t) }.
// The engine keeps records until `end` (ctx time) has passed and then disconnects every node,
// so node count is bounded by polyphony, never by playing time.
import { midiToFreq } from './musicTheory.js';

const FLOOR = 0.0001;

export function createVoice() {
  const v = {
    nodes: [], srcs: [], envs: [], end: 0,
    add(n) { v.nodes.push(n); return n; },
    src(n) { v.nodes.push(n); v.srcs.push(n); return n; },
    /** Fade out fast and stop every source shortly after `t`. */
    kill(t) {
      for (const g of v.envs) g.gain.setTargetAtTime(0, t, 0.02);
      for (const s of v.srcs) { try { s.stop(t + 0.14); } catch { /* not started */ } }
      v.end = Math.min(v.end, t + 0.2);
    },
  };
  return v;
}

/** Fade in over `attack`, hold, then release exponentially at `t + dur`. Returns the end time. */
function sustainEnv(g, t, peak, attack, dur, release) {
  const a = Math.min(attack, Math.max(0.005, dur * 0.6));
  g.gain.setValueAtTime(FLOOR, t);
  g.gain.linearRampToValueAtTime(Math.max(FLOOR, peak), t + a);
  g.gain.setTargetAtTime(0, t + Math.max(dur, a), release / 4);
  return t + Math.max(dur, a) + release * 1.4 + 0.05;
}

/** Fast attack, exponential decay to silence (a struck sound). Returns the end time. */
function percEnv(g, t, peak, attack, decay) {
  g.gain.setValueAtTime(FLOOR, t);
  g.gain.linearRampToValueAtTime(Math.max(FLOOR, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(FLOOR, t + attack + decay);
  return t + attack + decay + 0.03;
}

function osc(rig, v, type, freq, cents = 0) {
  const o = v.src(rig.ctx.createOscillator());
  o.type = type;
  o.frequency.value = freq;
  if (cents) o.detune.value = cents;
  return o;
}

function noiseSrc(rig, v, t, end, loop = false) {
  const s = v.src(rig.ctx.createBufferSource());
  s.buffer = rig.noise;
  s.loop = loop;
  s.start(t, loop ? 0 : rig.noiseOffset());
  s.stop(end);
  return s;
}

function filt(rig, v, type, freq, q = 0.7) {
  const f = v.add(rig.ctx.createBiquadFilter());
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

// --- pitched voices -------------------------------------------------------------------------

function padVoice(rig, e, t) {
  const c = rig.cfg.voices.pad;
  const v = createVoice();
  const attack = e.attack ?? c.attackSec;
  const peak = (c.level * (e.vel ?? 1)) / Math.sqrt(e.midis.length);
  const end = t + Math.max(e.dur, attack) + c.releaseSec * 1.4 + 0.05;
  const sides = [[rig.group(e.scene, 'padL'), c.detuneCents], [rig.group(e.scene, 'padR'), -c.detuneCents]];
  for (const m of e.midis) {
    for (const [grp, cents] of sides) {
      const o = osc(rig, v, 'sawtooth', midiToFreq(m), cents);
      const g = v.add(rig.ctx.createGain());
      v.envs.push(g);
      sustainEnv(g, t, peak, attack, e.dur, c.releaseSec);
      o.connect(g);
      g.connect(grp.input);
      o.start(t);
      o.stop(end);
    }
  }
  v.end = end;
  return v;
}

function droneVoice(rig, e, t) {
  const c = rig.cfg.voices.drone;
  const v = createVoice();
  const g = v.add(rig.ctx.createGain());
  v.envs.push(g);
  const peak = (c.level * (e.vel ?? 1)) / Math.sqrt(e.midis.length * 2);
  v.end = sustainEnv(g, t, peak, e.attack ?? c.attackSec, e.dur, c.releaseSec);
  for (const m of e.midis) {
    for (const cents of [c.detuneCents, -c.detuneCents]) {
      const o = osc(rig, v, 'sawtooth', midiToFreq(m), cents);
      o.connect(g);
      o.start(t);
      o.stop(v.end);
    }
  }
  g.connect(rig.group(e.scene, 'drone').input);
  return v;
}

function pluckVoice(rig, e, t) {
  const c = rig.cfg.voices.pluck;
  const v = createVoice();
  const buf = rig.pluck(e.midi);
  const s = v.src(rig.ctx.createBufferSource());
  s.buffer = buf;
  const g = v.add(rig.ctx.createGain());
  v.envs.push(g);
  g.gain.value = c.level * (e.vel ?? 1);
  s.connect(g);
  g.connect(rig.group(e.scene, rig.nextPluckSide() ? 'pluckL' : 'pluckR').input);
  s.start(t);
  v.end = t + buf.duration + 0.05;
  s.stop(v.end);
  return v;
}

function leadVoice(rig, e, t) {
  const c = rig.cfg.voices.lead;
  const v = createVoice();
  const f = midiToFreq(e.midi);
  const o = v.src(rig.ctx.createOscillator());
  o.setPeriodicWave(rig.leadWave);
  o.frequency.value = f;
  const lfo = osc(rig, v, 'sine', c.vibratoHz);
  const depth = v.add(rig.ctx.createGain());
  depth.gain.setValueAtTime(0, t);
  depth.gain.linearRampToValueAtTime(c.vibratoCents, t + c.vibratoDelaySec + 0.3);
  lfo.connect(depth);
  depth.connect(o.detune);
  const env = v.add(rig.ctx.createGain());
  v.envs.push(env);
  v.end = sustainEnv(env, t, c.level * (e.vel ?? 1), c.attackSec, e.dur, c.releaseSec);
  o.connect(env);
  const out = rig.group(e.scene, 'lead').input;
  env.connect(out);
  // A little breath: band-passed noise riding the same envelope.
  const nz = noiseSrc(rig, v, t, v.end, true);
  const bp = filt(rig, v, 'bandpass', f * 2.2, 1.6);
  const ng = v.add(rig.ctx.createGain());
  v.envs.push(ng);
  sustainEnv(ng, t, c.breath * (e.vel ?? 1), 0.03, e.dur, c.releaseSec);
  nz.connect(bp);
  bp.connect(ng);
  ng.connect(out);
  o.start(t); o.stop(v.end);
  lfo.start(t); lfo.stop(v.end);
  return v;
}

function stringVoice(rig, e, t) {
  const c = rig.cfg.voices.strings;
  const v = createVoice();
  const g = v.add(rig.ctx.createGain());
  v.envs.push(g);
  v.end = sustainEnv(g, t, c.level * (e.vel ?? 1), c.attackSec, e.dur, e.release ?? c.releaseSec);
  for (const cents of [c.detuneCents, -c.detuneCents]) {
    const o = osc(rig, v, 'sawtooth', midiToFreq(e.midi), cents);
    o.connect(g);
    o.start(t);
    o.stop(v.end);
  }
  g.connect(rig.group(e.scene, 'strings').input);
  return v;
}

function counterVoice(rig, e, t) {
  const c = rig.cfg.voices.counter;
  const v = createVoice();
  const g = v.add(rig.ctx.createGain());
  v.envs.push(g);
  v.end = sustainEnv(g, t, c.level * (e.vel ?? 1), c.attackSec, e.dur, c.releaseSec);
  for (const [type, cents] of [['sawtooth', c.detuneCents], ['triangle', -c.detuneCents]]) {
    const o = osc(rig, v, type, midiToFreq(e.midi), cents);
    o.connect(g);
    o.start(t);
    o.stop(v.end);
  }
  g.connect(rig.group(e.scene, 'counter').input);
  return v;
}

// --- drums ------------------------------------------------------------------------------------

function drumVoice(rig, e, t) {
  const c = rig.cfg.voices.drum;
  const v = createVoice();
  const vel = e.vel ?? 1;
  const out = rig.group(e.scene, 'drums').input;
  const f1 = rig.tune;
  let end = t;
  const body = (f0, fEnd, dropSec, peak, decay) => {
    const o = osc(rig, v, 'sine', f0);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(fEnd, t + dropSec);
    const g = v.add(rig.ctx.createGain());
    v.envs.push(g);
    const e1 = percEnv(g, t, peak, 0.003, decay);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(e1);
    end = Math.max(end, e1);
  };
  const skin = (type, freq, q, peak, decay) => {
    const dur = decay + 0.06;
    const n = noiseSrc(rig, v, t, t + dur);
    const f = filt(rig, v, type, freq, q);
    const g = v.add(rig.ctx.createGain());
    v.envs.push(g);
    const e1 = percEnv(g, t, peak, 0.002, decay);
    n.connect(f); f.connect(g); g.connect(out);
    end = Math.max(end, e1, t + dur);
  };
  switch (e.drum) {
    case 'ka':
      skin('bandpass', 1900, 1.3, c.kaLevel * vel, 0.07);
      body(320, 210, 0.04, c.kaLevel * 0.55 * vel, 0.05);
      break;
    case 'tom':
      body(f1 * 2.2, f1 * 1.5, 0.12, c.tomLevel * vel, 0.28);
      skin('lowpass', 420, 0.7, 0.3 * vel, 0.08);
      break;
    case 'boom':
      body(f1 * 1.2, f1 * 0.5, 0.4, c.donLevel * vel, c.boomDecaySec);
      skin('lowpass', 150, 0.7, 0.5 * vel, 0.6);
      break;
    default: // don
      body(f1 * c.donBase, f1, c.donDropSec, c.donLevel * vel, c.donDecaySec);
      skin('lowpass', 260, 0.8, 0.5 * vel, 0.12);
      if (vel > 0.6) skin('highpass', 1400, 0.7, 0.1 * vel, 0.015);
  }
  v.end = end;
  return v;
}

const BUILDERS = {
  pad: padVoice, drone: droneVoice, pluck: pluckVoice, lead: leadVoice,
  string: stringVoice, counter: counterVoice, drum: drumVoice,
};

/** Build one note event's voice, or null for an unknown voice name. */
export function buildNote(rig, e, t) {
  const b = BUILDERS[e.voice];
  return b ? b(rig, e, t) : null;
}

// --- assault swell -----------------------------------------------------------------------------

/**
 * A sustained string chord with a tremolo that speeds up, a filter that opens and a noise
 * riser: loudness, brightness and tremolo rate all climb over `riseSec`. `release()` fades
 * it out through a separate gain so the rise automation never has to be cancelled.
 * @returns the voice record plus `retune(midis, t)` and `release(t)`
 */
export function createAssaultVoice(rig, scene, t, midis) {
  const a = rig.cfg.assault;
  const c = rig.cfg.voices.assault;
  const v = createVoice();
  const ctx = rig.ctx;
  const rise = a.riseSec;
  const out = rig.group(scene, 'assault').input;
  const relGain = v.add(ctx.createGain());
  v.envs.push(relGain);
  relGain.connect(out);
  const trem = v.add(ctx.createGain());
  trem.gain.value = 0.55;
  const lp = filt(rig, v, 'lowpass', a.cutoffHz[0], 0.7);
  lp.frequency.setValueAtTime(a.cutoffHz[0], t);
  lp.frequency.exponentialRampToValueAtTime(a.cutoffHz[1], t + rise);
  const swell = v.add(ctx.createGain());
  swell.gain.setValueAtTime(0.02, t);
  swell.gain.exponentialRampToValueAtTime(a.peakGain * c.level, t + rise);
  swell.connect(trem); trem.connect(lp); lp.connect(relGain);
  const oscs = midis.map((m, i) => {
    const o = osc(rig, v, 'sawtooth', midiToFreq(m), i === 1 ? c.detuneCents : -c.detuneCents);
    const g = v.add(ctx.createGain());
    g.gain.value = 1 / Math.sqrt(midis.length);
    o.connect(g); g.connect(swell);
    o.start(t);
    return o;
  });
  const lfo = osc(rig, v, 'sine', a.tremoloHz[0]);
  lfo.frequency.setValueAtTime(a.tremoloHz[0], t);
  lfo.frequency.linearRampToValueAtTime(a.tremoloHz[1], t + rise);
  const depth = v.add(ctx.createGain());
  depth.gain.value = 0.45;
  lfo.connect(depth); depth.connect(trem.gain);
  lfo.start(t);
  // Riser noise, band-passed upward.
  const nz = v.src(ctx.createBufferSource());
  nz.buffer = rig.noise; nz.loop = true; nz.start(t, 0);
  const bp = filt(rig, v, 'bandpass', 300, 1.2);
  bp.frequency.setValueAtTime(300, t);
  bp.frequency.exponentialRampToValueAtTime(3000, t + rise);
  const ng = v.add(ctx.createGain());
  ng.gain.setValueAtTime(FLOOR, t);
  ng.gain.exponentialRampToValueAtTime(c.noiseLevel, t + rise);
  nz.connect(bp); bp.connect(ng); ng.connect(trem);
  v.end = Infinity;
  v.retune = (next, at) => {
    oscs.forEach((o, i) => { if (next[i]) o.frequency.setTargetAtTime(midiToFreq(next[i]), at, 0.12); });
  };
  v.release = (at) => {
    relGain.gain.setTargetAtTime(0, at, a.releaseSec / 4);
    const end = at + a.releaseSec * 1.4 + 0.1;
    for (const s of v.srcs) { try { s.stop(end); } catch { /* already stopped */ } }
    v.end = end;
  };
  return v;
}
