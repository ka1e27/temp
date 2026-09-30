// Audition page for game/audio/music.js. Two jobs:
//   1. live: buttons/sliders call the real engine through the real sfx unlock path;
//   2. offline: window.__renderClip(name) renders a named clip through an OfflineAudioContext
//      with the SAME engine code and the same scripted calls (tools/musicrender.mjs drives it).
// Clip scripts are written once (CLIPS below) and used by both the live "sequence" button and
// the offline renderer, so what the WAV files contain is what the page plays.
import { createSfx } from '../../game/audio/sfx.js';
import { createMusic } from '../../game/audio/music.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const ramp = (t, t0, t1, a, b) => a + (b - a) * clamp01((t - t0) / (t1 - t0));

// ----------------------------------------------------------------- clip scripts
// `at`: [seconds, (api) => ...] one-shot calls; `tick(t, api)`: continuous control (ramps).
// api = { music, sfx }. Times are seconds from the start of the clip.
const battle = (x) => [[0, (a) => { a.music.setScene('battle'); a.music.setIntensity(x); }]];
const world = () => [[0, (a) => a.music.setScene('world')]];

export const CLIPS = {
  'world-90s': { dur: 90, seed: 3, at: world() },
  'world-90s-seed7': { dur: 90, seed: 7, at: world() },
  'world-90s-seed1': { dur: 90, seed: 1, at: world() },
  'title-45s': { dur: 45, seed: 3, at: [[0, (a) => a.music.setScene('title')]] },
  'battle-low-60s': { dur: 60, seed: 3, at: battle(0.12) },
  'battle-high-60s': { dur: 60, seed: 3, at: battle(0.9) },
  'battle-ramp-60s': {
    dur: 60, seed: 3, at: battle(0), tick: (t, a) => a.music.setIntensity(ramp(t, 2, 52, 0, 1)),
  },
  'battle-assault-30s': {
    dur: 30, seed: 3,
    at: [...battle(0.5), [6, (a) => a.music.setAssault(true)], [22, (a) => a.music.setAssault(false)]],
  },
  'victory-transition-20s': {
    dur: 20, seed: 3,
    at: [...battle(0.85),
      [8.6, (a) => a.sfx.play('capture')],
      [9, (a) => a.music.stinger('victory', { resolveInSec: 3 })],
      [12, (a) => a.sfx.play('victory')]],
  },
  'defeat-transition-20s': {
    dur: 20, seed: 3,
    at: [...battle(0.6),
      [9, (a) => { a.music.stinger('defeat'); a.sfx.play('defeat'); }]],
  },
  'sequence-3min': {
    dur: 180, seed: 3,
    at: [
      [0, (a) => a.music.setScene('title')],
      [20, (a) => a.music.setScene('world')],
      [50, (a) => { a.music.setIntensity(0.1); a.music.setScene('battle'); }],
      [105, (a) => a.music.setAssault(true)],
      [121.5, (a) => a.sfx.play('capture')],
      [122, (a) => { a.music.setAssault(false); a.music.stinger('victory', { resolveInSec: 3 }); }],
      [125, (a) => a.sfx.play('victory')],
    ],
    tick: (t, a) => { if (t >= 50 && t < 122) a.music.setIntensity(ramp(t, 50, 100, 0.1, 0.95)); },
  },
  // Worst-case overlap for the clipping check: a hot battle with every loud cue stacked on it.
  'overlap-mix-20s': {
    dur: 20, seed: 3,
    at: [...battle(0.95), [2, (a) => a.music.setAssault(true)],
      [6, (a) => a.sfx.play('capture')], [6.15, (a) => a.sfx.play('fireball')],
      [7, (a) => a.sfx.play('fireball')], [7.4, (a) => a.sfx.play('capture')],
      [9, (a) => { a.music.setAssault(false); a.music.stinger('victory', { resolveInSec: 1.5 }); a.sfx.play('capture'); }],
      [10.5, (a) => { a.sfx.play('victory'); a.sfx.play('fireball'); }],
      [10.6, (a) => a.sfx.play('capture')]],
  },
  // Calibration stems (tools/musicrender.mjs --cal): one voice at a time, analysis only.
  ...Object.fromEntries(['pluck', 'pad', 'drone', 'lead'].map((v) => [`cal-title-${v}`, {
    dur: 30, seed: 3, noWav: true, cal: true, only: [v], at: [[0, (a) => a.music.setScene('title')]],
  }])),
  ...Object.fromEntries(['drum', 'string', 'pad', 'drone', 'counter'].flatMap((v) => [0.12, 0.9].map((x) => [`cal-battle${x}-${v}`, {
    dur: 40, seed: 3, noWav: true, cal: true, only: [v], at: battle(x),
  }]))),
  'cal-assault': {
    dur: 26, seed: 3, noWav: true, cal: true, only: ['assault'],
    at: [...battle(0.12), [2, (a) => a.music.setAssault(true)]],
  },
  // Sound effects alone, for the "music sits under the sfx" comparison. No WAV is kept.
  'ref-victory': { dur: 4, seed: 3, noWav: true, at: [[0.1, (a) => a.sfx.play('victory')]] },
  'ref-capture': { dur: 2, seed: 3, noWav: true, at: [[0.1, (a) => a.sfx.play('capture')]] },
  'ref-fireball': { dur: 3, seed: 3, noWav: true, at: [[0.1, (a) => a.sfx.play('fireball')]] },
};

