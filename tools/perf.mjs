// Performance measurements for PLAN-PHASE8 §8A, reproducible, CDP only, no dependencies. Prints one table against the budgets.
//
//   node tools/perf.mjs                         # everything (load x3, frames, meta tick, save size)
//   node tools/perf.mjs --only=load,frames --runs=5 --proto=h1 --json=out.json --label=before
//
// - load: a cold profile per run, Chrome's "Fast 4G" (165 ms RTT, 8.1 Mb/s down, 1.35 Mb/s up) and 4x CPU slowdown, against a Pages-shaped
//   server (tools/perfServer.js: /temp/, gzip, HTTP/2 over TLS like Pages' CDN; --proto=h1 for plain HTTP/1.1). "Title" is the first frame
//   with the New Realm button on screen and the splash gone; the tool then presses it for real at once, and "map" is the second frame of the
//   world scene. Both are measured from navigation start in the page (performance.now). Median of --runs.
// - frames: 4x CPU slowdown, 1440x900 (DPR 1), the GPU ON (cdp.js `gpu: true`; --disable-gpu frame times are software-raster numbers): the
//   map (a slow pan), a big battle (about 14 squads), an Ashen fight with wisps (Dynasty II), a Dragon fight. rAF interval median and p95,
//   plus the frame's CPU work.
// - meta: the average per-frame meta tick (main.js perf.metaMs: autosave, idle, prosperity, frontier, events, goals, Boons) in a late
//   Dynasty II with every system on, at 4x CPU slowdown, over 8 s on the map.
// - save: the serialised save of a late Dynasty III.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPerfServer } from './perfServer.js';
import * as stages from './perfStages.js';

if (!process.env.CHROME_PATH && process.platform === 'win32') process.env.CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { launch } = await import('./cdp.js');
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || 'true']; }));
const only = flags.only ? new Set(flags.only.split(',')) : null;
const wants = (k) => !only || only.has(k);
const RUNS = Number(flags.runs) || 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FAST_4G = { offline: false, latency: 165, downloadThroughput: (9e6 * 0.9) / 8, uploadThroughput: (1.5e6 * 0.9) / 8 };
const BUDGET = { title: 3500, map: 6000, median: 20, p95: 33, meta: 2, save: 200 };
const watchdog = setTimeout(() => { console.error('perf.mjs: overall timeout'); process.exit(1); }, 25 * 60 * 1000);

// --root=<dir>: serve another copy of the game (e.g. `git archive HEAD` extracted somewhere) for a before/after on the same machine, same hour
const server = await startPerfServer({ proto: flags.proto === 'h1' ? 'h1' : 'h2', ...(flags.root ? { root: flags.root } : {}) });
console.log(`server: ${server.base}/ (${server.proto === 'h2' ? 'HTTP/2 + TLS' : 'HTTP/1.1'}, gzip)`);
const pct = (arr, p) => { if (!arr.length) return NaN; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const avg = (arr) => arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
const median = (arr) => pct(arr, 0.5);

async function openPage({ width = 1440, height = 900, cold = false } = {}) {
  const profile = await mkdtemp(join(tmpdir(), 'hd-perf-'));
  const page = await launch({ url: 'about:blank', width, height, gpu: true, args: ['--ignore-certificate-errors', `--user-data-dir=${profile}`, '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  page.on((m, p) => {
    if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text);
  });
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  if (cold) { await page.send('Network.enable'); await page.send('Network.clearBrowserCache'); await page.send('Network.setCacheDisabled', { cacheDisabled: true }); }
  const waitFor = async (fn, timeout = 30000, ...a) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { try { if (await page.eval(fn, ...a)) return true; } catch { /* navigating */ } await sleep(50); } return false; };
  const done = async () => { await page.close(); await sleep(300); await rm(profile, { recursive: true, force: true }).catch(() => {}); };
  return { page, errors, waitFor, done };
}
const press = async (page, x, y) => { await page.mouse('mouseMoved', x, y, 'none', 0); await page.mouse('mousePressed', x, y, 'left', 1); await sleep(60); await page.mouse('mouseReleased', x, y, 'left', 0); };

// --- load ---------------------------------------------------------------------------------------------------------------------------------
const WATCH = `(() => {
  const P = window.__perfMarks = {};
  const vis = (e) => e && e.getClientRects().length > 0 && !e.closest('[hidden]');
  let worldFrames = 0;
  const poll = () => {
    const now = performance.now();
    if (!P.title) {
      const b = [...document.querySelectorAll('.title-actions button')].find((x) => vis(x) && /new realm/i.test(x.textContent));
      const boot = document.getElementById('boot');
      if (b && (!boot || boot.classList.contains('gone'))) { P.title = now; const r = b.getBoundingClientRect(); P.btn = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
    } else if (!P.map && window.__hd && window.__hd.scene === 'world') { if (++worldFrames === 2) P.map = now; }
    if (!P.map) requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { P.long = (P.long || 0) + 1; P.longMax = Math.max(P.longMax || 0, e.duration); } }).observe({ type: 'longtask', buffered: true }); } catch {}
})();`;

