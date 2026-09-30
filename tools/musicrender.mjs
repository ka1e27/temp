// Render the score to WAV files, offline, and measure them. There is no way to listen through
// the tools, so this is the proof: it loads tools/gallery/music.html in headless Chrome, asks
// the page to render each named clip through an OfflineAudioContext (the same engine, the same
// master chain, master 70% / music 40%), pulls the 16-bit samples back over CDP, writes
// screenshots/audio/<clip>.wav and prints peak / RMS / level-over-time / silence numbers.
//
//   npm start                                   # (started for you if it is not running)
//   node tools/musicrender.mjs [--only=world-90s,battle-high-60s] [--out=screenshots/audio]
//                              [--sr=44100] [--url=http://localhost:8080] [--no-analysis]
//
// On this machine CHROME_PATH defaults to the local Chrome. Exits non-zero on page errors or
// when a rendered clip clips (peak >= -0.5 dBFS).
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

if (!process.env.CHROME_PATH) process.env.CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { launch } = await import('./cdp.js');

const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const [k, ...v] = a.slice(2).split('=');
  return [k, v.join('=') || 'true'];
}));
const BASE = flags.url || 'http://localhost:8080';
const OUT = flags.out || 'screenshots/audio';
const SR = Number(flags.sr || 44100);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const db = (v) => (v > 1e-9 ? 20 * Math.log10(v) : -120);

// ------------------------------------------------------------------ server
async function ensureServer() {
  const up = async () => { try { return (await fetch(`${BASE}/index.html`)).ok; } catch { return false; } };
  if (await up()) return null;
  console.log('dev server not running: starting node tools/serve.js');
  const proc = spawn(process.execPath, ['tools/serve.js'], { stdio: 'ignore' });
  for (let i = 0; i < 40 && !(await up()); i++) await sleep(250);
  if (!(await up())) { proc.kill(); throw new Error('could not start the dev server'); }
  return proc;
}

// --------------------------------------------------------------------- wav
function wavFile(pcm, sampleRate) {
  const bytes = pcm.length * 2;
  const buf = Buffer.alloc(44 + bytes);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + bytes, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(bytes, 40);
  Buffer.from(pcm.buffer, pcm.byteOffset, bytes).copy(buf, 44);
  return buf;
}

// ---------------------------------------------------------------- analysis
/** RMS (linear, mono-summed power of both channels) of frames [a, b) in seconds. */
function rmsRange(pcm, sr, a, b) {
  const i0 = Math.max(0, Math.floor(a * sr));
  const i1 = Math.min(pcm.length / 2, Math.floor(b * sr));
  let sum = 0;
  for (let i = i0; i < i1; i++) {
    const l = pcm[2 * i] / 32768;
    const r = pcm[2 * i + 1] / 32768;
    sum += (l * l + r * r) / 2;
  }
  return i1 > i0 ? Math.sqrt(sum / (i1 - i0)) : 0;
}

function analyse(name, pcm, sr) {
  const frames = pcm.length / 2;
  const dur = frames / sr;
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]) / 32768);
  const perSec = [];
  for (let s = 0; s < Math.floor(dur); s++) perSec.push(db(rmsRange(pcm, sr, s, s + 1)));
  // Quiet runs: 50 ms windows under -55 dBFS, reported when they last 0.5 s or more.
  const gaps = [];
  let runStart = null;
  const win = 0.05;
  for (let t = 0; t < dur - win; t += win) {
    const quiet = db(rmsRange(pcm, sr, t, t + win)) < -55;
    if (quiet && runStart === null) runStart = t;
    if (!quiet && runStart !== null) { if (t - runStart >= 0.5) gaps.push([+runStart.toFixed(2), +t.toFixed(2)]); runStart = null; }
  }
  if (runStart !== null && dur - runStart >= 0.5) gaps.push([+runStart.toFixed(2), +dur.toFixed(2)]);
  return {
    name, dur: +dur.toFixed(1), peakDb: +db(peak).toFixed(1), rmsDb: +db(rmsRange(pcm, sr, 0, dur)).toFixed(1),
    perSecDb: perSec.map((v) => +v.toFixed(1)), quietRuns: gaps,
  };
}

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const avg = (a, from, to) => mean(a.slice(from, to));