/** Fires due one-shots and the continuous tick as the clip clock advances. */
function scriptRunner(spec, api) {
  const events = [...spec.at].sort((a, b) => a[0] - b[0]);
  let i = 0;
  return (t) => {
    while (i < events.length && events[i][0] <= t + 1e-9) events[i++][1](api);
    if (spec.tick) spec.tick(t, api);
  };
}

// --------------------------------------------------------------- offline render

/**
 * Renders a clip with an OfflineAudioContext. The scheduler is driven exactly like the live
 * timer, once per 25 ms of audio time, from `suspend()` callbacks.
 * @returns {Promise<{name: string, sampleRate: number, frames: number, peak: number}>}
 */
async function renderClip(name, { sampleRate = 44100, master = 0.7, musicVolume = 0.4 } = {}) {
  const spec = CLIPS[name];
  if (!spec) throw new Error(`unknown clip ${name}`);
  const ctx = new OfflineAudioContext(2, Math.ceil(spec.dur * sampleRate), sampleRate);
  // sfx.play() and the scheduler both want a "running" context; offline contexts report
  // "suspended" inside suspend() callbacks, so pin the reported state.
  Object.defineProperty(ctx, 'state', { get: () => 'running' });
  const RealAC = window.AudioContext;
  window.AudioContext = function OfflineShim() { return ctx; };
  const sfx = createSfx();
  sfx.setVolume(master);
  sfx.unlock();
  window.AudioContext = RealAC;
  const music = spec.noMusic || name.startsWith('ref-') ? null
    : createMusic(sfx, { manual: true, ignoreState: true, seed: spec.seed, volume: musicVolume, only: spec.only });
  const api = {
    sfx,
    music: music ?? { setScene() {}, setIntensity() {}, setAssault() {}, stinger() {} },
  };
  const step = scriptRunner(spec, api);
  const tickSec = 0.025;
  const frame = (t) => { step(t); if (music) music.tick(); };
  frame(0);
  let k = 1;
  const scheduleNext = () => {
    const t = k * tickSec;
    k += 1;
    if (t >= spec.dur) return;
    ctx.suspend(t).then(() => { frame(ctx.currentTime); scheduleNext(); ctx.resume(); });
  };
  scheduleNext();
  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  const pcm = new Int16Array(L.length * 2);
  let peak = 0;
  for (let i = 0; i < L.length; i++) {
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    pcm[2 * i] = Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767)));
    pcm[2 * i + 1] = Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767)));
  }
  window.__pcm = pcm;
  if (music) window.__lastDebug = music.getDebug();
  return { name, sampleRate, frames: L.length, peak, debug: music ? music.getDebug() : null };
}

/** Base64 of `count` int16 samples starting at `offset` from the last render (for the CLI). */
async function pcmChunk(offset, count) {
  const slice = window.__pcm.slice(offset, offset + count);
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.readAsDataURL(new Blob([slice.buffer]));
  });
}

window.__renderClip = renderClip;
window.__pcmChunk = pcmChunk;
window.__clipNames = Object.keys(CLIPS);
window.__calNames = Object.keys(CLIPS).filter((n) => CLIPS[n].cal);

// ------------------------------------------------------------------- live page
const $ = (id) => document.getElementById(id);
const sfx = createSfx();
sfx.setVolume(0.7);
let music = null;
let unlocked = false;
let analyser = null;
let scene = null;
let assault = false;
let seq = null;

function ensureUnlocked() {
  if (unlocked) return;
  unlocked = true;
  music = createMusic(sfx, { seed: Number($('seed').value) });
  music.setVolume(Number($('musicVol').value));
  music.setIntensity(Number($('intensity').value));
  sfx.unlock();
  const ctx = sfx.getContext();
  if (ctx && sfx.getBus()) {
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    sfx.getBus().connect(analyser);
  }
  window.__music = music;
  window.__sfx = sfx;
}
window.addEventListener('pointerdown', ensureUnlocked, { passive: true });
window.addEventListener('keydown', ensureUnlocked);

function setScene(name) {
  ensureUnlocked();
  scene = name;
  music.setScene(name);
  refreshButtons();
}

const sceneRow = $('sceneRow');
for (const name of ['title', 'world', 'battle', null]) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = name ?? 'silence';
  b.dataset.scene = name ?? '';
  b.addEventListener('click', () => { stopSequence(); setScene(name); });
  sceneRow.appendChild(b);
}

function refreshButtons() {
  for (const b of sceneRow.children) b.classList.toggle('on', (b.dataset.scene || null) === scene);
  $('assaultBtn').classList.toggle('on', assault);
}

