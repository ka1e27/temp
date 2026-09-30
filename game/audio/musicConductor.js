// The pure brain of the score: a deterministic timeline that turns "what the game wants"
// (scene, intensity, assault, stinger, seed) into a time-ordered stream of plain event
// objects. It knows nothing about WebAudio. game/audio/music.js feeds it ctx.currentTime
// and renders whatever comes out; tests drive it with a fake clock.
//
// Time model: the music is a series of SEGMENTS. A segment (title / world / battle) is a bar
// grid `t0 + k * barDur`. A scene change is only ever started on a bar line of the segment
// that is playing, and the new segment's own grid begins exactly there, so scenes always
// change on a downbeat. Layer/intensity decisions are made once per bar at the bar line.
//
// Events (all carry `t`, absolute seconds on the caller's clock):
//   scene  {scene|null, from, fadeIn, fadeOut}      crossfade the scene buses
//   bus    {scene, to, dur}                         fade one scene bus (stingers)
//   bar    {scene, bar, phrase, bip, x, layers, dur, assaultMidis}   bar line; mix automation
//   note   {scene, voice, dur, midi|midis, vel, drum?, attack?, bass?}
//   assault{on, midis?}                             swell begins / resolves
//   duck   {depth, sec}                             dip the whole music bus under a sfx
//   song   {key}                                    a new seed took effect at a phrase line
import { MUSIC } from '../config/music.js';
import {
  barSeconds, clamp01, createSong, firstBarLineAtOrAfter, firstBeatAtOrAfter, hysteresis, smoothToward,
} from './musicTheory.js';
import { assaultChord, nextBattleLayers, planBattleBar, planWorldBar } from './musicPatterns.js';
import { stingerPlan } from './musicStinger.js';

/**
 * @param {{config?: object, seed?: number, song?: object, startBar?: number}} [opts]
 */