async function loadRun(i) {
  const t = await openPage({ cold: true });
  const { page } = t;
  let reqs = 0; let bytes = 0;
  page.on((m, p) => { if (m === 'Network.loadingFinished') { reqs += 1; bytes += p.encodedDataLength || 0; } });
  await page.send('Network.emulateNetworkConditions', FAST_4G);
  await page.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: WATCH + (process.env.PERF_INIT || '') });
  await page.send('Page.navigate', { url: `${server.base}/index.html?dev=1&seed=7` });
  const okTitle = await t.waitFor(() => !!(window.__perfMarks && window.__perfMarks.title), 60000);
  let marks = await page.eval(() => window.__perfMarks).catch(() => ({}));
  if (okTitle && marks.btn) await press(page, marks.btn.x, marks.btn.y);
  const okMap = okTitle && await t.waitFor(() => !!window.__perfMarks.map, 60000);
  marks = await page.eval(() => ({ ...window.__perfMarks, dcl: performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart, files: performance.getEntriesByType('resource').length, net: (() => { const r = performance.getEntriesByType('resource'); const end = (re) => Math.round(Math.max(0, ...r.filter((e) => re.test(e.name)).map((e) => e.responseEnd))); return { fontsCss: end(/fonts\.googleapis/), mainJs: end(/game\/main\.js/), lastJs: end(/\.js(\?|$)/), lastCss: end(/\.css(\?|$)/), late: r.filter((e) => e.responseEnd > 2000).map((e) => `${e.name.split('/').slice(-2).join('/')}@${Math.round(e.startTime)}-${Math.round(e.responseEnd)}`) }; })(), marks: Object.fromEntries(performance.getEntriesByType('mark').filter((m) => /^hd-/.test(m.name)).map((m) => [m.name.slice(3), Math.round(m.startTime)])) })).catch(() => marks);
  await t.done();
  const r = { title: okTitle ? marks.title : NaN, map: okMap ? marks.map : NaN, dcl: marks.dcl, files: marks.files, reqs, kb: bytes / 1024, longMax: marks.longMax || 0, marks: marks.marks || {}, net: marks.net || {} };
  console.log(`  load run ${i + 1}: title ${r.title.toFixed(0)} ms, map ${r.map.toFixed(0)} ms, DCL ${r.dcl} ms, ${r.files} resources, ${reqs} requests, ${r.kb.toFixed(0)} KB on the wire, longest task ${r.longMax.toFixed(0)} ms; boot marks ${JSON.stringify(r.marks)} net ${JSON.stringify(r.net)}`);
  return r;
}

