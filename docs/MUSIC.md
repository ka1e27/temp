# Hex Dominion 2 — Music

A generative, fully synthesised score (no asset files). It shares the `AudioContext` and the master
gain of `createSfx()`, so the master volume and the master mute cover music and sound effects alike.
This file is the hookup guide for integration; `game/config/music.js` holds every tuning number.

```
game/config/music.js          every tempo, key, progression, threshold, mix level, stinger time
game/audio/music.js           createMusic(sfx, opts): scheduler + WebAudio graph (the only browser part)
game/audio/musicTheory.js     scales, chords, seeded song (key/mode/motifs), timing maths        (pure)
game/audio/musicPatterns.js   seeded per-bar note generation for title / world / battle          (pure)
game/audio/musicConductor.js  the timeline: scene changes on bar lines, layers, assault, stingers (pure)
game/audio/musicStinger.js    victory / defeat cadence plans                                      (pure)
game/audio/musicIntensity.js  battleIntensity(battle), battleAssault(battle)                      (pure)
game/audio/musicDsp.js        Karplus-Strong pluck, seeded noise, reverb impulse response         (pure)
game/audio/musicVoices.js     WebAudio voice builders (pad, harp, recorder, drums, strings, ...)
game/tests/audio.music.test.js
tools/gallery/music.html|js   audition page (live) + offline render entry point
tools/musicrender.mjs         renders WAVs to screenshots/audio/ and measures them
```

## 1. API

```js
import { createMusic } from './audio/music.js';
import { battleIntensity, battleAssault } from './audio/musicIntensity.js';

const music = createMusic(sfx, { seed, volume });   // sfx = the game's createSfx()
```

| call | meaning |
|---|---|
| `setScene('title' \| 'world' \| 'battle' \| null)` | Crossfade to that bed. Starts on the **next bar line** of the bed that is playing (never sooner than 0.4 s, never later than one bar + 0.4 s), fades 1.8 s (battle) / 2.6 s (title, world). `null` fades to silence. Same scene again is a no-op. |
| `setIntensity(0..1)` | Battle energy. Call every frame if you like: it is smoothed (rises with a 2.2 s time constant, falls with 5.5 s), and layers only change on bar lines with hysteresis. |
| `setAssault(bool)` | A keep or War Camp is under siege. Debounced (must hold 0.5 s to start, 1.0 s to stop), so pass the raw per-frame value. Starts a 7.5 s rising tremolo swell; when it ends the swell fades over 1.6 s and a soft drum lands on the next beat. |
| `stinger('victory' \| 'defeat', { resolveInSec })` | Resolves the battle music into a cadence that lands **exactly** `resolveInSec` from now (default 3.0 victory, 0.05 defeat). Returns `{ resolveInSec, tailSec }`, or `null` if inert or paused. Afterwards the score returns to `world` by itself (3.2 s after a victory resolve, 3.7 s after a defeat, crossfading over the end of the tail) unless `setScene` comes first. A repeated call for the same stinger while it plays is a no-op. |
| `setSeed(seed)` | Key, mode, progression order, tempo offset and motifs for this dynasty. Takes effect at the next phrase line (about 20-30 s) so a key change is never abrupt. |
| `setVolume(0..1)` | The music's own volume under master. Default **0.4**. `0` stops scheduling entirely (no nodes, no CPU). |
| `setPaused(bool)` | Tab hidden: stops the scheduler, cuts every voice and mutes the output. Un-pausing resumes on the same bar grid (the gap is skipped, not replayed). |
| `destroy()` | Stops everything and disconnects every node. Later calls are no-ops. |
| `getKey()` | `{ id, tonicPc, mode, bpm: { title, world, battle } }` for the current song (for a settings/debug readout). |
| `getDebug()` | Scene, pending scene, smoothed intensity, layers, active voices, peak voices, error count. |
| `tick()` | One scheduling pass. The timer calls it; only offline rendering and tests call it. |

`opts`: `seed` (default 1), `volume` (default 0.4), `reverb` (default `true`; pass `false` to save CPU on
weak devices), `startPhrase` (default 0; start at another phrase so two sessions of one dynasty do not
open identically), plus `manual` / `ignoreState` / `timer` / `only` for tools and tests.

**Inert until unlock.** `createMusic` never creates an `AudioContext`, starts no timer and touches no
node until `sfx.unlock()` has run (the game already does that on the first `pointerdown` / `keydown`).
Every call made before that is remembered (scene, intensity, assault, seed, volume, paused) and applied
at unlock. The one exception is `stinger()`: a one-shot cue is meaningless later, so it is dropped.
While `sfx` is muted, or the music volume is 0, the timeline keeps running but no voices are
created, so a muted idle game costs almost nothing.