function pearson(xs, ys) {
  const mx = mean(xs);
  const my = mean(ys);
  let n = 0; let dx = 0; let dy = 0;
  xs.forEach((x, i) => { n += (x - mx) * (ys[i] - my); dx += (x - mx) ** 2; dy += (ys[i] - my) ** 2; });
  return n / Math.sqrt(dx * dy);
}

function bar(dbv) {
  const n = Math.max(0, Math.round((dbv + 60) / 1.5));
  return '#'.repeat(n);
}

// ---------------------------------------------------------------------- main
const errors = [];
const proc = await ensureServer();
await mkdir(OUT, { recursive: true });
const page = await launch({ url: 'about:blank', width: 1000, height: 800 });
page.on((method, params) => {
  if (method === 'Runtime.exceptionThrown') errors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text);
  else if (method === 'Runtime.consoleAPICalled' && params.type === 'error') errors.push(params.args.map((a) => a.value ?? a.description).join(' '));
  else if (method === 'Runtime.consoleAPICalled' && params.type === 'warning' && String(params.args[0]?.value).includes('[music]')) errors.push(params.args.map((a) => a.value ?? a.description).join(' '));
  else if (method === 'Log.entryAdded' && params.entry.level === 'error' && !String(params.entry.url).endsWith('favicon.ico')) errors.push(`${params.entry.text} ${params.entry.url || ''}`);
});
await page.goto(`${BASE}/tools/gallery/music.html`);
for (let i = 0; i < 40; i++) { if (await page.eval(() => typeof window.__renderClip === 'function')) break; await sleep(250); }
const allNames = await page.eval(() => window.__clipNames);
const calNames = await page.eval(() => window.__calNames);
const wanted = flags.only ? String(flags.only).split(',')
  : flags.cal ? calNames : allNames.filter((n) => !calNames.includes(n));
const results = {};
let clipped = false;

for (const name of wanted) {
  if (!allNames.includes(name)) { console.error(`unknown clip ${name}; known: ${allNames.join(', ')}`); process.exitCode = 2; continue; }
  const t0 = Date.now();
  const meta = await page.eval((n, sr) => window.__renderClip(n, { sampleRate: sr }), name, SR);
  const total = meta.frames * 2;
  const pcm = new Int16Array(total);
  const CH = 1_500_000;
  for (let off = 0; off < total; off += CH) {
    const b64 = await page.eval((o, c) => window.__pcmChunk(o, c), off, Math.min(CH, total - off));
    const bytes = Buffer.from(b64, 'base64');
    pcm.set(new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2), off);
  }
  const isRef = name.startsWith('ref-') || name.startsWith('cal-');
  if (!isRef) await writeFile(`${OUT}/${name}.wav`, wavFile(pcm, SR));
  const a = analyse(name, pcm, SR);
  a.debug = meta.debug ? { peakVoices: meta.debug.peakVoices, errors: meta.debug.errors, key: meta.debug.key, persistentNodes: meta.debug.persistentNodes } : null;
  results[name] = a;
  if (a.peakDb >= -0.5) clipped = true;
  console.log(`${name.padEnd(24)} ${String(a.dur).padStart(5)} s  peak ${String(a.peakDb).padStart(6)} dBFS  rms ${String(a.rmsDb).padStart(6)} dBFS`
    + `  quiet>=0.5s: ${a.quietRuns.length}  [${((Date.now() - t0) / 1000).toFixed(0)} s render${isRef ? ', reference only' : ''}]`);
}

