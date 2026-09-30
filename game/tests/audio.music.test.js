// The generative score (game/audio/music*.js), tested headlessly: the pure theory / pattern /
// conductor layers directly, and the WebAudio engine against a mock AudioContext that counts
// live nodes (so a leak over a simulated hour shows up as a number, not as a hunch).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MUSIC } from '../config/music.js';
import { createRng } from '../core/rng.js';
import {
  chordAt, createSong, degreeSemis, hysteresis, pcOf, scalePcs, smoothToward,
} from '../audio/musicTheory.js';
import { nextBattleLayers, phraseMelody, planBattleBar, planWorldBar } from '../audio/musicPatterns.js';
import { createConductor } from '../audio/musicConductor.js';
import { stingerPlan, victoryResolvePcs } from '../audio/musicStinger.js';
import { estimatePitch, renderPluck } from '../audio/musicDsp.js';
import { createMusic } from '../audio/music.js';
import { battleAssault, battleIntensity } from '../audio/musicIntensity.js';
import { createBattle, step, issue } from '../battle/sim.js';
import { think } from '../battle/ai.js';
import { decide } from '../battle/bot.js';
import { buildArena } from '../battle/arena.js';
import { buildTestWorld, TARGET_REGION, DEFAULT_OWNERS } from './fixtures/battle-world.js';

const WHITE_KEYS = [0, 2, 4, 5, 7, 9, 11];

// ------------------------------------------------------------------ helpers

/** Drive a conductor on a fake clock; returns every event emitted in [from, to). */
function run(conductor, from, to, onStep) {
  const out = [];
  for (let t = from; t < to - 1e-9; t += 0.025) {
    if (onStep) onStep(t);
    out.push(...conductor.advance(t, t + MUSIC.lookaheadSec));
  }
  return out;
}

const pitchesOf = (e) => (e.midis ?? (e.midi !== undefined ? [e.midi] : []));
const onGrid = (t, grid) => {
  const k = (t - grid.t0) / grid.barDur;
  return Math.abs(k - Math.round(k)) < 1e-6;
};

// ------------------------------------------------------------ mock AudioContext

class MockParam {
  constructor(v = 0) { this.value = v; }
  setValueAtTime(v) { this.value = v; return this; }
  linearRampToValueAtTime(v) { this.value = v; return this; }
  exponentialRampToValueAtTime(v) { this.value = v; return this; }
  setTargetAtTime(v) { this.value = v; return this; }
  cancelScheduledValues() { return this; }
}

class MockNode {
  constructor(ctx, kind) {
    this.ctx = ctx;
    this.kind = kind;
    this.inputs = [];
    this.dead = false;
    ctx.stats.created += 1;
    ctx.live.add(this);
  }

  connect(dest) {
    if (dest && dest.inputs) dest.inputs.push(this);
    return dest;
  }

  disconnect() {
    if (this.dead) return;
    this.dead = true;
    this.ctx.live.delete(this);
    const isSrc = this.kind === 'osc' || this.kind === 'bufsrc';
    if (isSrc && this.started && (this.stopAt === undefined || this.stopAt - this.ctx.currentTime > 0.5)) {
      this.ctx.stats.premature += 1;
    }
  }

  start() { this.started = true; }
  stop(t) { this.stopAt = t ?? this.ctx.currentTime; }
}

class MockContext {
  constructor(sampleRate = 44100) {
    this.sampleRate = sampleRate;
    this.currentTime = 0;
    this.state = 'running';
    this.live = new Set();
    this.stats = { created: 0, premature: 0 };
    this.destination = new MockNode(this, 'dest');
  }

  node(kind, params = {}) {
    const n = new MockNode(this, kind);
    for (const [k, v] of Object.entries(params)) n[k] = new MockParam(v);
    return n;
  }

  createGain() { return this.node('gain', { gain: 1 }); }
  createOscillator() { const n = this.node('osc', { frequency: 440, detune: 0 }); n.setPeriodicWave = () => {}; return n; }
  createBufferSource() { return this.node('bufsrc', { playbackRate: 1 }); }
  createBiquadFilter() { return this.node('biquad', { frequency: 350, Q: 1, gain: 0 }); }
  createConvolver() { return this.node('conv'); }
  createStereoPanner() { return this.node('pan', { pan: 0 }); }
  createDynamicsCompressor() { return this.node('comp', { threshold: 0, knee: 0, ratio: 0, attack: 0, release: 0 }); }
  createPeriodicWave() { return {}; }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { length, sampleRate, numberOfChannels: channels, duration: length / sampleRate, getChannelData: (i) => data[i] };
  }
}

