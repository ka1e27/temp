// Screenshot any page served by `npm start` with headless Chrome — no dependencies.
//
//   node tools/pageshot.mjs <url-or-path> <out.png> [--w=1440] [--h=900] [--wait=1500]
//        [--dpr=1] [--eval="js expression run before the shot"] [--frames=1 --every=500]
//
// <url-or-path> may be a full URL or a path like tools/gallery/art.html (resolved
// against http://localhost:8080). In Git Bash never start the path with "/": MSYS
// rewrites it to a Windows path. Use "index.html" for the game itself.
// With --frames=N it writes N shots, <out>-0.png ...,
// `--every` ms apart, which is how you look at an animation.
// Console errors from the page are printed so a blank shot is never a silent mystery.
//
// Set CHROME_PATH first, e.g. on this machine:
//   CHROME_PATH="/c/Program Files/Google/Chrome/Application/chrome.exe"
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => {
  const [k, ...v] = a.slice(2).split('=');
  return [k, v.join('=') || 'true'];
}));
const [target, out] = args.filter((a) => !a.startsWith('--'));
if (!target || !out) {
  console.error('usage: node tools/pageshot.mjs <url-or-path> <out.png> [--w= --h= --wait= --dpr= --eval= --frames= --every=]');
  process.exit(2);
}
const url = /^https?:/.test(target) ? target : `http://localhost:8080${target.startsWith('/') ? '' : '/'}${target}`;
const w = Number(flags.w || 1440);
const h = Number(flags.h || 900);
const dpr = Number(flags.dpr || 1);
const wait = Number(flags.wait || 1500);
const frames = Number(flags.frames || 1);
const every = Number(flags.every || 500);

if (!process.env.CHROME_PATH) {
  process.env.CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
}

const { launch } = await import('./cdp.js');
const page = await launch({ url: 'about:blank', width: w, height: h });
const errors = [];
page.on((method, params) => {
  if (method === 'Runtime.exceptionThrown') {
    errors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text);
  } else if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
    errors.push(params.args.map((a) => a.value ?? a.description).join(' '));
  } else if (method === 'Log.entryAdded' && params.entry.level === 'error') {
    errors.push(`${params.entry.text} ${params.entry.url || ''}`);
  }
});
await page.send('Emulation.setDeviceMetricsOverride', {
  width: w, height: h, deviceScaleFactor: dpr, mobile: w < 768,
});
if (w < 768) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await page.goto(url);
await page.sleep(wait);
if (flags.eval) {
  try {
    const res = await page.send('Runtime.evaluate', { expression: flags.eval, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) errors.push(`eval: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`);
    else if (res.result?.value !== undefined) console.log('eval →', JSON.stringify(res.result.value));
  } catch (e) { errors.push(`eval: ${e.message}`); }
  await page.sleep(Number(flags.after || 400));
}
await mkdir(dirname(out) || '.', { recursive: true });
if (frames <= 1) {
  await page.screenshot(out);
  console.log(`saved ${out}`);
} else {
  for (let f = 0; f < frames; f++) {
    const p = out.replace(/\.png$/i, `-${f}.png`);
    await page.screenshot(p);
    console.log(`saved ${p}`);
    if (f < frames - 1) await page.sleep(every);
  }
}
if (errors.length) {
  console.log(`page errors (${errors.length}):`);
  for (const e of errors.slice(0, 20)) console.log('  ' + e);
}
await page.close();