if (!flags['no-analysis']) {
  console.log('\n--- level over time (RMS dBFS per second, master 70% / music 40%) ---');
  const R = results;
  if (R['battle-ramp-60s']) {
    const s = R['battle-ramp-60s'].perSecDb;
    const xs = s.map((_, i) => i);
    console.log(`intensity ramp 0->1 (2-52 s): rms ${[[4, 10], [18, 24], [32, 38], [46, 52], [54, 60]].map(([a, z]) => `${a}-${z}s ${avg(s, a, z).toFixed(1)}`).join(' | ')} dB, correlation with time (2-52 s) r=${pearson(xs.slice(2, 52), s.slice(2, 52)).toFixed(2)}`);
  }
  if (R['battle-low-60s'] && R['battle-high-60s']) {
    console.log(`battle low vs high (steady, 12-60 s): ${avg(R['battle-low-60s'].perSecDb, 12, 60).toFixed(1)} dB vs ${avg(R['battle-high-60s'].perSecDb, 12, 60).toFixed(1)} dB`);
  }
  if (R['battle-assault-30s']) {
    const s = R['battle-assault-30s'].perSecDb;
    console.log(`assault swell (on 6 s, resolves 22 s): before ${avg(s, 2, 6).toFixed(1)} | 6-10 s ${avg(s, 6, 10).toFixed(1)} | 14-18 s ${avg(s, 14, 18).toFixed(1)} | 19-22 s ${avg(s, 19, 22).toFixed(1)} | after 25-30 s ${avg(s, 25, 30).toFixed(1)} dB`);
  }
  if (R['sequence-3min']) {
    console.log('\nsequence-3min, RMS per 5 s (title 0, world 20, battle 50, assault 105, victory 122/125, world after):');
    const s = R['sequence-3min'].perSecDb;
    for (let t = 0; t < s.length; t += 5) console.log(`${String(t).padStart(4)} s ${avg(s, t, t + 5).toFixed(1).padStart(6)} dB ${bar(avg(s, t, t + 5))}`);
  }
  console.log('\n--- music vs sound effects (sfx alone, same chain) ---');
  const refs = ['ref-victory', 'ref-capture', 'ref-fireball'].filter((n) => R[n]);
  for (const n of refs) console.log(`${n}: peak ${R[n].peakDb} dBFS, rms over its loudest second ${Math.max(...R[n].perSecDb).toFixed(1)} dBFS (cue is shorter than 1 s, so its own rms is a few dB higher)`);
  const mix = R['overlap-mix-20s'];
  if (mix) console.log(`overlap-mix-20s (hot battle + capture/fireball/victory stacked): peak ${mix.peakDb} dBFS, rms ${mix.rmsDb} dBFS`);
  for (const n of ['world-90s', 'title-45s', 'battle-low-60s', 'battle-high-60s']) if (R[n]) console.log(`${n} alone: peak ${R[n].peakDb} dBFS, rms ${R[n].rmsDb} dBFS`);
  console.log('\n--- level spread, RMS per second: p10 / median / p90 dBFS (the breathing of a clip) ---');
  for (const [n, a] of Object.entries(R)) {
    if (n.startsWith('ref-') || n.startsWith('cal-') || a.perSecDb.length < 20) continue;
    const s = [...a.perSecDb].sort((x, y) => x - y);
    const q = (p) => s[Math.floor(p * (s.length - 1))];
    console.log(`${n.padEnd(24)} ${q(0.1).toFixed(1)} / ${q(0.5).toFixed(1)} / ${q(0.9).toFixed(1)}`);
  }
  console.log('\n--- quiet runs (>= 0.5 s under -55 dBFS) ---');
  for (const [n, a] of Object.entries(R)) if (a.quietRuns.length) console.log(`${n}: ${JSON.stringify(a.quietRuns)}`);
}

let previous = {};
try { previous = JSON.parse(await readFile(`${OUT}/analysis.json`, 'utf8')); } catch { /* first run */ }
await writeFile(`${OUT}/analysis.json`, JSON.stringify({ ...previous, ...results }, null, 1)); // partial re-renders keep earlier clips
await page.close();
if (proc) proc.kill();
if (errors.length) { console.error('\nPAGE ERRORS:\n' + [...new Set(errors)].join('\n')); process.exitCode = 1; }
if (clipped) { console.error('\nCLIPPING: a clip peaked at or above -0.5 dBFS'); process.exitCode = 1; }