/** Stands in for createSfx(): owns a MockContext that only exists after unlock(). */
function fakeSfx() {
  const s = { ctx: null, bus: null, muted: false, contextsCreated: 0, listeners: [] };
  s.unlock = () => {
    if (s.ctx) return;
    s.ctx = new MockContext();
    s.contextsCreated += 1;
    s.bus = s.ctx.createGain();
    for (const fn of s.listeners.splice(0)) fn(s.ctx);
  };
  s.getContext = () => s.ctx;
  s.getBus = () => s.bus;
  s.isMuted = () => s.muted;
  s.onUnlock = (fn) => {
    if (s.ctx) fn(s.ctx); else s.listeners.push(fn);
    return () => {};
  };
  return s;
}

function timerSpy() {
  const t = { sets: 0, clears: 0, fn: null };
  t.set = (fn) => { t.sets += 1; t.fn = fn; return t.sets; };
  t.clear = () => { t.clears += 1; };
  return t;
}

function stepMusic(sfx, music, seconds) {
  const n = Math.round(seconds / 0.025);
  for (let i = 0; i < n; i++) {
    sfx.ctx.currentTime += 0.025;
    music.tick();
  }
}

// ------------------------------------------------------------------- config sanity

test('config: keys, tempos, crossfades and default volume sit inside the brief', () => {
  assert.ok(MUSIC.defaultVolume >= 0.35 && MUSIC.defaultVolume <= 0.45);
  for (let seed = 1; seed <= 60; seed++) {
    const song = createSong(seed);
    const battle = MUSIC.scenes.battle.bpm * song.tempoScale;
    assert.ok(battle >= 96 && battle <= 112, `battle ${battle} bpm at seed ${seed}`);
  }
  for (const s of Object.values(MUSIC.scenes)) assert.ok(s.crossfadeSec >= 1.5 && s.crossfadeSec <= 3);
  // Every key is a mode of the C-major collection, so no sound effect can hold a foreign note.
  for (const key of MUSIC.keys) {
    const song = createSong(1, { ...MUSIC, keys: [key] });
    for (const pc of scalePcs(song)) assert.ok(WHITE_KEYS.includes(pc), `${key.id} has pc ${pc}`);
  }
});

test('harmony: every progression uses only major/minor triads with a perfect fifth', () => {
  for (const key of MUSIC.keys) {
    const song = createSong(1, { ...MUSIC, keys: [key] });
    for (const prog of MUSIC.progressions[key.mode]) {
      assert.equal(prog.length, MUSIC.phraseBars);
      for (const d of prog) {
        const c = chordAt(song, d);
        const third = (c.thirdPc - c.rootPc + 12) % 12;
        const fifth = (c.fifthPc - c.rootPc + 12) % 12;
        assert.ok(third === 3 || third === 4, `${key.id} degree ${d} third ${third}`);
        assert.equal(fifth, 7, `${key.id} degree ${d} is diminished`);
      }
    }
  }
  assert.equal(degreeSemis([0, 2, 4, 5, 7, 9, 10], 8), 14);
  assert.equal(degreeSemis([0, 2, 4, 5, 7, 9, 10], -1), -2);
});

// ------------------------------------------------------------- determinism per seed

test('songs and patterns are deterministic per seed, and different seeds differ', () => {
  assert.deepEqual(createSong(42), createSong(42));
  const songs = [...Array(30).keys()].map((i) => createSong(i + 1));
  assert.ok(new Set(songs.map((s) => s.key.id)).size >= 3, 'all three keys appear across 30 seeds');
  assert.ok(new Set(songs.map((s) => JSON.stringify(s.motifs))).size >= 28, 'motif sets differ per seed');
  assert.notDeepEqual(createSong(1), createSong(2));

  const a = createSong(7);
  const b = createSong(7);
  for (const scene of ['title', 'world']) {
    for (let gb = 0; gb < 48; gb++) assert.deepEqual(planWorldBar(a, scene, gb), planWorldBar(b, scene, gb));
  }
  const layers = { quarter: true, eighth: true, counter: true };
  for (let gb = 0; gb < 48; gb++) assert.deepEqual(planBattleBar(a, gb, 0.7, layers), planBattleBar(b, gb, 0.7, layers));
  // A phrase never depends on what was asked before it.
  const first = phraseMelody(a, 9);
  phraseMelody(a, 3); planWorldBar(a, 'world', 100);
  assert.deepEqual(phraseMelody(a, 9), first);
});

test('the same scripted session yields the identical event stream; another seed does not', () => {
  const session = (seed) => {
    const c = createConductor({ seed });
    c.setIntensity(0.6);
    return run(c, 0, 90, (t) => {
      if (Math.abs(t - 0.5) < 0.0125) c.setScene('title', t);
      if (Math.abs(t - 20) < 0.0125) c.setScene('world', t);
      if (Math.abs(t - 50) < 0.0125) c.setScene('battle', t);
    });
  };
  const one = JSON.stringify(session(11));
  assert.equal(one, JSON.stringify(session(11)));
  assert.notEqual(one, JSON.stringify(session(12)));
});

