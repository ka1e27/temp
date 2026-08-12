// DOES THE GAME ACTUALLY WORK OFFLINE? — the end-to-end check behind sw.js.
//
// tests/shell.test.js already asserts the worker exists, is referenced with a
// relative path, and has the two rules that keep a runtime cache safe. All of
// that is grep against a file, and grep proves a STRING is present, not that a
// browser installs the thing or that it caches a single byte. This project has
// shipped five separate features that were present, plausible and inert; a
// service worker verified only by regex would be the sixth.
//
//   npm start &
//   node tools/offline.mjs
//
// index.html deliberately registers only over https, so the dev server and the
// other two browser tools never install a worker and never assert against a
// cache some earlier run left behind. This tool opts in explicitly instead:
// registers by hand, waits for control, reloads, and then asks the two
// questions that matter.
//
//   1. Is the page CONTROLLED after a reload? A worker that installs and never
//      takes control caches nothing anyone will ever read.
//   2. Did the cache actually fill with the app's own modules? A controlled
//      page whose cache is empty is offline-broken in the one way a user would
//      only discover on a train.
import { launch } from './cdp.js';

const URL_BASE = process.env.URL || 'http://localhost:8080/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.error(`  FAIL  ${m}`); process.exitCode = 1; };
const ok = (m) => console.log(`  ok    ${m}`);

const page = await launch({ url: URL_BASE, width: 1024, height: 768 });

// Boot first: the worker caches what the game FETCHES, so the page has to have
// actually loaded its module graph before there is anything to cache.
for (let i = 0; i < 100 && !(await page.eval(() => !!window.__game)); i++) await sleep(150);
if (!(await page.eval(() => !!window.__game))) {
  fail('the game never booted — nothing downstream means anything');
  await page.close();
  process.exit(1);
}
ok('game booted');

// Register by hand, bypassing the https gate that keeps this out of dev.
const reg = await page.eval(async () => {
  try {
    const r = await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
    return { ok: true, scope: r.scope };
  } catch (e) { return { ok: false, err: String(e) }; }
});
if (!reg.ok) { fail(`registration threw: ${reg.err}`); await page.close(); process.exit(1); }
ok(`worker registered and ready, scope ${reg.scope}`);

// A worker only controls pages loaded AFTER it activates, so the reload is the
// test rather than a tidy-up. `skipWaiting` + `clients.claim` in sw.js are what
// make one reload enough instead of two.
await page.goto(URL_BASE);
for (let i = 0; i < 60 && !(await page.eval(() => !!navigator.serviceWorker.controller)); i++) {
  await sleep(200);
}
if (!(await page.eval(() => !!navigator.serviceWorker.controller))) {
  fail('the page is not controlled after a reload — the worker caches for nobody');
} else {
  ok('page is controlled after reload');
}

for (let i = 0; i < 100 && !(await page.eval(() => !!window.__game)); i++) await sleep(150);
if (await page.eval(() => !!window.__game)) ok('game booted again, through the worker');
else fail('the game did not boot with the worker in front of it');

// Give the revalidate half a moment: responses are cached as they resolve.
await sleep(1500);

const cache = await page.eval(async () => {
  const names = await caches.keys();
  const c = await caches.open(names[0] ?? 'none');
  const keys = (await c.keys()).map((r) => new URL(r.url).pathname);
  return { names, n: keys.length, hasMain: keys.some((p) => p.endsWith('/src/main.js')) };
});

if (cache.names.length !== 1) {
  fail(`expected exactly one cache, found ${JSON.stringify(cache.names)} — `
    + 'the activate-time purge is not reclaiming old versions');
} else {
  ok(`one cache: ${cache.names[0]}`);
}
if (cache.n < 20) fail(`only ${cache.n} entries cached — the game is ~100 modules, this is not offline-ready`);
else ok(`${cache.n} responses cached`);
if (!cache.hasMain) fail('src/main.js is not in the cache — the entry point would 503 offline');
else ok('src/main.js is cached');

// THE ACTUAL QUESTION. Serve the entry module from the cache with no network
// involved: this is what a cold offline load does.
const served = await page.eval(async () => {
  const res = await caches.match('./src/main.js');
  if (!res) return { ok: false, why: 'no cache entry' };
  const body = await res.text();
  return { ok: res.ok && body.length > 0, status: res.status, bytes: body.length };
});
if (!served.ok) fail(`the cache cannot serve src/main.js: ${JSON.stringify(served)}`);
else ok(`cache serves src/main.js (${served.status}, ${served.bytes} bytes) with no network`);

// Leave nothing behind: a worker left registered against localhost would be
// exactly the hidden state this tool exists so the other two never have.
await page.eval(async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
});
ok('cleaned up (worker unregistered, caches cleared)');

await page.close();
console.log(process.exitCode ? '\nOFFLINE CHECK FAILED' : '\nOFFLINE CHECK PASSED');