// --- in-game stages ---------------------------------------------------------------------------------------------------------------------
/** A fresh realm on `seed`, through a real press on New Realm, with the helpers installed and the hints and voices off. */
async function realm(seed) {
  const t = await openPage();
  await t.page.goto(`${server.base}/index.html?dev=1&seed=${seed}`);
  await t.waitFor(() => !!(window.__hd && window.__hd.scene === 'title' && [...document.querySelectorAll('.title-actions button')].some((b) => /new realm/i.test(b.textContent) && b.getClientRects().length)), 60000);
  await sleep(500);
  const btn = await t.page.eval(() => { const b = [...document.querySelectorAll('.title-actions button')].find((x) => /new realm/i.test(x.textContent) && x.getClientRects().length); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await press(t.page, btn.x, btn.y);
  await t.waitFor(() => window.__hd.scene === 'world', 30000);
  await t.page.eval(stages.installHelpers);
  await t.page.eval(() => window.__pf.calm());
  await sleep(800);
  return t;
}
/** Samples `ms` of frames at 4x CPU slowdown (the stage is set up at full speed). */
async function sampleFrames(t, ms, pan = false) {
  await t.page.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await sleep(1200); // let the adaptive ambient quality settle at the new speed, as it would on the device
  const s = await t.page.eval((m, p) => window.__pf.sample(m, p), ms, pan);
  await t.page.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  return { median: median(s.dts), p95: pct(s.dts, 0.95), cpu: median(s.cpu), cpu95: pct(s.cpu, 0.95), meta: avg(s.meta), metaMax: Math.max(0, ...s.meta), frames: s.dts.length, squads: s.squads.length ? Math.round(median(s.squads)) : 0 };
}
const until = (t, fn, ms = 30000, ...a) => t.waitFor(fn, ms, ...a);

async function framesMap() {
  const t = await realm(7);
  await t.page.eval(() => { window.__hd.conquerRegions(10); window.__hd.advanceTenure(9); });
  await sleep(2500);
  const r = await sampleFrames(t, 8000, true);
  await t.done();
  return r;
}
async function framesBigBattle() {
  const t = await realm(7);
  await t.page.eval(() => { const hd = window.__hd; hd.conquerRegions(4); for (const id of ['rally', 'firestorm', 'bulwark', 'march', 'levy']) hd.state.upgrades[id] = 2; });
  const id = await t.page.eval(async () => {
    const { frontier } = await import(new URL('game/meta/progression.js', document.baseURI).href);
    const hd = window.__hd;
    const f = frontier(hd.state, hd.world);
    return f.sort((a, b) => hd.world.regions[b].settlements.length - hd.world.regions[a].settlements.length || a - b)[0];
  });
  await t.page.eval(stages.battleAt, id);
  await t.page.eval(() => window.__pf.drive(14, { refill: true }));
  await until(t, () => window.__hd.battle && window.__hd.battle.squads.length >= 12, 20000);
  const r = await sampleFrames(t, 8000);
  await t.done();
  return r;
}
async function framesAshen() {
  const t = await realm(7);
  await t.page.eval(() => window.__hd.completeRealm());
  await sleep(600);
  await t.page.eval(() => window.__hd.foundDynasty({ seed: 7001 }));
  await until(t, () => window.__hd.scene === 'world' && window.__hd.world.regions.some((r) => window.__hd.state.owner[r.id] === 5), 30000);
  await t.page.eval(stages.installHelpers);
  await t.page.eval(() => window.__pf.calm());
  const id = await t.page.eval(() => { const hd = window.__hd; const a = hd.world.regions.filter((r) => hd.state.owner[r.id] === 5); return (a.find((r) => r.isCapital) || a[0])?.id ?? null; });
  if (id == null) { await t.done(); return null; }
  await t.page.eval(stages.battleAt, id);
  // troops sent to die at the Host's settlements rise again: wisps all the time
  await t.page.eval(() => window.__pf.drive(14, { refill: true, playerOnly: false, targets: (s) => s.owner === 5 }));
  await until(t, () => (window.__hd.ashenInfo()?.risen || 0) > 0, 25000);
  const r = await sampleFrames(t, 8000);
  r.wisps = await t.page.eval(() => JSON.stringify(window.__hd.ashenInfo()));
  await t.done();
  return r;
}
async function framesDragon() {
  const t = await realm(9);
  const id = await t.page.eval(() => window.__hd.world.regions.find((r) => r.type === 'dragon')?.id ?? null);
  if (id == null) { await t.done(); return null; }
  await t.page.eval(stages.battleAt, id);
  await t.page.eval(() => window.__pf.drive(10, { refill: true }));
  await until(t, () => { const d = window.__hd.battle.dragon; return d && (d.breath || d.flight); }, 40000);
  const r = await sampleFrames(t, 8000);
  await t.done();
  return r;
}

async function lateDynasty(n) {
  const t = await realm(7);
  for (let d = 1; d < n; d++) {
    await t.page.eval(() => window.__hd.completeRealm());
    await sleep(500);
    await t.page.eval((s) => window.__hd.foundDynasty({ seed: s }), 7000 + d);
    await until(t, () => window.__hd.scene === 'world', 30000);
    await t.page.eval(stages.installHelpers);
    await t.page.eval(() => window.__pf.calm());
    await sleep(600);
  }
  // late in this dynasty: most of the continent held, systems on
  await t.page.eval(() => { const hd = window.__hd; const n0 = hd.world.regions.length; hd.conquerRegions(Math.floor(n0 * 0.7)); });
  await sleep(800);
  const sys = await t.page.eval(stages.everySystem);
  await sleep(1500);
  return { t, sys };
}
async function metaTick() {
  const { t, sys } = await lateDynasty(2);
  console.log(`  meta stage: ${JSON.stringify(sys)}`);
  const r = await sampleFrames(t, 8000);
  await t.done();
  return r;
}
async function saveSize() {
  const { t } = await lateDynasty(3);
  const r = await t.page.eval(async () => {
    const { serialize } = await import(new URL('game/meta/save.js', document.baseURI).href);
    const text = serialize(window.__hd.state);
    const parts = Object.entries(JSON.parse(text)).map(([k, v]) => [k, JSON.stringify(v).length]).sort((a, b) => b[1] - a[1]).slice(0, 8);
    return { kb: text.length / 1024, parts };
  });
  // and with a battle running (state.battles carries its arena and sim state)
  const fid = await t.page.eval(async () => { const { frontier } = await import(new URL('game/meta/progression.js', document.baseURI).href); const hd = window.__hd; return frontier(hd.state, hd.world)[0] ?? null; });
  if (fid != null && await t.page.eval(stages.battleAt, fid)) {
    await sleep(4000);
    r.battleKb = await t.page.eval(async () => { const { serialize } = await import(new URL('game/meta/save.js', document.baseURI).href); return serialize(window.__hd.state).length / 1024; });
  }
  await t.done();
  return r;
}

// --- run + table -------------------------------------------------------------------------------------------------------------------------
const results = { label: flags.label || '', proto: server.proto, at: new Date().toISOString() };
const step = async (name, fn) => {
  const t0 = Date.now();
  try { const r = await fn(); console.log(`  ${name}: ${JSON.stringify(r)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`); return r; } catch (e) { console.log(`  ${name} FAILED: ${e && e.stack}`); return null; }
};
if (wants('load')) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await loadRun(i));
  results.load = { title: median(runs.map((r) => r.title)), map: median(runs.map((r) => r.map)), runs };
}
if (wants('frames')) {
  results.frames = {};
  results.frames.map = await step('frames: map', framesMap);
  results.frames.battle = await step('frames: big battle', framesBigBattle);
  results.frames.ashen = await step('frames: Ashen fight', framesAshen);
  results.frames.dragon = await step('frames: Dragon fight', framesDragon);
}
if (wants('meta')) results.meta = await step('meta tick (late Dynasty II)', metaTick);
if (wants('save')) results.save = await step('save (late Dynasty III)', saveSize);