test('every pitched event in every scene and stinger stays inside the C-major collection', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    const c = createConductor({ seed });
    c.setIntensity(0.95);
    const events = run(c, 0, 240, (t) => {
      if (Math.abs(t - 0.5) < 0.0125) c.setScene('title', t);
      if (Math.abs(t - 40) < 0.0125) c.setScene('world', t);
      if (Math.abs(t - 100) < 0.0125) c.setScene('battle', t);
      if (Math.abs(t - 140) < 0.0125) c.setAssault(true, t);
      if (Math.abs(t - 170) < 0.0125) c.stinger('victory', t, { resolveInSec: 3 });
      if (Math.abs(t - 200) < 0.0125) c.setScene('battle', t);
      if (Math.abs(t - 215) < 0.0125) c.stinger('defeat', t);
    });
    const notes = events.filter((e) => e.type === 'note');
    assert.ok(notes.length > 500);
    for (const e of notes) for (const m of pitchesOf(e)) assert.ok(WHITE_KEYS.includes(pcOf(m)), `seed ${seed} ${e.voice} midi ${m}`);
    for (const e of notes.filter((n) => n.voice === 'lead')) {
      assert.ok(e.midi >= MUSIC.motif.leadRange[0] && e.midi <= MUSIC.motif.leadRange[1]);
    }
  }
});

test('no pad or drone chord ever contains a minor second (no E against F grind)', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) {
    const c = createConductor({ seed });
    c.setIntensity(0.7);
    const events = run(c, 0, 400, (t) => {
      if (Math.abs(t - 0.5) < 0.0125) c.setScene('title', t);
      if (Math.abs(t - 110) < 0.0125) c.setScene('world', t);
      if (Math.abs(t - 300) < 0.0125) c.setScene('battle', t);
    });
    const chords = events.filter((e) => e.type === 'note' && (e.voice === 'pad' || e.voice === 'drone') && e.midis);
    assert.ok(chords.length > 60);
    for (const e of chords) {
      for (let i = 0; i < e.midis.length; i++) {
        for (let j = i + 1; j < e.midis.length; j++) {
          const iv = ((e.midis[j] - e.midis[i]) % 12 + 12) % 12;
          assert.ok(iv !== 1 && iv !== 11, `seed ${seed} ${e.voice} ${e.midis} has a minor second`);
        }
      }
    }
  }
});

test('drum density follows intensity monotonically; patterns stay sparse when calm', () => {
  const song = createSong(3);
  const layers = { quarter: true, eighth: true, counter: false };
  const hits = (x) => {
    let n = 0;
    for (let gb = 0; gb < 16; gb++) n += planBattleBar(song, gb, x, layers).filter((s) => s.voice === 'drum').length;
    return n;
  };
  let prev = -1;
  for (let x = 0; x <= 1.0001; x += 0.1) {
    const h = hits(x);
    assert.ok(h >= prev, `hits fell at x=${x.toFixed(1)}: ${h} < ${prev}`);
    prev = h;
  }
  assert.ok(hits(0.1) / 16 <= 3, 'calm battle bar has at most 3 drum hits');
  assert.ok(hits(1) / 16 >= 9, 'full intensity is busy');
});

test('layers use hysteresis: a value hovering on a threshold does not flap', () => {
  assert.equal(hysteresis(false, 0.6, [0.6, 0.5]), true);
  assert.equal(hysteresis(true, 0.55, [0.6, 0.5]), true);
  assert.equal(hysteresis(true, 0.49, [0.6, 0.5]), false);
  let layers = { quarter: false, eighth: false, counter: false };
  let flips = 0;
  let last = false;
  for (let i = 0; i < 200; i++) {
    layers = nextBattleLayers(layers, 0.6 + Math.sin(i) * 0.04, hysteresis);
    if (layers.counter !== last) flips += 1;
    last = layers.counter;
  }
  assert.ok(flips <= 1, `counter flipped ${flips} times around its threshold`);
});

// ----------------------------------------------------------- scheduler timing (pure)

test('scene changes land on a bar line of the segment that was playing', () => {
  for (const seed of [1, 5, 9]) {
    for (const [from, to] of [['title', 'world'], ['world', 'battle'], ['battle', 'world'], ['world', 'title']]) {
      for (const offset of [0.3, 1.1, 2.2, 3.05]) {
        const c = createConductor({ seed });
        c.setScene(from, 0);
        run(c, 0, 12.2 + offset);
        const grid = c.getState().grid;
        const requestAt = 12.2 + offset;
        c.setScene(to, requestAt);
        const events = run(c, requestAt, requestAt + 20);
        const sw = events.find((e) => e.type === 'scene');
        assert.ok(sw, `${from}->${to} never switched`);
        assert.equal(sw.scene, to);
        assert.ok(onGrid(sw.t, grid), `${from}->${to} at ${sw.t} is off the ${grid.barDur}s bar grid`);
        assert.ok(sw.t >= requestAt + MUSIC.minSwitchLeadSec - 1e-9);
        assert.ok(sw.t - requestAt <= grid.barDur + MUSIC.minSwitchLeadSec + 1e-9, 'never waits more than a bar');
        assert.ok(sw.fadeIn >= 1.5 && sw.fadeIn <= 3, `crossfade ${sw.fadeIn}s`);
        assert.ok(sw.fadeOut >= 1.5 && sw.fadeOut <= 3);
        const bar = events.find((e) => e.type === 'bar' && e.scene === to);
        assert.ok(Math.abs(bar.t - sw.t) < 1e-9, 'the new scene starts its first bar on the switch');
      }
    }
  }
});

