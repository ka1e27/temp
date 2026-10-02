// The service worker's logic (sw.js), run in Node against a small fake CacheStorage: activation only deletes OUR old caches (ka1e27.github.io is one origin for every
// GitHub Pages project of the owner), the cache is the fallback for a 5xx, a slow network and a captive portal's HTML, and bad answers never enter the cache.
// The real-browser half is tools/check.mjs --base=temp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://pages.test';
const urlOf = (r) => (typeof r === 'string' ? r : r.url);

function fakeCaches(initial = {}) {
  const stores = new Map(Object.entries(initial).map(([name, files]) => [name, new Map(Object.entries(files))]));
  const handle = (name) => ({
    async match(req, opts = {}) {
      const store = stores.get(name);
      const u = new URL(urlOf(req));
      for (const [k, v] of store) {
        const ku = new URL(k);
        if (k === u.href || (opts.ignoreSearch && ku.origin + ku.pathname === u.origin + u.pathname)) return v.clone();
      }
      return undefined;
    },
    async put(req, res) { stores.get(name).set(new URL(urlOf(req)).href, res); },
    async keys() { return [...stores.get(name).keys()].map((u) => ({ url: u })); },
  });
  return {
    stores,
    async open(name) { if (!stores.has(name)) stores.set(name, new Map()); return handle(name); },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async match() { return undefined; },
  };
}

/** Loads sw.js into a sandbox with a fake `self`; returns the registered listeners and the pieces a test needs. */
function loadWorker({ caches, fetchImpl, timeoutMs = 30 }) {
  const listeners = {};
  const self = {
    location: { origin: ORIGIN },
    registration: { scope: `${ORIGIN}/temp/` },
    clients: { claim: async () => {} },
    skipWaiting: () => {},
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  const ctx = vm.createContext({
    self, caches, fetch: fetchImpl, Request, Response, URL, Promise, console,
    // the worker waits 3.5 s for a slow network: the test waits milliseconds
    setTimeout: (fn, ms) => setTimeout(fn, ms >= 3000 ? timeoutMs : ms),
    clearTimeout,
  });
  vm.runInContext(SOURCE, ctx);
  return { listeners, self };
}

async function runFetch(worker, url) {
  const pending = [];
  let responded = null;
  const event = { request: new Request(url), respondWith: (p) => { responded = p; }, waitUntil: (p) => { pending.push(p); } };
  worker.listeners.fetch(event);
  const response = responded ? await responded : null;
  await Promise.allSettled(pending);
  return response;
}

const jsOk = () => new Response('export const real = 1;', { status: 200, headers: { 'Content-Type': 'text/javascript' } });
const MAIN = `${ORIGIN}/temp/game/main.js`;

test('activation deletes our OLD hexdominion-* caches and nothing else (the origin is shared with the owner\'s other projects)', async () => {
  const caches = fakeCaches({ 'hexdominion-v1': { [MAIN]: jsOk() }, 'hexdominion-v2-4': {}, 'hexdominion-v2-5': {}, 'other-app-v3': {}, 'workbox-precache': {} });
  const w = loadWorker({ caches, fetchImpl: async () => jsOk() });
  const pending = [];
  w.listeners.activate({ waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  const left = await caches.keys();
  assert.ok(left.includes('other-app-v3') && left.includes('workbox-precache'), `foreign caches survive: ${left}`);
  assert.ok(!left.includes('hexdominion-v1') && !left.includes('hexdominion-v2-4'), `our old caches go: ${left}`);
  assert.ok(left.includes('hexdominion-v2-5'), 'the current cache stays');
});

test('a 503 from the server serves the cached copy; a 404 is passed on (the file is really gone)', async () => {
  const caches = fakeCaches({ 'hexdominion-v2-5': { [MAIN]: jsOk() } });
  const w503 = loadWorker({ caches, fetchImpl: async () => new Response('<h1>503</h1>', { status: 503, headers: { 'Content-Type': 'text/html' } }) });
  const res = await runFetch(w503, MAIN);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'export const real = 1;');
  const w404 = loadWorker({ caches, fetchImpl: async () => new Response('nope', { status: 404, headers: { 'Content-Type': 'text/plain' } }) });
  assert.equal((await runFetch(w404, MAIN)).status, 404);
});

test('a captive portal (HTML, 200) in place of a script is neither served nor cached', async () => {
  const caches = fakeCaches({ 'hexdominion-v2-5': { [MAIN]: jsOk() } });
  const portal = async () => new Response('<html>Sign in to the Wi-Fi</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
  const w = loadWorker({ caches, fetchImpl: portal });
  const res = await runFetch(w, MAIN);
  assert.equal(await res.text(), 'export const real = 1;', 'the cached script is served');
  const stored = await (await caches.open('hexdominion-v2-5')).match(MAIN);
  assert.equal(await stored.text(), 'export const real = 1;', 'the cache still holds the real script');
  // with nothing cached the portal page is returned as it came (nothing better exists) but still never cached
  const empty = fakeCaches({ 'hexdominion-v2-5': {} });
  const w2 = loadWorker({ caches: empty, fetchImpl: portal });
  await runFetch(w2, MAIN);
  assert.equal((await (await empty.open('hexdominion-v2-5')).keys()).length, 0, 'the portal page was not cached');
});

test('a slow network loses to the cached copy; a good answer refreshes the cache; offline with nothing cached is a 503', async () => {
  const caches = fakeCaches({ 'hexdominion-v2-5': { [MAIN]: jsOk() } });
  const slow = loadWorker({ caches, fetchImpl: () => new Promise((resolve) => setTimeout(() => resolve(new Response('export const late = 1;', { status: 200, headers: { 'Content-Type': 'text/javascript' } })), 400)), timeoutMs: 30 });
  assert.equal(await (await runFetch(slow, MAIN)).text(), 'export const real = 1;', 'the cached copy answers before the slow network does');
  const fresh = fakeCaches({ 'hexdominion-v2-5': { [MAIN]: jsOk() } });
  const fast = loadWorker({ caches: fresh, fetchImpl: async () => new Response('export const newer = 2;', { status: 200, headers: { 'Content-Type': 'text/javascript' } }) });
  assert.equal(await (await runFetch(fast, MAIN)).text(), 'export const newer = 2;');
  assert.equal(await (await (await fresh.open('hexdominion-v2-5')).match(MAIN)).text(), 'export const newer = 2;', 'the cache was refreshed with the newer file');
  const none = loadWorker({ caches: fakeCaches({ 'hexdominion-v2-5': {} }), fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal((await runFetch(none, MAIN)).status, 503);
});