$('intensity').addEventListener('input', () => {
  ensureUnlocked();
  const v = Number($('intensity').value);
  $('intensityVal').textContent = v.toFixed(2);
  music.setIntensity(v);
});
$('assaultBtn').addEventListener('click', () => {
  ensureUnlocked();
  assault = !assault;
  music.setAssault(assault);
  refreshButtons();
});
for (const kind of ['victory', 'defeat']) {
  $(`${kind}Btn`).addEventListener('click', () => {
    ensureUnlocked();
    const resolveInSec = kind === 'victory' ? 3 : 0.05;
    const info = music.stinger(kind, { resolveInSec });
    if (info && $('withSfx').checked) setTimeout(() => sfx.play(kind), info.resolveInSec * 1000);
    assault = false;
    refreshButtons();
  });
}
for (const name of ['capture', 'fireball', 'victory', 'rally']) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = `sfx ${name}`;
  b.addEventListener('click', () => { ensureUnlocked(); sfx.play(name); });
  $('sfxRow').appendChild(b);
}

function applySeed() {
  ensureUnlocked();
  music.setSeed(Number($('seed').value));
  showKey();
}
$('seedApply').addEventListener('click', applySeed);
$('seedRandom').addEventListener('click', () => {
  $('seed').value = String(Math.floor(Math.random() * 100000));
  applySeed();
});
function showKey() {
  if (!music) return;
  const k = music.getKey();
  $('keyInfo').textContent = `${k.id} · title ${k.bpm.title.toFixed(0)} / world ${k.bpm.world.toFixed(0)} / battle ${k.bpm.battle.toFixed(0)} bpm (applies on the next phrase)`;
}

$('musicVol').addEventListener('input', () => {
  ensureUnlocked();
  const v = Number($('musicVol').value);
  $('musicVolVal').textContent = v.toFixed(2);
  music.setVolume(v);
});
$('masterVol').addEventListener('input', () => {
  const v = Number($('masterVol').value);
  $('masterVolVal').textContent = v.toFixed(2);
  sfx.setVolume(v);
});
$('mute').addEventListener('change', () => sfx.setMuted($('mute').checked));
$('pause').addEventListener('change', () => { ensureUnlocked(); music.setPaused($('pause').checked); });

// ------------------------------------------------------------------- live sequence
function stopSequence() {
  if (!seq) return;
  clearInterval(seq.timer);
  seq = null;
  $('seq').textContent = '';
}

function playSequence() {
  ensureUnlocked();
  stopSequence();
  const spec = CLIPS['sequence-3min'];
  const step = scriptRunner(spec, { music, sfx });
  const start = performance.now();
  seq = { timer: setInterval(() => {
    const t = (performance.now() - start) / 1000;
    if (t >= spec.dur) { stopSequence(); return; }
    step(t);
    $('seq').textContent = `${t.toFixed(0)} s / ${spec.dur} s`;
  }, 100) };
}
$('seqBtn').addEventListener('click', playSequence);
$('seqStop').addEventListener('click', () => { stopSequence(); music?.setScene(null); scene = null; refreshButtons(); });

// ---------------------------------------------------------------- readouts
const buf = new Float32Array(2048);
setInterval(() => {
  if (music) {
    const d = music.getDebug();
    const lay = d.layers ? Object.entries(d.layers).filter(([, v]) => v).map(([k]) => k).join('+') || 'none' : '-';
    $('dbg').textContent = [
      `scene ${d.scene ?? 'silence'}${d.pending ? `  (pending ${d.pending.kind ?? 'silence'})` : ''}   key ${d.key}   paused ${d.paused}`,
      `intensity (smoothed) ${d.intensity.toFixed(2)}   layers ${lay}   assault ${d.assault}`,
      `voices ${d.activeVoices} (peak ${d.peakVoices})   persistent nodes ${d.persistentNodes}   pluck buffers ${d.pluckBuffers}   errors ${d.errors}`,
      `ctx ${sfx.getContext()?.state} t=${sfx.getContext()?.currentTime.toFixed(1)}s`,
    ].join('\n');
    showKey();
  }
  if (analyser) {
    analyser.getFloatTimeDomainData(buf);
    let peak = 0;
    let sum = 0;
    for (const s of buf) { peak = Math.max(peak, Math.abs(s)); sum += s * s; }
    const rms = Math.sqrt(sum / buf.length);
    const db = (v) => (v > 0 ? 20 * Math.log10(v) : -120);
    $('meterFill').style.width = `${clamp01((db(rms) + 60) / 60) * 100}%`;
    $('meterTxt').textContent = `peak ${db(peak).toFixed(1)} dB · rms ${db(rms).toFixed(1)} dB`;
  }
}, 250);

/** Automation hook (tools/pageshot.mjs style): window.demo('world'), demo('battle'), ... */
window.demo = (name) => {
  ensureUnlocked();
  if (name === 'victory' || name === 'defeat') $(`${name}Btn`).click();
  else if (name === 'sequence') playSequence();
  else setScene(name === 'silence' ? null : name);
};

refreshButtons();