## 2. Hookup (what integration does)

### 2.1 Create it (`game/main.js`)

Right after `const sfx = createSfx();` (the existing `unlockOnce` listeners stay as they are):

```js
import { createMusic } from './audio/music.js';
import { battleIntensity, battleAssault } from './audio/musicIntensity.js';

const music = createMusic(sfx, { seed: bootState.seed });
applyMusicSettings(bootState);                       // below

function applyMusicSettings(s) {
  music.setVolume(s.settings.music ? s.settings.musicVolume : 0);
}
```

Call `applyMusicSettings(state)` from `applySettings(s)` (it already runs from `applyWorld()`), and add
`music.setSeed(state.seed)` to `applyWorld()` so boot, import, reset and a new dynasty all re-key the
score. Add `music` to the `services` object so scenes can reach it (`services.music`).

### 2.2 Scene transitions

The cheapest correct hookup is to wrap the three `goto` functions in `main.js`; every scene change in
the game goes through them:

```js
const goto = {
  title:  (p) => { music.setScene('title');  sceneManager.goto('title',  titleScene,  p); },
  world:  (p) => { music.setScene('world');  sceneManager.goto('world',  worldScene,  p); },
  battle: (p) => { music.setScene('battle'); sceneManager.goto('battle', battleScene, p); },
};
```

| moment | call |
|---|---|
| boot into title / Continue / New Realm / import / reset | `goto.*` above (title music only plays if the first gesture leaves you on the title; a click on *Continue* replaces it with `world` before it ever starts) |
| **Attack** clicked (`worldScene.onAttack` → `goto.battle`) | `setScene('battle')` via the wrapper. The bed switches on the next world bar line (0.4-3.9 s), while the camera is still flying in |
| Resume of a saved battle (`goto.battle({resume:true})`) | same wrapper |
| **Try again** (`battleScene.onRetry` → `startBattle`) | add `services.music.setScene('battle')` at the top of `startBattle` (the wrapper is not on that path) |
| **Retreat** (`beginEndSequence` with `result` other than win / lose) | `music.setScene('world')`: a plain crossfade, no stinger |
| Continue / Back to map (`goto.world`) | the wrapper; harmless if the stinger's automatic return already happened |

### 2.3 Intensity and assault (`game/scenes/battle.js`, once per frame while `phase === 'live'`)

```js
music.setIntensity(battleIntensity(battle));
music.setAssault(battleAssault(battle));
```

`battleIntensity` (game/audio/musicIntensity.js, weights in `MUSIC.intensityModel`) is

```
field   = clamp01( troopsInSquads / totalTroops / 0.25 )      troops marching, all owners
contact = clamp01( squadsFighting or assaulting / 3 )
balance = 1 - |playerTroops - otherTroops| / (playerTroops + otherTroops)      1 = an even fight
I = 0.10 + 0.30*field + 0.35*contact + 0.27*balance*(0.35 + 0.65*max(contact, field))
```

with `troopsInSquads` from `battle.squads[].count`, contact from `squads[].state` (`'fight'`,
`'assault'`), site troops from `battle.sites[].troops`, player = `owner === 0`. It returns 0 once
`battle.result` is set. On simulated battles a standoff reads 0.1-0.3, an active fight 0.4-0.7 and a
full melee 0.8-0.95.

`battleAssault` is true while any `battle.sites[]` entry of type `keep` or `camp` has a non-null
`assault` (the enemy keep under your siege, or your War Camp / a keep of yours under theirs), and
`battle.result` is empty.

Pausing the battle (Space) or 2x/3x speed need no music calls: the score runs on wall-clock time, and
the intensity input simply stops changing while the sim is frozen.

### 2.4 Stingers (against PLAYFEEL §3 and the existing `victory` / `defeat` cues)

`beginEndSequence(result)` in `battle.js` is where both go.

**Victory.** The `end` event fires at the start of the ~3 s sequence (capture, 250 ms hit-stop,
surrender cascade, flood). The existing code plays `sfx.play('victory')` when the flood is done
(`doneAt`). Tell the score when that will be, at the moment the sequence starts:

```js
const maxDist = floodOrder.length ? floodOrder[floodOrder.length - 1].dist : 0;
const doneAt = floodStartMs + maxDist * VICTORY.floodMsPerHex + VICTORY.floodShimmerMs;
music.stinger('victory', { resolveInSec: Math.max(0.3, (doneAt - performance.now()) / 1000) });
```

