// THE GAME HAD NO SOUND. Not a quiet mix, not a muted default — a grep for
// `AudioContext` across the whole repo returned nothing at all.
//
// That was the single largest gap between this and a commercial release, and it
// repairs three separate problems at once: a send with no acknowledgement, a
// capture with no payoff, and a stronghold taken off you in total silence.
//
// SYNTHESISED, NEVER SAMPLED. Oscillators, one noise buffer, gain envelopes and
// a filter cover every cue below, so this adds no asset files, no build step and
// no dependency — the same constraints the rest of the project works under. It
// also means a cue is a few numbers in a table rather than a binary somebody has
// to find the source of later.
//
// Lives in `src/ui/` because `tools/checkpure.js` guards `core`, `battle`, `meta`
// and `content` — the simulation must never learn that sound exists. This is fed
// from the event drain in screens/battle.js, downstream of everything.

/** One buffer of white noise, made once, reused by every percussive cue. */
function makeNoise(ctx) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/**
 * The cue table. Each entry is read by `play` below; nothing here allocates a
 * node until something actually fires.
 *
 * `gap` is a per-cue cooldown in ms and it is not optional: `units-trained` and
 * `field-battle` arrive in bursts of three or four in a single tick, and without
 * it a busy front is a buzz rather than a battle.
 */
const CUES = Object.freeze({
  send:     { kind: 'noise', f0: 900, f1: 400, dur: 0.09, gain: 0.10, q: 1.2, gap: 60 },
  clash:    { kind: 'noise', f0: 1200, f1: 500, dur: 0.14, gain: 0.13, q: 0.9, gap: 90 },
  siege:    { kind: 'tone', wave: 'square', f0: 110, f1: 90, dur: 0.07, gain: 0.12, gap: 400 },
  taken:    { kind: 'chord', wave: 'triangle', f0: 392, f1: 587, dur: 0.26, gain: 0.18, gap: 120 },
  lost:     { kind: 'tone', wave: 'sawtooth', f0: 300, f1: 150, dur: 0.30, gain: 0.20, gap: 120,
              lp: 800 },
  train:    { kind: 'tone', wave: 'sine', f0: 1046, f1: 1046, dur: 0.025, gain: 0.035, gap: 110 },
  win:      { kind: 'arp', wave: 'triangle', notes: [392, 494, 587, 784], dur: 0.12, gain: 0.16, gap: 0 },
  defeat:   { kind: 'arp', wave: 'triangle', notes: [392, 330, 262, 196], dur: 0.14, gain: 0.16, gap: 0 },
  ui:       { kind: 'tone', wave: 'sine', f0: 660, f1: 880, dur: 0.05, gain: 0.05, gap: 40 },
});

/** Which sim event maps to which cue, and when it is worth a sound at all. */
function cueFor(ev) {
  switch (ev.type) {
    case 'squad-sent': return ev.owner === 'player' ? 'send' : null;
    case 'field-battle': return 'clash';
    case 'siege-begun': return 'siege';
    case 'units-trained': return ev.owner === 'player' ? 'train' : null;
    case 'site-captured':
      if (ev.to === 'player') return 'taken';
      return ev.from === 'player' ? 'lost' : null;
    case 'battle-ended': return ev.status === 'win' ? 'win' : 'defeat';
    default: return null;
  }
}

/**
 * @param {{enabled?:()=>boolean, volume?:()=>number}} [o]
 *   Both are read per cue rather than captured, so a settings change takes
 *   effect immediately without rebuilding anything.
 */
export function createSound(o = {}) {
  let ctx = null;
  let master = null;
  let noise = null;
  let voices = 0;
  const lastAt = Object.create(null);

  const reduced = typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /**
   * Built on the FIRST GESTURE, never at boot. Browsers refuse to start an
   * AudioContext without one, and an attempt at load leaves a permanently
   * suspended context that never recovers.
   */
  function wake() {
    if (ctx || reduced) return ctx;
    const AC = typeof AudioContext !== 'undefined' ? AudioContext
      : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
    noise = makeNoise(ctx);
    return ctx;
  }

  function env(node, gain, dur, t) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    node.connect(g);
    g.connect(master);
    // A VOICE CAP, because a five-front battle can ask for a dozen cues in one
    // tick and the mix turns to mud long before the CPU notices.
    voices++;
    setTimeout(() => { voices--; }, (dur + 0.05) * 1000);
    return g;
  }

  function play(name) {
    const spec = CUES[name];
    if (!spec || reduced) return;
    if (o.enabled && !o.enabled()) return;
    const now = Date.now();
    if (spec.gap && now - (lastAt[name] ?? -1e9) < spec.gap) return;
    if (!wake()) return;
    if (voices > 8) return;
    lastAt[name] = now;

    const vol = Math.max(0, Math.min(1, o.volume ? o.volume() : 0.7));
    if (vol <= 0) return;
    const t = ctx.currentTime;
    const gain = spec.gain * vol;

    if (spec.kind === 'noise') {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = spec.q ?? 1;
      bp.frequency.setValueAtTime(spec.f0, t);
      bp.frequency.exponentialRampToValueAtTime(spec.f1, t + spec.dur);
      src.connect(bp);
      env(bp, gain, spec.dur, t);
      src.start(t);
      src.stop(t + spec.dur + 0.02);
      return;
    }

    if (spec.kind === 'arp') {
      spec.notes.forEach((f, i) => {
        const osc = ctx.createOscillator();
        osc.type = spec.wave;
        osc.frequency.setValueAtTime(f, t + i * spec.dur);
        env(osc, gain, spec.dur, t + i * spec.dur);
        osc.start(t + i * spec.dur);
        osc.stop(t + (i + 1) * spec.dur + 0.02);
      });
      return;
    }

    // `tone` and `chord`: one swept oscillator, plus a fifth above for a chord.
    const freqs = spec.kind === 'chord' ? [1, 1.5] : [1];
    for (const mul of freqs) {
      const osc = ctx.createOscillator();
      osc.type = spec.wave;
      osc.frequency.setValueAtTime(spec.f0 * mul, t);
      osc.frequency.exponentialRampToValueAtTime(spec.f1 * mul, t + spec.dur);
      let node = osc;
      if (spec.lp) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = spec.lp;
        osc.connect(lp);
        node = lp;
      }
      env(node, gain / freqs.length, spec.dur, t);
      osc.start(t);
      osc.stop(t + spec.dur + 0.02);
    }
  }

  return {
    /** Fire a named cue directly — UI clicks, and anything with no sim event. */
    play,
    /** The event drain's one line. Unknown or uninteresting events are ignored. */
    onEvent(ev) {
      const cue = cueFor(ev);
      if (cue) play(cue);
    },
    /** Exposed so a test can assert the mapping without a browser. */
    cueFor,
    dispose() {
      try { ctx?.close(); } catch { /* already gone */ }
      ctx = master = noise = null;
    },
  };
}

export { CUES, cueFor };
