// Pure stinger plans: the cadence that closes a battle and hands over to the `victory` /
// `defeat` sound effects in game/audio/cues.js.
//
//   victory sfx  C5 E5 G5 C6 arpeggio, then a C6-E6-G6 chord (C major, ~1.5 s)
//   defeat sfx   A4 F4 D4 walking down (a D-minor triad, ~1.05 s)
//
// So the victory resolve is built ONLY from pitch classes the C-major fanfare already
// contains or blends with (config sfxSafePcs = C D E G A): tonic + fifth + a colour tone, no
// F, no B. The lead-in is the modal bVII chord (the "Mixolydian" cadence, degree 6 in all
// three modes), which is C / F / G major in D dorian / G mixolydian / A aeolian.
// The defeat resolve is the D-minor triad itself, so the sting and the music agree note for
// note. Times are relative to the resolve moment `T` (negative = the approach).
import { MUSIC } from '../config/music.js';
import { chordAt, midiAtOrAbove, padVoicing } from './musicTheory.js';

/** Ascending stack of pitch classes above `lo`, each note above the previous one. */
export function stackAbove(pcs, lo) {
  const out = [];
  let prev = lo - 1;
  for (const pc of pcs) {
    let m = midiAtOrAbove(pc, prev + 1);
    if (out.length && m - prev < 3) m += 12; // avoid a minor-second cluster
    out.push(m);
    prev = m;
  }
  return out;
}

/** Pitch classes of the victory resolve chord for this song's key (subset of sfxSafePcs). */
export function victoryResolvePcs(song, cfg = MUSIC) {
  const t = song.key.tonicPc;
  const at = (n) => (t + song.steps[n]) % 12;
  const candidates = [t, (t + 7) % 12, at(1), at(2), at(5)];
  const safe = candidates.filter((pc, i) => cfg.sfxSafePcs.includes(pc) && candidates.indexOf(pc) === i);
  return safe.slice(0, 3);
}

/**
 * @param {'victory'|'defeat'} kind
 * @param {number} approachSec how much lead-in there is before the resolve (0 = none)
 * @returns {{events: object[], tailSec: number}}
 */
export function stingerPlan(song, kind, approachSec, cfg = MUSIC) {
  const st = cfg.stinger;
  const ev = [];
  const lo = st.padRange[0];
  const tailSec = st.tailSec[kind];
  ev.push({ dt: -0.02, type: 'duck', depth: st.duck[kind].depth, sec: st.duck[kind].sec });

  if (kind === 'victory') {
    if (approachSec >= st.minApproachSec) {
      const chord = chordAt(song, 6);
      ev.push({ dt: -approachSec, voice: 'pad', midis: padVoicing(song, chord, [lo]), dur: approachSec + 0.4, vel: 0.8, attack: 0.5 });
      ev.push({ dt: -approachSec, voice: 'string', midi: midiAtOrAbove(chord.rootPc, cfg.battle.stringRange[0]), dur: approachSec + 0.05, vel: 0.9, release: 0.3 });
      const n = st.rollHits;
      const span = approachSec * 0.87;
      for (let k = 0; k < n; k++) {
        const u = k / n;
        ev.push({ dt: -approachSec * 0.92 + span * (1 - (1 - u) ** 1.7), voice: 'drum', drum: 'tom', vel: 0.25 + 0.6 * u });
      }
    }
    const pcs = victoryResolvePcs(song, cfg);
    const stack = stackAbove(pcs, lo);
    ev.push({ dt: 0, voice: 'drum', drum: 'don', vel: 1 });
    ev.push({ dt: 0, voice: 'drum', drum: 'boom', vel: 0.9 });
    ev.push({ dt: 0, voice: 'pad', midis: stack, dur: tailSec - 1.2, vel: 0.85, attack: 0.25 });
    ev.push({ dt: 0, voice: 'string', midi: midiAtOrAbove(pcs[0], cfg.battle.stringRange[0]), dur: tailSec - 2.6, vel: 0.95, release: 1.5 });
    const harp = [stack[0] + 12, stack[1] + 12, stack[2] + 12, stack[0] + 24];
    st.victoryHarp.forEach((dt, i) => ev.push({ dt, voice: 'pluck', midi: harp[i], vel: 0.62 - i * 0.04, jit: 0 }));
  } else {
    const stack = stackAbove(cfg.defeatPcs, lo);
    ev.push({ dt: 0.02, voice: 'drum', drum: 'don', vel: 0.55 });
    ev.push({ dt: 1.1, voice: 'drum', drum: 'don', vel: 0.3 });
    ev.push({ dt: 0, voice: 'pad', midis: stack, dur: tailSec - 1.5, vel: 0.85, attack: 1.0 });
    ev.push({ dt: 0, voice: 'string', midi: midiAtOrAbove(cfg.defeatPcs[0], cfg.battle.stringRange[0]), dur: tailSec - 2.7, vel: 0.85, release: 1.5 });
    ev.push({ dt: 1.5, voice: 'pluck', midi: stack[0] + 12, vel: 0.5, jit: 0 });
    ev.push({ dt: 2.3, voice: 'pluck', midi: stack[2], vel: 0.42, jit: 0 });
    ev.push({ dt: 1.35, voice: 'lead', midi: stack[2] + 12, dur: 2.3, vel: 0.4 });
  }
  return { events: ev, tailSec };
}