The battle layers thin out at the next beat, a bVII chord and an accelerating tom roll build for the
last 2.4 s (less if `resolveInSec` is), and the resolving chord plus a big drum land on `doneAt`, exactly when `sfx.play('victory')`
fires. If a fanfare delay (`VICTORY.fanfareDelayMs`) is ever added before the cue, add it to
`resolveInSec`. The `victory` cue is C5-E5-G5-C6 then a C6-E6-G6 chord (C major); the resolve chord is
built only from C D E G A (tonic + fifth + a colour note, never F or B), and the whole score ducks 40%
for 1.8 s under the cue, so they never clash.

**Defeat.** `sfx.play('defeat')` is called immediately in `beginEndSequence('lose')`, so call the
stinger right beside it:

```js
sfx.play('defeat');
music.stinger('defeat');
```

The defeat cue walks A4-F4-D4 (a D-minor triad); the score answers with a soft D-minor pad, a low D
string and a single drum heartbeat, and lets a lone recorder note sing after the cue ends.

After either stinger the score fades to the `world` bed by itself (its first bar is the top of a
phrase, on the home chord). Clicking Continue / Back to map before that simply crossfades sooner.

### 2.5 Settings

Add to `GameSettings` and to `defaultSettings()` in `game/meta/state.js` (`save.js` already merges
defaults over an old save, so older saves get them for free):

```js
music: true,          // music on/off; master `sound` still mutes everything
musicVolume: 0.4,     // 0..1, music's own volume under master
```

Settings UI: a *Music* toggle and a *Music volume* slider next to the existing sound toggle; both call
`applyMusicSettings(state)` and `autosave.save()`. The master mute (`state.settings.sound`) needs no
change: `sfx.setMuted()` already silences the music, because it feeds the same master gain.

### 2.6 Tab visibility

```js
document.addEventListener('visibilitychange', () => music.setPaused(document.hidden));
window.addEventListener('pagehide', () => music.setPaused(true));
window.addEventListener('pageshow', () => music.setPaused(document.hidden));
```

Do this even though the score would survive a throttled tab (a gap longer than 0.75 s shifts the
timeline instead of replaying it): pausing also stops the audio work while nobody can hear it.

### 2.7 Service worker

No change: `sw.js` is network-first with no precache list, so the new modules are picked up as fetched.

## 3. Musical design

**One piece, three beds.** The key, mode, progression order, tempo offset and the two motifs (A and B,
each a two-bar figure) come from `setSeed(seed)`. Title, world and battle all draw from that same
song: same key centre, same 8-bar progressions, same motifs; the bar counter runs on across scene
changes so harmony continues through a crossfade. Battle is exactly 3:2 against world (108 vs 72 bpm
before the seeded 0.95-1.03 scale, so battle stays inside 96-112).

**Keys.** D dorian, G mixolydian or A aeolian (seeded). These are the only three because every pitch in
`cues.js` is a white-key note (C E G, and D F A for `defeat`): every key is a mode of the C-major
collection, so a sound effect can never hold a note the score lacks. Progressions are diatonic
triads only (the diminished degree is never used), 8 bars, one chord per bar; four per mode, and the
progression changes every 4 phrases in a seeded order.

**Instruments (all WebAudio, nothing sampled).**
- *Harp / lute*: Karplus-Strong string rendered once per pitch into an `AudioBuffer` (in tune to under
  1 cent; rings 3+ s low, 1.5 s high; at most 32 buffers cached; a session settles at 20-25, about 10 MB).
- *Pad*: detuned sawtooth pairs, one panned each side, through a lowpass that breathes on a 0.045 Hz LFO.
- *Recorder*: band-limited periodic wave, delayed vibrato, a little breath noise.
- *Drone*: tonic and fifth, sawtooths through a 340 Hz lowpass, 8 bars per note.
- *Frame drum / taiko*: pitch-dropped sine plus lowpassed noise, tuned to the tonic; rim "ka" and toms.
- *Low strings*: sawtooth pairs, cutoff and level rise with intensity.
- *Reverb*: one generated 1.8 s stereo impulse response, per-group sends, shared by everything.

**World / title.** Phrases of 8 bars (about 27 s). Each phrase has a seeded character: rest (pad and drone only, no harp),
sparse, gentle or full (weights 14 / 22 / 36 / 28 %); harp arpeggios on chord tones with seeded
patterns, rests and timing humanisation; the recorder plays 2 of the 4 two-bar statements in some
phrases, never in two phrases running. Title is the fuller version (fewer rests, octave-doubled pad,
and its first phrase always states motif A on the recorder).

**Battle.** Drums follow intensity through a priority table (a step plays when its priority is below
the current density), with per-bar seeded jitter and a tom fill on the last bar of a phrase; strings
step from half notes to quarters to eighths at intensity 0.16 / 0.42; the counter-line enters at 0.6
(on-thresholds, with lower off-thresholds); everything else changes level once per bar.

