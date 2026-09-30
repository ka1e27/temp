// Service worker: offline play + installability for Hex Dominion 2.
//
// NETWORK-FIRST for everything same-origin. v1 used cache-first, which is fine
// for a finished game but means a returning player can be served a stale mix of
// files after an update. Network-first always runs the newest deploy when online
// and falls back to the last good copy when offline.
//
// The cache name carries a version: activating a new worker deletes every other
// cache, including v1's 'hexdominion-v1', so old files can never be mixed in.
//
// FIRST VISIT: a worker does not control the page that registered it, so nothing that page
// loaded went through the fetch handler below and none of it was cached; reloading offline right
// after a first visit would fail. Two things close that gap: the app shell is cached at install,
// and the page sends the list of everything it loaded (a 'precache' message) once the worker is
// ready, which the worker fetches into the same cache.
//
// Everything is relative to the worker's SCOPE, never to "/": the site lives under a project
// subpath (https://ka1e27.github.io/temp/).
const CACHE = 'hexdominion-v2-4';
const SHELL = ['./', './index.html', './manifest.webmanifest', './favicon.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'];

const isFontHost = (url) => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

/** Fetches each URL into the cache unless it is already there. Best effort: one failure never blocks the rest. */
async function precache(list) {
  const cache = await caches.open(CACHE);
  await Promise.all(list.map(async (raw) => {
    try {
      const url = new URL(raw, self.registration.scope);
      const font = isFontHost(url);
      if (url.origin !== self.location.origin && !font) return;
      if (await cache.match(url.href)) return;
      const req = font ? new Request(url.href, { mode: 'no-cors' }) : new Request(url.href, { cache: 'reload' });
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) await cache.put(url.href, res);
    } catch { /* offline, or a file that does not exist: skip it */ }
  }));
}

self.addEventListener('install', (e) => {
  e.waitUntil(precache(SHELL));
  self.skipWaiting();
});

self.addEventListener('message', (e) => {
  const data = e.data;
  if (data && data.type === 'precache' && Array.isArray(data.urls)) e.waitUntil(precache(data.urls));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Google Fonts: cache-first (immutable URLs), so text renders offline too.
  const isFont = isFontHost(url);
  if (url.origin !== self.location.origin && !isFont) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (isFont) {
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      } catch {
        return new Response('', { status: 504 });
      }
    }
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      return new Response('Offline, and this file was never cached.', {
        status: 503, headers: { 'Content-Type': 'text/plain' },
      });
    }
  })());
});
