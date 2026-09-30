// First-screen screenshots of the REAL game for a list of world seeds: title -> real click on
// "New Realm" -> the world scene framing the realm + the nearest frontier. Used to compare world
// generation before/after a change.
//
//   npm start                      # in another terminal
//   node tools/worldshots.mjs --tag=before --seeds=1-8 [--out=screenshots/worldgen] [--w=1440 --h=900]
//
// Writes <out>/<tag>-seed<N>.png. Uses `?dev=1&seed=N` (a reproducible continent on a fresh Chrome
// profile) and real mouse input for the New Realm click; the dev panel is hidden for the shot.
import { mkdir } from 'node:fs/promises';

if (!process.env.CHROME_PATH) process.env.CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { launch } = await import('./cdp.js');

const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const [k, ...v] = a.slice(2).split('=');
  return [k, v.join('=') || 'true'];
}));
const TAG = flags.tag || 'shot';
const OUT = flags.out || 'screenshots/worldgen';
const BASE = flags.url || 'http://localhost:8080';
const W = Number(flags.w || 1440);
const H = Number(flags.h || 900);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseSeeds(spec) {
  const out = [];
  for (const part of String(spec || '1-8').split(',')) {
    const m = part.match(/^(\d+)-(\d+)$/);
    if (m) for (let i = Number(m[1]); i <= Number(m[2]); i++) out.push(i);
    else out.push(Number(part));
  }
  return out;
}

await mkdir(OUT, { recursive: true });
const errors = [];
for (const seed of parseSeeds(flags.seeds)) {
  const page = await launch({ url: 'about:blank', width: W, height: H });
  page.on((method, params) => {
    if (method === 'Runtime.exceptionThrown') errors.push(`seed ${seed}: ${params.exceptionDetails?.exception?.description || params.exceptionDetails?.text}`);
  });
  await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await page.goto(`${BASE}/index.html?dev=1&seed=${seed}`);
  const waitFor = async (pred, timeout = 12000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await page.eval(pred)) return true;
      await sleep(100);
    }
    throw new Error(`seed ${seed}: timed out`);
  };
  try {
    await waitFor(() => !!window.__hd && window.__hd.scene === 'title', 20000);
    await sleep(1800);
    await page.eval(() => window.__hd.hideDev(true));
    const c = await page.eval(() => {
      const el = [...document.querySelectorAll('.title-actions button')].find((b) => b.textContent.toLowerCase().includes('new realm'));
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse('mouseMoved', c.x, c.y, 'none', 0);
    await sleep(40);
    await page.mouse('mousePressed', c.x, c.y, 'left', 1);
    await sleep(50);
    await page.mouse('mouseReleased', c.x, c.y, 'left', 0);
    await waitFor(() => window.__hd.scene === 'world', 8000);
    await sleep(4200); // camera flight + mists rolling in
    const info = await page.eval(() => ({ seed: window.__hd.state.seed, regions: window.__hd.world.regions.length }));
    await page.screenshot(`${OUT}/${TAG}-seed${seed}.png`);
    console.log(`saved ${OUT}/${TAG}-seed${seed}.png (world seed ${info.seed}, ${info.regions} regions)`);
  } catch (e) {
    console.log(`seed ${seed}: ${e.message}`);
  } finally {
    await page.close();
  }
}
if (errors.length) {
  console.log(`page errors (${errors.length}):`);
  for (const e of errors.slice(0, 10)) console.log('  ' + e);
}