**Seeded variety / no fatigue.** Every random draw comes from an rng keyed by (seed, purpose, phrase,
bar), so the same seed always plays the same music, yet no two phrases match (melody form, motif
transforms, harp pattern, pad voicing, rest bars, drum jitter). World harp density averages about one
note per second, with rest phrases and rest bars. The seed also picks key and progression order.

## 4. Mix (measured, offline render at the game's defaults: master 70%, music 0.4)

See section 6 for how to reproduce. Stems were calibrated one voice at a time (`--cal`) to targets,
then the combined clips measured:

| clip | peak dBFS | RMS dBFS |
|---|---|---|
| world | -15.4 | -36.2 |
| title | -16.2 | -35.5 |
| battle, intensity 0.12 (steady) | -21.7 | -37.0 |
| battle, intensity 0.90 (steady) | -16.5 | -32.4 |
| battle, intensity ramp 0 to 1 over 50 s | -16.6 | -37.6 at the start, -31.8 at the end (r = 0.89 with time) |
| battle at 0.5 with the assault swell (on 6 s, off 22 s) | -12.7 (one isolated hit; the rest -14.5 or lower) | -35.4 before, -30.5 at the top of the swell, -34.8 after |
| sfx `victory` alone | -9.1 | -27.0 (loudest second) |
| sfx `capture` alone | -11.0 | -33.9 (loudest second) |
| sfx `fireball` alone | -5.0 | -22.6 (loudest second) |
| hot battle 0.95 + assault + capture / fireball / victory stacked | -4.6 | -28.3 |

The music's peaks sit 4.4 dB or more under the quietest cue (`capture`, -11.0) and 6-7 dB under
`victory` (the one exception is a single drum-on-swell coincidence at -12.7); its RMS sits 5-10 dB
under the cues' loudest second. Player actions stay on top (PLAYFEEL §5),
and the worst-case overlap peaks at -4.6 dBFS (the fireball alone is -5.0), so the music adds no
clipping. A calm world breathes about 5 dB (RMS per second, 10th to 90th percentile: -39.3 to -34.2).
The knob for a global change is `MUSIC.bus.outputScale`; per-group levels are `MUSIC.groups[*].gain`.

## 5. Cost

- Scheduler: one `setInterval` every 25 ms, notes scheduled 150 ms ahead on `ctx.currentTime` (never
  from rAF). Measured in Chrome: mean 0.06-0.11 ms per tick, p99 under 1.5 ms.
  The one-off cost is unlock: it builds the graph and the reverb impulse response (about 17 ms on a
  laptop, once) and each new pitch renders a harp buffer on first use (1-4 ms, then cached).
- Nodes: every voice's nodes are disconnected once its end time has passed. A simulated hour of
  random scene / intensity / assault / stinger / seed / pause / mute changes on a mock context creates
  about 49 000 nodes with a **peak of 207 live**, at most 14 concurrent voices and 49 simultaneous
  oscillators + buffer sources, and returns to 0 after `destroy()`.
- Memory: at most 32 harp buffers (2.4 s mono each, about 0.5 MB at 48 kHz) plus a 1.8 s stereo impulse
  response and a 3 s noise buffer.
- On a phone: the convolver is the heaviest single node. If a device struggles, create the score with
  `createMusic(sfx, { reverb: false })` (saves the convolver and its sends; the mix stays in balance).

## 6. Tools

- **Audition page:** `npm start`, open `http://localhost:8080/tools/gallery/music.html`. Buttons for each
  scene, an intensity slider, an assault toggle, victory / defeat stingers (with the matching sfx at the
  resolve), a scripted 3-minute sequence, a seed changer with key readout, music / master volume, mute,
  a paused toggle, overlap buttons (`capture`, `fireball`, `victory`, `rally`), a live level meter and
  an engine readout.
- **Offline renders:** `node tools/musicrender.mjs` (starts the dev server if needed, drives headless
  Chrome) writes 44.1 kHz stereo 16-bit WAVs to `screenshots/audio/` and prints peak, RMS, level over
  time, the intensity ramp and assault swell, sound-effect comparisons and any silence gaps
  (`analysis.json` has the per-second numbers). `--only=a,b` renders some clips, `--cal` renders the
  per-voice calibration stems (analysis only), `--sr=` changes the sample rate. It exits non-zero on
  page errors or if any clip peaks above -0.5 dBFS.
- **Tests:** `node --test game/tests/audio.music.test.js` (pure layers on a fake clock, the engine on a
  mock `AudioContext` that counts live nodes, and `battleIntensity` against real simulated battles).