test('bar events are evenly spaced, and layers/mix change only on them', () => {
  const c = createConductor({ seed: 2 });
  c.setScene('battle', 0);
  c.setIntensity(1);
  const events = run(c, 0, 90);
  const bars = events.filter((e) => e.type === 'bar');
  assert.ok(bars.length >= 30);
  const barDur = bars[0].dur;
  bars.forEach((b, i) => assert.ok(Math.abs(b.t - (bars[0].t + i * barDur)) < 1e-9));
  const layerStates = bars.map((b) => JSON.stringify(b.layers));
  assert.ok(new Set(layerStates).size >= 2, 'layers build up from the first bar as intensity rises');
  // A string note may only start on an 8th of the bar grid: nothing is off the pulse.
  const spb = barDur / MUSIC.beatsPerBar;
  for (const e of events.filter((n) => n.type === 'note' && n.voice === 'string')) {
    const k = (e.t - bars[0].t) / (spb / 2);
    assert.ok(Math.abs(k - Math.round(k)) < 1e-6, `string note off the grid at ${e.t}`);
  }
});

test('intensity is smoothed: a flickering input does not flicker the layers', () => {
  const c = createConductor({ seed: 4 });
  c.setScene('battle', 0);
  let flip = false;
  let last = 0;
  let maxStep = 0;
  const events = run(c, 0, 90, (t) => {
    if (Math.round(t / 0.025) % 2 === 0) { flip = !flip; c.setIntensity(flip ? 1 : 0); }
    const x = c.getState().intensity;
    maxStep = Math.max(maxStep, Math.abs(x - last));
    last = x;
  });
  assert.ok(maxStep < 0.02, `smoothed intensity jumped by ${maxStep}`);
  const bars = events.filter((e) => e.type === 'bar' && e.layers);
  let changes = 0;
  for (let i = 1; i < bars.length; i++) if (JSON.stringify(bars[i].layers) !== JSON.stringify(bars[i - 1].layers)) changes += 1;
  assert.ok(changes <= 3, `${changes} layer changes from a 50 Hz flicker`);

  // Time constants: rise reaches ~63% in attackTau, fall is slower than rise.
  const up = smoothToward(0, 1, MUSIC.intensity.attackTauSec, MUSIC.intensity.attackTauSec, MUSIC.intensity.releaseTauSec);
  assert.ok(Math.abs(up - (1 - Math.exp(-1))) < 1e-9);
  const down = 1 - smoothToward(1, 0, MUSIC.intensity.attackTauSec, MUSIC.intensity.attackTauSec, MUSIC.intensity.releaseTauSec);
  assert.ok(down < up);
});

test('a 0 to 1 intensity ramp builds layers bar by bar', () => {
  const c = createConductor({ seed: 6 });
  c.setScene('battle', 0);
  const events = run(c, 0, 100, (t) => c.setIntensity(Math.min(1, t / 80)));
  const bars = events.filter((e) => e.type === 'bar');
  const firstCounter = bars.findIndex((b) => b.layers.counter);
  const firstEighth = bars.findIndex((b) => b.layers.eighth);
  assert.ok(firstEighth > 0 && firstCounter > firstEighth, 'ostinato speeds up before the counter-line enters');
  assert.ok(bars.slice(firstCounter).every((b) => b.layers.counter), 'and it stays once entered');
  for (let i = 1; i < bars.length; i++) assert.ok(bars[i].x >= bars[i - 1].x - 1e-9, 'x never falls on a rising ramp');
});