export function createConductor(opts = {}) {
  const cfg = opts.config ?? MUSIC;
  let song = opts.song ?? createSong(opts.seed ?? cfg.defaultSeed, cfg);
  let pendingSong = null;
  let seg = null; // { kind, t0, bpm, spb, barDur, barBase, nextBar } | { kind: 'stinger', ... } | null
  let pending = null; // { kind|null, at, auto? }
  let queue = [];
  let nextGlobalBar = opts.startBar ?? 0;
  let x = 0;
  let xTarget = 0;
  let lastNow = null;
  let layers = { quarter: false, eighth: false, counter: false };
  let forceStart = false; // re-emit pad/drone on the next bar (after a pause killed them)
  const assault = { target: false, since: 0, on: false };

  const isMusical = () => seg !== null && seg.kind !== 'stinger';
  const push = (e) => { queue.push(e); };

  function makeSeg(kind, t0, barBase) {
    const bpm = cfg.scenes[kind].bpm * song.tempoScale;
    const spb = 60 / bpm;
    return { kind, t0, bpm, spb, barDur: barSeconds(bpm, cfg.beatsPerBar), barBase, nextBar: 0 };
  }

  // --- public setters ------------------------------------------------------------------

  function setIntensity(v) {
    xTarget = clamp01(Number.isFinite(v) ? v : 0);
  }

  function setAssault(v, now) {
    const b = !!v;
    if (b !== assault.target) { assault.target = b; assault.since = now; }
  }

  /** Request a scene. It starts on the next bar line (see file header). `null` = fade to silence. */
  function setScene(kind, now) {
    if (kind !== null && !cfg.scenes[kind]) return;
    const cur = isMusical() ? seg.kind : null;
    if (pending && pending.kind === kind && !pending.auto) return;
    if (!pending && cur === kind) return;
    if (pending && !pending.auto && cur === kind) { pending = null; return; } // changed our mind
    let at;
    if (!seg) at = now + cfg.startLeadSec;
    else if (seg.kind === 'stinger') at = Math.max(now + cfg.minSwitchLeadSec, seg.resolveAt);
    else at = firstBarLineAtOrAfter(seg.t0, seg.barDur, now + cfg.minSwitchLeadSec);
    pending = { kind, at };
  }

  /** A new seed takes effect at the next phrase line (immediately when nothing is playing). */
  function setSong(next) {
    if (!seg) { song = next; pendingSong = null; } else pendingSong = next;
  }

  /**
   * Resolve the battle music into a cadence. `resolveInSec` is when the cadence lands,
   * so the caller can line it up with the `victory` sfx (defaults in config).
   * @returns {{resolveAt: number, endAt: number}|null}
   */
  function stinger(kind, now, o = {}) {
    if (kind !== 'victory' && kind !== 'defeat') return null;
    const st = cfg.stinger;
    if (seg && seg.kind === 'stinger' && seg.stingerKind === kind && now < seg.endAt) {
      return { resolveAt: seg.resolveAt, endAt: seg.endAt }; // a repeated call is a no-op
    }
    queue = queue.filter((e) => e.scene !== 'stinger' && e.type !== 'duck'); // a different stinger replaces the old one
    const resolveIn = Math.max(0.03, o.resolveInSec ?? st.defaultResolveSec[kind]);
    const T = now + resolveIn;
    const approach = kind === 'victory' ? Math.min(st.approachSec, resolveIn - 0.05) : 0;
    let cut = now + 0.05;
    let fromScene = null;
    if (isMusical()) {
      fromScene = seg.kind;
      cut = Math.min(firstBeatAtOrAfter(seg.t0, seg.spb, now + 0.05), T);
      nextGlobalBar = seg.barBase + seg.nextBar;
    }
    queue = queue.filter((e) => !(e.t >= cut && (e.type === 'note' || e.type === 'bar' || e.type === 'assault')));
    if (assault.on) { assault.on = false; push({ type: 'assault', t: now, on: false }); }
    assault.target = false;
    if (fromScene) {
      const hold = kind === 'victory' ? 0.4 : 0;
      push({ type: 'bus', t: now, scene: fromScene, to: hold, dur: approach >= st.minApproachSec ? approach : st.battleFadeSec });
      if (kind === 'victory') push({ type: 'bus', t: T, scene: fromScene, to: 0, dur: st.battleFadeSec });
    }
    push({ type: 'bus', t: now, scene: 'stinger', to: 1, dur: 0.05 });
    const plan = stingerPlan(song, kind, approach, cfg);
    for (const e of plan.events) {
      const t = Math.max(now, T + e.dt);
      if (e.type === 'duck') push({ type: 'duck', t, depth: e.depth, sec: e.sec });
      else {
        const { dt, ...rest } = e;
        push({ type: 'note', t, scene: 'stinger', ...rest });
      }
    }
    const endAt = T + plan.tailSec;
    seg = { kind: 'stinger', t0: now, resolveAt: T, endAt, stingerKind: kind };
    pending = st.autoReturnScene ? { kind: st.autoReturnScene, at: endAt - st.returnOverlapSec, auto: true } : null;
    queue.sort((a, b) => a.t - b.t);
    return { resolveAt: T, endAt };
  }

  // --- the timeline --------------------------------------------------------------------------

  function startSegment(p) {
    const prev = seg;
    const t0 = p.at;
    const kind = p.kind;
    const fadeIn = !kind ? 0 : prev && prev.kind === 'stinger' ? cfg.stinger.returnFadeSec : cfg.scenes[kind].crossfadeSec;
    let fadeOut = 1;
    if (prev && prev.kind !== 'stinger') {
      nextGlobalBar = prev.barBase + prev.nextBar;
      fadeOut = kind ? fadeIn : cfg.scenes[prev.kind].crossfadeSec;
    } else if (prev) {
      // After a stinger the score returns at the top of a phrase: home chord first.
      nextGlobalBar = Math.ceil(nextGlobalBar / cfg.phraseBars) * cfg.phraseBars;
    }
    push({ type: 'scene', t: t0, scene: kind, from: prev ? prev.kind : null, fadeIn, fadeOut });
    if (kind === 'battle') layers = { quarter: false, eighth: false, counter: false };
    seg = kind ? makeSeg(kind, t0, nextGlobalBar) : null;
    pending = null;
  }

  function currentBar(now) {
    return seg.barBase + Math.max(0, Math.floor((now - seg.t0) / seg.barDur + 1e-9));
  }

  function genBar(barStart) {
    const gb = seg.barBase + seg.nextBar;
    const phraseIdx = Math.floor(gb / cfg.phraseBars);
    const bip = gb - phraseIdx * cfg.phraseBars;
    if (pendingSong && bip === 0) {
      song = pendingSong;
      pendingSong = null;
      seg = makeSeg(seg.kind, barStart, gb); // tempo may differ: restart the grid on this bar line
      push({ type: 'song', t: barStart, key: { ...song.key } });
    }
    const segmentStart = seg.nextBar === 0 || forceStart;
    forceStart = false;
    let notes;
    const bar = { type: 'bar', t: barStart, scene: seg.kind, bar: gb, phrase: phraseIdx, bip, dur: seg.barDur };
    if (seg.kind === 'battle') {
      const xe = clamp01(x + (assault.on ? cfg.assault.intensityBoost : 0));
      layers = nextBattleLayers(layers, xe, hysteresis, cfg);
      bar.x = xe;
      bar.layers = { ...layers };
      if (assault.on) bar.assaultMidis = assaultChord(song, gb, cfg);
      notes = planBattleBar(song, gb, xe, layers, { segmentStart }, cfg);
    } else {
      bar.x = 0;
      bar.layers = null;
      notes = planWorldBar(song, seg.kind, gb, { segmentStart }, cfg);
    }
    push(bar);
    for (const n of notes) {
      const { beat, durBeats, jit, ...rest } = n;
      const ev = { type: 'note', t: Math.max(barStart, barStart + beat * seg.spb + (jit ?? 0)), scene: seg.kind, ...rest };
      if (durBeats !== undefined) ev.dur = durBeats * seg.spb;
      push(ev);
    }
  }

  function updateAssault(now) {
    if (!isMusical() || seg.kind !== 'battle') {
      if (assault.on) { assault.on = false; push({ type: 'assault', t: now, on: false }); }
      return;
    }
    if (assault.target === assault.on) return;
    const held = now - assault.since;
    if (assault.target) {
      if (held < cfg.assault.onDebounceSec) return;
      assault.on = true;
      push({ type: 'assault', t: now, on: true, midis: assaultChord(song, currentBar(now), cfg) });
    } else {
      if (held < cfg.assault.offDebounceSec) return;
      assault.on = false;
      const t = firstBeatAtOrAfter(seg.t0, seg.spb, now + 0.05);
      push({ type: 'assault', t, on: false });
      push({ type: 'note', t, scene: 'battle', voice: 'drum', drum: 'don', vel: 0.8 }); // the swell lands on a beat
    }
  }

  function shiftTime(dt) {
    if (seg) {
      seg.t0 += dt;
      if (seg.kind === 'stinger') { seg.resolveAt += dt; seg.endAt += dt; }
    }
    if (pending) pending.at += dt;
    for (const e of queue) e.t += dt;
    assault.since += dt;
  }

  /**
   * Advance to `now` and return every event with `t < horizon`, in time order.
   * @returns {object[]}
   */
  function advance(now, horizon) {
    if (lastNow !== null && now - lastNow > cfg.stallSec) {
      shiftTime(now - lastNow); // a throttled/hidden tab: skip the gap, keep bar phase
      lastNow = now;
    }
    if (lastNow !== null) x = smoothToward(x, xTarget, now - lastNow, cfg.intensity.attackTauSec, cfg.intensity.releaseTauSec);
    lastNow = now;
    updateAssault(now);

    for (let guard = 0; guard < 256; guard++) {
      if (!isMusical()) {
        if (pending && pending.at < horizon) { startSegment(pending); continue; }
        break;
      }
      const barStart = seg.t0 + seg.nextBar * seg.barDur;
      if (barStart >= horizon) break;
      if (pending && pending.at <= barStart + 1e-9) { startSegment(pending); continue; }
      genBar(barStart);
      seg.nextBar++;
    }

    queue.sort((a, b) => a.t - b.t);
    let n = 0;
    while (n < queue.length && queue[n].t < horizon) n++;
    return queue.splice(0, n);
  }

  /** The engine calls this when it un-pauses: its voices were cut, so re-state the chord. */
  function resume() {
    forceStart = true;
  }

  function getState() {
    return {
      scene: seg ? seg.kind : null,
      pending: pending ? { ...pending } : null,
      intensity: x,
      layers: { ...layers },
      assault: assault.on,
      key: song.key.id,
      queued: queue.length,
      grid: isMusical() ? { t0: seg.t0, barDur: seg.barDur, spb: seg.spb, nextBar: seg.nextBar, barBase: seg.barBase } : null,
    };
  }

  return {
    setScene, setIntensity, setAssault, setSong, stinger, advance, resume, getState,
    getSong: () => song,
  };
}