const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '-');
const f0 = (x) => (Number.isFinite(x) ? x.toFixed(0) : '-');
const rows = [];
const row = (what, value, budget, pass, note = '') => rows.push([what, value, budget, pass == null ? '' : pass ? 'ok' : 'OVER', note]);
if (results.load) {
  row('title interactive (Fast 4G, 4x CPU, cold)', `${f0(results.load.title)} ms`, `< ${BUDGET.title} ms`, results.load.title < BUDGET.title, `median of ${RUNS}`);
  row('map playable (New Realm pressed at once)', `${f0(results.load.map)} ms`, `< ${BUDGET.map} ms`, results.load.map < BUDGET.map, `${results.load.runs[0].reqs} requests, ${f0(results.load.runs[0].kb)} KB`);
}
for (const [k, label] of [['map', 'map, slow pan'], ['battle', 'big battle'], ['ashen', 'Ashen fight (wisps)'], ['dragon', 'Dragon fight']]) {
  const r = results.frames && results.frames[k];
  if (!r) { if (results.frames) row(`frame: ${label}`, 'n/a', '', false); continue; }
  row(`frame median: ${label}`, `${f1(r.median)} ms`, `< ${BUDGET.median} ms`, r.median < BUDGET.median, `cpu ${f1(r.cpu)} ms${r.squads ? `, ${r.squads} squads` : ''}`);
  row(`frame p95: ${label}`, `${f1(r.p95)} ms`, `< ${BUDGET.p95} ms`, r.p95 < BUDGET.p95, `cpu p95 ${f1(r.cpu95)} ms`);
}
if (results.meta) row('meta tick, late Dynasty II (4x CPU)', `${results.meta.meta.toFixed(2)} ms`, `< ${BUDGET.meta} ms`, results.meta.meta < BUDGET.meta, `max ${f1(results.meta.metaMax)} ms`);
if (results.save) row('save size, late Dynasty III', `${f1(results.save.kb)} KB`, `< ${BUDGET.save} KB`, results.save.kb < BUDGET.save, results.save.parts.slice(0, 4).map(([k, v]) => `${k} ${f1(v / 1024)}`).join(', '));
if (results.save && results.save.battleKb) row('save size, same, mid-battle', `${f1(results.save.battleKb)} KB`, `< ${BUDGET.save} KB`, results.save.battleKb < BUDGET.save, 'state.battles holds the running battle');
const widths = [0, 1, 2, 3, 4].map((i) => Math.max(...rows.map((r) => String(r[i]).length), ['measure', 'value', 'budget', '', 'note'][i].length));
const line = (r) => `| ${r.map((c, i) => String(c).padEnd(widths[i])).join(' | ')} |`;
console.log(`\nperf ${results.label ? `(${results.label}) ` : ''}${results.proto}\n${line(['measure', 'value', 'budget', '', 'note'])}\n|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`);
for (const r of rows) console.log(line(r));
if (flags.json) await writeFile(flags.json, JSON.stringify(results, null, 2));
clearTimeout(watchdog);
await server.close();
process.exit(0);