test('assault swell is debounced, ignores blips, and resolves on a beat with a drum', () => {
  const c = createConductor({ seed: 3 });
  c.setScene('battle', 0);
  run(c, 0, 10);
  // A 0.3 s blip does nothing.
  c.setAssault(true, 10);
  let ev = run(c, 10, 10.3);
  c.setAssault(false, 10.3);
  ev = ev.concat(run(c, 10.3, 14));
  assert.equal(ev.filter((e) => e.type === 'assault').length, 0);
  // Held: starts after the debounce.
  c.setAssault(true, 14);
  ev = run(c, 14, 20);
  const on = ev.find((e) => e.type === 'assault' && e.on);
  assert.ok(on && on.t >= 14 + MUSIC.assault.onDebounceSec - 1e-9 && on.t < 14.7);
  assert.equal(on.midis.length, 3);
  assert.ok(ev.filter((e) => e.type === 'bar' && e.assaultMidis).length >= 1, 'the chord follows the harmony');
  const grid = c.getState().grid;
  c.setAssault(false, 20);
  ev = run(c, 20, 26);
  const off = ev.find((e) => e.type === 'assault' && !e.on);
  assert.ok(off && off.t >= 20 + MUSIC.assault.offDebounceSec - 1e-9);
  const beats = (off.t - grid.t0) / grid.spb;
  assert.ok(Math.abs(beats - Math.round(beats)) < 1e-6, 'resolves on a beat');
  assert.ok(ev.some((e) => e.type === 'note' && e.voice === 'drum' && Math.abs(e.t - off.t) < 1e-9), 'lands with a drum');
});

// ------------------------------------------------------------------------ stingers

test('victory stinger: cadence lands exactly on resolveIn, on notes the fanfare already contains', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const c = createConductor({ seed });
    c.setScene('battle', 0);
    c.setIntensity(0.8);
    run(c, 0, 20);
    const info = c.stinger('victory', 20, { resolveInSec: 3 });
    assert.ok(Math.abs(info.resolveAt - 23) < 1e-9);
    const ev = run(c, 20, 40);
    const big = ev.find((e) => e.type === 'note' && e.voice === 'drum' && e.drum === 'don' && e.scene === 'stinger');
    assert.ok(Math.abs(big.t - 23) < 1e-9, 'the downbeat hit is at the requested time');
    const duck = ev.find((e) => e.type === 'duck');
    assert.ok(duck.t < 23 && duck.t > 22.9 && duck.sec >= 1.5, 'ducks under the sfx');
    const cut = ev.filter((e) => e.scene === 'battle' && e.type === 'note');
    assert.ok(cut.every((e) => e.t < 20 + 0.6 + 0.05), 'battle notes stop within a beat of the call');
    const roll = ev.filter((e) => e.voice === 'drum' && e.drum === 'tom' && e.scene === 'stinger');
    assert.ok(roll.length >= 8 && roll.every((e) => e.t < 23 && e.t >= 23 - MUSIC.stinger.approachSec));
    const gaps = roll.slice(1).map((e, i) => e.t - roll[i].t);
    assert.ok(gaps.every((g, i) => i === 0 || g <= gaps[i - 1] + 1e-9), 'the roll accelerates');
    // At and after the resolve, only fanfare-safe pitch classes sound.
    const safe = new Set(MUSIC.sfxSafePcs);
    for (const e of ev.filter((n) => n.type === 'note' && n.scene === 'stinger' && n.t >= 23 - 1e-9 && pitchesOf(n).length)) {
      for (const m of pitchesOf(e)) assert.ok(safe.has(pcOf(m)), `seed ${seed}: pc ${pcOf(m)} clashes with the C-major fanfare`);
    }
    assert.ok(victoryResolvePcs(createSong(seed)).length >= 3);
    // It hands back to the world scene at the top of a phrase.
    const back = ev.find((e) => e.type === 'scene');
    assert.equal(back.scene, 'world');
    assert.equal(back.from, 'stinger');
    assert.ok(Math.abs(back.t - (info.endAt - MUSIC.stinger.returnOverlapSec)) < 1e-9, 'the return overlaps the tail: no hole');
    const firstBar = ev.find((e) => e.type === 'bar' && e.scene === 'world');
    assert.equal(firstBar.bar % MUSIC.phraseBars, 0);
  }
});

test('defeat stinger resolves on the D-minor triad the defeat cue walks down', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const c = createConductor({ seed });
    c.setScene('battle', 0);
    run(c, 0, 20);
    c.stinger('defeat', 20);
    const ev = run(c, 20, 40);
    const stingerNotes = ev.filter((e) => e.type === 'note' && e.scene === 'stinger' && e.voice !== 'drum');
    assert.ok(stingerNotes.length >= 4);
    const dMinor = new Set(MUSIC.defeatPcs);
    for (const e of stingerNotes.filter((n) => n.voice === 'pad' || n.voice === 'string' || n.voice === 'pluck')) {
      for (const m of pitchesOf(e)) assert.ok(dMinor.has(pcOf(m)), `seed ${seed} ${e.voice} pc ${pcOf(m)}`);
    }
    const first = ev.find((e) => e.type === 'note' && e.scene === 'stinger');
    assert.ok(first.t - 20 < 0.2, 'defeat is immediate: the defeat sfx plays right away');
  }
});

test('stinger plan is pure and deterministic', () => {
  const song = createSong(9);
  assert.deepEqual(stingerPlan(song, 'victory', 1.4), stingerPlan(song, 'victory', 1.4));
  const none = stingerPlan(song, 'victory', 0);
  assert.ok(none.events.every((e) => e.dt >= -0.02), 'no lead-in when there is no time for one');
});

