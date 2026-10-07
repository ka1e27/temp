// Leader voices, heard (PLAN-PHASE14 §14B.6): a short murmured "voice" under each leader line, a few formant blips pitched per faction, so the
// Voices slider has something to set. Synthesised on the shared AudioContext into the sfx master bus (so Sound off and mute-when-hidden silence
// it too). Silent until audio is unlocked; never throws.
import { VOICE_SFX } from '../config/options.js';

/**
 * @param {{ getContext: () => AudioContext|null, getBus: () => GainNode|null }} sfx
 * @returns {{ say: (factionId: number, text?: string) => void, setVolume: (v: number) => void, volume: () => number, said: () => number }}
 */
export function createVoiceSfx(sfx) {
  let level = 0.7;
  let count = 0; // voices actually voiced (for the checks)
  const hash = (s) => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };

  function say(factionId, text = '') {
    const ctx = sfx.getContext();
    const bus = sfx.getBus();
    if (!ctx || !bus || ctx.state !== 'running' || level <= 0) return;
    try {
      const V = VOICE_SFX;
      let seed = hash(`${factionId}|${text}`);
      const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      const [p0, p1] = V.pitchBase;
      const base = p0 + ((Math.abs(factionId | 0) * 0.37) % 1) * (p1 - p0);
      const n = V.syllables[0] + Math.floor(rnd() * (V.syllables[1] - V.syllables[0] + 1));
      const out = ctx.createGain();
      out.gain.value = V.gain * level;
      out.connect(bus);
      let t = ctx.currentTime + 0.02;
      for (let i = 0; i < n; i++) {
        const f = base * (0.85 + rnd() * 0.35);
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(f, t);
        osc.frequency.linearRampToValueAtTime(f * (0.9 + rnd() * 0.2), t + V.syllableSec);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 500 + rnd() * 900; // a vowel-ish formant
        bp.Q.value = 4;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(1, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + V.syllableSec);
        osc.connect(bp); bp.connect(g); g.connect(out);
        osc.start(t);
        osc.stop(t + V.syllableSec + 0.02);
        t += V.syllableSec + V.gapSec;
      }
      setTimeout(() => { try { out.disconnect(); } catch { /* gone */ } }, (t - ctx.currentTime + 0.3) * 1000);
      count++;
    } catch { /* a voice never breaks a line */ }
  }

  return {
    say,
    setVolume: (v) => { level = Math.max(0, Math.min(1, Number(v) || 0)); },
    volume: () => level,
    said: () => count,
  };
}