test('setScene during a stinger returns to the world promptly; nothing plays if not asked', () => {
  const c = createConductor({ seed: 2 });
  c.setScene('battle', 0);
  run(c, 0, 20);
  c.stinger('victory', 20, { resolveInSec: 1 });
  run(c, 20, 22);
  c.setScene('world', 22);
  const ev = run(c, 22, 40);
  const sw = ev.find((e) => e.type === 'scene');
  assert.equal(sw.scene, 'world');
  assert.ok(sw.t < 22 + 1, 'the Continue click beats the automatic return timer');
});

// -------------------------------------------------------------------------- dsp

test('pluck: in tune to a few cents, deterministic, decays, finite', () => {
  const sr = 44100;
  for (const midi of [45, 55, 62, 69, 74, 81, 86]) {
    const f = 440 * 2 ** ((midi - 69) / 12);
    const buf = renderPluck(f, sr, MUSIC.voices.pluck);
    const est = estimatePitch(buf, sr, f * 0.8, f * 1.25, 2000, 4096);
    const cents = Math.abs(1200 * Math.log2(est / f));
    assert.ok(cents < 5, `midi ${midi}: ${cents.toFixed(2)} cents off`);
    let peak = 0;
    for (const s of buf) { assert.ok(Number.isFinite(s)); peak = Math.max(peak, Math.abs(s)); }
    assert.ok(peak <= 1.0001 && peak > 0.9);
    const rms = (a, z) => Math.sqrt(buf.slice(a, z).reduce((s, v) => s + v * v, 0) / (z - a));
    assert.ok(rms(sr, sr + 4410) < rms(0, 4410) * 0.35, 'rings down');
    assert.ok(Math.abs(buf[buf.length - 1]) < 1e-6, 'ends silent, no click');
  }
  assert.deepEqual(renderPluck(220, sr, MUSIC.voices.pluck), renderPluck(220, sr, MUSIC.voices.pluck));
});

// --------------------------------------------------------------------------- engine

test('inert until unlock: no AudioContext, no nodes, no timer; calls are remembered and applied', () => {
  const sfx = fakeSfx();
  const timer = timerSpy();
  const music = createMusic(sfx, { timer, volume: 0.42 });
  music.setSeed(1234);
  music.setVolume(0.5);
  music.setIntensity(0.9);
  music.setAssault(true);
  music.setScene('world');
  music.setScene('battle');
  music.setPaused(true);
  music.setPaused(false);
  assert.equal(music.stinger('victory'), null, 'a one-shot cue before unlock is dropped');
  assert.equal(sfx.contextsCreated, 0);
  assert.equal(timer.sets, 0, 'no timer before unlock');
  assert.equal(music.getDebug().started, false);

  sfx.unlock();
  const dbg = music.getDebug();
  assert.equal(dbg.started, true);
  assert.equal(sfx.contextsCreated, 1, 'music reuses the sfx context, never its own');
  assert.equal(timer.sets, 1);
  assert.equal(music.getKey().id, createSong(1234).key.id, 'seed remembered');
  assert.equal(dbg.pending?.kind, 'battle', 'last scene remembered');
  const outGain = sfx.bus.inputs.find((n) => n.kind === 'gain');
  assert.equal(outGain.gain.value, 0.5, 'volume remembered');

  stepMusic(sfx, music, 4);
  assert.equal(music.getDebug().scene, 'battle');
  assert.equal(music.getDebug().errors, 0);
  assert.ok(sfx.ctx.live.size > 20);
  music.destroy();
});

test('music never creates an AudioContext of its own and needs no unlock() call from the caller', () => {
  const sfx = fakeSfx();
  sfx.unlock(); // the game unlocks on the first gesture; music is created after or before
  const music = createMusic(sfx, { manual: true });
  assert.equal(music.getDebug().started, true, 'onUnlock fires immediately when the context already exists');
  assert.equal(sfx.contextsCreated, 1);
  music.destroy();
});

test('master mute stops new voices; unmute resumes; volume and pause drive the output gain', () => {
  const sfx = fakeSfx();
  const music = createMusic(sfx, { manual: true });
  sfx.unlock();
  music.setScene('world');
  stepMusic(sfx, music, 6);
  const outGain = sfx.bus.inputs.find((n) => n.kind === 'gain');
  assert.equal(outGain.gain.value, MUSIC.defaultVolume);
  assert.ok(music.getDebug().activeVoices > 0);

  sfx.muted = true;
  stepMusic(sfx, music, 30); // any voice alive at the moment of muting ends and is reaped
  assert.equal(music.getDebug().activeVoices, 0, 'nothing is scheduled while muted');
  sfx.muted = false;
  stepMusic(sfx, music, 20);
  assert.ok(music.getDebug().activeVoices > 0, 'the score picks up again');

  music.setPaused(true);
  assert.equal(outGain.gain.value, 0);
  const created = sfx.ctx.stats.created;
  stepMusic(sfx, music, 3);
  assert.equal(sfx.ctx.stats.created, created, 'paused: the scheduler creates nothing');
  music.setPaused(false);
  assert.equal(outGain.gain.value, MUSIC.defaultVolume);
  stepMusic(sfx, music, 10);
  assert.ok(sfx.ctx.stats.created > created);
  music.setVolume(0.7);
  assert.equal(outGain.gain.value, 0.7);
  music.setVolume(7);
  assert.equal(outGain.gain.value, 1, 'clamped');
  assert.equal(music.getDebug().errors, 0);
  music.destroy();
});

test('a paused tab resumes on the same bar grid (the gap is skipped, not replayed)', () => {
  const sfx = fakeSfx();
  const music = createMusic(sfx, { manual: true });
  sfx.unlock();
  music.setScene('world');
  stepMusic(sfx, music, 10);
  music.setPaused(true);
  sfx.ctx.currentTime += 600; // ten minutes in a background tab
  music.setPaused(false);
  const before = sfx.ctx.stats.created;
  stepMusic(sfx, music, 8);
  assert.ok(sfx.ctx.stats.created - before < 400, 'no burst of catch-up notes');
  assert.equal(music.getDebug().errors, 0);
  assert.equal(music.getDebug().scene, 'world');
  music.destroy();
});

test('a new seed takes effect at a phrase line without breaking the bar grid', () => {
  const c = createConductor({ seed: 1 });
  c.setScene('world', 0);
  run(c, 0, 20);
  c.setSong(createSong(99));
  const ev = run(c, 20, 80);
  const song = ev.find((e) => e.type === 'song');
  assert.ok(song, 'the key change is announced');
  const bar = ev.find((e) => e.type === 'bar' && Math.abs(e.t - song.t) < 1e-9);
  assert.equal(bar.bar % MUSIC.phraseBars, 0);
  assert.equal(song.key.id, createSong(99).key.id);
});

test('no node leak over a simulated hour of everything the game can throw at it', () => {
  const sfx = fakeSfx();
  const music = createMusic(sfx, { manual: true });
  sfx.unlock();
  const rng = createRng(20260929);
  const scenes = ['title', 'world', 'battle'];
  let nextAction = 5;
  let mutedUntil = 0;
  let maxLive = 0;
  let maxVoices = 0;
  let maxSources = 0;
  const liveAt = [];
  const ticks = Math.round(3600 / 0.025);
  for (let i = 0; i < ticks; i++) {
    const ctx = sfx.ctx;
    ctx.currentTime += 0.025;
    if (ctx.currentTime >= nextAction) {
      nextAction += 6 + rng.next() * 50;
      const r = rng.next();
      if (r < 0.3) music.setScene(rng.pick(scenes));
      else if (r < 0.5) music.setIntensity(rng.next());
      else if (r < 0.65) music.setAssault(rng.chance(0.6));
      else if (r < 0.75) music.stinger(rng.chance(0.5) ? 'victory' : 'defeat', { resolveInSec: rng.next() * 4 });
      else if (r < 0.8) music.setSeed(Math.floor(rng.next() * 1e6));
      else if (r < 0.85) { music.setPaused(true); ctx.currentTime += rng.next() * 30; music.setPaused(false); }
      else if (r < 0.9) { sfx.muted = true; mutedUntil = ctx.currentTime + 5 + rng.next() * 15; }
      else music.setVolume(rng.next());
    }
    if (sfx.muted && ctx.currentTime >= mutedUntil) sfx.muted = false;
    music.tick();
    if (i % 200 === 0) {
      maxLive = Math.max(maxLive, ctx.live.size);
      maxVoices = Math.max(maxVoices, music.getDebug().activeVoices);
      let running = 0;
      for (const n of ctx.live) {
        if ((n.kind === 'osc' || n.kind === 'bufsrc') && n.started && (n.stopAt === undefined || n.stopAt > ctx.currentTime)) running += 1;
      }
      maxSources = Math.max(maxSources, running);
      if (i % 24000 === 0) liveAt.push(ctx.live.size);
    }
  }
  const dbg = music.getDebug();
  assert.equal(dbg.errors, 0);
  assert.equal(sfx.ctx.stats.premature, 0, 'no source was cut off or left running when disconnected');
  assert.ok(sfx.ctx.stats.created > 12000, `only ${sfx.ctx.stats.created} nodes created: the hour did not exercise the engine`);
  assert.ok(maxLive < 700, `peak live nodes ${maxLive}`);
  assert.ok(maxVoices < 120, `peak voices ${maxVoices}`);
  assert.ok(maxSources < 90, `peak simultaneous oscillators + buffer sources ${maxSources}`);
  assert.ok(dbg.pluckBuffers <= MUSIC.voices.pluck.cacheMax);
  // Live count does not creep upward hour over time (compare early and late samples).
  const early = Math.max(...liveAt.slice(0, 3));
  const late = Math.max(...liveAt.slice(-3));
  assert.ok(late <= early + 250, `live nodes crept from ${early} to ${late}`);
  console.log(`# hour: created ${sfx.ctx.stats.created} nodes, peak live ${maxLive}, peak voices ${maxVoices}, peak running sources ${maxSources}, plucks cached ${dbg.pluckBuffers}`);

  music.destroy();
  assert.equal(sfx.ctx.live.size, sfx.bus ? 1 + 1 : 0, 'only the sfx bus and destination survive destroy()');
  assert.doesNotThrow(() => { music.setScene('world'); music.setIntensity(1); music.tick(); music.destroy(); });
});

// ------------------------------------------------------- battle state -> music inputs

test('battleIntensity: calm opening, hot melee, zero once decided', () => {
  const site = (owner, troops, type = 'village', assault = null) => ({ owner, troops, type, assault });
  const calm = { result: null, sites: [site(0, 30, 'camp'), site(2, 120, 'keep')], squads: [] };
  const melee = {
    result: null,
    sites: [site(0, 30, 'camp'), site(2, 30, 'keep'), site(2, 12)],
    squads: [
      { owner: 0, count: 40, state: 'fight' }, { owner: 2, count: 38, state: 'fight' },
      { owner: 0, count: 25, state: 'assault' }, { owner: 2, count: 20, state: 'march' },
      { owner: 0, count: 15, state: 'march' },
    ],
  };
  const lopsided = { ...melee, squads: melee.squads.map((q) => (q.owner === 2 ? { ...q, count: 1 } : { ...q, count: 90 })) };
  assert.ok(battleIntensity(calm) < 0.25, `calm ${battleIntensity(calm)}`);
  assert.ok(battleIntensity(melee) > 0.8, `melee ${battleIntensity(melee)}`);
  assert.ok(battleIntensity(lopsided) < battleIntensity(melee), 'a rout is less tense than an even fight');
  assert.equal(battleIntensity({ ...melee, result: 'win' }), 0);
  assert.equal(battleIntensity(null), 0);
  const keepSiege = { ...calm, sites: [site(0, 30, 'camp'), site(2, 120, 'keep', { owner: 0, squads: [1] })] };
  assert.equal(battleAssault(keepSiege), true);
  const villageSiege = { ...calm, sites: [site(0, 30, 'camp'), site(2, 20, 'village', { owner: 0, squads: [1] })] };
  assert.equal(battleAssault(villageSiege), false, 'a village siege is not a keep siege');
  assert.equal(battleAssault({ ...keepSiege, result: 'win' }), false);
});

test('battleIntensity on real simulated battles stays in range and tells the story of the fight', () => {
  for (const [mult, troopMult, personality] of [[1.0, 3, 'aggressive'], [0.7, 2.5, 'defensive'], [1.0, 4, 'swarm']]) {
    const world = buildTestWorld();
    const player = {
      atk: mult, def: mult, growth: mult, speed: 1, campTroops: 30, garrisonShare: 0.35, capBonus: 0,
      cooldownMult: 1, powers: { rally: 1, firestorm: 1, bulwark: 1, march: 1, levy: 1 },
    };
    const enemy = { atk: 1, def: 1, growth: 1, speed: 1, troopMult, thinkSec: 1.5, personality, factionId: 2 };
    const battle = createBattle(buildArena(world, [...DEFAULT_OWNERS], TARGET_REGION, player, enemy), player, enemy);
    const memo = {};
    const series = [];
    let assaultSeconds = 0;
    for (let i = 0; i < 6000 && !battle.result; i++) {
      for (const cmd of think(battle, battle.t)) issue(battle, cmd);
      for (const cmd of decide(battle, battle.t, memo)) issue(battle, cmd);
      step(battle, 0.05);
      if (i % 20 === 0 && !battle.result) {
        const x = battleIntensity(battle);
        assert.ok(Number.isFinite(x) && x >= 0 && x <= 1);
        series.push(x);
        if (battleAssault(battle)) assaultSeconds += 1;
      }
    }
    // Only a precondition for the story checks below; battle length itself is balance's call.
    assert.ok(series.length >= 10, `${personality}: battle lasted ${series.length} s`);
    assert.ok(series[0] < 0.35, `${personality}: opens calm (${series[0].toFixed(2)})`);
    assert.ok(Math.max(...series) > 0.55, `${personality}: peaks at ${Math.max(...series).toFixed(2)}`);
    assert.ok(new Set(series.map((v) => v.toFixed(1))).size >= 4, 'it actually moves through the range');
    if (battle.result === 'win') assert.ok(assaultSeconds > 0, 'a won battle has a keep siege the swell can follow');
    if (battle.result) assert.equal(battleIntensity(battle), 0);
  }
});
